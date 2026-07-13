import { migratePostgres } from "./postgres-ledger.mjs";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");
await migratePostgres(connectionString);
process.stdout.write("Snapgrid payment ledger is ready\n");
