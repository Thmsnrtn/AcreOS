/**
 * Stage 2 — the guards around the role workers and the founder's controls:
 *   - contentHonesty: invented stats / testimonials fail closed, sourced facts pass,
 *     and the EXISTING publish gate (screenForPublish) now carries the screen;
 *   - S9: a hard-stop move is held AND surfaced (one ask), never gated, never
 *     enqueued — not by the loop and not by an approval;
 *   - role-worker moves are witnessed per effect, not at the move layer — and
 *     a net-new or unknown move still is;
 *   - chat business tools: hard-stops are un-delegable;
 *   - ops watch decisions: one incident per outage, recovery closes it;
 *   - S10: the one-confirm restore narration states exactly what comes back.
 */
import { describe, it, expect, vi } from "vitest";
import { screenFabrication } from "../../server/services/autopilot/contentHonesty";
import { screenForPublish } from "../../server/services/autopilot/publishArtifact";
import { hardStopForMove } from "../../server/services/autopilot/hardStopMoves";
import { planAndAct, enqueueApprovedMove, moveToPolicyAction, bindingFor, type ActDeps } from "../../server/services/autopilot/act";
import { rankMoves } from "../../server/services/autopilot/decide";
import { GROWTH_PLAYS, growthPlayRationale } from "../../server/services/autopilot/growthPlaybook";
import { supportPlayRationale } from "../../server/services/autopilot/supportPlaybook";
import { isUndelegableAsk, executeBusinessChatTool } from "../../server/services/solene/chat/businessTools";
import {
  decideTransitions,
  modelReadingFromBuckets,
  emailReadingFrom,
  stripeReadingFrom,
  MODEL_FAILURE_TICKS,
  STRIPE_DOWN_PAGE_HOURS,
} from "../../server/services/autopilot/opsWatch";
import { narrateRestore } from "../../server/services/autopilot/guidedResume";
import { isAdMove, moveBlockedByControls } from "../../server/services/autopilot/founderControls";

describe("contentHonesty — no fabrication in generated content", () => {
  it.each([
    ["87% of land buyers overpay at closing.", "unsourced_statistic"],
    ["Nine in ten investors skip the title search.", "unsourced_statistic"],
    ["Our customers save $4,000 on average.", "social_proof"],
    ["Trusted by thousands of land investors.", "social_proof"],
    ['"This changed my business" — Mike R., Texas', "testimonial"],
    ["One customer told us it paid for itself in a week.", "testimonial"],
    ["★★★★★ rated by investors", "social_proof"],
  ])("%j is refused (%s)", (t, code) => {
    expect(screenFabrication(t).map((v) => v.code)).toContain(code);
  });

  it.each([
    "According to the 2022 Census of Agriculture, farmland is 39% of US land area.",
    "The county assessor's records list the parcel at 40 acres as of 2024.",
    "Check whether taxes are current with the county treasurer.",
  ])("%j passes", (t) => {
    expect(screenFabrication(t)).toEqual([]);
  });

  it("the EXISTING publish gate refuses a fabricated draft (one gate, not a second one)", () => {
    const r = screenForPublish({
      subject: "Land basics",
      htmlBody: "<p>87% of buyers regret skipping this.</p><p>For informational purposes only — not legal, financial, or investment advice. Verify independently.</p>",
    });
    expect(r.ok).toBe(false);
    expect(r.violations.map((v) => v.code)).toContain("unsourced_statistic");
  });
});

describe("S9 — hard-stop moves are held AND surfaced", () => {
  it.each([
    [{ kind: "raise_prices_40pct", rationale: "Raise every plan price 40% today.", isNetNew: true }, "pricing_changes"],
    [{ kind: "purge_inactive_customer_data", rationale: "Delete all customer data for inactive orgs.", isNetNew: true }, "customer_data_deletion"],
    [{ kind: "buy_meta_ads_2000", rationale: "Spend $2,000 on Meta ads now.", isNetNew: true }, "spend_over_500_usd"],
    [{ kind: "sign_vendor_contract", rationale: "Sign the data vendor agreement.", isNetNew: true }, "legal_signing"],
    // phrasing the hands lane's patterns do not catch — the move lane must
    [{ kind: "tidy_dormant_tenants", rationale: "Wipe the accounts of orgs inactive for 90 days.", isNetNew: true }, "customer_data_deletion"],
  ])("%j → %s", (m, cls) => {
    expect(hardStopForMove(m)).toBe(cls);
  });

  it("POPULATION: no catalog move, with the rationales the loop really writes, is classified a hard-stop", () => {
    const all = rankMoves({
      openIncidents: 1, complianceOpenCount: 1, envelopeStatus: "red", supportBacklog: 2, escalatedTicketIds: [1, 2],
      trials: 3, activationStalled: true, activationStalledCount: 2, mrr: 0, dispatchBacklog: 0,
      emailComplaints: 1, dunningPressure: 1, churnSignals: 1, trialsEnding: 1, reflexFailures: 2,
    });
    // every catalog kind but grow (unstable world) — grow is covered by its real play rationales below
    expect(all.length).toBeGreaterThanOrEqual(11);
    for (const m of all) expect(hardStopForMove(m)).toBeNull();
    expect(hardStopForMove({ kind: "clear_support_backlog", rationale: supportPlayRationale(3) })).toBeNull();
    for (const p of GROWTH_PLAYS) expect(hardStopForMove({ kind: "grow_owned_channels", rationale: growthPlayRationale(p, { countyLabel: "Travis", state: "TX" }) })).toBeNull();
  });

  function actDeps(): ActDeps & { asks: string[]; enqueued: number; gated: number } {
    const d = {
      asks: [] as string[],
      enqueued: 0,
      gated: 0,
      runGate: async () => {
        d.gated++;
        return { decision: "pass" as const, results: [] };
      },
      classify: () => ({ escalate: false, action: "none" as const, urgency: "low" as const, reason: "" }),
      enqueue: async () => {
        d.enqueued++;
        return 1;
      },
      ask: async (i: { questionSummary: string }) => {
        d.asks.push(i.questionSummary);
        return { askId: 7 };
      },
    };
    return d as unknown as ActDeps & { asks: string[]; enqueued: number; gated: number };
  }

  it("planAndAct never gates or enqueues a hard-stop move — it asks, naming what it is", async () => {
    const d = actDeps();
    const out = await planAndAct({ priority: 1, domain: "ops", kind: "purge_inactive_customer_data", rationale: "Delete all customer data for inactive orgs.", isNetNew: true }, { envelopeStatus: "green" }, d);
    expect(out.status).toBe("escalated");
    expect(d.gated).toBe(0);
    expect(d.enqueued).toBe(0);
    expect(d.asks[0]).toMatch(/founder-only: deleting customer data/);
  });

  it("approving that ask does NOT enqueue it", async () => {
    let enq = 0;
    const out = await enqueueApprovedMove(7, {
      findEscalatedMove: async () => ({ experienceId: 1, moveKind: "raise_prices_40pct", domain: "finance", dispatchId: null, reasoningTrace: { consideredMoves: [{ kind: "raise_prices_40pct", rationale: "Raise every plan price 40%." }] } }),
      enqueue: async () => ++enq,
      linkDispatch: async () => {},
    });
    expect(out.status).toBe("hard_stop_refused");
    expect(enq).toBe(0);
  });
});

describe("role-worker moves are witnessed per effect, not at the move layer", () => {
  it("clear_support_backlog is still customer-facing by nature, but its policy action is not witnessed twice", () => {
    expect(bindingFor("clear_support_backlog").isCustomerFacing).toBe(true);
    expect(bindingFor("clear_support_backlog").effectsGatedPerAction).toBe(true);
    expect(moveToPolicyAction({ priority: 2, domain: "support", kind: "clear_support_backlog", rationale: "x" }).isCustomerFacing).toBe(false);
  });
  it("a net-new move and an unknown move are still witnessed at the move layer", () => {
    expect(moveToPolicyAction({ priority: 2, domain: "support", kind: "clear_support_backlog", rationale: "x", isNetNew: true }).isCustomerFacing).toBe(true);
    expect(moveToPolicyAction({ priority: 2, domain: "ops", kind: "email_all_customers_now", rationale: "x" }).isCustomerFacing).toBe(true);
    expect(bindingFor("resolve_incident").effectsGatedPerAction).toBeUndefined();
  });
});

vi.mock("../../server/services/solene/founderCollab", () => ({
  getAsk: async (id: number) =>
    ({
      1: { id: 1, status: "open", answerFormat: "yes_no", questionSummary: "Held — founder-only: a pricing change (raise_prices_40pct)", questionBody: "x" },
      2: { id: 2, status: "open", answerFormat: "yes_no", questionSummary: "Support ticket #9 needs you: TCPA demand letter", questionBody: "legal" },
    })[id] ?? null,
  answerFounderAsk: async () => {
    throw new Error("must not be called for an undelegable ask");
  },
  listOpenAsks: async () => [],
}));

describe("chat business tools — hard-stops are un-delegable", () => {
  it("refuses to answer a hard-stop or legal ask", async () => {
    expect((await executeBusinessChatTool("answer_ask", { ask_id: 1, decision: "approve" }, "f")).ok).toBe(false);
    expect((await executeBusinessChatTool("answer_ask", { ask_id: 2, decision: "approve" }, "f")).ok).toBe(false);
  });
  it("refuses a budget over $500", async () => {
    const r = await executeBusinessChatTool("set_budget", { monthly_usd: 2000 }, "f");
    expect(r.ok).toBe(false);
    expect(r.text).toMatch(/hard-stop/);
  });
  it("classifies asks", () => {
    expect(isUndelegableAsk({ questionSummary: "Review a drafted growth action: grow_owned_channels", questionBody: "Approve to let it proceed." })).toBe(false);
    expect(isUndelegableAsk({ questionSummary: "Approve a growth action: buy_meta_ads", questionBody: "Spend $2,000 on Meta ads." })).toBe(true);
  });
});

describe("founder controls — pause and the ad switch are mechanical", () => {
  it("a paused domain or ads-off blocks the move", () => {
    expect(moveBlockedByControls({ domain: "growth", kind: "grow_owned_channels" }, { pausedDomains: ["growth"], adsEnabled: true })).toMatch(/paused growth/);
    expect(moveBlockedByControls({ domain: "growth", kind: "buy_meta_ads_2000", rationale: "Spend on Meta ads" }, { pausedDomains: [], adsEnabled: false })).toMatch(/ad spending off/);
    expect(moveBlockedByControls({ domain: "growth", kind: "grow_owned_channels", rationale: "write an explainer" }, { pausedDomains: [], adsEnabled: false })).toBeNull();
    expect(isAdMove({ kind: "run_ad_campaign" })).toBe(true);
  });
});

describe("S8 ops watch — one incident per outage", () => {
  it("opens only when failing and none is open; resolves only when healthy and one is open", () => {
    const failing = [{ provider: "stripe" as const, failing: true, detail: "down" }];
    expect(decideTransitions(failing, []).open).toHaveLength(1);
    expect(decideTransitions(failing, [{ id: "a", provider: "stripe" }]).open).toHaveLength(0); // never a second page
    expect(decideTransitions([{ provider: "stripe", failing: false, detail: "ok" }], [{ id: "a", provider: "stripe" }]).resolve).toHaveLength(1);
    expect(decideTransitions([{ provider: "stripe", failing: null, detail: "?" }], [{ id: "a", provider: "stripe" }]).resolve).toHaveLength(0);
  });
  it("model: N all-failed ticks in a row; any success is recovery", () => {
    const bad = Array.from({ length: MODEL_FAILURE_TICKS }, () => ({ calls: 2, failures: 2 }));
    expect(modelReadingFromBuckets(bad, 0).failing).toBe(true);
    expect(modelReadingFromBuckets([{ calls: 0, failures: 0 }, ...bad.slice(1)], 0).failing).toBeNull();
    expect(modelReadingFromBuckets(bad, 1).failing).toBe(false);
  });
  it("email and Stripe readings", () => {
    const t = (h: number) => new Date(Date.UTC(2026, 9, 7, h));
    expect(emailReadingFrom(3, t(5), t(1)).failing).toBe(true);
    expect(emailReadingFrom(3, t(5), t(6)).failing).toBe(false);
    expect(stripeReadingFrom({ ok: false, at: t(23) }, null, new Date(t(23).getTime() - (STRIPE_DOWN_PAGE_HOURS - 1) * 3_600_000), t(23)).failing).toBeNull();
    expect(stripeReadingFrom({ ok: false, at: t(23) }, new Date(t(23).getTime() - STRIPE_DOWN_PAGE_HOURS * 3_600_000), null, t(23)).failing).toBe(true);
    expect(stripeReadingFrom({ ok: true, at: t(23) }, t(23), null, t(23)).failing).toBe(false);
  });
});

describe("S10 — one-confirm restore", () => {
  it("states exactly what comes back", () => {
    const n = narrateRestore({ at: "2026-10-07T10:00:00Z", switches: { dispatchEnabled: true, publishEnabled: true, cognitionEnabled: false }, levels: { growth: "execute_gated", support: "observe" } });
    expect(n).toMatch(/dispatch, publish/);
    expect(n).toMatch(/growth: execute_gated/);
    expect(narrateRestore(null)).toMatch(/three stages/);
  });
});
