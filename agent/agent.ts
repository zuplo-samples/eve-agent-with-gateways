import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { defineAgent } from "eve";

// Route the model through a Zuplo AI Gateway (OpenAI-compatible) instead of the
// Vercel AI Gateway. The gateway holds the upstream provider key; the agent
// only carries the gateway's own key. Same containment as the MCP Gateway in
// connections/buffer.ts, applied to the model call.
const zuplo = createOpenAICompatible({
  name: "zuplo-ai-gateway",
  baseURL: process.env.ZUPLO_AI_GATEWAY_URL!, // https://<your-gateway>/v1
  apiKey: process.env.ZUPLO_AI_GATEWAY_KEY!,
});

export default defineAgent({
  model: zuplo.chatModel(process.env.ZUPLO_AI_MODEL ?? "anthropic/claude-opus-4.8"),
  // eve can't look up context-window metadata for a custom (non-Vercel-gateway)
  // model id, so compaction needs this hint. Claude Opus 4.8 is 200k tokens.
  modelContextWindowTokens: 200_000,
});
