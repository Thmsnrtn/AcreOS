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
    writes: ["recordScenario", "recordDecision"],
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
const ADOPTING_SURFACE_BASELINE = 1;

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

describe("a real customer surface writes into the canonical loop", () => {
  it("every claimed surface really calls what it claims", () => {
    for (const surface of ADOPTING_SURFACES) {
      const src = read(surface.file);
      for (const fn of surface.writes) {
        expect(src, `${surface.file} (${surface.what}) does not call ${fn}`).toContain(
          `${fn}(`,
        );
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
    const catchBody = recording.slice(recording.indexOf("} catch (err) {"));
    expect(catchBody.slice(0, 400)).toContain("logger.warn");
    expect(catchBody.slice(0, 400)).not.toMatch(/throw|Errors\./);
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
