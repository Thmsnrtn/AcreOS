/**
 * The off-provider backup is restored and counted on every schema build.
 *
 * scripts/db-backup.sh + scripts/db-restore.sh were exercised by hand on
 * 2026-10-09 (docs/runbooks/09-*); what keeps them working is step 10 of
 * scripts/ci/build-schema-from-repo.sh, which dumps the built schema, restores
 * it into a fresh database and fails the build on any count mismatch. This
 * pins that the step runs both scripts and fails the build on either failing,
 * and that the restore refuses the unsafe cases before it writes.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "../helpers/stripComments";

const ROOT = path.resolve(__dirname, "../..");
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");
/** Shell comments out, so a commented-out step cannot satisfy the check. */
const shellCode = (s: string) => s.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");

describe("CI proves the round trip", () => {
  it("build-schema step 10 runs backup then restore and exits non-zero if either fails", () => {
    const ci = shellCode(read("scripts/ci/build-schema-from-repo.sh"));
    const step = ci.slice(ci.indexOf('echo "[build-schema] 10/10'));
    expect(step).toMatch(/if ! bash scripts\/db-backup\.sh "\$BK_DIR" \|\| ! RESTORE_URL="\$RESTORE_URL" bash scripts\/db-restore\.sh/);
    expect(step.slice(0, step.indexOf("PASS"))).toMatch(/exit 1/);
    expect(ci.indexOf("10/10")).toBeLessThan(ci.lastIndexOf("PASS — the schema"));
  });

  it("the restore refuses before writing: checksum, manifest, non-empty target; and compares every table", () => {
    const r = shellCode(read("scripts/db-restore.sh"));
    const order = ["sha256 mismatch", "already has", "pg_restore --no-owner", "the restore does not match the backup"].map((k) => r.indexOf(k));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(r).toMatch(/no manifest at/);
  });

  it("credentials never go on argv in the scripts (PG* env)", () => {
    for (const f of ["scripts/db-backup.sh", "scripts/db-restore.sh"]) {
      const s = shellCode(read(f));
      expect(s).not.toMatch(/pg_dump[^\n]*\$DATABASE_URL/);
      expect(s).not.toMatch(/pg_restore[^\n]*\$RESTORE_URL/);
      expect(s).toMatch(/PGPASSWORD/);
    }
    expect(stripComments(read("docs/runbooks/09-off-provider-backup-and-restore.md")).length).toBeGreaterThan(500);
  });
});

describe("the restore's refusals, executed (no database is reached)", () => {
  const { spawnSync } = require("node:child_process") as typeof import("node:child_process");
  const os = require("node:os") as typeof import("node:os");
  const run = (dump: string) =>
    spawnSync("bash", [path.join(ROOT, "scripts/db-restore.sh"), dump], {
      encoding: "utf8",
      env: { ...process.env, RESTORE_URL: "postgres://nobody:x@127.0.0.1:1/never_reached" },
    });

  it("a dump whose bytes differ from its manifest is refused before any connection", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rs-"));
    fs.writeFileSync(path.join(dir, "a.dump"), "not the dump the manifest describes");
    fs.writeFileSync(path.join(dir, "a.manifest.json"), JSON.stringify({ sha256: "0".repeat(64), tables: { leads: 1 } }));
    const r = run(path.join(dir, "a.dump"));
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/sha256 mismatch/);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("a dump with no manifest is refused", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rs-"));
    fs.writeFileSync(path.join(dir, "b.dump"), "x");
    const r = run(path.join(dir, "b.dump"));
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/no manifest/);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
