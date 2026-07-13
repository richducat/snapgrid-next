import { randomBytes } from "node:crypto";
import { resolve } from "node:path";

export const DEFAULTS = Object.freeze({
  usdcMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  treasuryOwner: "9o77AkThGHNhNDeowM943dNsCck71VTUeFwBxq3RaGjn",
  destinationUsdcAccount: "5BGZDUonmhPRduGaPZR4mV4ZBuGUdjt8cips4magqbHU",
});

export function loadConfig(environment = process.env) {
  const production = environment.NODE_ENV === "production";
  const secret = environment.SNAPGRID_ORDER_SECRET;
  const rpcUrl = environment.SOLANA_RPC_URL;
  if (!secret || Buffer.byteLength(secret) < 32) throw new Error("SNAPGRID_ORDER_SECRET must be at least 32 bytes");
  if (!rpcUrl) throw new Error("SOLANA_RPC_URL is required");
  const parsedRpc = new URL(rpcUrl);
  if (parsedRpc.protocol !== "https:" && production) throw new Error("SOLANA_RPC_URL must use HTTPS in production");
  if (production && /api\.mainnet-beta\.solana\.com$/i.test(parsedRpc.hostname)) {
    throw new Error("A private production Solana RPC is required");
  }
  if (production && !environment.DATABASE_URL) throw new Error("DATABASE_URL is required in production");
  const usdcMint = environment.SNAPGRID_USDC_MINT || DEFAULTS.usdcMint;
  const treasuryOwner = environment.SNAPGRID_TREASURY_OWNER || DEFAULTS.treasuryOwner;
  const destinationUsdcAccount = environment.SNAPGRID_DESTINATION_USDC_ACCOUNT || DEFAULTS.destinationUsdcAccount;
  if (production && (
    usdcMint !== DEFAULTS.usdcMint ||
    treasuryOwner !== DEFAULTS.treasuryOwner ||
    destinationUsdcAccount !== DEFAULTS.destinationUsdcAccount
  )) {
    throw new Error("Production treasury settings must match the Snapgrid release configuration");
  }
  return Object.freeze({
    port: Number(environment.PORT || 8787),
    secret,
    rpcUrl,
    usdcMint,
    treasuryOwner,
    destinationUsdcAccount,
    ledgerPath: resolve(environment.SNAPGRID_LEDGER_PATH || "./data/fulfillments.json"),
    databaseUrl: environment.DATABASE_URL || null,
    production,
    instanceId: randomBytes(6).toString("hex"),
  });
}
