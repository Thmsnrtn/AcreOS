const { chromium, EXE, BASE, newCtx, attach } = require('./common.cjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function clickIf(page, sel, t = 4000) { const l = page.locator(sel).first(); try { await l.waitFor({ state: 'visible', timeout: t }); await l.click(); return true; } catch { return false; } }
(async () => {
  const b = await chromium.launch({ executablePath: EXE });
  const ctx = await newCtx(b, 'desktop', 'light', 'e2e-persona-fin-' + Date.now());
  const page = await ctx.newPage(); const errs = []; attach(page, errs);
  const navs = []; page.on('framenavigated', f => { if (f === page.mainFrame()) navs.push('nav ' + f.url()); });
  await page.exposeFunction('__log', (s) => navs.push(s));
  await ctx.addInitScript(() => { for (const k of ['pushState','replaceState']) { const o = history[k].bind(history); history[k] = function(...a){ try{window.__log(k+' '+a[2]+' from '+location.pathname)}catch{}; return o(...a); }; } });
  await page.goto(BASE + '/'); await sleep(1000); await clickIf(page, '[data-testid="cookie-consent-decline"]');
  await page.goto(BASE + '/today'); await sleep(2500); await clickIf(page, 'button:has-text("Got it")', 5000);
  await page.locator('[data-testid="input-org-name"]').waitFor({ timeout: 15000 });
  await page.fill('[data-testid="input-org-name"]', 'Finish Probe');
  await clickIf(page, '[data-testid="option-land_flipper"]');
  await clickIf(page, '[data-testid="button-continue-workspace"]'); await sleep(1500);
  await clickIf(page, 'button:has-text("Set up data later")', 8000); await sleep(1500);
  console.log('finish step buttons:', await page.evaluate(() => [...document.querySelectorAll('footer button')].map(b => b.dataset.testid + ':' + b.innerText)));
  navs.push('--- click go-to-today');
  const which = (await clickIf(page, '[data-testid="button-go-to-today"]', 3000)) ? 'go-to-today' : ((await clickIf(page, '[data-testid="button-finish-onboarding"]')) ? 'finish' : 'none');
  for (let i = 0; i < 8; i++) { await sleep(500); navs.push(`t+${(i+1)*500}ms ${page.url()} h1=${await page.evaluate(()=>document.querySelector('h1')?.innerText?.slice(0,50))}`); }
  console.log('clicked', which); console.log(navs.join('\n'));
  console.log(errs.filter(e=>!/SW registration/.test(e.msg)));
  await b.close();
})();
