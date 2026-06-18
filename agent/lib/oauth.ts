import { getGrant, storeRefreshToken } from "./token-store.ts";

// Headless OAuth for the gateway route. The Zuplo MCP Gateway only issues tokens
// via authorization_code + PKCE (no client_credentials), so a human signs in
// ONCE with `npm run bootstrap`, which stores a refresh token. At runtime the
// agent never opens a browser: getToken exchanges that refresh token for a fresh
// access token (RFC 6749 §6). eve caches it per step and refreshes ahead of
// `expiresAt`, so the only network call most steps make is none.

export function reqEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

// Authorization-server metadata (RFC 8414). Shared with the bootstrap script.
// For an issuer with a path, the well-known segment goes between origin and path.
// The Zuplo gateway's issuer IS the route, so default to it; override only if a
// deployment puts the authorization server on a separate origin.
export async function authServerMeta(): Promise<Record<string, string>> {
  const issuer = new URL(process.env.MCP_OAUTH_ISSUER ?? reqEnv("MCP_GATEWAY_URL"));
  const path = issuer.pathname === "/" ? "" : issuer.pathname;
  const url = new URL(`/.well-known/oauth-authorization-server${path}`, issuer.origin);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Auth-server metadata fetch failed: ${res.status} ${await res.text()}`);
  return res.json();
}

export async function refreshAccessToken(): Promise<{ token: string; expiresAt?: number }> {
  const { clientId, refreshToken } = await getGrant();
  if (!clientId || !refreshToken) {
    throw new Error("No stored grant. Run `npm run bootstrap` once to sign in and capture a refresh token.");
  }

  const meta = await authServerMeta();
  const res = await fetch(meta.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
      resource: reqEnv("MCP_GATEWAY_URL"), // RFC 8707: scope the token to this route
    }),
  });
  if (!res.ok) {
    throw new Error(
      `refresh_token grant failed: ${res.status} ${await res.text()} — ` +
        "re-run `npm run bootstrap` if the grant or the 90-day DCR client expired.",
    );
  }

  const t = await res.json();
  if (!t.access_token) throw new Error("Token endpoint returned no access_token");
  // Refresh tokens may rotate; persist the new one so the next run still works.
  if (t.refresh_token) await storeRefreshToken(t.refresh_token);

  return { token: t.access_token, expiresAt: t.expires_in ? Date.now() + t.expires_in * 1000 : undefined };
}
