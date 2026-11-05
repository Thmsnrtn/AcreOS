// Fix 2 proof: fresh note investor sees the pinned CTA on first sight; it opens the real note-tape import;
// a note investor past first value does not see it; a land investor's Today is unchanged (no CTA).
const { execSync } = require('child_process');
const { chromium, EXE, BASE, newCtx, attach } = require('./common.cjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function clickIf(page, sel, t = 4000) { const l = page.locator(sel).first(); try { await l.waitFor({ state: 'visible', timeout: t }); await l.click(); return true; } catch { return false; } }
async function onboard(page, vertical, tag) {
  await page.goto(BASE + '/'); await sleep(1000); await clickIf(page, '[data-testid="cookie-consent-decline"]');
  await page.goto(BASE + '/today'); await sleep(2500); await clickIf(page, 'button:has-text("Got it")', 5000);
  if (!/onboarding/.test(page.url())) await page.goto(BASE + '/onboarding-v2');
  await page.locator('[data-testid="input-org-name"]').waitFor({ timeout: 20000 });
  await clickIf(page, '[data-testid="cookie-consent-decline"]', 1500);
  await page.fill('[data-testid="input-org-name"]', 'Fix2 ' + tag);
  await clickIf(page, `[data-testid="option-${vertical}"]`);
  if (vertical === 'note_investor') await clickIf(page, '[data-testid^="option-noterole-"]', 2000);
  await clickIf(page, '[data-testid="button-continue-workspace"]'); await sleep(1500);
  await clickIf(page, 'button:has-text("Set up data later")', 8000); await sleep(1500);
  if (!(await clickIf(page, '[data-testid="button-go-to-today"]', 3000))) await clickIf(page, '[data-testid="button-finish-onboarding"]');
  await sleep(2500);
}
const cta = (page) => page.evaluate(() => { const e = document.querySelector('[data-testid="button-first-value-cta"]'); if (!e) return null; const r = e.getBoundingClientRect(); return { text: e.innerText.trim(), href: e.getAttribute('href'), inView: r.top >= 0 && r.bottom <= innerHeight, top: Math.round(r.top) }; });
(async () => {
  const b = await chromium.launch({ executablePath: EXE });
  const out = [];
  for (const vp of ['phone', 'desktop']) for (const theme of ['light','dark']) for (const vertical of ['note_investor', 'land_flipper']) {
    const tag = `${vertical}-${vp}-${theme}-${Date.now()}`;
    const ctx = await newCtx(b, vp, theme, 'e2e-persona-f2-' + tag); const page = await ctx.newPage(); const errs = []; attach(page, errs);
    const r = { vp, theme, vertical };
    try {
      await onboard(page, vertical, tag);
      await page.goto(BASE + '/today'); await sleep(3000); await page.evaluate(() => scrollTo(0,0)); await sleep(300);
      r.fresh = await cta(page);
      if (vertical === 'note_investor' && r.fresh) {
        if (process.env.SHOT) await page.screenshot({ path: `${process.env.SHOT}/today-fresh-${vertical}-${vp}-${theme}.png` });
        await page.click('[data-testid="button-first-value-cta"]'); await sleep(2500);
        r.afterClickUrl = page.url();
        r.tapeImportVisible = await page.locator('[data-testid="note-tape-file"]').isVisible().catch(() => false);
        if (process.env.SHOT) await page.screenshot({ path: `${process.env.SHOT}/tape-import-${vp}-${theme}.png` });
        // Past first value: put one acquired note on this org's book (local throwaway DB only), reload Today.
        const org = await page.evaluate(async () => (await (await fetch('/api/organization')).json()).id);
        execSync(`psql postgresql://acreos:acreos@localhost:5432/acreos_e2e -qc "insert into acquired_notes (organization_id, note_number, original_principal_cents, current_balance_cents, interest_rate_bps, term_months, payment_amount_cents, payment_due_day, origination_date, maturity_date, acquisition_date, acquisition_price_cents, payer_name) values (${Number(org)}, 'LOCAL-TEST-1', 100000, 100000, 900, 60, 2000, 1, '2025-01-01', '2030-01-01', '2026-01-01', 80000, 'Local Test Payer')"`);
        await page.goto(BASE + '/today'); await sleep(3000);
        r.pastFirstValue = await cta(page);
      }
    } catch (e) { r.error = String(e).slice(0, 300); }
    r.pageErrors = errs.filter(e => e.kind === 'pageerror').map(e => e.msg);
    out.push(r); console.log(JSON.stringify(r)); await ctx.close();
  }
  await b.close();
})();
