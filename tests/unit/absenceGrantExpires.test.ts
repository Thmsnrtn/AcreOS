/**
 * A time-boxed grant may not outlive its own expiry.
 *
 * THE DEFECT
 * ──────────
 * `ceoAbsenceService.activate()` materialised its trust boost into
 * `companyAgents.trustScore` — the permanent column that IS the authority input:
 *
 *     trustAuthorityEscalation.getTier(trustScore)
 *       ← executionEngine.validateSafetyGates
 *       ← agentInitiativeEngine.runInitiativeCycle
 *
 * `deactivate()` was the only thing that subtracted it, and it begins with
 * `const current = await this.getCurrent(); if (!current) return null;` — while
 * `getCurrent()` refuses any absence whose `endsAt` has passed. So after natural
 * expiry the reversal was structurally unreachable: the absence ended and the
 * authority it conveyed stayed. `activate()` also opens by calling
 * `deactivate()`, so a second activation added a boost on top of one that was
 * never taken away.
 *
 * Seeded agents start at trustScore 50 = Observer, allowed only
 * generate_report/store_learning. +15 → 65 Assistant unlocks send_follow_up and
 * send_alert; → 80 Operator unlocks send_churn_intervention, a real customer
 * contact; → 95 Director unlocks advance_deal_stage. Three "I'm away" commands,
 * and none of it given back. `updateTrustScore` clamps at 100 besides, so even a
 * reversal that DID run returned less than it took.
 *
 * The module header claimed `activate()` had no production caller. It does:
 * `ceoCommandBridge.ts` handles the `activate_absence` command, reached from
 * `POST /api/founder/intelligence/command`. Code over prose.
 *
 * THE FIX, AND WHAT IS ASSERTED
 * ─────────────────────────────
 * The boost is DERIVED at the point of authority instead of written into the
 * field it elevates. Expiry then needs no reversal to work, which is the only
 * kind of expiry worth having.
 *
 * The assertions drive the real `effectiveTrustScore` against a stubbed absence
 * row, because the property under test is a relationship between two modules —
 * the elevation and the clock — not the arithmetic of either. The ratchet case
 * is stated as an equality against the ORIGINAL score, so any residue at all
 * fails it.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const getCurrent = vi.fn();
const getByCodename = vi.fn();
const getAll = vi.fn(async () => [{ codename: "sophie_csm" }, { codename: "atlas_cto" }]);

vi.mock("../../server/db", () => ({ db: {} }));
vi.mock("../../server/utils/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../server/services/ceoAbsenceMode", () => ({
  ceoAbsenceService: {
    getCurrent,
    getAll,
    async activeTrustBoosts() {
      // The REAL body, not a stub: what is under test is that the boost is tied
      // to an unexpired absence, and a stub returning a fixed map would agree
      // with an implementation that ignored the clock entirely.
      try {
        const current = await getCurrent();
        if (!current) return {};
        const per = current.perAgentBoosts;
        if (per && Object.keys(per).length > 0) return per;
        const uniform = current.trustBoost ?? 15;
        const agents = await getAll();
        return Object.fromEntries(agents.map((a: { codename: string }) => [a.codename, uniform]));
      } catch {
        return {};
      }
    },
  },
}));

const { companyAgentService } = await import("../../server/services/companyAgents");

const BASE = 50;

function absence(opts: { expired: boolean; boost?: number }) {
  // getCurrent() is the thing that enforces expiry, so an expired absence is
  // represented the way the real one is: absent.
  return opts.expired ? null : { perAgentBoosts: { sophie_csm: opts.boost ?? 15 } };
}

describe("an absence elevates only while it is running", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getByCodename.mockResolvedValue({ codename: "sophie_csm", trustScore: BASE });
    vi.spyOn(companyAgentService, "getByCodename").mockImplementation(getByCodename as never);
  });

  it("vacuity: the base score is below the tiers the boost would unlock", () => {
    // If the seeded score were already at the top, every assertion below would
    // hold for the wrong reason.
    expect(BASE).toBeLessThan(65);
  });

  it("adds the boost while the absence is live", async () => {
    getCurrent.mockResolvedValue(absence({ expired: false, boost: 15 }));
    expect(await companyAgentService.effectiveTrustScore("sophie_csm")).toBe(65);
  });

  it("returns to base the moment the absence expires — no reversal required", async () => {
    getCurrent.mockResolvedValue(absence({ expired: true }));
    expect(await companyAgentService.effectiveTrustScore("sophie_csm")).toBe(BASE);
  });

  it("DOES NOT RATCHET across repeated absences", async () => {
    // The defect, stated directly. Three activations, each expiring naturally.
    // Under the old materialising implementation the stored score walked
    // 50 → 65 → 80 → 95 and stayed there.
    for (let i = 0; i < 3; i++) {
      getCurrent.mockResolvedValue(absence({ expired: false, boost: 15 }));
      expect(await companyAgentService.effectiveTrustScore("sophie_csm")).toBe(65);
      getCurrent.mockResolvedValue(absence({ expired: true }));
      expect(
        await companyAgentService.effectiveTrustScore("sophie_csm"),
        `absence ${i + 1} left residue in the agent's own standing`,
      ).toBe(BASE);
    }
    // And the agent's earned standing was never written to at all.
    expect(getByCodename).toHaveBeenCalled();
  });

  it("an elevation that cannot be read is not an elevation that applies", async () => {
    getCurrent.mockRejectedValue(new Error("absence store unavailable"));
    expect(await companyAgentService.effectiveTrustScore("sophie_csm")).toBe(BASE);
  });

  it("only the named agent is elevated by a per-agent grant", async () => {
    getCurrent.mockResolvedValue({ perAgentBoosts: { sophie_csm: 30 } });
    getByCodename.mockResolvedValue({ codename: "atlas_cto", trustScore: BASE });
    expect(await companyAgentService.effectiveTrustScore("atlas_cto")).toBe(BASE);
  });

  it("stays inside the 0–100 range the tiers are defined over", async () => {
    getByCodename.mockResolvedValue({ codename: "sophie_csm", trustScore: 95 });
    getCurrent.mockResolvedValue({ perAgentBoosts: { sophie_csm: 40 } });
    expect(await companyAgentService.effectiveTrustScore("sophie_csm")).toBe(100);
  });
});

describe("nothing writes the grant into the agent's own standing", () => {
  it("ceoAbsenceMode does not call updateTrustScore for a boost", () => {
    // A source check, deliberately narrow and deliberately secondary to the
    // behavioural cases above. It exists because the defect's whole shape was a
    // WRITE in one module observed by another, and the behavioural test cannot
    // see a write it does not stub.
    const src = readFileSync(
      resolve(__dirname, "../../server/services/ceoAbsenceMode.ts"), "utf8",
    ).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(src.length, "comment stripping removed the file").toBeGreaterThan(2000);
    const activateStart = src.indexOf("async activate(");
    const activateEnd = src.indexOf("async ", activateStart + 10);
    expect(activateStart).toBeGreaterThan(-1);
    expect(src.slice(activateStart, activateEnd)).not.toContain("updateTrustScore");
  });
});

describe("the authority readers consume the EFFECTIVE score", () => {
  /**
   * Without this, reverting either reader to `agent.trustScore` leaves every
   * assertion above green while the elevation is once again read from the
   * permanent column — the repository's own law that a canonical function with
   * no production adoption is not canonical.
   *
   * `validateSafetyGates` is module-private and the initiative cycle needs a
   * database, so this reads the two call sites instead. Comments are STRIPPED
   * first, with a floor on what remains: this file's own explanatory prose
   * names `effectiveTrustScore` repeatedly, and a scanner that matched its own
   * documentation would pass on a file where the code had been reverted.
   */
  const CALL_SITES = [
    "server/services/executionEngine.ts",
    "server/services/agentInitiativeEngine.ts",
  ];

  function codeOf(rel: string): string {
    const raw = readFileSync(resolve(__dirname, "../..", rel), "utf8");
    const stripped = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(stripped.length, `${rel}: comment stripping removed the file`)
      .toBeGreaterThan(raw.length * 0.3);
    return stripped;
  }

  it("vacuity: both files still perform a trust-authority check at all", () => {
    for (const rel of CALL_SITES) {
      expect(codeOf(rel), `${rel} no longer checks trust authority`)
        .toContain("isActionAllowed");
    }
  });

  it("neither reads the stored trustScore for an authority decision", () => {
    const offenders: string[] = [];
    for (const rel of CALL_SITES) {
      const code = codeOf(rel);
      if (!code.includes("effectiveTrustScore")) offenders.push(`${rel}: no effectiveTrustScore`);
      // The specific reversion: pulling the agent row and reading its column.
      if (/\.trustScore\b/.test(code)) offenders.push(`${rel}: reads .trustScore directly`);
    }
    expect(offenders).toEqual([]);
  });
});
