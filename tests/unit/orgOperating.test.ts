/**
 * A pause must reach the work that runs on the customer's behalf.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 * Three orthogonal columns decide whether AcreOS may act for an organization —
 * `subscriptionStatus`, `subscriptionPaused`, `dunningStage` — and until
 * 2026-08-18 nothing read all three. The two newer axes were enforced only in
 * the HTTP path, chained from the session chokepoint in `getOrCreateOrg`, which
 * a cron never traverses. Fifteen background queries used a hand-copied
 * fragment predating both: `eq(organizations.subscriptionStatus, "active")`.
 *
 * `subscriptionPauseGate` promised the customer "no new actions allowed (no new
 * mail, no new comps, no Pax messages)" while `paxNudges` minted nudges,
 * `autonomousDealMachine` scored leads and sent a morning briefing EMAIL, and
 * `growthAutomation`/`lifecycleDispatch` sent lifecycle and re-engagement mail
 * — to exactly the customers told the product had gone read-only.
 *
 * ── WHERE IT CAME FROM ──────────────────────────────────────────────────────
 * Foundry, `afbac4a` (2026-08-18): `companyMayIncurCost` read `status` and
 * `scp_status` directly — "complete when written, stale the moment migration
 * 145 gave commercial entitlement its own field" — and the decision now comes
 * from one `operatingProduct()` predicate, with a gate so nobody hand-writes a
 * piece of the operating rule again. The invariant crossed; the predicate is
 * AcreOS's own and reads AcreOS's own three columns. No Foundry noun came with
 * it, and no new column was added — a fourth "operating" column would be the
 * parallel truth this removes.
 */

import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { orgActRefusal } from "../../server/services/orgOperating";

/** Local helper — the module exports the REASON, not a boolean. */
const orgMayAct = (facts: Parameters<typeof orgActRefusal>[0], now?: number) =>
  orgActRefusal(facts, now) === null;

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string): string => fs.readFileSync(path.join(ROOT, p), "utf8");
const codeOf = (p: string): string =>
  read(p)
    .split("\n")
    .filter((l) => {
      const t = l.trim();
      return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
    })
    .join("\n");

describe("the predicate reads all three axes", () => {
  it("an active, unpaused, undunned org may be acted for", () => {
    expect(orgMayAct({ subscriptionStatus: "active", subscriptionPaused: false, dunningStage: "none" })).toBe(true);
    // Nulls are the common shape for an org that has never paused or dunned.
    expect(orgMayAct({ subscriptionStatus: "active" })).toBe(true);
  });

  it("AN ELECTED PAUSE STOPS ACTION WHILE THE STATUS IS STILL 'active'", () => {
    // THE EXACT STATE routes-billing WRITES: it sets only `subscriptionPaused`
    // and leaves the status alone ("the webhook will follow up"). Every one of
    // the fifteen background filters saw 'active' and acted.
    const paused = { subscriptionStatus: "active", subscriptionPaused: true, dunningStage: "none" };
    expect(orgMayAct(paused)).toBe(false);
    expect(orgActRefusal(paused)).toBe("subscription_paused");
  });

  it("a restricted dunning stage stops action while the status is still 'active'", () => {
    // `autonomousHealthMonitor` queries
    // `dunning_stage IN ('warning','restricted') AND subscription_status = 'active'`
    // — the codebase asserting this axis is independent.
    const restricted = { subscriptionStatus: "active", subscriptionPaused: false, dunningStage: "restricted" };
    expect(orgMayAct(restricted)).toBe(false);
    expect(orgActRefusal(restricted)).toBe("dunning_restricted");
  });

  it("a warning stage does NOT stop action — read-only starts at restricted", () => {
    // Blocking at 'warning' would cut off a customer who is merely late, which
    // is the over-correction this axis is easy to make.
    expect(orgMayAct({ subscriptionStatus: "active", dunningStage: "warning" })).toBe(true);
  });

  it("a non-active status stops action on its own", () => {
    for (const status of ["paused", "cancelled", "past_due", "", null]) {
      expect(
        orgMayAct({ subscriptionStatus: status, subscriptionPaused: false }),
        `status=${String(status)} should not permit action`,
      ).toBe(false);
    }
  });

  it("AN ELAPSED PAUSE IS NOT A PAUSE", () => {
    // The resume worker runs hourly, so between expiry and the next tick the
    // flag is still true while the customer is entitled to act. The HTTP gate
    // always read it this way; the jobs now do too, or a customer whose pause
    // ended at 09:05 would sit out every pass until 10:00 for no reason.
    const now = Date.parse("2026-08-18T10:00:00Z");
    const elapsed = {
      subscriptionStatus: "active",
      subscriptionPaused: true,
      subscriptionPauseEndsAt: "2026-08-18T09:05:00Z",
    };
    expect(orgMayAct(elapsed, now)).toBe(true);

    const stillOpen = { ...elapsed, subscriptionPauseEndsAt: "2026-08-18T11:00:00Z" };
    expect(orgMayAct(stillOpen, now)).toBe(false);

    // A pause with no end date stays in force — an open-ended pause is a pause.
    expect(orgMayAct({ subscriptionStatus: "active", subscriptionPaused: true }, now)).toBe(false);
  });

  it("reports the reason the customer would recognise when axes overlap", () => {
    // An elected pause outranks a dunning state: the customer chose one.
    expect(
      orgActRefusal({ subscriptionStatus: "active", subscriptionPaused: true, dunningStage: "restricted" }),
    ).toBe("subscription_paused");
  });
});

describe("the rule is not hand-copied", () => {
  /**
   * Sites that ACT on a customer's behalf. Each must select through the
   * predicate; a raw `subscriptionStatus` comparison here is the drift that
   * caused the defect.
   */
  const ACTING_SITES = [
    "server/services/paxNudges.ts",
    "server/jobs/autonomousDealMachine.ts",
    "server/jobs/growthAutomation.ts",
    "server/jobs/lifecycleDispatch.ts",
  ];

  /**
   * Sites that COUNT customers rather than act for them. These deliberately
   * keep their own filter — "may we act for this org" is not "is this org a
   * live customer", and a compliance audit or revenue rollup that skipped
   * paused accounts would be wrong in the opposite direction.
   *
   * Listed, not merely excluded, so that adding a site here is a decision
   * somebody makes on purpose.
   */
  const COUNTING_SITES = [
    "server/jobs/founderWeeklyDigest.ts",
    "server/services/outcomeAnalyzer.ts",
    "server/services/fairLendingAudit.ts",
    "server/services/solene/continuousLoop.ts",
    "server/routes-founder-bridge.ts",
    "server/routes-founder-intelligence.ts",
  ];

  it("every acting site selects through orgMayActFilter", () => {
    for (const f of ACTING_SITES) {
      expect(codeOf(f), `${f} does not use the shared predicate`).toContain("orgMayActFilter");
    }
  });

  it("NO acting site still hand-writes the status fragment", () => {
    // The semantic check, not a name check: what matters is that the raw
    // comparison is gone from the files that act, whatever it is spelled.
    const offenders: string[] = [];
    for (const f of ACTING_SITES) {
      const src = codeOf(f);
      for (const m of src.matchAll(/organizations\.subscriptionStatus\s*,\s*["']active["']/g)) {
        offenders.push(`${f}: ${m[0]}`);
      }
    }
    expect(
      offenders,
      "an acting site re-typed `subscriptionStatus = active`. A hand-copied " +
        "fragment of the operating rule goes stale the day the rule grows " +
        "another axis — which is exactly how the pause became invisible to " +
        "every background job.",
    ).toEqual([]);
  });

  it("the acting/counting split is real, and the counting sites still exist", () => {
    // Vacuity guard with teeth. If a counting site were quietly converted, the
    // predicate would start suppressing analytics for paused customers — the
    // mirror-image error — and no other assertion here would notice.
    for (const f of COUNTING_SITES) {
      expect(fs.existsSync(path.join(ROOT, f)), `${f} moved; re-adjudicate it`).toBe(true);
      expect(
        codeOf(f),
        `${f} is listed as a COUNTING site but now selects through orgMayActFilter. ` +
          "A paused org is still a customer: analytics, revenue and compliance " +
          "audits must keep counting it.",
      ).not.toContain("orgMayActFilter");
    }
  });

  it("no acting site spells the dunning rule itself", () => {
    // The stage list is deliberately NOT exported. An earlier draft exported it
    // purely so this test could compare against it — the "exists only for its
    // test" shape — and the reachability gate said so. The behaviour is
    // asserted above instead; here we only check that no acting site
    // re-implements the axis.
    for (const f of ACTING_SITES) {
      expect(codeOf(f)).not.toContain("dunningStage");
    }
  });

  it("the HTTP gate and the jobs share ONE predicate", () => {
    // The whole point. The pause decision lived only in the HTTP path, which a
    // cron never traverses; that is how the gate could promise "no new actions"
    // while fifteen background queries kept acting.
    expect(codeOf("server/middleware/subscriptionPauseGate.ts")).toContain("orgActRefusal");
  });
});

describe("a resume restores the whole pause, not half of it", () => {
  // BEHAVIOURAL, not a source scan. These began as greps over
  // runScheduledJobs.ts and broke the moment the body was extracted — which is
  // the tell that they were asserting on a location rather than on what the
  // code does. They now run the real function against a fake db and read the
  // update it issues.

  async function runResume(row: Record<string, unknown>) {
    vi.resetModules();
    const updates: Record<string, unknown>[] = [];
    vi.doMock("../../server/db", () => ({
      db: {
        select: () => ({
          from: () => ({ where: () => ({ limit: async () => [row] }) }),
        }),
        update: () => ({
          set: (values: Record<string, unknown>) => {
            updates.push(values);
            return { where: async () => undefined };
          },
        }),
      },
    }));
    const { resumeExpiredPauses } = await import("../../server/jobs/resumeExpiredPauses");
    await resumeExpiredPauses({ logLine: () => {} });
    return updates;
  }

  it("lifts a webhook-written 'paused' status, not just the pause columns", async () => {
    // webhookHandlers writes `subscriptionStatus: 'paused'`; this worker used to
    // clear only the four pause columns, so an expired pause left the org
    // 'paused' FOREVER to every background filter while the product told the
    // customer they had resumed. Half a resume is invisible from both sides.
    const [update] = await runResume({
      id: 7,
      stripeSubscriptionId: null,
      subscriptionStatus: "paused",
    });

    expect(update.subscriptionPaused).toBe(false);
    expect(update.subscriptionPauseEndsAt).toBeNull();
    expect(
      update.subscriptionStatus,
      "the resume did not lift the status, so the org stays invisible to every job",
    ).toBe("active");
  });

  it("does NOT resurrect a subscription that ended during the pause", async () => {
    // The guard on the restore: this worker ends a pause, it does not grant a
    // subscription. Without it, a cancellation mid-pause would be undone by a
    // maintenance job.
    for (const ended of ["cancelled", "past_due"]) {
      const [update] = await runResume({
        id: 9,
        stripeSubscriptionId: null,
        subscriptionStatus: ended,
      });
      expect(update.subscriptionPaused).toBe(false);
      expect(
        "subscriptionStatus" in update,
        `a ${ended} subscription was reactivated by the pause-resume worker`,
      ).toBe(false);
    }
  });
});
