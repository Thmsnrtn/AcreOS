/**
 * Decision Memory — historical fidelity.
 *
 * This file is the falsifiable form of canonical law 6 (shared/architecture/
 * canon.ts): "Historical decisions preserve what was known and assumed at the
 * time." BL3 states its fail condition exactly:
 *
 *     A prior decision changes meaning when current data or Pack rules change.
 *
 * So the central test does not check that a snapshot can be written. It writes
 * one, then MUTATES the world underneath it — new claims arrive, a source
 * changes its mind, a fact that was unknown becomes known — and asserts the
 * snapshot still reports what was believed THEN. A decision record that passes
 * only when nothing changes is not a record, it is a cache.
 *
 * Everything here runs against the pure kernel (shared/decisions/snapshot.ts +
 * shared/evidence/claim.ts), so it needs no database and no clock: `asOf` is
 * injected everywhere. That is the same property that makes the production path
 * reconstructable.
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import {
  DECISION_KINDS,
  DECISION_SNAPSHOT_VERSION,
  describeFooting,
  factAtDecision,
  freezeDecision,
  wasUnknownAtDecision,
  type DecisionSnapshotInput,
} from "@shared/decisions/snapshot";
import {
  RESOLUTION_POLICY_VERSION,
  resolveAll,
  type EvidenceClaim,
} from "@shared/evidence/claim";

const ROOT = path.resolve(__dirname, "../..");

const T0 = new Date("2026-03-03T00:00:00.000Z"); // when the decision was made
const T1 = new Date("2026-08-12T00:00:00.000Z"); // five months later

let nextId = 1;
function claim(over: Partial<EvidenceClaim> = {}): EvidenceClaim {
  return {
    id: nextId++,
    organizationId: 1,
    subjectType: "property",
    subjectId: 42,
    predicate: "property.zoning",
    value: "R-1",
    provider: "open-data",
    source: "County GIS",
    authority: "authoritative",
    observedAt: new Date("2026-02-01T00:00:00.000Z"),
    fetchedAt: new Date("2026-02-01T00:00:00.000Z"),
    providerConfidence: 90,
    license: "public-domain-usgov",
    costCents: 0,
    ...over,
  };
}

function decisionInput(over: Partial<DecisionSnapshotInput> = {}): DecisionSnapshotInput {
  return {
    subjectType: "property",
    subjectId: 42,
    kind: "offer",
    choice: "Offer $42,000 cash, 21-day close",
    rationale: "Zoning supports a residential split and the tax basis is low.",
    actorType: "user",
    actorRef: "17",
    authority: "owner",
    strategyPackId: "land_flipper",
    strategyPackVersion: "1.0.0",
    assumptions: [
      {
        key: "resale_price_usd",
        value: 68_000,
        unit: "usd",
        origin: "user",
        basis: "two nearby listings the investor tracked",
      },
    ],
    alternatives: [{ choice: "Pass", reason: "Return still clears the 25% hurdle" }],
    ...over,
  };
}

describe("law 6 — a decision does not change meaning when the world does", () => {
  it("preserves the answer that was current at decision time", () => {
    // At T0 the county said R-1 and that is what the investor acted on.
    const atT0 = [claim({ value: "R-1" })];
    const snapshot = freezeDecision(decisionInput(), resolveAll(atT0, T0), T0);
    expect(factAtDecision(snapshot, "property.zoning")?.value).toBe("R-1");

    // Later the county reclassifies. The LIVE answer changes…
    const laterClaim = claim({
      value: "A-2",
      observedAt: new Date("2026-07-01T00:00:00.000Z"),
      fetchedAt: new Date("2026-07-01T00:00:00.000Z"),
    });
    const live = resolveAll([...atT0, laterClaim], T1);
    expect(live.get("property.zoning")!.state).not.toBe("known"); // now a conflict

    // …and the snapshot does NOT. This is the whole law.
    expect(factAtDecision(snapshot, "property.zoning")?.value).toBe("R-1");
    expect(factAtDecision(snapshot, "property.zoning")?.state).toBe("known");
  });

  it("keeps an unknown-at-the-time unknown, even once it becomes known", () => {
    // The flood zone was never looked up before the offer went out.
    const snapshot = freezeDecision(
      decisionInput(),
      resolveAll([claim({ value: "R-1" })], T0),
      T0,
    );
    expect(factAtDecision(snapshot, "property.flood_zone")).toBeNull();

    // Six months later it is known — but the decision was NOT made knowing it,
    // and the record must never imply otherwise.
    const afterwards = resolveAll(
      [
        claim({ value: "R-1" }),
        claim({ predicate: "property.flood_zone", value: "AE", fetchedAt: T1, observedAt: T1 }),
      ],
      T1,
    );
    expect(afterwards.get("property.flood_zone")!.state).toBe("known");
    expect(factAtDecision(snapshot, "property.flood_zone")).toBeNull();
  });

  it("records the Strategy Pack version, so changing a Pack cannot reinterpret history", () => {
    // BI91: a decision must record which Pack/version influenced it.
    const snapshot = freezeDecision(
      decisionInput({ strategyPackId: "land_flipper", strategyPackVersion: "1.0.0" }),
      resolveAll([claim()], T0),
      T0,
    );
    expect(snapshot.strategyPackId).toBe("land_flipper");
    expect(snapshot.strategyPackVersion).toBe("1.0.0");
    expect(describeFooting(snapshot)).toContain("land_flipper@1.0.0");
  });

  it("records 'no Strategy Pack' explicitly rather than omitting it", () => {
    const snapshot = freezeDecision(
      decisionInput({ strategyPackId: null, strategyPackVersion: null }),
      resolveAll([claim()], T0),
      T0,
    );
    // null, not undefined — "no pack applied" is a fact, not a missing field.
    expect(snapshot.strategyPackId).toBeNull();
    expect(Object.hasOwn(snapshot, "strategyPackId")).toBe(true);
  });

  it("stamps the resolution policy version that produced the frozen evidence", () => {
    const snapshot = freezeDecision(decisionInput(), resolveAll([claim()], T0), T0);
    expect(snapshot.resolutionPolicyVersion).toBe(RESOLUTION_POLICY_VERSION);
    expect(snapshot.snapshotVersion).toBe(DECISION_SNAPSHOT_VERSION);
  });

  it("is verifiable — it carries the claim ids the frozen answer came from", () => {
    const c = claim({ value: "R-1" });
    const snapshot = freezeDecision(decisionInput(), resolveAll([c], T0), T0);
    const fact = factAtDecision(snapshot, "property.zoning")!;
    // An auditor can re-read exactly these claims, re-run resolution at
    // evidenceAsOf under resolutionPolicyVersion, and confirm the frozen answer
    // follows from them.
    expect(fact.claimIds).toContain(c.id);
    expect(fact.sources).toContain("County GIS");
  });
});

describe("law 3 carried forward — the unknowns are recorded, not omitted", () => {
  it("derives unknowns from the evidence rather than trusting the caller", () => {
    // The caller passes NO unknowns. The freeze must find them anyway — the
    // honest half of a decision record is exactly what a hurried caller omits.
    const claims = [
      claim({ value: "R-1" }),
      claim({ predicate: "property.flood_zone", value: null, authority: "unknown" }),
    ];
    const snapshot = freezeDecision(decisionInput(), resolveAll(claims, T0), T0);
    expect(wasUnknownAtDecision(snapshot, "property.flood_zone")).toBe(true);
    expect(snapshot.unknowns.find((u) => u.subject === "property.flood_zone")?.kind).toBe(
      "unknown",
    );
  });

  it("records a conflict as a conflict, not as the winning value", () => {
    const claims = [
      claim({ value: "R-1", source: "County GIS" }),
      claim({ value: "A-2", source: "State Parcel Layer" }),
    ];
    const snapshot = freezeDecision(decisionInput(), resolveAll(claims, T0), T0);
    const fact = factAtDecision(snapshot, "property.zoning")!;
    expect(fact.state).toBe("conflict");
    expect(fact.value).toBeUndefined(); // no winner was silently picked
    expect(
      snapshot.unknowns.find((u) => u.subject === "property.zoning")?.kind,
    ).toBe("conflict");
  });

  it("flags a known-but-stale fact as a caveat rather than burying it", () => {
    // A decision made on two-year-old zoning must not read later as if it were
    // made on current zoning.
    const ancient = new Date("2023-01-01T00:00:00.000Z");
    const snapshot = freezeDecision(
      decisionInput(),
      resolveAll([claim({ value: "R-1", observedAt: ancient, fetchedAt: ancient })], T0),
      T0,
    );
    const fact = factAtDecision(snapshot, "property.zoning")!;
    expect(fact.state).toBe("known");
    expect(fact.stale).toBe(true);
    expect(
      snapshot.unknowns.find(
        (u) => u.subject === "property.zoning" && u.kind === "unmeasured",
      ),
    ).toBeDefined();
  });

  it("keeps caller-supplied non-evidence unknowns alongside the derived ones", () => {
    const snapshot = freezeDecision(
      decisionInput({
        additionalUnknowns: [
          { subject: "seller motivation", kind: "unmeasured", note: "never spoke to them" },
        ],
      }),
      resolveAll([claim()], T0),
      T0,
    );
    expect(wasUnknownAtDecision(snapshot, "seller motivation")).toBe(true);
  });

  it("summarises the footing unknowns-first", () => {
    const claims = [
      claim({ value: "R-1" }),
      claim({ predicate: "property.flood_zone", value: null, authority: "unknown" }),
    ];
    const footing = describeFooting(
      freezeDecision(decisionInput(), resolveAll(claims, T0), T0),
    );
    // What was NOT known leads, because it is what a reader reconstructing the
    // decision most needs and is least likely to be told.
    expect(footing).toMatch(/^1 unknown/);
    expect(footing).toContain("1 known");
  });
});

describe("assumptions keep their origin", () => {
  it("distinguishes the customer's own judgement from a platform default", () => {
    const snapshot = freezeDecision(
      decisionInput({
        assumptions: [
          { key: "resale_price_usd", value: 68_000, origin: "user" },
          { key: "hold_months", value: 9, origin: "strategy-pack-default" },
        ],
      }),
      resolveAll([claim()], T0),
      T0,
    );
    const byKey = Object.fromEntries(snapshot.assumptions.map((a) => [a.key, a.origin]));
    // Conflating these is how a platform default silently becomes "what the
    // customer believed".
    expect(byKey["resale_price_usd"]).toBe("user");
    expect(byKey["hold_months"]).toBe("strategy-pack-default");
  });
});

describe("determinism", () => {
  it("produces an identical body from identical inputs", () => {
    const claims = [claim({ value: "R-1" })];
    const a = freezeDecision(decisionInput(), resolveAll(claims, T0), T0);
    const b = freezeDecision(decisionInput(), resolveAll(claims, T0), T0);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("covers every declared decision kind with a stable, closed vocabulary", () => {
    // An open string would let every feature invent its own kind, and Decision
    // Memory would stop being comparable across time — its whole value.
    expect(new Set(DECISION_KINDS).size).toBe(DECISION_KINDS.length);
    expect(DECISION_KINDS).toContain("pass"); // the most under-recorded decision
    for (const kind of DECISION_KINDS) {
      const s = freezeDecision(decisionInput({ kind }), resolveAll([claim()], T0), T0);
      expect(s.kind).toBe(kind);
    }
  });
});

describe("immutability is structural, not conventional", () => {
  it("the store exposes no update or delete path", () => {
    const store = fs.readFileSync(
      path.join(ROOT, "server/services/decisions/decisionStore.ts"),
      "utf8",
    );
    // The failure mode is not malice — it is an ordinary `UPDATE ... SET
    // rationale` written by someone fixing a typo two years from now.
    expect(store).not.toMatch(/db\s*\.\s*update\(\s*decisionSnapshots/);
    expect(store).not.toMatch(/db\s*\.\s*delete\(\s*decisionSnapshots/);
  });

  it("the table has no updatedAt column", () => {
    const schema = fs.readFileSync(
      path.join(ROOT, "shared/schema/decision-snapshots.ts"),
      "utf8",
    );
    expect(schema).not.toMatch(/updatedAt\s*:\s*timestamp\(/);
    expect(schema).not.toMatch(/timestamp\(\s*"updated_at"/);
  });

  it("the HTTP surface exposes no mutation of a recorded decision", () => {
    const routes = fs.readFileSync(path.join(ROOT, "server/routes-decisions.ts"), "utf8");
    expect(routes).not.toMatch(/router\s*\.\s*(put|patch|delete)\s*\(/);
  });

  it("freezes the economics that justified the choice, and says so when there were none", () => {
    // A decision could record "offer $42,000" with the arithmetic behind the
    // number living nowhere — reconstructing what the investor believed about
    // the PARCEL but not about the DEAL.
    const withEconomics = freezeDecision(decisionInput(), resolveAll([claim()], T0), T0, [
      {
        scenarioId: 9,
        label: "Base case",
        engineId: "land_deal",
        engineVersion: "land-deal-1",
        headline: [{ id: "profit", value: 2_406_000, unit: "cents" }],
      },
    ]);
    expect(withEconomics.scenarios).toHaveLength(1);
    expect(withEconomics.scenarios[0].engineVersion).toBe("land-deal-1");
    expect(describeFooting(withEconomics)).toContain("1 scenario(s)");

    // And the absence is named rather than left silent: a decision made without
    // running the numbers is a different decision, and silence would read as
    // "the numbers were fine".
    const withoutEconomics = freezeDecision(decisionInput(), resolveAll([claim()], T0), T0);
    expect(withoutEconomics.scenarios).toEqual([]);
    expect(describeFooting(withoutEconomics)).toContain("no scenario computed");
  });

  it("is wired — mounted, manifested and migrated", () => {
    const routes = fs.readFileSync(path.join(ROOT, "server/routes.ts"), "utf8");
    expect(routes).toContain("decisionsRouter");
    expect(routes).toContain("'/api/decisions'");

    const manifest = fs.readFileSync(path.join(ROOT, "server/routeManifest.ts"), "utf8");
    expect(manifest).toContain('"routes-decisions.ts"');

    // A schema table with no migration 500s on deploy for every tenant.
    const migrate = fs.readFileSync(path.join(ROOT, "scripts/migrate.mjs"), "utf8");
    expect(migrate).toContain('CREATE TABLE IF NOT EXISTS "decision_snapshots"');
    expect(
      fs.existsSync(path.join(ROOT, "migrations/0228_decision_snapshots.sql")),
    ).toBe(true);

    const barrel = fs.readFileSync(path.join(ROOT, "shared/schema.ts"), "utf8");
    expect(barrel).toContain('export * from "./schema/decision-snapshots"');
  });
});
