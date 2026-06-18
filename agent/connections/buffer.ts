import { defineMcpClientConnection } from "eve/connections";
import { refreshAccessToken } from "../lib/oauth.ts";

export default defineMcpClientConnection({
  // A governed gateway route, not the raw Buffer server.
  url: process.env.MCP_GATEWAY_URL!, // https://mcp.acme.dev/mcp/buffer
  description: "Buffer: channels, posts, drafts, and post analytics.",
  // Headless: a one-time `npm run bootstrap` captures a refresh token; getToken
  // exchanges it for a fresh access token each step. No browser at runtime, so
  // principalType stays "app" — one pre-authorized grant, shared across sessions.
  auth: { getToken: () => refreshAccessToken() },
});
