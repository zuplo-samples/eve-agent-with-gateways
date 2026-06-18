// Fire the weekly-metrics schedule off-cadence and stream its summary to the
// terminal — the demo path for the scheduled digest. Reuses the schedule's own
// prompt (single source of truth) via Eve's dev-only dispatch route, so start
// the dev server first:
//
//   npm run dev          # terminal 1
//   npm run digest       # terminal 2
//
// The dispatch route is mounted only by `eve dev`; production fires the cron.

const BASE = process.env.EVE_BASE_URL ?? "http://127.0.0.1:3000";
const SCHEDULE = "weekly-metrics";

const dispatch = await fetch(`${BASE}/eve/v1/dev/schedules/${SCHEDULE}`, { method: "POST" });
if (!dispatch.ok) {
  console.error(`Dispatch failed: ${dispatch.status} ${await dispatch.text()}`);
  console.error(`Is \`npm run dev\` running on ${BASE}?`);
  process.exit(1);
}

const sessionId = (await dispatch.json()).sessionIds?.[0];
if (!sessionId) {
  console.error("Dispatch returned no session id.");
  process.exit(1);
}
console.log(`Dispatched ${SCHEDULE} → session ${sessionId}\n`);

const stream = await fetch(`${BASE}/eve/v1/session/${sessionId}/stream`);
if (!stream.ok || !stream.body) {
  console.error(`Stream failed: ${stream.status}`);
  process.exit(1);
}

// Pull text out of whatever shape the event carries. eve sends `message` as a
// plain string on message.completed; keep the object/array fallbacks too.
function textOf(d: Record<string, unknown>): string {
  const m = d.message;
  if (typeof m === "string") return m;
  const c = (m as { content?: unknown })?.content ?? d.content ?? d.text ?? d.delta;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.map((x) => (typeof x === "string" ? x : ((x as { text?: string })?.text ?? ""))).join("");
  return "";
}

// A real tool failure, not a benign `error: null` / `isError: false` field.
function isErr(out: unknown): boolean {
  if (out == null) return false;
  if (typeof out === "string") return /^Error:/i.test(out);
  if (Array.isArray(out)) return out.some(isErr);
  if (typeof out === "object") {
    const o = out as { isError?: unknown; error?: unknown };
    return o.isError === true || (typeof o.error === "string" && o.error.length > 0);
  }
  return false;
}

let buf = "";
for await (const chunk of stream.body as AsyncIterable<Uint8Array>) {
  buf += Buffer.from(chunk).toString("utf8");
  let nl: number;
  while ((nl = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;

    let ev: { type?: string; event?: string; data?: Record<string, unknown> };
    try {
      ev = JSON.parse(line);
    } catch {
      continue;
    }
    const type = ev.type ?? ev.event ?? "";
    const d = ev.data ?? {};

    if (type === "actions.requested") {
      for (const a of (d.actions as Array<{ toolName?: string }>) ?? []) {
        if (a.toolName) console.log(`  · calling ${a.toolName}`);
      }
    } else if (type === "action.result") {
      const r = d.result as { toolName?: string; output?: unknown } | undefined;
      console.log(`  · result  ${r?.toolName ?? "?"}${isErr(r?.output) ? " (error)" : ""}`);
    } else if (type === "message.completed") {
      const text = textOf(d).trim();
      if (!text) continue;
      // finishReason "stop" is the model's final answer; anything else is an
      // intermediate note between tool calls.
      if (d.finishReason === "stop") console.log(`\n=== weekly summary ===\n${text}\n`);
      else console.log(`  · ${text}`);
    } else if (type === "session.completed") {
      process.exit(0);
    } else if (type === "turn.failed" || type === "session.failed") {
      console.error("Failed:", JSON.stringify(d));
      process.exit(1);
    }
  }
}
