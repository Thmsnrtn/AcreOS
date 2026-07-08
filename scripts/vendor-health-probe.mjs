#!/usr/bin/env node
/**
 * Vendor credential health probe — run ON the Fly machine (where secrets live):
 *   fly ssh console -a acreos -C "node scripts/vendor-health-probe.mjs"
 *
 * For every customer-critical vendor: reports whether the secret is SET and,
 * where a FREE read-only auth-check endpoint exists, whether the credential
 * actually WORKS (live=OK/FAIL+status). Paid/metered data vendors (ATTOM,
 * Regrid, skip-trace, Voyage) get presence-only checks — no spend.
 *
 * SECURITY: no secret value is ever printed, hashed, or echoed — names and
 * HTTP status codes only.
 */

const timeoutFetch = async (url, init = {}, ms = 8000) => {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctl.signal });
  } finally {
    clearTimeout(t);
  }
};

const set = (name) => typeof process.env[name] === "string" && process.env[name].length > 0;
const firstSet = (...names) => names.find(set);

const results = [];
const record = (vendor, envVar, present, live, note = "") =>
  results.push({ vendor, envVar, present, live, note });

// ── Postgres ────────────────────────────────────────────────────────────────
try {
  if (!set("DATABASE_URL")) {
    record("Postgres", "DATABASE_URL", false, "SKIP");
  } else {
    const pg = await import("pg");
    const client = new pg.default.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 8000 });
    await client.connect();
    const r = await client.query("SELECT 1 AS ok");
    await client.end();
    record("Postgres", "DATABASE_URL", true, r.rows[0]?.ok === 1 ? "OK" : "FAIL");
  }
} catch (e) {
  record("Postgres", "DATABASE_URL", true, "FAIL", e.message.slice(0, 80));
}

// ── AWS SES ─────────────────────────────────────────────────────────────────
try {
  if (!set("AWS_ACCESS_KEY_ID") || !set("AWS_SECRET_ACCESS_KEY")) {
    record("AWS SES", "AWS_ACCESS_KEY_ID/SECRET", false, "SKIP");
  } else {
    const { SESv2Client, GetAccountCommand } = await import("@aws-sdk/client-sesv2");
    const c = new SESv2Client({ region: process.env.AWS_SES_REGION || "us-east-1" });
    const acct = await c.send(new GetAccountCommand({}));
    record("AWS SES", "AWS_ACCESS_KEY_ID", true, "OK",
      `prodAccess=${acct.ProductionAccessEnabled} sendingEnabled=${acct.SendingEnabled}`);
    c.destroy();
  }
} catch (e) {
  record("AWS SES", "AWS_ACCESS_KEY_ID", true, "FAIL", (e.name || e.message).slice(0, 60));
}

// ── HTTP-checkable vendors ──────────────────────────────────────────────────
const httpChecks = [
  {
    vendor: "Stripe", env: firstSet("STRIPE_SECRET_KEY"),
    req: () => ["https://api.stripe.com/v1/balance", { headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` } }],
  },
  {
    vendor: "Lob (direct mail)", env: firstSet("LOB_LIVE_API_KEY", "LOB_TEST_API_KEY", "LOB_API_KEY"),
    req: (name) => ["https://api.lob.com/v1/addresses?limit=1", { headers: { Authorization: `Basic ${Buffer.from(process.env[name] + ":").toString("base64")}` } }],
  },
  {
    vendor: "Twilio (SMS)", env: set("TWILIO_ACCOUNT_SID") && set("TWILIO_AUTH_TOKEN") ? "TWILIO_ACCOUNT_SID" : undefined,
    req: () => [
      `https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}.json`,
      { headers: { Authorization: `Basic ${Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64")}` } },
    ],
  },
  {
    vendor: "Anthropic (Pax)", env: firstSet("ANTHROPIC_API_KEY"),
    req: () => ["https://api.anthropic.com/v1/models", { headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" } }],
  },
  {
    vendor: "OpenAI", env: firstSet("OPENAI_API_KEY", "AI_INTEGRATIONS_OPENAI_API_KEY"),
    req: (name) => ["https://api.openai.com/v1/models", { headers: { Authorization: `Bearer ${process.env[name]}` } }],
  },
  {
    vendor: "OpenRouter", env: firstSet("OPENROUTER_API_KEY", "AI_INTEGRATIONS_OPENROUTER_API_KEY"),
    req: (name) => ["https://openrouter.ai/api/v1/key", { headers: { Authorization: `Bearer ${process.env[name]}` } }],
  },
  {
    vendor: "Mapbox (maps)", env: firstSet("VITE_MAPBOX_ACCESS_TOKEN", "VITE_MAPBOX_TOKEN", "MAPBOX_TOKEN", "MAPBOX_PUBLIC_TOKEN"),
    req: (name) => [`https://api.mapbox.com/tokens/v2?access_token=${encodeURIComponent(process.env[name])}`, {}],
  },
  {
    vendor: "SendGrid", env: firstSet("SENDGRID_API_KEY"),
    req: () => ["https://api.sendgrid.com/v3/scopes", { headers: { Authorization: `Bearer ${process.env.SENDGRID_API_KEY}` } }],
  },
  {
    vendor: "Clerk", env: firstSet("CLERK_SECRET_KEY"),
    req: () => ["https://api.clerk.com/v1/users?limit=1", { headers: { Authorization: `Bearer ${process.env.CLERK_SECRET_KEY}` } }],
  },
];

for (const check of httpChecks) {
  if (!check.env) {
    record(check.vendor, "(none)", false, "SKIP");
    continue;
  }
  try {
    const [url, init] = check.req(check.env);
    const res = await timeoutFetch(url, init);
    record(check.vendor, check.env, true, res.ok ? "OK" : "FAIL", `HTTP ${res.status}`);
  } catch (e) {
    record(check.vendor, check.env, true, "FAIL", e.message.slice(0, 80));
  }
}

// ── Presence-only (paid/metered or value-free checks) ──────────────────────
const presenceOnly = [
  ["Voyage (embeddings)", "VOYAGE_API_KEY"],
  ["ATTOM (property data)", "ATTOM_API_KEY"],
  ["Regrid (parcels)", "REGRID_API_KEY"],
  ["Zoneomics (zoning)", "ZONEOMICS_API_KEY"],
  ["BatchSkipTracing", "BATCH_SKIP_TRACING_API_KEY"],
  ["REISkip", "REISKIP_API_KEY"],
  ["Telnyx (SMS alt)", "TELNYX_API_KEY"],
  ["ElevenLabs (voice)", "ELEVENLABS_API_KEY"],
  ["Sentry (errors)", "SENTRY_DSN"],
  ["Redis", "REDIS_URL"],
  ["Stripe webhook secret", "STRIPE_WEBHOOK_SECRET"],
  ["Inbound email webhook secret", "INBOUND_EMAIL_WEBHOOK_SECRET"],
  ["Field encryption key", "FIELD_ENCRYPTION_KEY"],
  ["Google OAuth (email sync)", "GOOGLE_CLIENT_SECRET"],
  ["Microsoft OAuth (email sync)", "MICROSOFT_CLIENT_SECRET"],
  ["Meta (ads)", "META_ACCESS_TOKEN"],
  ["Cloudflare (DNS)", "CLOUDFLARE_API_TOKEN"],
];
for (const [vendor, name] of presenceOnly) {
  const alias =
    name === "CLOUDFLARE_API_TOKEN"
      ? firstSet("CLOUDFLARE_API_TOKEN", "CF_API_TOKEN", "CLOUDFLARE_TOKEN", "CF_TOKEN", "Cloudflare")
      : firstSet(name);
  record(vendor, alias ?? name, Boolean(alias), alias ? "SET" : "SKIP");
}

// ── Report ──────────────────────────────────────────────────────────────────
const pad = (s, n) => String(s).padEnd(n);
console.log("\n══ Vendor credential health ═══════════════════════════════════");
for (const r of results) {
  const flag = r.live === "OK" || r.live === "SET" ? "✓" : r.live === "SKIP" ? "·" : "✗";
  console.log(`  ${flag} ${pad(r.vendor, 30)} ${pad(r.envVar, 28)} ${pad(r.live, 5)} ${r.note}`);
}
const broken = results.filter((r) => r.live === "FAIL");
const missing = results.filter((r) => r.live === "SKIP");
console.log(`\n  ${results.length} vendors · ${broken.length} BROKEN · ${missing.length} not configured`);
if (broken.length) {
  console.log(`  BROKEN: ${broken.map((b) => b.vendor).join(", ")}`);
}
console.log("═══════════════════════════════════════════════════════════════\n");
