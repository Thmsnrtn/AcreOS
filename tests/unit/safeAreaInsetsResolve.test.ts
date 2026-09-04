/**
 * Thirty-five safe-area declarations, and one token that decides whether any
 * of them mean anything.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 * client/index.html carried `<meta name="viewport" content="width=device-width,
 * initial-scale=1.0">` — no `viewport-fit=cover`. WebKit resolves the
 * `safe-area-inset-*` environment variables to non-zero ONLY when
 * `viewport-fit=cover` is set; without it every `env(safe-area-inset-*)`
 * evaluates to 0.
 *
 * This repository has 35 deliberate call sites across 19 files — both mobile
 * bottom navs' padding and FAB offsets, MobileCommandDrawer's scroll padding,
 * PageShell's paddingTop, `.mobile-safe-content`, the Maps pin sheet, Inbox's
 * `pb-[calc(4.5rem+env(safe-area-inset-bottom))]`, DriveMode, CourthouseMode,
 * PullToRefresh's indicator offset — and every one was a no-op on the exact
 * devices it was written for. On a notched iPhone the 72px bottom nav sat
 * directly under the home indicator, and because index.html also sets
 * `apple-mobile-web-app-status-bar-style: black-translucent`, the installed
 * PWA rendered content under the status bar with no top inset either
 * (2026-09-04 review, CONFIRMED).
 *
 * ── WHY A TEST FOR ONE ATTRIBUTE ────────────────────────────────────────────
 * Because the failure is silent and remote. Deleting the token does not break
 * a build, a type, or a render — it quietly returns 35 declarations to zero on
 * one class of device, and nothing anywhere would say so. The vacuity half
 * matters as much: if the call sites were ever removed, this test would be
 * guarding a token that governs nothing, so it counts them.
 *
 * idempotent: true — pure source reads.
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const INDEX = "client/index.html";

/** Every source file that could carry a safe-area declaration. */
function sourceFiles(): string[] {
  const out: string[] = [INDEX];
  const walk = (rel: string) => {
    for (const e of fs.readdirSync(path.join(ROOT, rel), { withFileTypes: true })) {
      const child = `${rel}/${e.name}`;
      if (e.isDirectory()) walk(child);
      else if (/\.(tsx?|css)$/.test(e.name)) out.push(child);
    }
  };
  walk("client/src");
  return out;
}

describe("the viewport meta enables the safe areas the app already uses", () => {
  const html = read(INDEX);

  it("there is exactly one viewport meta, and it sets viewport-fit=cover", () => {
    const metas = [...html.matchAll(/<meta\s+name="viewport"[^>]*>/g)].map((m) => m[0]);
    expect(metas, "a second viewport meta would make which one wins a coin toss").toHaveLength(1);
    expect(
      metas[0],
      "without viewport-fit=cover WebKit resolves every safe-area-inset-* to 0, " +
        "and the 35 declarations counted below become no-ops on notched iOS",
    ).toContain("viewport-fit=cover");
    // The rest of the contract is unchanged.
    expect(metas[0]).toContain("width=device-width");
    expect(metas[0]).toMatch(/initial-scale=1(\.0)?\b/);
  });

  it("the token is load-bearing: the call sites it governs still exist", () => {
    // Counted, not asserted-nonzero: if these ever go away, the meta tag is
    // guarding nothing and this whole test should be revisited rather than
    // left standing as decoration.
    const files = sourceFiles();
    expect(files.length, "the walk found almost nothing (vacuity guard)").toBeGreaterThan(500);
    const sites = files.flatMap((rel) => {
      const hits = read(rel).match(/env\(\s*safe-area-inset-(top|bottom|left|right)/g) ?? [];
      return hits.map(() => rel);
    });
    expect(
      sites.length,
      "the safe-area declarations this meta tag exists for are gone — either " +
        "restore them or retire the requirement deliberately",
    ).toBeGreaterThanOrEqual(30);
    expect(new Set(sites).size).toBeGreaterThanOrEqual(15);
  });

  it("the PWA still renders under the status bar, which is what makes the top inset matter", () => {
    // If this ever changes to `default`, the top inset stops being required
    // and the reasoning above needs revisiting rather than quietly rotting.
    expect(html).toContain('name="apple-mobile-web-app-status-bar-style" content="black-translucent"');
  });
});

describe("the fixed bottom bars survive landscape on a notched device", () => {
  // `viewport-fit=cover` also makes the LEFT and RIGHT insets real. Both nav
  // bars are `fixed inset-x-0`, so in landscape their outermost items would
  // sit under the notch without a horizontal inset. Both are 0 in portrait,
  // so this costs nothing on every other device.
  for (const rel of [
    "client/src/components/mobile/MobileBottomNav.tsx",
    "client/src/components/mobile/FounderMobileBottomNav.tsx",
  ]) {
    it(`${rel.split("/").pop()} insets left and right as well as bottom`, () => {
      const src = read(rel);
      const navAt = src.indexOf('className="fixed bottom-0 left-0 right-0');
      expect(navAt, "the fixed bottom bar is not where this test thinks it is").toBeGreaterThan(-1);
      const nav = src.slice(navAt, navAt + 900);
      for (const side of ["bottom", "left", "right"]) {
        expect(nav, `the bar does not inset ${side}`).toContain(`env(safe-area-inset-${side}, 0px)`);
      }
    });
  }
});
