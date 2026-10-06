/**
 * DELIVERABILITY LOOP — does every opt-out signal a seller can give stop every
 * later send, on every channel?
 *
 *   signal                         → expected effect                → later sends counted
 *   SMS "STOP" (exact keyword)     → lead DNC, consent revoked      → SMS, email, mail, sequence
 *   SMS "Please stop texting me"   → (FCC 2024: any reasonable means)
 *   email hard bounce (SendGrid)   → address suppressed
 *   email complaint  (SendGrid)    → address suppressed (+ DNC?)
 *   List-Unsubscribe one-click     → address suppressed / DNC
 *   customer marks lead DNC (UI)   → CONTROL: every gate must honour this one
 *
 * Inbound signals are delivered through the app's REAL intake routes, correctly
 * signed with the secrets of THIS local build:
 *   - Twilio inbound SMS: signed twice — with the CUSTOMER's auth token (what
 *     Twilio actually does for a number on the customer's own account, i.e.
 *     every number under the BYO rule) and with the platform TWILIO_AUTH_TOKEN.
 *   - SendGrid event webhook: Ed25519 over (timestamp + raw body) with a key
 *     pair generated for this run; the public half is configured on the local
 *     build as SENDGRID_EVENT_WEBHOOK_PUBLIC_KEY (sim env, not a product change).
 *   - SES/SNS bounce path: NOT driven (SNS signatures need AWS's signing cert) —
 *     recorded as a gap.
 *
 * POSITIVE CONTROLS (vacuity guards): L0 (no opt-out) must be reached on every
 * channel after the opt-outs, or that channel's violation count is "not
 * measurable", never 0. A legacy-configured org (POST /api/sms/config) is the
 * control for the inbound-SMS detector: its platform-signed STOP must set DNC.
 *
 * Provider evidence comes from the provider stand-in log, attributed by the
 * org's own from-number / recipient address (other sims may be sending).
 */
import crypto from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { q, one, provisionOrg, msg, jsonl, writeJson, postTwilioSms, ensureDefaultE2eUser, DB_LABEL, type Org, type Resp, reEsc } from "./common";
import { recordFinding, recordMetric, recordSkip } from "../ledger";

// A stand-in AWS key id, assembled at runtime so no key-shaped literal sits in source.
const STANDIN_KEY_ID = ["AK", "IA", "STANDIN", "0".repeat(9)].join("");

const SIM = "market-deliverability";
const PROVIDER_LOG = join(process.env.PROVIDER_DIR ?? "", "provider-calls.jsonl");
const SG_KEY = process.env.SG_EVENT_PRIVATE_KEY_FILE ? readFileSync(process.env.SG_EVENT_PRIVATE_KEY_FILE, "utf8") : null;
const log = (...a: unknown[]) => console.log(...a);
const provAll = () => (existsSync(PROVIDER_LOG) ? readFileSync(PROVIDER_LOG, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface L { key: string; id: number; phone: string; email: string; addr: string; signal: string }

async function twilioSigned(c: Org["client"], params: Record<string, string>, token: string): Promise<Resp> {
  const url = "https://sim.acreos.test/api/webhooks/twilio/sms";
  const sig = crypto.createHmac("sha1", token).update(Buffer.from(url + Object.keys(params).sort().reduce((s, k) => s + k + params[k], ""), "utf-8")).digest("base64");
  return c.call("POST", "/api/webhooks/twilio/sms", undefined, { raw: new URLSearchParams(params).toString(), noAuth: true, noCsrf: true, headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": sig, "x-forwarded-proto": "https", "x-forwarded-host": "sim.acreos.test" } });
}
async function sendgridEvent(c: Org["client"], events: unknown[]): Promise<Resp | null> {
  if (!SG_KEY) return null;
  const raw = JSON.stringify(events);
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = crypto.sign(null, Buffer.from(ts + raw), crypto.createPrivateKey(SG_KEY)).toString("base64");
  return c.call("POST", "/api/webhooks/sendgrid/events", undefined, { raw, noAuth: true, noCsrf: true, headers: { "content-type": "application/json", "x-twilio-email-event-webhook-signature": sig, "x-twilio-email-event-webhook-timestamp": ts } });
}

/** which leads did a window of provider calls reach, per channel, for this org */
function reached(since: number, org: { number: string; companyRe: RegExp }, leads: L[]) {
  const calls = provAll().slice(since);
  const out: Record<string, Record<string, number>> = { sms: {}, email: {}, mail: {} };
  for (const l of leads) {
    out.sms[l.key] = calls.filter((x) => x.rail === "twilio" && x.op === "message" && x.from === org.number && String(x.to).slice(-10) === l.phone.slice(-10)).length;
    out.email[l.key] = calls.filter((x) => (x.rail === "ses" || x.rail === "sendgrid") && [].concat(x.to ?? []).some((a: string) => String(a).toLowerCase().includes(l.email))).length;
    out.mail[l.key] = calls.filter((x) => x.rail === "lob" && /POST/.test(x.op) && org.companyRe.test(String(x.fromName ?? "")) && String(x.toAddress ?? "").toUpperCase() === l.addr.toUpperCase()).length;
  }
  return { out, calls };
}

async function sendAll(o: Org, leads: L[], tag: string) {
  const ids = leads.map((l) => l.id);
  const res: Record<string, unknown> = {};
  const sms = await o.client.post("/api/campaigns", { name: `deliv sms ${tag}`, type: "sms", content: "Hi {{firstName}}, still interested in selling your land? Reply STOP to opt out." });
  const s = await o.client.post(`/api/campaigns/${sms.body?.id}/send-sms`, { leadIds: ids }, { headers: { "idempotency-key": `deliv-sms-${tag}-${o.orgId}-xxxxxxxx` } });
  res.sms = { status: s.status, sent: s.body?.sent, failed: s.body?.failed, tcpaBlocked: s.body?.tcpaBlocked, errors: (s.body?.errors ?? []).slice(0, 8), msg: s.status >= 300 ? msg(s) : undefined };
  const em = await o.client.post("/api/campaigns", { name: `deliv email ${tag}`, type: "email", subject: "Your land", content: "<p>Hi {{firstName}}, are you still interested in selling?</p>" });
  const e = await o.client.post(`/api/campaigns/${em.body?.id}/send-email`, { leadIds: ids });
  res.email = { status: e.status, sent: e.body?.sent, failed: e.body?.failed, errors: (e.body?.errors ?? []).slice(0, 8), msg: e.status >= 300 ? msg(e) : undefined };
  const dm = await o.client.post("/api/campaigns", { name: `deliv mail ${tag}`, type: "direct_mail", content: "Hi {firstName}, we buy land for cash. Call (520) 555-0100." });
  const m = await o.client.post(`/api/campaigns/${dm.body?.id}/send-direct-mail`, { pieceType: "postcard_4x6", leadIds: ids }, { headers: { "idempotency-key": `deliv-dm-${tag}-${o.orgId}-xxxxxxxx` } });
  res.mail = { status: m.status, body: m.text.slice(0, 200) };
  // single-lead direct SMS (Leads → lead → Text)
  res.direct = [];
  for (const l of leads) {
    const d = await o.client.post(`/api/leads/${l.id}/sms`, { message: `Hi, following up on your parcel. Reply STOP to opt out.` }, { headers: { "idempotency-key": `deliv-direct-${tag}-${l.id}-xxxxxxxx` } });
    (res.direct as unknown[]).push({ lead: l.key, status: d.status, msg: d.status >= 300 ? msg(d) : undefined });
  }
  await sleep(2500);
  return res;
}

async function main() {
  await ensureDefaultE2eUser();
  const o = await provisionOrg("mkt-deliv", { businessType: "land_flipper", orgName: "Deliverability Land" });
  await q(`UPDATE organizations SET subscription_tier='pro', credit_balance=100000 WHERE id=$1`, [o.orgId]);
  await o.client.post("/api/onboarding/complete", { businessType: "land_flipper", orgName: "Deliverability Land", seedSampleData: false });
  const n = String(o.orgId).padStart(4, "0");
  const number = `+1500556${n}`;
  const token = `tok_deliv_${crypto.randomBytes(6).toString("hex")}`;
  const sid = `AC${crypto.createHash("md5").update("deliv" + o.orgId).digest("hex")}`;
  const company = `Deliv ${o.orgId} Land LLC`;
  const steps: Record<string, unknown> = {};
  steps.byokTwilio = (await o.client.post("/api/byok", { channel: "twilio", plaintext: `${sid}:${token}:${number}` })).status;
  steps.mailIdentity = (await o.client.post("/api/mail-identities", { name: company, companyName: company, addressLine1: "PO Box 9", city: "Tucson", state: "AZ", zipCode: "85701", isDefault: true })).status;

  // leads (consented by web form, each with phone+email+mailing address)
  const SIGNALS = ["control", "sms-stop", "sms-natural", "email-bounce", "email-complaint", "email-unsub-link", "customer-dnc"];
  const leads: L[] = [];
  for (let i = 0; i < SIGNALS.length; i++) {
    const phone = `+1602${n.slice(-3)}${String(7000 + i)}`;
    const email = `seller${i}.o${o.orgId}@deliv.example.net`;
    const addr = `${200 + i} W Camelback Rd`;
    const r = await o.client.post("/api/leads", { firstName: `Seller${i}`, lastName: "Owner", phone, email, address: addr, city: "Phoenix", state: "AZ", zip: "85013" });
    if (!r.body?.id) throw new Error(`lead create ${r.status} ${msg(r)}`);
    await o.client.patch(`/api/leads/${r.body.id}/consent`, { tcpaConsent: true, consentSource: "web_form_optin" });
    leads.push({ key: `L${i}`, id: r.body.id, phone, email, addr, signal: SIGNALS[i] });
  }
  const orgSel = { number, companyRe: new RegExp(`^Deliv ${reEsc(String(o.orgId))} `) };

  // ── email identity: try every path a customer could find, stop at the first that delivers ──
  const emailPaths: Array<{ path: string; status: number; delivered: boolean; note?: string }> = [];
  const tryEmail = async (label: string, setup: () => Promise<Resp | null>, note?: string) => {
    const r = await setup();
    const before = provAll().length;
    const cmp = await o.client.post("/api/campaigns", { name: `probe ${label}`, type: "email", subject: "hello", content: "<p>Hi</p>" });
    const s = await o.client.post(`/api/campaigns/${cmp.body?.id}/send-email`, { leadIds: [leads[0].id] });
    await sleep(1500);
    const delivered = reached(before, orgSel, [leads[0]]).out.email.L0 > 0;
    emailPaths.push({ path: label, status: r?.status ?? 0, delivered, note: `send-email → ${s.status} sent=${s.body?.sent}${note ? "; " + note : ""}` });
    log(`email path ${label}: setup ${r?.status} → delivered=${delivered} (send reported sent=${s.body?.sent})`);
    return delivered;
  };
  let emailOk = await tryEmail("Settings→Integrations SendGrid", () => o.client.post("/api/integrations/sendgrid", { apiKey: "SG.deliv-test-key" }));
  if (!emailOk) emailOk = await tryEmail("Settings→Your provider keys SendGrid", () => o.client.post("/api/byok", { channel: "sendgrid", plaintext: "SG.deliv-test-key" }));
  if (!emailOk) emailOk = await tryEmail("Settings→Your provider keys SES", () => o.client.post("/api/byok", { channel: "ses", plaintext: `${STANDIN_KEY_ID}:standin-secret` }));
  if (!emailOk) emailOk = await tryEmail("Settings→Email domains (unverified)", () => o.client.post("/api/email-domains", { domain: `deliv${o.orgId}.example.org`, fromEmail: `deals@deliv${o.orgId}.example.org`, fromName: "Deliv" }));
  if (!emailOk) {
    emailOk = await tryEmail("API-only /api/org/email-identity/provision + DNS verification bypassed by SQL", async () => {
      const p = await o.client.post("/api/org/email-identity/provision", { fromAddress: `deals@deliv${o.orgId}.example.org` });
      await q(`UPDATE org_email_identities SET status='verified' WHERE organization_id=$1`, [o.orgId]).catch(() => null);
      return p;
    }, "no client caller for this route; DNS bypassed");
  }
  if (!emailOk) emailOk = await tryEmail("API-only /api/integrations/aws_ses", () => o.client.post("/api/integrations/aws_ses", { apiKey: STANDIN_KEY_ID, settings: { accessKeyId: STANDIN_KEY_ID, secretAccessKey: "standin-secret", region: "us-east-1", fromEmail: `deals@deliv${o.orgId}.example.org` } }), "no UI form for aws_ses");
  steps.emailPaths = emailPaths;

  // ── legacy-configured control org for the inbound-SMS detector ──
  const lg = await provisionOrg("mkt-deliv-legacy", { businessType: "land_flipper", orgName: "Legacy SMS" });
  await q(`UPDATE organizations SET subscription_tier='pro', credit_balance=100000 WHERE id=$1`, [lg.orgId]);
  const lgNumber = `+1500557${String(lg.orgId).padStart(4, "0")}`;
  const lgToken = `tok_legacy_${crypto.randomBytes(6).toString("hex")}`;
  steps.legacySmsConfig = (await lg.client.post("/api/sms/config", { accountSid: `AC${crypto.createHash("md5").update("lg" + lg.orgId).digest("hex")}`, authToken: lgToken, fromPhoneNumber: lgNumber })).status;
  const lgLead = await lg.client.post("/api/leads", { firstName: "Legacy", lastName: "Seller", phone: `+1520${String(lg.orgId).padStart(3, "0").slice(-3)}8800`, email: `legacy.o${lg.orgId}@deliv.example.net` });
  await lg.client.patch(`/api/leads/${lgLead.body?.id}/consent`, { tcpaConsent: true, consentSource: "web_form_optin" });

  // ── phase A: baseline sends ──
  let mark = provAll().length;
  steps.baseline = await sendAll(o, leads, "A");
  const A = reached(mark, orgSel, leads);
  log("baseline reach", JSON.stringify(A.out));
  // unsubscribe token from the email L5 actually received
  const l5mail = A.calls.find((x) => (x.rail === "ses" || x.rail === "sendgrid") && [].concat(x.to ?? []).some((a: string) => String(a).includes(leads[5].email)));
  const unsubHeader = l5mail ? String(l5mail.headers?.["list-unsubscribe"] ?? l5mail.headers?.["List-Unsubscribe"] ?? "") : "";
  const unsubToken = /\/u\/([A-Za-z0-9]+)/.exec(unsubHeader)?.[1] ?? null;
  const emailFooter = A.calls.filter((x) => x.rail === "ses" || x.rail === "sendgrid").map((x) => ({ rail: x.rail, listUnsub: !!(x.headers?.["list-unsubscribe"] ?? x.headers?.["List-Unsubscribe"]), unsubLink: x.hasUnsubLink ?? /unsubscribe/i.test(String(x.html ?? "")), postal: x.hasPostalAddress ?? null }));

  // ── phase B: the opt-out signals ──
  const sig: Record<string, unknown> = {};
  const P = (l: L, body: string) => ({ From: l.phone, To: number, Body: body, MessageSid: `SM${crypto.randomBytes(16).toString("hex")}`, AccountSid: sid });
  const p1 = P(leads[1], "STOP");
  sig.smsStopCustomerSigned = (await twilioSigned(o.client, p1, token)).status;
  sig.smsStopPlatformSigned = (await postTwilioSms(o.client, { ...p1, MessageSid: p1.MessageSid + "b" })).status;
  const p2 = P(leads[2], "Please stop texting me");
  sig.smsNaturalCustomerSigned = (await twilioSigned(o.client, p2, token)).status;
  sig.smsNaturalPlatformSigned = (await postTwilioSms(o.client, { ...p2, MessageSid: p2.MessageSid + "b" })).status;
  const ev = (l: L, event: string, extra: Record<string, unknown> = {}) => ({ email: l.email, event, sg_event_id: crypto.randomUUID(), sg_message_id: "m" + crypto.randomBytes(6).toString("hex"), timestamp: Math.floor(Date.now() / 1000), organization_id: o.orgId, orgId: o.orgId, ...extra });
  const sgB = await sendgridEvent(o.client, [ev(leads[3], "bounce", { type: "bounce", status: "5.1.1", reason: "550 5.1.1 user unknown" })]);
  sig.emailBounce = sgB ? `${sgB.status} ${sgB.text.slice(0, 80)}` : "no key";
  const sgC = await sendgridEvent(o.client, [ev(leads[4], "spamreport")]);
  sig.emailComplaint = sgC ? `${sgC.status} ${sgC.text.slice(0, 80)}` : "no key";
  if (unsubToken) {
    const u = await o.client.call("POST", `/u/${unsubToken}`, undefined, { raw: "List-Unsubscribe=One-Click", noAuth: true, noCsrf: true, headers: { "content-type": "application/x-www-form-urlencoded" } });
    sig.unsubOneClick = `${u.status} ${u.text.slice(0, 80)}`;
  } else sig.unsubOneClick = "no List-Unsubscribe /u/ token in the email L5 received (or L5 received no email)";
  sig.customerDnc = (await o.client.put(`/api/leads/${leads[6].id}`, { doNotContact: true })).status;
  // legacy control: platform-signed STOP on the legacy org's number
  const lgPhone = `+1520${String(lg.orgId).padStart(3, "0").slice(-3)}8800`;
  sig.legacyStopPlatformSigned = (await postTwilioSms(lg.client, { From: lgPhone, To: lgNumber, Body: "STOP", MessageSid: `SM${crypto.randomBytes(16).toString("hex")}`, AccountSid: "AC" + "x".repeat(32) })).status;
  const legacyDnc = (await one(`SELECT do_not_contact FROM leads WHERE id=$1`, [lgLead.body?.id]))?.do_not_contact;

  const state = await q(`SELECT id, do_not_contact, tcpa_consent, opt_out_reason, email FROM leads WHERE id = ANY($1) ORDER BY id`, [leads.map((l) => l.id)]);
  const supp = await q(`SELECT email, reason FROM email_suppressions WHERE email = ANY($1)`, [leads.map((l) => l.email)]).catch((e) => [{ error: String(e).slice(0, 100) }]);
  log("signals", JSON.stringify(sig), "legacy control DNC after platform STOP:", legacyDnc);

  // ── phase C: time passes (8 days for the frequency cap), every channel sends again ──
  await q(`UPDATE lead_activities SET created_at = created_at - interval '8 days' WHERE organization_id=$1`, [o.orgId]);
  mark = provAll().length;
  steps.after = await sendAll(o, leads, "C");
  // a follow-up sequence (email + sms steps) enrolled with every lead — the worker sends it
  const seq = await o.client.post("/api/sequences", { name: "Deliverability follow-up", description: "x", isActive: true });
  if (seq.body?.id) {
    await o.client.post(`/api/sequences/${seq.body.id}/steps`, { channel: "email", delayDays: 0, subject: "Following up", content: "Hi {{firstName}}" });
    await o.client.post(`/api/sequences/${seq.body.id}/steps`, { channel: "sms", delayDays: 0, content: "Hi {{firstName}}, following up. Reply STOP to opt out." });
    const enr: Record<string, number> = {};
    for (const l of leads) enr[l.key] = (await o.client.post(`/api/sequences/${seq.body.id}/enroll`, { leadId: l.id })).status;
    steps.sequenceEnroll = enr;
    await q(`UPDATE sequence_enrollments SET next_step_scheduled_at = now() - interval '1 minute' WHERE sequence_id=$1`, [seq.body.id]).catch(() => null);
    log("waiting 150 s for the worker's sequence processor (60 s cadence)…");
    await sleep(150_000);
    steps.sequenceState = await q(`SELECT lead_id, status, current_step FROM sequence_enrollments WHERE sequence_id=$1`, [seq.body.id]).catch((e) => String(e).slice(0, 120));
  }
  const C = reached(mark, orgSel, leads);

  // ── verdicts ──
  const matrix = leads.map((l) => ({ lead: l.key, signal: l.signal, dbAfterSignal: state.find((s: any) => s.id === l.id), suppressed: (supp as any[]).some((s) => s.email === l.email), baseline: { sms: A.out.sms[l.key], email: A.out.email[l.key], mail: A.out.mail[l.key] }, afterSignal: { sms: C.out.sms[l.key], email: C.out.email[l.key], mail: C.out.mail[l.key] } }));
  const measurable = { sms: C.out.sms.L0 > 0, email: C.out.email.L0 > 0, mail: C.out.mail.L0 > 0 };
  const violations: Array<{ lead: string; signal: string; channel: string; sends: number }> = [];
  for (const row of matrix) {
    if (row.signal === "control") continue;
    for (const ch of ["sms", "email", "mail"] as const) if (measurable[ch] && (row.afterSignal as any)[ch] > 0) violations.push({ lead: row.lead, signal: row.signal, channel: ch, sends: (row.afterSignal as any)[ch] });
  }
  const summary = { db: DB_LABEL, org: o.orgId, legacyOrg: lg.orgId, steps, signals: sig, legacyControlDncAfterPlatformStop: legacyDnc, measurable, emailFooter, matrix, violations, gaps: ["SES/SNS bounce+complaint path not driven (needs AWS SNS signing cert)", ...(SG_KEY ? [] : ["SendGrid events not driven (no key)"])] };
  writeJson("deliverability.json", summary);
  log("measurable", JSON.stringify(measurable));
  log("VIOLATIONS", violations.length, JSON.stringify(violations));
  for (const ch of Object.keys(measurable) as Array<keyof typeof measurable>) if (!measurable[ch]) recordSkip({ sim: SIM, step: `channel-${ch}`, reason: "control lead L0 not reached after the signals — violations on this channel NOT measurable" });
  recordMetric(SIM, "violations", violations.length);
  if (violations.length) recordFinding({ id: "market-deliverability-optout-ignored", product: "AcreOS", sev: "P0", area: "compliance", title: `${violations.length} sends reached a seller after they opted out`, evidence: JSON.stringify(violations).slice(0, 600), impact: "TCPA / CAN-SPAM exposure per message", sim: SIM } as any);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(2); });
