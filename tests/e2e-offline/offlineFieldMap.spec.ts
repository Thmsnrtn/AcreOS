/**
 * A saved field-map area works in AIRPLANE MODE on a phone (Pixel 5,
 * Chromium offline emulation) — W5b, Map door.
 *
 * Online: the real store saves an area — imagery tiles from the one source
 * whose terms allow offline caching, the org's parcel facts, and the viewer
 * itself. Offline: /offline-map.html opens from the service worker, draws the
 * saved tiles and the parcel, shows "Offline since …", and a tap shows the
 * parcel's facts. No request ever goes to a source whose terms forbid
 * caching (OpenFreeMap).
 */
import { test, expect } from "@playwright/test";

// A 1×1 PNG stands in for a NAIP tile.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

test("a saved area opens and draws with no network", async ({ page, context }) => {
  const tileRequests: string[] = [];
  const forbidden: string[] = [];
  await context.route("https://basemap.nationalmap.gov/**", (route) => {
    tileRequests.push(route.request().url());
    return route.fulfill({ status: 200, contentType: "image/png", headers: { "access-control-allow-origin": "*" }, body: PNG });
  });
  await context.route("https://tiles.openfreemap.org/**", (route) => {
    forbidden.push(route.request().url());
    return route.abort();
  });

  // 1 · online: install the service worker, then save an area.
  await page.goto("/harness.html");
  await page.evaluate(async () => {
    await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  const saved = await page.evaluate(() => window.saveArea());
  expect(saved.tileCount).toBeGreaterThan(0);
  expect(saved.parcels).toBe(1);
  expect(saved.refused.sort()).toEqual(["openfreemap", "terrarium"]);
  expect(tileRequests.length).toBe(saved.tileCount);

  // 2 · airplane mode.
  await context.setOffline(true);
  const before = tileRequests.length;
  await page.goto("/offline-map.html");
  await expect(page.getByTestId("offline-since")).toContainText("Offline since");
  await expect(page.getByTestId("offline-since")).toContainText("1 parcel");
  const tiles = page.locator("#tiles img");
  await expect.poll(() => tiles.count()).toBeGreaterThan(0);
  await expect
    .poll(() => tiles.evaluateAll((imgs) => imgs.every((i) => (i as HTMLImageElement).complete && (i as HTMLImageElement).naturalWidth > 0)))
    .toBe(true);
  expect(tileRequests.length).toBe(before); // every tile came from the device, none from the network
  await expect(page.locator("[data-parcel='1']")).toHaveCount(1);
  await expect(page.getByTestId("offline-attribution")).toContainText("Not available offline");

  // 3 · tap the parcel → its saved facts.
  const box = await page.locator("[data-parcel='1']").boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await expect(page.getByTestId("offline-facts")).toContainText("TEST-APN-1");
  await expect(page.getByTestId("offline-facts")).toContainText("not live");

  // 4 · zoom in still draws only saved tiles.
  await page.getByRole("button", { name: "Zoom in" }).click();
  await expect.poll(() => tiles.count()).toBeGreaterThan(0);

  expect(forbidden).toEqual([]);
});
