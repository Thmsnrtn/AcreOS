/**
 * P1-15 / TAIL-A2 — the autonomous deal machine's tenant fences, unit level.
 *
 * The engine's cross-tenant defect was a read: the morning briefing took the
 * latest platform-wide `background_jobs` row and showed its aggregate counts
 * to every org. These tests pin the two fences that now live INSIDE the
 * engine's own data access (server/jobs/autonomousDealMachine.ts):
 *
 *   1. `overnightActivityForOrg` returns only the requesting org's recorded
 *      slice — a poisoned aggregate is never a fallback, and neither is
 *      another org's slice.
 *   2. `runAutoFollowUpEngine` refuses campaign enrolment before reading a
 *      single lead, under the default (ask-before-sending) stance — the db
 *      mock throws on any query, so a pass proves the refusal precedes all
 *      data access.
 *
 * The end-to-end version (real Postgres, real briefing sends) is
 * autonomousDealMachineTenantQuarantine.realdb.test.ts.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../server/db", () => ({
  db: {
    select: () => {
      throw new Error("db must not be touched before the enrolment fence");
    },
  },
}));

vi.mock("../../server/services/emailService", () => ({
  emailService: { sendEmail: vi.fn(async () => ({ success: true })) },
}));

vi.mock("../../server/services/atlasMemory", () => ({
  getRelevantMemories: async () => [],
  formatMemoriesForContext: () => "",
}));

vi.mock("../../server/services/sellerMotivationEngine", () => ({
  computeSellerMotivationScore: () => ({ score: 0, grade: "F", topSignals: [] }),
  getOptimalOutreachTiming: () => null,
}));

vi.mock("../../server/services/orgOperating", () => ({
  orgMayActFilter: () => ({}),
}));

const controls = vi.hoisted(() => ({
  state: {
    stance: "ask_before_sending",
    leadScoring: true,
    borrowerReminders: true,
    inboxDrafts: true,
    paused: false,
    pausedUntil: null,
    pausedBy: null,
    checkFailed: false,
    timezone: "America/New_York",
  } as Record<string, unknown>,
}));
vi.mock("../../server/services/paxControls", () => ({
  getPaxControls: async () => controls.state,
  paxControlsRefusalMessage: () => "refused",
}));

import {
  overnightActivityForOrg,
  runAutoFollowUpEngine,
  ZERO_OVERNIGHT_ACTIVITY,
} from "../../server/jobs/autonomousDealMachine";

const A = 101;
const B = 202;

describe("overnightActivityForOrg — a briefing may only ever see its own org", () => {
  const poisoned = {
    // The legacy aggregate: every org's totals summed. Never show this.
    newDealsFound: 999,
    hotDealsFound: 888,
    leadsAutoEnrolled: 777,
    followUpsScheduled: 666,
    perOrg: {
      [String(A)]: { newDealsFound: 11, hotDealsFound: 3, leadsAutoEnrolled: 5, followUpsScheduled: 7 },
      [String(B)]: { newDealsFound: 22, hotDealsFound: 0, leadsAutoEnrolled: 1, followUpsScheduled: 2 },
    },
  };

  it("returns org A's own slice, not the aggregate and not org B's", () => {
    expect(overnightActivityForOrg(poisoned, A)).toEqual({
      newDealsFound: 11,
      hotDealsFound: 3,
      leadsAutoEnrolled: 5,
      followUpsScheduled: 7,
    });
  });

  it("returns org B's own slice", () => {
    expect(overnightActivityForOrg(poisoned, B)).toEqual({
      newDealsFound: 22,
      hotDealsFound: 0,
      leadsAutoEnrolled: 1,
      followUpsScheduled: 2,
    });
  });

  it("an org with no recorded slice gets zeros, never the aggregate", () => {
    expect(overnightActivityForOrg(poisoned, 303)).toEqual(ZERO_OVERNIGHT_ACTIVITY);
  });

  it("a legacy aggregate-only row (no perOrg) yields zeros for every org", () => {
    const legacy = { newDealsFound: 999, hotDealsFound: 888, leadsAutoEnrolled: 777, followUpsScheduled: 666 };
    expect(overnightActivityForOrg(legacy, A)).toEqual(ZERO_OVERNIGHT_ACTIVITY);
    expect(overnightActivityForOrg(legacy, B)).toEqual(ZERO_OVERNIGHT_ACTIVITY);
  });

  it("null / malformed results yield zeros", () => {
    expect(overnightActivityForOrg(null, A)).toEqual(ZERO_OVERNIGHT_ACTIVITY);
    expect(overnightActivityForOrg(undefined, A)).toEqual(ZERO_OVERNIGHT_ACTIVITY);
    expect(overnightActivityForOrg("junk", A)).toEqual(ZERO_OVERNIGHT_ACTIVITY);
    expect(overnightActivityForOrg({ perOrg: { [String(A)]: { hotDealsFound: "3" } } }, A)).toEqual(
      ZERO_OVERNIGHT_ACTIVITY
    );
  });
});

describe("runAutoFollowUpEngine — enrolment fence fires before any data access", () => {
  it("refuses enrolment under the default ask-before-sending stance", async () => {
    controls.state = { ...controls.state, stance: "ask_before_sending", paused: false, checkFailed: false };
    await expect(runAutoFollowUpEngine(A)).resolves.toEqual({
      leadsReenraged: 0,
      touchesScheduled: 0,
      campaignsCreated: 0,
    });
  });

  it("refuses enrolment under ask-before-everything", async () => {
    controls.state = { ...controls.state, stance: "ask_before_everything" };
    await expect(runAutoFollowUpEngine(A)).resolves.toEqual({
      leadsReenraged: 0,
      touchesScheduled: 0,
      campaignsCreated: 0,
    });
  });

  it("refuses enrolment while the org is paused", async () => {
    controls.state = { ...controls.state, paused: true };
    await expect(runAutoFollowUpEngine(B)).resolves.toEqual({
      leadsReenraged: 0,
      touchesScheduled: 0,
      campaignsCreated: 0,
    });
  });

  it("refuses enrolment when the controls read failed (fail-closed state)", async () => {
    controls.state = { ...controls.state, paused: true, checkFailed: true, stance: "ask_before_everything" };
    await expect(runAutoFollowUpEngine(B)).resolves.toEqual({
      leadsReenraged: 0,
      touchesScheduled: 0,
      campaignsCreated: 0,
    });
  });
});
