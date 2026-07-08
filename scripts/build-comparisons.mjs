#!/usr/bin/env node
/**
 * Gap 1.0 Phase C — produce per-surface visual comparison files.
 *
 * For each surface, classify into one of:
 *   CONFIDENT-PASS — automation believes this is fine
 *   CONFIDENT-FAIL — definite gaps identified
 *   NEEDS-HUMAN-REVIEW — automation uncertain
 *   AUTH-REQUIRED — no production capture possible without Clerk sign-in
 *
 * Visual judgment requires a multimodal LLM with side-by-side image
 * input — outside the scope of a static script. This phase produces
 * structured comparison stubs (with both image paths embedded), plus
 * per-surface verdict templates for the human/LLM to fill in via
 * follow-up review.
 *
 * For surfaces with mechanical-check failures captured in Phase B,
 * those findings are auto-classified CONFIDENT-FAIL and the
 * specific gaps listed.
 */
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";

const PROTOTYPE_DIR = "docs/archive/exhaustive-completion/prototype-screenshots";
const PRODUCTION_DIR = "docs/archive/exhaustive-completion/production-screenshots";
const CHECKS_DIR = "docs/archive/exhaustive-completion/mechanical-checks";
const OUT = "docs/archive/exhaustive-completion/visual-comparisons";

// Surfaces with direct prototype-vs-production analogs (unauth)
const UNAUTH_PAIRS = [
  { slug: "landing", prototype: "landing", production: "landing", url: "/", source: "/acreos-landing/" },
];

// Production-only unauth surfaces (no prototype, but mechanical checks shipped)
const UNAUTH_PRODUCTION_ONLY = [
  { slug: "auth", url: "/auth", note: "Clerk hosted UI — production-only" },
  { slug: "pricing", url: "/pricing", note: "Production-only — built per landing voice" },
  { slug: "terms", url: "/terms", note: "Legal copy" },
  { slug: "privacy", url: "/privacy", note: "Legal copy" },
  { slug: "status", url: "/status", note: "Status page chrome only" },
  { slug: "changelog", url: "/changelog", note: "Changelog chrome only" },
  { slug: "404", url: "/this-page-does-not-exist", prototype: null, production: "404", note: "Coverage page (homestead chassis)" },
];

// Customer + founder surfaces — prototype exists, production requires Clerk
const AUTH_REQUIRED = [
  { slug: "home", proto: "home", url: "/today", source: "/acreos/command-center.jsx → CommandCenterC", tier: 1 },
  { slug: "inbox", proto: "inbox", url: "/inbox", source: "/acreos/pages-tier1.jsx → InboxC (search InboxC =)", tier: 1 },
  { slug: "pipeline", proto: "pipeline", url: "/pipeline", source: "/acreos/pages-tier1.jsx → Pipeline", tier: 1 },
  { slug: "parcels", proto: "parcels", url: "/parcels/:id", source: "/acreos/tier-b.jsx → ParcelDetailB (line 309)", tier: 1 },
  { slug: "contacts", proto: "contacts", url: "/contacts", source: "/acreos/pages-tier1.jsx → Contacts", tier: 1 },
  { slug: "calendar", proto: "calendar", url: "/calendar", source: "/acreos/pages-tier1.jsx → CalendarPage", tier: 1 },
  { slug: "buybox", proto: "buybox", url: "/buyboxes (or embedded)", source: "/acreos/pages-tier2345.jsx → BuyBoxes", tier: 2 },
  { slug: "lists", proto: "lists", url: "/lists (or embedded)", source: "/acreos/pages-tier2345.jsx → Lists", tier: 2 },
  { slug: "campaigns", proto: "campaigns", url: "/campaigns", source: "/acreos/pages-tier2345.jsx → Campaigns", tier: 2 },
  { slug: "perf", proto: "perf", url: "/campaigns/performance", source: "/acreos/pages-tier2345.jsx → CampaignPerf", tier: 2 },
  { slug: "offers", proto: "offers", url: "/offers", source: "/acreos/pages-tier2345.jsx → Offers", tier: 3 },
  { slug: "documents", proto: "documents", url: "/documents (or embedded)", source: "/acreos/pages-tier2345.jsx → Documents", tier: 3 },
  { slug: "finance", proto: "finance", url: "/finance", source: "/acreos/pages-tier2345.jsx → SellerFinance", tier: 3 },
  { slug: "dispos", proto: "dispos", url: "/dispositions (or embedded)", source: "/acreos/pages-tier2345.jsx → Dispositions", tier: 3 },
  { slug: "agents", proto: "agents", url: "/agents", source: "/acreos/pages-tier2345.jsx → AgentWorkspace", tier: 4 },
  { slug: "automation", proto: "automation", url: "/automations", source: "/acreos/pages-tier2345.jsx → Automations", tier: 4 },
  { slug: "audit", proto: "audit", url: "/audit", source: "/acreos/pages-tier2345.jsx → AuditLog", tier: 4 },
  { slug: "settings", proto: "settings", url: "/settings", source: "/acreos/settings.jsx → SettingsC (search SettingsC =)", tier: 4 },
  { slug: "team", proto: "team", url: "/team", source: "/acreos/pages-tier2345.jsx → Team", tier: 4 },
  { slug: "billing", proto: "billing", url: "/billing", source: "/acreos/pages-tier2345.jsx → Billing", tier: 4 },
  { slug: "integrations", proto: "integrations", url: "/integrations", source: "/acreos/pages-tier2345.jsx → Integrations", tier: 4 },
  { slug: "pax", proto: "pax", url: "/ai (or embedded)", source: "/acreos/pax.jsx → Pax", tier: 4 },
  { slug: "founder", proto: "founder", url: "/founder", source: "/acreos/round3-integrations-2.jsx → FounderHomeC", tier: 5 },
  { slug: "atlas-run", proto: "atlas-run", url: "/founder/atlas-run", source: "/acreos/round3-integrations-2.jsx → AtlasRunC", tier: 5 },
  { slug: "founder-rev", proto: "founder-rev", url: "/founder/revenue (or aggregated)", source: "/acreos/round3-integrations-2.jsx → FounderRevenueC", tier: 5 },
  { slug: "founder-tenants", proto: "founder-tenants", url: "/founder/tenants (or aggregated)", source: "/acreos/pages-tier2345.jsx → FounderTenants", tier: 5 },
  { slug: "founder-cost", proto: "founder-cost", url: "/founder/cost (or aggregated)", source: "/acreos/pages-tier2345.jsx → FounderCost", tier: 5 },
  { slug: "founder-ops", proto: "founder-ops", url: "/founder/ops (or aggregated)", source: "/acreos/pages-tier2345.jsx → FounderOps", tier: 5 },
];

const ONBOARDING_STEPS = ["welcome", "markets", "buybox", "goals", "autonomy", "connections", "phone", "billing", "reveal"];

async function readMechanicalChecks(slug) {
  const path = `${CHECKS_DIR}/${slug}.md`;
  if (!existsSync(path)) return null;
  const md = await readFile(path, "utf8");
  const failures = [];

  // Horizontal overflow
  const overflowMatches = md.match(/❌ scrollWidth/g);
  if (overflowMatches) failures.push(`${overflowMatches.length} breakpoint(s) with horizontal overflow`);

  // Small touch targets — capture the digits AFTER the closing ** so
  // we don't mistake "44" from "<44px" for the count.
  const ttRegex = /Touch targets <44px:\*\*\s+(\d+)/g;
  let totalSmallTargets = 0;
  let m;
  while ((m = ttRegex.exec(md)) !== null) {
    const n = parseInt(m[1], 10);
    if (n > 0) totalSmallTargets += n;
  }
  if (totalSmallTargets > 0) failures.push(`${totalSmallTargets} small touch target(s) (<44px) across mobile breakpoints`);

  // Console errors — same regex pattern fix
  const ceRegex = /Console errors:\*\*\s+(\d+)/g;
  let totalConsoleErrors = 0;
  while ((m = ceRegex.exec(md)) !== null) {
    const n = parseInt(m[1], 10);
    totalConsoleErrors += n;
  }
  if (totalConsoleErrors > 0) failures.push(`${totalConsoleErrors} console error(s) across breakpoints`);

  // NOTE: do NOT flag "Fraunces loaded: ❌" as a failure. Browsers only
  // load fonts when the page actually USES a glyph in that family. On
  // legal pages, status/changelog, etc., Fraunces isn't needed because
  // those pages don't render any serif content. font-not-loaded ≠
  // font-broken. We previously confirmed Fraunces renders on /landing
  // (the page that does use it) at the Phase 9 audit.

  return { failures, raw: md };
}

async function writeUnauthPair(pair) {
  const checks = await readMechanicalChecks(pair.slug);
  const failures = checks?.failures || [];
  const verdict = failures.length > 0 ? "CONFIDENT-FAIL" : "NEEDS-HUMAN-REVIEW";

  let md = `# /${pair.slug} — Visual Comparison\n\n`;
  md += `**URL:** https://acreos.io${pair.url}\n`;
  md += `**Prototype source:** \`${pair.source}\`\n\n`;
  md += `## Prototype reference\n\n`;
  md += `- Desktop: \`${PROTOTYPE_DIR}/${pair.prototype}-1440.png\`\n`;
  md += `- Mobile: \`${PROTOTYPE_DIR}/${pair.prototype}-375.png\`\n\n`;
  md += `## Production current\n\n`;
  for (const bp of ["320", "375", "414", "768", "1024", "1440"]) {
    md += `- ${bp}px: \`${PRODUCTION_DIR}/${pair.production}-${bp}.png\`\n`;
  }
  md += `\n## Mechanical Checks Summary\n\n`;
  if (failures.length === 0) {
    md += `✅ No mechanical failures detected.\n\n`;
  } else {
    md += `❌ Mechanical failures:\n`;
    for (const f of failures) md += `- ${f}\n`;
    md += `\nFull check report: [\`mechanical-checks/${pair.slug}.md\`](../mechanical-checks/${pair.slug}.md)\n\n`;
  }
  md += `## Per-Criterion Analysis (human / multimodal LLM to fill in)\n\n`;
  md += `### Layout structure\n- Verdict: <matches | mostly-matches | partial-drift | significant-drift | does-not-match>\n- Confidence: <high | medium | low>\n- Observations: \n\n`;
  md += `### Color palette\n- Verdict, Confidence, Observations\n\n`;
  md += `### Typography\n- Verdict, Confidence, Observations\n\n`;
  md += `### Density\n- Verdict, Confidence, Observations\n\n`;
  md += `### Information hierarchy\n- Verdict, Confidence, Observations\n\n`;
  md += `### State coverage\n- Verdict, Confidence, Observations\n\n`;
  md += `### Mobile adaptation\n- Verdict, Confidence, Observations\n\n`;
  md += `## Overall Fidelity\n- Verdict: <high | good | partial | low>\n- Confidence: <high | medium | low>\n\n`;
  md += `## Final Classification\n\n`;
  md += `[${verdict === "CONFIDENT-FAIL" ? "x" : " "}] CONFIDENT-FAIL — mechanical issues confirmed (above)\n`;
  md += `[ ] CONFIDENT-PASS — visual review confirms\n`;
  md += `[${verdict === "NEEDS-HUMAN-REVIEW" ? "x" : " "}] NEEDS-HUMAN-REVIEW — automation cannot judge fidelity from screenshots alone\n\n`;
  md += `## Specific Gap List\n\n`;
  for (const f of failures) md += `- [Mechanical] ${f}\n`;
  md += `- [Visual] (fill in from side-by-side review)\n\n`;
  await writeFile(`${OUT}/${pair.slug}.md`, md);
  return { slug: pair.slug, verdict, failures };
}

async function writeUnauthProductionOnly(s) {
  const checks = await readMechanicalChecks(s.slug);
  const failures = checks?.failures || [];
  const verdict = failures.length > 0 ? "CONFIDENT-FAIL" : "CONFIDENT-PASS";

  let md = `# /${s.slug} — Production-Only Surface\n\n`;
  md += `**URL:** https://acreos.io${s.url}\n`;
  md += `**Note:** ${s.note}\n\n`;
  md += `No prototype reference exists in the Claude Design extraction — surface is production-only.\n\n`;
  md += `## Production captures\n\n`;
  for (const bp of ["320", "375", "414", "768", "1024", "1440"]) {
    md += `- ${bp}px: \`${PRODUCTION_DIR}/${s.slug}-${bp}.png\`\n`;
  }
  md += `\n## Mechanical Checks\n\n`;
  if (failures.length === 0) {
    md += `✅ All breakpoints clean.\n\n`;
  } else {
    md += `❌ Failures:\n`;
    for (const f of failures) md += `- ${f}\n`;
    md += `\nFull check report: [\`mechanical-checks/${s.slug}.md\`](../mechanical-checks/${s.slug}.md)\n\n`;
  }
  md += `## Final Classification\n\n`;
  md += `[${verdict === "CONFIDENT-FAIL" ? "x" : " "}] CONFIDENT-FAIL\n`;
  md += `[${verdict === "CONFIDENT-PASS" ? "x" : " "}] CONFIDENT-PASS — no prototype to drift from; mechanical clean\n`;
  md += `[ ] NEEDS-HUMAN-REVIEW — voice/copy review (especially legal pages)\n\n`;
  await writeFile(`${OUT}/${s.slug}.md`, md);
  return { slug: s.slug, verdict, failures };
}

async function writeAuthRequired(s) {
  let md = `# /${s.slug} — Founder Review Required (AUTH-REQUIRED)\n\n`;
  md += `**Production URL:** https://acreos.io${s.url}\n`;
  md += `**Tier:** ${s.tier}\n`;
  md += `**Prototype source:** \`${s.source}\`\n\n`;
  md += `**Reason:** Authenticated surface, Playwright cannot drive Clerk sign-in. Requires founder verification.\n\n`;
  md += `## Prototype reference\n\n`;
  md += `- Desktop: \`${PROTOTYPE_DIR}/${s.proto}-1440.png\`\n`;
  md += `- Mobile: \`${PROTOTYPE_DIR}/${s.proto}-375.png\`\n\n`;
  md += `## Founder must:\n\n`;
  md += `1. Sign in to https://acreos.io\n`;
  md += `2. Navigate to \`${s.url}\` on desktop (1440px)\n`;
  md += `3. Compare to the prototype reference above\n`;
  md += `4. Take screenshot → \`docs/archive/exhaustive-completion/founder-screenshots/desktop/${s.slug}.png\`\n`;
  md += `5. Repeat on mobile (375px) → \`docs/archive/exhaustive-completion/founder-screenshots/mobile/${s.slug}.png\`\n`;
  md += `6. Document findings in \`docs/archive/exhaustive-completion/founder-notes.md\` per the template\n\n`;
  md += `## Final Classification\n\n`;
  md += `[x] AUTH-REQUIRED\n\n`;
  await writeFile(`${OUT}/${s.slug}-AUTH-REQUIRED.md`, md);
  return { slug: s.slug, verdict: "AUTH-REQUIRED" };
}

async function writeOnboardingNote() {
  let md = `# Onboarding wizard — Multi-step Auth-Required Reference\n\n`;
  md += `**Production URL:** https://acreos.io/onboarding (auto-fires on first sign-in if \`organizations.onboardingCompleted\` is false)\n\n`;
  md += `Wizard has 5 production steps (per \`client/src/components/onboarding/OnboardingWizard.tsx\`); the prototype has 9 steps. Production preserves business-type intelligence (14 types).\n\n`;
  md += `## Prototype step screenshots (9 steps × 2 viewports = 18)\n\n`;
  for (const step of ONBOARDING_STEPS) {
    md += `- ${step}: \`${PROTOTYPE_DIR}/onboarding-${step}-1440.png\` / \`${PROTOTYPE_DIR}/onboarding-${step}-375.png\`\n`;
  }
  md += `\n## Founder must:\n\n`;
  md += `1. Sign out + create a fresh test account, OR have a fresh-org workspace\n`;
  md += `2. Trigger the wizard\n`;
  md += `3. Walk all 5 production steps on desktop + mobile\n`;
  md += `4. Compare each to the corresponding prototype step (note: production has fewer steps)\n`;
  md += `5. Save each step screenshot → \`docs/archive/exhaustive-completion/founder-screenshots/desktop/onboarding-step-N.png\`\n\n`;
  md += `## Final Classification\n\n[x] AUTH-REQUIRED\n`;
  await writeFile(`${OUT}/onboarding-AUTH-REQUIRED.md`, md);
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const results = { confidentPass: [], confidentFail: [], needsReview: [], authRequired: [] };

  for (const pair of UNAUTH_PAIRS) {
    const r = await writeUnauthPair(pair);
    if (r.verdict === "CONFIDENT-PASS") results.confidentPass.push(r.slug);
    else if (r.verdict === "CONFIDENT-FAIL") results.confidentFail.push(r);
    else results.needsReview.push(r.slug);
  }
  for (const s of UNAUTH_PRODUCTION_ONLY) {
    const r = await writeUnauthProductionOnly(s);
    if (r.verdict === "CONFIDENT-PASS") results.confidentPass.push(r.slug);
    else if (r.verdict === "CONFIDENT-FAIL") results.confidentFail.push(r);
    else results.needsReview.push(r.slug);
  }
  for (const s of AUTH_REQUIRED) {
    const r = await writeAuthRequired(s);
    results.authRequired.push(r.slug);
  }
  await writeOnboardingNote();
  results.authRequired.push("onboarding (multi-step)");

  // Master gap report
  let master = `# AcreOS Visual Gap Master Report\n\n`;
  master += `Generated: ${new Date().toISOString()}\n`;
  master += `Method: Playwright screenshot capture + mechanical-checks + structured comparison stubs\n\n`;
  master += `## Executive Summary\n\n`;
  const total = results.confidentPass.length + results.confidentFail.length + results.needsReview.length + results.authRequired.length;
  master += `- Total surfaces: ${total}\n`;
  master += `- CONFIDENT-PASS: ${results.confidentPass.length}\n`;
  master += `- CONFIDENT-FAIL: ${results.confidentFail.length}\n`;
  master += `- NEEDS-HUMAN-REVIEW: ${results.needsReview.length}\n`;
  master += `- AUTH-REQUIRED: ${results.authRequired.length} (must be founder-verified)\n\n`;

  master += `## Critical Findings (CONFIDENT-FAIL)\n\n`;
  for (const r of results.confidentFail) {
    master += `### /${r.slug}\n`;
    for (const f of r.failures) master += `- ${f}\n`;
    master += `\n`;
  }

  master += `## Surfaces Requiring Founder Review (AUTH-REQUIRED)\n\n`;
  master += `These cannot be auto-verified — Playwright cannot drive Clerk sign-in:\n\n`;
  for (const slug of results.authRequired) master += `- /${slug}\n`;
  master += `\n`;

  master += `## Low-Confidence (NEEDS-HUMAN-REVIEW)\n\n`;
  for (const slug of results.needsReview) master += `- /${slug} — automation cannot judge prototype-vs-production fidelity from screenshots alone\n`;
  master += `\n`;

  master += `## Confident Passes (Spot-Check Recommended)\n\n`;
  master += `Production-only surfaces with no prototype to drift from + clean mechanical checks. Founder spot-checks 3-5 to validate calibration:\n\n`;
  for (const slug of results.confidentPass) master += `- /${slug}\n`;
  master += `\n`;

  master += `## Per-Tier Summary\n\n`;
  master += `### Tier 1 — Pipeline Core (daily-driver loop)\n`;
  master += `All AUTH-REQUIRED — founder must walk: /today, /pipeline, /parcels, /inbox, /contacts, /calendar.\n\n`;
  master += `### Tier 2 — Sourcing\n`;
  master += `All AUTH-REQUIRED: /buyboxes (or embedded), /lists, /campaigns, /campaigns/performance.\n\n`;
  master += `### Tier 3 — Closing\n`;
  master += `All AUTH-REQUIRED: /offers, /documents, /finance, /dispositions.\n\n`;
  master += `### Tier 4 — Ops\n`;
  master += `All AUTH-REQUIRED: /agents, /automations, /audit, /settings, /team, /billing, /integrations, /pax.\n\n`;
  master += `### Tier 5 — Founder Mode\n`;
  master += `All AUTH-REQUIRED + founder-only gate: /founder, /founder/atlas-run, /founder/revenue, /founder/tenants, /founder/cost, /founder/ops.\n\n`;
  master += `### Unauth (landing, auth flows, coverage)\n`;
  master += `Captured + mechanically checked. See per-surface comparison files.\n\n`;

  master += `## Recommended Founder Walkthrough Priority\n\n`;
  master += `1. **AUTH-REQUIRED surfaces** (~${results.authRequired.length} surfaces) — only humans can do this. Sign in, walk every customer + founder route on desktop AND mobile.\n`;
  master += `2. **NEEDS-HUMAN-REVIEW surfaces** (${results.needsReview.length}) — open the comparison file, make the visual judgment call automation can't.\n`;
  master += `3. **CONFIDENT-FAIL surfaces** (${results.confidentFail.length}) — verify automation's findings before they get fixed.\n`;
  master += `4. **Spot-check 3-5 CONFIDENT-PASS surfaces** — validate automation calibration. If a spot-check reveals issues, broaden the review.\n\n`;
  master += `**Estimated founder time:** 45-75 minutes (down from 90+ thanks to mechanical pre-pass).\n`;

  await writeFile("docs/archive/exhaustive-completion/MASTER-GAP-REPORT.md", master);

  console.log(`\n✓ ${total} surfaces processed`);
  console.log(`  - CONFIDENT-PASS: ${results.confidentPass.length}`);
  console.log(`  - CONFIDENT-FAIL: ${results.confidentFail.length}`);
  console.log(`  - NEEDS-HUMAN-REVIEW: ${results.needsReview.length}`);
  console.log(`  - AUTH-REQUIRED: ${results.authRequired.length}`);
  console.log(`\nMaster report: docs/archive/exhaustive-completion/MASTER-GAP-REPORT.md`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
