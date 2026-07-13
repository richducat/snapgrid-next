import { createHmac, timingSafeEqual } from "node:crypto";

function encode(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function signature(body, secret) {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

export function signOrder(order, secret) {
  const body = encode(order);
  return `${body}.${signature(body, secret)}`;
}

export function verifyOrderToken(token, secret, now = Date.now()) {
  if (typeof token !== "string" || token.length > 8_192) throw new Error("invalid order token");
  const [body, supplied, extra] = token.split(".");
  if (!body || !supplied || extra) throw new Error("invalid order token");
  const expected = signature(body, secret);
  const suppliedBytes = Buffer.from(supplied);
  const expectedBytes = Buffer.from(expected);
  if (suppliedBytes.length !== expectedBytes.length || !timingSafeEqual(suppliedBytes, expectedBytes)) {
    throw new Error("invalid order token");
  }
  const order = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  if (!Number.isSafeInteger(order.verifyUntil) || order.verifyUntil < now) throw new Error("expired order token");
  return order;
}

export function fulfillmentId(orderId, transactionSignature, secret) {
  return createHmac("sha256", secret)
    .update(`fulfilled:${orderId}:${transactionSignature}`)
    .digest("base64url")
    .slice(0, 32);
}
