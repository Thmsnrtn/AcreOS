/**
 * ADOPTION — is any of this actually reached by a customer?
 *
 * Seven units built a complete canonical loop: five deterministic engines, four
 * append-only layers, evidence lineage, an outcome prompt, a calibration
 * instrument. Every one is tested, mounted and org-scoped. And for all of that
 * work, the number a customer actually acted on was still not being recorded
 * anywhere, because **no customer surface called any of it.**
 *
 * That is this repo's signature defect (`CLAUDE.md`: "built but unwired"), and
 * the uncomfortable observation is that this program produced a large instance
 * of it while writing tests about it. Per-layer tests, golden-loop tests and
 * `lint:reachability` all passed throughout: the routes ARE mounted, the stores
 * ARE called — by the routes. Nothing measured whether a real product surface
 * ever entered the loop.
 *
 * So this file measures exactly that, and holds it as a ratchet that may only
 * grow. It is deliberately a small, blunt number. A count of surfaces that write
 * into the canonical layers cannot be satisfied by another test, another layer,
 * or another engine — only by wiring something a customer touches.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");

/**
 * PRODUCT surfaces that record into the canonical loop.
 *
 * "Product surface" means a route a customer's own workflow reaches — NOT the
 * canonical layers' own CRUD endpoints. `/api/decisions` and `/api/scenarios`
 * let you record a decision if you already know the loop exists and choose to
 * call it; they are the loop's front door, not its adoption. This list counts
 * places where doing the ordinary thing writes the record as a side effect of
 * the work.
 */
const ADOPTING_SURFACES = [
  {
    file: "server/routes-flip-analyzer.ts",
    what: "drafting an offer from the MAO analyzer",
    // Drafting an offer is the moment the number stops being exploratory and
    // becomes a document. Recording on every MAO recompute would fill the
    // tables with keystrokes instead.
    writes: ["recordScenario(", "recordDecision("],
  },
  {
    file: "server/routes-va-engine.ts",
    what: "an offer resolving to accepted or rejected",
    // The other end of the same surface. Without it the decisions unit 22
    // records are ungradeable: something has to observe what happened.
    writes: ["recordOutcome("],
  },
  {
    file: "client/src/components/today/OutcomePrompt.tsx",
    what: "the Today card that asks what happened",
    // The first CLIENT surface in the loop. Everything before it was
    // server-side: the customer was never asked and never told.
    writes: ["/api/decisions/due", "/outcomes`"],
  },
] as const;

/**
 * Down-only is wrong here; this one may only GROW.
 *
 * Every other ratchet in this repo counts a defect and shrinks. This counts
 * coverage. Lowering it means a customer surface stopped recording why it did
 * what it did — which is precisely the regression the canonical layers exist to
 * prevent, and it would otherwise be invisible.
 */
const ADOPTING_SURFACE_BASELINE = 3;

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

/** Source minus comments — a rule must hold in CODE, not in the prose about it. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/(^|[^:])\/\/.*$/, "$1"))
    .join("\n");
}

/**
 * The body of the `catch (err) {` block starting at `from`, ending at the first
 * closing brace at its own indentation.
 *
 * Written after a fixed-size window read past the end of an inner catch and
 * picked up the enclosing handler's `Errors.badRequest` — so the assertion
 * "this catch does not throw" failed against code that does not throw. A
 * source assertion that reads past its subject is not stricter, it is wrong.
 */
function catchBody(src: string, from: number): string {
  const start = src.indexOf("} catch (err) {", from);
  if (start === -1) return "";
  const indent = " ".repeat(src.slice(0, start).length - src.lastIndexOf("\n", start) - 1);
  const end = src.indexOf(`\n${indent}}`, start + 1);
  return end === -1 ? src.slice(start) : src.slice(start, end);
}

describe("a real customer surface writes into the canonical loop", () => {
  it("every claimed surface really calls what it claims", () => {
    for (const surface of ADOPTING_SURFACES) {
      const src = read(surface.file);
      for (const fn of surface.writes) {
        // The literal is exact rather than having `(` appended: a client
        // surface's write is a URL, not a function call, and appending `(`
        // silently made this assertion unsatisfiable for one.
        expect(src, `${surface.file} (${surface.what}) does not reach ${fn}`).toContain(fn);
      }
    }
  });

  it("the count may only GROW", () => {
    // If this fails because the number went UP, raise the baseline in the same
    // commit — that is the whole point. If it fails because the number went
    // DOWN, a surface stopped recording its reasoning; restore it rather than
    // lowering the baseline.
    expect(ADOPTING_SURFACES.length).toBeGreaterThanOrEqual(
      ADOPTING_SURFACE_BASELINE,
    );
  });

  it("counts PRODUCT surfaces, not the canonical layers' own endpoints", () => {
    // `/api/decisions` and `/api/scenarios` calling the decision and scenario
    // stores is not adoption — it is the loop's front door talking to itself.
    // Counting them would let this ratchet be satisfied without a single
    // customer ever entering the loop.
    const files = ADOPTING_SURFACES.map((s) => s.file);
    expect(files).not.toContain("server/routes-decisions.ts");
    expect(files).not.toContain("server/routes-scenarios.ts");
  });
});

describe("the offer surface records reasoning the way the contract requires", () => {
  const src = read("server/routes-flip-analyzer.ts");
  const block = src.slice(src.indexOf("/api/flip-analyzer/offer"));

  it("passes INPUTS to the engine rather than the numbers it already computed", () => {
    // The route has `mao` in hand and deliberately does not hand its outputs
    // over. `recordScenario` computes, because a caller that supplies
    // pre-computed metrics can supply any metrics at all — and the stored
    // engine_version would then be a claim by the caller rather than a fact
    // about the arithmetic. The duplicate computeMao is pure arithmetic on
    // seven integers.
    expect(block).toMatch(/recordScenario\(orgId,\s*\{[\s\S]{0,400}engineId:\s*"flip_mao"/);
    expect(block).toMatch(/inputs:\s*\{[\s\S]{0,200}arvCents/);
    expect(block).not.toMatch(/recordScenario[\s\S]{0,600}metrics:/);
  });

  it("the decision CITES the scenario rather than restating its numbers", () => {
    expect(block).toMatch(/recordDecision\([\s\S]{0,3000}\[scenario\.id\]/);
  });

  it("names a real authority, never a generic one", () => {
    // BI72: automation must name the capability grant that permitted it, and a
    // user decision must name the role that acted. "system" or "autonomous"
    // here would be false — this route is reachable only by an authenticated
    // org member, and the offer is refused above if it exceeds the org's rule.
    expect(block).toMatch(/authority:\s*"org_member:flip_analyzer_offer"/);
    expect(block).toMatch(/actorRef:\s*getUserId\(req\)/);
    expect(block).toMatch(/actorType:\s*"user"/);
  });

  it("carries the org-rule vs platform-default distinction into `origin`", () => {
    // The analyzer already knows which figures are the operator's own rules and
    // which are platform defaults (`FigureSource`). Flattening that on the way
    // into the record is exactly how a platform default later reads as "what
    // the customer believed".
    expect(block).toMatch(/a\.source === "org_rule"/);
    expect(block).toMatch(/"platform-default"/);
    // And it stamps the assumptions computeMao actually produced — passing an
    // empty array here would record zero assumptions while looking correct.
    expect(block).toMatch(/stampAssumptionSources\(mao\.assumptions,\s*resolved\.sources\)/);
  });

  it("does NOT invent a review date", () => {
    // An offer's fate is usually known within weeks, so a review date would be
    // useful — and nothing in this request carries one. Defaulting would
    // manufacture a date the operator never chose, which is what the outcome
    // prompt exists to refuse. Null is the honest record until the UI asks.
    expect(block).toMatch(/reviewDueAt:\s*null/);
  });

  it("can never fail the offer it is recording", () => {
    // The offer row is already written when this runs. Failing the request now
    // would turn a bookkeeping problem into a lost draft offer, so the whole
    // recording is in its own try/catch and the catch only logs.
    const recording = block.slice(block.indexOf("let decisionSnapshotId"));
    expect(recording).toMatch(/try\s*\{[\s\S]{0,4000}\}\s*catch\s*\(err\)\s*\{/);
    const body = catchBody(recording, 0);
    expect(body).toContain("logger.warn");
    expect(body).not.toMatch(/throw|Errors\./);
  });

  it("reports null rather than omitting the id when recording failed", () => {
    // A caller must be able to tell "not recorded" from "not asked for".
    expect(block).toMatch(/decisionSnapshotId,/);
    expect(block).toMatch(/let decisionSnapshotId: number \| null = null/);
  });

  it("records once per deliberate act, not once per recompute", () => {
    // The MAO endpoint is the one a form calls as inputs change. It must NOT
    // record, or the tables fill with keystrokes and the calibration above them
    // measures drafts rather than decisions.
    const maoBlock = src.slice(
      src.indexOf('"/api/flip-analyzer/mao"'),
      src.indexOf('"/api/flip-analyzer/rental"'),
    );
    expect(maoBlock).not.toContain("recordScenario");
    expect(maoBlock).not.toContain("recordDecision");
  });
});

describe("the loop CLOSES on that surface — the offer is gradeable", () => {
  const flip = read("server/routes-flip-analyzer.ts");
  const va = read("server/routes-va-engine.ts");

  it("the offer row carries the decision that produced it", () => {
    // Without a link, an outcome would have to guess which decision it grades
    // by property — and a property with two offers makes that a coin flip.
    expect(read("shared/schema.ts")).toContain(
      'decisionSnapshotId: integer("decision_snapshot_id")',
    );
    expect(flip).toMatch(/\.values\(\{[\s\S]{0,900}decisionSnapshotId,/);
  });

  it("the link has NO foreign key, on purpose", () => {
    // offers.organization_id does not cascade while
    // decision_snapshots.organization_id does, so an FK would fail on tenant
    // deletion — the snapshots would go and the offers pointing at them would
    // block the delete. The read resolves through the org-scoped getDecision,
    // so a stale id yields nothing rather than leaking or crashing.
    const schema = read("shared/schema.ts");
    const decl = schema.slice(schema.indexOf('decisionSnapshotId: integer("decision_snapshot_id")'));
    expect(decl.slice(0, 120)).not.toContain("references(");
  });

  it("the reasoning is recorded BEFORE the offer, so the link is written once", () => {
    // Patching it in afterwards would leave a window where the offer exists
    // unexplained, and would need an UPDATE on a just-created row.
    expect(flip.indexOf("let decisionSnapshotId")).toBeLessThan(
      flip.indexOf(".insert(offers)"),
    );
  });

  it("an outcome is recorded ONLY on a real transition", () => {
    // The outcomes table is append-only, so a duplicate is permanent and would
    // double-count in every calibration built above it. Re-patching an
    // already-accepted offer must record nothing.
    expect(va).toMatch(/existing\.status !== nextStatus/);
    expect(va).toMatch(/existing\.decisionSnapshotId != null/);
  });

  it("uses the outcome kinds that already existed for exactly this", () => {
    expect(va).toContain('"offer_accepted"');
    expect(va).toContain('"offer_rejected"');
  });

  it("records NO actuals — an accepted offer measures nothing yet", () => {
    // This is the honest part. Accepting resolves the OFFER; it measures none
    // of what the decision forecast. Profit, ROI and total cost are unknown
    // until the deal closes and resells, so the variance layer must report them
    // `unmeasured` rather than being handed the offer amount dressed up as a
    // realised number.
    const block = va.slice(va.indexOf("const resolvedKind ="));
    expect(block).toMatch(/actuals:\s*\[\]/);
    expect(block.slice(0, 2000)).not.toMatch(/actuals:\s*\[\s*\{/);
  });

  it("observes when the seller responded, not when the offer was made", () => {
    // Back-dating to the offer's creation would make every response look
    // instant, and hold-period style metrics built on it would be wrong.
    expect(va).toMatch(/observedAt:\s*offer\?\.respondedAt/);
  });

  it("an offer status update never fails because its bookkeeping did", () => {
    const block = va.slice(va.indexOf("const resolvedKind ="));
    const body = catchBody(block, 0);
    expect(body).toContain("logger.warn");
    expect(body).not.toMatch(/throw|Errors\./);
  });
});

describe("the customer is finally ASKED — and the asking is honest", () => {
  const card = read("client/src/components/today/OutcomePrompt.tsx");
  const today = read("client/src/pages/today.tsx");

  it("is rendered on Today, not behind a sixth door", () => {
    // The customer nav is five fixed doors and no new surface may become a
    // sixth. This is an attention item and Today is the attention door, so it
    // is a CARD there — nothing is added to NAV_MODULES.
    expect(today).toContain("<OutcomePrompt />");
    expect(read("client/src/components/layout-sidebar.tsx")).not.toContain("OutcomePrompt");
    expect(read("client/src/lib/nav-items.ts")).not.toContain("outcome");
  });

  it("offers `still open` as an ANSWER, never a dismissal", () => {
    // A card you can only silence by claiming a result is a card that
    // manufactures results. "Still open" appends an interim observation, which
    // is what the immutable record needs to stay honest about an unresolved
    // position — and there is deliberately no "dismiss".
    expect(card).toContain('kind: "still_open"');
    // Comments stripped: the header explains WHY there is no dismiss, so
    // scanning the prose finds the word it exists to forbid.
    expect(stripComments(card)).not.toMatch(/dismiss|snooze|remind me later/i);
  });

  it("asks for NO numbers", () => {
    // An outcome's `actuals` are MEASUREMENTS. A figure typed into a prompt
    // three months later to clear a card is not one, and the variance layer
    // reporting `unmeasured` is the true answer until something measures it.
    expect(card).toMatch(/actuals:\s*\[\]/);
    expect(card).not.toMatch(/<Input/);
  });

  it("never pre-selects an answer", () => {
    // A default selection is a guess wearing a user's signature. The panel opens
    // with nothing chosen.
    expect(card).toMatch(/useState<number \| null>\(null\)/);
    expect(card).not.toMatch(/defaultValue=|defaultChecked/);
  });

  it("shows how many times it has already asked", () => {
    // Someone who has answered "still open" twice is being asked a third time.
    // Saying so is the difference between a prompt and a nag.
    expect(card).toContain("interimObservations");
  });

  it("uses the house loading, empty and error states rather than a spinner", () => {
    expect(card).toContain("<Skeleton");
    expect(card).toContain("<EmptyState");
    expect(card).toContain("<QueryErrorState");
    expect(card).toContain("staggerContainer");
  });

  it("invalidates the calibration when an outcome lands", () => {
    // The whole reason to ask is that the answer feeds calibration. A stale
    // calibration after recording would show the customer a number that no
    // longer reflects what they just told us.
    expect(card).toContain('queryKey: ["/api/decisions/calibration"]');
    expect(card).toContain('queryKey: ["/api/decisions/due"]');
  });

  it("labels the answer group for a screen reader", () => {
    // Six unlabelled buttons in a row are meaningless out of visual context.
    expect(card).toMatch(/role="group"/);
    expect(card).toMatch(/aria-label=\{`Record what happened to/);
  });
});
