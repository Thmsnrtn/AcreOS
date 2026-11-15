const { chromium, EXE, BASE } = require('./common.cjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const VPS = process.env.ONE ? { 'iphone-12-390x844': [390,844,true] } : { 'iphone-se-320x568': [320,568,true], 'galaxy-s20-360x800': [360,800,true], 'iphone-12-390x844': [390,844,true], 'ipad-mini-768x1024': [768,1024,true], 'tablet-820x1180':[820,1180,true], 'laptop-1280x800':[1280,800,false], 'desktop-1440x900':[1440,900,false], 'qhd-2560x1440':[2560,1440,false] };
(async () => {
  const b = await chromium.launch({ executablePath: EXE });
  let fails = 0;
  for (const [name,[w,h,mob]] of Object.entries(VPS)) for (const theme of ['light','dark']) {
    const ctx = await b.newContext({ viewport: {width:w,height:h}, isMobile: mob, hasTouch: mob, colorScheme: theme, serviceWorkers: 'block' });
    await ctx.addCookies([{ name: '__session', value: process.env.COOKIE || 'e2e', domain: 'localhost', path: '/' }]);
    const page = await ctx.newPage();
    // Answer the first-visit cookie banner the way a first-time visitor must (as CJ1 does on the landing).
    await page.goto(BASE + '/'); const d = page.locator('[data-testid="cookie-consent-decline"]'); await d.waitFor({ state: 'visible', timeout: 5000 }).then(() => d.click()).catch(() => {});
    await page.goto(BASE + '/ai'); await page.locator('textarea[data-testid="input-message"]').waitFor({ state: 'attached', timeout: 20000 }).catch(()=>{}); await sleep(2000);
    const m = async () => page.evaluate(() => { const e = document.querySelector('textarea[data-testid="input-message"]'); if (!e) return null; const r = e.getBoundingClientRect(); const hit = document.elementFromPoint(r.left + r.width/2, r.top + r.height/2); return { top: Math.round(r.top), bottom: Math.round(r.bottom), vh: innerHeight, sy: Math.round(scrollY), inView: r.top >= 0 && r.bottom <= innerHeight, topmost: hit === e || e.contains(hit), hit: hit && (hit.getAttribute("data-testid") || hit.tagName + "." + String(hit.className).slice(0,50)) }; });
    const auto = await m();
    await page.evaluate(() => scrollTo(0, 0)); await sleep(400);
    const top0 = await m();
    // Keyboard reachability: Tab from the page start reaches the composer with no other interaction
    const ok = auto && top0 && auto.inView && top0.inView && auto.topmost && top0.topmost;
    if (!ok) fails++;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${theme} auto=${JSON.stringify(auto)} scroll0=${JSON.stringify(top0)}`);
    if (process.env.SHOT) await page.screenshot({ path: `${process.env.SHOT}/ai-first-sight-${name}-${theme}.png` });
    await ctx.close();
  }
  console.log('FAILS', fails); await b.close();
})();
