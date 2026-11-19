/**
 * Staging schema can never lag a merge by a day again.
 *
 * 2026-10-28: `note_events` (0293) never reached staging's database while the
 * deploy went green. Staging deploys apply no schema (fly.staging.toml
 * release_command = "true"); the only schema path was the nightly reconcile,
 * which had run 77 minutes before the merge.
 *
 * This pins, by PARSING the workflows (comments never read as YAML):
 *   - staging.yml calls the reconcile workflow after the deploy, in the same
 *     run, with nothing that lets a failure pass quietly;
 *   - the reconcile workflow is callable, and its census job runs after the
 *     reconcile and runs the census script;
 *   - the false "schema comes from db:push" claims are gone;
 * and the census script's verdict and its declaration population.
 */

import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import yaml from "js-yaml";
import { stripYamlComments } from "../helpers/stripYamlComments";
import {
  UNDECLARED_RESIDUE_TOLERANCE,
  censusVerdict,
  declarationCensus,
  newestMigrationBlock,
  parsePhysical,
  registeredReleasePathOrphans,
} from "../../scripts/staging-schema-census";

type Step = { run?: string; uses?: string; "continue-on-error"?: unknown };
type Job = {
  needs?: string | string[];
  uses?: string;
  if?: string;
  secrets?: unknown;
  steps?: Step[];
  concurrency?: { group?: string; "cancel-in-progress"?: boolean };
  "continue-on-error"?: unknown;
};
type Workflow = { on: Record<string, unknown>; jobs: Record<string, Job> };

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const load = (rel: string) => yaml.load(read(rel)) as Workflow;
const needsOf = (j: Job) => (Array.isArray(j.needs) ? j.needs : j.needs ? [j.needs] : []);
const RECONCILE = ".github/workflows/staging-schema-reconcile.yml";

describe("every staging deploy is followed by the schema reconcile", () => {
  const staging = load(".github/workflows/staging.yml");
  const callers = Object.entries(staging.jobs).filter(([, j]) => j.uses === `./${RECONCILE}`);

  it("exactly one job calls the reconcile workflow, after the deploy job", () => {
    expect(staging.jobs["deploy-staging"], "the deploy job was renamed — re-point this test").toBeDefined();
    expect(callers.map(([n]) => n)).toHaveLength(1);
    const [, job] = callers[0];
    expect(needsOf(job)).toContain("deploy-staging");
    expect(job.secrets, "the reconcile needs FLY_API_TOKEN").toBe("inherit");
  });

  it("nothing lets the reconcile be skipped after a green deploy, or fail quietly", () => {
    const [, job] = callers[0];
    // An `if:` (e.g. always(), or a variable) would decouple it from the deploy's success.
    expect(job.if).toBeUndefined();
    expect(job["continue-on-error"]).toBeUndefined();
  });

  it("the reconcile workflow is callable and loud", () => {
    const wf = load(RECONCILE);
    expect(Object.keys(wf.on)).toEqual(expect.arrayContaining(["workflow_call", "workflow_dispatch", "schedule"]));
    const reconcile = wf.jobs.reconcile;
    expect(reconcile.steps?.some((s) => /node scripts\/migrate\.mjs --ddl-only/.test(s.run ?? ""))).toBe(true);
    expect(reconcile.concurrency?.group).toBe("staging-schema-reconcile");
    expect(reconcile.concurrency?.["cancel-in-progress"]).toBe(false);
    for (const [name, job] of Object.entries(wf.jobs)) {
      expect(job["continue-on-error"], `${name} must not swallow a failure`).toBeUndefined();
      for (const s of job.steps ?? []) expect(s["continue-on-error"], `${name} step`).toBeUndefined();
    }
  });

  it("the census runs after the reconcile, against the census script", () => {
    const census = load(RECONCILE).jobs.census;
    expect(census).toBeDefined();
    expect(needsOf(census)).toContain("reconcile");
    expect(census.if).toBeUndefined();
    expect(census.steps?.some((s) => /scripts\/staging-schema-census\.ts --physical /.test(s.run ?? ""))).toBe(true);
  });

  it("no comment or step still claims staging's schema comes from db:push", () => {
    // The whole file, comments included: the false claims lived in comments.
    for (const rel of [".github/workflows/staging.yml", "fly.staging.toml", RECONCILE]) {
      const text = read(rel);
      expect(text, rel).not.toMatch(/schema (is |was )?built (by|via) `?(npm run )?db:push/i);
      expect(text, rel).not.toMatch(/schema comes only from db:push/i);
    }
    for (const [name, job] of Object.entries(load(".github/workflows/staging.yml").jobs)) {
      for (const s of job.steps ?? []) {
        // Shell comments inside `run:` are prose, not commands — the corrected comment names db:push.
        const commands = stripYamlComments(s.run ?? "");
        expect(commands, `staging.yml ${name}`).not.toMatch(/db:push/);
      }
    }
  });
});

describe("staging schema census", () => {
  const declared = Array.from({ length: 700 }, (_, i) => `t${i}`);

  it("passes when staging holds every declared table and residue is within tolerance", () => {
    const residue = Array.from({ length: UNDECLARED_RESIDUE_TOLERANCE }, (_, i) => `old${i}`);
    const v = censusVerdict(declared, [...declared, ...residue]);
    expect(v.ok, v.failures.join("; ")).toBe(true);
    expect(v.undeclared).toHaveLength(UNDECLARED_RESIDUE_TOLERANCE);
  });

  it("fails, itemized, on ONE declared table missing — the 0293 defect", () => {
    const v = censusVerdict([...declared, "note_events"], declared);
    expect(v.ok).toBe(false);
    expect(v.missing).toEqual(["note_events"]);
  });

  it("fails one table above the undeclared tolerance", () => {
    const residue = Array.from({ length: UNDECLARED_RESIDUE_TOLERANCE + 1 }, (_, i) => `old${i}`);
    const v = censusVerdict(declared, [...declared, ...residue]);
    expect(v.ok).toBe(false);
    expect(v.undeclared).toHaveLength(UNDECLARED_RESIDUE_TOLERANCE + 1);
  });

  it("passes with 19 residue + earnest_money_events physical & REGISTERED — the #623 / S4 0086 case", () => {
    const residue = Array.from({ length: UNDECLARED_RESIDUE_TOLERANCE }, (_, i) => `old${i}`);
    const v = censusVerdict(
      declared,
      [...declared, ...residue, "earnest_money_events"],
      UNDECLARED_RESIDUE_TOLERANCE,
      new Set(["earnest_money_events"]),
    );
    expect(v.ok, v.failures.join("; ")).toBe(true);
    // Named in its own registered section, and NOT counted as residue.
    expect(v.registered).toEqual(["earnest_money_events"]);
    expect(v.undeclared).toHaveLength(UNDECLARED_RESIDUE_TOLERANCE);
    expect(v.undeclared).not.toContain("earnest_money_events");
  });

  it("still fails on a 20th residue table even when earnest_money_events is registered and present", () => {
    const residue = Array.from({ length: UNDECLARED_RESIDUE_TOLERANCE }, (_, i) => `old${i}`);
    const v = censusVerdict(
      declared,
      [...declared, ...residue, "earnest_money_events", "unmarked_extra"],
      UNDECLARED_RESIDUE_TOLERANCE,
      new Set(["earnest_money_events"]),
    );
    expect(v.ok).toBe(false);
    expect(v.registered).toEqual(["earnest_money_events"]);
    expect(v.undeclared).toHaveLength(UNDECLARED_RESIDUE_TOLERANCE + 1);
    expect(v.undeclared).toContain("unmarked_extra");
  });

  it("counts earnest_money_events as residue when it is physical but NOT marked registered", () => {
    const residue = Array.from({ length: UNDECLARED_RESIDUE_TOLERANCE }, (_, i) => `old${i}`);
    // No registered set passed — earnest_money_events IS in the orphans map, which alone confers nothing.
    const v = censusVerdict(declared, [...declared, ...residue, "earnest_money_events"]);
    expect(v.ok).toBe(false);
    expect(v.registered).toEqual([]);
    expect(v.undeclared).toHaveLength(UNDECLARED_RESIDUE_TOLERANCE + 1);
    expect(v.undeclared).toContain("earnest_money_events");
  });

  it("reads the real register: only the explicit marker confers registration", () => {
    const registered = registeredReleasePathOrphans();
    expect([...registered]).toEqual(["earnest_money_events"]);
    // Names present in the register's orphans map for unrelated .sql reasons are NOT registered.
    const orphans = JSON.parse(read("scripts/schema-migrate-mirror.orphans.json")) as { orphans: Record<string, string> };
    expect(Object.keys(orphans.orphans)).toContain("sessions");
    expect(registered.has("sessions")).toBe(false);
    expect(registered.has("earnest_money_events")).toBe(true);
    // The marked table keeps its orphans-map entry (the register is not restructured).
    expect(orphans.orphans["earnest_money_events"]).toMatch(/RELEASE-PATH CREATED/);
  });

  it("fails loudly when the register cannot be read or has no valid marker", () => {
    expect(() => registeredReleasePathOrphans(path.join(ROOT, "scripts/does-not-exist.orphans.json"))).toThrow(
      /could not read\/parse the orphans register/,
    );
    const dir = mkdtempSync(path.join(os.tmpdir(), "census-reg-"));
    const bad = path.join(dir, "bad.json");
    writeFileSync(bad, "{ not json");
    expect(() => registeredReleasePathOrphans(bad)).toThrow(/could not read\/parse the orphans register/);
    const noMarker = path.join(dir, "no-marker.json");
    writeFileSync(noMarker, JSON.stringify({ orphans: { earnest_money_events: "reason" } }));
    expect(() => registeredReleasePathOrphans(noMarker)).toThrow(/no valid "releasePathCreatedUnmodelled" array/);
    const wrongType = path.join(dir, "wrong-type.json");
    writeFileSync(wrongType, JSON.stringify({ releasePathCreatedUnmodelled: "earnest_money_events" }));
    expect(() => registeredReleasePathOrphans(wrongType)).toThrow(/no valid "releasePathCreatedUnmodelled" array/);
  });

  it("fails on an empty or tiny physical read rather than calling it clean", () => {
    expect(censusVerdict(declared, []).ok).toBe(false);
    expect(censusVerdict([], []).ok).toBe(false);
  });

  it("refuses a truncated or malformed physical read", () => {
    expect(() => parsePhysical("COUNT 2\nT a 1 0\n")).toThrow(/truncated/);
    expect(() => parsePhysical("T a 1 0\n")).toThrow(/COUNT/);
    expect(() => parsePhysical("COUNT 1\nT a one 0\n")).toThrow(/unparseable/);
    expect(parsePhysical("COUNT 2\nT a 1 0\nT b 3 2\n")).toEqual([
      { name: "a", constraints: 1, triggers: 0 },
      { name: "b", constraints: 3, triggers: 2 },
    ]);
  });

  it("reads the table-count ratchet's whole population, every occurrence named", () => {
    const census = declarationCensus();
    const ratchet = JSON.parse(read("scripts/ratchets/table-count.json"));
    expect(census.unparsed).toEqual([]);
    expect(census.occurrences).toBe(ratchet.baselineCount);
    // Declared outside the shared/schema barrel — the population must still include them.
    for (const t of ["note_events", "tax_procedure_objects", "ach_mandates", "solene_constitutional_violations"]) {
      expect(census.names.has(t), t).toBe(true);
    }
  });

  it("counts, never skips, a pgTable( whose name it cannot read; ignores comment lines", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "census-"));
    mkdirSync(path.join(root, "shared", "sub"), { recursive: true });
    writeFileSync(
      path.join(root, "shared", "sub", "a.ts"),
      [
        `export const a = pgTable("alpha", {});`,
        `export const b = pgTable(`,
        `  "beta",`,
        `  {});`,
        `export const c = pgTable(NAME, {});`,
        `// pgTable("commented_out")`,
        ` * pgTable("doc_line")`,
      ].join("\n"),
    );
    writeFileSync(path.join(root, "shared", "a.test.ts"), `pgTable("in_a_test", {});`);
    const census = declarationCensus(root);
    expect([...census.names].sort()).toEqual(["alpha", "beta"]);
    expect(census.occurrences).toBe(3);
    expect(census.unparsed).toEqual(["shared/sub/a.ts:5"]);
  });

  it("finds the newest migration block's tables and the triggers it creates on them", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "census-mig-"));
    writeFileSync(path.join(dir, "0001_old.sql"), `CREATE TABLE "old_t" (id int);`);
    writeFileSync(
      path.join(dir, "0002_new.sql"),
      [
        `-- CREATE TABLE "in_a_comment"`,
        `CREATE TABLE IF NOT EXISTS "new_t" (id int);`,
        `CREATE TRIGGER new_t_no_update BEFORE UPDATE ON "new_t" FOR EACH ROW EXECUTE FUNCTION f();`,
        `CREATE TRIGGER new_t_no_truncate BEFORE TRUNCATE ON "new_t" FOR EACH STATEMENT EXECUTE FUNCTION f();`,
      ].join("\n"),
    );
    const block = newestMigrationBlock(dir);
    expect(block.file).toBe("0002_new.sql");
    expect([...block.tables]).toEqual([["new_t", 2]]);
  });
});
