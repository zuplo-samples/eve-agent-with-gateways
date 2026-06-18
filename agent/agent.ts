import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { defineAgent } from "eve";

// Route the model through a Zuplo AI Gateway (OpenAI-compatible) instead of the
// Vercel AI Gateway. The gateway holds the upstream provider key; the agent
// only carries the gateway's own key. Same containment as the MCP Gateway in
// connections/buffer.ts, applied to the model call.
const zuplo = createOpenAICompatible({
  name: "zuplo-ai-gateway",
  baseURL: process.env.ZUPLO_AI_GATEWAY_URL!,
  apiKey: process.env.ZUPLO_AI_GATEWAY_KEY!,
});

export default defineAgent({
  model: zuplo.chatModel(process.env.ZUPLO_AI_MODEL),
  modelContextWindowTokens: 200_000,
});
