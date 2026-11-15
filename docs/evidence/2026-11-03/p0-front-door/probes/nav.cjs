// Fix 3 Step 0: CJ navigation paths + door-to-door client-side navigation, page-error capture,
// plus instrumentation of view-transition outcomes (to see whether skips happen beneath the handler).
const fs = require('fs');
const { chromium, EXE, BASE, newCtx, attach } = require('./common.cjs');
const OUT = process.env.OUT || '/home/claude/probe/out';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function clickIf(page, sel, t = 4000) { const l = page.locator(sel).first(); try { await l.waitFor({ state: 'visible', timeout: t }); await l.click(); return true; } catch { return false; } }
const INSTR = () => {
  window.__vt = { started: 0, finished: 0, skipped: [], other: [] };
  const orig = document.startViewTransition?.bind(document);
  if (!orig) return;
  document.startViewTransition = (cb) => { window.__vt.started++; const t = orig(cb);
    t.finished.then(() => window.__vt.finished++, () => {});
    t.ready.catch((e) => { (e && e.name === 'AbortError' ? window.__vt.skipped : window.__vt.other).push(String(e && e.message) + ' @' + location.pathname); });
    return t; };
};
(async () => {
  const b = await chromium.launch({ executablePath: EXE });
  const all = [];
  for (const vp of ['phone', 'tablet', 'desktop']) for (const theme of ['light', 'dark']) for (const motion of ['no-preference', 'reduce']) {
    const tag = `${vp}-${theme}-${motion}-${Date.now()}`;
    const ctx = await newCtx(b, vp, theme, 'e2e-persona-nav-' + tag, { reducedMotion: motion });
    await ctx.addInitScript(INSTR);
    const page = await ctx.newPage(); const errs = []; attach(page, errs);
    const vtLog = [];
    const snap = async (label) => { try { vtLog.push({ label, url: page.url(), vt: await page.evaluate(() => JSON.parse(JSON.stringify(window.__vt || null))) }); } catch {} };
    try {
      // CJ path: landing -> /auth?mode=register -> /today -> onboarding (click-through) -> /today -> /ai -> /today
      await page.goto(BASE + '/'); await sleep(1200); await clickIf(page, '[data-testid="cookie-consent-decline"]', 4000);
      await page.goto(BASE + '/auth?mode=register'); await sleep(1000);
      await page.goto(BASE + '/today'); await sleep(2500); await clickIf(page, 'button:has-text("Got it")', 5000);
      if (!/onboarding/.test(page.url())) await page.goto(BASE + '/onboarding-v2');
      await page.locator('[data-testid="input-org-name"]').waitFor({ timeout: 15000 });
      await clickIf(page, '[data-testid="cookie-consent-decline"]', 2000);
      await page.fill('[data-testid="input-org-name"]', 'Nav Probe ' + tag);
      await clickIf(page, '[data-testid="option-land_flipper"]');
      await clickIf(page, '[data-testid="button-continue-workspace"]'); await sleep(1500);
      await clickIf(page, 'button:has-text("Set up data later")', 8000); await sleep(1500);
      if (!(await clickIf(page, '[data-testid="button-go-to-today"]', 4000))) await clickIf(page, '[data-testid="button-finish-onboarding"]', 4000);
      await sleep(2500); await snap('after-onboarding-click');
      await page.goto(BASE + '/today'); await sleep(2000);
      await page.goto(BASE + '/ai'); await sleep(2500);
      await page.goto(BASE + '/today'); await sleep(2000); await snap('cj-goto-path');
      // In-app door navigation (client-side pushState), including rapid double navigations
      const doors = ['/map', '/deals', '/finance', '/ai', '/today', '/inbox', '/settings', '/today'];
      for (const d of doors) {
        const ok = await page.evaluate((href) => { const a = [...document.querySelectorAll(`a[href="${href}"]`)].find(e => e.offsetParent); if (a) { a.click(); return true; } return false; }, d);
        if (!ok) await page.evaluate((href) => { history.pushState(null, '', href); dispatchEvent(new PopStateEvent('popstate')); }, d);
        await sleep(1500);
      }
      await snap('door-walk');
      // Rapid: two links in quick succession, and legacy alias redirects (/pax -> /ai, /dashboard -> /today)
      for (const pair of [['/deals', '/map'], ['/pax', '/today'], ['/dashboard', '/ai']]) {
        await page.evaluate(([a, c]) => { history.pushState(null, '', a); dispatchEvent(new PopStateEvent('popstate')); setTimeout(() => { history.pushState(null, '', c); dispatchEvent(new PopStateEvent('popstate')); }, 30); }, pair);
        await sleep(2000);
      }
      await snap('rapid-and-redirects');
    } catch (e) { errs.push({ kind: 'probe-error', msg: String(e).slice(0, 300) }); }
    const relevant = errs.filter(e => !/SW registration failed|Clerk|clerk|ResizeObserver|Failed to load resource|favicon/i.test(e.msg));
    const r = { vp, theme, motion, pageErrors: relevant.filter(e => e.kind === 'pageerror'), transitionSkippedErrors: errs.filter(e => /Transition was skipped/i.test(e.msg)), consoleErrors: relevant.filter(e => e.kind === 'console').length, probeErrors: relevant.filter(e => e.kind === 'probe-error'), vtLog };
    all.push(r);
    const last = vtLog[vtLog.length - 1]?.vt;
    console.log(JSON.stringify({ vp, theme, motion, pageErrors: r.pageErrors.length, transitionSkipped: r.transitionSkippedErrors.length, vtStarted: last?.started, vtFinished: last?.finished, vtSkippedUnderHandler: last?.skipped?.length, probe: r.probeErrors.map(p=>p.msg.slice(0,80)) }));
    await ctx.close();
  }
  fs.writeFileSync(`${OUT}/nav-${process.env.LABEL || 'main'}.json`, JSON.stringify(all, null, 2));
  await b.close();
})();
