/**
 * An LTV snapshot belongs to the org that owns the note.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 * `GET /api/finance/ltv/:noteId` is `isAuthenticated` + `getOrCreateOrg`, and
 * then called `getLTVSnapshot(parseInt(req.params.noteId))` — a service method
 * that resolved the note by PRIMARY KEY alone:
 *
 *     const [note] = await db.select().from(notes).where(eq(notes.id, noteId));
 *
 * `notes.organization_id` is NOT NULL. So any authenticated user of any
 * organization could read any other tenant's note by typing its id: current
 * balance, estimated property value, LTV, risk level and the alert text. The
 * whole chain below it took ids and no org — `calculateCurrentBalance(noteId)`,
 * `estimatePropertyValue(propertyId)` — while `getOrgLTVReport(orgId)`, the only
 * entry point that HAD the org, scoped its own query and then dropped it.
 *
 * ── HOW IT STAYED HIDDEN ────────────────────────────────────────────────────
 * Worth recording, because it is a property of the gate rather than the code.
 * `check-org-scoped-fetch` has two rules: rule 1 flags a function that touches
 * an org-scoped table with NO org context anywhere in its text; rule 2 flags one
 * that HAS an org and resolves by primary key anyway. `estimatePropertyValue`
 * mentioned no org at all, so it sat in rule 1's baseline — the weaker register.
 * Adding an org predicate to a SIBLING query (the parcel-snapshot visibility
 * fix) gave the function org context, which promoted it into rule 2 and made
 * the primary-key read visible.
 *
 * A completely unscoped function was therefore LESS visible to the tenancy lint
 * than a partly scoped one, and the baseline had been holding it quiet.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { getTableName, type SQL } from "drizzle-orm";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");

/** Flatten a drizzle predicate into the (column → values) it binds. */
function bound(node: unknown, column: string): unknown[] {
  const out: unknown[] = [];
  const tokens: Array<{ kind: "col" | "param"; v: unknown }> = [];
  const walk = (n: any): void => {
    if (n === null || typeof n !== "object") return;
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (typeof n.name === "string" && n.table !== undefined) { tokens.push({ kind: "col", v: n.name }); return; }
    if ("encoder" in n && "value" in n) { tokens.push({ kind: "param", v: n.value }); return; }
    if (Array.isArray(n.queryChunks)) { n.queryChunks.forEach(walk); return; }
  };
  walk(node);
  for (let i = 0; i < tokens.length - 1; i++) {
    if (tokens[i].kind === "col" && tokens[i].v === column && tokens[i + 1].kind === "param") {
      out.push(tokens[i + 1].v);
    }
  }
  return out;
}

interface Ask { table: string; where: unknown }

/**
 * A fake db that returns rows ONLY when the query actually scopes to the org it
 * is asked about — the behavioural equivalent of a second tenant's data being
 * absent. A query that omits the predicate finds nothing, so a caller relying on
 * a bare primary-key match gets null rather than another org's row.
 */
function makeDb(asks: Ask[], rowsFor: (t: string) => unknown[], visibleOrg: number) {
  const chain = () => {
    const state: Ask = { table: "", where: undefined };
    const self: any = {
      from(t: any) { state.table = getTableName(t); return self; },
      innerJoin() { return self; },
      where(p: SQL) { state.where = p; return self; },
      orderBy() { return self; },
      limit() { return self; },
      then(resolve: (v: unknown) => void) {
        asks.push({ ...state });
        const orgs = bound(state.where, "organization_id");
        const scoped = orgs.includes(visibleOrg);
        resolve(scoped ? rowsFor(state.table) : []);
      },
    };
    return self;
  };
  return { select: () => chain() };
}

const OWNER_ORG = 7;
const ATTACKER_ORG = 99;

const ROWS: Record<string, unknown[]> = {
  notes: [{ id: 1, organizationId: OWNER_ORG, propertyId: 5, originalPrincipal: "100000", interestRate: "6", monthlyPayment: "1000" }],
  payments: [],
  properties: [{ id: 5, organizationId: OWNER_ORG, apn: "123-45", state: "CO", county: "Denver" }],
  parcel_snapshots: [{ id: 9, organizationId: null, assessedValue: "250000" }],
};

async function snapshotFor(callerOrg: number) {
  vi.resetModules();
  const asks: Ask[] = [];
  vi.doMock("../../server/db", () => ({
    db: makeDb(asks, (t) => ROWS[t] ?? [], OWNER_ORG),
  }));
  const { ltvMonitorService } = await import("../../server/services/ltvMonitor");
  const snapshot = await ltvMonitorService.getLTVSnapshot(1, callerOrg);
  return { snapshot, asks };
}

beforeEach(() => vi.resetModules());

describe("a note outside the caller's organization is not readable", () => {
  it("THE OWNING ORG GETS ITS SNAPSHOT", async () => {
    // Vacuity guard first: if the scoping broke the happy path, every assertion
    // below would pass while the feature was dead.
    const { snapshot } = await snapshotFor(OWNER_ORG);
    expect(snapshot, "the owning org can no longer read its own note").not.toBeNull();
    expect(snapshot?.noteId).toBe(1);
  });

  it("ANOTHER ORG GETS NOTHING", async () => {
    const { snapshot } = await snapshotFor(ATTACKER_ORG);
    expect(
      snapshot,
      "a note belonging to another organization was returned — balance, property " +
        "value, LTV and risk alerts included",
    ).toBeNull();
  });

  it("every table it reads is bound to the caller's organization", async () => {
    // The semantic check, over the queries actually issued rather than over the
    // source text: no read may resolve an org-scoped row without naming the org.
    const { asks } = await snapshotFor(OWNER_ORG);
    const scoped = ["notes", "payments", "properties"];
    for (const t of scoped) {
      const forTable = asks.filter((a) => a.table === t);
      expect(forTable.length, `${t} was never read — the fixture stopped exercising it`).toBeGreaterThan(0);
      for (const a of forTable) {
        expect(
          bound(a.where, "organization_id"),
          `${t} was resolved without an organization predicate`,
        ).toContain(OWNER_ORG);
      }
    }
  });

  it("the shared parcel cache is still reachable, and still not by primary key alone", async () => {
    // parcel_snapshots is the one table whose rows may be global. It must stay
    // readable (the fix must not blank the LTV) while never matching on
    // apn+state+county alone — see parcelSnapshotVisibility.test.ts.
    const { asks } = await snapshotFor(OWNER_ORG);
    const snaps = asks.filter((a) => a.table === "parcel_snapshots");
    expect(snaps.length).toBeGreaterThan(0);
    expect(bound(snaps[0].where, "organization_id")).toContain(OWNER_ORG);
  });
});

describe("the route hands the org down", () => {
  it("GET /api/finance/ltv/:noteId passes the caller's organization", () => {
    // The service being scoped is inert if the route calls it with one argument.
    const src = fs.readFileSync(path.join(ROOT, "server/routes-finance.ts"), "utf8");
    const at = src.indexOf('"/api/finance/ltv/:noteId"');
    expect(at, "the LTV route moved — re-adjudicate this check").toBeGreaterThan(0);
    const handler = src.slice(at, at + 900);
    expect(handler).toMatch(/getLTVSnapshot\([\s\S]*?organizationId/);
    expect(
      handler,
      "the route resolves the note id with no organization argument",
    ).not.toMatch(/getLTVSnapshot\(\s*parseInt\(req\.params\.noteId\)\s*\)/);
  });
});
