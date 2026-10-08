/**
 * Three standing-law fixes from the E-2 production recon (2026-08-31),
 * pinned so none can quietly regress. Source-shape contracts in the
 * letterNeedsYouUnion style: each case names the defect it locks out.
 *
 * 1. HEALTH ENUMERATION — /api/health and /api/health/live returned the
 *    full vendor-stack inventory (provider names, unconfigured states,
 *    live failure detail — including a real regrid 401) to anonymous
 *    internet callers. Anonymous now gets status-only; the signed-in
 *    operator keeps the detail; probes keep their status codes.
 * 2. TENANT DATA SURVIVING LOGOUT — the service worker caches
 *    /api/leads|properties|deals|team-members responses and queues
 *    offline mutations in IndexedDB; logout cleared cookies and query
 *    cache but neither store, so a shared device handed the next person
 *    the previous tenant's data.
 * 3. SIGNUP SHELL HEIGHT — onboarding-v2.css declared 100dvh BEFORE the
 *    100vh "fallback", so the fallback won everywhere; on iOS Safari
 *    (toolbar-inclusive 100vh + overflow:hidden) the wizard's bottom CTA
 *    sat under the toolbar, unreachable — the first thing a new customer
 *    touches.
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const ROOT = path.resolve(__dirname, "../..");
const routesSrc = fs.readFileSync(path.join(ROOT, "server/routes.ts"), "utf-8");
const authSrc = fs.readFileSync(
  path.join(ROOT, "client/src/hooks/use-auth.ts"),
  "utf-8",
);
const obCss = fs.readFileSync(
  path.join(ROOT, "client/src/pages/styles/onboarding-v2.css"),
  "utf-8",
);

describe("anonymous health responses carry no vendor inventory", () => {
  // REWRITTEN 2026-10-07 to the new truth, not deleted. The original pinned a
  // `redactHealthForAnonymous` helper keyed on req.auth — but these routes are
  // registered BEFORE clerkMiddleware, so req.auth never existed there and the
  // helper redacted everyone by accident, while /api/health/cached (same block,
  // Fly's probe target) kept the full list. The invariant — no vendor inventory
  // on a public probe — now holds for ALL THREE public routes by construction:
  // they live in server/routes-health.ts and build their body from
  // publicHealthBody() only. Behaviour is pinned in publicHealthIsStatusOnly.test.ts.
  const healthSrc = fs.readFileSync(path.join(ROOT, "server/routes-health.ts"), "utf-8");

  it("routes.ts delegates the public probes to routes-health.ts", () => {
    expect(routesSrc).toMatch(/registerPublicHealthRoutes\(app\)/);
    expect(routesSrc).not.toMatch(/app\.get\("\/api\/health(?:\/live|\/cached)?",/);
  });

  it("no public health body spreads the snapshot (which carries `services`)", () => {
    const routes = healthSrc.match(/app\.get\("\/api\/health(?:\/live|\/cached)?",/g) ?? [];
    expect(routes.length).toBe(3);
    expect(healthSrc).not.toMatch(/\.\.\.(result|data|cached)\b/);
    expect(healthSrc).not.toMatch(/services\s*:/);
  });

  it("the error path leaks no error detail either", () => {
    expect(healthSrc).not.toMatch(/err\??\.message/);
  });
});

describe("logout purges every tenant-bearing device store", () => {
  it("deletes the service worker's API caches by prefix and suffix", () => {
    expect(authSrc).toMatch(/caches\.keys\(\)/);
    expect(authSrc).toMatch(/startsWith\("acreos-"\) && n\.endsWith\("-api"\)/);
    expect(authSrc).toMatch(/caches\.delete\(n\)/);
  });

  it("deletes the offline mutation queue database", () => {
    expect(authSrc).toMatch(/indexedDB\.deleteDatabase\("acreos-offline"\)/);
  });

  it("the purge sits inside logout, after the server logout call", () => {
    const logoutIdx = authSrc.indexOf("const logout = async ()");
    const serverLogoutIdx = authSrc.indexOf('"/api/auth/logout"', logoutIdx);
    const purgeIdx = authSrc.indexOf('endsWith("-api")', logoutIdx);
    expect(logoutIdx).toBeGreaterThan(-1);
    expect(purgeIdx).toBeGreaterThan(serverLogoutIdx);
  });
});

describe("the onboarding shell height fallback cannot win over dvh", () => {
  it(".ob2-shell declares 100vh strictly BEFORE 100dvh", () => {
    const shellIdx = obCss.indexOf(".ob2-shell");
    expect(shellIdx).toBeGreaterThan(-1);
    const block = obCss.slice(shellIdx, obCss.indexOf("}", shellIdx));
    const vhIdx = block.indexOf("min-height: 100vh");
    const dvhIdx = block.indexOf("min-height: 100dvh");
    expect(vhIdx, "100vh fallback missing").toBeGreaterThan(-1);
    expect(dvhIdx, "100dvh missing").toBeGreaterThan(-1);
    // Later declaration wins in CSS: dvh must come after vh.
    expect(dvhIdx).toBeGreaterThan(vhIdx);
  });
});
