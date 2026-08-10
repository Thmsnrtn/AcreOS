/**
 * Founder legacy-redirect collapse ratchet (F1 slice 1, 2026-08-10).
 *
 * The 24 redirect-only founder <Route> registrations in App.tsx were
 * collapsed into FOUNDER_LEGACY_REDIRECTS (client/src/lib/route-redirects.ts)
 * resolved by ONE catch-all route. This suite pins the invariants that make
 * that collapse safe:
 *
 *   1. every map entry redirects to a REAL registered route (no dead ends,
 *      no legacy→legacy chains — chains must be pre-flattened);
 *   2. no legacy path is shadowed by (or shadows) a real registration;
 *   3. the catch-all is wired and sits AFTER the last real founder route —
 *      wouter's Switch is first-match, so a real founder route registered
 *      after it would silently never render;
 *   4. no file under client/src or server grows a NEW legacy founder path
 *      literal. Files that still carry one are pinned in a shrink-only
 *      allowlist below (cleaning them is follow-up F1 work); an entry that
 *      goes clean MUST be removed in the same change.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import {
  FOUNDER_LEGACY_REDIRECTS,
  FOUNDER_LEGACY_ROUTE_PATTERN,
  composeFounderRedirect,
  resolveFounderLegacyPath,
} from "@/lib/route-redirects";

const ROOT = path.resolve(__dirname, "../..");
const APP = fs.readFileSync(path.resolve(ROOT, "client/src/App.tsx"), "utf-8");

const LEGACY_PATHS = Object.keys(FOUNDER_LEGACY_REDIRECTS);

/** Pathname → the file whose TABS declaration must carry the pinned tab value.
 *  Every tab-pinning canonical target must resolve through this map, so a
 *  future consolidation that pins tabs on a new hub must register it here. */
const HUB_FILES: Record<string, string> = {
  "/founder/admin/telemetry": "client/src/pages/founder/admin/telemetry.tsx",
  "/founder/autopilot/control": "client/src/pages/founder/autopilot-control.tsx",
  "/founder/admin/agents": "client/src/pages/founder/admin/agents.tsx",
};

describe("founder legacy-redirect map", () => {
  it("holds exactly the 40 known aliases — 24 from slice 1, 6 observability routes folded into /founder/admin/telemetry in slice 2, 5 Controls-cluster routes folded into /founder/autopilot/control in slice 3, and 5 agent-instrument routes folded into /founder/admin/agents in slice 4 (new aliases mean a real route was deleted — flatten it here deliberately)", () => {
    expect(LEGACY_PATHS).toHaveLength(40);
  });

  it("every legacy path is reachable through the catch-all pattern", () => {
    for (const legacy of LEGACY_PATHS) {
      expect(
        FOUNDER_LEGACY_ROUTE_PATTERN.test(legacy),
        `${legacy} does not match FOUNDER_LEGACY_ROUTE_PATTERN — its redirect is unreachable`,
      ).toBe(true);
    }
  });

  it("no legacy path doubles as a real registration (first-match would bypass the map)", () => {
    for (const legacy of LEGACY_PATHS) {
      expect(
        APP.includes(`path="${legacy}"`),
        `${legacy} is both a legacy map key and a real <Route> in App.tsx`,
      ).toBe(false);
    }
  });

  it("every canonical target is a registered real route, never another legacy key", () => {
    for (const [legacy, canonical] of Object.entries(FOUNDER_LEGACY_REDIRECTS)) {
      const pathname = canonical.split(/[?#]/)[0];
      expect(
        APP.includes(`path="${pathname}"`),
        `${legacy} → ${canonical}: target is not a registered <Route> in App.tsx`,
      ).toBe(true);
      expect(
        LEGACY_PATHS.includes(pathname),
        `${legacy} → ${canonical}: target is itself a legacy key — flatten the chain`,
      ).toBe(false);
    }
  });

  it("resolveFounderLegacyPath normalizes trailing slash + case, misses real/unknown paths", () => {
    expect(resolveFounderLegacyPath("/founder/todo")).toBe("/founder");
    expect(resolveFounderLegacyPath("/founder/todo/")).toBe("/founder");
    expect(resolveFounderLegacyPath("/Founder/Todo")).toBe("/founder");
    expect(resolveFounderLegacyPath("/founder/asks")).toBe("/founder/decisions");
    expect(resolveFounderLegacyPath("/founder")).toBeNull();
    expect(resolveFounderLegacyPath("/founder/does-not-exist")).toBeNull();
  });

  it("each retired observability route lands on its own tab of the telemetry hub (slice 2)", () => {
    const HUB = "/founder/admin/telemetry";
    expect(resolveFounderLegacyPath("/founder/ai-observatory")).toBe(`${HUB}?tab=observatory`);
    expect(resolveFounderLegacyPath("/founder/telemetry")).toBe(`${HUB}?tab=api`);
    expect(resolveFounderLegacyPath("/founder/traces")).toBe(`${HUB}?tab=traces`);
    expect(resolveFounderLegacyPath("/founder/pax-traces")).toBe(`${HUB}?tab=pax-traces`);
    expect(resolveFounderLegacyPath("/founder/pax-calibration")).toBe(`${HUB}?tab=calibration`);
    expect(resolveFounderLegacyPath("/founder/event-log")).toBe(`${HUB}?tab=events`);
  });

  it("each retired Controls-cluster route lands on its own tab of the Controls door (slice 3)", () => {
    const HUB = "/founder/autopilot/control";
    expect(resolveFounderLegacyPath("/founder/autopilot/voice")).toBe(`${HUB}?tab=voice`);
    expect(resolveFounderLegacyPath("/founder/readiness")).toBe(`${HUB}?tab=readiness`);
    expect(resolveFounderLegacyPath("/founder/legal-readiness")).toBe(`${HUB}?tab=legal`);
    expect(resolveFounderLegacyPath("/founder/keys")).toBe(`${HUB}?tab=keys`);
    expect(resolveFounderLegacyPath("/founder/recovery-console")).toBe(`${HUB}?tab=recovery`);
  });

  it("each retired agent-instrument route lands on its own tab of the agents hub (slice 4)", () => {
    const HUB = "/founder/admin/agents";
    expect(resolveFounderLegacyPath("/founder/agent-queue")).toBe(`${HUB}?tab=queue`);
    expect(resolveFounderLegacyPath("/founder/governance")).toBe(`${HUB}?tab=governance`);
    expect(resolveFounderLegacyPath("/founder/trust-graduation")).toBe(`${HUB}?tab=trust`);
    expect(resolveFounderLegacyPath("/founder/memory")).toBe(`${HUB}?tab=memory`);
    expect(resolveFounderLegacyPath("/founder/scenarios")).toBe(`${HUB}?tab=scenarios`);
    // The slice-1 alias for the retired /founder/agents index pointed at
    // /founder/agent-queue, which slice 4 retired in turn. Chains must stay
    // pre-flattened, so it now points at the hub tab directly.
    expect(resolveFounderLegacyPath("/founder/agents")).toBe(`${HUB}?tab=queue`);
  });

  it("an agent-instrument redirect keeps whatever query the legacy link carried", () => {
    // A retired path may be linked with state (an id, a filter). The merge must
    // keep it AND pin the tab, not drop one for the other.
    expect(composeFounderRedirect(FOUNDER_LEGACY_REDIRECTS["/founder/memory"], "?q=zoning")).toBe(
      "/founder/admin/agents?q=zoning&tab=memory",
    );
  });

  it("every ?tab= a canonical target pins is a real tab value in its hub page", () => {
    for (const canonical of Object.values(FOUNDER_LEGACY_REDIRECTS)) {
      const [pathname, query] = canonical.split("?");
      const tab = new URLSearchParams(query ?? "").get("tab");
      if (!tab) continue;
      const hubFile = HUB_FILES[pathname];
      expect(
        hubFile,
        `${canonical}: pins a tab on ${pathname}, which is not a registered tab hub — add it to HUB_FILES`,
      ).toBeTruthy();
      const hub = fs.readFileSync(path.resolve(ROOT, hubFile), "utf-8");
      expect(
        hub.includes(`value: "${tab}"`),
        `${canonical}: tab "${tab}" is not declared in ${hubFile} TABS`,
      ).toBe(true);
    }
  });
});

/* A redirect that pins ?tab= only lands where it promises if the hub reads the
 * tab from the URL on EVERY render. founderHubTabs.test.ts pins that for the
 * two hubs it names by hand; this derives the same check from the redirect map
 * itself, so a hub added to HUB_FILES by a future consolidation cannot ship
 * uncontrolled (the failure mode is silent: the URL says ?tab=x, the page shows
 * the default tab). */
describe("every hub a redirect pins a tab on is URL-controlled", () => {
  for (const [basePath, file] of Object.entries(HUB_FILES)) {
    it(`${basePath} derives its visible tab from ?tab= and writes tab clicks back`, () => {
      const src = fs.readFileSync(path.resolve(ROOT, file), "utf-8");
      expect(src).toContain("useSearch()");
      expect(src).toMatch(/new URLSearchParams\(search\)\.get\("tab"\)/);
      expect(src).toMatch(/<Tabs\s[^>]*value=\{tab\}/);
      expect(src).toMatch(/onValueChange=/);
      expect(src, "an uncontrolled <Tabs defaultValue> reads the URL only at mount").not.toMatch(
        /<Tabs\s[^>]*defaultValue=/,
      );
      // …and writes the chosen tab back onto its OWN pathname, either by
      // building the literal (`${basePath}?tab=${v}`) or by setting the param
      // on the existing search (the form that also preserves other params).
      expect(
        src.includes(`${basePath}?tab=`) || /params\.set\("tab", ?\w/.test(src),
        `${file}: a tab click must write ?tab= back onto ${basePath}`,
      ).toBe(true);
      expect(src).toMatch(/\{\s*replace:\s*true,?\s*\}/);
    });
  }
});

describe("composeFounderRedirect (canonical query + incoming search merge)", () => {
  it("keeps the incoming search when the canonical has no query (the /founder/asks?id= trick)", () => {
    expect(composeFounderRedirect("/founder/decisions", "?id=42")).toBe("/founder/decisions?id=42");
    expect(composeFounderRedirect("/founder/decisions", "")).toBe("/founder/decisions");
  });

  it("merges a canonical ?tab= pin with the incoming search instead of concatenating two ?", () => {
    expect(composeFounderRedirect("/founder/admin/telemetry?tab=api", "?window=7d")).toBe(
      "/founder/admin/telemetry?window=7d&tab=api",
    );
    expect(composeFounderRedirect("/founder/admin/telemetry?tab=events", "")).toBe(
      "/founder/admin/telemetry?tab=events",
    );
  });

  it("the canonical query wins on conflict — the hub tab pin is not overridable by a stale bookmark", () => {
    expect(composeFounderRedirect("/founder/admin/telemetry?tab=api", "?tab=bogus")).toBe(
      "/founder/admin/telemetry?tab=api",
    );
  });
});

describe("the catch-all registration in App.tsx", () => {
  it("is wired (pattern + resolver component)", () => {
    expect(APP).toContain("path={FOUNDER_LEGACY_ROUTE_PATTERN}");
    expect(APP).toContain("<FounderLegacyRedirect />");
  });

  it("sits AFTER the last real founder registration (Switch is first-match)", () => {
    const catchAllAt = APP.indexOf("path={FOUNDER_LEGACY_ROUTE_PATTERN}");
    const lastRealAt = APP.lastIndexOf('path="/founder');
    expect(catchAllAt).toBeGreaterThan(-1);
    expect(lastRealAt).toBeGreaterThan(-1);
    expect(
      catchAllAt,
      "a real founder <Route> registered after the catch-all would never match — move it above the catch-all",
    ).toBeGreaterThan(lastRealAt);
  });

  it("the pattern spares the founder home and public founder-ish marketing paths", () => {
    expect(FOUNDER_LEGACY_ROUTE_PATTERN.test("/founder")).toBe(false);
    expect(FOUNDER_LEGACY_ROUTE_PATTERN.test("/founders-club")).toBe(false);
    expect(FOUNDER_LEGACY_ROUTE_PATTERN.test("/founder-letter")).toBe(false);
    expect(FOUNDER_LEGACY_ROUTE_PATTERN.test("/founder-dashboard")).toBe(true);
    expect(FOUNDER_LEGACY_ROUTE_PATTERN.test("/founder/anything/deep")).toBe(true);
  });
});

/* ── Derived sweep: no NEW legacy founder path literals ─────────────────
 *
 * A literal counts when it is quote-delimited and ends at a path boundary
 * (`"/founder/asks"`, `` `/founder/asks?id=${…}` ``, "/founder/now#x") —
 * i.e. real link/route emissions. Prose mentions in comments and mid-string
 * references ("review at /founder/dsar/recent") don't match, and neither do
 * links into REAL sub-routes ("/founder/agents/${codename}"), because `/`
 * is not a boundary.
 */
const SWEEP_DIRS = ["client/src", "server"];

/** Files still carrying a legacy literal when the collapse landed.
 *  SHRINK-ONLY: entries may be removed (after cleaning the file), never
 *  added. All of these keep working today because the catch-all still
 *  redirects — cleaning them to canonical paths is follow-up F1 work. */
const KNOWN_LEGACY_LITERAL_FILES: readonly string[] = [
  "client/src/components/founder/CanonicalSurfacesBanner.tsx",
  "client/src/components/layout-sidebar.tsx",
  "client/src/lib/featureFlags.ts",
  "client/src/pages/founder-decisions.tsx",
  // founder/autopilot-control.tsx removed 2026-08-10 (F1 slice 3): its
  // "/founder/autopilot" quick link was rewritten to "/founder" and the
  // "/founder/autopilot/voice" link became the hub's own ?tab=voice tab.
  "client/src/pages/founder/build.tsx",
  "client/src/pages/founder/customers.tsx",
  "client/src/pages/founder/inspector/org.tsx",
  "client/src/pages/founder/money.tsx",
  "client/src/pages/founder/team.tsx",
  "server/routes-founder-cockpit.ts",
  "server/services/agentRetractCron.ts",
  "server/services/aiAdvisorTeamV15.ts",
  "server/services/pillarReviewer.ts",
  "server/services/schemaDriftDetector.ts",
  "server/services/stripeDriftDetector.ts",
  "server/services/vendorSecretRotation.ts",
];

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\/-]/g, "\\$&");
const LEGACY_LITERAL_REGEXES = LEGACY_PATHS.map(
  (p) => new RegExp(`["'\`]${escapeRegex(p)}(?=["'\`?#])`),
);

function hasLegacyLiteral(source: string): string[] {
  return LEGACY_PATHS.filter((p, i) => LEGACY_LITERAL_REGEXES[i].test(source));
}

function walkSources(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.resolve(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      walkSources(full, out);
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry.name)) continue;
    if (/\.test\.(ts|tsx)$/.test(entry.name)) continue;
    out.push(full);
  }
  return out;
}

describe("legacy founder path literals (derived sweep)", () => {
  const files = SWEEP_DIRS.flatMap((d) => walkSources(path.resolve(ROOT, d)));
  const allowSet = new Set(KNOWN_LEGACY_LITERAL_FILES);
  // The map itself defines the legacy paths — it is the one legitimate home.
  const MAP_FILE = "client/src/lib/route-redirects.ts";

  it("no file outside the shrink-only allowlist emits a legacy founder path", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const rel = path.relative(ROOT, file).split(path.sep).join("/");
      if (rel === MAP_FILE || allowSet.has(rel)) continue;
      const hits = hasLegacyLiteral(fs.readFileSync(file, "utf-8"));
      if (hits.length > 0) offenders.push(`${rel} → ${hits.join(", ")}`);
    }
    expect(
      offenders,
      "New legacy founder path literal(s). Link the canonical route from " +
        "FOUNDER_LEGACY_REDIRECTS (client/src/lib/route-redirects.ts) instead.",
    ).toEqual([]);
  });

  it("every allowlist entry still contains a legacy literal (shrink the list when you clean a file)", () => {
    for (const rel of KNOWN_LEGACY_LITERAL_FILES) {
      const full = path.resolve(ROOT, rel);
      expect(fs.existsSync(full), `${rel} is allowlisted but does not exist — remove the entry`).toBe(true);
      const hits = hasLegacyLiteral(fs.readFileSync(full, "utf-8"));
      expect(
        hits.length,
        `${rel} no longer contains a legacy literal — remove it from KNOWN_LEGACY_LITERAL_FILES`,
      ).toBeGreaterThan(0);
    }
  });
});
