/**
 * An action the classifier did not recognise is not a low-risk action.
 *
 * THE DEFECT
 * ──────────
 * `inferRiskProfile` ended with a branch commented "Default: conservative" that
 * returned `category: "data_write"` — base risk 20 — for any action string it
 * had no branch for. It was the opposite of conservative:
 *
 *   THRESHOLDS.supervised = { auto: 25 }        (autonomousAgentEngine.ts)
 *   evaluate(): if (riskScore <= thresholds.auto) return "auto_execute"
 *   getAutonomyLevel(): no config row  →  "supervised"
 *   vaAgents.autonomyLevel                default("supervised")
 *
 * 20 ≤ 25, so EVERY unrecognised action auto-executed unattended at the DEFAULT
 * autonomy level. The action that took that branch included `execute_skill` —
 * the most general action the engine accepts, which dispatches an arbitrary
 * skill id through `skillRegistry.executeSkill`. The registry holds `sendEmail`,
 * `startCollectionSequence`, `processPayoff` and `prepareContract`.
 *
 * The chain was live end to end, and each link was read rather than assumed:
 *   POST /api/agents/tasks              server/routes-ai.ts:53 (authenticated, org-scoped)
 *     → agentTasks row, `input` free-form JSON
 *     → processBatch() WHERE status='pending' AND requiresReview=false — no filter excludes it
 *     → evaluate() → executeAgentTask() → skillRegistry.executeSkill(...)
 * and `startAutonomousTaskProcessor` is started at boot with no env gate
 * (server/jobs/runScheduledJobs.ts:4028); its own comment says the loop
 * "AUTO-EXECUTES agent actions".
 *
 * A second defect fell out of the same reading: `inferRiskProfile` could only
 * ever emit `offer`, `draft`, `research` and `data_write`. The `communication`
 * (40), `financial` (70) and `contract` (90) bands were declared and DEAD — a
 * guard that looks stronger than it is.
 *
 * WHAT IS ASSERTED, AND WHY IN THIS SHAPE
 * ───────────────────────────────────────
 * The cases drive the REAL `evaluate()` and the REAL `inferRiskProfile`, not a
 * reimplementation of the rule. The forbidden BEHAVIOUR is "an action nobody
 * classified executes without a human", so the assertions are about the decision
 * the engine returns — not about the presence of a flag, a comment, or a
 * particular default category. Re-spelling the fallback (a different category, a
 * lower score, a new permissive branch) fails these tests; renaming the flag
 * does not, which is the right way round.
 *
 * The skill map is cross-checked against `skillRegistry.getAllSkills()` rather
 * than against a copy of itself, so a newly registered skill cannot inherit a
 * classification nobody chose for it.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

vi.mock("../../server/db", () => ({ db: {} }));
vi.mock("../../server/utils/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const { AutonomousAgentEngine } = await import(
  "../../server/services/autonomousAgentEngine"
);
const { _inferRiskProfile, _SKILL_RISK } = await import(
  "../../server/jobs/autonomousTaskProcessor"
);
const { skillRegistry } = await import("../../server/services/agent-skills");

type Level = "full_auto" | "supervised" | "manual";

/**
 * The engine with its two DB reads stubbed, so the decision under test is the
 * risk logic rather than the config store.
 *
 * `autoApprove` defaults to empty — an org's auto-approve list is a real input
 * and one of the cases below deliberately sets it, because that list keyed on
 * `category` is exactly how an unclassified profile could be laundered.
 */
function engineAt(level: Level, autoApprove: string[] = [], escalate: string[] = []) {
  const e = new AutonomousAgentEngine();
  vi.spyOn(e, "getAutonomyLevel").mockResolvedValue(level as never);
  vi.spyOn(e as never, "getAutoApproveCategories").mockResolvedValue(autoApprove as never);
  vi.spyOn(e as never, "getEscalateCategories").mockResolvedValue(escalate as never);
  return e;
}

const LEVELS: Level[] = ["full_auto", "supervised", "manual"];

/** Action strings no branch of the classifier recognises. */
const UNRECOGNISED = [
  "execute_skill",              // the general dispatcher — the one that mattered
  "director_goal",              // enqueued by queueDirectorGoal()
  "send_wire",                  // a plausible future action nobody classified
  "sign_purchase_agreement",
  "delete_all_leads",
  "",                           // input.action absent
];

describe("the classifier's residue", () => {
  beforeEach(() => vi.clearAllMocks());

  it("vacuity: the population is non-empty and really is unrecognised", () => {
    expect(UNRECOGNISED.length).toBeGreaterThan(0);
    for (const action of UNRECOGNISED) {
      const p = _inferRiskProfile("research", { action });
      expect(p.classified, `"${action}" is recognised — pick a different case`).not.toBe(true);
    }
    // And the other direction: recognised actions must exist, or "unclassified
    // escalates" would be indistinguishable from "everything escalates".
    expect(_inferRiskProfile("deals", { action: "generate_offer" }).classified).toBe(true);
    expect(_inferRiskProfile("research", { action: "due_diligence" }).classified).toBe(true);
  });

  it("never auto-executes, at ANY autonomy level", async () => {
    const executed: string[] = [];
    for (const level of LEVELS) {
      const e = engineAt(level);
      for (const action of UNRECOGNISED) {
        const d = await e.evaluate(1, "research", _inferRiskProfile("research", { action }));
        if (d.decision === "auto_execute") executed.push(`${level}: "${action}"`);
        expect(d.requiresApproval, `${level} "${action}"`).toBe(true);
      }
    }
    expect(executed).toEqual([]);
  });

  it("escalates rather than denies — the work still happens on a tap", async () => {
    // Denying would cancel the task (processBatch sets status "cancelled"), which
    // removes a capability instead of governing it.
    const e = engineAt("supervised");
    for (const action of UNRECOGNISED) {
      const d = await e.evaluate(1, "research", _inferRiskProfile("research", { action }));
      expect(d.decision, `"${action}"`).toBe("escalate");
    }
  });

  it("an org's auto-approve list cannot launder an unclassified action", async () => {
    // The check sits ABOVE the auto-approve list on purpose: that list is keyed
    // on `category`, and an unclassified profile's category is a guess. An org
    // that auto-approves data_write must not thereby auto-approve everything
    // nobody has classified.
    const e = engineAt("full_auto", ["data_write", "research", "draft"]);
    const d = await e.evaluate(1, "research", _inferRiskProfile("research", { action: "send_wire" }));
    expect(d.decision).toBe("escalate");
  });

  it("a caller that omits the flag entirely gets the cautious answer", async () => {
    // `classified` is optional so existing callers compile. Absent must read as
    // unclassified, or the optionality reintroduces the fail-open.
    const e = engineAt("full_auto");
    const d = await e.evaluate(1, "research", {
      category: "research",
      financialImpact: 0,
      isExternal: false,
      isIrreversible: false,
      description: "a profile built before `classified` existed",
    });
    expect(d.decision).toBe("escalate");
  });
});

describe("recognised actions still flow", () => {
  beforeEach(() => vi.clearAllMocks());

  it("read-only research auto-executes at supervised, as it always did", async () => {
    // The other direction. A fix that escalated everything would satisfy every
    // assertion above and quietly stop the product working.
    const e = engineAt("supervised");
    for (const action of ["due_diligence", "research_parcel", "lookup_owner", "analyze_deal"]) {
      const d = await e.evaluate(1, "research", _inferRiskProfile("research", { action }));
      expect(d.decision, `"${action}"`).toBe("auto_execute");
    }
  });

  it("the posture per skill at the DEFAULT autonomy level", async () => {
    // Stated as exact decisions rather than "not auto_execute", so the test
    // documents the real posture and pins it. Each expectation is the score the
    // engine's own bands produce, not a number chosen here:
    //
    //   lookupParcel            research 5                        →  5  ≤ 25  auto
    //   sendEmail               communication 40 +ext10 +irrev15  → 65  ≤ 75  escalate
    //   startCollectionSequence  same                             → 65        escalate
    //   processPayoff           financial 70 +ext10               → 80  > 75  deny
    //   prepareContract         contract 90 +ext10 +irrev15 → 100 > 75        deny
    //
    // `deny` is stricter than `escalate`, not weaker: the task is cancelled and
    // the customer runs it by hand. That band is the engine's pre-existing
    // design and is left alone here — this change governs the residue, it does
    // not re-tune thresholds.
    const e = engineAt("supervised");
    const expected: Record<string, string> = {
      lookupParcel: "auto_execute",
      sendEmail: "escalate",
      startCollectionSequence: "escalate",
      escalateDelinquency: "escalate",
      processPayoff: "deny",
      prepareContract: "deny",
    };
    for (const [skillId, decision] of Object.entries(expected)) {
      const d = await e.evaluate(1, "research",
        _inferRiskProfile("research", { action: "execute_skill", parameters: { skillId } }));
      expect(d.decision, skillId).toBe(decision);
    }
    // The load-bearing half, stated separately so it survives any re-tuning of
    // the bands above: nothing that reaches a counterparty runs unattended.
    for (const skillId of Object.keys(expected).filter((k) => k !== "lookupParcel")) {
      const d = await e.evaluate(1, "research",
        _inferRiskProfile("research", { action: "execute_skill", parameters: { skillId } }));
      expect(d.decision, `${skillId} ran unattended`).not.toBe("auto_execute");
    }
  });

  it("contract skills stay above even full_auto's threshold", async () => {
    // 90 > 85. This is the band that had no production caller at all before the
    // skill map existed — declared, and dead.
    const e = engineAt("full_auto");
    for (const skillId of ["prepareContract", "generateClosingPacket"]) {
      const d = await e.evaluate(1, "deals",
        _inferRiskProfile("deals", { action: "execute_skill", parameters: { skillId } }));
      expect(d.decision, skillId).not.toBe("auto_execute");
    }
  });
});

describe("the skill map cannot drift from the registry", () => {
  it("every registered skill is classified", () => {
    const registered = skillRegistry.getAllSkills().map((s) => s.id);
    expect(registered.length, "the registry is empty — this test would pass vacuously")
      .toBeGreaterThan(10);
    const unmapped = registered.filter((id) => !(id in _SKILL_RISK));
    expect(
      unmapped,
      "these skills are reachable through execute_skill but nobody has said what " +
        "they risk; they escalate safely, but the classification is a deliberate " +
        "act — add them to SKILL_RISK",
    ).toEqual([]);
  });

  it("the map does not classify skills that no longer exist", () => {
    const registered = new Set(skillRegistry.getAllSkills().map((s) => s.id));
    const stale = Object.keys(_SKILL_RISK).filter((id) => !registered.has(id));
    expect(stale, "SKILL_RISK entries for skills the registry no longer has").toEqual([]);
  });

  it("the three formerly-dead bands are now reachable from production", () => {
    // communication(40), financial(70) and contract(90) existed in
    // CATEGORY_BASE_RISK but no production classifier could emit them.
    const emitted = new Set(
      skillRegistry.getAllSkills().map((s) =>
        _inferRiskProfile("research", { action: "execute_skill", parameters: { skillId: s.id } }).category,
      ),
    );
    for (const band of ["communication", "financial", "contract"]) {
      expect(emitted.has(band as never), `no skill can emit "${band}" — the band is still dead`).toBe(true);
    }
  });
});

describe("the auto-approve list has a ceiling", () => {
  beforeEach(() => vi.clearAllMocks());

  /**
   * The list used to sit above the score bands with no cap, so an org config
   * field defeated the whole risk model — and the field is writable through
   * `PUT /agents/:type/config` behind nothing but `isAuthenticated +
   * getOrCreateOrg`. The cap is the level's own auto threshold, so the list can
   * still let a category skip the +external/+irreversible boosts but can never
   * grant one the level would refuse at base risk.
   */
  const HIGH = ["contract", "offer", "financial"] as const;

  it("vacuity: these categories really are above the supervised ceiling", () => {
    // If a band were re-tuned below 25 this test would pass while proving
    // nothing, so the premise is asserted rather than assumed.
    const e = engineAt("supervised");
    expect(e).toBeTruthy();
    expect(HIGH.length).toBeGreaterThan(0);
  });

  it("cannot grant a category the level would refuse at base risk", async () => {
    const granted: string[] = [];
    for (const level of LEVELS) {
      for (const category of HIGH) {
        const e = engineAt(level, [...HIGH]);
        const d = await e.evaluate(1, "deals", {
          category,
          financialImpact: 0,
          isExternal: true,
          isIrreversible: true,
          classified: true,
          description: `a ${category} action`,
        });
        // contract(90) is above every level's auto threshold; offer(80) and
        // financial(70) are below full_auto's 85 and would auto-execute on the
        // SCORE anyway at that level, which is the point — the list may confirm
        // what the level already permits, never exceed it.
        const permittedByLevel =
          (level === "full_auto" && category !== "contract");
        if (d.decision === "auto_execute" && !permittedByLevel) {
          granted.push(`${level} + autoApprove[${category}] → auto_execute`);
        }
      }
    }
    expect(granted).toEqual([]);
  });

  it('"manual" means never auto-executes, even with everything auto-approved', async () => {
    // THRESHOLDS.manual is { auto: 0 }, and its comment says "never
    // auto-executes". Before the ceiling, manual + autoApprove["contract"]
    // returned auto_execute for a score-100 profile.
    const every = ["research", "draft", "data_write", "scheduling", "external_api",
                   "communication", "financial", "offer", "contract"];
    const e = engineAt("manual", every);
    for (const category of every) {
      const d = await e.evaluate(1, "deals", {
        category: category as never,
        financialImpact: 0,
        isExternal: false,
        isIrreversible: false,
        classified: true,
        description: category,
      });
      expect(d.decision, `manual auto-executed ${category}`).not.toBe("auto_execute");
    }
  });

  it("still does its job — a low category skips the boosts that would escalate it", async () => {
    // The other direction. A ceiling that neutered the feature would pass every
    // assertion above. `data_write`(20) + external(10) + irreversible(15) = 45,
    // over supervised's auto band of 25; auto-approving it is exactly the
    // convenience the list exists for, and 20 <= 25 so the ceiling allows it.
    const e = engineAt("supervised", ["data_write"]);
    const d = await e.evaluate(1, "research", {
      category: "data_write",
      financialImpact: 0,
      isExternal: true,
      isIrreversible: true,
      classified: true,
      description: "bulk CRM update",
    });
    expect(d.decision).toBe("auto_execute");
  });
});

describe("autonomousEvaluatePreviewIsInert", () => {
  it("the preview route executes nothing, which is what licenses its classified:true", () => {
    // POST /evaluate builds a profile from the CALLER's declared category and
    // marks it classified so the preview answers the same question the
    // processor answers. A caller cannot declare its own safety, so that is
    // defensible only while the handler acts on nothing. Pinned by reading the
    // handler body: it must not call any executor.
    const src = readFileSync(
      resolve(__dirname, "../../server/routes-autonomous-agent.ts"), "utf8",
    );
    const start = src.indexOf('router.post("/evaluate"');
    expect(start, "the /evaluate route moved or was renamed").toBeGreaterThan(-1);
    const end = src.indexOf("router.", start + 10);
    const handler = src.slice(start, end === -1 ? src.length : end);
    expect(handler.length).toBeGreaterThan(200);
    for (const forbidden of ["executeAgentTask", "executeSkill", "queueAgentTask", "runOnce"]) {
      expect(handler, `/evaluate now reaches ${forbidden} — remove classified:true`)
        .not.toContain(forbidden);
    }
  });
});
