#!/usr/bin/env node
/**
 * UptimeRobot setup for acreos.io.
 *
 * Runs on the Fly machine where the UptimeRobot API key lives as a secret:
 *   fly ssh console -a acreos -C "node scripts/uptimerobot-setup.mjs"
 *
 * Idempotent: each step checks current state before acting. Re-running is
 * safe and is the recommended way to inspect monitor health.
 *
 * Required env (from Fly secrets):
 *   UpTimeRobot (or UPTIMEROBOT_API_KEY / UPTIMEROBOT_TOKEN)
 *
 * Optional:
 *   STATUS_PAGE_HOSTNAME (defaults to status.acreos.io — used for the
 *     CNAME instruction printed at the end; if your custom hostname differs,
 *     override here)
 *
 * What it does:
 *   1. Verifies the API key.
 *   2. Lists current monitors (idempotency baseline).
 *   3. Creates 4 monitors (skipping any whose URL already matches):
 *      - "AcreOS — site"          HTTPS  https://acreos.io
 *      - "AcreOS — healthz"       HTTPS  https://acreos.io/api/healthz  (keyword check: "ok":true)
 *      - "AcreOS — status"        HTTPS  https://acreos.io/api/status   (keyword check: "status")
 *      - "AcreOS — version"       HTTPS  https://acreos.io/api/version  (keyword check: any 200 body)
 *   4. Creates an email alert contact (defaults to founder@acreos.io if not exists).
 *   5. Creates a public status page (PSP) named "AcreOS" covering the 4 monitors.
 *   6. Prints the public PSP URL so the operator can CNAME status.acreos.io to it.
 *
 * UptimeRobot API: https://uptimerobot.com/api/
 * All requests are POST with x-www-form-urlencoded bodies. The API key is
 * passed in the body as `api_key=...`.
 */

const ENDPOINT = "https://api.uptimerobot.com/v2";
const API_KEY =
  process.env.UPTIMEROBOT_API_KEY ||
  process.env.UPTIMEROBOT_TOKEN ||
  process.env.UpTimeRobot ||
  process.env.UptimeRobot ||
  null;

const STATUS_HOSTNAME = process.env.STATUS_PAGE_HOSTNAME || "status.acreos.io";

const MONITORS = [
  {
    friendly_name: "AcreOS — site",
    url: "https://acreos.io",
    type: 1, // HTTP(s)
    interval: 300, // 5 min
    timeout: 30,
    http_method: 2, // GET
  },
  {
    friendly_name: "AcreOS — healthz",
    url: "https://acreos.io/api/healthz",
    type: 2, // keyword
    keyword_type: 2, // exists
    keyword_value: '"ok":true',
    interval: 300,
    timeout: 30,
  },
  {
    friendly_name: "AcreOS — status",
    url: "https://acreos.io/api/status",
    type: 2,
    keyword_type: 2,
    keyword_value: '"status"',
    interval: 300,
    timeout: 30,
  },
  {
    friendly_name: "AcreOS — version",
    url: "https://acreos.io/api/version",
    type: 1,
    interval: 300,
    timeout: 30,
    http_method: 2,
  },
];

const ALERT_CONTACT_EMAIL = process.env.UPTIMEROBOT_ALERT_EMAIL || "founder@acreos.io";

const ok = (msg) => console.log(`  ✓  ${msg}`);
const info = (msg) => console.log(`  ·  ${msg}`);
const warn = (msg) => console.log(`  !  ${msg}`);
const step = (n, label) => console.log(`\n[${n}] ${label}`);
const fail = (msg) => {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
};

if (!API_KEY) {
  fail(
    "Missing UptimeRobot API key. Set Fly secret named UpTimeRobot (or UPTIMEROBOT_API_KEY / UPTIMEROBOT_TOKEN).",
  );
}

async function uptime(method, params = {}) {
  const body = new URLSearchParams({
    api_key: API_KEY,
    format: "json",
    ...Object.fromEntries(
      Object.entries(params).map(([k, v]) => [
        k,
        typeof v === "object" ? JSON.stringify(v) : String(v),
      ]),
    ),
  });
  const res = await fetch(`${ENDPOINT}/${method}`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "cache-control": "no-cache",
    },
    body,
  });
  const json = await res.json().catch(() => null);
  if (!json || json.stat !== "ok") {
    throw new Error(
      `UptimeRobot ${method} failed: ${JSON.stringify(json?.error || json || `HTTP ${res.status}`)}`,
    );
  }
  return json;
}

console.log(`\n══════════════════════════════════════════════════════════`);
console.log(` UptimeRobot setup for acreos.io`);
console.log(`══════════════════════════════════════════════════════════`);
console.log(` Endpoint:           ${ENDPOINT}`);
console.log(` Status hostname:    ${STATUS_HOSTNAME}`);
console.log(` Alert contact:      ${ALERT_CONTACT_EMAIL}`);
console.log(` Monitors planned:   ${MONITORS.length}`);
console.log(`══════════════════════════════════════════════════════════`);

async function run() {
  step(1, "Verifying API key");
  const account = await uptime("getAccountDetails");
  ok(`account ok (${account.account?.email || "unnamed"})`);

  step(2, "Listing current monitors");
  const existing = await uptime("getMonitors", { search: "AcreOS" });
  const existingMonitors = existing.monitors || [];
  info(`${existingMonitors.length} existing AcreOS monitor(s)`);

  step(3, "Upserting monitors");
  const monitorIds = [];
  for (const m of MONITORS) {
    const match = existingMonitors.find((e) => e.url === m.url);
    if (match) {
      info(`already exists: ${m.friendly_name} (id ${match.id})`);
      monitorIds.push(match.id);
      continue;
    }
    const created = await uptime("newMonitor", m);
    ok(`created: ${m.friendly_name} (id ${created.monitor.id})`);
    monitorIds.push(created.monitor.id);
  }

  step(4, "Alert contact");
  const contacts = await uptime("getAlertContacts");
  const contact = (contacts.alert_contacts || []).find((c) => c.value === ALERT_CONTACT_EMAIL);
  let alertContactId;
  if (contact) {
    info(`already exists: ${ALERT_CONTACT_EMAIL} (id ${contact.id}, status ${contact.status === 2 ? "active" : "pending"})`);
    alertContactId = contact.id;
  } else {
    const created = await uptime("newAlertContact", {
      type: 2, // email
      value: ALERT_CONTACT_EMAIL,
      friendly_name: "AcreOS Founder",
    });
    ok(`created: ${ALERT_CONTACT_EMAIL} (id ${created.alertcontact.id}) — confirm via inbox`);
    alertContactId = created.alertcontact.id;
  }

  step(5, "Public status page");
  const psps = await uptime("getPSPs", { search: "AcreOS" });
  const existingPsp = (psps.psps || []).find((p) => p.friendly_name === "AcreOS");
  let pspUrl;
  if (existingPsp) {
    info(`already exists: ${existingPsp.friendly_name} (id ${existingPsp.id})`);
    pspUrl = existingPsp.standard_url || `https://stats.uptimerobot.com/${existingPsp.id}`;
  } else {
    const created = await uptime("newPSP", {
      type: 1, // public
      friendly_name: "AcreOS",
      monitors: monitorIds.join("-"),
      custom_domain: "",
      sort: 1, // newest first
      hide_url_links: 0,
      status: 1, // active
    });
    pspUrl = created.psp.standard_url || `https://stats.uptimerobot.com/${created.psp.id}`;
    ok(`created: AcreOS (id ${created.psp.id})`);
  }

  console.log(`\n══════════════════════════════════════════════════════════`);
  console.log(` Summary`);
  console.log(`══════════════════════════════════════════════════════════`);
  console.log(`  Monitors:        ${monitorIds.length}`);
  console.log(`  Alert contact:   ${ALERT_CONTACT_EMAIL}`);
  console.log(`  Status page:     ${pspUrl}`);
  console.log(`══════════════════════════════════════════════════════════\n`);

  console.log(`Next steps:`);
  console.log(`  · UptimeRobot will begin polling immediately; first results visible in 5 min.`);
  console.log(`  · For status.acreos.io to point at this status page:`);
  console.log(`    Add a Cloudflare CNAME on ${STATUS_HOSTNAME} →  stats.uptimerobot.com`);
  console.log(`    (Then in UptimeRobot dashboard → PSPs → AcreOS → Custom Domain, enter ${STATUS_HOSTNAME})`);
  console.log(`  · The free tier supports 50 monitors at 5-min intervals — plenty of headroom.`);
  console.log(`  · Re-run this script anytime to see current monitor health and refresh state.\n`);
}

run().catch((e) => fail(`${e.message}\n${e.stack || ""}`));
