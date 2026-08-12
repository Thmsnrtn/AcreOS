/**
 * Canonical architecture ratchet — the meta-gate over shared/architecture/canon.ts.
 *
 * The Master Audit's canonical architecture (Appendix BI/BL) is ~19,000 lines of
 * prose. Prose cannot govern a 3,400-file repository and cannot tell you whether
 * the code still obeys it. `shared/architecture/canon.ts` converts it into a
 * registry; this file is the gate that keeps the registry HONEST and makes
 * convergence a number that can only go down.
 *
 * What it guarantees:
 *   1. Shape — every layer/law/object/fitness function has its required fields,
 *      ids are unique, and the fixed sets (7 layers, 15 laws, 12 fitness
 *      functions, 9 loop stages) have not silently drifted.
 *   2. Truth — every table the registry claims exists really is declared in the
 *      Drizzle schema, and every enforcement ref really is a file on disk. A
 *      registry that claims coverage it does not have reads as assurance and is
 *      worse than no registry at all.
 *   3. Ratchet — the count of UNENFORCED fitness functions and the count of
 *      canonical objects with no canonical home may only SHRINK.
 *
 * Modelled deliberately on tests/unit/constitution.test.ts — same registry +
 * ratchet shape. Do not invent a second pattern.
 *
 * WHEN YOU MAKE PROGRESS: reclassify the entry in canon.ts and LOWER the
 * matching baseline below IN THE SAME COMMIT. That is the whole mechanism.
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import {
  CANONICAL_LAYERS,
  CANONICAL_LAWS,
  CANONICAL_LOOP,
  CANONICAL_OBJECTS,
  FITNESS_FUNCTIONS,
  NON_LAYERS,
  allClaimedTables,
  allEnforcementRefs,
  objectsWithoutCanonicalHome,
  unenforcedFitness,
  layerById,
  objectById,
  fitnessById,
} from "@shared/architecture/canon";

const ROOT = path.resolve(__dirname, "../..");

/**
 * Fitness functions with NO automated backstop at all. May only DECREASE.
 *
 * 2026-08-12 (initial): 2 — `historical-decision-fidelity` (no customer
 *   DecisionSnapshot exists, so every recorded decision reads against live rows)
 *   and `infrastructure-restraint` (BI152's New Database Test is advisory only).
 *   The other ten are "partial": something real enforces part of each, and the
 *   named gap in `enforcement.note` is the remaining work.
 * 2026-08-12 (2 -> 1): `historical-decision-fidelity` is now enforced.
 *   Decision Memory landed (decision_snapshots + shared/decisions/snapshot.ts),
 *   and tests/unit/decisionSnapshotFidelity.test.ts proves the law the only way
 *   that counts: it writes a snapshot, mutates the evidence underneath it, and
 *   asserts the snapshot still reports what was believed then.
 *   `infrastructure-restraint` remains the last fully unenforced one — BI152's
 *   New Database Test is still advisory.
 * 2026-08-12 (1 -> 0): `infrastructure-restraint` is now enforced.
 *   scripts/check-infrastructure-restraint.mjs runs inside `npm run check` and
 *   makes BI152's New Database Test a gate: every banned primitive is scanned
 *   for in package.json AND deploy config, and anything found must carry a
 *   written MEASURED need. Twelve tests run the real script against synthetic
 *   repos to prove it bites — and caught two genuine bugs in it (a `\b` anchor
 *   before `@` made the kubernetes and elasticsearch rules unmatchable, and a
 *   dependency-only scan missed `image: elasticsearch:8` in compose config).
 *
 *   EVERY fitness function now has at least partial automated enforcement.
 *   This baseline stays at 0: a new fitness function may only be registered
 *   with enforcement, or the count fails.
 */
const UNENFORCED_FITNESS_BASELINE = 0;

/**
 * Canonical objects (BI12) that do not yet have a canonical home — i.e. status
 * is conflated / role-table / absent. May only DECREASE.
 *
 * 2026-08-12 (initial): 14 of 18. Only FOUR canonical objects already have a
 *   canonical home — organization, user, deal, workflow-run. The other fourteen
 *   are the Reality Graph + Evidence + Decision delta, and they are the work
 *   queue:
 *     absent      — relationship, opportunity, evidence-claim, scenario,
 *                   decision-snapshot
 *     conflated   — property, parcel, document
 *     role-table  — party, holding, instrument, plan, action-receipt, outcome
 *
 *   That 4-of-18 number is the single most useful fact in this file: it says
 *   the repo's breadth (752 tables) has been built on a Reality Graph that was
 *   never made canonical. Every entry above is additive work, not a rewrite.
 * 2026-08-12 (14 -> 13): evidence-claim now has a canonical home. The Evidence
 *   Fabric landed as ONE table (`evidence_claims`, append-only) plus a pure
 *   deterministic resolution policy (shared/evidence/claim.ts), wired into the
 *   property-enrichment write path. unknown, conflict and stale are now
 *   representable states rather than coerced defaults.
 * 2026-08-12 (13 -> 12): decision-snapshot now has a canonical home
 *   (`decision_snapshots`, immutable by contract). The two landed in this order
 *   deliberately — a DecisionSnapshot has nothing stable to freeze a reference
 *   to until evidence is versioned, which is why Decision Memory could not have
 *   been built first.
 * 2026-08-12 (12 -> 11): scenario now has a canonical home (`scenarios`,
 *   immutable, engine-versioned). It completes the chain the previous two
 *   started: a decision now freezes the EVIDENCE it was based on, the
 *   ASSUMPTIONS in force, AND the ECONOMICS that justified it. Before this a
 *   snapshot could record "offer $42,000" with the arithmetic behind the number
 *   living nowhere at all.
 */
const OBJECTS_WITHOUT_CANONICAL_HOME_BASELINE = 11;

/**
 * The fixed cardinalities declared by the audit. These are not ratchets — they
 * are the audit's own structure. A change here means the canonical architecture
 * itself changed, which requires an ADR, not a test edit.
 */
const EXPECTED_LAYERS = 7; // BI3
const EXPECTED_LAWS = 15; // BL8
const EXPECTED_FITNESS = 12; // BL3
const EXPECTED_LOOP_STAGES = 9; // BI1

function exists(relPath: string): boolean {
  return fs.existsSync(path.join(ROOT, relPath));
}

/** Every table name declared anywhere in the Drizzle schema. */
function declaredTables(): Set<string> {
  const files = [
    path.join(ROOT, "shared/schema.ts"),
    ...fs
      .readdirSync(path.join(ROOT, "shared/schema"))
      .filter((f) => f.endsWith(".ts"))
      .map((f) => path.join(ROOT, "shared/schema", f)),
  ];
  const names = new Set<string>();
  // Matches both `pgTable("x", {` and the multi-line `pgTable(\n  "x",` form.
  const re = /pgTable\(\s*"([a-z0-9_]+)"/g;
  for (const file of files) {
    const src = fs.readFileSync(file, "utf8");
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) names.add(m[1]);
  }
  return names;
}

describe("canon registry — shape", () => {
  it("declares exactly the audit's seven authoritative layers, in dependency order", () => {
    expect(CANONICAL_LAYERS).toHaveLength(EXPECTED_LAYERS);
    CANONICAL_LAYERS.forEach((layer, i) => {
      expect(layer.ordinal, `${layer.id} ordinal`).toBe(i + 1);
      expect(layer.id, "id").toBeTruthy();
      expect(layer.title, `${layer.id} title`).toBeTruthy();
      expect(layer.owns, `${layer.id} owns`).toBeTruthy();
      expect(layer.doesNotOwn, `${layer.id} doesNotOwn`).toBeTruthy();
    });
  });

  it("keeps Pax and Founder OS OUT of the layer set (BI4, BI5)", () => {
    const layerIds = new Set(CANONICAL_LAYERS.map((l) => l.id));
    for (const nl of NON_LAYERS) {
      expect(
        layerIds.has(nl.id),
        `${nl.id} must NOT be a canonical layer — ${nl.prohibition}`,
      ).toBe(false);
      expect(nl.prohibition, `${nl.id} prohibition`).toBeTruthy();
    }
  });

  it("declares exactly the audit's fifteen constitutional laws, numbered 1..15", () => {
    expect(CANONICAL_LAWS).toHaveLength(EXPECTED_LAWS);
    CANONICAL_LAWS.forEach((law, i) => {
      expect(law.n, `law ${law.id} ordinal`).toBe(i + 1);
      expect(law.id, "law id").toBeTruthy();
      expect(law.statement.length, `law ${law.id} statement`).toBeGreaterThan(20);
    });
  });

  it("declares the nine-stage canonical loop", () => {
    expect(CANONICAL_LOOP).toHaveLength(EXPECTED_LOOP_STAGES);
    expect(CANONICAL_LOOP[0]).toBe("REALITY");
    expect(CANONICAL_LOOP[CANONICAL_LOOP.length - 1]).toBe("LEARNING");
  });

  it("declares exactly the audit's twelve fitness functions with fail conditions", () => {
    expect(FITNESS_FUNCTIONS).toHaveLength(EXPECTED_FITNESS);
    for (const f of FITNESS_FUNCTIONS) {
      expect(f.id, "fitness id").toBeTruthy();
      expect(f.title, `${f.id} title`).toBeTruthy();
      expect(
        f.failCondition.length,
        `${f.id} failCondition must state what FAILURE looks like`,
      ).toBeGreaterThan(20);
    }
  });

  it("gives every canonical object a purpose, a real layer and a disposition", () => {
    const layerIds = new Set(CANONICAL_LAYERS.map((l) => l.id));
    for (const o of CANONICAL_OBJECTS) {
      expect(o.id, "object id").toBeTruthy();
      expect(o.purpose, `${o.id} purpose`).toBeTruthy();
      expect(layerIds.has(o.layer), `${o.id} layer "${o.layer}" is not a canonical layer`).toBe(
        true,
      );
      expect(o.disposition, `${o.id} disposition`).toBeTruthy();
    }
  });

  it("has unique ids across every registry", () => {
    for (const [name, ids] of [
      ["layers", CANONICAL_LAYERS.map((x) => x.id)],
      ["laws", CANONICAL_LAWS.map((x) => x.id)],
      ["objects", CANONICAL_OBJECTS.map((x) => x.id)],
      ["fitness", FITNESS_FUNCTIONS.map((x) => x.id)],
    ] as const) {
      expect(new Set(ids).size, `duplicate id in ${name}`).toBe(ids.length);
    }
  });

  it("exposes working lookup helpers", () => {
    expect(layerById("evidence-fabric")?.ordinal).toBe(3);
    expect(fitnessById("tenant-isolation")?.enforcement.kind).toBe("code-invariant");

    // The invariant under test is "the lookup returns the registry's real
    // entry", NOT a hardcoded status. An earlier version of this test pinned
    // `evidence-claim: absent`, which was true when written and became false
    // when the Evidence Fabric landed; re-pinning it to the next
    // still-absent object just moves the same staleness one commit down the
    // road. Assert the helper AGREES WITH THE REGISTRY instead — the actual
    // statuses are already pinned, and made to ratchet, below.
    for (const o of CANONICAL_OBJECTS) {
      expect(objectById(o.id), `objectById(${o.id})`).toBe(o);
    }
    expect(objectById("nope")).toBeUndefined();
    expect(layerById("nope")).toBeUndefined();
    expect(fitnessById("nope")).toBeUndefined();
  });
});

describe("canon registry — honesty", () => {
  it("every table the registry claims exists is really declared in the schema", () => {
    const declared = declaredTables();
    // Sanity: the extractor must actually be finding tables, otherwise this
    // assertion would pass vacuously if the regex ever broke.
    expect(declared.size).toBeGreaterThan(500);

    const missing = allClaimedTables().filter((t) => !declared.has(t));
    expect(
      missing,
      `canon.ts names table(s) that do not exist in the Drizzle schema: ${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("every enforcement ref resolves to a file that exists", () => {
    const missing = allEnforcementRefs().filter((r) => !exists(r));
    expect(
      missing,
      `canon.ts claims enforcement from file(s) that do not exist: ${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("a canonical object with no canonical home must state its gap", () => {
    for (const o of objectsWithoutCanonicalHome()) {
      expect(
        o.gap.length,
        `${o.id} is ${o.status} but names no gap — an unexplained gap cannot be worked on`,
      ).toBeGreaterThan(40);
    }
  });

  it("a canonical object marked canonical must NOT carry a gap", () => {
    for (const o of CANONICAL_OBJECTS.filter((x) => x.status === "canonical")) {
      expect(o.gap, `${o.id} is marked canonical but still names a gap`).toBe("");
      expect(o.tables.length, `${o.id} is canonical but names no table`).toBeGreaterThan(0);
    }
  });

  it("partial and unenforced fitness functions must name what is NOT covered", () => {
    for (const f of FITNESS_FUNCTIONS) {
      if (f.enforcement.kind === "partial" || f.enforcement.kind === "unenforced") {
        expect(
          f.enforcement.note?.length ?? 0,
          `${f.id} is ${f.enforcement.kind} but does not name the gap`,
        ).toBeGreaterThan(40);
      }
    }
  });

  it("an unenforced fitness function must not claim enforcement refs", () => {
    for (const f of unenforcedFitness()) {
      expect(
        f.enforcement.refs,
        `${f.id} is unenforced but names refs — reclassify it as partial instead`,
      ).toEqual([]);
    }
  });

  it("an enforced fitness function must name at least one ref", () => {
    for (const f of FITNESS_FUNCTIONS) {
      if (f.enforcement.kind === "unenforced") continue;
      expect(
        f.enforcement.refs.length,
        `${f.id} claims ${f.enforcement.kind} enforcement but names no file`,
      ).toBeGreaterThan(0);
    }
  });
});

describe("canon registry — ratchets", () => {
  it(`unenforced fitness functions stay at or below ${UNENFORCED_FITNESS_BASELINE}`, () => {
    const current = unenforcedFitness();
    expect(
      current.length,
      `Unenforced fitness functions grew to ${current.length} (${current
        .map((f) => f.id)
        .join(", ")}). Architecture debt may only shrink — wire enforcement, ` +
        `or explain in an ADR why the canonical architecture itself changed.`,
    ).toBeLessThanOrEqual(UNENFORCED_FITNESS_BASELINE);
  });

  it(`canonical objects without a canonical home stay at or below ${OBJECTS_WITHOUT_CANONICAL_HOME_BASELINE}`, () => {
    const current = objectsWithoutCanonicalHome();
    expect(
      current.length,
      `Canonical objects lacking a canonical home grew to ${current.length} (${current
        .map((o) => `${o.id}:${o.status}`)
        .join(", ")}). This count may only shrink as the Reality Graph converges.`,
    ).toBeLessThanOrEqual(OBJECTS_WITHOUT_CANONICAL_HOME_BASELINE);
  });

  it("the baselines are not stale — they must track the registry as it improves", () => {
    // If the real numbers have dropped BELOW the baseline, the baseline was not
    // lowered in the same commit. That is the failure mode CLAUDE.md names:
    // "Fix the occurrence, not the baseline" — and its mirror, "when a count
    // legitimately drops, lower it in the same commit".
    expect(
      unenforcedFitness().length,
      "unenforced fitness count dropped below the baseline — LOWER UNENFORCED_FITNESS_BASELINE",
    ).toBe(UNENFORCED_FITNESS_BASELINE);
    expect(
      objectsWithoutCanonicalHome().length,
      "objects-without-home count dropped below the baseline — LOWER OBJECTS_WITHOUT_CANONICAL_HOME_BASELINE",
    ).toBe(OBJECTS_WITHOUT_CANONICAL_HOME_BASELINE);
  });
});
