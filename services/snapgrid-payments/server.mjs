import http from "node:http";
import { randomBytes, randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { CATALOG } from "./catalog.mjs";
import { encodeBase58, isPublicKey, isSignature } from "./base58.mjs";
import { loadConfig } from "./config.mjs";
import { FulfillmentLedger } from "./ledger.mjs";
import { PostgresFulfillmentLedger } from "./postgres-ledger.mjs";
import { fulfillmentId, signOrder, verifyOrderToken } from "./order-token.mjs";

class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function createRpcClient(config) {
  let requestId = 0;
  return async (method, params) => {
    const response = await fetch(config.rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++requestId, method, params }),
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) throw new Error("Solana RPC request failed");
    const payload = await response.json();
    if (payload.error) throw new Error("Solana RPC returned an error");
    return payload.result;
  };
}

export async function validateTreasury(rpc, config) {
  const result = await rpc("getAccountInfo", [
    config.destinationUsdcAccount,
    { encoding: "jsonParsed", commitment: "finalized" },
  ]);
  const info = result?.value?.data?.parsed?.info;
  if (info?.mint !== config.usdcMint || info?.owner !== config.treasuryOwner) {
    throw new Error("The configured treasury USDC account does not match the expected owner and mint");
  }
}

export function createSnapgridServer({ config, rpc, ledger }) {
  const buckets = new Map();
  return http.createServer(async (request, response) => {
    applyHeaders(response);
    try {
      const url = new URL(request.url || "/", "https://pay.snapgrid.eb28.co");
      if (request.method === "GET" && url.pathname === "/health") {
        await ledger.health();
        return sendJson(response, 200, { ok: true, service: "snapgrid-payments", network: "mainnet-beta" });
      }
      if (request.method !== "POST") throw new HttpError(404, "not_found", "Not found.");
      enforceRateLimit(request, buckets);
      if (url.pathname === "/v1/orders") {
        const body = await readJson(request);
        const order = await createOrder(body, rpc, config);
        return sendJson(response, 201, publicOrder(order, config.secret));
      }
      if (url.pathname === "/v1/orders/verify") {
        const body = await readJson(request);
        const verified = await verifyAndFulfill(body, rpc, ledger, config);
        return sendJson(response, 200, verified);
      }
      throw new HttpError(404, "not_found", "Not found.");
    } catch (error) {
      const safe = normalizeError(error);
      sendJson(response, safe.status, { error: safe.code, message: safe.message });
    }
  });
}

async function createOrder(body, rpc, config) {
  const wallet = body?.wallet;
  const product = CATALOG[body?.productId];
  if (!isPublicKey(wallet) || !product) {
    throw new HttpError(400, "invalid_order", "Choose a valid wallet and shop item.");
  }
  const accounts = await rpc("getTokenAccountsByOwner", [
    wallet,
    { mint: config.usdcMint },
    { encoding: "jsonParsed", commitment: "confirmed" },
  ]);
  const source = accounts?.value?.find((account) => {
    const info = account?.account?.data?.parsed?.info;
    const amount = info?.tokenAmount?.amount;
    return info?.owner === wallet && info?.mint === config.usdcMint && /^\d+$/.test(amount || "") && BigInt(amount) >= BigInt(product.amountMicros);
  });
  if (!source?.pubkey) {
    throw new HttpError(402, "insufficient_usdc", `That wallet needs at least ${(product.amountMicros / 1_000_000).toFixed(2)} USDC.`);
  }
  const latest = await rpc("getLatestBlockhash", [{ commitment: "finalized" }]);
  const blockhash = latest?.value?.blockhash;
  if (!isPublicKey(blockhash)) throw new Error("Solana did not return a usable blockhash");
  const now = Date.now();
  return Object.freeze({
    version: 1,
    orderId: randomUUID(),
    productId: product.productId,
    wallet,
    amountMicros: product.amountMicros,
    source: source.pubkey,
    destination: config.destinationUsdcAccount,
    mint: config.usdcMint,
    reference: encodeBase58(randomBytes(32)),
    blockhash,
    createdAt: now,
    quoteExpiresAt: now + 90_000,
    verifyUntil: now + 15 * 60_000,
  });
}

function publicOrder(order, secret) {
  return {
    orderId: order.orderId,
    orderToken: signOrder(order, secret),
    productId: order.productId,
    amountMicros: order.amountMicros,
    source: order.source,
    destination: order.destination,
    mint: order.mint,
    reference: order.reference,
    blockhash: order.blockhash,
    quoteExpiresAt: order.quoteExpiresAt,
  };
}

async function verifyAndFulfill(body, rpc, ledger, config) {
  if (!isSignature(body?.signature)) throw new HttpError(400, "invalid_signature", "That payment signature is not valid.");
  let order;
  try {
    order = verifyOrderToken(body.orderToken, config.secret);
  } catch (error) {
    const expired = /expired/.test(error.message);
    throw new HttpError(expired ? 410 : 400, expired ? "expired_order" : "invalid_order", expired ? "That price quote expired. Please try again." : "That order could not be verified.");
  }
  assertOrder(order, config);
  const existing = await ledger.get(order.orderId);
  if (existing) {
    if (existing.signature !== body.signature) throw new HttpError(409, "fulfilled_order", "That order was already completed.");
    return { fulfillmentId: existing.fulfillmentId, signature: existing.signature, productId: existing.productId };
  }
  const transaction = await waitForFinalizedTransaction(rpc, body.signature, config.verificationAttempts || 30);
  if (!transaction) {
    throw new HttpError(425, "still_confirming", "Your payment is still confirming. Snapgrid will check it again shortly.");
  }
  verifyTransaction(transaction, body.signature, order);
  let entry;
  try {
    entry = await ledger.record({
      orderId: order.orderId,
      productId: order.productId,
      wallet: order.wallet,
      amountMicros: order.amountMicros,
      signature: body.signature,
      fulfillmentId: fulfillmentId(order.orderId, body.signature, config.secret),
      fulfilledAt: new Date().toISOString(),
    });
  } catch (error) {
    if (/already fulfilled|already used/i.test(error?.message || "")) {
      throw new HttpError(409, "payment_already_used", "That payment was already used for another purchase.");
    }
    throw error;
  }
  return { fulfillmentId: entry.fulfillmentId, signature: entry.signature, productId: entry.productId };
}

async function waitForFinalizedTransaction(rpc, signature, attempts) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const transaction = await rpc("getTransaction", [
      signature,
      { encoding: "jsonParsed", commitment: "finalized", maxSupportedTransactionVersion: 0 },
    ]);
    if (transaction) return transaction;
    if (attempt + 1 < attempts) await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  return null;
}

function verifyTransaction(transaction, signature, order) {
  if (transaction?.meta?.err !== null) throw new HttpError(422, "failed_payment", "The payment did not complete on Solana.");
  if (transaction?.transaction?.signatures?.[0] !== signature) throw new HttpError(422, "wrong_payment", "The payment signature did not match.");
  const keys = transaction.transaction?.message?.accountKeys || [];
  const normalizedKeys = keys.map((key) => typeof key === "string" ? key : key?.pubkey);
  const feePayer = keys[0];
  if (normalizedKeys[0] !== order.wallet || (typeof feePayer === "object" && feePayer.signer !== true)) {
    throw new HttpError(422, "wrong_wallet", "The payment came from a different wallet.");
  }
  if (!normalizedKeys.includes(order.reference)) throw new HttpError(422, "missing_reference", "The payment could not be matched to this order.");
  const instructions = transaction.transaction?.message?.instructions || [];
  const transfer = instructions.find((instruction) => {
    const info = instruction?.parsed?.info;
    const amount = info?.tokenAmount?.amount ?? info?.amount;
    return instruction?.program === "spl-token" &&
      instruction?.parsed?.type === "transferChecked" &&
      info?.source === order.source &&
      info?.destination === order.destination &&
      info?.mint === order.mint &&
      info?.authority === order.wallet &&
      String(amount) === String(order.amountMicros);
  });
  if (!transfer) throw new HttpError(422, "wrong_transfer", "The USDC payment details did not match this order.");
  if (!tokenBalanceMoved(transaction.meta, normalizedKeys, order)) {
    throw new HttpError(422, "wrong_balance", "The USDC balance change did not match this order.");
  }
  if (Number.isFinite(transaction.blockTime) && transaction.blockTime * 1_000 < order.createdAt - 30_000) {
    throw new HttpError(422, "old_payment", "That payment was created before this order.");
  }
  if (Number.isFinite(transaction.blockTime) && transaction.blockTime * 1_000 > order.quoteExpiresAt + 60_000) {
    throw new HttpError(422, "late_payment", "That payment landed after the order expired.");
  }
}

function tokenBalanceMoved(meta, keys, order) {
  const sourceIndex = keys.indexOf(order.source);
  const destinationIndex = keys.indexOf(order.destination);
  const amountAt = (balances, index) => {
    const balance = balances?.find((item) => item.accountIndex === index && item.mint === order.mint);
    return balance ? BigInt(balance.uiTokenAmount?.amount ?? balance.tokenAmount?.amount ?? "0") : null;
  };
  const sourceBefore = amountAt(meta.preTokenBalances, sourceIndex);
  const sourceAfter = amountAt(meta.postTokenBalances, sourceIndex);
  const destinationBefore = amountAt(meta.preTokenBalances, destinationIndex);
  const destinationAfter = amountAt(meta.postTokenBalances, destinationIndex);
  if ([sourceBefore, sourceAfter, destinationBefore, destinationAfter].some((value) => value === null)) return false;
  const expected = BigInt(order.amountMicros);
  return sourceBefore - sourceAfter >= expected && destinationAfter - destinationBefore >= expected;
}

function assertOrder(order, config) {
  const product = CATALOG[order?.productId];
  const valid = order?.version === 1 && product &&
    product.amountMicros === order.amountMicros &&
    isPublicKey(order.wallet) && isPublicKey(order.source) &&
    order.destination === config.destinationUsdcAccount &&
    order.mint === config.usdcMint && isPublicKey(order.reference) &&
    typeof order.orderId === "string" && order.orderId.length <= 64 &&
    Number.isSafeInteger(order.createdAt) && Number.isSafeInteger(order.quoteExpiresAt) &&
    order.quoteExpiresAt > order.createdAt;
  if (!valid) throw new HttpError(400, "invalid_order", "That order could not be verified.");
}

function applyHeaders(response) {
  response.setHeader("cache-control", "no-store");
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("referrer-policy", "no-referrer");
  response.setHeader("x-content-type-options", "nosniff");
  response.setHeader("strict-transport-security", "max-age=31536000; includeSubDomains");
}

function sendJson(response, status, body) {
  response.statusCode = status;
  response.end(`${JSON.stringify(body)}\n`);
}

async function readJson(request) {
  if (!String(request.headers["content-type"] || "").toLowerCase().startsWith("application/json")) {
    throw new HttpError(415, "json_required", "Send this request as JSON.");
  }
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > 16_384) throw new HttpError(413, "too_large", "That request is too large.");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "invalid_json", "That request was not valid JSON.");
  }
}

function enforceRateLimit(request, buckets) {
  const forwarded = String(request.headers["x-forwarded-for"] || "").split(",")[0].trim();
  const key = forwarded || request.socket.remoteAddress || "unknown";
  const now = Date.now();
  const recent = (buckets.get(key) || []).filter((timestamp) => now - timestamp < 60_000);
  if (recent.length >= 60) throw new HttpError(429, "rate_limited", "The shop is busy. Give it a moment and try again.");
  recent.push(now);
  buckets.set(key, recent);
  if (buckets.size > 10_000) buckets.clear();
}

function normalizeError(error) {
  if (error instanceof HttpError) return error;
  return new HttpError(503, "temporarily_unavailable", "The shop is temporarily unavailable. Nothing new was charged.");
}

async function main() {
  const config = loadConfig();
  const rpc = createRpcClient(config);
  const ledger = config.databaseUrl
    ? new PostgresFulfillmentLedger(config.databaseUrl)
    : new FulfillmentLedger(config.ledgerPath);
  await ledger.load();
  await validateTreasury(rpc, config);
  const server = createSnapgridServer({ config, rpc, ledger });
  server.listen(config.port, "0.0.0.0", () => {
    process.stdout.write(`Snapgrid payments listening on ${config.port}\n`);
  });
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(`Snapgrid payments could not start: ${error.message}\n`);
    process.exitCode = 1;
  });
}
