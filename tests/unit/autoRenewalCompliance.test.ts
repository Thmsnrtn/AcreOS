/**
 * Automatic renewal for yearly plans — Cal. Bus. & Prof. Code § 17602:
 *   (a)(1) terms in visual proximity to consent (Checkout's submit text);
 *   (a)(3) a keepable acknowledgment with terms, policy and how to cancel;
 *   (a)(6) the consent's verification recorded with the subscription;
 *   (a)(8), (b)(2) a notice 15–45 days before a yearly renewal;
 *   (d)(1) online cancellation, at will, immediately — no required survey,
 *          no hand-off to a second cancel step.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  autoRenewalTermsText,
  annualRenewalNotice,
  annualRenewalNoticeDue,
  maAnnualRenewalNoticeDue,
  autoRenewalAcknowledgment,
  ANNUAL_NOTICE_MIN_DAYS,
  ANNUAL_NOTICE_MAX_DAYS,
  ANNUAL_NOTICE_TARGET_DAYS,
  MA_ANNUAL_NOTICE_MIN_DAYS,
  MA_ANNUAL_NOTICE_MAX_DAYS,
} from "../../shared/billing/autoRenewalTerms";

const DAY = 86_400_000;

describe("the terms and the notices say what § 17602 asks", () => {
  it("(a)(1)/(a)(8)(A)–(D): renews automatically until cancelled, the amount, the frequency, how to cancel; with a trial, the price after it", () => {
    const t = autoRenewalTermsText({ planName: "Pro", priceCents: 49_000, interval: "year", trialDays: 14 });
    expect(t).toMatch(/renews automatically every year/);
    expect(t).toMatch(/\$490\.00/);
    expect(t).toMatch(/until you cancel/);
    expect(t).toMatch(/After your 14-day free trial you will be charged \$490\.00/);
    expect(t).toMatch(/Cancel any time online in Settings → Billing/);
    expect(t).toMatch(/15–45 days before each yearly renewal/);
    expect(t.length).toBeLessThanOrEqual(1200); // Stripe's custom_text cap
  });

  it("(b)(2): the yearly notice window is inside 15–45 days, and once per period", () => {
    expect(ANNUAL_NOTICE_MIN_DAYS).toBe(15);
    expect(ANNUAL_NOTICE_MAX_DAYS).toBe(45);
    expect(ANNUAL_NOTICE_TARGET_DAYS).toBeGreaterThanOrEqual(15);
    expect(ANNUAL_NOTICE_TARGET_DAYS).toBeLessThanOrEqual(45);
    const due = (days: number, extra: Partial<Parameters<typeof annualRenewalNoticeDue>[0]> = {}) =>
      annualRenewalNoticeDue({ renewsAtMs: days * DAY, nowMs: 0, alreadySentForThisPeriod: false, cancelAtPeriodEnd: false, ...extra });
    expect(due(14.9)).toBe(false);
    expect(due(15)).toBe(true);
    expect(due(30)).toBe(true);
    expect(due(46)).toBe(false);
    expect(due(20, { alreadySentForThisPeriod: true })).toBe(false);
    expect(due(20, { cancelAtPeriodEnd: true })).toBe(false);
  });

  it("(a)(8)(A)–(F): the notice states renewal unless cancelled, the term, the amount, a cancellation link and contact", () => {
    const n = annualRenewalNotice({ planName: "Pro", renewsOn: new Date(Date.UTC(2027, 0, 15)), amountCents: 49_000, appUrl: "https://app.test" });
    expect(n.text).toMatch(/renews automatically on January 15, 2027 unless you cancel/);
    expect(n.text).toMatch(/Renewal term: one year/);
    expect(n.text).toMatch(/\$490\.00/);
    expect(n.html).toMatch(/href="https:\/\/app\.test\/settings\?tab=billing"/);
    expect(n.text).toMatch(/support@acreos\.io/);
  });

  it("940 CMR 38.05(4): the Massachusetts window is 5–30 days before the cancel-by date, and it reaches the 5–14-day band California's predicate cannot", () => {
    expect(MA_ANNUAL_NOTICE_MIN_DAYS).toBe(5);
    expect(MA_ANNUAL_NOTICE_MAX_DAYS).toBe(30);
    const maDue = (days: number, extra: Partial<Parameters<typeof maAnnualRenewalNoticeDue>[0]> = {}) =>
      maAnnualRenewalNoticeDue({ renewsAtMs: days * DAY, nowMs: 0, alreadySentForThisPeriod: false, cancelAtPeriodEnd: false, ...extra });
    const caDue = (days: number) =>
      annualRenewalNoticeDue({ renewsAtMs: days * DAY, nowMs: 0, alreadySentForThisPeriod: false, cancelAtPeriodEnd: false });
    expect(maDue(4.9)).toBe(false);
    expect(maDue(5)).toBe(true);
    expect(maDue(30)).toBe(true);
    expect(maDue(30.1)).toBe(false);
    // The rescue band: at 10 days the Massachusetts duty is still owed
    // even though the California 15-day floor has already closed.
    expect(maDue(10)).toBe(true);
    expect(caDue(10)).toBe(false);
    // At 20 days one notice satisfies both regimes.
    expect(maDue(20)).toBe(true);
    expect(caDue(20)).toBe(true);
    expect(maDue(20, { alreadySentForThisPeriod: true })).toBe(false);
    expect(maDue(20, { cancelAtPeriodEnd: true })).toBe(false);
  });

  it("940 CMR 38.05(4)(a)–(e): the notice states the obligations on failing to cancel, every Product chargeable, the mechanism, the cancel-by date and the charge date", () => {
    const n = annualRenewalNotice({
      planName: "Pro",
      renewsOn: new Date(Date.UTC(2027, 0, 15)),
      amountCents: 139_000,
      appUrl: "https://app.test",
      products: ["AcreOS Pro plan", "additional seat add-on"],
    });
    // (b) every Product chargeable at renewal
    expect(n.text).toMatch(/Products charged at renewal: AcreOS Pro plan, additional seat add-on\./);
    // (a) obligations if the consumer fails to cancel + (d) cancel-by
    // calendar date + (e) charge calendar date, in one explicit sentence
    expect(n.text).toMatch(/If you do not cancel by January 15, 2027, \$1,390\.00 \(plus applicable tax\) will be charged to your payment method on file on January 15, 2027, and your plan will renew for one year\./);
    // (c) the cancellation mechanism
    expect(n.html).toMatch(/href="https:\/\/app\.test\/settings\?tab=billing"/);
    // The checkout terms promise the Massachusetts window too.
    const t = autoRenewalTermsText({ planName: "Pro", priceCents: 99_000, interval: "year" });
    expect(t).toMatch(/5–30 days before the cancel-by date, per 940 CMR 38\.05/);
  });

  it("(a)(3): the acknowledgment carries the terms, the cancellation policy and how to cancel", () => {
    const a = autoRenewalAcknowledgment({ termsText: "TERMS-X", appUrl: "https://app.test" });
    expect(a.text).toMatch(/TERMS-X/);
    expect(a.text).toMatch(/Cancellation policy/);
    expect(a.text).toMatch(/How to cancel: Settings → Billing → Cancel subscription/);
  });
});

// ── the daily job ─────────────────────────────────────────────────────────
const J = vi.hoisted(() => ({ orgs: [] as any[], history: [] as any[], inserted: [] as any[] }));
vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/utils/orgScopedDb", async () => {
  const schema = await import("@shared/schema");
  return {
    unscopedForPlatformOps: () => ({
      select: () => ({
        from: (t: any) => {
          const rows = t === schema.organizations ? J.orgs : J.history;
          const c: any = { where: () => c, limit: () => c, then: (ok: any, bad: any) => Promise.resolve(rows).then(ok, bad) };
          return c;
        },
      }),
      insert: () => ({ values: async (v: any) => { J.inserted.push(v); J.history.push(v); } }),
    }),
  };
});

describe("the annual-notice job", () => {
  beforeEach(() => { J.orgs = []; J.history = []; J.inserted = []; });

  it("sends once per renewal, inside the window, on the system lane; skips cancelled and far-off renewals", async () => {
    const { runAnnualRenewalNotices } = await import("../../server/services/annualRenewalNotice");
    const now = Date.UTC(2026, 9, 9);
    const subs: Record<string, any> = {
      sub_in: { current_period_end: (now + 20 * DAY) / 1000, cancel_at_period_end: false, items: { data: [{ price: { unit_amount: 49_000, currency: "usd" } }] } },
      sub_far: { current_period_end: (now + 60 * DAY) / 1000, cancel_at_period_end: false, items: { data: [{ price: { unit_amount: 49_000 } }] } },
      sub_cancel: { current_period_end: (now + 20 * DAY) / 1000, cancel_at_period_end: true, items: { data: [{ price: { unit_amount: 49_000 } }] } },
    };
    J.orgs = [{ id: 1, tier: "pro", subId: "sub_in" }, { id: 2, tier: "pro", subId: "sub_far" }, { id: 3, tier: "pro", subId: "sub_cancel" }];
    const sent: any[] = [];
    const deps = { getSubscription: async (id: string) => subs[id], ownerEmail: async () => "owner@x.test", send: async (o: any) => { sent.push(o); } };
    const r1 = await runAnnualRenewalNotices({ deps, nowMs: now });
    expect(r1.sent).toBe(1);
    expect(sent[0].subject).toMatch(/renews on/);
    // Keyed per org and period, so a crash between send and history row replays rather than resends.
    expect(sent[0]).toEqual(expect.objectContaining({ organizationId: 1, idempotencyKey: `annual-renewal-notice:1:${(now + 20 * DAY) / 1000}` }));
    expect(J.inserted[0]).toEqual(expect.objectContaining({ organizationId: 1, eventType: "annual_renewal_notice_sent" }));
    // Next day: the history row for this period exists → nothing more.
    J.orgs = [J.orgs[0]];
    const r2 = await runAnnualRenewalNotices({ deps, nowMs: now + DAY });
    expect(r2.sent).toBe(0);
  });

  it("940 CMR 38.05: a renewal first observed 10 days out still gets exactly one notice (Massachusetts-timely), one at 3 days gets none, and the amount is the full multi-item renewal total", async () => {
    const { runAnnualRenewalNotices } = await import("../../server/services/annualRenewalNotice");
    const now = Date.UTC(2026, 9, 9);
    const subs: Record<string, any> = {
      // 10 days out: outside California's 15-day floor, inside
      // Massachusetts' 5–30-day window. Two items: base plan + 2 seats.
      sub_ma: { current_period_end: (now + 10 * DAY) / 1000, cancel_at_period_end: false, items: { data: [{ price: { unit_amount: 99_000, currency: "usd" } }, { quantity: 2, price: { unit_amount: 20_000, currency: "usd" } }] } },
      // 3 days out: inside neither window — no notice may be sent.
      sub_late: { current_period_end: (now + 3 * DAY) / 1000, cancel_at_period_end: false, items: { data: [{ price: { unit_amount: 99_000 } }] } },
    };
    J.orgs = [{ id: 7, tier: "pro", subId: "sub_ma" }, { id: 8, tier: "pro", subId: "sub_late" }];
    const sent: any[] = [];
    const deps = { getSubscription: async (id: string) => subs[id], ownerEmail: async () => "owner@x.test", send: async (o: any) => { sent.push(o); } };
    const r1 = await runAnnualRenewalNotices({ deps, nowMs: now });
    expect(r1.sent).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0].organizationId).toBe(7);
    // Full renewal total: $990 plan + 2 × $200 seats = $1,390, and both
    // Products are named in the notice body (38.05(4)(b)).
    expect(sent[0].text).toMatch(/\$1,390\.00/);
    expect(sent[0].text).toMatch(/Products charged at renewal: AcreOS Pro plan, additional seat add-on\./);
    expect(J.inserted[0]).toEqual(expect.objectContaining({ organizationId: 7, eventType: "annual_renewal_notice_sent", priceCents: 139_000 }));
    expect(J.inserted[0].metadata.noticeRegimes).toEqual(["ma-940-cmr-38.05"]);
    // Next day: the history row for this period exists → nothing more.
    J.orgs = [J.orgs[0]];
    const r2 = await runAnnualRenewalNotices({ deps, nowMs: now + DAY });
    expect(r2.sent).toBe(0);
  });

  it("the job is on the deadman roster and started by the scheduler under its lock", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const root = path.resolve(__dirname, "../..");
    const { JOB_ROSTER } = (await import("../../server/jobs/jobRegistry")) as any;
    const roster = (JOB_ROSTER ?? []).map((j: any) => j.name);
    expect(roster).toContain("annual_renewal_notice");
    const strip = (await import("../helpers/stripComments")).stripComments;
    const mod = strip(fs.readFileSync(path.join(root, "server/jobs/subscriptionLifecycleJobs.ts"), "utf8"));
    expect(mod).toMatch(/withJobLock\("annual_renewal_notice"/);
    // started by the module's entry point, which the scheduler starts
    expect(mod).toMatch(/export function startSubscriptionLifecycleJobs\(\) \{[^}]*startAnnualRenewalNoticeJob\(\);/);
    const sched = strip(fs.readFileSync(path.join(root, "server/jobs/runScheduledJobs.ts"), "utf8"));
    expect(sched).toMatch(/^\s*startSubscriptionLifecycleJobs\(\);/m);
  });
});
