import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export class FulfillmentLedger {
  #path;
  #state = { version: 1, fulfilled: {} };
  #queue = Promise.resolve();

  constructor(path) {
    this.#path = path;
  }

  async load() {
    await mkdir(dirname(this.#path), { recursive: true, mode: 0o700 });
    try {
      const parsed = JSON.parse(await readFile(this.#path, "utf8"));
      if (parsed?.version !== 1 || !parsed.fulfilled || typeof parsed.fulfilled !== "object") {
        throw new Error("unsupported payment ledger");
      }
      this.#state = parsed;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      await this.#persist();
    }
  }

  get(orderId) {
    return this.#state.fulfilled[orderId] ?? null;
  }

  async health() {
    return true;
  }

  async record(entry) {
    const operation = this.#queue.then(async () => {
      const existing = this.#state.fulfilled[entry.orderId];
      if (existing) {
        if (existing.signature !== entry.signature) throw new Error("order already fulfilled");
        return existing;
      }
      const duplicate = Object.values(this.#state.fulfilled).find((item) => item.signature === entry.signature);
      if (duplicate) throw new Error("transaction already used");
      this.#state.fulfilled[entry.orderId] = Object.freeze({ ...entry });
      await this.#persist();
      return this.#state.fulfilled[entry.orderId];
    });
    this.#queue = operation.catch(() => {});
    return operation;
  }

  async #persist() {
    const temporary = `${this.#path}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(this.#state, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, this.#path);
  }
}
