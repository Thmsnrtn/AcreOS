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
  {
    file: "client/src/components/deals/ForecastCalibration.tsx",
    what: "the Deals panel that shows what the answers were for",
    // The other half of the same loop. Asking without ever telling teaches a
    // customer that answering is pointless.
    writes: ["/api/decisions/calibration"],
  },
  {
    file: "server/routes-lot-pricing.ts",
    what: "locking a subdivision's asking-price grid",
    // The lock writes every child lot's listPrice — the price the market sees,
    // and the moment the grid stops being a preview. `lockedGrid` preserved the
    // OUTPUT and none of the reasoning: `rules` and `basePriceSource` live in
    // the SAME MUTABLE ROW the lock updates, so editing them afterwards leaves
    // the grid intact and destroys its explanation. The mirror image of the
    // note payoff path in MUST_NOT_ADOPT below, which already owns its own.
    //
    // No scenario, deliberately: a per-lot price grid is not expressed in the
    // shared metric vocabulary, and inventing a sixth engine to satisfy this
    // list is exactly the failure an up-only count invites.
    writes: ["recordDecision("],
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
const ADOPTING_SURFACE_BASELINE = 5;

/**
 * Surfaces that look like adoption candidates and MUST NOT become ones.
 *
 * An up-only count of adopting surfaces has a failure mode: it can be satisfied
 * by wiring the wrong thing. The criterion is not "this route writes something"
 * — it is **the reasoning would otherwise be LOST**. Where an equivalent
 * versioned record already owns that state, adding a Scenario creates a SECOND
 * owner of the same canonical state, which canonical law 1 forbids and which
 * this repo's whole "do not build a second X" discipline exists to prevent.
 *
 * The note payoff path is the standing example, and it is the one most likely
 * to be wired by mistake because it is the most obviously economics-shaped
 * route in the product. `note_payoff_quotes` persists `engine_version` (NOT
 * NULL), `day_count_convention` and the VERBATIM `engine_input_json` alongside
 * every output — it is already a complete, recomputable, defensible economics
 * record. `shared/economics/scenario.ts` names it in its own header as the
 * pattern the Scenario layer GENERALISES rather than replaces.
 */
/**
 * Surfaces that SHOULD adopt and structurally cannot yet.
 *
 * Distinct from MUST_NOT_ADOPT below, and the distinction matters: that list
 * says *never — another versioned record already owns this state*. This one
 * says *not until a real link exists*, and each entry names the missing column.
 *
 * THE DEAL CLOSE IS THE STANDING EXAMPLE, and it is the most tempting surface
 * in the repo. `PUT /api/deals/:id` transitioning to `closed` writes
 * `acceptedAmount` — a REALISED sale price, already fed to the valuation
 * training corpus as arm's-length ground truth. That is exactly the realised
 * number unit 27 went looking for and did not find, because it searched the
 * schema for `actualSalePrice` / `realizedProfit` / `actualProfit` and the value
 * is stored under a name that does not say "actual".
 *
 * So the close could resolve the decision that produced the offer — except
 * **there is no link to it**. `offers` has no `dealId`, `deals` has no
 * `offerId` and no `decisionSnapshotId`, and no code path anywhere creates a
 * deal FROM an offer (deals are created by the AI tools, the importer and the
 * sample seeder, independently). The only shared key is `propertyId`.
 *
 * Matching on `propertyId` is precisely what unit 23 refused when it added a
 * real `decision_snapshot_id` column rather than pairing offers to decisions by
 * property: one property carries many offers over time, so the pairing would be
 * a guess, and **a calibration built on mis-matched pairs is worse than one that
 * honestly reports `unmeasured`.**
 *
 * THIS REGISTRY UNBLOCKS ITSELF. The assertion is that the link is still
 * missing — so the day someone adds it, this fails and says the surface can now
 * adopt. A refusal that cannot notice its own reason disappearing is just a
 * hardcoded no.
 */
const BLOCKED_ON_A_REAL_LINK = [
  {
    file: "server/routes-deals.ts",
    what: "a deal closing, which writes a realised acceptedAmount",
    missing: "deals has no decisionSnapshotId and no offerId; offers has no dealId",
    /** Columns whose ARRIVAL means the block is over. */
    unblockedBy: [
      { table: "deals", column: "decisionSnapshotId" },
      { table: "offers", column: "dealId" },
    ],
  },
] as const;

const MUST_NOT_ADOPT = [
  {
    file: "server/routes-notes.ts",
    why: "note_payoff_quotes already persists engine_version + engine_input_json",
    ownedBy: "shared/schema/notes-vertical.ts",
  },
] as const;

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

/**
 * Source with comments stripped — a rule must hold in CODE, not in prose.
 *
 * LINE-BY-LINE, deliberately. The obvious one-regex implementation is wrong on
 * real source: an unbalanced block-comment OPENER inside a string or a regex
 * literal starts a comment that never closes where you expect, and everything
 * up to the next closer vanishes. Measured on
 * server/routes.ts it removed **38.8% of the file**, including the
 * `app.use("/api/admin", …)` line an assertion here was checking — so the
 * assertion failed against correct code, and a weaker assertion would have
 * PASSED against broken code.
 *
 * A state machine over lines cannot run away: a block comment must open and
 * close on lines, and a stray opener inside a string affects at most the
 * rest of that one line.
 */
function stripComments(src: string): string {
  const out: string[] = [];
  let inBlock = false;
  for (const line of src.split("\n")) {
    let s = line;
    if (inBlock) {
      const end = s.indexOf("*/");
      if (end === -1) { out.push(""); continue; }
      s = s.slice(end + 2);
      inBlock = false;
    }
    // Only treat `/*` as a comment when the line has no closing `*/` after it
    // AND the line looks like a comment line — anything else stays.
    const open = s.indexOf("/*");
    if (open > -1) {
      const close = s.indexOf("*/", open + 2);
      if (close > -1) {
        s = s.slice(0, open) + s.slice(close + 2);
      } else if (/^\s*\{?\s*\/\*/.test(s)) {
        // `{/*` too: a JSX comment is prose, and prose must not satisfy a
        // code assertion. Without this, a `{/* No "dismiss" ... */}` comment
        // made a test asserting the ABSENCE of "dismiss" fail on the very
        // comment documenting why it is absent.
        s = s.slice(0, open);
        inBlock = true;
      }
    }
    out.push(s.replace(/(^|[^:])\/\/.*$/, "$1"));
  }
  // The guard is STRUCTURAL, not a ratio.
  //
  // A ratio was tried first — "a strip that eats a third of the file is a bug"
  // — and it fired on correct output: this repo's files are deliberately
  // comment-heavy, and server/utils/assignedLeadGate.ts is 72% prose by design.
  // A guard whose premise is wrong is worse than no guard, because it fails on
  // correct input and trains the next reader to loosen it.
  //
  // An unclosed block at EOF is the real signal: it means an opener was taken
  // for a comment that never ended, which is precisely the runaway this
  // function exists to prevent. Comment density is not evidence of anything.
  if (inBlock) {
    throw new Error(
      "stripComments reached EOF inside an unclosed block comment — an opener " +
        "was mistaken for one; assertions against this output would be meaningless.",
    );
  }
  return out.join("\n");
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

  it("does not adopt where an equivalent record ALREADY owns the state", () => {
    // The sharper form of unit 22's criterion, learned by checking the note
    // payoff path and deciding NOT to wire it. "This route writes something" is
    // not the test; "the reasoning would otherwise be lost" is.
    const adopting = new Set(ADOPTING_SURFACES.map((s) => s.file));
    for (const forbidden of MUST_NOT_ADOPT) {
      expect(
        adopting.has(forbidden.file),
        `${forbidden.file} must NOT adopt — ${forbidden.why}`,
      ).toBe(false);
      // And it must not have quietly grown a scenario/decision write anyway.
      const src = read(forbidden.file);
      expect(src, `${forbidden.file} records a scenario`).not.toContain("recordScenario(");
      expect(src, `${forbidden.file} records a decision`).not.toContain("recordDecision(");
      // The claim that it already owns the state is itself checked, so this
      // exemption cannot outlive the reason for it.
      const owner = read(forbidden.ownedBy);
      expect(owner).toMatch(/engineVersion: text\("engine_version"\)[\s\S]{0,40}\.notNull\(\)/);
      expect(owner).toContain('engineInputJson: jsonb("engine_input_json")');
    }
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

  it("records the review date the OPERATOR chose, and never invents one", () => {
    // REWRITTEN (not deleted) when the analyzer began asking. This used to pin
    // `reviewDueAt: null` — correct while nothing carried a date, and it would
    // now pin the loop permanently shut. The invariant it protected is
    // unchanged and is asserted at both ends: the server never defaults, and
    // the client never pre-selects.
    expect(block).toMatch(/reviewDueAt:\s*parsed\.data\.reviewDueAt \?\? null/);

    // The schema accepts it, with NO default — a 30-day fallback would
    // manufacture a date the operator never chose and make the Today prompt
    // nag about every offer ever drafted.
    const src2 = read("server/routes-flip-analyzer.ts");
    expect(src2).toMatch(/reviewDueAt: z\.coerce\s*\n?\s*\.date\(\)\s*\n?\s*\.nullable\(\)\s*\n?\s*\.optional\(\)/);
    expect(src2).not.toMatch(/reviewDueAt[\s\S]{0,120}\.default\(/);
    // A past date is refused: it would make the decision due the instant it was
    // recorded, which is a client bug rather than anything an operator meant.
    expect(src2).toMatch(/A review date must be in the future/);
  });

  it("the analyzer ASKS, and pre-selects nothing", () => {
    // The loop only turns if someone supplies a date, and the server correctly
    // refuses to invent one — so the client has to ask. It asks at the moment
    // of drafting, when the operator actually knows how long a seller takes.
    //
    // Nothing is pre-selected: a chip selected by default would manufacture a
    // date on the server's behalf, defeating the refusal it is paired with.
    // "No set date" is a real, equally-weighted answer rather than a skip.
    const page = read("client/src/pages/flip-analyzer.tsx");
    expect(page).toMatch(/useState<number \| null \| undefined>\(\s*undefined,?\s*\)/);
    expect(page).toMatch(/label: "No set date", days: null/);
    expect(page).toContain("reviewDueAt:");
    // The question is a labelled group, not six bare buttons.
    expect(page).toMatch(/<fieldset/);
    expect(page).toMatch(/<legend/);
    expect(page).toMatch(/aria-pressed=/);
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

  it("never COERCES a number — the sharper form of asking for none", () => {
    // REWRITTEN (not deleted). This used to assert the card contained no
    // `<Input` at all. That was right about a nagging prompt and wrong as a
    // blanket rule: applied as one it left the calibration layer permanently
    // unable to measure anything, because nothing else in the product records
    // what a deal actually returned (unit 27 verified: no actual*/realized*
    // column exists anywhere in the schema).
    //
    // The invariant that assertion existed to protect is unchanged and is now
    // asserted directly: absence stays absence. A blank field submits no
    // actuals at all, and the metric stays `unmeasured`.
    const code = stripComments(card);
    expect(code).toMatch(/cents === null\s*\n?\s*\?\s*\{\}/);
    // Never coerced to zero — a realised profit of exactly zero is a real and
    // different fact from an unmeasured one, and the variance layer rests on
    // that distinction.
    expect(code).not.toMatch(/dollarsToCents\([^)]*\)\s*\?\?\s*0/);
    expect(code).not.toMatch(/value:\s*cents\s*\?\?\s*0/);
    // Nothing is required and nothing is pre-filled.
    expect(code).toMatch(/placeholder="Optional"/);
    expect(code).not.toMatch(/required/);
  });

  it("only asks where a number is a real MEASUREMENT", () => {
    const code = stripComments(card);
    // Each entry is bounded by the NEXT entry, not by a fixed window. A
    // 200-character slice from `offer_rejected` ran into `acquired`, which does
    // measure — so the assertion failed against correct code. Reading past the
    // subject is the same mistake the catchBody helper above exists to avoid.
    const entry = (kind: string): string => {
      const at = code.indexOf(`kind: "${kind}"`);
      const next = code.indexOf('kind: "', at + 1);
      return next === -1 ? code.slice(at) : code.slice(at, next);
    };
    // `still_open` must never carry one: an unresolved position has no realised
    // number by definition. Nor may an answer that resolves the position
    // without revealing a number.
    for (const kind of ["still_open", "offer_rejected", "offer_accepted", "abandoned"]) {
      expect(entry(kind), kind).not.toContain("measures:");
    }
    // The two that DO measure, so this cannot pass by measuring nothing at all.
    for (const kind of ["acquired", "sold"]) {
      expect(entry(kind), kind).toContain("measures:");
    }
    // And the metrics asked for must be ones the deciding engine PREDICTED, so
    // the variance is a genuine comparison rather than two unrelated numbers.
    expect(code).toMatch(/metricId: "total_cost"/);
    expect(code).toMatch(/metricId: "profit"/);
    const flip = read("server/services/economics/engines/flipMao.ts");
    expect(flip).toContain('"total_cost"');
    expect(flip).toContain('"profit"');
  });

  it("an answer with nothing to measure still submits in one click", () => {
    // Adding the field must cost the operator nothing when there is nothing to
    // measure — otherwise the prompt gets slower for everyone to serve a case
    // that does not apply.
    expect(stripComments(card)).toMatch(/if \(a\.measures\) \{/);
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

describe("...and finally TOLD — without paraphrasing the refusal away", () => {
  const panel = read("client/src/components/deals/ForecastCalibration.tsx");

  it("renders the SERVER's sentences verbatim", () => {
    // The single most important property here. The server already refuses to
    // claim a direction below the floor, already says "not enough measured
    // outcomes yet" as a whole sentence rather than a hedged claim, and already
    // never says a decision was good or bad. A client that paraphrased would
    // eventually paraphrase the refusal away — "trending optimistic (early
    // data)" is exactly the sentence the floor exists to prevent, and nothing
    // would catch it.
    expect(panel).toContain("summary[i]");
    expect(panel).toContain("m.factors.join(");
  });

  it("never computes a direction client-side", () => {
    // No arithmetic on the numbers at all: no thresholds, no percentages
    // derived here. Every claim is the server's.
    const code = stripComments(panel);
    expect(code).not.toMatch(/medianRelativeError\s*[<>*/+-]/);
    expect(code).not.toMatch(/directionProbability\s*[<>]/);
    expect(code).not.toMatch(/comparedCount\s*[<>]=?\s*\d/);
  });

  it("gates the direction label on the server's own `state`", () => {
    // `insufficient` must never render as a finding.
    expect(panel).toMatch(/m\.state !== "calibrated"/);
    expect(panel).toMatch(/not enough yet/);
  });

  it("styles `no clear direction` and `not enough yet` alike, and quietly", () => {
    // Neither is a result. Styling "not enough data" like a conclusion is how a
    // reader comes away with one.
    expect(panel).toMatch(/bias === "centred"\) return "outline"/);
  });

  it("states the floor and the BI178 caveat in the UI, not just in the code", () => {
    expect(panel).toMatch(/only claimed once \{floor\}/);
    expect(panel).toMatch(/a good\s*\n?\s*decision can have a bad outcome/);
  });

  it("lives behind Deals, not on Today and not as a sixth door", () => {
    expect(read("client/src/pages/deals.tsx")).toContain("<ForecastCalibration />");
    expect(read("client/src/pages/today.tsx")).not.toContain("ForecastCalibration");
    expect(read("client/src/components/layout-sidebar.tsx")).not.toContain("Calibration");
  });

  it("uses the house states and the real animation variant", () => {
    expect(panel).toContain("<Skeleton");
    expect(panel).toContain("<EmptyState");
    expect(panel).toContain("<QueryErrorState");
    // hidden/visible — `animate="show"` leaves the list stuck at opacity 0.
    expect(panel).toContain('animate="visible"');
    expect(panel).not.toContain('animate="show"');
  });
});

describe("surfaces that should adopt and structurally cannot yet", () => {
  const schema = read("shared/schema.ts");

  function tableBlock(table: string): string {
    const at = schema.indexOf(`export const ${table} = pgTable("`);
    expect(at, `${table} not found in shared/schema.ts`).toBeGreaterThan(-1);
    // To the next table declaration, so a neighbouring table's column cannot
    // satisfy an assertion about this one — the window-too-wide defect this
    // program has now shipped five times.
    const next = schema.indexOf("export const ", at + 20);
    return next === -1 ? schema.slice(at) : schema.slice(at, next);
  }

  it("names a reason and an unblocking condition for each entry", () => {
    for (const b of BLOCKED_ON_A_REAL_LINK) {
      expect(b.missing.length, `${b.file} is blocked with no stated reason`).toBeGreaterThan(30);
      expect(b.unblockedBy.length, `${b.file} can never become unblocked`).toBeGreaterThan(0);
    }
  });

  it("the link really is still missing — and this fails when it arrives", () => {
    // Deliberately inverted. When someone adds deals.decisionSnapshotId or
    // offers.dealId, this test FAILS and tells them the surface can now record
    // an outcome against the decision that produced the offer. A refusal that
    // cannot notice its own reason disappearing is just a hardcoded no.
    for (const b of BLOCKED_ON_A_REAL_LINK) {
      for (const { table, column } of b.unblockedBy) {
        expect(
          tableBlock(table).includes(`${column}:`),
          `${table}.${column} now EXISTS. ${b.file} (${b.what}) was blocked only ` +
            `because there was no non-heuristic path from the deal back to the ` +
            `decision that produced its offer. There is one now — wire the ` +
            `outcome, add the surface to ADOPTING_SURFACES, raise the baseline, ` +
            `and delete this entry.`,
        ).toBe(false);
      }
    }
  });

  it("no heuristic link is being used in the meantime", () => {
    // The failure mode this registry exists to prevent is not inaction — it is
    // someone pairing a deal to a decision through propertyId because both
    // happen to have one. Unit 23 refused exactly that.
    for (const b of BLOCKED_ON_A_REAL_LINK) {
      const src = read(b.file);
      expect(
        src.includes("recordOutcome(") || src.includes("recordDecision("),
        `${b.file} now records a canonical decision or outcome, but ` +
          `${b.missing}. If this is a real link, unblock the entry above; if it ` +
          `matches on propertyId, it is the mis-matched-pairs failure unit 23 ` +
          `refused — one property carries many offers over time.`,
      ).toBe(false);
    }
  });
});
