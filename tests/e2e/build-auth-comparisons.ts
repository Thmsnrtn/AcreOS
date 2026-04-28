/* eslint-disable no-console */
/**
 * 1.1.B — Build per-surface comparison reports for authenticated surfaces.
 *
 * Reads:
 *   - docs/exhaustive-completion/auth-screenshots/_capture-report.json
 *   - docs/exhaustive-completion/visual-comparisons/<slug>-AUTH-REQUIRED.md (existing stubs)
 *
 * Writes per-surface comparison reports overwriting the stubs with:
 *   - Prototype reference paths
 *   - Production capture paths (this run)
 *   - Capture metadata (file size, console errors, final URL)
 *   - Provisional verdict heuristic:
 *     - CONFIDENT-FAIL if final URL redirected to /auth, file size < 30KB,
 *       or console errors include obvious 500/render failures
 *     - NEEDS-HUMAN-REVIEW otherwise (pixel comparison happens in picker)
 *   - Fix-candidate notes when applicable
 *
 * REMOVE_BEFORE_LAUNCH (Gap 1.1.G) — this script is dev-phase tooling.
 */

import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(process.cwd(), 'docs/exhaustive-completion');
const SHOTS_DIR = path.join(ROOT, 'auth-screenshots');
const PROTO_DIR = path.join(ROOT, 'prototype-screenshots');
const COMPARISONS_DIR = path.join(ROOT, 'visual-comparisons');

interface CaptureResult {
  slug: string;
  bp: string;
  status: 'ok' | 'error';
  url: string;
  finalUrl?: string;
  errors: string[];
  filePath?: string;
}

const SLUG_TO_PATH: Record<string, string> = {
  home: '/today',
  pipeline: '/pipeline',
  parcels: '/parcels/81',
  inbox: '/inbox',
  contacts: '/contacts',
  calendar: '/calendar',
  buybox: '/buyboxes',
  lists: '/lists',
  campaigns: '/campaigns',
  perf: '/campaigns/performance',
  offers: '/offers',
  documents: '/documents',
  finance: '/finance',
  dispos: '/dispositions',
  agents: '/agents',
  automation: '/automations',
  audit: '/audit',
  settings: '/settings',
  team: '/team',
  billing: '/billing',
  integrations: '/integrations',
  pax: '/ai',
  founder: '/founder',
  'atlas-run': '/founder/atlas-run',
  'founder-rev': '/founder/revenue',
  'founder-tenants': '/founder/tenants',
  'founder-cost': '/founder/cost',
  'founder-ops': '/founder/ops',
};

interface SurfaceVerdict {
  classification: 'CONFIDENT-PASS' | 'CONFIDENT-FAIL' | 'NEEDS-HUMAN-REVIEW';
  reasons: string[];
  fixCandidates: string[];
}

function classify(slug: string, results: { desktop: CaptureResult | null; mobile: CaptureResult | null }): SurfaceVerdict {
  const reasons: string[] = [];
  const fixCandidates: string[] = [];
  const failures: string[] = [];
  const reviewNotes: string[] = [];

  for (const [bp, r] of [['desktop', results.desktop] as const, ['mobile', results.mobile] as const]) {
    if (!r) continue;
    const filePath = path.join(SHOTS_DIR, `${slug}-${r.bp}.png`);
    const size = fs.existsSync(filePath) ? fs.statSync(filePath).size : 0;

    // Redirect to /auth = unauthenticated render → CONFIDENT-FAIL (real)
    if (r.finalUrl && /\/auth\b/.test(r.finalUrl)) {
      failures.push(`${bp}: redirected to ${r.finalUrl} (auth lost)`);
      fixCandidates.push(`investigate why ${slug} ${bp} redirected to /auth — Clerk session invalidation?`);
    }
    // Tiny screenshot (<30KB) suggests blank/loading/error state
    else if (size > 0 && size < 30_000) {
      failures.push(`${bp}: screenshot only ${(size / 1024).toFixed(0)}KB — likely blank/loading/error`);
    }

    // Hard JS errors with obvious render-blockers — real fail signal
    const renderBlocking = r.errors.filter((e) =>
      /is not a function|TypeError|ReferenceError|Cannot read|Cannot access/.test(e)
    );
    if (renderBlocking.length > 0) {
      failures.push(`${bp}: ${renderBlocking.length} render-blocking JS error(s) — first: ${renderBlocking[0].slice(0, 120)}`);
      for (const err of renderBlocking.slice(0, 2)) {
        fixCandidates.push(`fix JS error: ${err.slice(0, 140)}`);
      }
    }

    // Rate-limited = capture-time transient, not a product bug. Note it for
    // founder visibility but don't fail the surface on this signal alone.
    const ratelimited = r.errors.some((e) => /\b429\b/.test(e));
    if (ratelimited) {
      reviewNotes.push(`${bp}: hit rate limit (429) during rapid capture sequence — likely transient, re-capture to confirm`);
    }
  }

  reasons.push(...failures);
  reasons.push(...reviewNotes);

  if (failures.length > 0) {
    return { classification: 'CONFIDENT-FAIL', reasons, fixCandidates };
  }
  // No hard fail signals → needs human visual review against prototype
  reasons.push('No render-blocking errors or auth redirects detected. Pixel-level comparison vs prototype required to classify pass/fail.');
  return {
    classification: 'NEEDS-HUMAN-REVIEW',
    reasons,
    fixCandidates,
  };
}

function generateReport(slug: string, surfacePath: string, results: { desktop: CaptureResult | null; mobile: CaptureResult | null }, verdict: SurfaceVerdict): string {
  const protoDesktop = path.join('prototype-screenshots', `${slug}-1440.png`);
  const protoMobile = path.join('prototype-screenshots', `${slug}-375.png`);
  const protoDesktopExists = fs.existsSync(path.join(PROTO_DIR, `${slug}-1440.png`));
  const protoMobileExists = fs.existsSync(path.join(PROTO_DIR, `${slug}-375.png`));

  const desktopShot = path.join('auth-screenshots', `${slug}-1440.png`);
  const mobileShot = path.join('auth-screenshots', `${slug}-375.png`);

  const lines: string[] = [];
  lines.push(`# ${surfacePath} — Auth-gated visual comparison (1.1.B)`);
  lines.push('');
  lines.push(`**Production URL:** https://acreos.io${surfacePath}`);
  lines.push(`**Captured:** ${new Date().toISOString()} via Playwright + dev-bypass Clerk sign-in token`);
  lines.push('');
  lines.push('## Prototype reference');
  lines.push('');
  lines.push(`- Desktop (1440): \`${protoDesktop}\` ${protoDesktopExists ? '' : '_(missing)_'}`);
  lines.push(`- Mobile (375):  \`${protoMobile}\` ${protoMobileExists ? '' : '_(missing)_'}`);
  lines.push('');
  lines.push('## Production capture (this run)');
  lines.push('');
  lines.push(`- Desktop (1440): \`${desktopShot}\``);
  lines.push(`- Mobile (375):  \`${mobileShot}\``);
  lines.push('');

  lines.push('## Capture metadata');
  lines.push('');
  lines.push('| Breakpoint | File size | Final URL | Issues |');
  lines.push('|---|---|---|---|');
  for (const [bp, r] of [['1440', results.desktop] as const, ['375', results.mobile] as const]) {
    if (!r) {
      lines.push(`| ${bp} | (no capture) | — | — |`);
      continue;
    }
    const filePath = path.join(SHOTS_DIR, `${slug}-${r.bp}.png`);
    const size = fs.existsSync(filePath) ? `${(fs.statSync(filePath).size / 1024).toFixed(0)}KB` : '—';
    const finalUrl = r.finalUrl && r.finalUrl !== r.url ? r.finalUrl : '(no redirect)';
    lines.push(`| ${bp} | ${size} | ${finalUrl} | ${r.errors.length} |`);
  }
  lines.push('');

  // Errors detail if any
  for (const [bp, r] of [['Desktop (1440)', results.desktop] as const, ['Mobile (375)', results.mobile] as const]) {
    if (r && r.errors.length > 0) {
      lines.push(`### ${bp} console issues`);
      lines.push('');
      lines.push('```');
      for (const err of r.errors.slice(0, 8)) {
        lines.push(err.slice(0, 200));
      }
      if (r.errors.length > 8) lines.push(`... and ${r.errors.length - 8} more`);
      lines.push('```');
      lines.push('');
    }
  }

  lines.push('## Provisional verdict');
  lines.push('');
  lines.push(`**Classification:** ${verdict.classification}`);
  lines.push('');
  if (verdict.reasons.length > 0) {
    lines.push('**Reasons:**');
    for (const r of verdict.reasons) lines.push(`- ${r}`);
    lines.push('');
  }
  if (verdict.fixCandidates.length > 0) {
    lines.push('**Fix candidates (1.1.C):**');
    for (const f of verdict.fixCandidates) lines.push(`- ${f}`);
    lines.push('');
  }

  lines.push('## Notes');
  lines.push('');
  lines.push('Provisional verdict from automated capture analysis. Pixel-level comparison vs prototype happens in 1.1.D picker via three-panel view.');
  if (verdict.classification === 'NEEDS-HUMAN-REVIEW') {
    lines.push('');
    lines.push('No automatic fail signal detected. Open both shots side-by-side to verify visual fidelity vs prototype.');
  }
  lines.push('');

  return lines.join('\n');
}

function main() {
  const reportPath = path.join(SHOTS_DIR, '_capture-report.json');
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8')) as { results: CaptureResult[] };

  // Group results by slug
  const bySlug: Record<string, { desktop: CaptureResult | null; mobile: CaptureResult | null }> = {};
  for (const r of report.results) {
    if (!bySlug[r.slug]) bySlug[r.slug] = { desktop: null, mobile: null };
    if (r.bp === '1440') bySlug[r.slug].desktop = r;
    else if (r.bp === '375') bySlug[r.slug].mobile = r;
  }

  let confidentPass = 0;
  let confidentFail = 0;
  let needsReview = 0;

  for (const [slug, results] of Object.entries(bySlug)) {
    const surfacePath = SLUG_TO_PATH[slug] ?? `/${slug}`;
    const verdict = classify(slug, results);
    const md = generateReport(slug, surfacePath, results, verdict);
    const outPath = path.join(COMPARISONS_DIR, `${slug}-AUTH-REQUIRED.md`);
    fs.writeFileSync(outPath, md);

    if (verdict.classification === 'CONFIDENT-PASS') confidentPass++;
    else if (verdict.classification === 'CONFIDENT-FAIL') confidentFail++;
    else needsReview++;

    console.log(`  ${verdict.classification.padEnd(20)} ${slug}`);
  }

  console.log('');
  console.log(`CONFIDENT-PASS: ${confidentPass}`);
  console.log(`CONFIDENT-FAIL: ${confidentFail}`);
  console.log(`NEEDS-HUMAN-REVIEW: ${needsReview}`);
  console.log(`Total: ${confidentPass + confidentFail + needsReview}`);
}

main();
