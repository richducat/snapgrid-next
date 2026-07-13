import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { DEFAULTS } from "./config.mjs";
import { FulfillmentLedger } from "./ledger.mjs";
import { createSnapgridServer } from "./server.mjs";

const WALLET = DEFAULTS.treasuryOwner;
const SOURCE = DEFAULTS.usdcMint;
const BLOCKHASH = "11111111111111111111111111111111";
const SIGNATURE = "1".repeat(64);

let directory;
let server;
let endpoint;
let latestOrder;
let enoughUsdc;
let transferAmount;
let transactionWallet;
let includeReference;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "snapgrid-payments-"));
  enoughUsdc = true;
  transferAmount = 990_000;
  transactionWallet = WALLET;
  includeReference = true;
  const config = {
    secret: "test-secret-that-is-longer-than-thirty-two-bytes",
    rpcUrl: "https://rpc.test.invalid",
    usdcMint: DEFAULTS.usdcMint,
    treasuryOwner: DEFAULTS.treasuryOwner,
    destinationUsdcAccount: DEFAULTS.destinationUsdcAccount,
    ledgerPath: join(directory, "ledger.json"),
    verificationAttempts: 1,
  };
  const ledger = new FulfillmentLedger(config.ledgerPath);
  await ledger.load();
  const rpc = async (method) => {
    if (method === "getTokenAccountsByOwner") {
      return {
        value: enoughUsdc ? [{
          pubkey: SOURCE,
          account: { data: { parsed: { info: {
            owner: WALLET,
            mint: DEFAULTS.usdcMint,
            tokenAmount: { amount: "10000000" },
          } } } },
        }] : [],
      };
    }
    if (method === "getLatestBlockhash") return { value: { blockhash: BLOCKHASH } };
    if (method === "getTransaction") return finalizedTransaction(latestOrder, transferAmount);
    throw new Error(`Unexpected RPC method ${method}`);
  };
  server = createSnapgridServer({ config, rpc, ledger });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  endpoint = `http://127.0.0.1:${server.address().port}`;
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
  await rm(directory, { recursive: true, force: true });
});

test("creates an exact-price order and fulfills a finalized USDC transfer once", async () => {
  latestOrder = await createOrder();
  assert.equal(latestOrder.amountMicros, 990_000);
  assert.equal(latestOrder.destination, DEFAULTS.destinationUsdcAccount);

  const first = await post("/v1/orders/verify", {
    orderToken: latestOrder.orderToken,
    signature: SIGNATURE,
  });
  assert.equal(first.response.status, 200);
  assert.equal(first.body.signature, SIGNATURE);
  assert.equal(typeof first.body.fulfillmentId, "string");

  const replay = await post("/v1/orders/verify", {
    orderToken: latestOrder.orderToken,
    signature: SIGNATURE,
  });
  assert.equal(replay.response.status, 200);
  assert.equal(replay.body.fulfillmentId, first.body.fulfillmentId);
});

test("refuses to quote when the wallet lacks enough USDC", async () => {
  enoughUsdc = false;
  const result = await post("/v1/orders", { wallet: WALLET, productId: "token-starter" });
  assert.equal(result.response.status, 402);
  assert.equal(result.body.error, "insufficient_usdc");
});

test("rejects a changed order token", async () => {
  latestOrder = await createOrder();
  const last = latestOrder.orderToken.at(-1);
  const tampered = `${latestOrder.orderToken.slice(0, -1)}${last === "a" ? "b" : "a"}`;
  const result = await post("/v1/orders/verify", { orderToken: tampered, signature: SIGNATURE });
  assert.equal(result.response.status, 400);
  assert.equal(result.body.error, "invalid_order");
});

test("does not fulfill a transfer with the wrong amount", async () => {
  latestOrder = await createOrder();
  transferAmount = 1;
  const result = await post("/v1/orders/verify", {
    orderToken: latestOrder.orderToken,
    signature: SIGNATURE,
  });
  assert.equal(result.response.status, 422);
  assert.equal(result.body.error, "wrong_transfer");
});

test("does not fulfill a transfer from another wallet", async () => {
  latestOrder = await createOrder();
  transactionWallet = BLOCKHASH;
  const result = await post("/v1/orders/verify", {
    orderToken: latestOrder.orderToken,
    signature: SIGNATURE,
  });
  assert.equal(result.response.status, 422);
  assert.equal(result.body.error, "wrong_wallet");
});

test("does not fulfill a transfer without its unique order reference", async () => {
  latestOrder = await createOrder();
  includeReference = false;
  const result = await post("/v1/orders/verify", {
    orderToken: latestOrder.orderToken,
    signature: SIGNATURE,
  });
  assert.equal(result.response.status, 422);
  assert.equal(result.body.error, "missing_reference");
});

async function createOrder() {
  const result = await post("/v1/orders", { wallet: WALLET, productId: "token-starter" });
  assert.equal(result.response.status, 201);
  return result.body;
}

async function post(path, body) {
  const response = await fetch(endpoint + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { response, body: await response.json() };
}

function finalizedTransaction(order, amount) {
  const accountKeys = [
    { pubkey: transactionWallet, signer: true, writable: true },
    { pubkey: SOURCE, signer: false, writable: true },
    { pubkey: DEFAULTS.usdcMint, signer: false, writable: false },
    { pubkey: DEFAULTS.destinationUsdcAccount, signer: false, writable: true },
  ];
  if (includeReference) accountKeys.push({ pubkey: order.reference, signer: false, writable: false });
  return {
    blockTime: Math.floor(Date.now() / 1_000),
    meta: {
      err: null,
      preTokenBalances: [
        { accountIndex: 1, mint: DEFAULTS.usdcMint, uiTokenAmount: { amount: "10000000" } },
        { accountIndex: 3, mint: DEFAULTS.usdcMint, uiTokenAmount: { amount: "0" } },
      ],
      postTokenBalances: [
        { accountIndex: 1, mint: DEFAULTS.usdcMint, uiTokenAmount: { amount: String(10_000_000 - amount) } },
        { accountIndex: 3, mint: DEFAULTS.usdcMint, uiTokenAmount: { amount: String(amount) } },
      ],
    },
    transaction: {
      signatures: [SIGNATURE],
      message: {
        accountKeys,
        instructions: [{
          program: "spl-token",
          parsed: {
            type: "transferChecked",
            info: {
              source: SOURCE,
              destination: DEFAULTS.destinationUsdcAccount,
              mint: DEFAULTS.usdcMint,
              authority: WALLET,
              tokenAmount: { amount: String(amount), decimals: 6 },
            },
          },
        }],
      },
    },
  };
}
