const { webkit, chromium, devices } = require('/home/claude/acreos/node_modules/playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  for (const [name, bt, dev] of [['webkit-iphone14', webkit, devices['iPhone 14']], ['chromium-pixel5', chromium, devices['Pixel 5']]]) {
    const b = await bt.launch(bt === chromium ? { executablePath: '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' } : {});
    const ctx = await b.newContext({ ...dev, serviceWorkers: 'block', reducedMotion: process.env.RM || 'no-preference' });
    await ctx.addCookies([{ name: '__session', value: 'e2e', domain: 'localhost', path: '/' }]);
    await ctx.addInitScript(() => { localStorage.setItem('acreos_cookie_consent','declined'); localStorage.setItem('pwa-install-dismissed', String(Date.now())); });
    const page = await ctx.newPage();
    await page.goto('http://localhost:5000/today'); await sleep(3000);
    await page.evaluate(() => { window.__log = []; const t0 = performance.now();
      const rec = (s) => { const l = window.__log[window.__log.length-1]; if (!l || l.s !== s) window.__log.push({ t: Math.round(performance.now()-t0), s }); };
      new MutationObserver(() => { const d = !!document.querySelector('[data-testid="note-tape-file"]'); const h = document.querySelector('h1'); if (h && !h.__id) h.__id = (window.__hid = (window.__hid||0)+1); const loader = !!document.querySelector('[data-testid="page-loader"], [role="status"][aria-label*="oading"]'); const ae = document.activeElement; rec(`${d}|h1#${h?.__id}:${h?.innerText?.slice(0,12)}|ldr=${loader}|ae=${ae?.tagName}.${ae?.getAttribute('data-testid')||ae?.id||''}|${location.pathname}${location.search}`); }).observe(document.body, { subtree: true, childList: true, attributes: true });
      document.addEventListener('focusin', (e) => rec('focusin ' + e.target.tagName + '.' + (e.target.getAttribute('data-testid')||e.target.id||'')), true);
      history.pushState(null,'','/notes?action=new'); dispatchEvent(new PopStateEvent('popstate')); });
    await sleep(4000);
    console.log('==', name); console.log((await page.evaluate(() => window.__log)).map(x => x.t + ' ' + x.s).join('\n'));
    await b.close();
  }
})();
