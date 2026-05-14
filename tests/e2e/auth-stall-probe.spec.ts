/**
 * Probe spec — instrument the 11 routes that stall on PageLoader to find
 * out exactly what's blocking the splash from clearing.
 *
 * For each route, capture:
 *   - Every /api/auth/user request: timing, status, response body
 *   - Every /__clerk/* request: timing, status
 *   - The list of network requests to /api/* during the load
 *   - The final URL after the navigation (in case we got redirected)
 *   - The time it took for the PageLoader element to detach (or never did)
 *
 * Diagnostic only — never asserts. Output goes to stdout for inspection.
 *
 *   PLAYWRIGHT_BASE_URL=https://acreos.io npx playwright test \
 *     tests/e2e/auth-stall-probe.spec.ts --project=desktop-chrome --reporter=line
 */

import { test, type Page, type Request, type Response } from "@playwright/test";

test.use({ storageState: "tests/e2e/.auth/user.json" });
test.setTimeout(45_000);

const STALL_ROUTES = [
  "/team",
  "/automation",
  "/analytics",
  "/portfolio",
  "/cash-flow",
  "/bookkeeping",
  "/forecasting",
  "/inbox",
  "/account/security",
  "/settings",
];

// Sanity-check baseline — a route that consistently passes.
const BASELINE = "/pipeline";

interface CallRecord {
  url: string;
  status: number;
  startedAt: number;
  ms: number;
}

async function probe(page: Page, path: string) {
  const calls: CallRecord[] = [];
  const startedMap = new Map<Request, number>();

  page.on("request", (req) => {
    const u = req.url();
    if (u.includes("/api/auth/user") || u.includes("/__clerk/") || u.includes("/api/")) {
      startedMap.set(req, Date.now());
    }
  });
  page.on("response", (res: Response) => {
    const req = res.request();
    const u = req.url();
    if (u.includes("/api/auth/user") || u.includes("/__clerk/") || u.includes("/api/")) {
      const start = startedMap.get(req) ?? Date.now();
      calls.push({
        url: u.replace(/^https:\/\/acreos\.io/, ""),
        status: res.status(),
        startedAt: start,
        ms: Date.now() - start,
      });
    }
  });

  const navStart = Date.now();
  await page.goto(path, { waitUntil: "domcontentloaded" });

  // Wait up to 25s for the splash to detach. Record whether it did.
  let splashCleared = false;
  let splashClearedAt = 0;
  try {
    await page
      .locator('[aria-label="Loading AcreOS"]')
      .first()
      .waitFor({ state: "detached", timeout: 25_000 });
    splashCleared = true;
    splashClearedAt = Date.now() - navStart;
  } catch {
    splashCleared = false;
  }

  // Sample DOM state at the end.
  const finalUrl = page.url();
  const interactiveCount = await page
    .locator('h1, h2, [role="button"], button, [role="link"]:not([aria-hidden="true"])')
    .count();

  console.log(`\n=== ${path} ===`);
  console.log(`  final URL:        ${finalUrl}`);
  console.log(`  splash cleared:   ${splashCleared ? `yes @ ${splashClearedAt}ms` : "NO (timed out)"}`);
  console.log(`  interactive ct:   ${interactiveCount}`);
  console.log(`  api calls:`);
  for (const c of calls.slice(0, 30)) {
    const tag = c.url.includes("/api/auth/user") ? "★" : c.url.includes("/__clerk/") ? "🔐" : " ";
    console.log(`    ${tag} ${c.status} ${c.ms.toString().padStart(5)}ms  ${c.url.slice(0, 90)}`);
  }
}

test(`probe · baseline ${BASELINE}`, async ({ page }) => {
  await probe(page, BASELINE);
});

for (const path of STALL_ROUTES) {
  test(`probe · stall ${path}`, async ({ page }) => {
    await probe(page, path);
  });
}
