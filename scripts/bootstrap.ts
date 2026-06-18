// One-time OAuth bootstrap. Run `npm run bootstrap` once: it registers a public
// client, runs the authorization_code + PKCE flow in your browser, and stores
// the resulting refresh token. After this the agent runs headless — the runtime
// only ever does refresh_token grants (see agent/lib/oauth.ts).
//
// Stdlib only: node:crypto for PKCE, node:http for the loopback redirect.

import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { authServerMeta, reqEnv } from "../agent/lib/oauth.ts";
import { storeGrant } from "../agent/lib/token-store.ts";

const REDIRECT_PORT = 8976;
const REDIRECT_URI = `http://127.0.0.1:${REDIRECT_PORT}/callback`;
const b64url = (b: Buffer) => b.toString("base64url");

async function registerClient(meta: Record<string, string>): Promise<string> {
  const endpoint = meta.registration_endpoint;
  if (!endpoint) throw new Error("Auth server advertises no registration_endpoint (RFC 7591).");
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "eve-mcp-gateway-demo",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none", // public client + PKCE
      redirect_uris: [REDIRECT_URI],
    }),
  });
  if (!res.ok) throw new Error(`Dynamic client registration failed: ${res.status} ${await res.text()}`);
  return (await res.json()).client_id as string;
}

// Serve the one redirect, hand back the auth code.
function waitForCode(): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", REDIRECT_URI);
      if (url.pathname !== "/callback") {
        res.writeHead(404).end();
        return;
      }
      const code = url.searchParams.get("code");
      const error = url.searchParams.get("error");
      res.writeHead(200, { "content-type": "text/plain" });
      res.end(code ? "Signed in. You can close this tab." : `Sign-in failed: ${error ?? "no code"}`);
      server.close();
      code ? resolve(code) : reject(new Error(`No code in callback: ${error ?? "unknown error"}`));
    });
    server.listen(REDIRECT_PORT, "127.0.0.1");
  });
}

const meta = await authServerMeta();
const clientId = await registerClient(meta);

const verifier = b64url(randomBytes(32));
const challenge = b64url(createHash("sha256").update(verifier).digest());

const authUrl = new URL(meta.authorization_endpoint);
authUrl.search = new URLSearchParams({
  response_type: "code",
  client_id: clientId,
  redirect_uri: REDIRECT_URI,
  code_challenge: challenge,
  code_challenge_method: "S256",
  resource: reqEnv("MCP_GATEWAY_URL"), // required by the gateway
  scope: "mcp:tools", // the gateway's only scope
}).toString();

console.log(`\nOpen this URL to sign in:\n\n  ${authUrl.href}\n`);
const code = await waitForCode();

const res = await fetch(meta.token_endpoint, {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECT_URI,
    client_id: clientId,
    code_verifier: verifier,
    resource: reqEnv("MCP_GATEWAY_URL"),
  }),
});
if (!res.ok) throw new Error(`Token exchange failed: ${res.status} ${await res.text()}`);

const tokens = await res.json();
if (!tokens.refresh_token) {
  throw new Error(
    "No refresh_token returned. The gateway route must be configured to issue refresh tokens " +
      "(the client registered for the refresh_token grant above).",
  );
}

await storeGrant(clientId, tokens.refresh_token);
console.log("\nBootstrapped. The agent now runs headless — start it with `npm run dev`.\n");
