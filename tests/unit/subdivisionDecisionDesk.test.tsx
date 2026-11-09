// @vitest-environment jsdom
/**
 * Subdivision V1, Leg 4 — the decision desk section on the Subdivision tab
 * (§6.1–6.3, §5.5 rendering, §7).
 *   1. the latest screen run renders as the server stored it (headline, counts,
 *      both yield ends WITH their bases); no run → a taught "unscreened" state;
 *   2. a pricing lock renders with its true grading state — ungraded;
 *   3. the critical path renders its withheld reason, or the computed position
 *      and a slipped gate — nothing computed client-side;
 *   4. every form field starts EMPTY; the record button is disabled until a
 *      review-date answer is chosen (and kind, choice, a real rationale), and an
 *      entered field — only an entered field — is sent;
 *   5. no decision block asserts a recommendation or a score (§7.4).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SubdivisionDecisionDeskSection } from "../../client/src/components/parcels/subdivision-decision-desk";
import { formatDate } from "../../client/src/lib/format";
import type { CriticalPathResult } from "../../shared/subdivision/criticalPath";

/** The computed critical path's position union, taken from the real result
 *  type — the COMPUTED fixture below pins a single literal, so cases typed
 *  off the fixture itself would accept only that one position. */
type CriticalPathPosition = Extract<CriticalPathResult, { state: "computed" }>["position"];

const RUN = {
  id: 9,
  createdAt: "2026-11-05T12:00:00Z",
  triggeredCount: 2,
  notDeterminableCount: 3,
  headline: "Septic path triggered; flood exposure not determinable from the recorded facts.",
  yieldEstimate: {
    refusedReason: null,
    yield: {
      low: { value: 8, refusedReason: null, basis: "Gross 20 ac less floodway, at the 1.2 ac minimum lot" },
      high: { value: 10, refusedReason: null, basis: "Gross 20 ac at the 1.5 ac target lot" },
    },
  },
};
const WITHHELD = {
  state: "withheld" as const,
  reason: "The decision on record stated no timeline (p50 and p90), so there is nothing to measure elapsed time against. No timeline is assumed.",
};
const COMPUTED = {
  state: "computed" as const,
  elapsedDays: 40,
  p50EndDate: "2026-01-31",
  p90EndDate: "2026-03-02",
  position: "between_p50_p90" as const,
  completedGateCount: 2,
  openGateCount: 5,
  slippedGates: [{ gateKey: "pre_app", label: "Pre-application meeting", expectedReturnAt: "2026-02-05", daysOverdue: 5 }],
  projectedFinish: "2026-03-15",
  projectedFinishWithheldReason: null,
  overrunVsP90Days: 13,
};
const LOCK = {
  id: 3,
  lockedAt: "2026-11-06T12:00:00Z",
  lotCount: 12,
  totalAskingCents: 48_000_000,
  decisionSnapshotId: 55,
  grading: "ungraded_pricing_act",
  gradingNote:
    "A pricing act, not an outcome-graded decision: the lock's record cites no scenario and carries no review date, by design (package §6.2).",
};
const DECISION = {
  id: 55,
  decidedAt: "2026-01-01T15:30:00Z",
  kind: "pursue",
  choice: "Proceed to entitlement",
  rationale: "Margin clears our floor.",
  reviewDueAt: "2026-12-01T00:00:00Z",
  scenarioIds: [1],
  hasOutcome: false,
};

let deskPayload: any;
const baseDesk = () => ({
  property: { id: 42, address: "12 Ridge Rd", county: "Pima", state: "AZ", apn: "123-45" },
  latestScreenRun: RUN,
  decisions: [] as unknown[],
  pricingLocks: [] as unknown[],
  criticalPath: WITHHELD,
});

let root: Root;
let host: HTMLDivElement;
const posted: Array<{ url: string; body: any }> = [];

beforeEach(() => {
  posted.length = 0;
  deskPayload = baseDesk();
  vi.stubGlobal("fetch", async (url: string, init?: { method?: string; body?: string }) => {
    if (init?.method === "POST") {
      posted.push({ url, body: JSON.parse(init.body as string) });
      return { ok: true, json: async () => ({ scenarioId: 1, decisionId: 101 }) } as unknown as Response;
    }
    return { ok: true, json: async () => deskPayload } as unknown as Response;
  });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const tick = async () => {
  for (let i = 0; i < 5; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
};
const render = async () => {
  await act(async () => {
    root.render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <SubdivisionDecisionDeskSection parentParcelId={42} />
      </QueryClientProvider>,
    );
  });
  await tick();
};
const setValue = (id: string, value: string) => {
  const el = host.querySelector<HTMLInputElement | HTMLTextAreaElement>(`#${id}`)!;
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  act(() => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const click = (testId: string) => {
  act(() => {
    host.querySelector<HTMLElement>(`[data-testid="${testId}"]`)!.click();
  });
};
const text = (testId: string) => host.querySelector(`[data-testid="${testId}"]`)?.textContent ?? "";
const recordButton = () => host.querySelector<HTMLButtonElement>('[data-testid="subdiv-desk-record-button"]')!;
const localDate = (dateOnly: string) => formatDate(new Date(`${dateOnly}T00:00:00`));

describe("the screen review block", () => {
  it("renders the latest run as stored: headline, counts, and BOTH yield ends with their bases", async () => {
    await render();
    const review = text("subdiv-desk-review");
    expect(review).toContain("Septic path triggered; flood exposure not determinable from the recorded facts.");
    expect(review).toContain("2 triggered, 3 not determinable.");
    expect(review).toContain("Yield, low: 8 lots");
    expect(review).toContain("Gross 20 ac less floodway, at the 1.2 ac minimum lot");
    expect(review).toContain("Yield, high: 10 lots");
    expect(review).toContain("Gross 20 ac at the 1.5 ac target lot");
    expect(review).toContain("It is not copied into the form below.");
    expect(host.querySelector('[data-testid="subdiv-desk-unscreened"]')).toBeNull();
  });

  it("a yield end that did not compute says so by reason — never a number; a refused estimate says it was not estimated", async () => {
    deskPayload.latestScreenRun = {
      ...RUN,
      yieldEstimate: { refusedReason: null, yield: { low: { value: null, refusedReason: "floodway acres not entered", basis: null }, high: RUN.yieldEstimate.yield.high } },
    };
    await render();
    expect(text("subdiv-desk-review")).toContain("Yield, low: not computed — floodway acres not entered");
    expect(text("subdiv-desk-review")).toContain("Yield, high: 10 lots");
    act(() => root.unmount());
    root = createRoot(host);
    deskPayload.latestScreenRun = { ...RUN, yieldEstimate: { refusedReason: "no minimum lot citation", yield: RUN.yieldEstimate.yield } };
    await render();
    expect(text("subdiv-desk-review")).toContain("Yield not estimated — no minimum lot citation.");
    expect(text("subdiv-desk-review")).not.toContain("Yield, low");
  });

  it("no screen run: a taught 'unscreened' state that says the record will say so — not an empty pass", async () => {
    deskPayload.latestScreenRun = null;
    await render();
    expect(text("subdiv-desk-unscreened")).toContain("No screen has been run on this parcel yet");
    expect(text("subdiv-desk-unscreened")).toContain("the record will say it was made unscreened");
    expect(text("subdiv-desk-record")).toContain("or that none was run");
    expect(text("subdiv-desk-record")).not.toContain("(run 9)");
  });

  it("with a run on record the record section names the run it will freeze", async () => {
    await render();
    expect(text("subdiv-desk-record")).toContain("plus the screen record (run 9)");
  });
});

describe("pricing locks — shown as what they are: ungraded", () => {
  it("renders the lock's facts and the 'not outcome-graded' substance of its gradingNote", async () => {
    deskPayload.pricingLocks = [LOCK];
    await render();
    const locks = text("subdiv-desk-locks");
    expect(locks).toContain("12 lots · $480,000 total asking");
    expect(locks).toContain(`Locked ${formatDate(LOCK.lockedAt)}`);
    const history = text("subdiv-desk-history");
    // The substance of LOCK.gradingNote: a pricing act, not outcome-graded, no scenario, no review date.
    expect(LOCK.gradingNote).toContain("not an outcome-graded decision");
    expect(history).toContain("A pricing lock is a pricing act");
    expect(history).toContain("cites no scenario and carries no review date");
    expect(history).toContain("not outcome-graded");
    // A lock is not rendered as a decision awaiting an outcome.
    expect(locks).not.toMatch(/outcome (not yet )?recorded/);
    expect(host.querySelector('[data-testid="subdiv-desk-locks-empty"]')).toBeNull();
  });

  it("no locks: says none has been locked, and still carries the ungraded note", async () => {
    await render();
    expect(text("subdiv-desk-locks-empty")).toBe("No pricing grid has been locked on this parcel.");
    expect(text("subdiv-desk-history")).toContain("not outcome-graded");
  });
});

describe("recorded decisions", () => {
  it("lists a decision with its review state; 'no set date' and 'outcome recorded' render truthfully; empty says deferring is recording nothing", async () => {
    deskPayload.decisions = [
      DECISION,
      { ...DECISION, id: 54, kind: "pass", choice: "Pass on this parcel", reviewDueAt: null, hasOutcome: false },
      { ...DECISION, id: 53, choice: "Proceed earlier", hasOutcome: true },
    ];
    await render();
    const list = host.querySelectorAll('[data-testid="subdiv-desk-decisions"] li');
    expect(list).toHaveLength(3);
    expect(list[0].textContent).toContain("Proceed — Proceed to entitlement");
    expect(list[0].textContent).toContain("outcome not yet recorded");
    expect(list[1].textContent).toContain("Pass — Pass on this parcel");
    expect(list[1].textContent).toContain("review no set date");
    expect(list[1].textContent).not.toContain("outcome");
    expect(list[2].textContent).toContain("· outcome recorded");
    expect(list[2].textContent).not.toContain("not yet");
  });

  it("no decisions: the empty line", async () => {
    await render();
    expect(text("subdiv-desk-decisions-empty")).toContain("No subdivision decision recorded on this parcel yet. Recording nothing is how you defer.");
  });
});

describe("the entitlement path (§5.5) — rendered as the server computed it", () => {
  it("withheld: the withheld state carries the server's reason verbatim, and no position or finish", async () => {
    await render();
    const path = text("subdiv-desk-path");
    expect(text("subdiv-desk-path-withheld")).toContain("Entitlement path withheld");
    expect(path).toContain(WITHHELD.reason);
    expect(path).not.toMatch(/Day \d+/);
    expect(path).not.toContain("Projected finish");
  });

  it("computed: elapsed day, position words, both end dates, gate counts, the slipped gate, projected finish and overrun", async () => {
    deskPayload.decisions = [DECISION];
    deskPayload.criticalPath = COMPUTED;
    await render();
    const path = text("subdiv-desk-path");
    expect(path).toContain(
      `Day 40 — past p50, within p90 (p50 ends ${localDate("2026-01-31")}, p90 ends ${localDate("2026-03-02")}). 2 gates complete, 5 open.`,
    );
    expect(path).toContain(`Slipped: Pre-application meeting — expected ${localDate("2026-02-05")}, 5 days overdue`);
    expect(path).toContain(`Projected finish ${localDate("2026-03-15")}`);
    expect(path).toContain("13 days past the p90 date");
    expect(path).toContain("No county timeline is used.");
    expect(host.querySelector('[data-testid="subdiv-desk-path-withheld"]')).toBeNull();
  });

  it("computed: each position has its own words; a negative overrun reads 'within'; a withheld projection carries its reason", async () => {
    deskPayload.decisions = [DECISION];
    const cases: Array<[CriticalPathPosition, string]> = [
      ["within_p50", "within the p50 window"],
      ["between_p50_p90", "past p50, within p90"],
      ["past_p90", "past the p90 date"],
    ];
    for (const [position, words] of cases) {
      deskPayload.criticalPath = { ...COMPUTED, position, slippedGates: [] };
      act(() => root.unmount());
      root = createRoot(host);
      await render();
      expect(text("subdiv-desk-path"), position).toContain(`Day 40 — ${words} (`);
      expect(text("subdiv-desk-path"), position).not.toContain("Slipped:");
    }
    deskPayload.criticalPath = { ...COMPUTED, overrunVsP90Days: -10 };
    act(() => root.unmount());
    root = createRoot(host);
    await render();
    expect(text("subdiv-desk-path")).toContain("10 days within the p90 date");
    expect(text("subdiv-desk-path")).not.toContain("days past the p90 date");
    deskPayload.criticalPath = {
      ...COMPUTED,
      projectedFinish: null,
      overrunVsP90Days: null,
      projectedFinishWithheldReason: "No open gate carries an expected return date, so no finish is projected.",
    };
    act(() => root.unmount());
    root = createRoot(host);
    await render();
    expect(text("subdiv-desk-path")).toContain("No projected finish — No open gate carries an expected return date, so no finish is projected.");
    expect(text("subdiv-desk-path")).not.toContain("Projected finish ");
  });

  it("computed with no open gates and no reason: renders no projected-finish line at all (completion is in the counts)", async () => {
    deskPayload.decisions = [DECISION];
    deskPayload.criticalPath = {
      ...COMPUTED,
      openGateCount: 0,
      completedGateCount: 4,
      slippedGates: [],
      projectedFinish: null,
      projectedFinishWithheldReason: null,
      overrunVsP90Days: null,
    };
    await render();
    const path = text("subdiv-desk-path");
    expect(path).toContain("4 gates complete, 0 open.");
    expect(path).not.toContain("projected finish");
    expect(path).not.toContain("Projected finish");
  });
});

describe("recording the decision — nothing pre-selected, nothing pre-filled", () => {
  it("every text field starts EMPTY and labelled; no kind and no review chip is pre-selected; record is disabled", async () => {
    await render();
    const inputs = [...host.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input:not([type="radio"]), textarea')];
    expect(inputs.length).toBeGreaterThanOrEqual(25);
    for (const el of inputs) {
      expect(el.value, el.id).toBe("");
      expect(host.querySelector(`label[for="${el.id}"]`), el.id).not.toBeNull();
    }
    for (const r of host.querySelectorAll<HTMLInputElement>('input[type="radio"]')) expect(r.checked).toBe(false);
    for (const chip of host.querySelectorAll('[data-testid^="subdiv-desk-review-in-"]')) expect(chip.getAttribute("aria-pressed")).toBe("false");
    // The yield range is shown beside the form but NOT copied into it (§7.2).
    expect(host.querySelector<HTMLInputElement>("#sd-lotCount")!.value).toBe("");
    expect(recordButton().disabled).toBe(true);
  });

  it("disabled until a review-date chip is chosen; enabled after (kind, choice and rationale already filled)", async () => {
    await render();
    click("subdiv-desk-kind-pursue");
    setValue("sd-choice", "Proceed to entitlement");
    setValue("sd-rationale", "Margin clears our floor on the stated inputs.");
    expect(recordButton().disabled).toBe(true); // everything but the review date
    click("subdiv-desk-review-in-30");
    expect(host.querySelector('[data-testid="subdiv-desk-review-in-30"]')!.getAttribute("aria-pressed")).toBe("true");
    expect(recordButton().disabled).toBe(false);
  });

  it("'No set date' is an answer and enables the button too", async () => {
    await render();
    click("subdiv-desk-kind-pass");
    setValue("sd-choice", "Pass");
    setValue("sd-rationale", "Perc results failed on two of three sites.");
    expect(recordButton().disabled).toBe(true);
    click("subdiv-desk-review-in-none");
    expect(recordButton().disabled).toBe(false);
  });

  it("each of kind, choice, and a 10-character rationale is still required even with a review date chosen", async () => {
    await render();
    click("subdiv-desk-review-in-14");
    expect(recordButton().disabled).toBe(true); // nothing else filled
    setValue("sd-choice", "Pass");
    setValue("sd-rationale", "Perc results failed on two of three sites.");
    expect(recordButton().disabled).toBe(true); // no kind
    click("subdiv-desk-kind-pass");
    expect(recordButton().disabled).toBe(false);
    setValue("sd-rationale", "too short"); // 9 characters
    expect(recordButton().disabled).toBe(true);
    setValue("sd-rationale", "long enough"); // 11
    expect(recordButton().disabled).toBe(false);
    setValue("sd-choice", "   ");
    expect(recordButton().disabled).toBe(true);
  });

  it("recording POSTs only what was entered (dollars → cents), the kind, the words, and the chosen review date; then says what was recorded", async () => {
    await render();
    setValue("sd-landCostCents", "100000");
    setValue("sd-lotCount", "10");
    setValue("sd-timelineP50Days", "60");
    click("subdiv-desk-kind-pursue");
    setValue("sd-choice", "Proceed to entitlement");
    setValue("sd-rationale", "Margin clears our floor on the stated inputs.");
    click("subdiv-desk-review-in-30");
    await act(async () => {
      recordButton().click();
    });
    await tick();
    expect(posted).toHaveLength(1);
    expect(posted[0].url).toBe("/api/subdivision/decide");
    const body = posted[0].body;
    expect(body.propertyId).toBe(42);
    expect(body.kind).toBe("pursue");
    expect(body.choice).toBe("Proceed to entitlement");
    expect(body.rationale).toBe("Margin clears our floor on the stated inputs.");
    // Exactly the three fields entered: no default, no prefill, no empty-as-zero.
    expect(body.inputs).toEqual({ landCostCents: 10_000_000, lotCount: 10, timelineP50Days: 60 });
    expect(Math.abs(Date.parse(body.reviewDueAt) - (Date.now() + 30 * 86_400_000))).toBeLessThan(60_000);
    expect(text("subdiv-desk-recorded")).toBe("Recorded — decision 101, scenario 1.");
  });

  it("'No set date' is sent as an explicit null reviewDueAt (an answer), not omitted", async () => {
    await render();
    click("subdiv-desk-kind-pass");
    setValue("sd-choice", "Pass");
    setValue("sd-rationale", "Perc results failed on two of three sites.");
    click("subdiv-desk-review-in-none");
    await act(async () => {
      recordButton().click();
    });
    await tick();
    expect(posted).toHaveLength(1);
    expect(Object.prototype.hasOwnProperty.call(posted[0].body, "reviewDueAt")).toBe(true);
    expect(posted[0].body.reviewDueAt).toBeNull();
    expect(posted[0].body.inputs).toEqual({});
  });
});

describe("§7.4 — no recommendation, no score in the decision blocks", () => {
  it("none of the desk's blocks says 'recommend' or 'score' (case-insensitive), with every state populated", async () => {
    deskPayload.decisions = [DECISION, { ...DECISION, id: 54, kind: "pass", choice: "Pass on this parcel", reviewDueAt: null }];
    deskPayload.pricingLocks = [LOCK];
    deskPayload.criticalPath = COMPUTED;
    await render();
    for (const id of ["subdiv-desk-review", "subdiv-desk-scenario", "subdiv-desk-record", "subdiv-desk-history", "subdiv-desk-path"]) {
      const t = text(id);
      expect(t.length, id).toBeGreaterThan(20); // vacuity: the block rendered
      expect(t, id).not.toMatch(/recommend/i);
      expect(t, id).not.toMatch(/score/i);
    }
    // The ONLY place the words appear is the card's own disclaimer, as a denial.
    const whole = host.textContent!;
    expect(whole.match(/recommend/gi)).toHaveLength(1);
    expect(whole.match(/score/gi)).toHaveLength(1);
    expect(whole).toContain("not advice, not a recommendation, no score");
  });

  it("the withheld and unscreened states do not assert them either", async () => {
    deskPayload.latestScreenRun = null;
    await render();
    for (const id of ["subdiv-desk-review", "subdiv-desk-path"]) {
      expect(text(id).length, id).toBeGreaterThan(20);
      expect(text(id), id).not.toMatch(/recommend|score/i);
    }
  });
});
