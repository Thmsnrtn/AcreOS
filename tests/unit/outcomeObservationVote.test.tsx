// @vitest-environment jsdom
/**
 * A dispatch receipt is not evidence the action worked.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 * `outcomeOf` turns an autopilot experience into a success/failure/pending vote.
 * Those votes become `PlayStats`, and `efficacy.ts` samples a Beta-Bernoulli
 * posterior over them to PICK THE NEXT PLAY. Rule 4 — whose own docstring calls
 * it "did it even run" — returned a full-weight `"success"` for
 * `dispatchSuccess === true`, identical in weight to a founder's explicit
 * approval, and `statsFromExperiences` counts every non-pending vote once.
 *
 * So a play that mailed two hundred people who all ignored it accrued two
 * hundred successes and a posterior mean near 1.0, while a play with one real
 * founder approval sat at 0.67. The sampler learned to prefer whatever
 * dispatches cleanly. The vote also reaches `domainAutonomy`, so the same
 * receipt fed autonomy promotion.
 *
 * ── THE SECOND DEFECT, WHICH IS THE MORE INSTRUCTIVE ONE ────────────────────
 * `outcomeBasis()` already drew exactly the right distinction. Its docstring:
 * "Lets callers refine the causal model from real CONSEQUENCE only, never the
 * execution proxy." It had ZERO production callers — only a test consulted it.
 * The repository had written the rule down in a function nothing called, while
 * the function everything called broke it. Third instance of CLAUDE.md's second
 * law (`publicMaturityOf`, `isFounderUserId`, now this).
 *
 * ── WHERE IT CAME FROM ──────────────────────────────────────────────────────
 * Foundry §16 (an effect receipt is not an outcome) and §18 (learning does not
 * create authority). Same invariant as ledger entry 12, one layer down: there a
 * verifier re-read the actor's log, here the actor's own dispatch result votes
 * on its own efficacy.
 */

import { afterEach, describe, expect, it } from "vitest";
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import fs from "node:fs";
import path from "node:path";
import {
  outcomeOf,
  outcomeBasis,
  statsFromExperiences,
  EVAL_PASS_THRESHOLD,
} from "../../server/services/autopilot/experienceLog";
import { scorePlays, makeSeededRng } from "../../server/services/autopilot/efficacy";
import { StoryRow, type StoryEntry } from "../../client/src/pages/founder/autopilot-story";

describe("the mechanical result votes in one direction only", () => {
  it("a SUCCESSFUL dispatch does not vote", () => {
    expect(outcomeOf({ dispatchSuccess: true })).toBe("pending");
    expect(outcomeOf({ dispatchSuccess: true, evalScore: 0.99 })).toBe("pending");
  });

  it("a FAILED dispatch still votes failure — the asymmetry is deliberate", () => {
    // Not symmetry for its own sake. A send that never left conclusively did
    // not help; a send that left proves only that it left. Erasing this half
    // would have thrown away a real signal in the name of tidiness.
    expect(outcomeOf({ dispatchSuccess: false })).toBe("failure");
  });

  it("every remaining success vote rests on a signal the actor does not author", () => {
    // The three ways a vote can now be "success", each an outcome observed
    // outside the acting system.
    expect(outcomeOf({ founderVerdict: "approved" })).toBe("success");       // a human said so
    expect(outcomeOf({ resolution: "resolved" })).toBe("success");           // the customer's issue closed
    expect(outcomeOf({ paymentRecovered: true })).toBe("success");           // money actually moved
  });

  it("the strong signals still beat the mechanical one in both directions", () => {
    // Vacuity guard: if rule 4's removal had broken the priority order, the
    // assertions above would still pass while the ladder above it collapsed.
    expect(outcomeOf({ founderVerdict: "approved", dispatchSuccess: false })).toBe("success");
    expect(outcomeOf({ founderVerdict: "declined", dispatchSuccess: true })).toBe("failure");
    expect(outcomeOf({ dispatchSuccess: true, deliveryBounced: true })).toBe("failure");
    expect(outcomeOf({ dispatchSuccess: true, evalScore: EVAL_PASS_THRESHOLD - 0.01 })).toBe("failure");
  });
});

describe("the receipt no longer moves play selection", () => {
  it("A PLAY THAT ONLY DISPATCHES ACCRUES NO TRACK RECORD", () => {
    // The concrete harm, at the surface that consumes it. Two hundred clean
    // sends nobody responded to used to read as two hundred wins.
    const sent = Array.from({ length: 200 }, () => ({ playId: "cold-blast", dispatchSuccess: true }));
    const approved = [{ playId: "county-guide", founderVerdict: "approved" }];
    const stats = statsFromExperiences([...sent, ...approved]);

    const byId = Object.fromEntries(stats.map((s) => [s.playId, s]));
    expect(byId["cold-blast"], "a play with no confirmed outcome carried a track record").toBeUndefined();
    expect(byId["county-guide"]).toEqual({ playId: "county-guide", successes: 1, failures: 0 });
  });

  it("the sampler no longer prefers the play with only receipts", () => {
    // Read at the posterior rather than at the vote, because this is where the
    // defect actually cost something: Beta(1+200, 1+0) has a mean of ~0.995 and
    // wins essentially every Thompson draw against Beta(2,1)'s 0.67.
    const stats = statsFromExperiences([
      ...Array.from({ length: 200 }, () => ({ playId: "cold-blast", dispatchSuccess: true })),
      { playId: "county-guide", founderVerdict: "approved" },
    ]);
    const scored = scorePlays(stats, makeSeededRng(1));
    const blast = scored.find((p) => p.playId === "cold-blast");
    expect(blast, "the receipts-only play still carries a posterior").toBeUndefined();
  });
});

describe("outcomeBasis is consulted by the product, not only by a test", () => {
  it("the story the founder reads carries the basis of every vote", () => {
    // The adoption half of CLAUDE.md's second law. A rule stated in a function
    // nothing calls is not enforced anywhere; this is the production caller.
    const src = fs.readFileSync(
      path.resolve(__dirname, "../../server/services/autopilot/experienceLog.ts"),
      "utf8",
    );
    expect(src).toMatch(/basis:\s*outcomeBasis\(signalsOf\(r\)\)/);
  });

  it("the basis mirrors the vote — a pending experience has decided nothing", () => {
    // If these two drift, the founder is shown a reason for a verdict that was
    // never reached. Swept across the whole domain rather than spot-checked.
    const cases = [
      { s: { founderVerdict: "approved" }, basis: "human" },
      { s: { resolution: "resolved" }, basis: "support" },
      { s: { paymentRecovered: true }, basis: "consequence" },
      { s: { evalScore: 0.2 }, basis: "eval" },
      { s: { dispatchSuccess: false }, basis: "mechanical" },
      { s: { dispatchSuccess: true }, basis: "none" },
      { s: {}, basis: "none" },
    ] as const;

    for (const c of cases) {
      expect(outcomeBasis(c.s), JSON.stringify(c.s)).toBe(c.basis);
      // The invariant that keeps them honest: a basis of "none" iff no vote.
      const voted = outcomeOf(c.s) !== "pending";
      expect(outcomeBasis(c.s) !== "none", JSON.stringify(c.s)).toBe(voted);
    }
  });
});

describe("the founder surface shows the state this change made common", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(() => {
    if (root) act(() => root!.unmount());
    container?.remove();
    root = null;
    container = null;
  });

  const render = (entry: StoryEntry): string => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root!.render(<StoryRow entry={entry} />));
    return container.textContent ?? "";
  };

  const entry = (over: Partial<StoryEntry>): StoryEntry => ({
    id: 1,
    at: null,
    moveKind: "send_email",
    domain: "growth",
    playId: "county-guide",
    outcome: "acted",
    vote: "pending",
    basis: "none",
    reasoningTrace: null,
    ...over,
  });

  it('A PENDING ENTRY SAYS "too soon to tell" RATHER THAN RENDERING NOTHING', () => {
    // §8: when a canonical transition makes a rare UI state common, exercise it
    // in the real surface. `voteBadge` returned `null` for pending, which was
    // survivable while pending was rare — it is now the majority state, and a
    // silently absent badge reads as a rendering fault rather than "we don't
    // know yet". Asserted against the rendered DOM, not the component source.
    expect(render(entry({}))).toContain("too soon to tell");
  });

  it("does not claim the action went well", () => {
    const text = render(entry({}));
    expect(text).not.toContain("went well");
    expect(text).not.toContain("didn't land");
  });

  it("still renders the two decided verdicts", () => {
    // Vacuity guard: a badge function that returned the pending badge for
    // everything would pass the assertion above.
    expect(render(entry({ vote: "success", basis: "human" }))).toContain("went well");
    expect(render(entry({ vote: "failure", basis: "consequence" }))).toContain("didn't land");
  });

  it("attributes the verdict, so it is never an unsourced claim", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root!.render(<StoryRow entry={entry({ vote: "success", basis: "human" })} />));
    const badge = Array.from(container.querySelectorAll("[title]"))
      .find((el) => (el.textContent ?? "").includes("went well"));
    expect(badge?.getAttribute("title")).toBe("You said so");
  });
});
