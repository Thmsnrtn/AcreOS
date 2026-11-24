/**
 * B-7 — lender Connect onboarding stalls silently.
 *
 * Before this wire, `currentlyDue` aging had no nudge or escalation:
 * P3-4's fixture needed manual API completion of every requirement and
 * the settlement leg failed three times at the onboarding wall. These
 * suites run the REAL observation logic + daily sweep + aging list
 * against injected seams (the outbox-reaper DI pattern), so every leg is
 * proven without a database or a Stripe account:
 *
 *   clock    → first stuck sighting seeds firstSeen; repeats keep it;
 *               the requirements snapshot refreshes when it changes; a
 *               resolved stall clears all three keys; an unreadable
 *               account (no requirements list) moves nothing;
 *   sweep    → a 7-day stall fires ONE lender notice + ONE founder
 *               alert (warning) and stamps alertedAt; the notice runs
 *               first, so the alert's reminder claim reports the actual
 *               delivery outcome (never claims a reminder that failed);
 *               6 days fires
 *               nothing; an already-alerted stall never re-fires; a fresh
 *               stall is seeded, not alerted; a resolved stall clears;
 *               a failed live read leaves the row untouched; one bad row
 *               never suppresses the others;
 *   list     → the founder aging list shows stalled rows only, oldest
 *               first, from the database alone;
 *   never    → every settings write the sweep can make is asserted to
 *               carry the three stall keys ONLY — no account changes, no
 *               capability writes, no charges; and the lender leg is a
 *               push + in-app notice, never an email/SMS send (the deps
 *               carry no send seam at all).
 */
import { describe, it, expect } from "vitest";
import {
  computeStallObservation,
  listOnboardingStalls,
  runOnboardingStallSweep,
  type ConnectOnboardingStallDeps,
  type OnboardingStallSettings,
  type StripeConnectIntegrationSnapshot,
  type LiveConnectStatus,
} from "../../server/services/connectOnboardingStalls";

const NOW = new Date("2026-11-19T12:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;
const isoDaysAgo = (days: number) => new Date(NOW.getTime() - days * DAY_MS).toISOString();
const REQS = ["tos_acceptance.date", "tos_acceptance.ip"];

function stallSettings(firstSeenIso: string | null, requirements: string[] = REQS, alertedAt: string | null = null) {
  const settings: Record<string, unknown> = {
    stripeConnectOnboardingComplete: false,
    stripeConnectChargesEnabled: false,
  };
  if (firstSeenIso != null) settings.stripeConnectStallFirstSeenAt = firstSeenIso;
  if (firstSeenIso != null) settings.stripeConnectStallRequirements = [...requirements];
  if (alertedAt != null) settings.stripeConnectStallAlertedAt = alertedAt;
  return settings;
}

function makeIntegration(overrides: Partial<StripeConnectIntegrationSnapshot> = {}): StripeConnectIntegrationSnapshot {
  return {
    organizationId: 102,
    accountId: "acct_stalled_1",
    settings: {},
    chargesEnabled: false,
    lastValidatedAt: new Date("2026-11-19T11:00:00.000Z"),
    ...overrides,
  };
}

interface Harness {
  deps: ConnectOnboardingStallDeps;
  saves: { integration: StripeConnectIntegrationSnapshot; patch: OnboardingStallSettings }[];
  alerts: Parameters<ConnectOnboardingStallDeps["createSystemAlert"]>[0][];
  notices: Parameters<ConnectOnboardingStallDeps["notifyLender"]>[0][];
  /** Fan-out order across the alert + notice seams ("notice" / "alert"). */
  order: string[];
}

function makeHarness(
  integrations: StripeConnectIntegrationSnapshot[],
  liveByAccount: Record<string, LiveConnectStatus | null> = {},
  overrides: Partial<ConnectOnboardingStallDeps> = {},
): Harness {
  const saves: Harness["saves"] = [];
  const alerts: Harness["alerts"] = [];
  const notices: Harness["notices"] = [];
  const order: string[] = [];
  const deps: ConnectOnboardingStallDeps = {
    listStripeConnectIntegrations: async () => integrations,
    getAccountStatus: async (accountId) =>
      accountId in liveByAccount ? liveByAccount[accountId] : { isConnected: true, chargesEnabled: false, requirements: { currentlyDue: [...REQS] } },
    saveStallObservation: async (integration, patch) => {
      saves.push({ integration, patch });
    },
    createSystemAlert: async (alert) => {
      order.push("alert");
      alerts.push(alert);
    },
    notifyLender: async (notice) => {
      order.push("notice");
      notices.push(notice);
      return { pushed: true, inApp: 1 };
    },
    getOrganizationName: async (organizationId) => `Org ${organizationId}`,
    now: () => NOW,
    ...overrides,
  };
  return { deps, saves, alerts, notices, order };
}

/** The no-account-changes pin: a settings write may carry stall keys ONLY. */
function expectStallKeysOnly(patch: OnboardingStallSettings) {
  const allowed = new Set([
    "stripeConnectStallFirstSeenAt",
    "stripeConnectStallRequirements",
    "stripeConnectStallAlertedAt",
  ]);
  for (const key of Object.keys(patch)) {
    expect(allowed.has(key), `settings write carried a non-stall key: ${key}`).toBe(true);
  }
}

describe("computeStallObservation — the stall clock", () => {
  it("seeds firstSeen + requirements + alertedAt null on first stuck sighting", () => {
    const obs = computeStallObservation({}, REQS, NOW);
    expect(obs).not.toBeNull();
    expect(obs!.changed).toBe(true);
    expect(obs!.patch).toEqual({
      stripeConnectStallFirstSeenAt: NOW.toISOString(),
      stripeConnectStallRequirements: REQS,
      stripeConnectStallAlertedAt: null,
    });
  });

  it("keeps firstSeen on a repeat sighting with unchanged requirements (no write)", () => {
    const firstSeen = isoDaysAgo(3);
    const obs = computeStallObservation(stallSettings(firstSeen), REQS, NOW);
    expect(obs).toBeNull();
  });

  it("refreshes the requirements snapshot when the list changes, keeping firstSeen + alertedAt", () => {
    const firstSeen = isoDaysAgo(8);
    const alertedAt = isoDaysAgo(1);
    const changed = ["tos_acceptance.date", "external_account"];
    const obs = computeStallObservation(stallSettings(firstSeen, REQS, alertedAt), changed, NOW);
    expect(obs).not.toBeNull();
    expect(obs!.patch).toEqual({
      stripeConnectStallFirstSeenAt: firstSeen,
      stripeConnectStallRequirements: changed,
      stripeConnectStallAlertedAt: alertedAt,
    });
  });

  it("clears all three keys when the requirements empty (resolved)", () => {
    const obs = computeStallObservation(stallSettings(isoDaysAgo(8), REQS, isoDaysAgo(1)), [], NOW);
    expect(obs).not.toBeNull();
    expect(obs!.changed).toBe(true);
    expect(obs!.patch.stripeConnectStallFirstSeenAt).toBeUndefined();
    expect(obs!.patch.stripeConnectStallRequirements).toBeUndefined();
    expect(obs!.patch.stripeConnectStallAlertedAt).toBeNull();
    expectStallKeysOnly(obs!.patch);
  });

  it("leaves a never-stalled row untouched when the requirements are empty", () => {
    expect(computeStallObservation({}, [], NOW)).toBeNull();
  });

  it("moves nothing when the account is unreadable (no requirements list)", () => {
    expect(computeStallObservation(stallSettings(isoDaysAgo(8)), undefined, NOW)).toBeNull();
    expect(computeStallObservation({}, undefined, NOW)).toBeNull();
  });
});

describe("runOnboardingStallSweep — the 7-day alert", () => {
  it("alerts once at 8 days: founder warning + lender notice + alertedAt stamped", async () => {
    const firstSeen = isoDaysAgo(8);
    const h = makeHarness([makeIntegration({ settings: stallSettings(firstSeen) })]);
    const result = await runOnboardingStallSweep(h.deps);

    expect(result).toEqual({ scanned: 1, stalled: 1, newlySeeded: 0, resolved: 0, alerted: 1 });

    expect(h.alerts).toHaveLength(1);
    expect(h.alerts[0].type).toBe("stripe_connect_onboarding_stall");
    expect(h.alerts[0].severity).toBe("warning");
    expect(h.alerts[0].organizationId).toBe(102);
    expect(h.alerts[0].relatedEntityId).toBe(102);
    expect(h.alerts[0].title).toContain("8 days");
    expect(h.alerts[0].message).toContain("acct_stalled_1");
    expect(h.alerts[0].message).toContain("tos_acceptance.date");
    expect(h.alerts[0].message).toContain("No account changes were made");
    expect(h.alerts[0].metadata).toMatchObject({ accountId: "acct_stalled_1", daysStuck: 8 });

    // The notice runs BEFORE the alert is written, so the alert's
    // "has been reminded" claim is a report of a delivery that already
    // happened, and the outcome is recorded in the alert metadata.
    expect(h.order).toEqual(["notice", "alert"]);
    expect(h.alerts[0].message).toContain("The lender has been reminded in-app.");
    expect(h.alerts[0].metadata).toMatchObject({ lenderNotice: { pushed: true, inApp: 1 } });

    expect(h.notices).toHaveLength(1);
    expect(h.notices[0]).toEqual({ orgId: 102, accountId: "acct_stalled_1", daysStuck: 8, requirements: REQS });

    expect(h.saves).toHaveLength(1);
    expectStallKeysOnly(h.saves[0].patch);
    expect(h.saves[0].patch.stripeConnectStallFirstSeenAt).toBe(firstSeen);
    expect(h.saves[0].patch.stripeConnectStallRequirements).toEqual(REQS);
    expect(h.saves[0].patch.stripeConnectStallAlertedAt).toBe(NOW.toISOString());
  });

  it("does not claim the lender was reminded when no notice leg delivered (#631 audit follow-up)", async () => {
    const h = makeHarness(
      [makeIntegration({ settings: stallSettings(isoDaysAgo(8)) })],
      {},
      {
        notifyLender: async () => ({ pushed: false, inApp: 0 }),
      },
    );
    const result = await runOnboardingStallSweep(h.deps);

    // The founder alert itself is the escalation — it still fires and
    // still stamps — but its text reports the failed delivery instead
    // of claiming a reminder the lender never saw.
    expect(result.alerted).toBe(1);
    expect(h.alerts).toHaveLength(1);
    expect(h.alerts[0].message).not.toContain("has been reminded");
    expect(h.alerts[0].message).toContain("no push or in-app delivery succeeded");
    expect(h.alerts[0].metadata).toMatchObject({ lenderNotice: { pushed: false, inApp: 0 } });
    expect(h.saves).toHaveLength(1);
    expect(h.saves[0].patch.stripeConnectStallAlertedAt).toBe(NOW.toISOString());
  });

  it("fires at exactly 7 days and not at 6 days 23 hours", async () => {
    const at7 = makeIntegration({ organizationId: 201, accountId: "acct_7d", settings: stallSettings(isoDaysAgo(7)) });
    const at6 = makeIntegration({ organizationId: 202, accountId: "acct_6d", settings: stallSettings(new Date(NOW.getTime() - 6 * DAY_MS - 23 * 60 * 60 * 1000).toISOString()) });
    const h = makeHarness([at7, at6]);
    const result = await runOnboardingStallSweep(h.deps);

    expect(result.alerted).toBe(1);
    expect(h.alerts).toHaveLength(1);
    expect(h.alerts[0].organizationId).toBe(201);
    expect(h.notices).toHaveLength(1);
    expect(h.notices[0].orgId).toBe(201);
  });

  it("never re-fires for an already-alerted stall", async () => {
    const h = makeHarness([
      makeIntegration({ settings: stallSettings(isoDaysAgo(10), REQS, isoDaysAgo(3)) }),
    ]);
    const result = await runOnboardingStallSweep(h.deps);

    expect(result).toEqual({ scanned: 1, stalled: 1, newlySeeded: 0, resolved: 0, alerted: 0 });
    expect(h.alerts).toHaveLength(0);
    expect(h.notices).toHaveLength(0);
    expect(h.saves).toHaveLength(0);
  });

  it("seeds a fresh stall without alerting (newlySeeded 1, alerted 0)", async () => {
    const h = makeHarness([makeIntegration({ settings: {} })]);
    const result = await runOnboardingStallSweep(h.deps);

    expect(result).toEqual({ scanned: 1, stalled: 1, newlySeeded: 1, resolved: 0, alerted: 0 });
    expect(h.alerts).toHaveLength(0);
    expect(h.notices).toHaveLength(0);
    expect(h.saves).toHaveLength(1);
    expectStallKeysOnly(h.saves[0].patch);
    expect(h.saves[0].patch.stripeConnectStallFirstSeenAt).toBe(NOW.toISOString());
    expect(h.saves[0].patch.stripeConnectStallRequirements).toEqual(REQS);
    expect(h.saves[0].patch.stripeConnectStallAlertedAt).toBeNull();
  });

  it("clears a resolved stall and counts it (resolved 1)", async () => {
    const h = makeHarness(
      [makeIntegration({ settings: stallSettings(isoDaysAgo(9), REQS, isoDaysAgo(2)) })],
      { acct_stalled_1: { isConnected: true, chargesEnabled: true, requirements: { currentlyDue: [] } } },
    );
    const result = await runOnboardingStallSweep(h.deps);

    expect(result).toEqual({ scanned: 1, stalled: 0, newlySeeded: 0, resolved: 1, alerted: 0 });
    expect(h.alerts).toHaveLength(0);
    expect(h.saves).toHaveLength(1);
    expectStallKeysOnly(h.saves[0].patch);
    expect(h.saves[0].patch.stripeConnectStallFirstSeenAt).toBeUndefined();
  });

  it("leaves an unreadable account exactly untouched (no seed, no clear, no alert)", async () => {
    const h = makeHarness(
      [makeIntegration({ settings: stallSettings(isoDaysAgo(8)) })],
      { acct_stalled_1: null },
    );
    const result = await runOnboardingStallSweep(h.deps);

    expect(result).toEqual({ scanned: 1, stalled: 0, newlySeeded: 0, resolved: 0, alerted: 0 });
    expect(h.alerts).toHaveLength(0);
    expect(h.notices).toHaveLength(0);
    expect(h.saves).toHaveLength(0);
  });

  it("isolates a per-row failure: the other stall still alerts", async () => {
    const bad = makeIntegration({ organizationId: 301, accountId: "acct_bad" });
    const good = makeIntegration({ organizationId: 302, accountId: "acct_good", settings: stallSettings(isoDaysAgo(8)) });
    const h = makeHarness([bad, good], {}, {
      getAccountStatus: async (accountId) => {
        if (accountId === "acct_bad") throw new Error("stripe down");
        return { isConnected: true, chargesEnabled: false, requirements: { currentlyDue: [...REQS] } };
      },
    });
    const result = await runOnboardingStallSweep(h.deps);

    expect(result.alerted).toBe(1);
    expect(result.scanned).toBe(2);
    expect(h.alerts).toHaveLength(1);
    expect(h.alerts[0].organizationId).toBe(302);
  });
});

describe("listOnboardingStalls — the founder aging list", () => {
  it("shows stalled rows only, oldest first, with exact fields", async () => {
    const older = makeIntegration({ organizationId: 102, accountId: "acct_old", settings: stallSettings(isoDaysAgo(9), REQS, isoDaysAgo(2)), chargesEnabled: false });
    const newer = makeIntegration({ organizationId: 103, accountId: "acct_new", settings: stallSettings(isoDaysAgo(3)), chargesEnabled: false });
    const never = makeIntegration({ organizationId: 104, accountId: "acct_ok", settings: {} });
    const resolved = makeIntegration({ organizationId: 105, accountId: "acct_res", settings: stallSettings(isoDaysAgo(5), []) });
    const h = makeHarness([newer, never, older, resolved]);
    const list = await listOnboardingStalls(h.deps);

    expect(list).toHaveLength(2);
    expect(list[0]).toEqual({
      organizationId: 102,
      organizationName: "Org 102",
      accountId: "acct_old",
      requirements: REQS,
      firstSeenStuckAt: isoDaysAgo(9),
      daysStuck: 9,
      alertedAt: isoDaysAgo(2),
      lastValidatedAt: "2026-11-19T11:00:00.000Z",
      chargesEnabled: false,
    });
    expect(list[1].organizationId).toBe(103);
    expect(list[1].daysStuck).toBe(3);
    expect(list[1].alertedAt).toBeNull();
  });

  it("falls back to 'Organization <id>' when the org name is unknown", async () => {
    const h = makeHarness([makeIntegration({ settings: stallSettings(isoDaysAgo(8)) })], {}, {
      getOrganizationName: async () => null,
    });
    const list = await listOnboardingStalls(h.deps);
    expect(list).toHaveLength(1);
    expect(list[0].organizationName).toBe("Organization 102");
  });

  it("returns an empty list when nothing is stalled", async () => {
    const h = makeHarness([makeIntegration({ settings: {} })]);
    expect(await listOnboardingStalls(h.deps)).toEqual([]);
  });
});
