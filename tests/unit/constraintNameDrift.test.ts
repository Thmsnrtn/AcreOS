/**
 * Unique-constraint name drift between shared/schema.ts and a repo-built DB.
 *
 * event_mesh_events: migrations/0017 creates `event_id TEXT NOT NULL UNIQUE`
 * (Postgres names it event_mesh_events_event_id_key); the schema declared a
 * bare `.unique()` (Drizzle's event_mesh_events_event_id_unique). The schema
 * now names the constraint the migration creates, and
 * scripts/check-constraint-names.ts — the last verdict step of
 * `npm run db:build-from-repo` — holds the class.
 *
 * Canaries first (each extraction shape the gate relies on, with the defect
 * hidden in a fixture), then the real database when one is available.
 */
import { describe, expect, it } from "vitest";
import { pgTable, serial, text, unique } from "drizzle-orm/pg-core";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { declaredUniques, diffUniqueNames } from "../../scripts/lib/constraint-names";
import { realDbAvailable, realDbUrl } from "../helpers/realDb";

const ROOT = resolve(__dirname, "../..");

const fixture = {
  widgets: pgTable(
    "widgets",
    {
      id: serial("id").primaryKey(),
      slug: text("slug").notNull().unique(),
      code: text("code").notNull().unique("widgets_code_key"),
      a: text("a"),
      b: text("b"),
    },
    (t) => [unique("widgets_a_b_uq").on(t.a, t.b)],
  ),
  notATable: { hello: "world" },
};

describe("declaredUniques — every shape the gate reads", () => {
  it("bare .unique(), named .unique(name), and table-level unique()", () => {
    const got = declaredUniques(fixture as unknown as Record<string, unknown>).map((u) => `${u.table}:${u.name}:${u.columns.join("+")}`);
    expect(got.sort()).toEqual(["widgets:widgets_a_b_uq:a+b", "widgets:widgets_code_key:code", "widgets:widgets_slug_unique:slug"]);
  });
});

describe("diffUniqueNames — canaries", () => {
  const declared = declaredUniques(fixture as unknown as Record<string, unknown>);
  it("names match → ok", () => {
    const d = diffUniqueNames(declared, [
      { table: "widgets", name: "widgets_slug_unique", columns: ["slug"] },
      { table: "widgets", name: "widgets_code_key", columns: ["code"] },
      { table: "widgets", name: "widgets_a_b_uq", columns: ["b", "a"] },
    ]);
    expect(d.renamed).toEqual([]);
    expect(d.missing).toEqual([]);
    expect(d.ok).toHaveLength(3);
  });
  it("the event_mesh_events shape — inline UNIQUE got Postgres's _key — is RENAMED", () => {
    const d = diffUniqueNames(declared, [
      { table: "widgets", name: "widgets_slug_key", columns: ["slug"] },
      { table: "widgets", name: "widgets_code_key", columns: ["code"] },
      { table: "widgets", name: "widgets_a_b_uq", columns: ["a", "b"] },
    ]);
    expect(d.renamed).toEqual([expect.objectContaining({ name: "widgets_slug_unique", actual: "widgets_slug_key" })]);
  });
  it("no uniqueness on the columns at all is MISSING, not renamed", () => {
    const d = diffUniqueNames(declared, [{ table: "widgets", name: "widgets_slug_unique", columns: ["slug"] }]);
    expect(d.missing.map((m) => m.name).sort()).toEqual(["widgets_a_b_uq", "widgets_code_key"]);
  });
  it("a same-named index on ANOTHER table does not satisfy the declaration", () => {
    const d = diffUniqueNames(declared.slice(0, 1), [{ table: "gadgets", name: declared[0].name, columns: declared[0].columns }]);
    expect(d.ok).toEqual([]);
  });
});

describe("the gate is wired into the schema build", () => {
  it("build-schema-from-repo.sh runs it as a failing verdict step", () => {
    const sh = readFileSync(resolve(ROOT, "scripts/ci/build-schema-from-repo.sh"), "utf8");
    expect(sh).toMatch(/if ! npx tsx scripts\/check-constraint-names\.ts; then\n[^\n]*\n\s*exit 1/);
  });
});

describe.skipIf(!realDbAvailable)("on a database built from this repo", () => {
  it("event_mesh_events carries the name the schema declares, and the gate passes", () => {
    const r = spawnSync(process.execPath, [resolve(ROOT, "node_modules/tsx/dist/cli.mjs"), "scripts/check-constraint-names.ts"], {
      cwd: ROOT,
      env: { ...process.env, DATABASE_URL: realDbUrl },
      encoding: "utf8",
      timeout: 120_000,
    });
    expect(r.stdout + r.stderr).toMatch(/PASS/);
    expect(r.status).toBe(0);
    const register = JSON.parse(readFileSync(resolve(ROOT, "scripts/constraint-names.allowlist.json"), "utf8")) as { entries: string[] };
    expect(register.entries.some((e) => e.startsWith("event_mesh_events:"))).toBe(false);
  }, 180_000);
});
