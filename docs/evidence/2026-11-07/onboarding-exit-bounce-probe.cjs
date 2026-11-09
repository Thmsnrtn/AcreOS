// Repro/proof: after the final onboarding step, does "Go to Today instead" (and Skip) land on /today and stay?
const { chromium, EXE, BASE, newCtx, attach } = require('./common.cjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function clickIf(page, sel, t = 4000) { const l = page.locator(sel).first(); try { await l.waitFor({ state: 'visible', timeout: t }); await l.click(); return true; } catch { return false; } }
(async () => {
  const b = await chromium.launch({ executablePath: EXE });
  for (const path of ['go-to-today', 'skip']) for (const vp of ['phone', 'desktop']) {
    const ctx = await newCtx(b, vp, 'light', `e2e-persona-bounce-${path}-${vp}-${Date.now()}`);
    await ctx.addInitScript(() => { try { localStorage.setItem('acreos_cookie_consent', 'declined'); localStorage.setItem('pwa-install-dismissed', String(Date.now())); } catch {} });
    const page = await ctx.newPage(); const errs = []; attach(page, errs);
    const hist = []; await page.exposeFunction('__h', (s) => hist.push(s));
    await ctx.addInitScript(() => { for (const k of ['pushState','replaceState']) { const o = history[k].bind(history); history[k] = function (...a) { try { window.__h(k + ' ' + a[2]); } catch {} return o(...a); }; } });
    await page.goto(BASE + '/today'); await sleep(2500); await clickIf(page, 'button:has-text("Got it")', 6000);
    if (!/onboarding/.test(page.url())) await page.goto(BASE + '/onboarding-v2');
    await page.locator('[data-testid="input-org-name"]').waitFor({ timeout: 20000 });
    if (path === 'skip') {
      hist.length = 0;
      const ok = await clickIf(page, '[data-testid="button-skip-onboarding"], button:has-text("Skip")', 5000);
      if (!ok) console.log('no skip button found');
    } else {
      await page.fill('[data-testid="input-org-name"]', 'Bounce probe');
      await clickIf(page, '[data-testid="option-land_flipper"]');
      await clickIf(page, '[data-testid="button-continue-workspace"]'); await sleep(1200);
      await clickIf(page, 'button:has-text("Set up data later")', 8000); await sleep(1200);
      hist.length = 0;
      await clickIf(page, '[data-testid="button-go-to-today"]', 5000);
    }
    await sleep(3500);
    const h1 = await page.evaluate(() => document.querySelector('h1')?.innerText?.slice(0, 40));
    const landed = new URL(page.url()).pathname;
    console.log(JSON.stringify({ path, vp, landed, h1, history: hist, ok: landed === '/today' && !hist.some(s => /onboarding/.test(s)) }));
    await ctx.close();
  }
  await b.close();
})();
