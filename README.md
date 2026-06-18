# Headless Eve Agent With a Zuplo MCP Gateway

A headless [Vercel Eve](https://eve.dev) agent that reaches Buffer through a
[Zuplo MCP Gateway](https://zuplo.com/blog/introducing-zuplo-mcp-gateway) route
instead of pointing at Buffer's hosted MCP server with a shared static key.

The gateway authenticates inbound clients with **authorization-code + PKCE
only** — no `client_credentials` / machine-to-machine grant. So a person signs
in **once** with `npm run bootstrap` to capture a refresh token; the agent runs
headless after that, refreshing silently. The gateway holds Buffer's upstream
key, fronts it with OAuth 2.1, curates tools, and emits a per-call audit —
none of which the agent manages. Pattern from the blog post _"Use an MCP Gateway
With Vercel Eve Agents."_

## Two gateways, same containment

The agent carries no upstream secrets. Both its outbound paths — the model call
and the tool calls — go through a Zuplo gateway that holds the real key.

| Path        | Gateway                | Agent carries        | Real key held by | Configured in                |
| ----------- | ---------------------- | -------------------- | ---------------- | ---------------------------- |
| Model calls | Zuplo **AI** Gateway   | gateway key          | the AI gateway   | `agent/agent.ts` + env       |
| Tool calls  | Zuplo **MCP** Gateway  | OAuth refresh token  | the MCP gateway  | `connections/buffer.ts`      |

### AI Gateway

`agent/agent.ts` routes the model through the AI Gateway with
`@ai-sdk/openai-compatible` — the gateway exposes an OpenAI-compatible `/v1`
endpoint, holds the upstream provider key, and the agent only carries the
gateway's own key.

```ts
const zuplo = createOpenAICompatible({
  name: "zuplo-ai-gateway",
  baseURL: process.env.ZUPLO_AI_GATEWAY_URL!, // https://<your-gateway>/v1
  apiKey: process.env.ZUPLO_AI_GATEWAY_KEY!,
});

export default defineAgent({
  model: zuplo.chatModel(process.env.ZUPLO_AI_MODEL ?? "anthropic/claude-opus-4.8"),
  modelContextWindowTokens: 200_000, // eve can't look up a custom model id's window
});
```

Set `ZUPLO_AI_GATEWAY_URL`, `ZUPLO_AI_GATEWAY_KEY`, and `ZUPLO_AI_MODEL` in
`.env`. The model id is whatever your route expects (e.g.
`anthropic/claude-opus-4.8`).

## Layout

```
agent/
  agent.ts              # model routed through a Zuplo AI Gateway (OpenAI-compatible)
  instructions.md       # system prompt
  connections/
    buffer.ts           # the governed gateway route; getToken refreshes silently
  lib/
    oauth.ts            # ~60-line refresh_token grant + RFC 8414 discovery, no deps
    token-store.ts      # persists the bootstrapped client_id + refresh token
  schedules/
    weekly-metrics.md   # cron: pull last-7-days metrics, summarize across channels
scripts/
  bootstrap.ts          # one-time: sign in once, capture a refresh token
  digest.ts             # demo: fire the weekly schedule now and stream the summary
```

A connection's filename is its identifier, so `connections/buffer.ts` registers
as `buffer`. The model never sees the URL or credentials; it discovers tools
through the built-in `connection__search` and calls them by qualified name like
`connection__buffer__list_channels`.

## Why this shape (and not client_credentials)

The obvious "no human" pattern is the OAuth `client_credentials` grant. The
Zuplo MCP Gateway **does not support it**: it issues its own tokens via
authorization-code + PKCE and validates only gateway-issued tokens. The token
endpoint supports `authorization_code` and `refresh_token` grants — nothing
else. So the realistic headless pattern is:

1. **Once, with a human:** `npm run bootstrap` registers a public client (DCR,
   RFC 7591), runs the PKCE flow in your browser, and stores the **refresh
   token** it gets back.
2. **Every run, headless:** the `buffer` connection's `getToken` calls
   `refreshAccessToken()`, which exchanges that refresh token for a fresh access
   token (RFC 6749 §6). No browser. Eve caches the token per step and refreshes
   ahead of `expiresAt`, so most steps make no token call at all.

Re-bootstrap only when the refresh token or the 90-day DCR client expires.

## Run it

**Prerequisites:** Node 24.x, a Zuplo MCP Gateway route fronting Buffer (see the
[quickstart](https://zuplo.com/docs/mcp-gateway/quickstart)), and a Zuplo AI
Gateway route for the model.

1. **Configure.** `cp .env.example .env`, then fill in:
   - `MCP_GATEWAY_URL` — your gateway's Buffer route (`https://<gateway>/mcp/buffer`)
   - `ZUPLO_AI_GATEWAY_URL`, `ZUPLO_AI_GATEWAY_KEY`, `ZUPLO_AI_MODEL` — the model route
2. **Install.** `npm install`
3. **Bootstrap once.** `npm run bootstrap` — opens a sign-in URL, runs PKCE,
   stores the `client_id` + refresh token in `.eve/oauth-store.json`.
4. **Run headless.** `npm run dev` — serves on `http://127.0.0.1:3000`.

Drive it over HTTP (how a schedule or service would):

```bash
curl -X POST http://127.0.0.1:3000/eve/v1/session \
  -H 'content-type: application/json' \
  -d '{"message":"List my Buffer channels."}'
```

It refreshes a token silently and acts — no browser after the bootstrap.

## Weekly metrics digest (the unattended job)

`agent/schedules/weekly-metrics.md` is what makes the agent actually run on its
own. Its `cron` (`0 9 * * 1` — Mondays 09:00 UTC) fires the agent in task mode
to pull the last 7 days of metrics for every Buffer channel and combine them
into one cross-channel summary. No message, no human — just the cron.

`eve dev` never fires cron on cadence, so to demo it off-schedule, run the
schedule now and stream its summary to your terminal:

```bash
npm run dev        # terminal 1
npm run digest     # terminal 2 — fires weekly-metrics once, prints the summary
```

`npm run digest` reuses the schedule's own prompt (it triggers it by name
through Eve's dev-only dispatch route), so there's one source of truth for what
the job does. In production, `eve start` runs the cron itself; on Vercel each
schedule becomes a Vercel Cron Job.

## What the gateway enforces (not the agent)

| Concern             | Static key in the agent   | Route on the gateway                                    |
| ------------------- | ------------------------- | ------------------------------------------------------- |
| Identity            | One shared API key        | An OAuth client bound to the bootstrapped grant         |
| Tools in scope      | Everything Buffer ships   | A curated subset; hidden tools return `MethodNotFound`  |
| Upstream credential | Buffer key in the agent   | Buffer key held by the gateway, never seen by the agent |
| Revocation          | Rotate the key everywhere | Revoke the grant / rotate the client on the gateway     |
| Audit               | Whatever you build        | A per-call analytics event per route                    |

Tool curation is a config change on the route, not a redeploy of the agent.

> **Want per-end-user identity instead of one service grant?** Use Eve's
> `defineInteractiveAuthorization` so each user signs in through your IdP per
> session. That adds a user principal and a per-user token, at the cost of a
> browser round-trip on first use. This demo takes the headless path.

## Notes

- `.eve/oauth-store.json` holds the `client_id` + refresh token in plaintext for
  the demo. Swap it for a secrets manager / encrypted KV in production — the
  refresh token is a long-lived secret.
- Build the MCP gateway route itself with the
  [MCP Gateway quickstart](https://zuplo.com/docs/mcp-gateway/quickstart).
