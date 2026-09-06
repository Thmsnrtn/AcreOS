/**
 * A route no flag governs is not a route that is off.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 * `/api/config/features` returns `enabledRoutes` — the union of routes
 * controlled by flags whose state is `'on'`. The client read it as an app-wide
 * ALLOW-LIST:
 *
 *     if (data.enabledRoutes.length === 0) return true;   // flags unused
 *     return data.enabledRoutes.includes(route);          // otherwise allow-list
 *
 * So the moment ANY single flag was switched on, the list became non-empty and
 * every route missing from it was denied — including every route no flag has
 * ever governed. `layout-sidebar.tsx:939` drops such a module from the nav and
 * `App.tsx:615` renders `<NotFound />` for it, so turning on one feature flag
 * would have hidden all five customer doors and 404'd them.
 *
 * The empty-list heuristic hid this: it is exactly true while nothing is
 * enabled, which is the only state anyone had been in.
 *
 * The two things being conflated are "no flag governs this route" and "a flag
 * governs it and that flag is off". The server now sends `controlledRoutes` so
 * they can be told apart.
 *
 * ── WHERE IT CAME FROM ──────────────────────────────────────────────────────
 * Foundry §13 — absence of a claim is not a claim of absence. The same shape as
 * the autopilot hands' optional `movesMoney` (ledger entry 10): a missing value
 * standing in for a decided one, on a path that decides what a person sees.
 */

import { describe, it, expect, vi } from "vitest";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";
import {
  resolveRouteEnabled,
  resolveFlagEnabled,
  type FeatureFlagsResponse,
} from "../../client/src/hooks/use-feature-flags";
import { MOBILE_DOORS, NAV_ITEM_MAP } from "../../client/src/lib/nav-items";
// This gate walks the source tree; its cost scales with the repo, and under the
// coverage run it does not fit the suite’s 30s default. A killed gate reports
// nothing about what it guards, so the budget is declared, not inherited.
vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });


/**
 * The five canonical doors, derived from the nav registry rather than typed
 * here — a hand-copied list would not notice a door being renamed.
 */
const DOOR_ROUTES = MOBILE_DOORS.map((id) => NAV_ITEM_MAP.get(id)?.href).filter(
  (h): h is string => typeof h === "string",
);

describe("the door list this test protects is real", () => {
  it("resolves five doors from the nav registry", () => {
    // Vacuity guard, first. If MOBILE_DOORS or NAV_ITEM_MAP changed shape,
    // DOOR_ROUTES would be empty and every assertion below would pass over
    // nothing.
    expect(DOOR_ROUTES.length).toBe(5);
    expect(DOOR_ROUTES).toContain("/today");
    expect(DOOR_ROUTES).toContain("/deals");
  });
});

describe("one enabled flag does not hide the rest of the app", () => {
  /** A realistic response: one flag on, governing one route. */
  const oneFlagOn: FeatureFlagsResponse = {
    enabledKeys: ["feature_avm"],
    enabledRoutes: ["/avm"],
    disabledKeys: [],
    disabledRoutes: [],
    controlledKeys: ["feature_avm"],
    controlledRoutes: ["/avm"],
  };

  it("THE FIVE CUSTOMER DOORS STAY VISIBLE", () => {
    for (const door of DOOR_ROUTES) {
      expect(
        resolveRouteEnabled(oneFlagOn, door),
        `enabling one unrelated feature flag hid ${door} from the nav and 404'd it`,
      ).toBe(true);
    }
  });

  it("the enabled route is still enabled", () => {
    expect(resolveRouteEnabled(oneFlagOn, "/avm")).toBe(true);
  });

  it("a route a flag governs but has NOT enabled is still hidden", () => {
    // The half that must keep working. Flags in state tier:X / beta /
    // founder-only appear in neither the enabled nor the disabled list — the
    // endpoint has no user context to resolve them — so they are controlled
    // and not enabled, and their routes stay hidden for everyone.
    const gated: FeatureFlagsResponse = {
      enabledKeys: [],
      enabledRoutes: [],
      controlledKeys: ["feature_beta_thing"],
      controlledRoutes: ["/beta-thing"],
    };
    expect(resolveRouteEnabled(gated, "/beta-thing")).toBe(false);
    expect(resolveRouteEnabled(gated, "/today")).toBe(true);
  });

  it("an explicit deny still wins over being uncontrolled", () => {
    const denied: FeatureFlagsResponse = {
      enabledKeys: [],
      enabledRoutes: [],
      disabledRoutes: ["/today"],
      controlledKeys: [],
      controlledRoutes: [],
    };
    expect(resolveRouteEnabled(denied, "/today")).toBe(false);
  });

  it("a frozen route stays frozen regardless of any of this", () => {
    expect(resolveRouteEnabled(oneFlagOn, "/marketplace")).toBe(false);
  });
});

describe("the same rule for flag keys", () => {
  const oneFlagOn: FeatureFlagsResponse = {
    enabledKeys: ["feature_avm"],
    enabledRoutes: ["/avm"],
    controlledKeys: ["feature_avm", "feature_beta_thing"],
    controlledRoutes: ["/avm", "/beta-thing"],
  };

  it("a key no flag defines is not disabled by an unrelated flag being on", () => {
    expect(resolveFlagEnabled(oneFlagOn, "feature_nobody_declared")).toBe(true);
  });

  it("a key that IS defined but not enabled stays off", () => {
    expect(resolveFlagEnabled(oneFlagOn, "feature_beta_thing")).toBe(false);
  });

  it("the enabled key is enabled", () => {
    expect(resolveFlagEnabled(oneFlagOn, "feature_avm")).toBe(true);
  });
});

describe("an older server without the field falls open, not shut", () => {
  it("shows uncontrolled routes when controlledRoutes is absent", () => {
    // A server that cannot distinguish uncontrolled from off must not guess.
    // The deny-list and the frozen list — the two that must always hold — are
    // applied before this, so falling open costs nothing they protect.
    const legacy: FeatureFlagsResponse = {
      enabledKeys: ["feature_avm"],
      enabledRoutes: ["/avm"],
    };
    expect(resolveRouteEnabled(legacy, "/today")).toBe(true);
    expect(resolveRouteEnabled(legacy, "/marketplace")).toBe(false);
    expect(resolveFlagEnabled(legacy, "feature_anything")).toBe(true);
  });
});

describe("the server sends what the client now needs", () => {
  it("/api/config/features SENDS controlledKeys and controlledRoutes", async () => {
    // Built-but-unwired guard: the client rule is inert unless the server
    // actually sends the fields, and the legacy fallback deliberately hides
    // that by falling open.
    //
    // This asserts on the res.json() ARGUMENT, not on the handler body. An
    // earlier draft searched the whole body and stayed green when the fields
    // were dropped from the response while their `const` declarations
    // remained — the identifier was present, the behaviour was not.
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(path.resolve(__dirname, "../../server/routes.ts"), "utf8");
    const handler = src.slice(src.indexOf('app.get("/api/config/features"'));
    const body = handler.slice(0, handler.indexOf("\n  });"));

    // Every res.json(...) payload the handler can return — the success path and
    // the catch path — must carry both fields.
    const payloads = [...body.matchAll(/res\.json\(\{([\s\S]*?)\}\);/g)].map((m) => m[1]);
    expect(payloads.length, "no res.json payload found — the scan broke").toBeGreaterThanOrEqual(2);
    for (const payload of payloads) {
      expect(payload, "a response path omits controlledKeys").toContain("controlledKeys");
      expect(payload, "a response path omits controlledRoutes").toContain("controlledRoutes");
    }

    // And they are derived from ALL flags, not just the enabled ones, which is
    // the whole distinction.
    expect(body).toMatch(/controlledRoutes = \[\.\.\.new Set\(flags\.flatMap/);
    expect(body).toMatch(/controlledKeys = flags\.map/);
  });
});

describe("one response contract, one owner", () => {
  it("EXACTLY ONE handler declares /api/config/features", () => {
    // `routes-admin.ts:3031` declared a second one until 2026-08-18. It was
    // shadowed by routes.ts:405 (which registers first and wins) and so was
    // dead — but it returned only enabledKeys/enabledRoutes, with no deny-lists
    // and none of the controlled* fields. Had registration order ever shifted,
    // every uncontrolled route would have vanished from the nav.
    //
    // Deleted by founder ruling 2026-08-18. This pins the count rather than the
    // file, so a third declaration anywhere fails the same way.
    const fs = require("node:fs") as typeof import("node:fs");
    const path = require("node:path") as typeof import("node:path");
    const dir = path.resolve(__dirname, "../../server");
    const decls: string[] = [];
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith(".ts") || f.endsWith(".test.ts")) continue;
      const src = fs.readFileSync(path.join(dir, f), "utf8");
      src.split("\n").forEach((line, i) => {
        const code = line.split("//")[0];
        if (/\.(get|post|use)\(\s*["'`]\/api\/config\/features["'`]/.test(code)) {
          decls.push(`${f}:${i + 1}`);
        }
      });
    }
    expect(decls.length, `handlers found: ${decls.join(", ")}`).toBe(1);
    expect(decls[0]).toMatch(/^routes\.ts:/);
  });
});
