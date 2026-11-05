const { chromium } = require('/home/claude/acreos/node_modules/playwright');
const EXE = '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome';
const BASE = process.env.BASE || 'http://localhost:5000';
const VIEWPORTS = {
  phone: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 1 },
  tablet: { width: 820, height: 1180, isMobile: true, hasTouch: true, deviceScaleFactor: 1 },
  desktop: { width: 1440, height: 900, isMobile: false, hasTouch: false, deviceScaleFactor: 1 },
};
async function newCtx(browser, vp, theme, cookie, extra = {}) {
  const v = VIEWPORTS[vp];
  const ctx = await browser.newContext({ viewport: { width: v.width, height: v.height }, isMobile: v.isMobile, hasTouch: v.hasTouch, colorScheme: theme, serviceWorkers: 'block', ...extra });
  if (cookie) await ctx.addCookies([{ name: '__session', value: cookie, domain: 'localhost', path: '/' }]);
  return ctx;
}
function attach(page, sink) {
  page.on('pageerror', (e) => sink.push({ kind: 'pageerror', msg: e.message || String(e), url: page.url() }));
  page.on('console', (m) => { if (m.type() === 'error') sink.push({ kind: 'console', msg: m.text().slice(0, 300), url: page.url() }); });
}
module.exports = { chromium, EXE, BASE, VIEWPORTS, newCtx, attach };
