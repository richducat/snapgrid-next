import pg from "pg";

const { Pool } = pg;

export class PostgresFulfillmentLedger {
  #pool;

  constructor(connectionString) {
    this.#pool = new Pool({ connectionString, max: 5, idleTimeoutMillis: 30_000 });
  }

  async load() {
    await this.#pool.query("select 1 from snapgrid_fulfillments limit 1");
  }

  async get(orderId) {
    const result = await this.#pool.query(
      `select order_id, product_id, wallet, amount_micros, signature, fulfillment_id, fulfilled_at
         from snapgrid_fulfillments where order_id = $1`,
      [orderId],
    );
    return result.rows[0] ? fromRow(result.rows[0]) : null;
  }

  async health() {
    await this.#pool.query("select 1");
    return true;
  }

  async record(entry) {
    const client = await this.#pool.connect();
    try {
      await client.query("begin");
      await client.query(
        `insert into snapgrid_fulfillments
           (order_id, product_id, wallet, amount_micros, signature, fulfillment_id, fulfilled_at)
         values ($1, $2, $3, $4, $5, $6, $7)
         on conflict (order_id) do nothing`,
        [
          entry.orderId,
          entry.productId,
          entry.wallet,
          entry.amountMicros,
          entry.signature,
          entry.fulfillmentId,
          entry.fulfilledAt,
        ],
      );
      const result = await client.query(
        `select order_id, product_id, wallet, amount_micros, signature, fulfillment_id, fulfilled_at
           from snapgrid_fulfillments where order_id = $1 for update`,
        [entry.orderId],
      );
      const stored = result.rows[0] && fromRow(result.rows[0]);
      if (!stored || stored.signature !== entry.signature) throw new Error("order already fulfilled");
      await client.query("commit");
      return stored;
    } catch (error) {
      await client.query("rollback");
      if (error?.code === "23505") throw new Error("transaction already used");
      throw error;
    } finally {
      client.release();
    }
  }

  async close() {
    await this.#pool.end();
  }
}

export async function migratePostgres(connectionString) {
  const pool = new Pool({ connectionString, max: 1 });
  try {
    await pool.query(`
      create table if not exists snapgrid_fulfillments (
        order_id text primary key,
        product_id text not null,
        wallet text not null,
        amount_micros bigint not null check (amount_micros > 0),
        signature text not null unique,
        fulfillment_id text not null unique,
        fulfilled_at timestamptz not null
      );
      create index if not exists snapgrid_fulfillments_wallet_idx
        on snapgrid_fulfillments (wallet, fulfilled_at desc);
    `);
  } finally {
    await pool.end();
  }
}

function fromRow(row) {
  return {
    orderId: row.order_id,
    productId: row.product_id,
    wallet: row.wallet,
    amountMicros: Number(row.amount_micros),
    signature: row.signature,
    fulfillmentId: row.fulfillment_id,
    fulfilledAt: new Date(row.fulfilled_at).toISOString(),
  };
}
