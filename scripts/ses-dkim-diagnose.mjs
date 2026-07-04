#!/usr/bin/env node
/**
 * Cloudflare-only DKIM diagnostic for the 2026-07 acreos.io incident.
 *
 * The full ses-setup.mjs died at the SES step: the AWS credentials on the
 * Fly machine are invalid (UnrecognizedClientException). This script needs
 * ONLY the Cloudflare token (verified working) and answers two questions:
 *
 *   1. Do any *._domainkey.<domain> records exist in the zone, and are they
 *      proxied? (A proxied CNAME resolves to Cloudflare edge A-records —
 *      SES can never detect it. If found proxied, we fix proxied=false.)
 *   2. Which AWS_* env var NAMES are present on the machine? (Names only,
 *      never values.) A stale AWS_SESSION_TOKEN alongside permanent keys
 *      produces exactly "security token included in the request is invalid".
 *
 * Read-only except for the proxied→DNS-only flip, which is safe and what
 * the records must be for SES anyway.
 */

const DOMAIN = process.env.SES_DOMAIN || "acreos.io";
const CF_TOKEN =
  process.env.CLOUDFLARE_API_TOKEN ||
  process.env.CF_API_TOKEN ||
  process.env.CLOUDFLARE_TOKEN ||
  process.env.CF_TOKEN ||
  process.env.Cloudflare;

if (!CF_TOKEN) {
  console.error("✗ No Cloudflare token in env");
  process.exit(1);
}

async function cf(path, init = {}) {
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${CF_TOKEN}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const body = await res.json();
  if (!res.ok || !body.success) {
    throw new Error(
      `Cloudflare ${init.method || "GET"} ${path}: ${(body.errors || []).map((e) => e.message).join("; ")}`,
    );
  }
  return body.result;
}

console.log(`── AWS env var names on this machine (values never printed) ──`);
const awsKeys = Object.keys(process.env)
  .filter((k) => k.startsWith("AWS_"))
  .sort();
for (const k of awsKeys) console.log(`  ${k}`);
if (awsKeys.includes("AWS_SESSION_TOKEN")) {
  console.log(
    `  !! AWS_SESSION_TOKEN is set — a stale session token makes permanent keys fail with "security token invalid". Likely fix: fly secrets unset AWS_SESSION_TOKEN -a acreos`,
  );
}

console.log(`\n── Cloudflare zone scan for ${DOMAIN} ──`);
const zones = await cf(`/zones?name=${encodeURIComponent(DOMAIN)}`);
if (!zones.length) {
  console.error(`✗ zone ${DOMAIN} not visible to this token`);
  process.exit(1);
}
const zoneId = zones[0].id;
console.log(`  zone ${zoneId}`);

// Page through all records once; filter locally for _domainkey + email infra.
const records = [];
for (let page = 1; ; page++) {
  const batch = await cf(`/zones/${zoneId}/dns_records?per_page=100&page=${page}`);
  records.push(...batch);
  if (batch.length < 100) break;
}
console.log(`  ${records.length} records total in zone`);

const domainkey = records.filter((r) => r.name.includes("_domainkey"));
if (domainkey.length === 0) {
  console.log(`  NO *._domainkey records exist — the DKIM CNAMEs were never published.`);
} else {
  for (const r of domainkey) {
    console.log(
      `  ${r.type} ${r.name} → ${r.content} [proxied=${r.proxied}]`,
    );
    if (r.proxied) {
      const updated = await cf(`/zones/${zoneId}/dns_records/${r.id}`, {
        method: "PATCH",
        body: JSON.stringify({ proxied: false }),
      });
      console.log(`    ✓ un-proxied (now DNS-only): ${updated.name}`);
    }
  }
}

const emailInfra = records.filter(
  (r) =>
    r.name === DOMAIN && r.type === "TXT" && /v=spf1/i.test(r.content) ||
    r.name === `_dmarc.${DOMAIN}` ||
    r.name === `mail.${DOMAIN}`,
);
console.log(`\n── Email-infra records (for context) ──`);
for (const r of emailInfra) {
  console.log(`  ${r.type} ${r.name} → ${r.content} [proxied=${r.proxied}]`);
}
console.log(`\nDone.`);
