// Preload for the market cohort's production build (node --require):
//   1. redirects global fetch() to api.twilio.com / api.lob.com / api.sendgrid.com onto the local
//      provider stand-in (provider-standin.mjs), so a real send path runs end to
//      end without reaching a real provider;
//   2. records every OTHER outbound host the app tries to reach (count only,
//      never the payload) to $PROVIDER_DIR/outbound-hosts.jsonl — the list of
//      third parties a live deploy would call, and so would pay for.
// It patches nothing in the app; it is the network, not the product.
const fs = require("node:fs");
const path = require("node:path");
const PORT = Number(process.env.PROVIDER_PORT || 7831);
const DIR = process.env.PROVIDER_DIR || "/tmp";
const MAP = { "api.twilio.com": "twilio", "api.lob.com": "lob", "api.sendgrid.com": "sendgrid", "api.stripe.com": "stripe", "graph.facebook.com": "meta" };
// Model hosts some code paths reach without honouring a *_BASE_URL env: sent to the
// MODEL stand-in (never a real provider). Counted in outbound-hosts.jsonl as "redirected".
const STANDIN_PORT = Number(process.env.STANDIN_PORT || 7830);
const MODEL_HOSTS = new Set(["api.openai.com", "api.anthropic.com", "openrouter.ai"]);
const LOCAL = new Set(["127.0.0.1", "localhost", "::1"]);
const orig = globalThis.fetch;
globalThis.fetch = function patchedFetch(input, init) {
  let href;
  try { href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url; } catch { href = null; }
  if (href) {
    try {
      const u = new URL(href);
      const tag = MAP[u.hostname];
      if (tag) {
        const to = `http://127.0.0.1:${PORT}/${tag}${u.pathname}${u.search}`;
        if (typeof input !== "string" && !(input instanceof URL)) return orig(new Request(to, input), init);
        return orig(to, init);
      }
      if (MODEL_HOSTS.has(u.hostname)) {
        try { fs.appendFileSync(path.join(DIR, "outbound-hosts.jsonl"), JSON.stringify({ ts: new Date().toISOString(), host: u.hostname, path: u.pathname.slice(0, 80), redirected: "model-standin" }) + "\n"); } catch {}
        const to = `http://127.0.0.1:${STANDIN_PORT}${u.pathname.replace(/^\/api(?=\/v1)/, "")}${u.search}`;
        if (typeof input !== "string" && !(input instanceof URL)) return orig(new Request(to, input), init);
        return orig(to, init);
      }
      if (!LOCAL.has(u.hostname)) {
        try { fs.appendFileSync(path.join(DIR, "outbound-hosts.jsonl"), JSON.stringify({ ts: new Date().toISOString(), host: u.hostname, path: u.pathname.slice(0, 80) }) + "\n"); } catch {}
      }
    } catch {}
  }
  return orig(input, init);
};
