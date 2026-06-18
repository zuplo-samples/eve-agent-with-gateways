import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

// Persists the long-lived OAuth grant the headless agent runs on: the DCR
// client_id and the refresh token captured by `npm run bootstrap`. The runtime
// never does an interactive flow — it just refreshes against these.
//
// ponytail: plaintext JSON, fine for a single-tenant demo. The refresh token is
// a long-lived secret; use a secrets manager / encrypted KV in production.

const STORE_PATH = join(process.cwd(), ".eve", "oauth-store.json");

export type Grant = { clientId?: string; refreshToken?: string };

async function read(): Promise<Grant> {
  try {
    return JSON.parse(await readFile(STORE_PATH, "utf8")) as Grant;
  } catch {
    return {};
  }
}

async function write(grant: Grant): Promise<void> {
  await mkdir(dirname(STORE_PATH), { recursive: true });
  await writeFile(STORE_PATH, JSON.stringify(grant, null, 2), "utf8");
}

export async function getGrant(): Promise<Grant> {
  return read();
}

// Bootstrap writes both; runtime rewrites only the (rotated) refresh token.
export async function storeGrant(clientId: string, refreshToken: string): Promise<void> {
  await write({ clientId, refreshToken });
}

export async function storeRefreshToken(refreshToken: string): Promise<void> {
  await write({ ...(await read()), refreshToken });
}
