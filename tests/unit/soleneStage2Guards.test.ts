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
import {
  hardStopForMove,
  founderOnlyClassForMove,
  moneyAmountsUsd,
  FOUNDER_ONLY_CLASSES,
  type FounderOnlyClass,
} from "../../server/services/autopilot/hardStopMoves";
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
} from "../../server/services/autopilot/opsWatch";
import { narrateRestore } from "../../server/services/autopilot/guidedResume";
import { moveBlockedByControls, firstWorkableMove } from "../../server/services/autopilot/founderControls";

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

  // Round 2 (M1): naming a source is not citing it. A quantity passes only
  // with a LINK to a verified host in the same sentence; prose with no
  // quantity passes.
  it.each([
    '<p>Farmland is 39% of US land area (<a href="https://www.nass.usda.gov/AgCensus/">Census of Agriculture</a>).</p>',
    "Check whether taxes are current with the county treasurer.",
    "Ask the seller for the recorded deed before you make an offer.",
  ])("%j passes", (t) => {
    expect(screenFabrication(t)).toEqual([]);
  });

  it.each([
    "According to the 2022 Census of Agriculture, farmland is 39% of US land area.",
    // (Round 3 rescope: a bare parcel fact — "the parcel at 40 acres" — and a
    // bare "the seller said …" with no quotation are not claims; they live in
    // contentHonestyScope.test.ts's proportionality set.)
    "According to the IRS, 87% of rural parcels are mispriced.",
    "Nine of every ten buyers skip the survey.",
    "We have listed over 4k parcels.",
    "Flippers net five figures per flip.",
    "Investors close deals in a fortnight on average.",
    "Most land flippers lose money on their first deal.",
    "Time to offer dropped from 9 days to 2.",
    "One customer told me it changed everything.",
    // reported speech with no number and no testimonial shape
    "My neighbor told me the county never checks.",
  ])("round-2 canary %j is refused (a quantity with no verified link, or reported speech)", (t) => {
    expect(screenFabrication(t).length).toBeGreaterThan(0);
  });

  // M1 — the auditor's exact evasions. Each one passed the first screen.
  it.each([
    ["Eighty-seven percent of land buyers overpay at closing.", "unsourced_statistic"],
    ["One in twenty parcels has a title defect.", "unsourced_statistic"],
    ["9/10 investors skip the survey.", "unsourced_statistic"],
    ["Nearly half of rural parcels have no road access.", "unsourced_statistic"],
    ["Buyers got $3,500 off the asking price.", "unsourced_statistic"],
    ["Our members saved 4,000 dollars on closing costs.", "unsourced_statistic"],
    ["Investors who used it doubled their close rate.", "unsourced_statistic"],
    ['"It paid for itself in a week," says Mike R.', "testimonial"],
    ['As one landowner told us, "I never knew the taxes were delinquent."', "testimonial"],
    ["<blockquote>I closed three deals in a month.</blockquote>", "testimonial"],
    ["<p>Great tool.</p><cite>Jane D., Ohio</cite>", "testimonial"],
    ["According to our internal data, 60% of offers are accepted.", "unsourced_statistic"],
    ["According to the Land Investor Quarterly, 72% of deals close in 30 days.", "unsourced_statistic"],
    ["A recent study found sellers accept 3x more cash offers.", "unsourced_statistic"],
  ])("refuses %j (%s)", (t, code) => {
    expect(screenFabrication(t).map((v) => v.code)).toContain(code);
  });

  it("a claim passes only with a LINK to a verified host; a name, a look-alike host or an unlisted host does not", () => {
    expect(screenFabrication("Per the U.S. Census Bureau, 19% of Americans live in rural areas.").length).toBeGreaterThan(0);
    expect(screenFabrication('<p>19% of Americans live in rural areas (<a href="https://www.census.gov/x">Census</a>).</p>')).toEqual([]);
    expect(screenFabrication('<p>Rural land is 39% of the total (<a href="https://usda.gov.evil.example/x">source</a>).</p>').length).toBeGreaterThan(0);
    const founderSource = { name: "Land Report 2026", pattern: /\bland report 2026\b/i, hosts: ["landreport.com"] };
    const linked = '<p>72% of deals close in 30 days (<a href="https://landreport.com/2026">Land Report</a>).</p>';
    expect(screenFabrication(linked).length).toBeGreaterThan(0);
    expect(screenFabrication(linked, { verifiedSources: [founderSource] })).toEqual([]);
  });

  it("facts of the case and record references are not claims", () => {
    expect(screenFabrication("Your $30 refund for ticket #45 is being processed.", { allowDollarFigures: ["$30"] })).toEqual([]);
    expect(screenFabrication("Your $30 refund is being processed and it saved $90.", { allowDollarFigures: ["$30"] }).length).toBeGreaterThan(0);
  });

  it("the publish gate refuses a <blockquote> testimonial even if sanitizing would drop the tag", () => {
    const r = screenForPublish({
      subject: "Field notes",
      htmlBody: "<blockquote>Best tool I ever used for land.</blockquote><p>For informational purposes only — not legal, financial, or investment advice. Verify independently.</p>",
    });
    expect(r.ok).toBe(false);
    expect(r.violations.map((v) => v.code)).toContain("testimonial");
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

const answerSpy = vi.hoisted(() => vi.fn(async (_a: { askId: number; answerText: string }) => ({ ok: true })));
vi.mock("../../server/services/solene/founderCollab", () => ({
  getAsk: async (id: number) =>
    ({
      1: { id: 1, status: "open", answerFormat: "yes_no", questionSummary: "Held — founder-only: a pricing change (raise_prices_40pct)", questionBody: "x" },
      2: { id: 2, status: "open", answerFormat: "yes_no", questionSummary: "Support ticket #9 needs you: TCPA demand letter", questionBody: "legal" },
      // A finance-domain catalog move worded with no hard-stop vocabulary at all.
      3: { id: 3, status: "open", answerFormat: "yes_no", questionSummary: "Approve a finance action: recover_payments", questionBody: "Nudge the three accounts in dunning." },
      // A net-new move the kernel has never seen.
      4: { id: 4, status: "open", answerFormat: "yes_no", questionSummary: "Approve a ops action: tidy_dormant_tenants", questionBody: "Tidy up dormant tenants." },
      // The control: a known, non-money growth draft — the chat MAY answer this one.
      5: { id: 5, status: "open", answerFormat: "yes_no", questionSummary: "Review a drafted growth action: grow_owned_channels", questionBody: "Approve to let it proceed.", chatApprovable: true, bodyHash: "v5" },
    })[id] ?? null,
  // A SPY, not a thrower: the refusal must come from the classifier, never
  // from the answer path failing. (The earlier mock threw, the catch returned
  // ok:false, and the test stayed green with the classifier disabled — H3.)
  answerFounderAsk: (a: { askId: number; answerText: string }) => answerSpy(a),
  listOpenAsks: async () => [],
}));

describe("chat business tools — hard-stops are un-delegable", () => {
  it.each([1, 2, 3, 4])("refuses to answer founder-only ask #%i — the answer path is never reached", async (id) => {
    answerSpy.mockClear();
    const r = await executeBusinessChatTool("answer_ask", { ask_id: id, decision: "approve" }, "f");
    expect(r.ok).toBe(false);
    expect(r.text).toMatch(/founder-only/);
    expect(answerSpy).not.toHaveBeenCalled();
  });
  it("control: a known, non-money draft IS answered (the spy is live, so the refusals above are not vacuous)", async () => {
    answerSpy.mockClear();
    const r = await executeBusinessChatTool("answer_ask", { ask_id: 5, decision: "approve", version: "v5" }, "f");
    expect(r.ok).toBe(true);
    expect(answerSpy).toHaveBeenCalledWith({ askId: 5, answerText: "yes", expectedBodyHash: "v5", viaChat: true });
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

/**
 * H4 — the founder-only classes, ENUMERATED (CLAUDE.md population law): the
 * Record is keyed by FounderOnlyClass, so a new class without canaries is a
 * compile error, and every class must carry evasions that the first,
 * verb-anchored classifier let through. Each canary must classify as its class
 * on the MOVE path and be refused on the CHAT path.
 */
const FOUNDER_ONLY_CANARIES: Record<FounderOnlyClass, Array<{ kind: string; rationale: string; isNetNew?: boolean; domain?: string }>> = {
  pricing_changes: [
    { kind: "optimize_revenue", rationale: "Repricing the Starter plan should lift ARPU." },
    { kind: "adjust_fees", rationale: "Add a small processing fee to every invoice." },
    { kind: "migrate_accounts", rationale: "Move every trial onto the Pro tier automatically." },
  ],
  legal_signing: [
    { kind: "close_vendor", rationale: "Accept the data vendor's terms so the feed starts Monday." },
    { kind: "finalize_partnership", rationale: "Countersign the partnership agreement." },
    { kind: "renew_vendor", rationale: "Renew the Regrid contract for another year." },
  ],
  spend_over_500_usd: [
    { kind: "boost_reach", rationale: "Put 2,000 dollars behind the field notes." },
    { kind: "boost_reach", rationale: "Run Meta at $40/day for 30 days." },
    { kind: "boost_reach", rationale: "Spend two thousand dollars on search ads." },
    { kind: "boost_reach", rationale: "Keep $25 a day running on Meta." },
  ],
  customer_data_deletion: [
    { kind: "tidy_accounts", rationale: "Anonymize churned accounts older than a year." },
    { kind: "privacy_cleanup", rationale: "Erase the contact history of cancelled orgs." },
    { kind: "tidy_dormant_tenants", rationale: "Wipe the accounts of orgs inactive for 90 days." },
  ],
  net_new_move: [{ kind: "launch_webinar_series", rationale: "Host a weekly webinar for land investors.", isNetNew: true }],
  money_or_finance: [
    { kind: "recover_payments", rationale: "Nudge the three accounts in dunning.", domain: "finance" },
    { kind: "grow_owned_channels", rationale: "Refund the two unhappy trial users as goodwill." },
  ],
};

describe("H4 — founder-only classes fail CLOSED (enumerated, per-class canaries)", () => {
  it("every class is enumerated with canaries (population)", () => {
    expect(Object.keys(FOUNDER_ONLY_CANARIES).sort()).toEqual([...FOUNDER_ONLY_CLASSES].sort());
    for (const c of FOUNDER_ONLY_CLASSES) expect(FOUNDER_ONLY_CANARIES[c].length, c).toBeGreaterThan(0);
  });
  for (const cls of FOUNDER_ONLY_CLASSES) {
    it.each(FOUNDER_ONLY_CANARIES[cls])(`${cls}: %j is held on the move path and refused on the chat path`, (m) => {
      expect(founderOnlyClassForMove(m)).toBe(cls);
      expect(isUndelegableAsk({ questionSummary: `Approve a ${m.domain ?? "growth"} action: ${m.kind}`, questionBody: m.rationale })).toBe(true);
    });
  }
  it("amounts: dollars in words and rates are totals; open-ended rates are unbounded", () => {
    expect(moneyAmountsUsd("2,000 dollars")).toEqual([2000]);
    expect(moneyAmountsUsd("$40/day for 30 days")).toEqual([1200]);
    expect(moneyAmountsUsd("$100 per week for 2 months")).toEqual([100 * 60 / 7]);
    expect(moneyAmountsUsd("two thousand five hundred dollars")).toEqual([2500]);
    expect(moneyAmountsUsd("$25 a day")).toEqual([Number.POSITIVE_INFINITY]);
    expect(moneyAmountsUsd("$1.5k")).toEqual([1500]);
    expect(moneyAmountsUsd("$30 refund")).toEqual([30]);
  });
});

describe("founder controls — pause and the ad switch are mechanical", () => {
  it("a paused domain or ads-off blocks the move", () => {
    expect(moveBlockedByControls({ domain: "growth", kind: "grow_owned_channels" }, { pausedDomains: ["growth"], adsEnabled: true })).toMatch(/paused growth/);
    expect(moveBlockedByControls({ domain: "growth", kind: "buy_meta_ads_2000", rationale: "Spend on Meta ads" }, { pausedDomains: [], adsEnabled: false })).toMatch(/ad spending off/);
    expect(moveBlockedByControls({ domain: "growth", kind: "grow_owned_channels", rationale: "write an explainer" }, { pausedDomains: [], adsEnabled: false })).toBeNull();
    expect(moveBlockedByControls({ domain: "growth", kind: "run_ad_campaign" }, { pausedDomains: [], adsEnabled: false })).toMatch(/ad spending off/);
  });
  it("a move already waiting on the founder does not hold the tick: the next move is worked", () => {
    const moves = [
      { priority: 3, domain: "deploy", kind: "unblock_activation", rationale: "1 signup stalled" },
      { priority: 4, domain: "growth", kind: "grow_owned_channels", rationale: "grow" },
    ];
    const open = { pausedDomains: [], adsEnabled: true };
    expect(firstWorkableMove(moves, open, ["A higher-risk deploy action wants your sign-off: unblock_activation"])?.kind).toBe("grow_owned_channels");
    expect(firstWorkableMove(moves, open, [])?.kind).toBe("unblock_activation");
    // every move waiting → the first unblocked one (its ask folds)
    expect(firstWorkableMove(moves, open, ["x: unblock_activation", "y: grow_owned_channels"])?.kind).toBe("unblock_activation");
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
    const bad = Array.from({ length: 3 }, () => ({ calls: 2, failures: 2 }));
    expect(modelReadingFromBuckets(bad, 0).failing).toBe(true);
    expect(modelReadingFromBuckets([{ calls: 0, failures: 0 }, ...bad.slice(1)], 0).failing).toBeNull();
    expect(modelReadingFromBuckets(bad, 1).failing).toBe(false);
  });
  it("email and Stripe readings", () => {
    const t = (h: number) => new Date(Date.UTC(2026, 9, 7, h));
    expect(emailReadingFrom(3, t(5), t(1)).failing).toBe(true);
    expect(emailReadingFrom(3, t(5), t(6)).failing).toBe(false);
    expect(stripeReadingFrom({ ok: false, at: t(23) }, null, new Date(t(23).getTime() - 23 * 3_600_000), t(23)).failing).toBeNull();
    expect(stripeReadingFrom({ ok: false, at: t(23) }, new Date(t(23).getTime() - 24 * 3_600_000), null, t(23)).failing).toBe(true);
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

describe("M3 — resuming ads from chat waits for the founder's explicit confirmation", () => {
  it("the chat surface routes resume-ads to the approve control, not straight to the service", async () => {
    const { businessToolNeedsConfirmation } = await import("../../server/services/solene/chat/businessTools");
    expect(businessToolNeedsConfirmation("resume", { target: "ads" })).toBe(true);
    expect(businessToolNeedsConfirmation("resume", { target: "growth" })).toBe(false);
    expect(businessToolNeedsConfirmation("pause", { target: "ads" })).toBe(false);
    const r = await executeBusinessChatTool("resume", { target: "ads" }, "f");
    expect(r.ok).toBe(false);
    expect(r.text).toMatch(/explicit confirmation/);
  });
});
