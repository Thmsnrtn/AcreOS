/**
 * Invalidation-registry honesty + optimistic-create house pattern
 * (master-handoff P1 §2.1, Wave 1).
 *
 * The registry (client/src/lib/query-keys.ts: QK + RELATED +
 * invalidateRelated/relatedKeys) shipped earlier but was built-but-unwired
 * — zero imports anywhere — while every mutation hook hand-rolled its own
 * invalidateQueries fan-out and the primary Today door went stale after
 * creates (audit F-11-1). This suite pins the fix in DERIVED form so it
 * cannot silently regress:
 *
 *   1. Every path the registry names must exist as a real "/api/…" string
 *      literal in client/src — the registry describes actual query usage,
 *      never invented keys (refuse-not-fabricate applies to code too; the
 *      stale `sparklines` entry was removed under this rule).
 *   2. Every RELATED entity fans out to the Today door key ("/api/today")
 *      — the consolidated payload derives from all of them, and the
 *      primary customer door must never go stale after a mutation.
 *   3. The core CRUD hooks (use-leads, use-deals, use-properties,
 *      use-notes) actually go through the registry — adoption cannot
 *      silently un-wire back to hand-rolled lists.
 *   4. The optimistic-CREATE helpers behind the useCreateLead exemplar
 *      insert-then-reconcile correctly across all three list cache shapes
 *      (flat array / paginated {data} / infinite {pages}) and roll back
 *      from snapshots — the mechanics that make "create a lead → visible
 *      on Today instantly" true.
 *
 * idempotent: true — pure QueryClient + filesystem scan, no DATABASE_URL.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { QueryClient } from "@tanstack/react-query";

import { QK, RELATED, invalidateRelated, relatedKeys } from "../../client/src/lib/query-keys";
import {
  insertIntoListCaches,
  reconcileCreatedRow,
} from "../../client/src/lib/optimistic-mutation";

const CLIENT_SRC = path.resolve(__dirname, "../../client/src");
const REGISTRY_FILE = path.resolve(CLIENT_SRC, "lib/query-keys.ts");

// ── Codebase scan: every "/api/…" string-literal head in client/src ──────
// Template literals contribute their static head (`/api/leads/${id}/sms`
// yields "/api/leads/"), which is exactly what prefix matching needs.
function collectApiLiterals(): Set<string> {
  const literals = new Set<string>();
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules") continue;
        walk(full);
      } else if (/\.(ts|tsx)$/.test(entry.name)) {
        if (full === REGISTRY_FILE) continue; // the registry can't vouch for itself
        const src = fs.readFileSync(full, "utf8");
        for (const m of src.matchAll(/["'`](\/api\/[^"'`\s${}]*)/g)) {
          literals.add(m[1]);
        }
      }
    }
  };
  walk(CLIENT_SRC);
  return literals;
}

const usageLiterals = collectApiLiterals();

function isUsedPath(p: string): boolean {
  if (usageLiterals.has(p)) return true;
  for (const u of usageLiterals) {
    if (u.startsWith(`${p}/`) || u.startsWith(`${p}?`)) return true;
  }
  return false;
}

// Flatten QK to [label, path] pairs. Function leaves are invoked with a
// sentinel id; a produced path embedding the sentinel is dynamic (e.g.
// `/api/leads/9871234560/sms`) — reduce it to its static head before "/9…".
const SENTINEL = 9871234560;
function qkPaths(): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const [group, leaves] of Object.entries(QK)) {
    for (const [name, leaf] of Object.entries(leaves as Record<string, unknown>)) {
      const key =
        typeof leaf === "function"
          ? (leaf as (...args: unknown[]) => readonly unknown[])(SENTINEL, SENTINEL)
          : (leaf as readonly unknown[]);
      const head = key[0];
      if (typeof head !== "string") continue;
      const staticHead = head.includes(String(SENTINEL))
        ? head.slice(0, head.indexOf(String(SENTINEL)))
        : head;
      out.push([`QK.${group}.${name}`, staticHead.replace(/\/$/, "")]);
    }
  }
  return out;
}

describe("invalidation registry — keys derived from real usage", () => {
  it("every QK path exists as a real query literal in client/src", () => {
    const missing = qkPaths().filter(([, p]) => !isUsedPath(p));
    expect(
      missing,
      `Registry keys with no real usage in client/src (invented or stale — remove or fix them): ${missing
        .map(([label, p]) => `${label} → ${p}`)
        .join(", ")}`,
    ).toEqual([]);
  });

  it("every RELATED fan-out key exists as a real query literal in client/src", () => {
    const missing: string[] = [];
    for (const [entity, keys] of Object.entries(RELATED)) {
      for (const key of keys) {
        const p = key[0];
        if (typeof p === "string" && !isUsedPath(p)) {
          missing.push(`${entity} → ${p}`);
        }
      }
    }
    expect(missing, `RELATED names keys nothing queries: ${missing.join(", ")}`).toEqual([]);
  });

  it("every RELATED entity invalidates the Today door (/api/today) — audit F-11-1", () => {
    const entities = Object.keys(RELATED);
    expect(entities.length).toBeGreaterThanOrEqual(6); // lead/deal/property/task/campaign/note
    for (const entity of entities) {
      const paths = RELATED[entity].map((k) => k[0]);
      expect(paths, `RELATED["${entity}"] must include the Today door key`).toContain("/api/today");
    }
  });

  it("covers the core CRUD entities", () => {
    for (const entity of ["lead", "deal", "property", "task", "campaign", "note"]) {
      expect(relatedKeys(entity).length, `RELATED["${entity}"] missing or empty`).toBeGreaterThan(0);
    }
  });

  it("invalidateRelated fans out to every registered key (and only prefix-invalidates)", () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    // Seed one cache entry per lead-related key, plus one unrelated key.
    for (const key of relatedKeys("lead")) {
      qc.setQueryData(key as unknown[], { seeded: true });
    }
    qc.setQueryData(["/api/unrelated"], { seeded: true });

    invalidateRelated("lead", qc);

    for (const key of relatedKeys("lead")) {
      const state = qc.getQueryState(key as unknown[]);
      expect(state?.isInvalidated, `key ${String(key[0])} not invalidated`).toBe(true);
    }
    expect(qc.getQueryState(["/api/unrelated"])?.isInvalidated).toBe(false);
  });
});

describe("registry adoption — core hooks are wired (cannot silently un-wire)", () => {
  const HOOKS = [
    "hooks/use-leads.ts",
    "hooks/use-deals.ts",
    "hooks/use-properties.ts",
    "hooks/use-notes.ts",
  ];

  for (const rel of HOOKS) {
    it(`${rel} goes through invalidateRelated/relatedKeys`, () => {
      const src = fs.readFileSync(path.join(CLIENT_SRC, rel), "utf8");
      expect(
        /\binvalidateRelated\(|\brelatedKeys\(/.test(src),
        `${rel} no longer uses the registry — hand-rolled fan-outs regress audit F-11-1`,
      ).toBe(true);
    });
  }

  it("useCreateLead is the optimistic-create exemplar", () => {
    const src = fs.readFileSync(path.join(CLIENT_SRC, "hooks/use-leads.ts"), "utf8");
    expect(src).toMatch(/useOptimisticCreate/);
  });
});

// ── Optimistic CREATE: insert-then-reconcile mechanics ───────────────────
// These exercise the exported helpers behind useOptimisticCreate against a
// real QueryClient — the same approach optimistic-mutation.test.ts uses
// for the update factory. The three cache shapes mirror the real leads
// caches: bare list, useLeadsPaginated {data}, and the "infinite-flat"
// {pages} cache the Today door renders.

type Snapshot = [readonly unknown[], unknown];

function makeClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function seedLeadCaches(qc: QueryClient) {
  const existing = { id: 1, firstName: "Existing", lastName: "Lead" };
  qc.setQueryData(["/api/leads"], [existing]);
  qc.setQueryData(["/api/leads", "paginated", 1, 25], {
    data: [existing],
    total: 1,
    page: 1,
    pageSize: 25,
    totalPages: 1,
  });
  qc.setQueryData(["/api/leads", "infinite-flat"], {
    pages: [{ data: [existing], nextCursor: null, hasMore: false, total: 1 }],
    pageParams: [undefined],
  });
  // A detail-shaped cache under the same prefix — must NOT be touched.
  qc.setQueryData(["/api/leads", 1], existing);
  return existing;
}

describe("optimistic create — insert", () => {
  it("inserts the temp row at the head of all three list shapes and snapshots each", () => {
    const qc = makeClient();
    seedLeadCaches(qc);
    const tempRow = { id: -1723300000000, firstName: "New", _optimistic: true };

    const snapshots: Snapshot[] = [];
    insertIntoListCaches(qc, [["/api/leads"]], tempRow, snapshots);

    expect((qc.getQueryData(["/api/leads"]) as unknown[])[0]).toEqual(tempRow);
    const paginated = qc.getQueryData(["/api/leads", "paginated", 1, 25]) as any;
    expect(paginated.data[0]).toEqual(tempRow);
    expect(paginated.total).toBe(2); // count honesty: total tracks the insert
    const infinite = qc.getQueryData(["/api/leads", "infinite-flat"]) as any;
    expect(infinite.pages[0].data[0]).toEqual(tempRow);
    expect(infinite.pageParams).toEqual([undefined]); // envelope preserved

    // Detail cache untouched, and not snapshotted.
    expect(qc.getQueryData(["/api/leads", 1])).toEqual({ id: 1, firstName: "Existing", lastName: "Lead" });
    expect(snapshots).toHaveLength(3);
  });

  it("NEVER inserts into foreign caches that merely prefix-match the list key (fleet-5 audit)", () => {
    // ["/api/leads", <id>, "score-history"] prefix-matches ["/api/leads"] but
    // caches ScoreHistory[], not leads — the audit reproduced a lead row
    // landing at its head. Only the exact key and the registered list
    // variants (paginated/infinite-flat, whatever params follow the marker)
    // may receive the optimistic row.
    const qc = makeClient();
    seedLeadCaches(qc);
    const history = [{ score: 82, factors: ["acreage"], at: "2026-08-01" }];
    qc.setQueryData(["/api/leads", 1, "score-history"], history);

    const snapshots: Snapshot[] = [];
    insertIntoListCaches(qc, [["/api/leads"]], { id: -3, _optimistic: true }, snapshots);

    expect(qc.getQueryData(["/api/leads", 1, "score-history"])).toEqual(history);
    expect(snapshots.map(([k]) => k)).not.toContainEqual(["/api/leads", 1, "score-history"]);
    // The real variants still receive it (numeric params after the marker).
    expect((qc.getQueryData(["/api/leads", "paginated", 1, 25]) as any).data[0].id).toBe(-3);
  });

  it("rollback (replaying snapshots) restores every touched cache exactly", () => {
    const qc = makeClient();
    seedLeadCaches(qc);
    const before = {
      flat: qc.getQueryData(["/api/leads"]),
      paginated: qc.getQueryData(["/api/leads", "paginated", 1, 25]),
      infinite: qc.getQueryData(["/api/leads", "infinite-flat"]),
    };

    const snapshots: Snapshot[] = [];
    insertIntoListCaches(qc, [["/api/leads"]], { id: -2, _optimistic: true }, snapshots);
    for (const [key, value] of snapshots) qc.setQueryData(key, value);

    expect(qc.getQueryData(["/api/leads"])).toEqual(before.flat);
    expect(qc.getQueryData(["/api/leads", "paginated", 1, 25])).toEqual(before.paginated);
    expect(qc.getQueryData(["/api/leads", "infinite-flat"])).toEqual(before.infinite);
  });
});

describe("optimistic create — reconcile", () => {
  it("swaps the temp row for the server row in every cache, no duplicates", () => {
    const qc = makeClient();
    seedLeadCaches(qc);
    const tempId = -1723300000000;
    const snapshots: Snapshot[] = [];
    insertIntoListCaches(qc, [["/api/leads"]], { id: tempId, firstName: "New", _optimistic: true }, snapshots);

    const serverRow = { id: 42, firstName: "New", lastName: "FromServer", score: 71 };
    reconcileCreatedRow(qc, [["/api/leads"]], tempId, serverRow);

    const flat = qc.getQueryData(["/api/leads"]) as any[];
    expect(flat[0]).toEqual(serverRow);
    expect(flat).toHaveLength(2);
    expect(flat.filter((r) => r.id === tempId)).toHaveLength(0);

    const paginated = qc.getQueryData(["/api/leads", "paginated", 1, 25]) as any;
    expect(paginated.data[0]).toEqual(serverRow);
    expect(paginated.data).toHaveLength(2);

    const infinite = qc.getQueryData(["/api/leads", "infinite-flat"]) as any;
    expect(infinite.pages[0].data[0]).toEqual(serverRow);
    expect(infinite.pages[0].data).toHaveLength(2);
    // The optimistic marker is gone — the row is now server truth.
    expect(flat[0]._optimistic).toBeUndefined();
  });

  it("is a no-op on caches that never held the temp row", () => {
    const qc = makeClient();
    const other = [{ id: 5, name: "untouched" }];
    qc.setQueryData(["/api/leads"], other);
    reconcileCreatedRow(qc, [["/api/leads"]], -99, { id: 7 });
    expect(qc.getQueryData(["/api/leads"])).toEqual(other);
  });
});
