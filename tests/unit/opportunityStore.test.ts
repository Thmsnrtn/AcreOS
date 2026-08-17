/**
 * The Opportunity read side, and the cross-entity defect it exists to end.
 *
 * THE DEFECT, in the code that shipped before `opportunities` existed
 * (server/services/decisions/decisionStore.ts):
 *
 *     if (input.subjectType === "property" || input.subjectType === "opportunity") {
 *       resolveSubject(organizationId, "property", input.subjectId, …)
 *       resolveSubject(organizationId, "parcel",   input.subjectId, …)
 *     }
 *
 * `opportunity` was a declared subject type in BOTH `SCENARIO_SUBJECT_TYPES`
 * and `DECISION_SUBJECT_TYPES` with no table behind it, so its ids and
 * `properties.id` were the same integer space by accident. A decision recorded
 * against opportunity #5 froze PROPERTY #5's evidence and reported it as the
 * opportunity's own — two unrelated entities, no error raised, and the wrong
 * facts frozen into a record that is immutable by design (canonical law 6).
 *
 * These tests pin the three properties that make that unrepeatable:
 *   1. an opportunity subject is CHECKED against `opportunities`, org-scoped;
 *   2. an unavailable one REFUSES rather than resolving to a stranger's row;
 *   3. the refusal is not an ORACLE — absent and foreign are indistinguishable.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => ({
  state: {
    selectRows: [] as unknown[][],
    insertRows: [] as unknown[][],
    updateRows: [] as unknown[][],
    insertValues: [] as unknown[],
    wheres: [] as unknown[],
  },
}));

vi.mock("../../server/db", () => {
  const s = h.state;
  const nextSelect = () => Promise.resolve(s.selectRows.shift() ?? []);
  const nextUpdate = () => Promise.resolve(s.updateRows.shift() ?? []);
  const selectTail = () => ({
    where: (w: unknown) => {
      s.wheres.push(w);
      return {
        limit: (_n: number) => nextSelect(),
        orderBy: (_o: unknown) => ({ limit: (_n: number) => nextSelect() }),
        then: (ok: (r: unknown[]) => unknown, err?: (e: unknown) => unknown) =>
          nextSelect().then(ok, err),
      };
    },
  });
  const db = {
    select: (_c?: unknown) => ({ from: (_t: unknown) => selectTail() }),
    insert: (_t: unknown) => ({
      values: (v: unknown) => {
        s.insertValues.push(v);
        return { returning: () => Promise.resolve(s.insertRows.shift() ?? []) };
      },
    }),
    update: (_t: unknown) => ({
      set: (_v: unknown) => ({
        where: (_w: unknown) => ({ returning: () => nextUpdate() }),
      }),
    }),
  };
  return { db };
});

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  UnavailableOpportunityError,
  createOpportunity,
  requireOpportunity,
} from "../../server/services/opportunities";
import { normalizeParcelRef } from "../../shared/parcel/parcelRef";

const ORG = 7;

function row(over: Record<string, unknown> = {}) {
  return {
    id: 5,
    organizationId: ORG,
    shapeVersion: 1,
    kind: "acquisition",
    strategy: null,
    parcelState: "TX",
    parcelCounty: "travis",
    parcelApn: "12-345",
    status: "open",
    originType: "manual",
    originRef: null,
    openedAt: new Date("2026-08-17T00:00:00Z"),
    closedAt: null,
    updatedAt: new Date("2026-08-17T00:00:00Z"),
    ...over,
  };
}

/**
 * Every column name referenced by a Drizzle predicate.
 *
 * Walked rather than JSON-stringified: a Drizzle SQL tree is circular (a column
 * points at its table, which points back at its columns), so `JSON.stringify`
 * throws. The WeakSet is what makes the walk terminate; without it this is an
 * infinite descent, not a slow one.
 *
 * NOT DESCENDING INTO `table` IS THE WHOLE POINT. The first version of this
 * helper followed that back-pointer, so from ANY single column it reached the
 * table and collected EVERY column name on it. The org-scoping assertion below
 * then passed against a predicate with no organization_id in it at all —
 * caught by deleting the org clause and watching the test stay green. A helper
 * that answers "yes" for every question is worse than no helper: it reports the
 * absence of tenant scoping as proof of tenant scoping.
 */
function columnNamesIn(node: unknown): string[] {
  const found = new Set<string>();
  const seen = new WeakSet<object>();
  const visit = (n: unknown): void => {
    if (n === null || typeof n !== "object") return;
    if (seen.has(n as object)) return;
    seen.add(n as object);
    const rec = n as Record<string, unknown>;
    // A Drizzle column carries a string `name` alongside a `table` back-pointer.
    if (typeof rec.name === "string" && "table" in rec) found.add(rec.name);
    for (const [key, v] of Object.entries(rec)) {
      if (key === "table") continue; // ← the back-pointer; see above
      visit(v);
    }
  };
  visit(node);
  return [...found];
}

function ref(state = "TX", county = "travis", apn = "12-345") {
  const r = normalizeParcelRef({ state, county, apn });
  if (!r.ok) throw new Error(`bad fixture ref: ${r.problems.join(",")}`);
  return r.ref;
}

beforeEach(() => {
  h.state.selectRows = [];
  h.state.insertRows = [];
  h.state.updateRows = [];
  h.state.insertValues = [];
  h.state.wheres = [];
});

describe("reading an opportunity", () => {
  // Exercised through `requireOpportunity`, the module's exported surface. The
  // underlying reader is module-private precisely because it had no consumer
  // outside this file, and a test is not a consumer — reaching past the public
  // surface to test the private one would re-create the export the
  // reachability gate just removed.
  it("returns the row when the org can read it", async () => {
    h.state.selectRows = [[row()]];
    const got = await requireOpportunity(ORG, 5);
    expect(got.id).toBe(5);
    expect(got.organizationId).toBe(ORG);
  });

  it("scopes every read to the organization", async () => {
    // The predicate is what stops opportunity #5 in another tenant answering
    // for this one. Asserted on the built WHERE rather than on the mock's
    // canned answer, which would agree with any predicate at all.
    h.state.selectRows = [[row()]];
    await requireOpportunity(ORG, 5);
    expect(h.state.wheres.length).toBe(1);
    const names = columnNamesIn(h.state.wheres[0]);
    expect(names, "the read is not scoped by organization_id").toContain("organization_id");
    expect(names, "the predicate does not constrain the row id").toContain("id");
  });
});

describe("requireOpportunity refuses rather than resolving to a stranger", () => {
  it("throws when the id is not readable in this org", async () => {
    h.state.selectRows = [[]];
    await expect(requireOpportunity(ORG, 5)).rejects.toBeInstanceOf(
      UnavailableOpportunityError,
    );
  });

  it("returns the row when it is", async () => {
    h.state.selectRows = [[row()]];
    expect((await requireOpportunity(ORG, 5)).id).toBe(5);
  });

  it("is NOT an oracle — absent and foreign produce the identical message", async () => {
    // Both cases reach this code as "the org-scoped read returned nothing".
    // If the message ever distinguished them, sequential-id probing would tell
    // an attacker which opportunity ids exist in OTHER organizations.
    // Narrowed through a helper rather than `e as Error`: that cast makes the
    // union `OpportunityRow | Error`, and reading `.message` off it is a type
    // error the runtime would never show — precisely what `check:tests` exists
    // to stop. It also means a call that WRONGLY SUCCEEDS is caught here
    // instead of silently comparing two undefined messages.
    const messageOfRefusal = async (id: number): Promise<string> => {
      h.state.selectRows = [[]];
      try {
        await requireOpportunity(ORG, id);
      } catch (e) {
        return (e as Error).message;
      }
      throw new Error(`requireOpportunity(${id}) resolved instead of refusing`);
    };

    const absent = await messageOfRefusal(999_999);
    const foreign = await messageOfRefusal(5);

    expect(absent).toBe(foreign);
    expect(absent).not.toMatch(/\b5\b|999999|another|other org|tenant/i);
  });
});

describe("opening an opportunity", () => {
  it("writes the normalised ParcelRef triple, not the caller's spelling", async () => {
    h.state.insertRows = [[row()]];
    await createOpportunity({
      organizationId: ORG,
      parcel: ref(" tx ", "TRAVIS", " 12-345 "),
      kind: "acquisition",
      originType: "manual",
    });
    const v = h.state.insertValues[0] as Record<string, unknown>;
    expect(v.parcelState).toBe("TX");
    expect(v.parcelCounty).toBe("travis");
    expect(v.parcelApn).toBe("12-345");
  });

  it("never defaults `strategy` — NULL means not yet chosen", async () => {
    // A default would fabricate an intent, and `strategy` is the column that
    // makes two simultaneous evaluations of one parcel distinguishable (BI93).
    h.state.insertRows = [[row()]];
    await createOpportunity({
      organizationId: ORG,
      parcel: ref(),
      kind: "acquisition",
      originType: "radar",
    });
    expect((h.state.insertValues[0] as Record<string, unknown>).strategy).toBeNull();
  });

  it("throws when the insert returns nothing instead of inventing an id", async () => {
    // Returning a fabricated row would hand the caller an id referencing no row.
    h.state.insertRows = [[]];
    await expect(
      createOpportunity({
        organizationId: ORG,
        parcel: ref(),
        kind: "acquisition",
        originType: "manual",
      }),
    ).rejects.toThrow(/returned no row/);
  });
});

describe("the decisionStore branch that used to conflate the two id spaces", () => {
  it("no longer resolves an opportunity subject as a property", async () => {
    // A source assertion, because the alternative — proving a negative through
    // the runtime — would need the whole decision path stood up. What matters
    // is the exact shape that caused the defect: `subjectType === "opportunity"`
    // sharing the `property` branch, and therefore passing an opportunity id to
    // resolveSubject(…, "property", …).
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(
      path.resolve(__dirname, "../../server/services/decisions/decisionStore.ts"),
      "utf8",
    );

    expect(
      src,
      'the "property" and "opportunity" subject types share a branch again — ' +
        "an opportunity id is being resolved as a properties.id",
    ).not.toMatch(/subjectType === "property"\s*\|\|\s*input\.subjectType === "opportunity"/);

    // …and the replacement really is a checked read, not a silent skip.
    expect(src).toContain("requireOpportunity(organizationId, input.subjectId)");
    // Vacuity guard: the branch it belongs to still exists to be checked.
    expect(src).toContain('input.subjectType === "opportunity"');
  });
});
