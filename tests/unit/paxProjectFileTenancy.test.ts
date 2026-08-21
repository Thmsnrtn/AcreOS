/**
 * Org A may not delete org B's Pax project file.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 * `DELETE /api/ai/projects/:id/files/:fileId` (server/routes-ai.ts) verified
 * the PARENT PROJECT named in the URL — `storage.getPaxProject(org.id,
 * projectId)`, a check carrying the comment "F-D31 IDOR fix" — and then called
 *
 *     storage.deletePaxProjectFile(parseInt(req.params.fileId))
 *
 * with the file id ALONE. Storage resolved the file by bare primary key, and
 * took the project to decrement FROM THE ROW IT HAD JUST FETCHED:
 *
 *     const [file] = await db.select().from(paxProjectFiles).where(eq(paxProjectFiles.id, fileId));
 *     await db.delete(paxProjectFiles).where(eq(paxProjectFiles.id, fileId));
 *     await db.update(paxProjects).set({ fileCount: … }).where(eq(paxProjects.id, file.projectId));
 *
 * So the guard constrained one id and the statement deleted another. The
 * `pax_projects` UPDATE was org-scoped-looking but keyed on a project id read
 * off the victim's row, which is worse than unscoped: it aimed the decrement AT
 * the other tenant. `pax_project_files` carries no `organization_id` — its
 * `project_id` is the ONLY ownership link, and nothing asserted it — so org A,
 * owning project 10, could send `DELETE /api/ai/projects/10/files/999` for org
 * B's file 999 and destroy it, then decrement org B's `pax_projects.file_count`.
 * File ids are sequential integers; no discovery was needed.
 *
 * ── WHAT THIS FILE PROVES ───────────────────────────────────────────────────
 * Behaviour, not vocabulary. The fake `db` below is an HONEST postgres for the
 * shapes this method emits: it holds files and projects for two organizations
 * and answers a statement by EVALUATING the predicate drizzle actually built —
 * every equality it binds, including the ones inside the `project_id IN
 * (SELECT …)` subquery, matched against the file row AND the project row that
 * file belongs to (which is what `IN (SELECT id FROM pax_projects WHERE …)`
 * means when project ids are unique). A statement that omits the org therefore
 * still finds the other tenant's file here, exactly as production did, and the
 * assertions below fail.
 *
 * Asserting that the source contains the string `organizationId` would pass
 * against a predicate built on the wrong value — which is precisely the bug
 * that shipped, since the old code did mention an org id one line away. A
 * storage double that filters by org for free would pass against no predicate
 * at all. Both were rejected for this reason.
 *
 * The one clause behaviour cannot see is the org predicate on the `fileCount`
 * UPDATE: with the DELETE scoped, the UPDATE is unreachable for a foreign
 * project, so removing its predicate changes nothing observable through this
 * path. That clause is pinned against the EMITTED predicate of the update
 * itself — the drizzle SQL object handed to the driver.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  Column,
  Param,
  SQL,
  Table,
  getTableColumns,
  getTableName,
  is,
} from "drizzle-orm";
import { PgDialect, QueryBuilder } from "drizzle-orm/pg-core";
import { paxProjects, paxProjectFiles } from "@shared/schema";

const VICTIM_ORG = 7;
const ATTACKER_ORG = 42;

const VICTIM_PROJECT_ID = 77;
const ATTACKER_PROJECT_ID = 10;
const ATTACKER_SECOND_PROJECT_ID = 11;

const VICTIM_FILE_ID = 999;
const ATTACKER_FILE_ID = 1;
const ATTACKER_SECOND_PROJECT_FILE_ID = 2;

type Row = Record<string, unknown>;

/** DB column name (`organization_id`) → drizzle/TS key (`organizationId`). */
function keyByColumnName(table: typeof paxProjects | typeof paxProjectFiles): Map<string, string> {
  const map = new Map<string, string>();
  for (const [tsKey, col] of Object.entries(getTableColumns(table as any))) {
    map.set((col as { name: string }).name, tsKey);
  }
  return map;
}

const FILE_KEYS = keyByColumnName(paxProjectFiles);
const PROJECT_KEYS = keyByColumnName(paxProjects);

/**
 * Flatten a drizzle predicate into the equalities it binds, as
 * [table name, column name, value] triples. `eq(col, v)` emits
 * [Column, StringChunk, Param]; `and(...)` nests SQL objects with their own
 * `queryChunks`; `inArray(col, <select builder>)` nests a builder whose
 * `getSQL()` yields the subquery — walked too, so the org predicate inside it
 * is seen rather than skipped. The table name travels with the column because
 * both tables have an `id`.
 */
function equalities(node: unknown): Array<[string, string, unknown]> {
  const tokens: Array<{ kind: "col" | "param"; table?: string; v: unknown }> = [];
  const seen = new WeakSet<object>();
  const walk = (n: any): void => {
    if (n === null || typeof n !== "object") return;
    if (seen.has(n)) return; // StringChunk/Table getSQL() wrap themselves
    seen.add(n);
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (is(n, Column)) { tokens.push({ kind: "col", table: getTableName(n.table), v: n.name }); return; }
    if (is(n, Param)) { tokens.push({ kind: "param", v: n.value }); return; }
    if (is(n, Table)) return;
    if (is(n, SQL)) { (n as any).queryChunks.forEach(walk); return; }
    if (typeof n.getSQL === "function") { walk(n.getSQL()); return; }
  };
  walk(node);
  const out: Array<[string, string, unknown]> = [];
  for (let i = 0; i < tokens.length - 1; i++) {
    if (tokens[i].kind === "col" && tokens[i + 1].kind === "param") {
      out.push([tokens[i].table!, String(tokens[i].v), tokens[i + 1].v]);
    }
  }
  return out;
}

const dialect = new PgDialect();

/** The SQL the driver would actually receive for this predicate. */
function compile(predicate: unknown): string {
  return dialect.sqlToQuery((predicate as SQL).getSQL()).sql;
}

/**
 * Honest matching for a statement on `pax_project_files`: the row is affected
 * when it satisfies EVERY equality the predicate binds — the ones on
 * `pax_project_files` against the row itself, the ones on `pax_projects`
 * against the project the row belongs to. That is what
 * `project_id IN (SELECT id FROM pax_projects WHERE …)` evaluates to, since
 * `pax_projects.id` is unique.
 *
 * A predicate that binds nothing matches the whole table, which is the point:
 * an unscoped statement reaches other tenants' rows here exactly as it does in
 * production. Only conjunctions are modelled — `expectConjunction` below fails
 * the test if the method ever emits an `or`, rather than silently mis-modelling
 * it.
 */
function fileMatches(file: Row, predicate: unknown, projects: Row[]): boolean {
  const parent = projects.find((p) => String(p.id) === String(file.projectId));
  return equalities(predicate).every(([tableName, colName, value]) => {
    if (tableName === getTableName(paxProjectFiles)) {
      const tsKey = FILE_KEYS.get(colName);
      return tsKey !== undefined && String(file[tsKey]) === String(value);
    }
    if (tableName === getTableName(paxProjects)) {
      const tsKey = PROJECT_KEYS.get(colName);
      return parent !== undefined && tsKey !== undefined && String(parent[tsKey]) === String(value);
    }
    return false;
  });
}

function projectMatches(project: Row, predicate: unknown): boolean {
  return equalities(predicate).every(([tableName, colName, value]) => {
    if (tableName !== getTableName(paxProjects)) return false;
    const tsKey = PROJECT_KEYS.get(colName);
    return tsKey !== undefined && String(project[tsKey]) === String(value);
  });
}

function expectConjunction(predicate: unknown): void {
  expect(
    compile(predicate).toLowerCase(),
    "the statement emits an OR — the evaluator below models conjunctions only, " +
      "so it would silently mis-model this predicate",
  ).not.toMatch(/\bor\b/);
}

interface Harness {
  fileRows: Row[];
  projectRows: Row[];
  deletePredicates: unknown[];
  updatePredicates: unknown[];
}

function makeHarness(): Harness {
  return {
    projectRows: [
      { id: VICTIM_PROJECT_ID, organizationId: VICTIM_ORG, name: "org B project", fileCount: 3 },
      { id: ATTACKER_PROJECT_ID, organizationId: ATTACKER_ORG, name: "org A project", fileCount: 2 },
      { id: ATTACKER_SECOND_PROJECT_ID, organizationId: ATTACKER_ORG, name: "org A other project", fileCount: 1 },
    ],
    fileRows: [
      { id: VICTIM_FILE_ID, projectId: VICTIM_PROJECT_ID, fileName: "org-B-diligence.pdf" },
      { id: ATTACKER_FILE_ID, projectId: ATTACKER_PROJECT_ID, fileName: "org-A-own.pdf" },
      { id: ATTACKER_SECOND_PROJECT_FILE_ID, projectId: ATTACKER_SECOND_PROJECT_ID, fileName: "org-A-elsewhere.pdf" },
    ],
    deletePredicates: [],
    updatePredicates: [],
  };
}

/** A `db` shaped like drizzle's, backed by `h`. */
function makeDb(h: Harness) {
  return {
    // The subquery the method builds is a REAL drizzle select builder, so
    // `inArray()` receives an SQL wrapper and emits `in (select …)` exactly as
    // it does in production. A hand-rolled stand-in would be bound as a Param
    // and the org predicate would vanish from the emitted statement.
    select: (fields: any) => new QueryBuilder().select(fields),

    delete(table: any) {
      return {
        where(predicate: unknown) {
          expect(getTableName(table)).toBe(getTableName(paxProjectFiles));
          expectConjunction(predicate);
          h.deletePredicates.push(predicate);
          return {
            // Projects the requested columns the way drizzle's RETURNING does,
            // so a statement asking for more than the id gets it — the fake
            // must not be what makes an unscoped variant fail.
            returning: async (fields: Record<string, { name: string }>) => {
              const hit = h.fileRows.filter((f) => fileMatches(f, predicate, h.projectRows));
              h.fileRows = h.fileRows.filter((f) => !hit.includes(f));
              return hit.map((f) =>
                Object.fromEntries(
                  Object.entries(fields).map(([alias, col]) => [alias, f[FILE_KEYS.get(col.name)!]]),
                ),
              );
            },
          };
        },
      };
    },

    update(table: any) {
      return {
        set(patch: Row) {
          return {
            where: async (predicate: unknown) => {
              expect(getTableName(table)).toBe(getTableName(paxProjects));
              expectConjunction(predicate);
              h.updatePredicates.push(predicate);
              // The emitted patch is `GREATEST(file_count - 1, 0)`; the claim
              // under test is WHICH rows the predicate selects, so the fake
              // applies that expression's meaning to the matched rows.
              expect(Object.keys(patch)).toEqual(["fileCount"]);
              for (const p of h.projectRows.filter((r) => projectMatches(r, predicate))) {
                p.fileCount = Math.max(Number(p.fileCount) - 1, 0);
              }
            },
          };
        },
      };
    },
  };
}

async function deleteFileWith(
  h: Harness,
  organizationId: number,
  projectId: number,
  fileId: number,
): Promise<boolean> {
  vi.resetModules();
  vi.doMock("../../server/db", () => ({ db: makeDb(h) }));
  const { paxRepo } = await import("../../server/storage/paxRepo");
  return (paxRepo.deletePaxProjectFile as any).call({}, organizationId, projectId, fileId);
}

const project = (h: Harness, id: number) => h.projectRows.find((p) => p.id === id)!;
const fileExists = (h: Harness, id: number) => h.fileRows.some((f) => f.id === id);

beforeEach(() => vi.resetModules());

describe("storage.deletePaxProjectFile scopes the file it deletes", () => {
  it("THE OWNING ORG STILL DELETES ITS OWN FILE — vacuity guard", async () => {
    // Without this, every assertion below would pass against a method that
    // deletes nothing at all.
    const h = makeHarness();
    const deleted = await deleteFileWith(h, ATTACKER_ORG, ATTACKER_PROJECT_ID, ATTACKER_FILE_ID);

    expect(deleted, "the owning org can no longer delete its own file").toBe(true);
    expect(fileExists(h, ATTACKER_FILE_ID), "the file survived its owner's delete").toBe(false);
    expect(project(h, ATTACKER_PROJECT_ID).fileCount, "fileCount was not decremented").toBe(1);
  });

  it("ANOTHER ORG'S FILE IS NOT DELETED — the cross-tenant write", async () => {
    const h = makeHarness();

    // Org A owns project 10 and passes its own project id, exactly as the route
    // does after its parent-project check passes:
    // DELETE /api/ai/projects/10/files/999, where 999 is org B's file.
    const deleted = await deleteFileWith(h, ATTACKER_ORG, ATTACKER_PROJECT_ID, VICTIM_FILE_ID);

    expect(deleted, "the method reported deleting a file it does not own").toBe(false);
    expect(fileExists(h, VICTIM_FILE_ID), "org B's file was deleted by org A").toBe(true);
    expect(project(h, VICTIM_PROJECT_ID).fileCount, "org B's fileCount was decremented by org A").toBe(3);
    expect(h.updatePredicates, "a pax_projects UPDATE ran for a file that was never deleted").toHaveLength(0);
  });

  it("A FILE IN THE ORG'S OTHER PROJECT IS NOT DELETED THROUGH THIS PROJECT'S URL", async () => {
    // Same tenant, wrong parent: the file id must belong to the project in the
    // URL, or the route's project check governs a row it never touches.
    const h = makeHarness();
    const deleted = await deleteFileWith(h, ATTACKER_ORG, ATTACKER_PROJECT_ID, ATTACKER_SECOND_PROJECT_FILE_ID);

    expect(deleted).toBe(false);
    expect(fileExists(h, ATTACKER_SECOND_PROJECT_FILE_ID), "a file from another project was deleted").toBe(true);
    expect(project(h, ATTACKER_SECOND_PROJECT_ID).fileCount).toBe(1);
  });

  it("EVERY STATEMENT IT EMITS BINDS organization_id TO THE CALLER'S ORG", async () => {
    // The fileCount UPDATE's own clause is unreachable behaviourally once the
    // DELETE is scoped, so it is pinned against the predicate the method
    // actually emits — as is the DELETE's, which must carry the org through the
    // parent project because pax_project_files has no organization_id of its own.
    const h = makeHarness();
    await deleteFileWith(h, ATTACKER_ORG, ATTACKER_PROJECT_ID, ATTACKER_FILE_ID);

    expect(h.deletePredicates, "the DELETE never ran").toHaveLength(1);
    expect(h.updatePredicates, "the fileCount UPDATE never ran").toHaveLength(1);

    for (const predicate of [...h.deletePredicates, ...h.updatePredicates]) {
      const bound = equalities(predicate)
        .filter(([table, col]) => table === getTableName(paxProjects) && col === "organization_id")
        .map(([, , value]) => value);
      expect(
        bound,
        `a statement carries no organization_id predicate:\n${compile(predicate)}`,
      ).toContain(ATTACKER_ORG);
    }

    // And the DELETE proves it against pax_projects INSIDE the statement, not
    // by a prior fetch a caller could skip.
    expect(compile(h.deletePredicates[0])).toMatch(
      /"pax_project_files"\."project_id" in \(select .* from "pax_projects" where .*"pax_projects"\."organization_id" = \$\d+\)/,
    );
  });
});
