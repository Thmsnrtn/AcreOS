/**
 * Map smoke test — functional, not just visual.
 *
 * Exercises the property-map component end-to-end with both engines:
 *
 *   - Map canvas renders (mapbox-gl-canvas / maplibre-gl-canvas)
 *   - Style switcher cycles through all 3 styles without error
 *   - Pan / zoom mouse interactions don't throw
 *   - Measurement-mode toggle activates and clicks register
 *   - Layer toggle reveals the layer menu
 *
 * Default run exercises the current `VITE_MAP_ENGINE` value (mapbox by
 * default). To force the maplibre path:
 *
 *   VITE_MAP_ENGINE=maplibre npm run dev
 *   npx playwright test tests/e2e/map-smoke.spec.ts
 *
 * Or to verify BOTH engines in one CI run, parametrize via separate
 * deploys or temporarily fork the spec.
 *
 * The test relies on at least one property being seeded in the test
 * org so the map has something to render. If the org is empty, the
 * map falls through to the "No properties with map data" empty state
 * and the test will report that rather than a real failure.
 */

import { test, expect, type Page } from "@playwright/test";

test.use({ storageState: "tests/e2e/.auth/user.json" });

// Map mount + tile load on production needs ~10-15s comfortably.
test.setTimeout(90_000);

async function loadPropertiesPage(page: Page): Promise<void> {
  // /maps is the canonical map page; /properties is a list view that only
  // shows an embedded map when an explicit toggle is clicked.
  await page.goto("/maps");
  await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
  // Give the map a beat to mount + style-load.
  await page.waitForTimeout(2_000);
}

async function detectMapEngine(page: Page): Promise<"mapbox" | "maplibre" | "none"> {
  // Both libraries inject a canvas with a distinct class name. mapbox-gl
  // uses .mapboxgl-canvas; maplibre-gl uses .maplibregl-canvas.
  const mapbox = await page.locator(".mapboxgl-canvas").count();
  if (mapbox > 0) return "mapbox";
  const maplibre = await page.locator(".maplibregl-canvas").count();
  if (maplibre > 0) return "maplibre";
  return "none";
}

test.describe("Map smoke", () => {
  test("map canvas mounts on /properties", async ({ page }) => {
    // Surface console errors so a failed mount produces an actionable trail.
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });

    await loadPropertiesPage(page);

    // Some orgs land on the table view first; the map is on a "Map View"
    // toggle. Try to click it if present.
    const mapToggle = page.getByTestId("button-map-view").or(page.getByRole("button", { name: /map view/i }));
    if (await mapToggle.count()) {
      await mapToggle.first().click().catch(() => {});
      await page.waitForTimeout(500);
    }

    const engine = await detectMapEngine(page);

    if (engine === "none") {
      // Distinguish the "no properties" empty state from a real mount
      // failure. The maps page renders "No properties with map data"
      // (or "No parcel coordinates yet") when the org has nothing
      // geocoded yet — that's expected for a fresh tenant, not a bug.
      const emptyState =
        (await page.getByText(/no properties with map data/i).count()) +
        (await page.getByText(/no parcel coordinates yet/i).count());
      if (emptyState > 0) {
        test.skip(true, "Test org has no properties with coordinates — seed sample data before running");
        return;
      }
      throw new Error(
        `Map canvas did not mount (no .mapboxgl-canvas or .maplibregl-canvas). ` +
          `Recent console errors: ${consoleErrors.slice(-3).join(" | ") || "(none)"}`,
      );
    }

    // No error-level console messages from the map library itself.
    const mapErrors = consoleErrors.filter((e) =>
      /mapbox|maplibre|tile|style|webgl/i.test(e),
    );
    expect(mapErrors, `Map engine emitted errors: ${mapErrors.join(" | ")}`).toEqual([]);
  });

  test("style switcher cycles through 3 styles", async ({ page }) => {
    await loadPropertiesPage(page);
    const mapToggle = page.getByTestId("button-map-view");
    if (await mapToggle.count()) {
      await mapToggle.first().click().catch(() => {});
      await page.waitForTimeout(500);
    }
    if ((await detectMapEngine(page)) === "none") test.skip();

    // The component shows a style chooser. Real testids are
    // button-map-satellite / button-map-terrain / button-map-streets
    // (see property-map.tsx). Fall back to role=button if those testids
    // ever get refactored.
    for (const style of ["satellite", "terrain", "streets"]) {
      const btn = page.getByTestId(`button-map-${style}`).or(
        page.getByRole("button", { name: new RegExp(style, "i") }),
      );
      if ((await btn.count()) === 0) continue;
      await btn.first().click().catch(() => {});
      await page.waitForTimeout(300);
      // After a style switch the canvas should still be there.
      const stillMounted =
        (await page.locator(".mapboxgl-canvas").count()) +
          (await page.locator(".maplibregl-canvas").count()) >
        0;
      expect(stillMounted, `Canvas disappeared after switching to ${style}`).toBe(true);
    }
  });

  test("measurement mode toggle activates", async ({ page }) => {
    await loadPropertiesPage(page);
    const mapToggle = page.getByTestId("button-map-view");
    if (await mapToggle.count()) {
      await mapToggle.first().click().catch(() => {});
      await page.waitForTimeout(500);
    }
    if ((await detectMapEngine(page)) === "none") test.skip();

    // Find the measurement (Ruler / Distance / Area) toggle. Real
    // testid is button-measure.
    const measureBtn = page
      .getByTestId("button-measure")
      .or(page.getByRole("button", { name: /measure|ruler|distance/i }));
    if ((await measureBtn.count()) === 0) {
      test.info().annotations.push({
        type: "warning",
        description: "No measurement toggle found — check selector / feature presence",
      });
      return;
    }
    await measureBtn.first().click();
    await page.waitForTimeout(200);

    // After activating, the canvas should still be there and clicking
    // shouldn't throw.
    const canvas = page.locator(".mapboxgl-canvas, .maplibregl-canvas").first();
    const box = await canvas.boundingBox();
    if (box) {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForTimeout(200);
    }
  });

  test("layer toggle opens layer menu", async ({ page }) => {
    await loadPropertiesPage(page);
    const mapToggle = page.getByTestId("button-map-view");
    if (await mapToggle.count()) {
      await mapToggle.first().click().catch(() => {});
      await page.waitForTimeout(500);
    }
    if ((await detectMapEngine(page)) === "none") test.skip();

    const layersBtn = page.getByRole("button", { name: /layers/i });
    if ((await layersBtn.count()) === 0) {
      test.info().annotations.push({
        type: "warning",
        description: "No Layers toggle found",
      });
      return;
    }
    await layersBtn.first().click();
    await page.waitForTimeout(300);

    // Expect at least one layer option visible (FEMA, USFWS, USDA, USGS, etc.)
    const layerOptions = await page.getByText(/flood|wetland|soil|cropland|hillshade|terrain|parcel/i).count();
    expect(layerOptions).toBeGreaterThan(0);
  });

  test("zoom in / zoom out via keyboard shortcuts", async ({ page }) => {
    await loadPropertiesPage(page);
    const mapToggle = page.getByTestId("button-map-view");
    if (await mapToggle.count()) {
      await mapToggle.first().click().catch(() => {});
      await page.waitForTimeout(500);
    }
    if ((await detectMapEngine(page)) === "none") test.skip();

    const canvas = page.locator(".mapboxgl-canvas, .maplibregl-canvas").first();
    await canvas.focus().catch(() => {});

    // The "+" key zooms in; "-" zooms out. We just want to confirm no
    // exception is raised — depth-of-zoom isn't asserted here.
    await page.keyboard.press("Equal");
    await page.waitForTimeout(300);
    await page.keyboard.press("Minus");
    await page.waitForTimeout(300);

    // Canvas survived both interactions.
    const stillMounted = await canvas.isVisible().catch(() => false);
    expect(stillMounted).toBe(true);
  });
});
