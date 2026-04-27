#!/usr/bin/env node
/**
 * Gap 1.0 Phase D — generate clickable HTML side-by-side comparison
 * bundle so the founder can walk visual diffs efficiently.
 *
 * Output:
 *   docs/exhaustive-completion/comparisons/index.html  — surface index
 *   docs/exhaustive-completion/comparisons/<slug>.html — per-surface diff
 */
import { writeFile, mkdir } from "node:fs/promises";

const OUT = "docs/exhaustive-completion/comparisons";
const PROTO_REL = "../prototype-screenshots";
const PROD_REL = "../production-screenshots";
const FOUNDER_REL = "../founder-screenshots";

// Surface list grouped by tier, with verdict from earlier phase
const SURFACES = [
  // Public unauth
  { tier: "Public", slug: "landing", proto: "landing", prod: "landing", verdict: "CONFIDENT-FAIL", source: "/acreos-landing/" },
  { tier: "Public", slug: "auth", proto: null, prod: "auth", verdict: "CONFIDENT-FAIL", source: "Clerk hosted UI" },
  { tier: "Public", slug: "pricing", proto: null, prod: "pricing", verdict: "CONFIDENT-FAIL", source: "Production-only" },
  { tier: "Public", slug: "terms", proto: null, prod: "terms", verdict: "CONFIDENT-PASS", source: "Legal copy" },
  { tier: "Public", slug: "privacy", proto: null, prod: "privacy", verdict: "CONFIDENT-PASS", source: "Legal copy" },
  { tier: "Public", slug: "status", proto: null, prod: "status", verdict: "CONFIDENT-PASS", source: "Status chrome" },
  { tier: "Public", slug: "changelog", proto: null, prod: "changelog", verdict: "CONFIDENT-FAIL", source: "Changelog chrome" },
  { tier: "Public", slug: "404", proto: null, prod: "404", verdict: "CONFIDENT-PASS", source: "Coverage page" },

  // Onboarding (multi-step)
  ...["welcome", "markets", "buybox", "goals", "autonomy", "connections", "phone", "billing", "reveal"].map((step) => ({
    tier: "Onboarding (auth)",
    slug: `onboarding-${step}`,
    proto: `onboarding-${step}`,
    prod: null,
    verdict: "AUTH-REQUIRED",
    source: `/acreos-onboarding/ step ${step}`,
  })),

  // Tier 1
  { tier: "Tier 1 — Pipeline Core", slug: "home", proto: "home", prod: null, verdict: "AUTH-REQUIRED", source: "CommandCenterC" },
  { tier: "Tier 1 — Pipeline Core", slug: "inbox", proto: "inbox", prod: null, verdict: "AUTH-REQUIRED", source: "InboxC" },
  { tier: "Tier 1 — Pipeline Core", slug: "pipeline", proto: "pipeline", prod: null, verdict: "AUTH-REQUIRED", source: "Pipeline" },
  { tier: "Tier 1 — Pipeline Core", slug: "parcels", proto: "parcels", prod: null, verdict: "AUTH-REQUIRED", source: "ParcelDetailB" },
  { tier: "Tier 1 — Pipeline Core", slug: "contacts", proto: "contacts", prod: null, verdict: "AUTH-REQUIRED", source: "Contacts" },
  { tier: "Tier 1 — Pipeline Core", slug: "calendar", proto: "calendar", prod: null, verdict: "AUTH-REQUIRED", source: "CalendarPage" },

  // Tier 2
  { tier: "Tier 2 — Sourcing", slug: "buybox", proto: "buybox", prod: null, verdict: "AUTH-REQUIRED", source: "BuyBoxes" },
  { tier: "Tier 2 — Sourcing", slug: "lists", proto: "lists", prod: null, verdict: "AUTH-REQUIRED", source: "Lists" },
  { tier: "Tier 2 — Sourcing", slug: "campaigns", proto: "campaigns", prod: null, verdict: "AUTH-REQUIRED", source: "Campaigns" },
  { tier: "Tier 2 — Sourcing", slug: "perf", proto: "perf", prod: null, verdict: "AUTH-REQUIRED", source: "CampaignPerf" },

  // Tier 3
  { tier: "Tier 3 — Closing", slug: "offers", proto: "offers", prod: null, verdict: "AUTH-REQUIRED", source: "Offers" },
  { tier: "Tier 3 — Closing", slug: "documents", proto: "documents", prod: null, verdict: "AUTH-REQUIRED", source: "Documents" },
  { tier: "Tier 3 — Closing", slug: "finance", proto: "finance", prod: null, verdict: "AUTH-REQUIRED", source: "SellerFinance" },
  { tier: "Tier 3 — Closing", slug: "dispos", proto: "dispos", prod: null, verdict: "AUTH-REQUIRED", source: "Dispositions" },

  // Tier 4
  { tier: "Tier 4 — Ops", slug: "agents", proto: "agents", prod: null, verdict: "AUTH-REQUIRED", source: "AgentWorkspace" },
  { tier: "Tier 4 — Ops", slug: "automation", proto: "automation", prod: null, verdict: "AUTH-REQUIRED", source: "Automations" },
  { tier: "Tier 4 — Ops", slug: "audit", proto: "audit", prod: null, verdict: "AUTH-REQUIRED", source: "AuditLog" },
  { tier: "Tier 4 — Ops", slug: "settings", proto: "settings", prod: null, verdict: "AUTH-REQUIRED", source: "SettingsC" },
  { tier: "Tier 4 — Ops", slug: "team", proto: "team", prod: null, verdict: "AUTH-REQUIRED", source: "Team" },
  { tier: "Tier 4 — Ops", slug: "billing", proto: "billing", prod: null, verdict: "AUTH-REQUIRED", source: "Billing" },
  { tier: "Tier 4 — Ops", slug: "integrations", proto: "integrations", prod: null, verdict: "AUTH-REQUIRED", source: "Integrations" },
  { tier: "Tier 4 — Ops", slug: "pax", proto: "pax", prod: null, verdict: "AUTH-REQUIRED", source: "Pax" },

  // Tier 5
  { tier: "Tier 5 — Founder Mode", slug: "founder", proto: "founder", prod: null, verdict: "AUTH-REQUIRED", source: "FounderHomeC" },
  { tier: "Tier 5 — Founder Mode", slug: "atlas-run", proto: "atlas-run", prod: null, verdict: "AUTH-REQUIRED", source: "AtlasRunC" },
  { tier: "Tier 5 — Founder Mode", slug: "founder-rev", proto: "founder-rev", prod: null, verdict: "AUTH-REQUIRED", source: "FounderRevenueC" },
  { tier: "Tier 5 — Founder Mode", slug: "founder-tenants", proto: "founder-tenants", prod: null, verdict: "AUTH-REQUIRED", source: "FounderTenants" },
  { tier: "Tier 5 — Founder Mode", slug: "founder-cost", proto: "founder-cost", prod: null, verdict: "AUTH-REQUIRED", source: "FounderCost" },
  { tier: "Tier 5 — Founder Mode", slug: "founder-ops", proto: "founder-ops", prod: null, verdict: "AUTH-REQUIRED", source: "FounderOps" },
];

const VERDICT_STYLE = {
  "CONFIDENT-PASS": { bg: "#ecfdf5", border: "#10b981", text: "#047857", label: "✅ pass" },
  "CONFIDENT-FAIL": { bg: "#fef2f2", border: "#ef4444", text: "#b91c1c", label: "❌ fail" },
  "NEEDS-HUMAN-REVIEW": { bg: "#fffbeb", border: "#f59e0b", text: "#b45309", label: "👀 review" },
  "AUTH-REQUIRED": { bg: "#eff6ff", border: "#3b82f6", text: "#1d4ed8", label: "🔐 founder" },
};

function badge(verdict) {
  const s = VERDICT_STYLE[verdict];
  return `<span style="display:inline-block;background:${s.bg};color:${s.text};border:1px solid ${s.border};padding:2px 8px;border-radius:9999px;font:500 11px/1 -apple-system,sans-serif;">${s.label}</span>`;
}

function imgPanel(label, sub, src) {
  if (!src) {
    return `<div style="flex:1;padding:48px;background:#f9fafb;border:1px dashed #d1d5db;border-radius:12px;text-align:center;color:#6b7280;">
      <div style="font:500 14px/1 -apple-system,sans-serif;">${label}</div>
      <div style="font:400 13px/1.4 -apple-system,sans-serif;margin-top:8px;color:#9ca3af;">${sub}</div>
    </div>`;
  }
  return `<div style="flex:1;display:flex;flex-direction:column;">
    <div style="font:500 12px/1 -apple-system,sans-serif;color:#6b7280;margin-bottom:6px;">${label}</div>
    <img src="${src}" alt="${label}" style="width:100%;border:1px solid #e5e7eb;border-radius:8px;" />
  </div>`;
}

async function buildSurfaceHtml(s) {
  const protoDesktop = s.proto ? `${PROTO_REL}/${s.proto}-1440.png` : null;
  const protoMobile = s.proto ? `${PROTO_REL}/${s.proto}-375.png` : null;
  const prodDesktop = s.prod ? `${PROD_REL}/${s.prod}-1440.png` : null;
  const prodMobile = s.prod ? `${PROD_REL}/${s.prod}-375.png` : null;
  const founderDesktop = `${FOUNDER_REL}/desktop/${s.slug}.png`;
  const founderMobile = `${FOUNDER_REL}/mobile/${s.slug}.png`;

  const html = `<!doctype html>
<html><head><meta charset="utf-8" /><title>${s.slug} — comparison</title>
<style>
  body { font: 400 14px/1.5 -apple-system, sans-serif; max-width: 1400px; margin: 0 auto; padding: 24px; color: #111827; background: #fff; }
  h1 { font: 600 22px/1.2 -apple-system, sans-serif; margin: 0 0 4px; }
  .meta { color: #6b7280; font-size: 13px; margin-bottom: 16px; }
  .row { display: flex; gap: 16px; margin-bottom: 32px; }
  h2 { font: 500 14px/1 -apple-system, sans-serif; color: #374151; margin: 24px 0 12px; padding-bottom: 6px; border-bottom: 1px solid #e5e7eb; }
  a { color: #2563eb; }
</style></head>
<body>
  <p><a href="index.html">← back to index</a></p>
  <h1>/${s.slug} ${badge(s.verdict)}</h1>
  <p class="meta">Prototype source: <code>${s.source}</code></p>

  <h2>Desktop (1440px)</h2>
  <div class="row">
    ${imgPanel("Prototype", "Claude Design reference", protoDesktop)}
    ${imgPanel("Production", "Live at acreos.io", prodDesktop || "Auth-gated — see Founder column →")}
    ${imgPanel("Founder verification", "Drop in founder-screenshots/desktop/", null)}
  </div>

  <h2>Mobile (375px)</h2>
  <div class="row">
    ${imgPanel("Prototype", "Claude Design reference", protoMobile)}
    ${imgPanel("Production", "Live at acreos.io", prodMobile || "Auth-gated — see Founder column →")}
    ${imgPanel("Founder verification", "Drop in founder-screenshots/mobile/", null)}
  </div>

  <p style="margin-top:48px;color:#6b7280;font-size:12px;">Per-surface comparison file: <a href="../visual-comparisons/${s.slug}.md">visual-comparisons/${s.slug}.md</a></p>
</body></html>`;

  await writeFile(`${OUT}/${s.slug}.html`, html);
}

async function buildIndex() {
  const groups = {};
  for (const s of SURFACES) {
    if (!groups[s.tier]) groups[s.tier] = [];
    groups[s.tier].push(s);
  }

  const counts = SURFACES.reduce((acc, s) => {
    acc[s.verdict] = (acc[s.verdict] || 0) + 1;
    return acc;
  }, {});

  let html = `<!doctype html>
<html><head><meta charset="utf-8" /><title>AcreOS Visual Gap Comparisons</title>
<style>
  body { font: 400 14px/1.5 -apple-system, sans-serif; max-width: 960px; margin: 0 auto; padding: 32px; color: #111827; background: #fff; }
  h1 { font: 600 28px/1.2 -apple-system, sans-serif; margin: 0 0 8px; }
  .summary { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 12px; padding: 16px; margin: 16px 0 32px; display: flex; gap: 24px; flex-wrap: wrap; }
  .summary-item { font-size: 13px; }
  .summary-item b { font-size: 22px; display: block; color: #111827; }
  h2 { font: 500 18px/1 -apple-system, sans-serif; color: #374151; margin: 32px 0 12px; padding-bottom: 8px; border-bottom: 1px solid #e5e7eb; }
  ul { list-style: none; padding: 0; margin: 0; }
  li { padding: 10px 12px; border-bottom: 1px solid #f3f4f6; display: flex; align-items: center; justify-content: space-between; }
  li:hover { background: #fafafa; }
  a { color: #2563eb; text-decoration: none; font-weight: 500; }
  a:hover { text-decoration: underline; }
  .src { color: #9ca3af; font-size: 12px; margin-left: 12px; }
</style></head>
<body>
  <h1>AcreOS Visual Gap Comparisons</h1>
  <p style="color:#6b7280;">Gap 1.0 automated pre-pass — Claude Design prototype vs production at acreos.io</p>
  <div class="summary">
    <div class="summary-item"><b>${counts["CONFIDENT-PASS"] || 0}</b> ${badge("CONFIDENT-PASS")} pass</div>
    <div class="summary-item"><b>${counts["CONFIDENT-FAIL"] || 0}</b> ${badge("CONFIDENT-FAIL")} fail (mechanical)</div>
    <div class="summary-item"><b>${counts["NEEDS-HUMAN-REVIEW"] || 0}</b> ${badge("NEEDS-HUMAN-REVIEW")} review</div>
    <div class="summary-item"><b>${counts["AUTH-REQUIRED"] || 0}</b> ${badge("AUTH-REQUIRED")} founder</div>
  </div>
`;

  for (const tier of Object.keys(groups)) {
    html += `<h2>${tier}</h2><ul>`;
    for (const s of groups[tier]) {
      html += `<li><div><a href="${s.slug}.html">/${s.slug}</a><span class="src">${s.source}</span></div>${badge(s.verdict)}</li>`;
    }
    html += `</ul>`;
  }

  html += `<p style="margin-top:48px;color:#6b7280;font-size:12px;">See also: <a href="../MASTER-GAP-REPORT.md">MASTER-GAP-REPORT.md</a> · <a href="../mechanical-checks/">mechanical-checks/</a></p></body></html>`;

  await writeFile(`${OUT}/index.html`, html);
}

async function main() {
  await mkdir(OUT, { recursive: true });
  for (const s of SURFACES) await buildSurfaceHtml(s);
  await buildIndex();
  console.log(`✓ ${SURFACES.length} surface HTML pages + index → ${OUT}/index.html`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
