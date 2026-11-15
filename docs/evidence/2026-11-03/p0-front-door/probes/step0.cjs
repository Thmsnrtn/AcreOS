// Step 0 probe: fresh post-onboarding user, viewport x theme matrix.
const fs = require('fs');
const { chromium, EXE, BASE, newCtx, attach } = require('./common.cjs');
const OUT = process.env.OUT || '/home/claude/probe/out';
const VERTICAL = process.env.VERTICAL || 'land_flipper';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function clickIf(page, sel, t = 4000) {
  const l = page.locator(sel).first();
  try { await l.waitFor({ state: 'visible', timeout: t }); await l.click(); return true; } catch { return false; }
}
async function walkOnboarding(page, tag) {
  await page.goto(BASE + '/'); await sleep(1200);
  await clickIf(page, '[data-testid="cookie-consent-decline"]', 4000);
  await page.goto(BASE + '/today'); await sleep(2500);
  await clickIf(page, 'button:has-text("Got it")', 5000); await sleep(500);
  if (!/onboarding/.test(page.url())) await page.goto(BASE + '/onboarding-v2');
  await page.locator('[data-testid="input-org-name"]').waitFor({ timeout: 15000 });
  await clickIf(page, '[data-testid="cookie-consent-decline"]', 3000); await sleep(400);
  await page.fill('[data-testid="input-org-name"]', 'Step0 Fresh Co ' + tag);
  await clickIf(page, `[data-testid="option-${VERTICAL}"]`);
  if (VERTICAL === 'note_investor') await clickIf(page, '[data-testid^="option-noterole-"]', 2000);
  await clickIf(page, '[data-testid="button-continue-workspace"]'); await sleep(1500);
  await clickIf(page, '[data-testid="cookie-consent-decline"]', 1000);
  await clickIf(page, 'button:has-text("Set up data later")', 8000); await sleep(1500);
  // Finish: prefer "Go to Today instead" if present, else primary finish
  if (!(await clickIf(page, '[data-testid="button-go-to-today"]', 4000))) await clickIf(page, '[data-testid="button-finish-onboarding"]', 4000);
  await sleep(3000);
  const who = await page.evaluate(async () => { const u = await (await fetch('/api/auth/user')).json(); const o = await (await fetch('/api/organization')).json().catch(()=>({})); return { persona: u.persona, onboarding: o.onboardingCompleted, businessType: o.businessType }; });
  return page.url() + ' ' + JSON.stringify(who);
}
async function composerProbe(page) {
  return page.evaluate(() => {
    const el = document.querySelector('textarea[data-testid="input-message"]');
    if (!el) return { present: false };
    const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
    const vh = window.innerHeight, vw = window.innerWidth;
    return { present: true, display: cs.display, visibility: cs.visibility, top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height), vh, vw,
      inFirstViewport: r.top >= 0 && r.bottom <= vh && r.width > 0 && r.height > 0, scrollY: window.scrollY, placeholder: el.placeholder,
      ariaLabel: el.getAttribute('aria-label'), labelledBy: el.getAttribute('aria-labelledby') };
  });
}
(async () => {
  const b = await chromium.launch({ executablePath: EXE });
  const results = [];
  for (const vp of ['phone', 'tablet', 'desktop']) for (const theme of ['light', 'dark']) {
    const tag = `${VERTICAL}-${vp}-${theme}-${Date.now()}`;
    const ctx = await newCtx(b, vp, theme, 'e2e-persona-s0-' + tag);
    const page = await ctx.newPage(); const errs = []; attach(page, errs);
    const r = { vp, theme, vertical: VERTICAL };
    try {
      r.afterOnboarding = await walkOnboarding(page, tag);
      // /today
      await page.goto(BASE + '/today'); await sleep(3500);
      r.todayUrl = page.url();
      await page.screenshot({ path: `${OUT}/today-${tag}.png` });
      r.todayText = (await page.evaluate(() => document.querySelector('main')?.innerText || document.body.innerText)).slice(0, 1200);
      r.todayButtons = await page.evaluate(() => [...document.querySelectorAll('main a, main button')].filter(e => e.offsetParent).map(e => (e.innerText || e.getAttribute('aria-label') || '').trim().replace(/\s+/g,' ')).filter(Boolean).slice(0, 40));
      r.pinnedCta = await page.evaluate(() => /import your first tape|add your first watch/i.test(document.body.innerText));
      // /ai
      await page.goto(BASE + '/ai'); await sleep(1000);
      await page.locator('textarea[data-testid="input-message"]').waitFor({ state: 'attached', timeout: 15000 }).catch(() => {});
      await sleep(1500);
      r.composer = await composerProbe(page);
      r.composerVisiblePW = await page.locator('textarea[data-testid="input-message"]').isVisible().catch(() => false);
      await page.screenshot({ path: `${OUT}/ai-${tag}.png` });
    } catch (e) { r.error = String(e).slice(0, 400); }
    r.errors = errs.filter(e => !/SW registration failed|Clerk|clerk|ResizeObserver|Failed to load resource|favicon/i.test(e.msg));
    r.transitionSkipped = errs.filter(e => /Transition was skipped/i.test(e.msg));
    results.push(r); console.log(JSON.stringify({ vp, theme, composer: r.composer, pinnedCta: r.pinnedCta, err: r.error, nErr: r.errors.length, skip: r.transitionSkipped.length }));
    await ctx.close();
  }
  fs.writeFileSync(`${OUT}/step0-${VERTICAL}.json`, JSON.stringify(results, null, 2));
  await b.close();
})();
