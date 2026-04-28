/* eslint-disable no-console */
/**
 * 1.1.C verification — re-run mechanical checks on the 4 unauth surfaces
 * after fixes (landing, pricing, changelog, auth) and confirm:
 *   - Touch targets <44px reduced (or zero, except sr-only "Skip to content")
 *   - Horizontal overflow eliminated at 320px
 *
 * REMOVE_BEFORE_LAUNCH (Gap 1.1.G).
 */

import { chromium, type Page } from 'playwright';

const HOST = process.env.CAPTURE_HOST ?? 'https://acreos.io';

const SURFACES = [
  { slug: 'landing', path: '/' },
  { slug: 'pricing', path: '/pricing' },
  { slug: 'changelog', path: '/changelog' },
  { slug: 'auth', path: '/auth' },
];

const BREAKPOINTS = [320, 375, 414];

interface Metrics {
  smallTargets: Array<{ tag: string; text: string; w: number; h: number }>;
  scrollWidth: number;
  clientWidth: number;
}

async function checkSurface(page: Page, url: string): Promise<Metrics> {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => {});
  await page.waitForTimeout(500);

  return await page.evaluate(() => {
    const minTouch = 44;
    const interactives = Array.from(document.querySelectorAll('a, button, [role="button"], input[type="submit"], input[type="button"]'));
    const small = interactives
      .map((el) => {
        const rect = (el as HTMLElement).getBoundingClientRect();
        return {
          tag: el.tagName.toLowerCase(),
          text: ((el as HTMLElement).innerText || (el as HTMLElement).getAttribute('aria-label') || '').slice(0, 30),
          w: Math.round(rect.width),
          h: Math.round(rect.height),
        };
      })
      .filter((m) => m.w > 0 && m.h > 0 && (m.w < minTouch || m.h < minTouch))
      // Exclude the screen-reader-only "Skip to content" — intentional 1×1
      .filter((m) => !/skip to content/i.test(m.text));

    return {
      smallTargets: small,
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    };
  });
}

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  for (const surface of SURFACES) {
    console.log(`\n=== ${surface.slug} (${surface.path}) ===`);
    for (const bp of BREAKPOINTS) {
      await page.setViewportSize({ width: bp, height: 800 });
      const m = await checkSurface(page, `${HOST}${surface.path}`);
      const overflow = m.scrollWidth > m.clientWidth ? `❌ overflow ${m.scrollWidth} > ${m.clientWidth}` : '✓ no overflow';
      const targets = m.smallTargets.length === 0 ? '✓ targets ok' : `❌ ${m.smallTargets.length} small targets`;
      console.log(`  ${bp}px: ${overflow} | ${targets}`);
      if (m.smallTargets.length > 0) {
        for (const t of m.smallTargets.slice(0, 5)) {
          console.log(`    - ${t.tag} "${t.text}" (${t.w}×${t.h})`);
        }
      }
    }
  }

  await browser.close();
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
