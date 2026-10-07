/**
 * World shim — loaded into the AcreOS web / worker / harness processes with
 * `node --import <this file>` for the founder-side simulation ONLY. It modifies
 * no AcreOS source; it stands in for the outside world at the process's
 * network edge.
 *
 *  1. Clerk stand-in. /api/founder/* is mounted behind requireClerkMFA
 *     (server/routes.ts:827), which calls clerkClient.users.getUser() on every
 *     request (server/middleware/requireClerkMFA.ts:168). Offline that throws
 *     and the founder gets 403 "mfa_required". This answers GET
 *     api.clerk.com/v1/users/:id with a user who has NOT enrolled 2FA — the
 *     matrix's documented pass-through for non-high-trust routes.
 *
 *  2. Egress ledger + firewall. Every non-local HTTP(S) request the app makes
 *     (global fetch AND node:http/https.request — the AWS SDK, Stripe SDK and
 *     axios use the latter) is appended to $WORLD_EGRESS_LOG. Nothing ever
 *     leaves the machine. Per host substring, $WORLD_EGRESS_RULES (JSON, re-read
 *     per request) chooses how the "world" answers:
 *        "refuse"      network unreachable (ECONNREFUSED / fetch failed) — DEFAULT
 *        "fail:<n>"    the provider answers HTTP <n>
 *        "hang"        the provider never answers
 *        "mock"        the provider is UP: a local TLS mock (cert from a sim-only
 *                      CA passed via NODE_EXTRA_CA_CERTS) answers with a minimal
 *                      success body for that provider (SES, Twilio, generic {}).
 *     The ledger records method, path and a body preview, which is how the sim
 *     proves whether a customer or provider would have been reached.
 */
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import crypto from "node:crypto";

const LOG = process.env.WORLD_EGRESS_LOG || "/tmp/world-egress.jsonl";
const RULES = process.env.WORLD_EGRESS_RULES || "";
const ROLE = process.env.WORLD_ROLE || "app";
const CERT_DIR = process.env.WORLD_CERT_DIR || "";

const isLocal = (host) => /^(localhost|127\.0\.0\.1|::1|\[::1\])$/.test(String(host || "").replace(/:\d+$/, ""));
function rules() {
  if (!RULES) return {};
  try { return JSON.parse(fs.readFileSync(RULES, "utf8")); } catch { return {}; }
}
function modeFor(host) {
  for (const [k, v] of Object.entries(rules())) if (String(host).includes(k)) return v;
  return "refuse";
}
function record(o) {
  try { fs.appendFileSync(LOG, JSON.stringify({ ts: new Date().toISOString(), role: ROLE, pid: process.pid, ...o }) + "\n"); } catch { /* best effort */ }
}

function clerkUser(id) {
  return {
    object: "user", id, two_factor_enabled: false, totp_enabled: false, backup_code_enabled: false,
    password_enabled: false, banned: false, locked: false, created_at: 0, updated_at: 0,
    image_url: "", has_image: false, primary_email_address_id: null, email_addresses: [],
    phone_numbers: [], web3_wallets: [], external_accounts: [], enterprise_accounts: [],
    first_name: null, last_name: null, public_metadata: {}, private_metadata: {}, unsafe_metadata: {},
  };
}

// ── provider mock bodies (success shapes only — enough for the SDK to parse) ──
function mockAnswer(host, path, body) {
  const id = crypto.randomBytes(8).toString("hex");
  if (/amazonaws\.com$/.test(host) && /Action=SendRawEmail/.test(body)) {
    return { status: 200, type: "text/xml", body: `<SendRawEmailResponse xmlns="http://ses.amazonaws.com/doc/2010-12-01/"><SendRawEmailResult><MessageId>sim-${id}</MessageId></SendRawEmailResult><ResponseMetadata><RequestId>${id}</RequestId></ResponseMetadata></SendRawEmailResponse>` };
  }
  if (/amazonaws\.com$/.test(host) && /Action=SendEmail/.test(body)) {
    return { status: 200, type: "text/xml", body: `<SendEmailResponse xmlns="http://ses.amazonaws.com/doc/2010-12-01/"><SendEmailResult><MessageId>sim-${id}</MessageId></SendEmailResult><ResponseMetadata><RequestId>${id}</RequestId></ResponseMetadata></SendEmailResponse>` };
  }
  if (/amazonaws\.com$/.test(host) && /Action=GetSendQuota/.test(body)) {
    return { status: 200, type: "text/xml", body: `<GetSendQuotaResponse xmlns="http://ses.amazonaws.com/doc/2010-12-01/"><GetSendQuotaResult><Max24HourSend>50000</Max24HourSend><MaxSendRate>14</MaxSendRate><SentLast24Hours>0</SentLast24Hours></GetSendQuotaResult><ResponseMetadata><RequestId>${id}</RequestId></ResponseMetadata></GetSendQuotaResponse>` };
  }
  // Stripe UP (Stage 2): the two calls the founder sims reach — a refund the
  // Support worker drafts and a founder/grant witnesses, and the ops watch's
  // balance probe — answered in Stripe's shape so the SDK parses them.
  if (/stripe\.com$/.test(host) && /\/v1\/refunds/.test(path)) {
    const amount = Number(/(?:^|&)amount=(\d+)/.exec(body)?.[1] ?? 0);
    return { status: 200, type: "application/json", body: JSON.stringify({ id: "re_sim_" + id, object: "refund", amount, status: "succeeded", currency: "usd" }) };
  }
  if (/stripe\.com$/.test(host) && /\/v1\/balance/.test(path)) {
    return { status: 200, type: "application/json", body: JSON.stringify({ object: "balance", available: [{ amount: 0, currency: "usd" }], pending: [], livemode: false }) };
  }
  if (/twilio\.com$/.test(host)) {
    return { status: 201, type: "application/json", body: JSON.stringify({ sid: "SMsim" + id, status: "queued", error_code: null }) };
  }
  return { status: 200, type: "application/json", body: "{}" };
}

let mockPort = null;
let mockReady = null;
function ensureMock() {
  if (mockReady) return mockReady;
  mockReady = new Promise((resolve, reject) => {
    if (!CERT_DIR) return reject(new Error("WORLD_CERT_DIR not set — mock mode unavailable"));
    const srv = https.createServer(
      { key: fs.readFileSync(CERT_DIR + "/leaf.key"), cert: fs.readFileSync(CERT_DIR + "/leaf.pem") },
      (req, res) => {
        let raw = "";
        req.on("data", (c) => { raw += c; });
        req.on("end", () => {
          const host = req.headers["x-sim-original-host"] || req.headers.host || "";
          let preview = raw;
          try { preview = decodeURIComponent(raw.replace(/\+/g, " ")); } catch { /* keep raw */ }
          // SES SendRawEmail carries base64 MIME — decode headers for the ledger.
          const m = /RawMessage\.Data=([^&]+)/.exec(raw);
          if (m) { try { preview = Buffer.from(decodeURIComponent(m[1]), "base64").toString("utf8"); } catch { /* keep */ } }
          // stripeAccount: the connected account a Stripe call ran on (absent = the platform account).
          record({ via: "mock-provider", host, path: req.url, method: req.method, outcome: "mock-200", stripeAccount: req.headers["stripe-account"] ?? null, bodyPreview: preview.slice(0, 2500) });
          const a = mockAnswer(host, req.url, raw);
          res.writeHead(a.status, { "content-type": a.type });
          res.end(a.body);
        });
      },
    );
    srv.listen(0, "127.0.0.1", () => { mockPort = srv.address().port; srv.unref(); resolve(mockPort); });
    srv.on("error", reject);
  });
  return mockReady;
}
if (CERT_DIR) ensureMock().catch(() => {});

const realFetch = globalThis.fetch;
globalThis.fetch = async function shimFetch(input, init) {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  if (isLocal(url.hostname)) return realFetch(input, init);
  if (url.hostname === "api.clerk.com") {
    const m = /\/v1\/users\/([^/?]+)$/.exec(url.pathname);
    if (m && (init?.method ?? "GET").toUpperCase() === "GET") {
      return new Response(JSON.stringify(clerkUser(decodeURIComponent(m[1]))), { status: 200, headers: { "content-type": "application/json" } });
    }
    record({ via: "fetch", host: url.hostname, path: url.pathname, method: init?.method ?? "GET", outcome: "clerk-unstubbed-404" });
    return new Response(JSON.stringify({ errors: [{ code: "resource_not_found", message: "sim" }] }), { status: 404, headers: { "content-type": "application/json" } });
  }
  const mode = modeFor(url.hostname);
  let bodyPreview = null;
  try { if (typeof init?.body === "string") bodyPreview = init.body.slice(0, 2500); } catch { /* ignore */ }
  let title = null;
  try { const h = init?.headers; title = h ? (typeof h.get === "function" ? h.get("Title") : (h.Title ?? h.title ?? null)) : null; } catch { /* ignore */ }
  record({ via: "fetch", host: url.hostname, path: url.pathname, method: init?.method ?? "GET", outcome: mode, title, bodyPreview });
  if (mode === "ok" || mode === "mock") {
    const a = mockAnswer(url.hostname, url.pathname, bodyPreview ?? "");
    return new Response(a.body, { status: a.status, headers: { "content-type": a.type } });
  }
  if (mode.startsWith("fail:")) return new Response(JSON.stringify({ error: { message: "sim provider failure" } }), { status: Number(mode.slice(5)) || 503, headers: { "content-type": "application/json" } });
  if (mode === "hang") return new Promise(() => {});
  throw new TypeError(`fetch failed (sim egress refused: ${url.hostname})`);
};

function wrap(mod, proto) {
  const orig = mod.request;
  function parse(a, b) {
    // request(url[, options][, cb]) | request(options[, cb])
    let opts = {};
    let cb;
    if (typeof a === "string" || a instanceof URL) {
      const u = new URL(String(a));
      opts = { protocol: u.protocol, hostname: u.hostname, port: u.port, path: u.pathname + u.search };
      if (b && typeof b === "object") opts = { ...opts, ...b };
    } else opts = { ...(a || {}) };
    cb = [a, b, arguments[2]].find((x) => typeof x === "function");
    return { opts, cb };
  }
  mod.request = function shimRequest(a, b, c) {
    const { opts, cb } = parse(a, b, c);
    const host = String(opts.hostname || opts.host || "").replace(/:\d+$/, "");
    if (!host || isLocal(host)) return orig.apply(mod, arguments);
    const mode = modeFor(host);
    if (mode === "mock" && proto === "https" && mockPort) {
      record({ via: proto, host, path: opts.path, method: opts.method || "GET", outcome: "mock" });
      const headers = { ...(opts.headers || {}), "x-sim-original-host": host };
      return orig.call(mod, { ...opts, host: "127.0.0.1", hostname: "127.0.0.1", port: mockPort, servername: host, headers, agent: false }, cb);
    }
    record({ via: proto, host, path: opts.path, method: opts.method || "GET", outcome: mode === "mock" ? "refuse(mock-unready)" : mode });
    if (mode === "hang") {
      // Connect to a local listener that never answers.
      return orig.call(mod, { host: "127.0.0.1", port: hangPort(), method: "GET", path: "/" }, cb);
    }
    // Closed local port: the caller sees a real ECONNREFUSED, exactly as when
    // the provider's network is unreachable. (fail:<n> on raw http degrades to
    // refuse — the SDK sees a transport failure either way.)
    return orig.call(mod, { host: "127.0.0.1", port: 1, method: "GET", path: "/" }, cb);
  };
  mod.get = function shimGet(a, b, c) {
    const req = mod.request(a, b, c);
    req.end();
    return req;
  };
}
let _hang = 1;
{
  const s = http.createServer(() => { /* never answer */ });
  s.listen(0, "127.0.0.1", () => { _hang = s.address().port; });
  s.unref();
}
function hangPort() {
  return _hang;
}
wrap(http, "http");
wrap(https, "https");
record({ via: "boot", host: "-", outcome: "shim-loaded" });
