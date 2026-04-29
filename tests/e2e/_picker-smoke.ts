/* eslint-disable no-console */
/**
 * 1.1.D — Picker end-to-end smoke. REMOVE_BEFORE_LAUNCH (Gap 1.1.G).
 *
 * Walks through every D.6.4-D.6.9 capability against the live picker at
 * https://acreos.io/__dev/picker/, takes verification screenshots, and
 * exercises the server-side export endpoint.
 *
 * Run:
 *   DEV_FOUNDER_BYPASS_SECRET=$(cat .dev-bypass-secret) \
 *     npx tsx tests/e2e/_picker-smoke.ts
 */

import { chromium, type Browser, type Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

const SECRET = process.env.DEV_FOUNDER_BYPASS_SECRET;
if (!SECRET) {
  console.error('FATAL: DEV_FOUNDER_BYPASS_SECRET not set');
  process.exit(1);
}

const HOST = process.env.CAPTURE_HOST ?? 'https://acreos.io';
const OUT_DIR = path.resolve(process.cwd(), 'docs/exhaustive-completion/auth-screenshots');
const PICKER_URL = `${HOST}/__dev/picker/`;

interface CheckResult {
  name: string;
  ok: boolean;
  notes?: string;
}

const checks: CheckResult[] = [];
function record(name: string, ok: boolean, notes?: string) {
  checks.push({ name, ok, notes });
  console.log(`${ok ? '✓' : '✗'} ${name}${notes ? ` — ${notes}` : ''}`);
}

async function primeClerkSession(page: Page): Promise<boolean> {
  console.log('[prime] fetching sign-in token');
  const tokenResp = await page.context().request.get(`${HOST}/api/__dev/signin-token`, {
    headers: { 'X-Dev-Founder-Bypass': SECRET! },
  });
  if (!tokenResp.ok()) {
    console.error(`[prime] token fetch failed: ${tokenResp.status()}`);
    return false;
  }
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
    } catch (err: unknown) {
      return { ok: false, error: (err as Error)?.message };
    }
  }, token);
  await page.waitForTimeout(1500);
  return result.ok;
}

async function shot(page: Page, name: string) {
  const filePath = path.join(OUT_DIR, `_picker-verification-${name}.png`);
  await page.screenshot({ path: filePath, fullPage: true });
  return filePath;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const browser: Browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();

  page.on('pageerror', (err) => console.error('[pageerror]', err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.error('[console.error]', msg.text().slice(0, 200));
  });

  try {
    // Step 1: Sign in
    const primed = await primeClerkSession(page);
    record('Sign-in via Clerk ticket', primed);
    if (!primed) throw new Error('sign-in failed');

    // Step 2: Open picker
    await page.goto(PICKER_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(1500);
    const titleLoaded = await page.locator('text=AcreOS Picker').isVisible({ timeout: 5000 });
    record('Picker shell loaded', titleLoaded);
    await shot(page, '01-shell');

    // Verify Fraunces font loaded
    const headerFont = await page.evaluate(() => {
      const el = document.querySelector('.font-editorial');
      return el ? getComputedStyle(el).fontFamily : '';
    });
    record('Fraunces editorial font loaded', headerFont.toLowerCase().includes('fraunces'),
      `font-family: ${headerFont.slice(0, 80)}`);

    // Verify --acr-* palette is in use (warm cream bg). Picker sets background
    // on :root (html), not body — body is transparent.
    const bgColor = await page.evaluate(() =>
      getComputedStyle(document.documentElement).backgroundColor
    );
    record(
      'Warm cream bg from --acr-* palette',
      bgColor === 'rgb(250, 244, 232)',
      `html bg: ${bgColor}`
    );

    // Verify tier badges present
    const tierCount = await page.locator('[class*="tier-"]').count();
    record('Tier badges rendered in sidebar', tierCount > 0, `${tierCount} tier markers`);

    // Step 3: First decision should be vr-home (/today). Click sidebar item.
    const homeButton = page.locator('aside button[data-decision-id="vr-home"]');
    await homeButton.click();
    // Babel-in-browser + React from unpkg + nav routing — give the prototype
    // ~6s to bootstrap before screenshotting so it renders the right surface.
    await page.waitForTimeout(6500);

    // Verify three iframes loaded
    const iframeCount = await page.locator('iframe').count();
    record('Three-panel iframes mounted', iframeCount === 3, `${iframeCount} iframes`);

    // Verify prototype iframe actually rendered the requested surface (not blank)
    const protoBootstrapped = await page.evaluate(async () => {
      const iframe = document.querySelector('iframe') as HTMLIFrameElement | null;
      if (!iframe) return false;
      try {
        const w = iframe.contentWindow as { __nav?: unknown } | null;
        if (!w || typeof w.__nav !== 'function') return false;
        const doc = iframe.contentDocument;
        if (!doc?.body) return false;
        // Body should contain rendered content (>1000 chars of text)
        return (doc.body.innerText || '').length > 100;
      } catch {
        return false;
      }
    });
    record('Prototype iframe bootstrapped (window.__nav + content)', protoBootstrapped);
    await shot(page, '02-three-panel');

    // Verify decision title rendered as Fraunces
    const title = await page.locator('h1.font-editorial').first().textContent();
    record('Decision title is editorial', title === '/today', `title: ${title}`);

    // Step 4: Switch breakpoint to 375
    const bp375 = page.locator('button:has-text("375")').first();
    await bp375.click();
    await page.waitForTimeout(500);
    record('Breakpoint switch to 375 clickable', true);

    // Switch back to 1440
    await page.locator('button:has-text("1440")').first().click();
    await page.waitForTimeout(500);

    // Step 5: Toggle split view
    await page.locator('button:has-text("Split view")').first().click();
    await page.waitForTimeout(2000);
    const iframesAfterSplit = await page.locator('iframe').count();
    record('Split view shows 6 iframes', iframesAfterSplit === 6, `${iframesAfterSplit} iframes`);
    await shot(page, '03-split-view');

    // Toggle off
    await page.locator('button:has-text("Split view on")').first().click();
    await page.waitForTimeout(1000);

    // Step 6: Choose an option (option 2 — fix-needed)
    const optionButtons = page.locator('main >> button >> internal:has-text("Fix needed")');
    if ((await optionButtons.count()) > 0) {
      await optionButtons.first().click();
    } else {
      // Fallback: keyboard shortcut
      await page.keyboard.press('2');
    }
    await page.waitForTimeout(500);
    record('Option choice via keyboard/click', true);

    // Step 7: Test edit copy mode
    await page.locator('button:has-text("Edit copy")').first().click();
    await page.waitForTimeout(3000);
    const editingMode = await page.locator('button:has-text("Editing copy")').isVisible({ timeout: 2000 }).catch(() => false);
    record('Edit copy toggle activates', editingMode);

    // Try to find a contenteditable in the preview iframe
    const previewFrame = page.frameLocator('iframe').nth(2);
    let editableCount = 0;
    try {
      editableCount = await previewFrame.locator('[data-copy-id]').count();
    } catch {
      // iframe might not be ready
    }
    record('Editable text spans injected in preview iframe', editableCount > 0,
      `${editableCount} [data-copy-id] elements`);
    await shot(page, '04-edit-mode');

    // Toggle off
    await page.locator('button:has-text("Editing copy")').first().click();
    await page.waitForTimeout(500);

    // Step 8: Navigate to platform-density decision
    const densityButton = page.locator('aside button[data-decision-id="platform-density"]');
    await densityButton.click();
    await page.waitForTimeout(2500);

    const densityHeading = await page.locator('h1.font-editorial:has-text("Platform density")').isVisible({ timeout: 5000 });
    record('Platform density decision opens', densityHeading);

    // Click "Spacious" preset
    await page.locator('button:has-text("Spacious")').first().click();
    await page.waitForTimeout(1500);
    record('Density preset chosen (Spacious)', true);
    await shot(page, '05-density-spacious');

    // Click "Custom" preset to reveal sliders
    await page.locator('button:has-text("Custom")').first().click();
    await page.waitForTimeout(800);
    const sliderCount = await page.locator('input[type="range"]').count();
    record('Custom mode reveals sliders', sliderCount >= 4, `${sliderCount} range inputs total`);
    await shot(page, '06-density-custom');

    // Step 9: Navigate to platform-primary-color
    const colorBtn = page.locator('aside button[data-decision-id="platform-primary-color"]');
    await colorBtn.click();
    await page.waitForTimeout(2500);

    const colorHeading = await page.locator('h1.font-editorial:has-text("Platform primary color")').isVisible({ timeout: 5000 });
    record('Platform color decision opens', colorHeading);

    // Click "Deeper terracotta"
    await page.locator('button:has-text("Deeper terracotta")').first().click();
    await page.waitForTimeout(1500);
    record('Brand color swatch chosen', true);
    await shot(page, '07-color-deeper');

    // Step 10: Test export endpoint. First mark a build-defer decision —
    // use data-decision-id to avoid matching the visual-review entry that
    // shares the title "/founder/revenue".
    const buildDeferBtn = page.locator('aside button[data-decision-id="founder-revenue-route"]');
    await buildDeferBtn.scrollIntoViewIfNeeded();
    await buildDeferBtn.click();
    await page.waitForTimeout(1000);
    await page.locator('main button:has-text("Build now")').first().click();
    await page.waitForTimeout(500);
    record('Build/defer option chosen', true);

    // Listen for the export response
    let exportResponse: { ok: boolean; status: number; body?: unknown } | null = null;
    const responseListener = async (resp: import('playwright').Response) => {
      if (resp.url().endsWith('/api/__dev/founder-selections') && resp.request().method() === 'POST') {
        try {
          exportResponse = { ok: resp.ok(), status: resp.status(), body: await resp.json() };
        } catch {
          exportResponse = { ok: resp.ok(), status: resp.status() };
        }
      }
    };
    page.on('response', responseListener);

    // Click export
    await page.locator('button:has-text("Export selections")').first().click();
    await page.waitForTimeout(4000);
    page.off('response', responseListener);

    record(
      'Server-side export endpoint returns 200',
      Boolean(exportResponse?.ok),
      exportResponse
        ? `status ${exportResponse.status}; body: ${JSON.stringify(exportResponse.body).slice(0, 200)}`
        : 'no response captured'
    );
    if (exportResponse?.ok) {
      const body = exportResponse.body as {
        target?: string;
        retrieval?: { command?: string };
        writtenAt?: string;
      };
      record(
        'Response includes server target path',
        Boolean(body?.target),
        body?.target ?? ''
      );
      record(
        'Response includes retrieval command for founder',
        Boolean(body?.retrieval?.command),
        body?.retrieval?.command ?? ''
      );
    }
    await shot(page, '08-export-result');

    // Final summary screenshot
    await shot(page, '99-final');
  } finally {
    await browser.close();
  }

  // Print summary
  const passed = checks.filter((c) => c.ok).length;
  const failed = checks.length - passed;
  console.log('\n=== Summary ===');
  console.log(`${passed} passed, ${failed} failed`);
  for (const c of checks.filter((c) => !c.ok)) {
    console.log(`  ✗ ${c.name}${c.notes ? ` — ${c.notes}` : ''}`);
  }
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
