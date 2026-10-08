#!/usr/bin/env node
// A local stand-in for the THIRD-PARTY rails the market cohort drives:
//
//   AWS (SES Query API)  — reached via AWS_ENDPOINT_URL=http://127.0.0.1:<port>
//   Twilio REST          — reached via the fetch-redirect preload (/twilio/...)
//   Lob REST             — reached via LOB_HOST=http://127.0.0.1:<port>/lob/v1/
//   SendGrid v3          — reached via the fetch-redirect preload (/sendgrid/...)
//
// Nothing here is a real provider and nothing leaves the machine. Every request
// is appended to $PROVIDER_DIR/provider-calls.jsonl with the full message
// (recipient, body, headers) so the harness can audit what the product WOULD
// have sent: to whom, with what unsubscribe footer, at what local time.
//
// Answers are structurally valid and deterministic. Behaviour can be steered
// per recipient through $PROVIDER_DIR/provider-rules.json (re-read per call):
//   { "bounce": ["addr@x"], "complaint": ["addr@y"], "smsFail": ["+1520..."] }
// A "bounce" address makes SES answer MessageRejected; the bounce NOTIFICATION
// itself is not produced here (it arrives via SNS in production — see README).
//
// Real failure modes (driven by the market twin, tests/simulation/twin/providers.ts):
//   "smsCodes":   { "+1520...": 30007 }  Twilio error per recipient — 21610
//                 unsubscribed, 30003 unreachable, 30005 unknown, 30006
//                 landline, 30007 carrier-filtered, 30034 unregistered 10DLC;
//   "a2pUnregistered": ["+1520..."]      sender numbers whose traffic is blocked (30034);
//   "lobReject":  ["101 N Main St"]      recipient address lines Lob refuses (422);
//   "sesThrottleEvery": 50               every Nth SES send answers Throttling;
//   "sesDown": true                      SES answers 503 ServiceUnavailable (an outage);
//   "stripeDecline": ["cus_..."]         Stripe customers whose charge is declined;
//   "metaReject": true                   Meta ad creation answers an ad-review rejection.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const PORT = Number(process.env.PROVIDER_PORT || 7831);
const DIR = process.env.PROVIDER_DIR || path.resolve("provider-standin");
fs.mkdirSync(DIR, { recursive: true });
const LOG = path.join(DIR, "provider-calls.jsonl");
const log = (o) => fs.appendFileSync(LOG, JSON.stringify({ ts: new Date().toISOString(), ...o }) + "\n");
const rules = () => { try { return JSON.parse(fs.readFileSync(path.join(DIR, "provider-rules.json"), "utf8")); } catch { return {}; } };
const id = (p) => p + crypto.randomBytes(8).toString("hex");
// Nothing a caller sent is reflected unescaped.
const esc = (v) => String(v ?? "").replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]);

function xml(res, status, action, inner) {
  res.writeHead(status, { "content-type": "text/xml" });
  res.end(`<${action}Response xmlns="http://ses.amazonaws.com/doc/2010-12-01/">${inner}<ResponseMetadata><RequestId>${id("r")}</RequestId></ResponseMetadata></${action}Response>`);
}
function sesError(res, code, message) {
  res.writeHead(400, { "content-type": "text/xml" });
  res.end(`<ErrorResponse xmlns="http://ses.amazonaws.com/doc/2010-12-01/"><Error><Type>Sender</Type><Code>${esc(code)}</Code><Message>${esc(message)}</Message></Error><RequestId>${id("r")}</RequestId></ErrorResponse>`);
}
const TWILIO_MESSAGES = {
  21610: "Attempt to send to unsubscribed recipient",
  30003: "Unreachable destination handset",
  30005: "Unknown destination handset",
  30006: "Landline or unreachable carrier",
  30007: "Message filtered by carrier",
  30034: "Message from an unregistered number (A2P 10DLC)",
};
let sesCount = 0;
function json(res, status, o) { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(o)); }

function parseRaw(b64) {
  const raw = Buffer.from(b64, "base64").toString("utf8");
  const [head, ...rest] = raw.split(/\r?\n\r?\n/);
  const headers = {};
  for (const line of head.replace(/\r?\n[ \t]+/g, " ").split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i > 0) headers[line.slice(0, i).toLowerCase()] = line.slice(i + 1).trim();
  }
  return { headers, body: rest.join("\n\n"), raw };
}

http.createServer(async (req, res) => {
  let raw = "";
  req.on("data", (c) => { raw += c; });
  await new Promise((r) => req.on("end", r));
  const url = new URL(req.url || "/", "http://x");
  const p = url.pathname;
  const r = rules();

  // ── Twilio ──
  if (p.startsWith("/twilio/")) {
    const form = Object.fromEntries(new URLSearchParams(raw));
    if (/\/Messages\.json$/.test(p) && req.method === "POST") {
      const fail = (r.smsFail || []).includes(form.To);
      const blocked = (r.a2pUnregistered || []).includes(form.From);
      const code = blocked ? 30034 : (r.smsCodes || {})[form.To] ?? (fail ? 21610 : null);
      log({ rail: "twilio", op: "message", to: form.To, from: form.From, body: form.Body, fail: code != null, code });
      if (code != null) return json(res, 400, { code, message: TWILIO_MESSAGES[code] ?? "Message failed", status: 400, more_info: `https://www.twilio.com/docs/errors/${code}` });
      return json(res, 201, { sid: id("SM"), status: "queued", to: form.To, from: form.From, body: form.Body, price: null, num_segments: String(Math.max(1, Math.ceil((form.Body || "").length / 153))) });
    }
    log({ rail: "twilio", op: req.method + " " + p });
    return json(res, 200, { sid: "AC" + "0".repeat(32), status: "active", accounts: [] });
  }
  // ── SendGrid (v3 mail/send) ──
  if (p.startsWith("/sendgrid/")) {
    let body = {};
    try { body = JSON.parse(raw || "{}"); } catch {}
    const html = (body.content ?? []).map((c) => c.value).join("\n");
    for (const pz of body.personalizations ?? [{}]) {
      const to = (pz.to ?? []).map((t) => t.email);
      const r0 = rules();
      const bounced = to.some((t) => (r0.bounce ?? []).includes(t));
      log({ rail: "sendgrid", op: req.method + " " + p.replace(/^\/sendgrid/, ""), from: body.from?.email ?? null, to, subject: pz.subject ?? body.subject ?? null, headers: { ...(body.headers ?? {}), ...(pz.headers ?? {}) }, hasUnsubLink: /unsubscribe|opt.?out/i.test(html), hasPostalAddress: /\b\d{5}(-\d{4})?\b/.test(html.replace(/<[^>]+>/g, " ")), fail: bounced });
    }
    if (req.method === "POST") { res.writeHead(202, { "x-message-id": id("sg") }); return res.end(); }
    return json(res, 200, {});
  }
  // ── Lob ──
  if (p.startsWith("/lob/")) {
    let body = {};
    try { body = raw ? JSON.parse(raw) : Object.fromEntries(new URLSearchParams(raw)); } catch { body = Object.fromEntries(new URLSearchParams(raw)); }
    const kind = p.split("/")[3] || "?";
    const line1 = body.to?.address_line1 ?? body["to[address_line1]"] ?? null;
    if (req.method === "POST" && line1 && (r.lobReject || []).includes(String(line1))) {
      log({ rail: "lob", op: req.method + " " + kind, toAddress: line1, rejected: true });
      return json(res, 422, { error: { message: "address is undeliverable", status_code: 422, code: "failed_deliverability_strictness" } });
    }
    log({ rail: "lob", op: req.method + " " + kind, to: body.to?.name ?? body["to[name]"] ?? null, toAddress: body.to?.address_line1 ?? body["to[address_line1]"] ?? null, toCity: body.to?.address_city ?? body["to[address_city]"] ?? null, toZip: body.to?.address_zip ?? body["to[address_zip]"] ?? null, fromName: body.from?.company ?? body.from?.name ?? body["from[company]"] ?? body["from[name]"] ?? null, backHasOptOut: /stop|opt.?out|unsubscribe|remove/i.test(String(body.back ?? body.file ?? "")) });
    if (req.method === "POST") return json(res, 200, { id: (kind === "letters" ? "ltr_" : "psc_") + crypto.randomBytes(8).toString("hex"), object: kind.replace(/s$/, ""), expected_delivery_date: new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10), price: kind === "letters" ? "1.20" : "0.75", url: "http://127.0.0.1/lob-proof.pdf" });
    return json(res, 200, { data: [], object: "list", count: 0 });
  }
  // ── Stripe (form-encoded REST) ──
  if (p.startsWith("/stripe/")) {
    const form = Object.fromEntries(new URLSearchParams(raw));
    const declined = form.customer && (r.stripeDecline || []).includes(form.customer);
    log({ rail: "stripe", op: req.method + " " + p.replace(/^\/stripe/, ""), customer: form.customer ?? null, amount: form.amount ?? null, account: req.headers["stripe-account"] ?? null, declined: !!declined });
    if (declined) return json(res, 402, { error: { type: "card_error", code: "card_declined", decline_code: "insufficient_funds", message: "Your card has insufficient funds." } });
    return json(res, 200, { id: id(p.includes("refund") ? "re_" : "ch_"), object: p.includes("refund") ? "refund" : "charge", status: "succeeded", amount: Number(form.amount ?? 0) });
  }
  // ── Meta Graph (ads) ──
  if (p.startsWith("/meta/")) {
    log({ rail: "meta", op: req.method + " " + p.replace(/^\/meta/, ""), rejected: !!r.metaReject });
    if (r.metaReject && req.method === "POST") return json(res, 400, { error: { message: "Ad rejected: does not comply with advertising policies", type: "OAuthException", code: 1487390, error_subcode: 1487390 } });
    return json(res, 200, { id: id("act_") });
  }
  // ── AWS Query protocol (SES v1) ──
  const form = Object.fromEntries(new URLSearchParams(raw));
  const action = form.Action || url.searchParams.get("Action");
  if (action === "SendRawEmail" || action === "SendEmail") {
    let to = [], subject = null, headers = {}, html = null, from = form.Source || null;
    if (action === "SendRawEmail") {
      const m = parseRaw(form["RawMessage.Data"] || "");
      headers = m.headers;
      subject = m.headers.subject ?? null;
      from = from || m.headers.from || null;
      to = Object.entries(form).filter(([k]) => /^Destinations\.member\.\d+$/.test(k)).map(([, v]) => v);
      if (!to.length && m.headers.to) to = m.headers.to.split(",").map((s) => s.trim());
      html = m.body;
    } else {
      to = Object.entries(form).filter(([k]) => /^Destination\.(To|Cc|Bcc)Addresses\.member\.\d+$/.test(k)).map(([, v]) => v);
      subject = form["Message.Subject.Data"] ?? null;
      html = form["Message.Body.Html.Data"] ?? form["Message.Body.Text.Data"] ?? null;
      for (const [k, v] of Object.entries(form)) if (/^ReplyToAddresses/.test(k)) headers["reply-to"] = v;
    }
    const bounced = to.some((t) => (r.bounce || []).includes(t.replace(/.*</, "").replace(/>.*/, "")));
    sesCount++;
    if (r.sesDown) {
      log({ rail: "ses", op: action, from, to, subject, down: true });
      res.writeHead(503, { "content-type": "text/xml" });
      return res.end(`<ErrorResponse><Error><Type>Receiver</Type><Code>ServiceUnavailable</Code><Message>Service unavailable (stand-in outage)</Message></Error><RequestId>${id("r")}</RequestId></ErrorResponse>`);
    }
    if (r.sesThrottleEvery && sesCount % Number(r.sesThrottleEvery) === 0) {
      log({ rail: "ses", op: action, from, to, subject, throttled: true });
      res.writeHead(400, { "content-type": "text/xml" });
      return res.end(`<ErrorResponse><Error><Type>Sender</Type><Code>Throttling</Code><Message>Maximum sending rate exceeded.</Message></Error><RequestId>${id("r")}</RequestId></ErrorResponse>`);
    }
    log({ rail: "ses", op: action, from, to, subject, headers, html: (html || "").slice(0, 20000), bounced });
    if (bounced) return sesError(res, "MessageRejected", "Address blacklisted (stand-in bounce)");
    return xml(res, 200, action, `<${action}Result><MessageId>${id("ses-")}</MessageId></${action}Result>`);
  }
  if (action === "GetSendQuota") return xml(res, 200, action, `<GetSendQuotaResult><Max24HourSend>50000</Max24HourSend><MaxSendRate>14</MaxSendRate><SentLast24Hours>0</SentLast24Hours></GetSendQuotaResult>`);
  if (action === "GetIdentityVerificationAttributes") return xml(res, 200, action, `<GetIdentityVerificationAttributesResult><VerificationAttributes/></GetIdentityVerificationAttributesResult>`);
  log({ rail: "aws-other", op: req.method + " " + p, action: action ?? null });
  res.writeHead(404, { "content-type": "text/xml" });
  res.end(`<Error><Code>NotImplementedByStandin</Code><Message>${esc(action ?? p)}</Message></Error>`);
}).listen(PORT, "127.0.0.1", () => console.log(`provider stand-in on :${PORT}, dir ${DIR}`));
