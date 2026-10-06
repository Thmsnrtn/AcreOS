/**
 * Part B (chat) — three plain-English founder requests through Solene chat
 * (/api/founder/solene-chat/*) and the deterministic steer box
 * (/api/founder/autopilot/steer), model stand-in in `script` mode.
 *
 * Script mode answers are content-free by construction: this measures the
 * PLUMBING (which model/tools the request reached, what the turn streamed,
 * whether any business state changed), never the quality of the words.
 *
 *   run-harness.sh tests/simulation/campaign/founder/b-chat.ts
 */
import * as k from "./simkit";

const REQUESTS = ["get me my first customer", "what should I do today?", "stop spending money on ads"];

async function stateFingerprint() {
  return {
    settings: await k.q("select key, value from autopilot_settings order by key").catch(() => []),
    levels: await k.q("select domain, level from domain_autonomy_levels order by domain"),
    standingOrders: (await k.q1<any>("select count(*)::int n from autopilot_standing_orders").catch(() => ({ n: -1 })))?.n,
    dispatches: (await k.q1<any>("select count(*)::int n from solene_dispatch_queue"))?.n,
    asks: (await k.q1<any>("select count(*)::int n from solene_founder_asks"))?.n,
    pendingHands: (await k.q1<any>("select count(*)::int n from autopilot_pending_actions").catch(() => ({ n: -1 })))?.n,
  };
}

async function main() {
  k.setStandinRules({ default: "script" });
  const out: any[] = [];
  for (const text of REQUESTS) {
    const before = await stateFingerprint();
    const m = k.marks();
    const conv = await k.founder.post("/api/founder/solene-chat/conversations", { startedSurface: "acreos", title: text });
    const id = conv.body?.conversationId;
    const t0 = Date.now();
    const r = await fetch(`${process.env.SIM_BASE_URL}/api/founder/solene-chat/conversations/${id}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `__session=e2e-founder; csrf_token=${k.founder.csrf}`, "x-csrf-token": k.founder.csrf },
      body: JSON.stringify({ userMessage: [{ type: "text", text }] }),
    });
    const sse = await r.text();
    const events = [...sse.matchAll(/^event: (.+)$/gm)].map((x) => x[1]);
    const textOut = [...sse.matchAll(/^data: (.+)$/gm)].map((x) => { try { return JSON.parse(x[1]); } catch { return null; } }).filter(Boolean)
      .map((d: any) => d.text ?? d.delta ?? d.content ?? "").filter((s: any) => typeof s === "string").join("").slice(0, 400);
    const steer = await k.founder.post("/api/founder/autopilot/steer", { text });
    const after = await stateFingerprint();
    const calls = m.since().modelCalls;
    out.push({
      text, conversation: { status: conv.status, id }, http: r.status, ms: Date.now() - t0,
      eventTypes: events.reduce((a: Record<string, number>, e) => ((a[e] = (a[e] ?? 0) + 1), a), {}),
      textOut,
      modelCalls: calls.map((c: any) => ({ model: c.model, mode: c.mode, tools: (c.tools ?? []).length, toolNames: (c.tools ?? []).slice(0, 40), caller: (c.caller ?? "").slice(0, 120) })),
      steer: { status: steer.status, body: steer.text.slice(0, 600) },
      stateChanged: JSON.stringify(before) !== JSON.stringify(after) ? { before, after } : false,
    });
    console.log(`  "${text}": chat ${r.status} events=${JSON.stringify(out[out.length - 1].eventTypes)} model calls=${calls.length}; steer ${steer.status} ${steer.text.slice(0, 200)}`);
  }
  k.saveJson("b-chat.json", out);
  await k.shutdown();
}
main().catch((e) => { console.error(e); process.exit(1); });
