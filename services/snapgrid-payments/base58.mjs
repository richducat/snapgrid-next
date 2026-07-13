const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const INDEX = new Map([...ALPHABET].map((character, index) => [character, index]));

export function encodeBase58(input) {
  const bytes = Buffer.from(input);
  if (bytes.length === 0) return "";
  let value = BigInt(`0x${bytes.toString("hex") || "0"}`);
  let encoded = "";
  while (value > 0n) {
    const remainder = Number(value % 58n);
    encoded = ALPHABET[remainder] + encoded;
    value /= 58n;
  }
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros += 1;
  return "1".repeat(zeros) + encoded;
}

export function decodeBase58(value) {
  if (typeof value !== "string" || value.length === 0) throw new Error("invalid base58");
  let decoded = 0n;
  for (const character of value) {
    const digit = INDEX.get(character);
    if (digit === undefined) throw new Error("invalid base58");
    decoded = decoded * 58n + BigInt(digit);
  }
  let hex = decoded.toString(16);
  if (hex.length % 2) hex = `0${hex}`;
  const body = decoded === 0n ? Buffer.alloc(0) : Buffer.from(hex, "hex");
  let zeros = 0;
  while (zeros < value.length && value[zeros] === "1") zeros += 1;
  return Buffer.concat([Buffer.alloc(zeros), body]);
}

export function isPublicKey(value) {
  try {
    return decodeBase58(value).length === 32;
  } catch {
    return false;
  }
}

export function isSignature(value) {
  try {
    return decodeBase58(value).length === 64;
  } catch {
    return false;
  }
}
