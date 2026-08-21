/**
 * buyer_profiles.leadId pointed at ANY org's lead, and the matcher read it.
 *
 * `resolveBuyerContact` resolved the buyer's real name and email with
 * `db.select().from(leads).where(eq(leads.id, buyerProfile.leadId))` — a bare
 * primary-key read against a table whose `organization_id` is `NOT NULL`. The
 * profile itself was fetched org-scoped, which is exactly why this looked safe
 * and was not: it is the leadId INSIDE the org-A profile that names the org-B
 * row, and `leadId` is caller-supplied and never ownership-checked
 * (`buyerProfileSchema` constrains it to `z.number().optional()`;
 * `createBuyerProfile` stores it verbatim as `leadId: leadId ?? null`).
 *
 * Reachable in two POSTs by any authenticated member of any org:
 *
 *   POST /api/ai/buyer-matching/profile  { leadId: <an org B lead id> }
 *   POST /api/ai/buyer-matching/match    { propertyId: <own property> }
 *        → matchPropertyToBuyers → resolveBuyerContact(matchedBuyer)
 *        → emitBuyerMatchCreated({ buyerEmail, buyerName, buyerFirstName })
 *
 * so org B's lead email and name were returned to org A and handed to the
 * buyer-match workflow (tpl_buyer_match_found renders them into a message).
 *
 * WHAT THIS FILE PROVES, AND HOW IT CAN FAIL
 * ------------------------------------------
 * Per CLAUDE.md, a gate must be falsified against the SEMANTIC defect, not
 * against the symbol that expressed it. So the `leads` table here is an HONEST
 * DOUBLE: it renders the WHERE expression the service actually emitted, reads
 * the predicates out of the rendered SQL, and applies EXACTLY those and no
 * others — which is what Postgres does. Drop the org predicate and the double
 * hands back the foreign row, the leak reappears in the emitted payload, and
 * these tests fail. Renaming the column, moving the predicate to a variable, or
 * mentioning `organizationId` elsewhere in the method does not help it pass:
 * only a query that constrains `leads.organization_id` to the caller's org
 * filters the foreign lead out.
 *
 * The last test is the anti-vacuity half: a null contact must mean "not this
 * org's lead", not "this code always returns null" — an org's OWN lead still
 * resolves.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

const ORG_A = 7; // the caller
const ORG_B = 99; // the victim
const LEAD_A = 11; // org A's own lead
const LEAD_B = 22; // org B's lead — what the org-A profile points at
const PROPERTY_A = 5; // org A's own property
const PROFILE_A = 1; // org A's own buyer profile

const state = vi.hoisted(() => ({
  leads: [] as Array<{
    id: number;
    organizationId: number;
    firstName: string;
    lastName: string;
    email: string;
  }>,
  properties: [] as any[],
  buyerProfiles: [] as any[],
  lastLeadsWhere: undefined as unknown,
  emitted: [] as any[],
}));

vi.mock("../../server/db", async () => {
  const { PgDialect: Dialect } = await import("drizzle-orm/pg-core");
  const { getTableName } = await import("drizzle-orm");
  const dialect = new Dialect();

  // Column → accessor for the honest `leads` double. Anything the query pins
  // that is not listed here filters everything out rather than being ignored,
  // so an unrecognised predicate can never widen the result set silently.
  const LEAD_COLUMNS: Record<string, (row: any) => unknown> = {
    id: (r) => r.id,
    organization_id: (r) => r.organizationId,
    email: (r) => r.email,
  };

  /**
   * Apply the predicates the SERVICE emitted — all of them, only them. This is
   * the whole point of the file: a query that names only `leads.id` selects
   * across every tenant here exactly as it does in Postgres.
   */
  const selectLeads = (expr: unknown) => {
    state.lastLeadsWhere = expr;
    const { sql, params } = dialect.sqlToQuery(expr as SQL);
    const pinned: Array<[string, unknown]> = [];
    for (const m of sql.matchAll(/"leads"\."([a-z_]+)"\s*=\s*\$(\d+)/g)) {
      pinned.push([m[1], params[Number(m[2]) - 1]]);
    }
    return state.leads.filter((row) =>
      pinned.every(([col, value]) => {
        const read = LEAD_COLUMNS[col];
        return read ? read(row) === value : false;
      }),
    );
  };

  const rowsFor = (table: any, expr: unknown) => {
    switch (getTableName(table)) {
      case "leads":
        return selectLeads(expr);
      case "properties":
        return state.properties;
      case "buyer_profiles":
        return state.buyerProfiles;
      default:
        return []; // no pre-existing buyer_property_matches → the fresh-insert branch
    }
  };

  // `.where(...)` is awaited directly in some call sites and `.limit(1)`-ed in
  // others, so the result is a thenable that also carries the chain methods.
  const result = (rows: any[]): any => {
    const p: any = Promise.resolve(rows);
    p.limit = async () => rows;
    p.orderBy = () => result(rows);
    return p;
  };

  let nextId = 1000;

  return {
    db: {
      select: () => ({
        from: (table: any) => ({
          where: (expr: unknown) => result(rowsFor(table, expr)),
        }),
      }),
      insert: () => ({
        values: (values: any) => {
          const row = { id: (nextId += 1), ...values };
          const p: any = Promise.resolve([row]);
          p.returning = async () => [row];
          p.onConflictDoUpdate = () => ({ catch: () => Promise.resolve() });
          return p;
        },
      }),
      update: () => ({
        set: () => ({ where: () => ({ returning: async () => [] }) }),
      }),
    },
  };
});

vi.mock("../../server/services/buyerEvents", () => ({
  emitBuyerMatchCreated: (match: any, context: any) => {
    state.emitted.push({ match, ...context });
  },
}));

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { BuyerMatchingAIService } from "../../server/services/buyerMatchingAI";

const dialect = new PgDialect();

/** An org-A property any reasonable buyer profile scores well above 40 on. */
function orgAProperty() {
  return {
    id: PROPERTY_A,
    organizationId: ORG_A,
    status: "listed",
    address: "1 Farm Rd",
    county: "Travis",
    state: "TX",
    listPrice: "100000",
    marketValue: "100000",
    sizeAcres: "10",
    zoning: "agricultural",
    roadAccess: "paved",
    terrain: "flat",
    utilities: { electric: true },
    description: "Ten acres",
  };
}

/** An org-A buyer profile whose leadId names `leadId` (org B's, in the leak case). */
function orgAProfile(leadId: number) {
  return {
    id: PROFILE_A,
    organizationId: ORG_A,
    leadId,
    profileType: "investor",
    isActive: true,
    preferences: {
      minAcreage: 5,
      maxAcreage: 20,
      states: ["TX"],
      counties: ["Travis"],
      zoningTypes: ["agricultural"],
    },
    financialInfo: { budget: 120000, financingType: "cash" },
    intent: {},
  };
}

beforeEach(() => {
  state.leads = [
    { id: LEAD_A, organizationId: ORG_A, firstName: "Own", lastName: "Buyer", email: "own@orga.example" },
    { id: LEAD_B, organizationId: ORG_B, firstName: "Victim", lastName: "OrgB", email: "victim@orgb.example" },
  ];
  state.properties = [orgAProperty()];
  state.buyerProfiles = [];
  state.lastLeadsWhere = undefined;
  state.emitted = [];
});

describe("buyer-match contact resolution is org-scoped", () => {
  it("does not leak another org's lead through matchPropertyToBuyers (POST /buyer-matching/match)", async () => {
    state.buyerProfiles = [orgAProfile(LEAD_B)];

    await new BuyerMatchingAIService().matchPropertyToBuyers(ORG_A, PROPERTY_A);

    expect(state.emitted, "the fresh-insert branch must have emitted a match").toHaveLength(1);
    const payload = state.emitted[0];
    expect(
      payload.buyerEmail,
      "org B's lead email reached org A's buyer-match payload — the leads lookup is not org-scoped",
    ).toBeNull();
    expect(payload.buyerName).toBeNull();
    expect(payload.buyerFirstName).toBeNull();
    expect(JSON.stringify(payload)).not.toContain("victim@orgb.example");
    expect(JSON.stringify(payload)).not.toContain("Victim");
  });

  it("pins leads.organization_id to the CALLER's org in the emitted WHERE clause", async () => {
    state.buyerProfiles = [orgAProfile(LEAD_B)];

    await new BuyerMatchingAIService().matchPropertyToBuyers(ORG_A, PROPERTY_A);

    expect(state.lastLeadsWhere, "no leads lookup was made at all").toBeDefined();
    const rendered = dialect.sqlToQuery(state.lastLeadsWhere as SQL);
    expect(rendered.sql).toContain("organization_id");
    expect(rendered.params).toContain(ORG_A);
    expect(rendered.params).toContain(LEAD_B);
    expect(rendered.params, "the VICTIM's org must never be the pinned org").not.toContain(ORG_B);
  });

  it("does not leak another org's lead through matchBuyerToProperties either", async () => {
    // The second call site of resolveBuyerContact. Wave discipline: fixing the
    // path the report named while leaving its twin open is this repo's most
    // common defect shape.
    state.buyerProfiles = [orgAProfile(LEAD_B)];

    await new BuyerMatchingAIService().matchBuyerToProperties(ORG_A, PROFILE_A);

    expect(state.emitted).toHaveLength(1);
    expect(state.emitted[0].buyerEmail).toBeNull();
    expect(state.emitted[0].buyerFirstName).toBeNull();
    const rendered = dialect.sqlToQuery(state.lastLeadsWhere as SQL);
    expect(rendered.sql).toContain("organization_id");
    expect(rendered.params).toContain(ORG_A);
  });

  it("still resolves the org's OWN lead — a null contact means foreign, not broken", async () => {
    state.buyerProfiles = [orgAProfile(LEAD_A)];

    await new BuyerMatchingAIService().matchPropertyToBuyers(ORG_A, PROPERTY_A);

    expect(state.emitted).toHaveLength(1);
    expect(state.emitted[0].buyerEmail).toBe("own@orga.example");
    expect(state.emitted[0].buyerName).toBe("Own Buyer");
    expect(state.emitted[0].buyerFirstName).toBe("Own");
  });
});
