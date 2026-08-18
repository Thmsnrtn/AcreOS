/**
 * THE GOLDEN LOOP, PER TENANT — one complete customer.
 *
 * Master Audit Section VII(B). The property loop proved the layers compose; the
 * failure loop proved they degrade honestly. This one asks the question that
 * outranks both, because it is the only one where being wrong is unrecoverable:
 * **does any of it leak between organizations?**
 *
 * Source-of-truth order puts tenant isolation above everything else in this
 * program, and the canonical layers built here are unusually exposed to getting
 * it wrong:
 *
 *   · `evidence_claims.subject_id` carries NO foreign key — deliberately, so a
 *     `parcel` claim can be recorded before Parcel has a table. Nothing at the
 *     database level stops org A writing a claim keyed to org B's property id,
 *     so the org column is doing ALL the work.
 *   · A decision cites scenarios BY ID, and an outcome cites a decision BY ID.
 *     Those are the two places one tenant's record could come to embed another
 *     tenant's numbers.
 *   · Every one of these tables is append-only, so a leak is not something you
 *     can clean up afterwards. It is frozen into an immutable record.
 *
 * WHY THIS FILE IS MOSTLY SOURCE ASSERTIONS. Tenancy lives in WHERE clauses, and
 * a WHERE clause cannot be exercised without a database. Rather than skip the
 * property when DATABASE_URL is absent — which is when it would most like to be
 * skipped — the invariants are asserted against the source of every canonical
 * store, so they run on every `npm test`. The pure logic that CAN be exercised
 * (resolution, freezing) is exercised for real.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

import {
  resolveClaims,
  type EvidenceClaim,
} from "@shared/evidence/claim";
import { freezeDecision } from "@shared/decisions/snapshot";

const ROOT = path.resolve(__dirname, "../..");

/** Every store that owns a canonical layer's persistence. */
const CANONICAL_STORES = [
  "server/services/evidence/evidenceStore.ts",
  "server/services/economics/scenarioStore.ts",
  "server/services/decisions/decisionStore.ts",
  "server/services/outcomes/outcomeStore.ts",
] as const;

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

/** Source with comments stripped — a rule must hold in CODE, not in prose. */
function code(rel: string): string {
  return read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/(^|[^:])\/\/.*$/, "$1"))
    .join("\n");
}

describe("every canonical store is organization-scoped by construction", () => {
  it("takes organizationId as its FIRST parameter, in every exported function", () => {
    // Not a style rule. A tenant key that arrives third, after two ids, is one
    // argument-order slip away from being someone else's — and TypeScript
    // cannot catch a swap between two `number`s.
    for (const rel of CANONICAL_STORES) {
      const src = code(rel);
      const fns = [...src.matchAll(/export async function (\w+)\(([^)]*)\)/g)];
      expect(fns.length, `${rel} exports no async functions?`).toBeGreaterThan(0);
      for (const [, name, params] of fns) {
        const first = params.split(",")[0]?.trim() ?? "";
        expect(first, `${rel}:${name} — first param is "${first}"`).toMatch(
          /^organizationId\s*:/,
        );
      }
    }
  });

  it("filters EVERY read by organizationId", () => {
    // Each `.from(table)` must sit in a query that also mentions the org column.
    //
    // The pattern matches `.select(` with ANY argument, not just `.select()`.
    // It was first written for the bare form, and adding a projected read
    // (`.select({ id, scenarios })` in the calibration sweep) would have slipped
    // past it silently — a tenancy check with a shape-specific pattern quietly
    // stops covering the next query anyone writes.
    for (const rel of CANONICAL_STORES) {
      const src = code(rel);
      const selects = [...src.matchAll(/db\s*\n?\s*\.select\([\s\S]{0,900}?;/g)];
      expect(selects.length, `${rel} has no selects?`).toBeGreaterThan(0);
      for (const [q] of selects) {
        expect(q, `${rel}: a select with no org predicate`).toMatch(
          /eq\(\s*\w+\.organizationId\s*,\s*organizationId\s*\)/,
        );
      }
    }
  });

  it("stamps organizationId on EVERY insert", () => {
    // Two insert shapes exist and both must stamp the tenant:
    //   · inline  — `.insert(t).values({ organizationId, ... })`
    //   · bulk    — `.insert(t).values(rows)` where rows came from a builder
    // The bulk shape is where a tenant key is most easily lost, because the
    // stamping happens somewhere else entirely.
    for (const rel of CANONICAL_STORES) {
      const src = code(rel);
      const inserts = [...src.matchAll(/db\s*\n?\s*\.?\s*insert\(\w+\)\s*\n?\s*\.values\(([\s\S]{0,900}?)\)\s*(\.returning\(\)|;)/g)];
      expect(inserts.length, `${rel} has no inserts?`).toBeGreaterThan(0);
      for (const [, values] of inserts) {
        if (values.includes("{")) {
          expect(values, `${rel}: inline insert does not stamp the tenant`).toContain(
            "organizationId,",
          );
        } else {
          // Bulk: the row builder must take the org and stamp it. Follow it.
          const builder = values.trim();
          const from = src.match(
            new RegExp(`const ${builder} = \\w+\\.map\\(\\(\\w+\\) => (\\w+)\\(organizationId`),
          );
          expect(from, `${rel}: bulk insert rows not built from organizationId`).toBeTruthy();
          const fn = src.slice(src.indexOf(`function ${from![1]}(`));
          expect(fn.slice(0, 700), `${rel}: ${from![1]} does not stamp the tenant`).toContain(
            "organizationId,",
          );
        }
      }
    }
  });

  it("never trusts a caller-supplied organizationId from the request body", () => {
    // The org comes from the authenticated context via getOrganizationId(req),
    // never from JSON. A body-supplied tenant key is impersonation with extra
    // steps, and the zod schemas must not even accept the field.
    for (const rel of ["server/routes-decisions.ts", "server/routes-scenarios.ts"]) {
      const src = code(rel);
      expect(src, rel).toContain("getOrganizationId(req)");
      expect(src, rel).not.toMatch(/organizationId:\s*z\./);
      expect(src, rel).not.toMatch(/req\.body\.organizationId/);
    }
  });
});

describe("cross-layer references cannot cross tenants", () => {
  it("an outcome resolves its decision THROUGH the org, and takes the subject FROM it", () => {
    // Two rules in one call. The org-scoped lookup means org A cannot file an
    // outcome against org B's decision; reading the subject from the decision
    // rather than the caller means an outcome can never claim to be about a
    // different property than the decision it grades.
    const src = code("server/services/outcomes/outcomeStore.ts");
    expect(src).toMatch(/getDecision\(\s*organizationId\s*,/);
    expect(src).toMatch(/subjectType:\s*decision\.body\.subjectType/);
    expect(src).toMatch(/subjectId:\s*decision\.body\.subjectId/);
    // And a missing/foreign decision is refused, not defaulted.
    expect(src).toContain("throw new UnknownDecisionError");
  });

  it("a decision freezes only scenarios its OWN org can read", () => {
    const src = code("server/services/economics/scenarioStore.ts");
    const fn = src.slice(src.indexOf("export async function freezeScenarioRefs"));
    expect(fn).toMatch(/eq\(\s*scenarios\.organizationId\s*,\s*organizationId\s*\)/);
  });

  it("and REFUSES rather than silently recording fewer than it was told", () => {
    // THE DEFECT THIS FILE FOUND. The org scoping was already right — a foreign
    // scenario was never frozen. The RECORD was wrong: unreadable ids were
    // silently skipped, so a decision citing two scenarios (one foreign, or one
    // simply mistyped) was written with one, and describeFooting then reported
    // "1 scenario(s)" as though that had always been the whole story. An
    // incomplete record that reads as complete is the same defect as the
    // frozen-forecast loss, on the record a human reads two years later.
    //
    // The old justification — refusing loudly would leak that the row exists —
    // assumed a choice between leaking and losing. There is a third option:
    // refuse WITHOUT distinguishing.
    const src = code("server/services/economics/scenarioStore.ts");
    expect(src).toMatch(/rows\.length !== wanted\.length/);
    expect(src).toContain("throw new UnavailableScenarioError");
  });

  it("the refusal is not an id-existence oracle", () => {
    // "Belongs to another tenant" and "does not exist" must be indistinguishable
    // from outside, or the error becomes a probe for which sequential ids are
    // real. The message therefore names no id and draws no distinction.
    // Comments stripped: the design NOTE legitimately discusses "belongs to
    // another org" / "does not exist" in explaining why the message must not.
    // What ships to the caller is the string, so the string is what is checked.
    const src = code("server/services/economics/scenarioStore.ts");
    const cls = src.slice(
      src.indexOf("export class UnavailableScenarioError"),
      src.indexOf("export async function freezeScenarioRefs"),
    );
    for (const leaky of ["another organization", "belongs to", "does not exist", "${id}"]) {
      expect(cls.toLowerCase(), `message leaks: ${leaky}`).not.toContain(
        leaky.toLowerCase(),
      );
    }
    expect(cls).toContain("not available in this");
  });

  it("citing the same scenario twice is not treated as a missing one", () => {
    // The de-duplication matters: without it a legitimate duplicate citation
    // would count as "missing" and refuse a valid decision.
    const src = code("server/services/economics/scenarioStore.ts");
    expect(src).toMatch(/new Set\(scenarioIds\)/);
  });

  it("surfaces as a caller error, never a 500", () => {
    const src = code("server/routes-decisions.ts");
    expect(src).toMatch(
      /err instanceof UnavailableScenarioError[\s\S]{0,200}Errors\.badRequest/,
    );
  });
});

describe("the tenant key is never inferable from the data itself", () => {
  it("resolution ignores the org entirely — isolation happens at the QUERY", () => {
    // A deliberate design check. `resolveClaims` is pure and takes no org: it
    // resolves whatever it is handed. That is only safe because every path that
    // produces claims is org-scoped, so the property worth pinning is that
    // nothing in the pure layer tries to filter by tenant and thereby creates a
    // SECOND, weaker isolation boundary that could disagree with the first.
    const src = code("shared/evidence/claim.ts");
    expect(src).not.toMatch(/function resolveClaims[\s\S]{0,1200}organizationId/);

    // Handed two orgs' claims — which cannot happen through the store, but is
    // exactly what a future careless caller would do — it does NOT silently
    // pick one. Both are candidates, and the disagreement surfaces.
    const base = {
      subjectType: "property" as const,
      subjectId: 1,
      predicate: "property.flood_zone",
      provider: "p",
      source: "FEMA NFHL",
      authority: "authoritative" as const,
      observedAt: new Date("2026-01-01T00:00:00Z"),
      fetchedAt: new Date("2026-02-01T00:00:00Z"),
      providerConfidence: null,
      license: null,
      costCents: 0,
    };
    const mixed: EvidenceClaim[] = [
      { ...base, value: "AE", id: 1, organizationId: 1 },
      { ...base, value: "X", id: 2, organizationId: 2, source: "County GIS" },
    ];
    const r = resolveClaims("property.flood_zone", mixed, new Date("2026-03-01T00:00:00Z"));
    expect(r.state).toBe("conflict");
    expect(r).not.toHaveProperty("value");
  });

  it("a frozen decision carries no organization id inside its body", () => {
    // The tenant lives in the ROW, not in the immutable body. A body that
    // carried its own org id would be a second copy of the tenant key that
    // could drift from the column the queries actually filter on.
    const body = freezeDecision(
      {
        subjectType: "property",
        subjectId: 1,
        kind: "offer",
        choice: "c",
        rationale: "r",
        actorType: "user",
        actorRef: "1",
        authority: "owner",
        strategyPackId: null,
        strategyPackVersion: null,
        assumptions: [],
        alternatives: [],
        reviewDueAt: null, // required-nullable: this fixture has no natural review date
      },
      [],
      new Date("2026-03-01T00:00:00Z"),
    );
    expect(JSON.stringify(body)).not.toContain("organizationId");
  });
});

describe("the tenant column is real at the database level", () => {
  it("every canonical table declares organization_id NOT NULL", () => {
    // A nullable tenant key is a row that belongs to everyone. `as any` widening
    // a NOT NULL tenant key has shipped in this repo before (leads.organizationId
    // became `number | undefined`), which is why this is asserted rather than
    // assumed.
    const schemas = [
      "shared/schema/evidence.ts",
      "shared/schema/scenarios.ts",
      "shared/schema/decision-snapshots.ts",
      "shared/schema/outcomes.ts",
      "shared/schema/outward-actions.ts",
    ];
    for (const rel of schemas) {
      const src = read(rel);
      // Slice the org column's OWN declaration — up to the comma that ends it —
      // rather than scanning a fixed window. A window is how this assertion was
      // first written, and a mutation test caught it matching the NEXT column's
      // .notNull(): it passed against a deliberately nullable tenant key. A
      // vacuous tenancy assertion is worse than none, because it reads as proof.
      const start = src.indexOf('organizationId: integer("organization_id")');
      expect(start, `${rel}: no organization_id column`).toBeGreaterThan(-1);
      // Ends at the NEXT column declaration. Ending at the first comma looked
      // right and was not — `.references(..., { onDelete: "cascade" })` contains
      // one, so the slice stopped mid-declaration.
      const after = src.slice(start);
      const next = after.slice(1).search(/\n\s{2,}\w+:\s/);
      const decl = next === -1 ? after : after.slice(0, next + 1);
      expect(decl, `${rel}: organization_id is nullable`).toContain(".notNull()");
      // It must also cascade, so deleting a tenant cannot orphan its records.
      expect(decl, `${rel}: organization_id does not cascade`).toContain(
        'onDelete: "cascade"',
      );
    }
  });

  it("every canonical index leads with the organization column", () => {
    // An index that does not lead with the tenant key invites a scan across
    // tenants — the reason `check-org-leading-index` exists as a lint. Asserted
    // here too, because these five tables are the ones where a cross-tenant read
    // would be frozen into an append-only record.
    for (const rel of [
      "shared/schema/evidence.ts",
      "shared/schema/scenarios.ts",
      "shared/schema/decision-snapshots.ts",
      "shared/schema/outcomes.ts",
    ]) {
      const src = read(rel);
      const indexes = [...src.matchAll(/index\("[^"]+"\)\.on\(([^)]*)\)/g)];
      expect(indexes.length, `${rel} declares no indexes`).toBeGreaterThan(0);
      for (const [, cols] of indexes) {
        expect(cols.trim(), `${rel}: index not org-leading`).toMatch(
          /^t(able)?\.organizationId/,
        );
      }
    }
  });
});
