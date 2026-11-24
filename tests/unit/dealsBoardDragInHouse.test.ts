/**
 * BD-2 (bundle diet, 2026-11): the deals board's drag layer is in-house —
 * @dnd-kit is out of the customer bundle, and the stage-move paths it used
 * to supply are pinned here so the diet can never silently become a
 * pointer-only (or no-drag) regression:
 *
 *   1. No file under client/src, shared/ or packages/ imports @dnd-kit,
 *      and package.json declares none of its packages. (The chunk-graph
 *      leg of this gate is the production build itself: zero @dnd-kit
 *      modules in dist/client-chunk-graph.json.)
 *   2. deals.tsx keeps BOTH stage-move paths on the grip handle:
 *      pointer events with capture + the 8px activation distance the old
 *      PointerSensor used, and a keyboard path (Space/Enter pick up,
 *      arrow keys choose the target stage, Space/Enter drop, Escape
 *      cancel) wired to the board's aria-live announcements and the
 *      screen-reader instructions element the grip's aria-describedby
 *      points at.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { stripComments } from "../helpers/stripComments";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";

vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

const ROOT = path.join(__dirname, "../..");
const DEALS = path.join(ROOT, "client/src/pages/deals.tsx");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(name) && !/\.test\./.test(name)) out.push(p);
  }
  return out;
}

describe("@dnd-kit is not imported or declared anywhere", () => {
  const files = [
    ...walk(path.join(ROOT, "client/src")),
    ...walk(path.join(ROOT, "shared")),
    ...walk(path.join(ROOT, "packages")),
  ];
  const DND_IMPORT = /\bfrom\s+["']@dnd-kit\/|\bimport\(\s*["']@dnd-kit\/|\brequire\(\s*["']@dnd-kit\//;

  it("reads the source population (vacuity floor)", () => {
    expect(files.length).toBeGreaterThan(500);
    expect(files).toContain(DEALS);
  });

  it("no source file imports @dnd-kit", () => {
    const importers = files
      .filter((f) => DND_IMPORT.test(stripComments(readFileSync(f, "utf8"))))
      .map((f) => path.relative(ROOT, f));
    expect(importers).toEqual([]);
  });

  it("package.json declares no @dnd-kit package", () => {
    const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const declared = [
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.devDependencies ?? {}),
    ].filter((name) => name.startsWith("@dnd-kit/"));
    expect(declared).toEqual([]);
  });
});

describe("the deals board keeps pointer + keyboard stage moves", () => {
  const src = stripComments(readFileSync(DEALS, "utf8"));

  it("pointer path: capture, 8px activation, element-under-pointer drop target", () => {
    expect(src).toContain("setPointerCapture");
    expect(src).toContain("< 8");
    expect(src).toContain("elementFromPoint");
    expect(src).toContain('data-drop-stage');
    expect(src).toContain("onPointerDown");
    expect(src).toContain("onPointerMove");
    expect(src).toContain("onPointerUp");
    expect(src).toContain("onPointerCancel");
  });

  it("keyboard path: pick up, arrows move the target stage, drop, cancel", () => {
    expect(src).toContain("onKeyDown");
    for (const key of ['"ArrowRight"', '"ArrowLeft"', '"ArrowUp"', '"ArrowDown"', '"Home"', '"End"', '"Escape"', '"Enter"']) {
      expect(src).toContain(key);
    }
    expect(src).toContain("setKeyboardDrag");
    expect(src).toContain("moveDealToStage");
  });

  it("ARIA path: instructions element, grip describedby, live announcements", () => {
    expect(src).toContain('id="deals-board-drag-instructions"');
    expect(src).toContain("press Space or Enter to pick it up, use arrow keys to move between columns");
    expect(src).toContain('"deals-board-drag-instructions"');
    expect(src).toContain('aria-live="polite"');
    for (const announcement of ["Picked up ", "Over ", "Not over a stage.", "Moved ", "Drop canceled for "]) {
      expect(src).toContain(announcement);
    }
    expect(src).toContain("aria-pressed");
  });

  it("both paths converge on the one stage-move mutation", () => {
    // Pointer drop and keyboard drop must call the same moveDealToStage
    // (which owns the useUpdateDeal mutate + toasts) — no second writer.
    const calls = src.match(/moveDealToStage\(deal\.id, /g) ?? [];
    expect(calls.length).toBe(2);
    expect(src.match(/updateDealStage\(/g)?.length).toBe(1);
  });
});
