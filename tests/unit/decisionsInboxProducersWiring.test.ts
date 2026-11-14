/**
 * Per-producer behaviour of the decisions-inbox throttle.
 *
 * The producers are too entangled (AI calls, Stripe, pg locks, fs) to run whole
 * in a unit test, so this suite tests at the SEAM the design names: each
 * producer's exact throttle inputs (producer id, subjectKey, conditionKey,
 * class — copied from its call site) are pushed through the REAL throttle
 * module over an in-memory backend, counting how many times the producer's
 * insert callback runs. The throttle is never mocked.
 *
 * A producer whose inputs drift from the builders below is caught by the
 * "seam fidelity" test, which parses each producer file and checks the call
 * site still names the producer id this suite simulates and calls
 * raiseIfAllowed.
 */
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../server/db", () => ({ db: {} }));
vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  canonicalJson,
  canonicalSetJson,
  createThrottle,
  type ThrottleInput,
} from "../../server/services/decisionsInboxThrottle";
import { stripComments } from "../helpers/stripComments";
import { createMemoryBackend, type MemoryBackend } from "../helpers/inMemoryThrottleBackend";

const DAY = 24 * 60 * 60 * 1000;
const T0 = new Date("2026-11-09T06:00:00.000Z");
const REPO = path.resolve(__dirname, "../..");

let mem: MemoryBackend;
let now: Date;
let th: ReturnType<typeof createThrottle>;
let inserts: number;

beforeEach(() => {
  mem = createMemoryBackend();
  now = new Date(T0);
  th = createThrottle({ backend: mem.backend, now: () => now });
  inserts = 0;
});

const advance = (ms: number) => {
  now = new Date(now.getTime() + ms);
};
/** The producer's write site: insert callback guarded exactly as in production. */
const runProducer = async (i: ThrottleInput) => {
  const out = await th.raiseIfAllowed(i, async () => {
    inserts += 1;
  });
  return out;
};

// ---- throttle inputs, one builder per producer (mirror of the call sites) ----

const schemaDrift = (missing: Array<{ kind: string; table: string; column?: string }>, orphans: number): ThrottleInput => ({
  producer: "schema_drift",
  subjectKey: "schema_drift",
  conditionKey: canonicalJson({
    missing: canonicalSetJson(missing.map((f) => `${f.kind}:${f.table}${f.column ? `.${f.column}` : ""}`)),
    orphanBucket: Math.floor(orphans / 20),
  }),
  class: missing.length > 0 ? "critical" : "standard",
});

const stripeDrift = (findings: Array<{ kind: string; acreosKey?: string; actualCents?: number; severity: string }>): ThrottleInput => ({
  producer: "stripe_drift",
  subjectKey: "stripe_drift",
  conditionKey: canonicalSetJson(findings.map((f) => `${f.kind}:${f.acreosKey ?? ""}:${f.actualCents ?? ""}`)),
  class: findings.some((f) => f.severity === "critical") ? "critical" : "standard",
});

const pillar = (stale: number, dead: number): ThrottleInput => ({
  producer: "pillar_review",
  subjectKey: "pillar_review",
  conditionKey: `${stale}:${dead}`,
  class: "standard",
});

const vendor = (name: string, status: "warning" | "expired"): ThrottleInput => ({
  producer: "vendor_secret_rotation",
  subjectKey: name,
  conditionKey: status,
  class: status === "expired" ? "critical" : "standard",
});

const retract = (agent: string, category: string, ref: string, suspended: boolean): ThrottleInput => ({
  producer: "agent_retract",
  subjectKey: `${agent}:${category}:${ref}`,
  conditionKey: String(suspended),
  class: suspended ? "critical" : "standard",
});

const initiative = (
  orgId: number,
  agent: string,
  action: string,
  input: Record<string, unknown>,
  type: string,
  blocked: string,
): ThrottleInput => ({
  producer: "agent_initiative",
  subjectKey: canonicalJson({ orgId, agent, action, input }),
  conditionKey: canonicalJson({ type, autoExecuteBlocked: blocked }),
  class: "standard",
});

const authority = (
  owner: string,
  itemType: string,
  q: { action: string; input: Record<string, unknown>; relatedGoalId: number | null },
  level: number,
  allowed: boolean,
): ThrottleInput => ({
  producer: "agent_authority",
  subjectKey: canonicalJson({ owner, itemType, question: q }),
  conditionKey: canonicalJson({ effectiveLevel: level, allowed }),
  class: "standard",
});

const onboardingD7 = (orgId: number, journeyId: number): ThrottleInput => ({
  producer: "onboarding_autonomy",
  subjectKey: canonicalJson({ orgId, journeyId, trigger: "day7_stalled" }),
  conditionKey: "day7_stalled",
  class: "standard",
});
const onboardingD30 = (orgId: number, journeyId: number, status: string): ThrottleInput => ({
  producer: "onboarding_autonomy",
  subjectKey: canonicalJson({ orgId, journeyId, trigger: "day30_verdict" }),
  conditionKey: status,
  class: "standard",
});

const dlq = (eventType: string, cnt: number): ThrottleInput => ({
  producer: "dlq_poison_job",
  subjectKey: eventType,
  conditionKey: `depth_log2:${Math.floor(Math.log2(Math.max(1, cnt)))}`,
  class: "standard",
});

describe("decisions inbox producers — behaviour through the real throttle", () => {
  it("schema_drift: unchanged missing-set twice → 1 card; changed missing-set → +1; orphan bucket change → +1, same bucket → 0", async () => {
    const m1 = [{ kind: "missing_column", table: "leads", column: "foo" }];
    await runProducer(schemaDrift(m1, 5));
    advance(DAY);
    await runProducer(schemaDrift(m1, 5));
    expect(inserts).toBe(1);
    advance(DAY);
    await runProducer(schemaDrift([...m1, { kind: "missing_table", table: "widgets" }], 5));
    expect(inserts).toBe(2);
    // orphans-only (standard class): bucket 0 → 1 is material, 20 → 25 is not
    advance(DAY);
    await runProducer(schemaDrift([], 20));
    expect(inserts).toBe(3);
    advance(DAY);
    await runProducer(schemaDrift([], 25));
    expect(inserts).toBe(3);
  });

  it("stripe_drift: a critical finding repeated daily for 8 days → 2 cards (day 1, day 8)", async () => {
    const f = [{ kind: "price_mismatch", acreosKey: "pro_monthly", actualCents: 4900, severity: "critical" }];
    for (let d = 0; d < 8; d += 1) {
      await runProducer(stripeDrift(f));
      advance(DAY);
    }
    expect(inserts).toBe(2);
    // reordered identical findings are not a new condition
    advance(DAY);
    const two = [
      { kind: "orphan", acreosKey: "a", severity: "low" },
      { kind: "orphan", acreosKey: "b", severity: "low" },
    ];
    await runProducer(stripeDrift(two));
    await runProducer(stripeDrift([...two].reverse()));
    expect(inserts).toBe(3);
  });

  it("pillar_review: unchanged counts → 1; changed counts → +1; same counts a month later → +1 (cooldown elapsed)", async () => {
    await runProducer(pillar(3, 1));
    advance(DAY);
    await runProducer(pillar(3, 1));
    expect(inserts).toBe(1);
    advance(DAY);
    await runProducer(pillar(4, 1));
    expect(inserts).toBe(2);
    advance(31 * DAY);
    await runProducer(pillar(4, 1));
    expect(inserts).toBe(3);
  });

  // Standard class is capped at 3 cards per producer per UTC day
  // (STANDARD_DAILY_CAP) and every vendor warning is standard, so the 4th
  // vendor is cap-suppressed on day 1 (no subject state written) and lands on
  // the next UTC day's cycle. Critical (expired) bypasses the cap.
  it("vendor_secret_rotation: warning is capped at 3/day — the 4th vendor lands next day; flip to expired lands immediately", async () => {
    const vendors = ["stripe", "twilio", "lob", "resend"];
    // Run 1 (day 1): 4 in warning → 3 inserts (cap)
    for (const v of vendors) await runProducer(vendor(v, "warning"));
    expect(inserts).toBe(3);
    // Run 2 (same UTC day): first three in same-condition cooldown, 4th cap-suppressed again → 0 more
    for (const v of vendors) await runProducer(vendor(v, "warning"));
    expect(inserts).toBe(3);
    // Next UTC day, run 3: the 4th lands; the other three stay in 30-day cooldown → +1
    advance(DAY);
    for (const v of vendors) await runProducer(vendor(v, "warning"));
    expect(inserts).toBe(4);
    // Flip an already-carded vendor warning → expired: condition changed, critical bypasses cap → +1
    await runProducer(vendor("stripe", "expired"));
    expect(inserts).toBe(5);
    // Same expired condition again the same day → 0 more
    await runProducer(vendor("stripe", "expired"));
    expect(inserts).toBe(5);
  });

  it("agent_retract: same agent/category/ref twice → 1; suspension is a material change → +1", async () => {
    await runProducer(retract("sophie", "email", "ref-1", false));
    await runProducer(retract("sophie", "email", "ref-1", false));
    expect(inserts).toBe(1);
    await runProducer(retract("sophie", "email", "ref-1", true));
    expect(inserts).toBe(2);
    await runProducer(retract("sophie", "email", "ref-2", false));
    expect(inserts).toBe(3);
  });

  it("agent_initiative: unchanged proposal twice → 1; changed trust state → +1; new subject → +1; per-day cap bounds a burst", async () => {
    const base = initiative(7, "sophie", "follow_up_lead", { leadId: 11 }, "opportunity", "low_confidence");
    await runProducer(base);
    advance(30 * 60 * 1000);
    await runProducer(base);
    expect(inserts).toBe(1);
    // same subject, key order of the actionInput must not matter
    await runProducer(initiative(7, "sophie", "follow_up_lead", { leadId: 11 }, "opportunity", "low_confidence"));
    expect(inserts).toBe(1);
    await runProducer(initiative(7, "sophie", "follow_up_lead", { leadId: 11 }, "opportunity", "insufficient_trust"));
    expect(inserts).toBe(2);
    await runProducer(initiative(7, "sophie", "follow_up_lead", { leadId: 12 }, "opportunity", "low_confidence"));
    expect(inserts).toBe(3);
    // cap: a 6-lead burst the same day adds nothing past the 3/day ceiling…
    for (let l = 100; l < 106; l += 1) {
      await runProducer(initiative(7, "sophie", "follow_up_lead", { leadId: l }, "opportunity", "low_confidence"));
    }
    expect(inserts).toBe(3);
    // …and the capped subjects land on the next day's cycle (no state was written for them)
    advance(DAY);
    for (let l = 100; l < 106; l += 1) {
      await runProducer(initiative(7, "sophie", "follow_up_lead", { leadId: l }, "opportunity", "low_confidence"));
    }
    expect(inserts).toBe(6);
  });

  it("agent_authority: skill (previously un-deduped) twice → 1; proactive twice → 1; nested key order is irrelevant", async () => {
    const skill = authority("sophie", "agent_recommendation", { action: "skill:x", input: { a: 1, b: [1, 2] }, relatedGoalId: null }, 1, false);
    await runProducer(skill);
    await runProducer(skill);
    expect(inserts).toBe(1);

    const pro1 = authority("forge", "agent_escalation", { action: "proactive:jobs", input: { source: "w", n: 48 }, relatedGoalId: null }, 0, false);
    const pro2 = authority("forge", "agent_escalation", { action: "proactive:jobs", input: { n: 48, source: "w" }, relatedGoalId: null }, 0, false);
    await runProducer(pro1);
    await runProducer(pro2);
    expect(inserts).toBe(2);

    // a changed effective level is a material change
    await runProducer(authority("forge", "agent_escalation", { action: "proactive:jobs", input: { source: "w", n: 48 }, relatedGoalId: null }, 2, true));
    expect(inserts).toBe(3);
  });

  it("onboarding_autonomy: day7 for two journeys of one org → 2; same journey replayed → 0; day30 verdict change → +1", async () => {
    await runProducer(onboardingD7(5, 101));
    await runProducer(onboardingD7(5, 102));
    expect(inserts).toBe(2);
    await runProducer(onboardingD7(5, 101));
    await runProducer(onboardingD7(5, 102));
    expect(inserts).toBe(2);
    advance(DAY);
    await runProducer(onboardingD30(5, 101, "at_risk"));
    await runProducer(onboardingD30(5, 101, "at_risk"));
    expect(inserts).toBe(3);
    await runProducer(onboardingD30(5, 101, "churned"));
    expect(inserts).toBe(4);
  });

  it("dlq_poison_job: same event type at the same depth magnitude → 1; an order of magnitude deeper → +1", async () => {
    await runProducer(dlq("billing.sync", 4));
    advance(60 * 60 * 1000);
    await runProducer(dlq("billing.sync", 7)); // log2 bucket 2 both
    expect(inserts).toBe(1);
    await runProducer(dlq("billing.sync", 9)); // bucket 3
    expect(inserts).toBe(2);
    await runProducer(dlq("email.send", 4)); // new subject
    expect(inserts).toBe(3);
  });

  it("residue refill: resolve-then-rerun cycles (the post-purge refill) add nothing beyond the first card", async () => {
    const cards: Array<{ status: string }> = [];
    const f = [{ kind: "price_mismatch", acreosKey: "pro", actualCents: 100, severity: "critical" }];
    const cycles = [schemaDrift([{ kind: "missing_column", table: "t", column: "c" }], 0), pillar(2, 2), vendor("lob", "warning"), stripeDrift(f)];
    for (let day = 0; day < 5; day += 1) {
      for (const i of cycles) {
        await th.raiseIfAllowed(i, async () => {
          cards.push({ status: "pending" });
        });
      }
      for (const c of cards) c.status = "purged"; // founder/executor/purge closes everything
      advance(DAY);
    }
    expect(cards).toHaveLength(cycles.length);
  });

  it("fail-open: a throwing guard still lets every producer's card land, without throwing", async () => {
    mem.flags.readFails = true;
    const inputs = [
      schemaDrift([{ kind: "missing_column", table: "t" }], 0), // critical
      stripeDrift([{ kind: "x", severity: "critical" }]), // critical
      pillar(1, 1),
      vendor("stripe", "expired"), // critical
      vendor("lob", "warning"),
      retract("a", "b", "c", true), // critical
      initiative(1, "a", "b", { x: 1 }, "t", "low_confidence"),
      authority("o", "agent_escalation", { action: "a", input: {}, relatedGoalId: null }, 0, false),
      onboardingD7(1, 1),
      dlq("e", 2),
    ];
    for (const i of inputs) {
      const out = await runProducer(i);
      expect(out.inserted).toBe(true);
      expect(out.verdict.reason).toBe("guard_failed_open");
    }
    expect(inserts).toBe(inputs.length);
  });

  it("seam fidelity: every guarded producer file still calls raiseIfAllowed with the producer id simulated here", () => {
    const expected: Record<string, string[]> = {
      "server/services/schemaDriftDetector.ts": ["schema_drift"],
      "server/services/stripeDriftDetector.ts": ["stripe_drift"],
      "server/services/pillarReviewer.ts": ["pillar_review"],
      "server/services/vendorSecretRotation.ts": ["vendor_secret_rotation"],
      "server/services/agentRetractCron.ts": ["agent_retract"],
      "server/services/agentInitiativeEngine.ts": ["agent_initiative"],
      "server/services/agentAuthorityGate.ts": ["agent_authority"],
      "server/services/onboardingAutonomy.ts": ["onboarding_autonomy"],
      "server/routes-founder-dlq.ts": ["dlq_poison_job"],
    };
    for (const [file, ids] of Object.entries(expected)) {
      const sf = ts.createSourceFile(
        file,
        stripComments(fs.readFileSync(path.join(REPO, file), "utf8")),
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS,
      );
      const producers = new Set<string>();
      let guardCalls = 0;
      const visit = (n: ts.Node) => {
        if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "raiseIfAllowed") guardCalls += 1;
        if (
          ts.isPropertyAssignment(n) &&
          ts.isIdentifier(n.name) &&
          n.name.text === "producer" &&
          ts.isStringLiteralLike(n.initializer)
        ) {
          producers.add(n.initializer.text);
        }
        ts.forEachChild(n, visit);
      };
      visit(sf);
      expect(guardCalls, `${file} calls raiseIfAllowed`).toBeGreaterThan(0);
      for (const id of ids) expect(producers.has(id), `${file} names producer "${id}"`).toBe(true);
    }
  });
});
