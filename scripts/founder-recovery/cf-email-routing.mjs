#!/usr/bin/env node
/**
 * Founder-recovery: inspect/enable Cloudflare Email Routing for acreos.io via
 * the API using the CLOUDFLARE token already on the Fly machine. Read-only
 * unless ACTION=enable is set. No secret value is ever printed.
 *
 *   MODE=probe   -> report token perms + current routing state (default)
 *   MODE=enable  -> enable routing, ensure SPF merged, add dmarc@/support@ rules
 */
const ZONE = "8c040ba6367ff47829b9ecd7ae16f31a";
const DOMAIN = "acreos.io";
const DEST = "thmsnrtn@gmail.com";
const MODE = process.env.MODE || "probe";

const token =
  process.env.CLOUDFLARE_API_TOKEN ||
  process.env.CF_API_TOKEN ||
  process.env.CLOUDFLARE_TOKEN ||
  process.env.CF_TOKEN ||
  process.env.Cloudflare;
if (!token) { console.log("NO_CF_TOKEN in env"); process.exit(2); }

const api = async (method, path, body) => {
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, ok: res.ok, json };
};

const short = (r) => ({ status: r.status, ok: r.ok, success: r.json?.success,
  errors: (r.json?.errors || []).map((e) => `${e.code}:${e.message}`) });

console.log(`── CF Email Routing (${MODE}) for ${DOMAIN} ──`);

// current routing state
const cur = await api("GET", `/zones/${ZONE}/email/routing`);
console.log("routing GET:", JSON.stringify(short(cur)));
if (cur.json?.result) {
  console.log("  enabled:", cur.json.result.enabled, "status:", cur.json.result.status);
}

if (MODE === "clerkdkim") {
  // Recover the clk/clk2 _domainkey CNAMEs (Clerk email DKIM) I wrongly deleted,
  // using Clerk's Backend API as the source of truth, then recreate via CF API.
  const ck = process.env.CLERK_SECRET_KEY;
  if (!ck) { console.log("NO CLERK_SECRET_KEY"); process.exit(2); }
  const cres = await fetch("https://api.clerk.com/v1/domains", { headers: { Authorization: `Bearer ${ck}` } });
  const cjson = await cres.json().catch(() => null);
  console.log("clerk /v1/domains:", cres.status);
  const domains = Array.isArray(cjson) ? cjson : (cjson?.data || []);
  const targets = [];
  for (const d of domains) {
    for (const t of (d.cname_targets || [])) {
      const host = t.host || "";
      if (/^clk2?\._domainkey/.test(host)) targets.push({ host, value: t.value });
    }
  }
  console.log("clk DKIM targets from Clerk:", JSON.stringify(targets));
  for (const t of targets) {
    const name = t.host.endsWith(DOMAIN) ? t.host : `${t.host}.${DOMAIN}`;
    // skip if already present
    const ex = await api("GET", `/zones/${ZONE}/dns_records?type=CNAME&name=${name}`);
    if ((ex.json?.result || []).length) { console.log("  already present:", name); continue; }
    const cr = await api("POST", `/zones/${ZONE}/dns_records`,
      { type: "CNAME", name, content: t.value, ttl: 1, proxied: false });
    console.log("  recreated:", name, "->", t.value, JSON.stringify(short(cr)));
  }
  process.exit(0);
}

if (MODE === "audit") {
  // Find recent DNS-record deletions to recover any wrongly-removed records.
  const acct = "959f0bb25e98e07e8379bdf7aa311c23";
  const r = await api("GET", `/accounts/${acct}/audit_logs?per_page=50&action.type=delete&direction=desc`);
  console.log("audit GET:", JSON.stringify(short(r)));
  for (const e of (r.json?.result || [])) {
    const res = e.resource || {};
    const meta = e.metadata || {};
    if (JSON.stringify(res).includes("dns") || JSON.stringify(meta).toLowerCase().includes("domainkey")) {
      console.log(JSON.stringify({ when: e.when, action: e.action, resource: res, metadata: meta, newValue: e.newValue, oldValue: e.oldValue }).slice(0, 600));
    }
  }
  process.exit(0);
}

if (MODE === "cleandkim") {
  // Delete stale *._domainkey CNAMEs that are NOT one of the 3 current SES tokens.
  const CURRENT = [
    "unewnzq4slsav3hwjwoq2gmd7kmlsmbu",
    "aue3eajbkr7ieij4cll5d7ecoocc6p37",
    "7nnyr5glvuvar7ynhvlgk4tz2d7665o2",
  ];
  const dns = await api("GET", `/zones/${ZONE}/dns_records?type=CNAME&per_page=200`);
  const dk = (dns.json?.result || []).filter((r) => (r.name || "").includes("_domainkey"));
  console.log("domainkey CNAMEs found:", dk.length);
  for (const r of dk) {
    const token = (r.name || "").split(".")[0];
    if (CURRENT.includes(token)) { console.log("  keep (current):", r.name); continue; }
    const del = await api("DELETE", `/zones/${ZONE}/dns_records/${r.id}`);
    console.log("  deleted stale:", r.name, JSON.stringify(short(del)));
  }
  process.exit(0);
}

if (MODE === "spf") {
  // Force apex SPF to a single merged record (amazonses + cloudflare).
  const merged = "v=spf1 include:amazonses.com include:_spf.mx.cloudflare.net ~all";
  const dns = await api("GET", `/zones/${ZONE}/dns_records?type=TXT&name=${DOMAIN}`);
  const spf = (dns.json?.result || []).filter((r) => (r.content || "").includes("v=spf1"));
  console.log("SPF records found:", spf.map((r) => r.content));
  if (spf.length === 0) {
    const cr = await api("POST", `/zones/${ZONE}/dns_records`, { type: "TXT", name: DOMAIN, content: merged, ttl: 1 });
    console.log("SPF created:", JSON.stringify(short(cr)));
  } else {
    const up = await api("PUT", `/zones/${ZONE}/dns_records/${spf[0].id}`, { type: "TXT", name: DOMAIN, content: merged, ttl: 1 });
    console.log("SPF[0] set to merged:", JSON.stringify(short(up)));
    for (const extra of spf.slice(1)) {
      const del = await api("DELETE", `/zones/${ZONE}/dns_records/${extra.id}`);
      console.log("deleted duplicate SPF:", JSON.stringify(short(del)));
    }
  }
  const chk = await api("GET", `/zones/${ZONE}/dns_records?type=TXT&name=${DOMAIN}`);
  console.log("apex SPF now:", (chk.json?.result || []).filter((r) => (r.content || "").includes("v=spf1")).map((r) => r.content));
  process.exit(0);
}

if (MODE !== "enable") {
  // list current DNS TXT (spf) so we can see baseline
  const dns = await api("GET", `/zones/${ZONE}/dns_records?type=TXT&name=${DOMAIN}`);
  const spf = (dns.json?.result || []).filter((r) => (r.content || "").includes("v=spf1"));
  console.log("apex SPF records:", spf.map((r) => r.content));
  console.log("\nprobe done. Re-run with MODE=enable to configure.");
  process.exit(cur.ok ? 0 : 1);
}

// ── ENABLE FLOW ──
// 1) merge SPF so amazonses + cloudflare both present, single record
const dns = await api("GET", `/zones/${ZONE}/dns_records?type=TXT&name=${DOMAIN}`);
const spfRecs = (dns.json?.result || []).filter((r) => (r.content || "").includes("v=spf1"));
const wantIncludes = ["include:amazonses.com", "include:_spf.mx.cloudflare.net"];
const merged = `v=spf1 ${wantIncludes.join(" ")} ~all`;
if (spfRecs.length === 1) {
  const rec = spfRecs[0];
  if (!rec.content.includes("_spf.mx.cloudflare.net")) {
    const up = await api("PUT", `/zones/${ZONE}/dns_records/${rec.id}`,
      { type: "TXT", name: DOMAIN, content: merged, ttl: 1 });
    console.log("SPF merged:", JSON.stringify(short(up)), "->", merged);
  } else {
    console.log("SPF already includes cloudflare:", rec.content);
  }
} else {
  console.log(`! expected 1 SPF, found ${spfRecs.length} — leaving SPF alone:`, spfRecs.map((r) => r.content));
}

// 2) enable routing (this provisions the MX records Cloudflare-side)
const en = await api("POST", `/zones/${ZONE}/email/routing/enable`, {});
console.log("routing enable:", JSON.stringify(short(en)));

// 3) add routing rules for dmarc@ and support@
for (const local of ["dmarc", "support"]) {
  const rule = await api("POST", `/zones/${ZONE}/email/routing/rules`, {
    name: `${local}@ -> gmail`,
    enabled: true,
    matchers: [{ type: "literal", field: "to", value: `${local}@${DOMAIN}` }],
    actions: [{ type: "forward", value: [DEST] }],
  });
  console.log(`rule ${local}@:`, JSON.stringify(short(rule)));
}

// 4) report final state
const fin = await api("GET", `/zones/${ZONE}/email/routing`);
console.log("final routing:", JSON.stringify(short(fin)), "enabled:", fin.json?.result?.enabled);
