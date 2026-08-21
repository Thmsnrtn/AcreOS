/**
 * A payment posted by org A may not rewrite org B's note.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 * `POST /api/payments` (server/routes-finance.ts) is `isAuthenticated` +
 * `getOrCreateOrg`, and it FORCES the tenant key onto the row it writes:
 *
 *     insertPaymentSchema.safeParse({ ...req.body, organizationId: org.id })
 *
 * `noteId`, however, comes straight out of `req.body` and was never checked
 * against that org — unlike the sibling note routes in the same file, which
 * call `storage.getNote(org.id, noteId)` first. `storage.createPayment` then
 * carried the org into the INSERT and dropped it for the two queries that
 * MUTATE the loan book:
 *
 *     await tx.select().from(notes).where(eq(notes.id, payment.noteId)).for("update");
 *     await tx.update(notes).set({ … }).where(and(eq(notes.id, payment.noteId),
 *                                                 eq(notes.version, note.version ?? 1)));
 *
 * `notes.organization_id` is NOT NULL and note ids are sequential integers, so
 * an authenticated member of any org could post `{ noteId: <another org's id>,
 * status: "completed", principalAmount: N }` and reduce that org's balance,
 * flip its status to `paid_off` at zero, and bump its version. A cross-tenant
 * WRITE, on the money path, needing no discovery.
 *
 * Nothing in the database stopped it either: `payments.organization_id` and
 * `payments.note_id` are two independent foreign keys, and no CHECK or trigger
 * ties one to the other (grep over migrations/*.sql finds none). The tenancy
 * lint could not see it: `check-org-scoped-fetch` rule 1 asks whether a unit
 * MENTIONS an org, and `createPayment` mentioned none at all, so it sat in the
 * weaker register — the same way `estimatePropertyValue` did in
 * `ltvTenancy.test.ts`.
 *
 * ── WHAT THIS FILE PROVES ───────────────────────────────────────────────────
 * Behaviour, not vocabulary. The fake transaction below is an HONEST postgres:
 * it holds rows for two organizations and answers a query by EVALUATING its
 * predicate against them, the way the server would. A query that omits the org
 * therefore FINDS the other tenant's note — exactly as production did — and the
 * balance assertions below fail. Asserting that the source contains the string
 * `organizationId` would pass against a predicate built on the wrong value; a
 * storage double that filters by org for free would pass against no predicate
 * at all. Both were rejected for this reason.
 *
 * The one clause a purely behavioural test cannot see is the org predicate on
 * the UPDATE: with the SELECT scoped, an unscoped UPDATE is unreachable through
 * this path, so removing it changes nothing observable. That clause is pinned
 * against the EMITTED predicate of the update itself (the drizzle SQL object
 * this method actually hands the driver), not against the file's text.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { getTableColumns, getTableName } from "drizzle-orm";
import { notes, payments } from "@shared/schema";

const VICTIM_ORG = 7;
const ATTACKER_ORG = 42;

const VICTIM_NOTE_ID = 1;
const ATTACKER_NOTE_ID = 2;

type Row = Record<string, unknown>;

/** DB column name (`organization_id`) → drizzle/TS key (`organizationId`). */
function keyByColumnName(table: typeof notes | typeof payments): Map<string, string> {
  const map = new Map<string, string>();
  for (const [tsKey, col] of Object.entries(getTableColumns(table as any))) {
    map.set((col as { name: string }).name, tsKey);
  }
  return map;
}

/**
 * Flatten a drizzle predicate into the equalities it binds, as
 * [column name, value] pairs. `eq(col, v)` emits [Column, StringChunk, Param];
 * `and(...)` nests SQL objects with their own `queryChunks`.
 */
function equalities(node: unknown): Array<[string, unknown]> {
  const tokens: Array<{ kind: "col" | "param"; v: unknown }> = [];
  const walk = (n: any): void => {
    if (n === null || typeof n !== "object") return;
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (typeof n.name === "string" && n.table !== undefined) { tokens.push({ kind: "col", v: n.name }); return; }
    if ("encoder" in n && "value" in n) { tokens.push({ kind: "param", v: n.value }); return; }
    if (Array.isArray(n.queryChunks)) { n.queryChunks.forEach(walk); return; }
  };
  walk(node);
  const out: Array<[string, unknown]> = [];
  for (let i = 0; i < tokens.length - 1; i++) {
    if (tokens[i].kind === "col" && tokens[i + 1].kind === "param") {
      out.push([String(tokens[i].v), tokens[i + 1].v]);
    }
  }
  return out;
}

/**
 * Honest row matching: a row is returned when it satisfies EVERY equality the
 * predicate binds — i.e. what postgres would do with `WHERE a = $1 AND b = $2`.
 * A predicate that binds nothing matches the whole table, which is the point:
 * an unscoped query sees other tenants' rows here exactly as it does in prod.
 */
function rowMatches(row: Row, predicate: unknown, table: typeof notes | typeof payments): boolean {
  const keys = keyByColumnName(table);
  return equalities(predicate).every(([colName, value]) => {
    const tsKey = keys.get(colName);
    if (!tsKey) return false;
    return String(row[tsKey]) === String(value);
  });
}

interface Harness {
  noteRows: Row[];
  inserted: Row[];
  noteSelectPredicates: unknown[];
  noteUpdatePredicates: unknown[];
}

function makeHarness(): Harness {
  return {
    noteRows: [
      {
        id: VICTIM_NOTE_ID, organizationId: VICTIM_ORG, currentBalance: "100000",
        status: "active", version: 1, updatedAt: null,
      },
      {
        id: ATTACKER_NOTE_ID, organizationId: ATTACKER_ORG, currentBalance: "50000",
        status: "active", version: 1, updatedAt: null,
      },
    ],
    inserted: [],
    noteSelectPredicates: [],
    noteUpdatePredicates: [],
  };
}

/** A `tx` shaped like drizzle's, backed by `h.noteRows`. */
function makeTx(h: Harness) {
  return {
    insert(table: any) {
      return {
        values(v: Row) {
          return {
            returning: async () => {
              const row = { id: h.inserted.length + 100, ...v };
              if (getTableName(table) === "payments") h.inserted.push(row);
              return [row];
            },
          };
        },
      };
    },
    select() {
      let table: any = null;
      let predicate: unknown = undefined;
      const self: any = {
        from(t: any) { table = t; return self; },
        where(p: unknown) { predicate = p; return self; },
        for() { return self; },
        then(resolve: (v: unknown) => void) {
          if (getTableName(table) === "notes") h.noteSelectPredicates.push(predicate);
          resolve(h.noteRows.filter((r) => rowMatches(r, predicate, table)).map((r) => ({ ...r })));
        },
      };
      return self;
    },
    update(table: any) {
      let patch: Row = {};
      const self: any = {
        set(p: Row) { patch = p; return self; },
        where(predicate: unknown) {
          if (getTableName(table) === "notes") h.noteUpdatePredicates.push(predicate);
          return {
            returning: async () => {
              const hit = h.noteRows.filter((r) => rowMatches(r, predicate, table));
              for (const r of hit) Object.assign(r, patch);
              return hit.map((r) => ({ ...r }));
            },
          };
        },
      };
      return self;
    },
  };
}

async function createPaymentWith(h: Harness, payment: Row) {
  vi.resetModules();
  vi.doMock("../../server/db", () => ({
    db: {},
    withTransaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(makeTx(h)),
  }));
  const { noteRepo } = await import("../../server/storage/noteRepo");
  return (noteRepo.createPayment as any).call({}, payment);
}

const completedPayment = (orgId: number, noteId: number) => ({
  organizationId: orgId,
  noteId,
  amount: "10000",
  principalAmount: "10000",
  interestAmount: "0",
  paymentDate: new Date("2026-08-21T00:00:00Z"),
  dueDate: new Date("2026-08-21T00:00:00Z"),
  status: "completed",
});

beforeEach(() => vi.resetModules());

describe("storage.createPayment scopes the note it mutates", () => {
  it("THE OWNING ORG STILL POSTS PAYMENTS — vacuity guard", async () => {
    // If the org predicate broke the happy path, every assertion below would
    // pass while the payment rail was dead.
    const h = makeHarness();
    await createPaymentWith(h, completedPayment(ATTACKER_ORG, ATTACKER_NOTE_ID));

    const own = h.noteRows.find((r) => r.id === ATTACKER_NOTE_ID)!;
    expect(own.currentBalance, "the org can no longer pay down its own note").toBe("40000");
    expect(own.version, "the optimistic-lock version did not advance").toBe(2);
    expect(h.inserted).toHaveLength(1);
  });

  it("ANOTHER ORG'S NOTE IS NOT TOUCHED — the cross-tenant write", async () => {
    const h = makeHarness();
    const before = { ...h.noteRows.find((r) => r.id === VICTIM_NOTE_ID)! };

    // Org A posts a completed payment naming org B's note id — the exact
    // request body `POST /api/payments` accepts, since it forces
    // organizationId and takes noteId verbatim.
    await createPaymentWith(h, completedPayment(ATTACKER_ORG, VICTIM_NOTE_ID));

    const after = h.noteRows.find((r) => r.id === VICTIM_NOTE_ID)!;
    expect(after.currentBalance, "org B's balance was rewritten by org A").toBe(before.currentBalance);
    expect(after.status, "org B's note status was rewritten by org A").toBe(before.status);
    expect(after.version, "org B's note version was bumped by org A").toBe(before.version);
  });

  it("PAYING OFF ANOTHER ORG'S NOTE DOES NOT FLIP IT TO paid_off", async () => {
    // The severe end of the same defect: principal >= balance flips the
    // victim's note to "paid_off" and zeroes it.
    const h = makeHarness();
    await createPaymentWith(h, {
      ...completedPayment(ATTACKER_ORG, VICTIM_NOTE_ID),
      amount: "100000",
      principalAmount: "100000",
    });

    const after = h.noteRows.find((r) => r.id === VICTIM_NOTE_ID)!;
    expect(after.status, "org A paid off org B's loan").toBe("active");
    expect(after.currentBalance).toBe("100000");
  });

  it("EVERY note QUERY IT EMITS BINDS organization_id TO THE PAYMENT'S ORG", async () => {
    // The UPDATE's own clause: unreachable behaviourally once the SELECT is
    // scoped, so it is pinned against the predicate the method actually emits.
    const h = makeHarness();
    await createPaymentWith(h, completedPayment(ATTACKER_ORG, ATTACKER_NOTE_ID));

    expect(h.noteSelectPredicates, "the FOR UPDATE select never ran").toHaveLength(1);
    expect(h.noteUpdatePredicates, "the balance update never ran").toHaveLength(1);

    for (const predicate of [...h.noteSelectPredicates, ...h.noteUpdatePredicates]) {
      const bound = equalities(predicate)
        .filter(([col]) => col === "organization_id")
        .map(([, value]) => value);
      expect(bound, "a notes query carries no organization_id predicate").toContain(ATTACKER_ORG);
    }
  });
});
