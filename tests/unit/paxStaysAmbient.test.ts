/**
 * Pax is ONE door, not an app-within-the-app.
 *
 * *"No new AI destinations — Pax stays ambient fabric behind the existing
 * doors, never a separate app-within-the-app."* — `CLAUDE.md`'s DO-NOT-DO list,
 * registered in `shared/governance/constitution.ts` as `ai.pax-stays-ambient`.
 *
 * It was the last **`prose-only`** entry in that registry, noted as *"Enforced
 * by the five-door ratchet indirectly (no new top-level entry). No dedicated
 * Pax-surface gate."* Indirect is the operative word, and it leaves a real gap:
 * the five-door ratchet governs what appears in the NAV. A second AI
 * destination that renders its own page and is reached by a link, a redirect
 * from an email, or a typed URL — never appearing in the sidebar at all —
 * passes that ratchet untouched while being exactly the app-within-the-app the
 * rule forbids.
 *
 * THE FIRST DRAFT OF THIS FILE MATCHED ON PATH NAMES ALONE, AND PASSED.
 * -------------------------------------------------------------------
 * It reported "one destination, two aliases" and was wrong twice over. Adding a
 * second detector — the NAME OF THE COMPONENT THE ROUTE RENDERS — found what
 * the path names could not:
 *
 *   /ai              → PaxPage                    the door
 *   /pax             → Redirect /ai               alias
 *   /ai-team         → Redirect /ai#agents        alias, deep-linking a section
 *   /agents          → Redirect /ai#agents        alias (path says nothing about AI)
 *   /command-center  → Redirect /ai#chat          alias (likewise)
 *   /settings/pax    → PaxControlsPage            behind the Settings door
 *   /negotiation     → NegotiationCopilotPage     A SECOND DESTINATION — frozen
 *
 * `/negotiation` is a 607-line AI surface — objection detection, counter-offer
 * suggestion, strategy recommendation, session workflow — at a TOP-LEVEL route,
 * rendering its own page. It is in no nav module and nothing in the client links
 * to it, which is precisely why the five-door ratchet never saw it. A path-name
 * check does not see it either: the path is a business noun and only the
 * component says "Copilot".
 *
 * It is not a live violation, and that is a deliberate decision rather than an
 * accident: `docs/company/deletion-ledger.md` carries a **KILL** verdict on it
 * ("Duplicate of the orchestrator, flagged off, no nav"), the orchestrator
 * itself lives on inside Pax, and `shared/feature-freeze.ts` hard-denies the
 * route ahead of every fail-open rule. So the rule is being upheld BY THE
 * FREEZE, not by absence — and this file now says so, so that unfreezing it
 * fails here and asks the un-freezer to put the surface behind a door.
 *
 * THE FOUNDER PLANE IS OUT OF SCOPE, deliberately. `/founder/chat`,
 * `/founder/solene-chat`, `/founder/ai-observatory`, `/founder/pax-traces` and
 * `/founder/pax-calibration` are instruments on the founder surface, which has
 * its OWN four-doors rule and an explicit `/founder/admin/*` namespace for deep
 * panels. The customer-side rule is about the customer's five doors; applying
 * it to the founder plane would be enforcing a rule that was never written.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { CONSTITUTION } from "@shared/governance/constitution";
import { FROZEN_ROUTES, isFrozenRoute } from "@shared/feature-freeze";

const ROOT = path.resolve(__dirname, "../..");
const app = fs.readFileSync(path.join(ROOT, "client/src/App.tsx"), "utf8");

/**
 * Every `<Route path="...">` and the body it renders.
 *
 * Bounded at the closing `</Route>` — not at the next `<Route`, because a
 * nested or commented route would otherwise merge two bodies and let one
 * route's redirect satisfy an assertion about another's.
 */
function routes(): Array<{ path: string; body: string }> {
  const out: Array<{ path: string; body: string }> = [];
  const re = /<Route\s+path=\{?["'`]([^"'`]+)["'`]\}?\s*>/g;
  for (const m of app.matchAll(re)) {
    const from = (m.index ?? 0) + m[0].length;
    const close = app.indexOf("</Route>", from);
    out.push({ path: m[1], body: app.slice(from, close === -1 ? from + 400 : close) });
  }
  return out;
}

/** A route whose PATH claims an AI surface. */
const AI_NAMED = /(^|\/)(ai|pax|assistant|copilot|chat)(-|$|\/)/i;

/**
 * A route whose RENDERED COMPONENT claims one. The detector that actually
 * found something: a new AI destination is far more likely to be named for the
 * business problem it solves (`/negotiation`, `/underwriting`, `/outreach`)
 * than for the machinery behind it, and the component name is where the
 * machinery shows.
 */
const AI_COMPONENT =
  /\b([A-Za-z0-9_]*(?:Pax|Copilot|Assistant|Chat|Solene)[A-Za-z0-9_]*|Ai[A-Z][A-Za-z0-9_]*)\b/;

function customerAiRoutes() {
  return routes().filter(
    (r) =>
      !r.path.startsWith("/founder") &&
      (AI_NAMED.test(r.path) || AI_COMPONENT.test(r.body)),
  );
}

/**
 * A DESTINATION is a top-level route. A route nested under a door is not one —
 * it is the shape the rule endorses ("new surfaces live behind existing doors
 * as a child, section or tab").
 *
 * The first draft of this file did not draw that line and flagged
 * `/settings/pax`, the Pax controls panel behind the Settings door. That is a
 * settings page for configuring Pax, not a second place Pax lives, and calling
 * it a violation would have inverted the rule: the very structure it asks for,
 * reported as breaking it.
 */
function isDestination(routePath: string): boolean {
  return routePath.replace(/^\//, "").replace(/\/$/, "").indexOf("/") === -1;
}

const REDIRECTS = /<Redirect\s+to=/;

describe("there is exactly one customer-facing AI destination", () => {
  const ai = customerAiRoutes();

  it("finds the AI routes at all (vacuity guard)", () => {
    // A changed Route syntax would otherwise make this file pass by inspecting
    // nothing — the failure mode every source scan in this program has hit.
    expect(routes().length, "no <Route path=…> parsed from App.tsx").toBeGreaterThan(50);
    expect(ai.map((r) => r.path), "the /ai door is gone").toContain("/ai");
    // Both detectors must be live. If the component detector stopped matching,
    // this file would silently revert to the path-only check that missed
    // /negotiation, and would keep passing while doing less.
    expect(
      ai.map((r) => r.path),
      "the component-name detector matches nothing — it is the half of this " +
        "check that found the surface a path-name scan could not see",
    ).toContain("/negotiation");
  });

  it("only /ai renders a page; every other AI DESTINATION redirects into it or is frozen", () => {
    const rendering = ai.filter(
      (r) =>
        isDestination(r.path) &&
        r.path !== "/ai" &&
        !REDIRECTS.test(r.body) &&
        !isFrozenRoute(r.path),
    );
    expect(
      rendering.map((r) => r.path).join(", "),
      "These AI-named routes RENDER their own page instead of redirecting to " +
        "/ai. Pax is ambient fabric behind the five doors, never a separate " +
        "app-within-the-app — a second destination reached by a typed URL or a " +
        "link never appears in the sidebar, so the five-door ratchet cannot " +
        "see it. If a new surface is genuinely needed, put it behind /ai as a " +
        "section or tab; if the founder has rescinded the rule, change " +
        "shared/governance/constitution.ts deliberately.",
    ).toBe("");
  });

  it("the only exempt destination is /negotiation, and only because it is FROZEN", () => {
    // Exemptions are listed, not inferred. The filter above would quietly
    // absorb a second, third and fourth frozen AI page; this assertion makes
    // each one a deliberate edit.
    const exempt = ai
      .filter((r) => isDestination(r.path) && r.path !== "/ai" && !REDIRECTS.test(r.body))
      .map((r) => r.path)
      .sort();
    expect(
      exempt.join(", "),
      "the set of frozen AI destinations changed. A frozen page is a KILL " +
        "verdict awaiting deletion, not a parking space for new AI surfaces — " +
        "if something new landed here, it belongs behind a door instead.",
    ).toBe("/negotiation");
  });

  it("/negotiation stays frozen until someone deliberately says otherwise", () => {
    // Inverted, like FOUNDER_ROUTE_BASELINE: a test cannot know whether the
    // standalone copilot should come back, but it can make coming back a
    // decision somebody reads a message about.
    expect(
      FROZEN_ROUTES,
      "/negotiation was unfrozen. It is a standalone AI copilot at a top-level " +
        "route — the deletion ledger's KILL verdict says the orchestrator lives " +
        "on inside Pax instead. Reachable again, it is a second AI destination: " +
        "put it behind /ai (or the Deals door) as a section, or cite the " +
        "ledger's reactivation criterion in the commit and update this file.",
    ).toContain("/negotiation");
  });

  it("an AI surface BEHIND a door is fine, and is not counted as a destination", () => {
    // Stated as its own assertion so the distinction is recorded rather than
    // hidden in a filter. `/settings/pax` is the Pax controls panel behind the
    // Settings door: a page for configuring Pax, not a second place Pax lives.
    // The rule asks for exactly this shape, so a checker that flagged it would
    // be inverting the rule it enforces.
    const nested = ai.filter((r) => !isDestination(r.path));
    expect(
      nested.map((r) => r.path),
      "the nested Pax surface is gone — if it moved to a top-level route, that " +
        "is the app-within-the-app this file exists to prevent",
    ).toContain("/settings/pax");
    for (const r of nested) {
      const door = "/" + r.path.split("/")[1];
      expect(
        ["/settings", "/today", "/maps", "/deals", "/pipeline", "/money", "/finance", "/inbox", "/ai"],
        `${r.path} is nested under ${door}, which is not one of the doors`,
      ).toContain(door);
    }
  });

  it("the aliases redirect INTO /ai, not somewhere else", () => {
    // A redirect to a different destination would satisfy "redirects" while
    // still creating a second place Pax lives.
    const aliases = ai.filter(
      (x) => isDestination(x.path) && x.path !== "/ai" && REDIRECTS.test(x.body),
    );
    expect(aliases.length, "every alias into /ai disappeared at once").toBeGreaterThan(0);
    for (const r of aliases) {
      const m = /<Redirect\s+to=["'`]([^"'`]+)["'`]/.exec(r.body);
      expect(m, `${r.path} has no redirect target`).not.toBeNull();
      expect(
        m![1].startsWith("/ai"),
        `${r.path} redirects to ${m![1]}, which is not the Pax door`,
      ).toBe(true);
    }
  });

  it("/ai is still a protected door", () => {
    // The other half of the rule, owned by sidebarHiddenRoutes.test.ts and
    // asserted here too: "one destination" is only the right shape while that
    // destination is a DOOR. If /ai stopped being protected, Pax would be a
    // hideable page rather than ambient fabric.
    const hidden = fs.readFileSync(
      path.join(ROOT, "client/src/lib/sidebar-hidden-routes.ts"),
      "utf8",
    );
    const at = hidden.indexOf("PROTECTED_DOOR_ROUTES");
    expect(at, "PROTECTED_DOOR_ROUTES is gone").toBeGreaterThan(-1);
    expect(hidden.slice(at, hidden.indexOf("]);", at))).toContain('"/ai"');
  });
});

describe("the constitution registry reflects reality", () => {
  const entry = CONSTITUTION.find((i) => i.id === "ai.pax-stays-ambient");

  it("the entry still exists", () => {
    expect(entry, "the Pax-ambient invariant is gone from the registry").toBeDefined();
  });

  it("it is no longer prose-only", () => {
    expect(entry!.enforcement.kind).toBe("ratchet-test");
  });

  it("its refs resolve", () => {
    for (const ref of entry!.enforcement.refs) {
      expect(fs.existsSync(path.join(ROOT, ref)), `${ref} does not exist`).toBe(true);
    }
    expect(entry!.enforcement.refs).toContain("tests/unit/paxStaysAmbient.test.ts");
  });

  it("NO prose-only entries remain", () => {
    // The point of units 51 and 52 together. Every decision in the registry now
    // has an automated backstop of some kind; "relies on vigilance" is no
    // longer a category anything sits in. This fails if a new decision is added
    // without one — which is the moment to write the gate, not later.
    const prose = CONSTITUTION.filter((i) => i.enforcement.kind === "prose-only");
    expect(
      prose.map((i) => i.id).join(", "),
      "a constitution entry is prose-only again. Every entry had an automated " +
        "backstop as of unit 52 — a decision recorded but unenforced is one " +
        "refactor from being gone, which is exactly what the marketplace " +
        "enterprise-tier bypass turned out to be.",
    ).toBe("");
  });
});
