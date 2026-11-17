/**
 * PostHog ships in its slim build, and the analytics wrapper uses only the
 * core API that build serves.
 *
 * P2-6 S2's bundle offset: client/src/lib/analytics.ts imports
 * `posthog-js/dist/module.slim.js` — PostHog's own core-only bundle — instead
 * of the full `posthog-js` module. Slim serves capture / identify / reset /
 * groups and feature flags; it omits the extension payloads this app never
 * invokes: autocapture (disabled by design in initAnalytics), session
 * recording (Sentry Replay's job, client/src/lib/sentry.ts), surveys,
 * product tours and web-vitals attribution. The full module's source is
 * ~109 KB larger for code that cannot run here.
 *
 * Two things must stay true, and this file pins both:
 *   1. analytics.ts is the ONLY posthog-js importer (the single-owner rule
 *      clientSingleOwners.test.ts already asserts) and it imports the slim
 *      entry, never the bare full module;
 *   2. the wrapper calls exactly the core methods slim serves — init,
 *      capture, identify, reset. A wrapper that grows a call into an
 *      excluded extension (captureException's autocapture, startSessionRecording,
 *      getSurveys, registerFeatureFlag…) fails here instead of silently
 *      no-opping in a customer's browser. Reverting is one import line in
 *      analytics.ts — do that, and re-measure the bundle, first.
 */
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { stripComments } from "../helpers/stripComments";

const ROOT = path.join(__dirname, "../..");
const ANALYTICS = "client/src/lib/analytics.ts";
const read = (rel: string) => stripComments(readFileSync(path.join(ROOT, rel), "utf8"));

describe("PostHog is imported once, from the slim build", () => {
  const src = read(ANALYTICS);

  it("analytics.ts imports the slim entry and not the full module (vacuity: the import exists)", () => {
    expect(src).toContain('from "posthog-js/dist/module.slim.js"');
    expect(src).not.toMatch(/from\s*["']posthog-js["']/);
  });

  it("the slim bundle is materially smaller than the full module it replaces", () => {
    const slim = statSync(path.join(ROOT, "node_modules/posthog-js/dist/module.slim.js")).size;
    const full = statSync(path.join(ROOT, "node_modules/posthog-js/dist/module.js")).size;
    expect(slim).toBeGreaterThan(50_000);
    expect(full - slim, "the slim premise changed upstream — re-derive the offset before trusting it").toBeGreaterThan(50_000);
  });
});

describe("the analytics wrapper uses only the core API slim serves", () => {
  const src = read(ANALYTICS);

  it("calls exactly init, capture, identify and reset on the posthog object", () => {
    const calls = [...src.matchAll(/\bposthog\.(\w+)\s*\(/g)].map((m) => m[1]);
    expect(calls.length, "vacuity: the wrapper calls posthog at all").toBeGreaterThanOrEqual(4);
    expect([...new Set(calls)].sort()).toEqual(["capture", "identify", "init", "reset"]);
  });

  it("the slim build's own type surface declares those four methods", () => {
    const types = readFileSync(path.join(ROOT, "node_modules/posthog-js/dist/module.slim.d.ts"), "utf8");
    for (const method of ["init(", "capture(", "identify(", "reset("]) {
      expect(types, `slim no longer declares ${method} — the wrapper's call would not typecheck against it`).toContain(method);
    }
  });
});
