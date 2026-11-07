/**
 * F-D10 self-heal (client/src/lib/chunkReload.ts, wired in main.tsx): a lazy
 * chunk failure reloads the page — but never while the page is being left.
 * WebKit reports a navigation-aborted dynamic import as "Importing a module
 * script failed."; reloading then hijacked the user's navigation (mobile
 * Customer Surface Monitor, 2026-11-05: goto /deals "interrupted by another
 * navigation to /maps"). Also pins that main.tsx actually routes through the
 * decision and marks unload, so the rule cannot be bypassed inline.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { shouldReloadForChunkFailure } from "../../client/src/lib/chunkReload";
import { stripComments } from "../helpers/stripComments";

const NOW = 1_000_000;
const MESSAGES = [
  "TypeError: Importing a module script failed.",
  "TypeError: Failed to fetch dynamically imported module: /assets/maps-abc.js",
  "Loading chunk 42 failed.",
  'Expected a JavaScript module script but the server responded with a MIME type of "text/html"',
];

describe("chunk-failure self-heal", () => {
  it.each(MESSAGES)("reloads on a chunk failure while the page is live: %s", (message) => {
    expect(shouldReloadForChunkFailure({ message, unloading: false, lastReloadAt: 0, now: NOW })).toBe(true);
  });

  it.each(MESSAGES)("never reloads while the page is being left: %s", (message) => {
    expect(shouldReloadForChunkFailure({ message, unloading: true, lastReloadAt: 0, now: NOW })).toBe(false);
  });

  it("does not reload on unrelated errors", () => {
    expect(shouldReloadForChunkFailure({ message: "TypeError: x is undefined", unloading: false, lastReloadAt: 0, now: NOW })).toBe(false);
  });

  it("reloads at most once per 10 seconds", () => {
    const m = MESSAGES[0];
    expect(shouldReloadForChunkFailure({ message: m, unloading: false, lastReloadAt: NOW - 9_999, now: NOW })).toBe(false);
    expect(shouldReloadForChunkFailure({ message: m, unloading: false, lastReloadAt: NOW - 10_000, now: NOW })).toBe(true);
  });

  it("main.tsx routes the self-heal through the decision and marks unload", () => {
    const src = stripComments(readFileSync(path.join(__dirname, "../../client/src/main.tsx"), "utf8"));
    expect(src).toMatch(/shouldReloadForChunkFailure\(\{[^}]*unloading/);
    expect(src).toMatch(/addEventListener\("pagehide", markUnloading\)/);
    expect(src).toMatch(/addEventListener\("beforeunload", markUnloading\)/);
    // The old inline regex+reload must not survive beside the decision.
    expect(src).not.toMatch(/Importing a module script failed/);
  });
});
