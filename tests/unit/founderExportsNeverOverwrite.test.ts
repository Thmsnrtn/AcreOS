/**
 * A founder data script's export is the record of the state BEFORE its change.
 * The default folder is dated, so a second `--apply` the same day used to
 * write the same file name and replace that record with the state after
 * (W10.5 audit of the suppressed-piece refund script). Every script exports
 * through `exportRows`, which now never overwrites.
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exportRows } from "../../scripts/data/_client";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("exportRows", () => {
  it("a second export of the same name the same day keeps the first", () => {
    const dir = mkdtempSync(join(tmpdir(), "founder-export-"));
    dirs.push(dir);
    const first = exportRows(dir, "plan", [{ before: true }]);
    const second = exportRows(dir, "plan", [{ before: false }]);
    const third = exportRows(dir, "plan", []);
    expect([first, second, third].map((p) => p.slice(dir.length + 1))).toEqual(["plan.json", "plan.2.json", "plan.3.json"]);
    expect(JSON.parse(readFileSync(first, "utf8"))).toEqual([{ before: true }]);
    expect(JSON.parse(readFileSync(second, "utf8"))).toEqual([{ before: false }]);
  });
});
