/* eslint-disable no-console */
/**
 * 1.1.B — Capture authenticated surfaces with the dev founder bypass header.
 *
 * Run:
 *   DEV_FOUNDER_BYPASS_SECRET=$(cat .dev-bypass-secret) \
 *     npx tsx tests/e2e/capture-auth-surfaces.ts
 *
 * REMOVE_BEFORE_LAUNCH (Gap 1.1.G) along with the bypass module — this
 * script is dev-phase visual-verification tooling only.
 */

import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

const SECRET = process.env.DEV_FOUNDER_BYPASS_SECRET;
if (!SECRET) {
  console.error('FATAL: DEV_FOUNDER_BYPASS_SECRET not set');
  process.exit(1);
}

const HOST = process.env.CAPTURE_HOST ?? 'https://acreos.io';
const OUT_DIR = path.resolve(process.cwd(), 'docs/exhaustive-completion/auth-screenshots');

interface Surface {
  slug: string;
  pathname: string;
  tier: number;
  notes?: string;
}

const SURFACES: Surface[] = [
  // Tier 1
  { slug: 'home', pathname: '/today', tier: 1 },
  { slug: 'pipeline', pathname: '/pipeline', tier: 1 },
  { slug: 'parcels', pathname: '/parcels/81', tier: 1, notes: 'sample lead 81' },
  { slug: 'inbox', pathname: '/inbox', tier: 1 },
  { slug: 'contacts', pathname: '/contacts', tier: 1 },
  { slug: 'calendar', pathname: '/calendar', tier: 1 },
  // Tier 2
  { slug: 'buybox', pathname: '/buyboxes', tier: 2 },
  { slug: 'lists', pathname: '/lists', tier: 2 },
  { slug: 'campaigns', pathname: '/campaigns', tier: 2 },
  { slug: 'perf', pathname: '/campaigns/performance', tier: 2 },
  // Tier 3
  { slug: 'offers', pathname: '/offers', tier: 3 },
  { slug: 'documents', pathname: '/documents', tier: 3 },
  { slug: 'finance', pathname: '/finance', tier: 3 },
  { slug: 'dispos', pathname: '/dispositions', tier: 3 },
  // Tier 4
  { slug: 'agents', pathname: '/agents', tier: 4 },
  { slug: 'automation', pathname: '/automations', tier: 4 },
  { slug: 'audit', pathname: '/audit', tier: 4 },
  { slug: 'settings', pathname: '/settings', tier: 4 },
  { slug: 'team', pathname: '/team', tier: 4 },
  { slug: 'billing', pathname: '/billing', tier: 4 },
  { slug: 'integrations', pathname: '/integrations', tier: 4 },
  { slug: 'pax', pathname: '/ai', tier: 4 },
  // Tier 5
  { slug: 'founder', pathname: '/founder', tier: 5 },
  { slug: 'atlas-run', pathname: '/founder/atlas-run', tier: 5 },
  { slug: 'founder-rev', pathname: '/founder/revenue', tier: 5 },
  { slug: 'founder-tenants', pathname: '/founder/tenants', tier: 5 },
  { slug: 'founder-cost', pathname: '/founder/cost', tier: 5 },
  { slug: 'founder-ops', pathname: '/founder/ops', tier: 5 },
];

const BREAKPOINTS = [
  { width: 1440, height: 900, label: '1440' },
  { width: 375, height: 812, label: '375' },
];

interface CaptureResult {
  slug: string;
  bp: string;
  status: 'ok' | 'error';
  url: string;
  finalUrl?: string;
  errors: string[];
  filePath?: string;
}

async function captureSurface(
  page: Page,
  surface: Surface,
  bp: typeof BREAKPOINTS[number]
): Promise<CaptureResult> {
  const errors: string[] = [];
  // Per-surface listeners — attach + detach so we don't accumulate
  const onPageError = (err: Error) => errors.push(`pageerror: ${err.message}`);
  const onConsole = (msg: { type(): string; text(): string }) => {
    if (msg.type() === 'error') errors.push(`console.error: ${msg.text().slice(0, 200)}`);
  };
  page.on('pageerror', onPageError);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  page.on('console', onConsole as any);

  const url = `${HOST}${surface.pathname}`;
  const result: CaptureResult = { slug: surface.slug, bp: bp.label, status: 'ok', url, errors };

  try {
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    if (!response) {
      result.status = 'error';
      errors.push('no response');
    } else {
      result.finalUrl = page.url();
      await page
        .waitForLoadState('networkidle', { timeout: 8000 })
        .catch(() => errors.push('networkidle timeout (non-fatal)'));
      // Wait for SPA loading state to clear — "Loading AcreOS..." appears
      // during initial chunk-load + Clerk hydration. If it's gone or never
      // appeared, we're rendered.
      await page
        .waitForFunction(
          () => !document.body?.innerText?.includes('Loading AcreOS'),
          undefined,
          { timeout: 8000 }
        )
        .catch(() => errors.push('loading-state-stuck (non-fatal)'));
      // Settle: data fetches, animations, lazy-loaded content
      await page.waitForTimeout(1500);
    }

    const filePath = path.join(OUT_DIR, `${surface.slug}-${bp.label}.png`);
    await page.screenshot({ path: filePath, fullPage: true });
    result.filePath = filePath;
  } catch (err: unknown) {
    result.status = 'error';
    errors.push(`navigate/screenshot: ${(err as Error).message}`);
  } finally {
    page.off('pageerror', onPageError);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    page.off('console', onConsole as any);
  }

  return result;
}

async function ensureSignedIn(page: Page): Promise<boolean> {
  // Quick check via window.Clerk.user
  const signedIn = await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = (window as any).Clerk;
    return Boolean(c?.user?.id);
  }).catch(() => false);
  return signedIn;
}

async function reSignIn(page: Page): Promise<boolean> {
  console.log('[re-signin] fetching new token');
  const tokenResp = await page.context().request.get(`${HOST}/api/__dev/signin-token`, {
    headers: { 'X-Dev-Founder-Bypass': SECRET! },
  });
  if (!tokenResp.ok()) return false;
  const { token } = (await tokenResp.json()) as { token: string };
  await page.goto(`${HOST}/auth`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(
    () => typeof (window as unknown as { Clerk?: unknown }).Clerk !== 'undefined' &&
      Boolean((window as unknown as { Clerk?: { loaded?: boolean } }).Clerk?.loaded),
    undefined,
    { timeout: 15000 }
  );
  const result = await page.evaluate(async (ticket: string) => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const Clerk = (window as any).Clerk;
      const signInAttempt = await Clerk.client.signIn.create({ strategy: 'ticket', ticket });
      if (signInAttempt.status !== 'complete') return { ok: false };
      await Clerk.setActive({ session: signInAttempt.createdSessionId });
      return { ok: true };
    } catch {
      return { ok: false };
    }
  }, token);
  await page.waitForTimeout(1000);
  return result.ok;
}

async function primeClerkSession(page: Page): Promise<boolean> {
  console.log('[prime] fetching sign-in token');
  const tokenResp = await page.context().request.get(`${HOST}/api/__dev/signin-token`, {
    headers: { 'X-Dev-Founder-Bypass': SECRET! },
  });
  if (!tokenResp.ok()) {
    console.error(`[prime] token fetch failed: ${tokenResp.status()} ${await tokenResp.text()}`);
    return false;
  }
  const { token } = (await tokenResp.json()) as { token: string };
  console.log(`[prime] got token (${token.length} chars)`);

  console.log('[prime] navigating to /auth to load window.Clerk');
  await page.goto(`${HOST}/auth`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(
    () => typeof (window as unknown as { Clerk?: unknown }).Clerk !== 'undefined' &&
      Boolean((window as unknown as { Clerk?: { loaded?: boolean } }).Clerk?.loaded),
    undefined,
    { timeout: 15000 }
  );
  console.log('[prime] window.Clerk loaded — redeeming ticket');

  const result = await page.evaluate(async (ticket: string) => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const Clerk = (window as any).Clerk;
      const signInAttempt = await Clerk.client.signIn.create({ strategy: 'ticket', ticket });
      if (signInAttempt.status !== 'complete') {
        return { ok: false, status: signInAttempt.status, error: 'incomplete' };
      }
      await Clerk.setActive({ session: signInAttempt.createdSessionId });
      return { ok: true, sessionId: signInAttempt.createdSessionId };
    } catch (err: unknown) {
      return { ok: false, error: (err as Error)?.message ?? String(err) };
    }
  }, token);

  console.log(`[prime] redemption result: ${JSON.stringify(result)}`);
  if (!result.ok) return false;

  await page.waitForTimeout(1500);
  return true;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  console.log(`[1.1.B] Capturing ${SURFACES.length} surfaces × ${BREAKPOINTS.length} breakpoints = ${SURFACES.length * BREAKPOINTS.length} screenshots`);
  console.log(`[1.1.B] Host: ${HOST}`);
  console.log(`[1.1.B] Out:  ${OUT_DIR}`);

  const browser: Browser = await chromium.launch();
  const results: CaptureResult[] = [];

  // Fresh context + prime per breakpoint. Clerk's in-memory state is
  // viewport-sensitive in ways we don't fully understand — new context
  // gives a clean slate each time.
  for (const bp of BREAKPOINTS) {
    console.log(`\n=== ${bp.label}px ===`);
    const context: BrowserContext = await browser.newContext({
      extraHTTPHeaders: { 'X-Dev-Founder-Bypass': SECRET! },
      viewport: { width: bp.width, height: bp.height },
      deviceScaleFactor: 1,
    });

    const page = await context.newPage();
    const primed = await primeClerkSession(page);
    if (!primed) {
      console.error(`[${bp.label}] ABORT: Clerk session not established for this breakpoint.`);
      await context.close();
      continue;
    }

    for (const surface of SURFACES) {
      const r = await captureSurface(page, surface, bp);
      results.push(r);
      const tag = r.status === 'ok' ? '✓' : '✗';
      const errSuffix = r.errors.length ? ` (${r.errors.length} issues)` : '';
      const finalSuffix = r.finalUrl && r.finalUrl !== r.url ? ` → ${r.finalUrl}` : '';
      console.log(`  ${tag} ${surface.slug.padEnd(18)} ${surface.pathname.padEnd(28)}${finalSuffix}${errSuffix}`);
    }

    await page.close();
    await context.close();
  }

  await browser.close();

  // Write capture report
  const reportPath = path.join(OUT_DIR, '_capture-report.json');
  fs.writeFileSync(reportPath, JSON.stringify({ timestamp: new Date().toISOString(), host: HOST, results }, null, 2));
  console.log(`\nWrote capture report: ${reportPath}`);

  const okCount = results.filter((r) => r.status === 'ok').length;
  const errCount = results.length - okCount;
  console.log(`\n${okCount}/${results.length} captures successful, ${errCount} errors`);

  if (errCount > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
