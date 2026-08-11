/**
 * R-3 exit test — collection-sequence arming (founder ruling 2026-08-11).
 *
 * The founder chose the more expensive option deliberately, and it has FOUR
 * parts that pull against each other. A test that checks only one direction
 * would pass while the ruling was violated, so each is asserted both ways:
 *
 *   1. A NEW sequence is not armed and contacts nobody until armed.
 *   2. An EXISTING armed sequence (created under the old `auto_start` default)
 *      KEEPS RUNNING — asserting only "it appears in the confirm surface"
 *      would pass a build that disarmed every live collection wholesale.
 *   3. …AND it appears in the confirm surface — asserting only "it keeps
 *      running" would pass a build that silently grandfathered it.
 *   4. The gate renders the REAL ladder. The fixture below differs from the
 *      seeded/default ladder in EVERY dimension (step count, offsets, channels,
 *      escalation order), so a gate that rendered placeholder copy or a
 *      hardcoded default cannot produce these strings.
 *
 * Mutations run against this file are recorded in the slice report.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  armingState,
  channelsUsed,
  describeArmingPlan,
  describeLadder,
  describeTiming,
  isArmedForDispatch,
  ladderDigest,
  needsConfirmation,
  type ArmableSequence,
  type CollectionLadderStep,
} from "@shared/collections/arming";
import { isNamedPreAuthorization } from "../../server/services/crisisLeadershipEngine";

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

/**
 * Strip `--` (SQL) and `//` (JS) comment lines so the no-backfill assertion
 * scans EXECUTABLE statements only. Both migration artifacts carry a prose
 * warning that quotes the forbidden UPDATE in order to explain why it must
 * never be added; matching raw text would flag that warning as the offence.
 */
const withoutComments = (src: string) =>
  src
    .split("\n")
    .filter((line) => !/^\s*(--|\/\/)/.test(line))
    .join("\n");

// ── Fixtures ────────────────────────────────────────────────────────────────

/**
 * A ladder that looks NOTHING like a plausible default. If any assertion below
 * could be satisfied by placeholder copy, these values would not appear.
 * Deliberately supplied OUT of send order to prove the renderer sorts by the
 * stored offsets rather than trusting array position.
 */
const CUSTOM_LADDER: CollectionLadderStep[] = [
  { stepNumber: 4, daysAfterDue: 45, channel: "mail", escalationLevel: "final" },
  { stepNumber: 1, daysAfterDue: -6, channel: "sms", escalationLevel: "reminder" },
  { stepNumber: 3, daysAfterDue: 21, channel: "call", escalationLevel: "urgent" },
  { stepNumber: 2, daysAfterDue: 0, channel: "email", escalationLevel: "warning" },
];

/** The shape every row created BEFORE this migration has. */
const legacyArmed: ArmableSequence = {
  name: "Legacy ladder",
  steps: CUSTOM_LADDER,
  autoStart: true,
  armedAt: null,
  armedBy: null,
  armedLadderDigest: null,
};

/** The shape every row created AFTER this migration has. */
const freshSequence: ArmableSequence = {
  name: "Brand new ladder",
  steps: CUSTOM_LADDER,
  autoStart: false,
  armedAt: null,
  armedBy: null,
  armedLadderDigest: null,
};

const confirmed: ArmableSequence = {
  name: "Confirmed ladder",
  steps: CUSTOM_LADDER,
  autoStart: true,
  armedAt: new Date("2026-08-11T12:00:00Z"),
  armedBy: "user_abc",
  armedLadderDigest: ladderDigest(CUSTOM_LADDER),
};

// ── 1. New sequences are inert ──────────────────────────────────────────────

describe("R-3 · a new sequence is not armed and contacts nobody", () => {
  it("the schema default for collection_sequences.auto_start is false", () => {
    const schema = read("shared/schema.ts");
    const block = schema.slice(
      schema.indexOf('export const collectionSequences = pgTable("collection_sequences"'),
      schema.indexOf('export const collectionEnrollments = pgTable("collection_enrollments"'),
    );
    expect(block).toContain('autoStart: boolean("auto_start").default(false)');
    expect(block).not.toContain('boolean("auto_start").default(true)');
  });

  it("an unarmed sequence is refused by the dispatch gate", () => {
    expect(armingState(freshSequence)).toBe("unarmed");
    expect(isArmedForDispatch(freshSequence)).toBe(false);
  });

  it("an unarmed sequence is NOT dressed up as needing confirmation", () => {
    // It is simply off. Listing it as "needs confirmation" would nag customers
    // about ladders nobody ever switched on.
    expect(needsConfirmation(freshSequence)).toBe(false);
  });

  it("the create route forces autoStart false regardless of the request body", () => {
    const routes = read("server/routes-va-engine.ts");
    const createBlock = routes.slice(
      routes.indexOf('api.post("/api/collection-sequences"'),
      routes.indexOf('api.patch("/api/collection-sequences/:id"'),
    );
    expect(createBlock).toContain("autoStart: false");
    expect(createBlock).toContain("stripArmingFields(req.body)");
  });

  // NOTE: the enrollment chokepoint is NOT pinned here.
  //
  // It was, as `expect(enrollBlock).toContain("assertSequenceArmed")`. Mutation
  // M6 replaced the guard body with `void assertSequenceArmed;` — deleting the
  // refusal while keeping the substring — and this file stayed GREEN. A
  // presence check proves a symbol appears and nothing about what it does.
  //
  // The chokepoint is now pinned BEHAVIOURALLY in
  // tests/unit/collectionArmingEnrollment.test.ts, which drives the real route
  // and the real AI-invokable skill and asserts that NO enrollment row is
  // created. Do not re-add a text check here and call it coverage.
});

// ── 2 + 3. Existing armed sequences: BOTH directions ────────────────────────

describe("R-3 · an existing armed sequence keeps running AND surfaces", () => {
  it("is classified as armed-but-unconfirmed", () => {
    expect(armingState(legacyArmed)).toBe("armed_unconfirmed");
  });

  it("KEEPS RUNNING — it is not disarmed wholesale", () => {
    // Fails if someone "fixes" the default by also disarming existing rows.
    expect(isArmedForDispatch(legacyArmed)).toBe(true);
  });

  it("APPEARS in the confirm surface — it is not silently grandfathered", () => {
    // Fails if someone treats a legacy row as already-consented.
    expect(needsConfirmation(legacyArmed)).toBe(true);
  });

  it("explains WHY it is being surfaced, without inventing a person", () => {
    const plan = describeArmingPlan(legacyArmed);
    expect(plan.armedBy).toBeNull();
    expect(plan.armedAt).toBeNull();
    expect(plan.reason).toMatch(/old system default, not by a person/i);
  });

  it("stops surfacing once confirmed, and stays running", () => {
    expect(armingState(confirmed)).toBe("armed_confirmed");
    expect(needsConfirmation(confirmed)).toBe(false);
    expect(isArmedForDispatch(confirmed)).toBe(true);
  });

  it("neither migration artifact backfills existing rows", () => {
    // The whole point of the confirm surface is that old rows keep running.
    // A backfill would sever live collections; assert its ABSENCE in both.
    const sql = withoutComments(read("migrations/0231_collection_sequence_arming.sql"));
    const mjs = withoutComments(read("scripts/migrate.mjs"));
    const backfill = /UPDATE\s+"?collection_sequences"?\s+SET\s+"?auto_start"?/i;
    expect(sql).not.toMatch(backfill);
    expect(mjs).not.toMatch(backfill);
    // Guard the guard: the stripper must not have eaten the real statements.
    expect(sql).toMatch(/ALTER TABLE "collection_sequences"/);
    expect(mjs).toMatch(/ALTER TABLE "collection_sequences"/);
  });

  it("ships BOTH migration artifacts with the default flip", () => {
    const flip = /ALTER TABLE "collection_sequences" ALTER COLUMN "auto_start" SET DEFAULT false/;
    expect(read("migrations/0231_collection_sequence_arming.sql")).toMatch(flip);
    expect(read("scripts/migrate.mjs")).toMatch(flip);
  });
});

// ── 4. The gate renders the REAL ladder ─────────────────────────────────────

describe("R-3 · the gate renders the sequence's own ladder, not placeholder copy", () => {
  const plan = describeArmingPlan(legacyArmed);

  it("renders one rung per stored step, in send order", () => {
    expect(plan.totalSteps).toBe(4);
    // Supplied out of order; sorted by the stored offsets.
    expect(plan.rungs.map((r) => r.stepNumber)).toEqual([1, 2, 3, 4]);
    expect(plan.rungs.map((r) => r.relativeDays)).toEqual([-6, 0, 21, 45]);
  });

  it("carries THIS fixture's channels — not a default email-only ladder", () => {
    expect(plan.channels).toEqual(["sms", "email", "call", "mail"]);
    expect(channelsUsed(CUSTOM_LADDER)).toEqual(["sms", "email", "call", "mail"]);
  });

  it("states timing in the customer's terms, including before/on/after due", () => {
    expect(plan.rungs[0].timing).toBe("6 days before the due date");
    expect(plan.rungs[1].timing).toBe("on the due date");
    expect(plan.rungs[2].timing).toBe("21 days past due");
    expect(plan.rungs[3].timing).toBe("45 days past due");
    expect(describeTiming(-1)).toBe("1 day before the due date");
    expect(describeTiming(1)).toBe("1 day past due");
  });

  it("pairs each channel with THIS fixture's escalation level", () => {
    expect(plan.rungs.map((r) => `${r.channel}:${r.escalationLevel}`)).toEqual([
      "sms:reminder",
      "email:warning",
      "call:urgent",
      "mail:final",
    ]);
  });

  it("a DIFFERENT ladder produces a different disclosure", () => {
    // The load-bearing check: if describeLadder ignored its input and returned
    // canned copy, these two would be identical.
    const other = describeArmingPlan({
      ...legacyArmed,
      steps: [{ stepNumber: 1, daysAfterDue: 90, channel: "email", escalationLevel: "final" }],
    });
    expect(other.rungs).not.toEqual(plan.rungs);
    expect(other.channels).toEqual(["email"]);
    expect(other.rungs[0].timing).toBe("90 days past due");
    expect(other.span).toBe("90 days past due through 90 days past due");
  });

  it("refuses to invent a ladder for a sequence with no steps", () => {
    const empty = describeArmingPlan({ ...freshSequence, steps: [] });
    expect(empty.rungs).toEqual([]);
    expect(empty.totalSteps).toBe(0);
    expect(empty.span).toBeNull();
    expect(describeLadder(null)).toEqual([]);
    expect(describeLadder(undefined)).toEqual([]);
  });

  it("the Finance-door gate renders from describeArmingPlan, not local copy", () => {
    const ui = read("client/src/components/finance/CollectionArming.tsx");
    expect(ui).toContain("describeArmingPlan");
    expect(ui).toContain("plan.rungs.map");
    // No hardcoded day offsets in the disclosure — the ladder is data.
    expect(ui).not.toMatch(/Day\s+\d+\s*[·:-]/);
  });
});

// ── 5. Confirmation is bound to the ladder that was shown ───────────────────

describe("R-3 · a confirmation covers one specific ladder", () => {
  it("editing the ladder after confirmation re-surfaces the sequence", () => {
    const edited: ArmableSequence = {
      ...confirmed,
      steps: [
        ...CUSTOM_LADDER,
        { stepNumber: 5, daysAfterDue: 90, channel: "call", escalationLevel: "final" },
      ],
    };
    expect(armingState(edited)).toBe("armed_stale");
    expect(needsConfirmation(edited)).toBe(true);
    // …and it keeps running while it waits. Same both-directions rule.
    expect(isArmedForDispatch(edited)).toBe(true);
    expect(describeArmingPlan(edited).reason).toMatch(/ladder changed/i);
  });

  it("the digest tracks send-affecting fields only", () => {
    const renamed = { ...confirmed, name: "Renamed, same ladder" };
    expect(armingState(renamed)).toBe("armed_confirmed");

    const rechannelled = {
      ...confirmed,
      steps: CUSTOM_LADDER.map((s) =>
        s.stepNumber === 2 ? { ...s, channel: "call" as const } : s,
      ),
    };
    expect(armingState(rechannelled)).toBe("armed_stale");

    const retimed = {
      ...confirmed,
      steps: CUSTOM_LADDER.map((s) => (s.stepNumber === 2 ? { ...s, daysAfterDue: 30 } : s)),
    };
    expect(armingState(retimed)).toBe("armed_stale");
  });

  it("is deterministic and order-independent", () => {
    expect(ladderDigest(CUSTOM_LADDER)).toBe(ladderDigest([...CUSTOM_LADDER].reverse()));
    expect(ladderDigest(CUSTOM_LADDER)).not.toBe(ladderDigest([]));
  });

  it("the arm endpoint requires an acknowledged digest in the request body", () => {
    // Route-shape only. The GUARD ITSELF — that a stale digest refuses and
    // writes nothing — is pinned behaviourally in
    // tests/unit/collectionArmingDigest.test.ts. An earlier version of this
    // slice asserted `service).toContain("ladder_changed")`; mutation M12
    // replaced the condition with `if (false)` and it stayed green.
    const routes = read("server/routes-va-engine.ts");
    const armBlock = routes.slice(
      routes.indexOf('api.post("/api/collection-sequences/:id/arm"'),
      routes.indexOf('api.post("/api/collection-sequences/:id/disarm"'),
    );
    expect(armBlock).toContain("acknowledgedDigest");
  });

  it("arming cannot be granted through a generic create/update body", () => {
    const routes = read("server/routes-va-engine.ts");
    for (const field of ["autoStart", "armedAt", "armedBy", "armedLadderDigest"]) {
      expect(routes).toContain(`"${field}"`);
    }
    const patchBlock = routes.slice(
      routes.indexOf('api.patch("/api/collection-sequences/:id"'),
      routes.indexOf('api.delete("/api/collection-sequences/:id"'),
    );
    expect(patchBlock).toContain("stripArmingFields(req.body)");
    expect(patchBlock).not.toContain("omitProtectedFields(req.body)");
  });
});

// ── 6. Sibling default: named crisis pre-authorisation ──────────────────────

describe("R-3 · pre_authorized_tradeoffs.autoExecute is a NAMED grant", () => {
  it("the schema default is false", () => {
    const schema = read("shared/schema.ts");
    const block = schema.slice(
      schema.indexOf('export const preAuthorizedTradeoffs = pgTable("pre_authorized_tradeoffs"'),
      schema.indexOf('export const crisisPlaybooks = pgTable("crisis_playbooks"'),
    );
    expect(block).toContain('autoExecute: boolean("auto_execute").notNull().default(false)');
    expect(block).toContain('preAuthorizedBy: text("pre_authorized_by")');
  });

  it("auto_execute alone is NOT a grant — a grantor must be named", () => {
    expect(isNamedPreAuthorization({ autoExecute: true, preAuthorizedBy: null })).toBe(false);
    expect(isNamedPreAuthorization({ autoExecute: true, preAuthorizedBy: "   " })).toBe(false);
    expect(isNamedPreAuthorization({ autoExecute: true, preAuthorizedBy: "founder" })).toBe(true);
  });

  it("a name without auto_execute is still not unattended execution", () => {
    expect(isNamedPreAuthorization({ autoExecute: false, preAuthorizedBy: "founder" })).toBe(false);
  });

  it("seeded trade-offs are candidates, not self-granted authorisations", () => {
    const engine = read("server/services/crisisLeadershipEngine.ts");
    const seedBlock = engine.slice(
      engine.indexOf("async seedTradeoffs()"),
      engine.indexOf("async evaluateTradeoffs("),
    );
    expect(seedBlock).not.toContain("autoExecute: true");
    // Stamping a grantor here would fabricate a consent nobody gave.
    expect(seedBlock).not.toContain("preAuthorizedBy:");
  });

  it("the evaluator gates on the named grant, and reports only what ran", () => {
    const engine = read("server/services/crisisLeadershipEngine.ts");
    expect(engine).toContain("if (triggered && isNamedPreAuthorization(tradeoff))");
    expect(engine).toContain("executedAt: executed ?");
    expect(engine).not.toContain("executedAt: triggered ?");
  });

  it("ships both migration artifacts for the tradeoff table", () => {
    const flip =
      /ALTER TABLE "pre_authorized_tradeoffs" ALTER COLUMN "auto_execute" SET DEFAULT false/;
    expect(read("migrations/0231_collection_sequence_arming.sql")).toMatch(flip);
    expect(read("scripts/migrate.mjs")).toMatch(flip);
  });
});
