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
 * IT IS GONE NOW — DELETED 2026-08-13 ON THE FOUNDER'S RULING (BLOCKERS B12).
 * The deletion-ledger KILL verdict was executed: the page, its seven
 * `components/negotiation/*` satellites, the `/api/negotiation` rail, the three
 * further copilot endpoints in `routes-ai-operations.ts` that this file's own
 * finding turned up, and `services/negotiationCopilot.ts` are all deleted. The
 * negotiation capability the founder kept is `POST /api/ai/negotiation/script`
 * on `negotiationOrchestrator`, called by the deal detail view **behind the
 * Deals door** — which is the shape this rule asks for.
 *
 * So the checks below changed meaning, deliberately, rather than being deleted:
 * the exempt-destination set is now asserted EMPTY where it was asserted to be
 * exactly `/negotiation`, and the vacuity guard can no longer prove the
 * component detector is alive by pointing at a live offender — there isn't one.
 * It exercises the detector directly instead. That is the stronger form: a
 * detector proved by a sample keeps working when the app is clean, whereas a
 * detector proved by the offender it found stops being checked the moment
 * someone fixes the offence.
 *
 * `/negotiation` KEEPS its `FROZEN_ROUTES` entry. Removing it would read as
 * "unfrozen", the opposite of what happened, and the list is served to clients
 * that may still be running an older bundle.
 *
 * THE FOUNDER PLANE IS OUT OF SCOPE, deliberately. `/founder/chat`,
 * `/founder/solene-chat`, `/founder/ai-observatory`, `/founder/pax-traces` and
 * `/founder/pax-calibration` are instruments on the founder surface, which has
 * its OWN four-doors rule and an explicit `/founder/admin/*` namespace for deep
 * panels. The customer-side rule is about the customer's five doors; applying
 * it to the founder plane would be enforcing a rule that was never written.
 *
 * THE SECOND DEFECT: THE PARSER, NOT THE DETECTORS (fixed 2026-08-16).
 * -------------------------------------------------------------------
 * An enforcement audit found this file green while the rule it cites was
 * breakable — not because a detector was too narrow, but because the ROUTE
 * PARSER was. `routes()` matched only the BLOCK form,
 * `<Route path="…">…</Route>`, so a route written self-closing —
 *
 *     <Route path="/copilot" component={CopilotPage} />
 *
 * — was never PARSED AT ALL. There was nothing for either detector to match
 * against: the path check never saw `/copilot`, the component check never saw
 * `CopilotPage`, and the file reported "one destination, two aliases" exactly
 * as before. Verified: that line pasted into `App.tsx` left this suite 12/12
 * green. App.tsx had 301 `<Route>` tags carrying a path; the old regex parsed
 * 269 of them. **32 routes — 11% of the router — were invisible to a gate whose
 * whole job is to look at routes.** That is the PARTIAL-nameonly failure in its
 * purest form: the gate keyed on a SYNTAX, and the same surface expressed in
 * the other syntax walked past a passing test.
 *
 * The fix is not another detector. It is:
 *
 *   1. `routeTags()` — a brace- and quote-aware scan of EVERY `<Route …>`
 *      opening tag, self-closing or not, so `routes()` covers both forms. A
 *      self-closing route's attribute list IS its body, so `component={…}`
 *      still reaches the component detector.
 *   2. `it("the parser sees EVERY <Route> tag in App.tsx")` — the assertion
 *      that matters. Parsed-with-path + recognised-pathless must equal the
 *      total `<Route` count. It converts "my regex missed a syntax" from a
 *      SILENT POPULATION SHRINK into a red test. Under the old shape, dropping
 *      32 routes cost nothing; under this one it fails loudly, and every
 *      assertion downstream inherits the guarantee that it inspected the whole
 *      router.
 *
 * Widening the parser added 32 routes and ZERO new AI hits (the AI set is the
 * same four routes before and after) — the newly visible 32 are the public
 * marketing/portal routes, all self-closing. So this costs no noise; it closes
 * a hole.
 *
 * WHAT THIS FILE STILL CANNOT CATCH — stated plainly rather than papered over.
 * -------------------------------------------------------------------
 * A NEUTRALLY-NAMED AI destination at a NEUTRALLY-NAMED path —
 * `<Route path="/workspace" component={WorkspacePage} />`, where `WorkspacePage`
 * happens to be a full chat surface — is NOT caught, in either syntax. Both
 * detectors key on names, and by construction neither name says "AI".
 *
 * It is left uncaught on purpose, and the decision was MEASURED, not assumed.
 * The only mechanical way to reach a neutrally-named surface is to follow each
 * route's component into its module and judge the CONTENT — AI-SDK imports,
 * `useChat`, `/api/ai/*` calls, streaming. Run against this repo's 160
 * customer routes with a resolvable page module, that predicate scores:
 *
 *     depth 0 (the page file only)      5 / 160 routes flagged
 *     depth 1 (+ its direct imports)   10 / 160
 *     depth 2 (+ one level further)   113 / 160   ← 71% of the customer surface
 *     depth 3                         113 / 160   (saturated)
 *
 * Depth 0-1 is cheap but trivially evaded — move the chat into a child
 * component and the scan goes quiet, which is a gate that only catches the
 * careless. Depth 2 is where it stops being evadable, and there it flags 113
 * routes against ZERO actual violations: `/leases`, `/permits`, `/rent-roll`,
 * `/closing-costs`, `/zoning`…
 *
 * The reason is structural, and it is the rule itself. Pax is SUPPOSED to be
 * reachable from everywhere behind the doors. So "this route can reach AI
 * code" is true almost everywhere BY DESIGN — the predicate measures
 * compliance with the rule, not violation of it, and inverting a compliance
 * signal into an alarm is how you get a 113-line failure that the next person
 * re-baselines to 113 and stops reading. This program already narrowed one
 * proposed check from 237 hits to 10 for exactly that reason; a 113-hit check
 * would be the same mistake with this file's name on it.
 *
 * So the honest boundary is: **this file pins that every route in App.tsx is
 * SEEN, and that no route NAMED for AI — by path or by component, in either
 * syntax — is a second destination. It does not pin the content of a route
 * named for nothing.** A reviewer, not a regex, owns that case, and the test
 * "records the residual limit" below states it as an executable fact so this
 * file cannot be mistaken for claiming coverage it does not have. Do not
 * "fix" that by bolting on an import-scanning heuristic without re-measuring
 * the table above; an overstated gate is worse than a scoped one, and is the
 * defect this whole audit is about.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { CONSTITUTION } from "@shared/governance/constitution";
import { FROZEN_ROUTES, isFrozenRoute } from "@shared/feature-freeze";

const ROOT = path.resolve(__dirname, "../..");
const app = fs.readFileSync(path.join(ROOT, "client/src/App.tsx"), "utf8");

/**
 * EVERY `<Route …>` opening tag in App.tsx — both syntaxes.
 *
 * The previous version of this file went straight from a regex to a route
 * list, and that regex required the tag to end in a bare `>`. Self-closing
 * routes (`<Route path="/x" component={X} />`) therefore did not exist as far
 * as this gate was concerned — 32 of App.tsx's routes, silently.
 *
 * So the tag scan is separated out and made syntax-agnostic: find each
 * `<Route` (word-bounded, so `<RouteFallback>` is not one) and walk forward to
 * the `>` that closes the opening tag, tracking `{}` depth and quotes so an
 * inline `component={() => <X a=">" />}` cannot end the tag early. The result
 * is the DENOMINATOR the vacuity assertion below measures `routes()` against.
 */
function routeTags(source: string = app): Array<{ tag: string; end: number; selfClosing: boolean }> {
  const out: Array<{ tag: string; end: number; selfClosing: boolean }> = [];
  for (const m of source.matchAll(/<Route\b/g)) {
    const start = m.index ?? 0;
    let i = start + m[0].length;
    let depth = 0;
    let quote = "";
    while (i < source.length) {
      const c = source[i];
      if (quote) {
        if (c === quote && source[i - 1] !== "\\") quote = "";
      } else if (c === '"' || c === "'" || c === "`") {
        quote = c;
      } else if (c === "{") {
        depth++;
      } else if (c === "}") {
        depth--;
      } else if (c === ">" && depth === 0) {
        break;
      }
      i++;
    }
    const selfClosing = source[i - 1] === "/";
    out.push({ tag: source.slice(start, selfClosing ? i - 1 : i), end: i, selfClosing });
  }
  return out;
}

/** The `path` attribute of an opening tag, wherever in the tag it sits. */
const PATH_ATTR = /\bpath=\{?\s*["'`]([^"'`]+)["'`]/;

/**
 * Every routed path and the body it renders — BOTH the block form
 * `<Route path="…">…</Route>` and the self-closing form
 * `<Route path="…" component={X} />`.
 *
 * The block body is bounded at the closing `</Route>` — not at the next
 * `<Route`, because a nested or commented route would otherwise merge two
 * bodies and let one route's redirect satisfy an assertion about another's.
 * For a self-closing route the OPENING TAG IS THE BODY: that is where
 * `component={…}` lives, which is what the component-name detector reads. The
 * opening tag is prepended to the block body too, so a block route that also
 * carries a `component=` prop is judged on both.
 */
function routes(source: string = app): Array<{ path: string; body: string; selfClosing: boolean }> {
  const out: Array<{ path: string; body: string; selfClosing: boolean }> = [];
  for (const t of routeTags(source)) {
    const m = PATH_ATTR.exec(t.tag);
    if (!m) continue; // pathless catch-all (`<Route component={NotFound} />`)
    if (t.selfClosing) {
      out.push({ path: m[1], body: t.tag, selfClosing: true });
      continue;
    }
    const close = source.indexOf("</Route>", t.end);
    const inner = source.slice(t.end + 1, close === -1 ? t.end + 400 : close);
    out.push({ path: m[1], body: t.tag + inner, selfClosing: false });
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

  it("the parser sees EVERY <Route> tag in App.tsx (parser vacuity guard)", () => {
    // THE ASSERTION THIS FILE WAS MISSING, and the reason it was green while
    // the rule was breakable.
    //
    // The old guard was `routes().length > 50`. It could not tell "parsed the
    // whole router" from "parsed 269 of 301 routes and lost the other 32",
    // because it compared the population to a floor rather than to the file.
    // A self-closing route was never parsed, so no detector ever ran on it —
    // the surface was not MISSED by the checks, it was INVISIBLE to them.
    //
    // This compares the parse to the source. Every `<Route` in App.tsx must be
    // enumerated, and every enumerated tag that DECLARES a path must have had
    // that path READ. A future syntax this file cannot handle — a computed
    // `path={ROUTES.x}`, a `path` attribute written after `component`, a
    // wrapper element — then fails here loudly instead of quietly shrinking
    // the population every assertion below depends on.
    const tags = routeTags();
    const parsed = routes();
    // Counted with a different spelling than routeTags() uses, so a narrowed
    // regex in the walker cannot hide behind its own definition.
    const rawTagStarts = (app.match(/<Route(?![A-Za-z0-9_])/g) ?? []).length;
    // "Declares a path" (crude), vs PATH_ATTR's "…and this file could read it".
    const declarePath = tags.filter((t) => /\bpath=/.test(t.tag));

    expect(rawTagStarts, "no <Route …> tags found in App.tsx at all").toBeGreaterThan(250);
    expect(
      tags.length,
      "the tag walker enumerated fewer <Route> tags than exist in App.tsx — " +
        "it is skipping tags, so every count below is understated",
    ).toBe(rawTagStarts);
    // Two ways the parse can fall short, and the message has to distinguish
    // them or the next person debugs the wrong one. Mutation-testing this file
    // produced both: a computed `path={ROUTES.x}` leaves the tag unreadable,
    // whereas a parser regressed to block-only reads the path fine and drops
    // the route anyway.
    const unreadable = declarePath.filter((t) => !PATH_ATTR.test(t.tag));
    expect(
      parsed.length,
      `${declarePath.length - parsed.length} of ${declarePath.length} <Route> tag(s) ` +
        "that declare a path were dropped from the population every assertion " +
        "below inspects. " +
        (unreadable.length
          ? "Their path syntax is unreadable to PATH_ATTR: " +
            unreadable.map((t) => t.tag.replace(/\s+/g, " ").slice(0, 90)).join(" | ")
          : "Their paths ARE readable, so routes() is discarding tags for some " +
            "other reason — check that BOTH the self-closing and block branches " +
            "still push (dropping the self-closing branch alone costs 32 routes).") +
        " — teach routes()/PATH_ATTR the syntax rather than lowering this " +
        "assertion. A gate that silently stops looking at part of the router " +
        "is the exact defect this guard exists to make impossible.",
    ).toBe(declarePath.length);

    // Both syntaxes must actually be present, or one branch of the parser is
    // dead code and could rot without anything noticing — which is how the
    // self-closing branch came to be missing in the first place.
    expect(
      parsed.filter((r) => r.selfClosing).length,
      "no SELF-CLOSING <Route … /> parsed. Either App.tsx stopped using that " +
        "form, or the parser regressed to the block-only shape that let " +
        '`<Route path="/copilot" component={CopilotPage} />` walk past this suite.',
    ).toBeGreaterThan(10);
    expect(
      parsed.filter((r) => !r.selfClosing).length,
      "no BLOCK-form <Route …>…</Route> parsed",
    ).toBeGreaterThan(10);

    // The only tags allowed to carry no path are wouter catch-alls.
    const pathless = tags.filter((t) => !/\bpath=/.test(t.tag));
    expect(
      pathless.map((t) => t.tag.replace(/\s+/g, " ").trim()).join(" | "),
      "more pathless <Route> tags than the single NotFound catch-all. A " +
        "pathless route matches everything, so a new one is a routing change " +
        "this gate cannot reason about — name it explicitly here.",
    ).toBe("<Route component={NotFound}");

    expect(ai.map((r) => r.path), "the /ai door is gone").toContain("/ai");
  });

  it("the component-name detector still detects (it is half of this check)", () => {
    // It used to be proved by pointing at /negotiation — the surface it found
    // that a path-name scan could not see. That surface was deleted on the
    // founder's ruling, and an anchor to a live offender dies with the offence,
    // so the detector is exercised against samples instead. If it stopped
    // matching, this file would silently revert to the path-only check that
    // missed /negotiation in the first place, and would keep passing while
    // doing less.
    const bodies = [
      "{() => <FlaggedRoute route=\"/negotiation\" component={NegotiationCopilotPage} />}",
      "{() => <ProtectedRoute component={UnderwritingAssistantPage} />}",
      "{() => <ProtectedRoute component={AiInsightsPage} />}",
      "{() => <ProtectedRoute component={OutreachCopilot} />}",
      "{() => <ProtectedRoute component={SoleneConsole} />}",
      // A self-closing route's BODY is its own opening tag — the shape
      // `routes()` now produces for that form. The detector has to match there
      // too, or widening the parser would hand the detectors a body they
      // cannot read and change nothing.
      '<Route path="/negotiation" component={NegotiationCopilotPage}',
      '<Route path="/x" component={PaxWorkbench}',
    ];
    for (const body of bodies) {
      expect(AI_COMPONENT.test(body), `the component detector missed: ${body}`).toBe(true);
    }
    // And it must not match everything — a detector that flags every route is
    // the same as no detector, and would be "fixed" by deleting this file.
    for (const body of [
      "{() => <ProtectedRoute component={DealsPage} />}",
      "{() => <ProtectedRoute component={FinancePage} />}",
    ]) {
      expect(AI_COMPONENT.test(body), `the component detector over-matches: ${body}`).toBe(false);
    }
  });

  it("the SELF-CLOSING bypass is caught end-to-end (it was green before 2026-08-16)", () => {
    // The verified bypass, verbatim. Pasted into App.tsx it left this suite
    // 12/12 green, because the old parser matched only `…>` and this route was
    // never parsed at all — the detectors were never even offered it.
    //
    // Running the real parser + the real detectors over a synthetic source
    // pins the fix permanently, instead of relying on someone re-performing
    // the mutation by hand. If routes() ever regresses to the block-only
    // shape, `parsed` loses /copilot and this fails on the first assertion.
    const SYNTHETIC = [
      '      <Route path="/copilot" component={CopilotPage} />',
      '      <Route path="/negotiation" component={NegotiationCopilotPage} />',
      '      <Route path="/ai">',
      "        {() => <ProtectedRoute component={PaxPage} />}",
      "      </Route>",
    ].join("\n");

    const parsed = routes(SYNTHETIC);
    expect(
      parsed.map((r) => r.path),
      "the parser dropped a self-closing route again — the exact regression " +
        "this test exists to prevent",
    ).toEqual(["/copilot", "/negotiation", "/ai"]);

    const offenders = parsed.filter(
      (r) =>
        !r.path.startsWith("/founder") &&
        (AI_NAMED.test(r.path) || AI_COMPONENT.test(r.body)) &&
        isDestination(r.path) &&
        r.path !== "/ai" &&
        !REDIRECTS.test(r.body),
    );
    expect(
      offenders.map((r) => r.path).sort(),
      "a self-closing AI destination parsed but was not flagged as one",
    ).toEqual(["/copilot", "/negotiation"]);

    // …and each is caught for the right reason: /copilot by its PATH, and
    // /negotiation — a business noun — only by its COMPONENT. Both detectors
    // must reach the self-closing body, not just one.
    const copilot = parsed.find((r) => r.path === "/copilot")!;
    const negotiation = parsed.find((r) => r.path === "/negotiation")!;
    expect(AI_NAMED.test(copilot.path), "/copilot not caught by the path detector").toBe(true);
    expect(AI_NAMED.test(negotiation.path), "/negotiation should NOT look AI-named").toBe(false);
    expect(
      AI_COMPONENT.test(negotiation.body),
      "the component detector cannot read a self-closing route's body — " +
        "widening the parser would then have changed nothing",
    ).toBe(true);
  });

  it("records the residual limit: a neutral component at a neutral path is NOT caught", () => {
    // Stated as an executable fact rather than a footnote, so nobody reads
    // this file as claiming coverage it does not have.
    //
    // `<Route path="/workspace" component={WorkspacePage} />` where
    // WorkspacePage is a full chat surface is a real AI destination and this
    // gate does not flag it. Both detectors key on names; by construction
    // neither name says AI. The parser DOES see it now — that part is fixed —
    // but seeing is not judging.
    //
    // The only mechanical alternative is to follow each route's component into
    // its module and judge content (AI-SDK imports, useChat, /api/ai calls).
    // MEASURED on this repo, over the 160 customer routes with a resolvable
    // page module: 5 hits at import-depth 0, 10 at depth 1, and 113 at depth 2
    // — where it first stops being evadable by moving the chat into a child
    // component. 113 of 160 is 71% of the customer surface flagged against
    // zero real violations, because Pax being reachable from everywhere behind
    // the doors is what the rule ASKS FOR. That check would measure compliance
    // and report it as violation, and the next person would re-baseline it.
    // Scoped-and-honest beats broad-and-ignored. A human reviewer owns this
    // case; if that ever changes, re-measure the hit count BEFORE adopting.
    const SYNTHETIC = '      <Route path="/workspace" component={WorkspacePage} />';
    const parsed = routes(SYNTHETIC);

    // The parser sees it. This half IS pinned.
    expect(parsed.map((r) => r.path), "the parser stopped seeing the route entirely").toEqual([
      "/workspace",
    ]);
    // The detectors do not fire. This half is NOT pinned, and says so.
    expect(AI_NAMED.test("/workspace")).toBe(false);
    expect(AI_COMPONENT.test(parsed[0].body)).toBe(false);
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

  it("there are NO exempt AI destinations left", () => {
    // This assertion used to read `.toBe("/negotiation")`: one exempt
    // destination, excused because it was frozen. The KILL was executed
    // 2026-08-13 and the set is empty, so the assertion says empty. A frozen
    // page was always a KILL verdict awaiting deletion, never a parking space
    // for new AI surfaces — with the parking space gone, anything that lands
    // here is a new destination and has to answer for itself.
    const exempt = ai
      .filter((r) => isDestination(r.path) && r.path !== "/ai" && !REDIRECTS.test(r.body))
      .map((r) => r.path)
      .sort();
    expect(
      exempt.join(", "),
      "an AI destination appeared that neither redirects into /ai nor sits " +
        "behind a door. The last one (/negotiation) was deleted rather than " +
        "excused — freezing a page is not a way to keep it. Put the surface " +
        "behind /ai as a section, or behind the door it belongs to as a tab.",
    ).toBe("");
  });

  it("/negotiation keeps its freeze entry even though the page is deleted", () => {
    // Removing the entry would read as "unfrozen", which is the opposite of
    // what happened, and FROZEN_ROUTES is served to clients through
    // /api/config/features — including clients still running an older bundle
    // whose JS still has the route. They get a clean "not available" instead of
    // a chunk-load error against a bundle the server no longer has.
    // /vision-ai set this precedent; /negotiation follows it.
    expect(
      FROZEN_ROUTES,
      "/negotiation's freeze entry was removed after the page was deleted. " +
        "That reads as an unfreeze, and it un-hides the route for any client " +
        "still holding the old bundle. See the /vision-ai precedent in " +
        "shared/feature-freeze.ts.",
    ).toContain("/negotiation");
    // …and the page really is gone, so the entry above is doing the cached-client
    // job described and not hiding a live surface.
    expect(
      fs.existsSync(path.join(ROOT, "client/src/pages/negotiation-copilot.tsx")),
      "the standalone copilot page is back while still listed as frozen — " +
        "either it was reactivated without removing the freeze (so it is dead " +
        "on arrival) or the KILL was reverted",
    ).toBe(false);
    expect(
      fs.existsSync(path.join(ROOT, "server/services/negotiationCopilot.ts")),
      "negotiationCopilot is back. The kept capability is negotiationOrchestrator " +
        "behind POST /api/ai/negotiation/script, called from the Deals door.",
    ).toBe(false);
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
