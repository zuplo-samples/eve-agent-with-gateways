import { defineMcpClientConnection } from "eve/connections";
import { refreshAccessToken } from "../lib/oauth.ts";

export default defineMcpClientConnection({
  url: process.env.MCP_GATEWAY_URL!,
  description: "Buffer: channels, posts, and drafts.",
  auth: { getToken: () => refreshAccessToken() },
});
