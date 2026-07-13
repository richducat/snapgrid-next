# Snapgrid payment verifier

This service creates fixed-price mainnet USDC orders for Snapgrid Remix and
fulfills a game-token purchase only after an exact transfer is finalized.

Required production environment:

- `SOLANA_RPC_URL`: private mainnet RPC HTTPS endpoint.
- `SNAPGRID_ORDER_SECRET`: random secret of at least 32 bytes.
- `DATABASE_URL`: private PostgreSQL connection string. Production uses a
  transactional table with unique order, signature, and fulfillment IDs.

Local-development treasury overrides default to the approved Snapgrid publisher
wallet, mainnet USDC mint, and its verified USDC associated token account.
Production refuses to start if any of these values differ from the app release:

- `SNAPGRID_TREASURY_OWNER`
- `SNAPGRID_USDC_MINT`
- `SNAPGRID_DESTINATION_USDC_ACCOUNT`

For local development and tests only, the service can use `SNAPGRID_LEDGER_PATH`
instead of PostgreSQL.

The service refuses to start in production with the public Solana RPC, validates
the treasury token account on startup, never holds a private key, never signs a
transaction, stores no seed phrase, and logs no wallet or order payloads.
