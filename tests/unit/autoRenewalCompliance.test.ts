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
  autoRenewalAcknowledgment,
  ANNUAL_NOTICE_MIN_DAYS,
  ANNUAL_NOTICE_MAX_DAYS,
  ANNUAL_NOTICE_TARGET_DAYS,
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

  it("the job is on the deadman roster and started by the scheduler under its lock", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const root = path.resolve(__dirname, "../..");
    const { JOB_ROSTER } = (await import("../../server/jobs/jobRegistry")) as any;
    const roster = (JOB_ROSTER ?? []).map((j: any) => j.name);
    expect(roster).toContain("annual_renewal_notice");
    const sched = fs.readFileSync(path.join(root, "server/jobs/runScheduledJobs.ts"), "utf8");
    expect(sched).toMatch(/withJobLock\('annual_renewal_notice'/);
    expect(sched).toMatch(/^\s*startAnnualRenewalNoticeJob\(\);/m);
  });
});
