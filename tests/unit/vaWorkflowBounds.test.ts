/**
 * An uncapped, undeletable client-writable array on the hot read path.
 *
 * `POST /api/va/workflows` appended a customer-authored workflow to
 * `organizations.settings.va_workflows` and did three things wrong at once:
 *
 *   1. **No cap.** Every workflow ever created accumulated in one jsonb blob.
 *   2. **No delete and no update.** The route pair was create-and-list only, so
 *      the array could only ever grow.
 *   3. **On the hot read path.** `getOrCreateOrg` resolves the org through
 *      `getOrganizationByOwner`, which is a `SELECT *` on `organizations` — so
 *      this array is fetched on EVERY org-scoped request the product makes, not
 *      just when someone opens the VA workflow screen.
 *
 * Any one of the three is survivable. Together they mean a customer who uses
 * the feature makes every one of their own requests slower, permanently, with
 * no way to undo it and nothing reporting it. The webhook endpoint list, which
 * lives in the neighbouring blob, has capped at 10 since it was written — the
 * rule existed and this surface did not apply it, which is the shape units
 * 30–46 kept finding.
 *
 * THE CAP AND THE DELETE SHIPPED TOGETHER, deliberately. A cap on a collection
 * that cannot be pruned is not a fix, it is a wall: the org reaches 50 once and
 * can never create another workflow. That is a worse outcome than the unbounded
 * growth it replaces, and it is the obvious half-fix to make here.
 *
 * `va_workflows` is also now DECLARED in the settings `$type<>` rather than
 * reached through `(org as any).settings` — unit 43's finding, on a second
 * field: a value outside its column's own type cannot be carried by a typed
 * write and can be erased by one.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");

/** Line-based comment stripping. See destructivePermissionCoverage for why. */
function stripComments(src: string): string {
  const out: string[] = [];
  let inBlock = false;
  for (const line of src.split("\n")) {
    let s = line;
    if (inBlock) {
      const end = s.indexOf("*/");
      if (end === -1) { out.push(""); continue; }
      s = s.slice(end + 2);
      inBlock = false;
    }
    const open = s.indexOf("/*");
    if (open > -1) {
      const close = s.indexOf("*/", open + 2);
      if (close > -1) s = s.slice(0, open) + s.slice(close + 2);
      else if (/^\s*\{?\s*\/\*/.test(s)) { s = s.slice(0, open); inBlock = true; }
    }
    out.push(s.replace(/(^|[^:])\/\/.*$/, "$1"));
  }
  if (inBlock) throw new Error("stripComments ran away — assertions would be meaningless.");
  return out.join("\n");
}

const va = stripComments(
  fs.readFileSync(path.join(ROOT, "server/routes-va-engine.ts"), "utf8"),
);

/** One route's handler, bounded at the next registration — never to EOF. */
function handler(src: string, marker: string): string {
  const at = src.indexOf(marker);
  expect(at, `${marker} not found — renamed?`).toBeGreaterThan(-1);
  const rest = src.slice(at + marker.length);
  const next = rest.search(/\bapi\.(get|post|put|patch|delete)\(/);
  return next === -1 ? src.slice(at) : src.slice(at, at + marker.length + next);
}

describe("the collection is bounded", () => {
  const create = handler(va, 'api.post("/api/va/workflows"');

  it("finds the create handler (vacuity guard)", () => {
    expect(create.length).toBeGreaterThan(400);
    expect(create).toContain("va_workflows");
  });

  it("refuses past a cap", () => {
    expect(create, "the create path no longer caps the collection").toContain(
      "MAX_VA_WORKFLOWS",
    );
    expect(create).toMatch(/workflows\.length\s*>=\s*MAX_VA_WORKFLOWS/);
  });

  it("the cap is a real number, not a placeholder", () => {
    const m = /const MAX_VA_WORKFLOWS = (\d+);/.exec(va);
    expect(m, "MAX_VA_WORKFLOWS is not defined").not.toBeNull();
    const cap = Number(m![1]);
    expect(cap).toBeGreaterThan(0);
    // A cap so large it never fires is the same as no cap, and would let this
    // file report a bounded collection that is not bounded in practice.
    expect(cap, "the cap is high enough to be decorative").toBeLessThanOrEqual(500);
  });
});

describe("the cap is escapable", () => {
  it("a delete path exists", () => {
    // Shipped WITH the cap. A cap on a collection that cannot be pruned is a
    // wall: the org reaches it once and can never create another workflow.
    expect(
      va,
      "the cap has no delete path — an org that reaches it is stuck forever, " +
        "which is worse than the unbounded growth the cap replaced",
    ).toContain('api.delete("/api/va/workflows/:id"');
  });

  it("deleting a workflow that is not there says so", () => {
    // Reporting a no-op as a deletion teaches a customer the button works when
    // it did nothing — the same honesty rule as the rest of this program.
    const del = handler(va, 'api.delete("/api/va/workflows/:id"');
    expect(del).toMatch(/remaining\.length === workflows\.length/);
    expect(del).toContain("Errors.notFound(");
  });

  it("delete preserves the rest of the settings blob", () => {
    // settings is shared with simulationMode, the dashboard widget order and
    // two dozen other keys. A write that replaced it would drop them all —
    // the invariant orgSettingsMerge.test.ts derives from source.
    const del = handler(va, 'api.delete("/api/va/workflows/:id"');
    expect(del).toMatch(/\.\.\.\(orgRecord\?\.settings \?\? \{\}\)/);
  });
});

describe("the field is part of its column's contract", () => {
  const schema = fs.readFileSync(path.join(ROOT, "shared/schema.ts"), "utf8");
  const at = schema.indexOf('export const organizations = pgTable("organizations"');
  const table = schema.slice(at, at + 12000);

  it("va_workflows is declared", () => {
    expect(at, "organizations table not found").toBeGreaterThan(-1);
    expect(
      /va_workflows\??\s*:\s*Array</.test(table),
      "va_workflows is not declared in organizations.settings — a field outside " +
        "its column's own type cannot be carried by a typed write and can be " +
        "erased by one (unit 43)",
    ).toBe(true);
  });

  it("the va_workflows reads no longer go through a cast", () => {
    // Scoped to this collection ON PURPOSE. `routes-va-engine.ts` holds THREE
    // MORE undeclared collections in the same blob — `va_tasks`,
    // `va_escalations`, `va_scheduled_tasks` — each read through
    // `(orgRecord as any).settings` and each with no cap and no delete path.
    // They are the same defect and are NOT fixed here; asserting against the
    // whole file would either fail or pressure someone into a blanket change.
    // Recorded in NEXT_UP with the evidence rather than implied by a passing
    // test.
    expect(
      /\(orgRecord as any\)\??\.settings\?\.va_workflows/.test(va),
      "the va_workflows reads reach settings through `as any` again — the cast " +
        "is what let the field stay undeclared",
    ).toBe(false);
    expect(va).toContain("orgRecord?.settings?.va_workflows");
  });

  it("the three unfixed siblings are still there, and still unfixed", () => {
    // A deliberately inverted assertion, like BLOCKED_ON_A_REAL_LINK. It
    // documents the remaining work in the only place that cannot go stale, and
    // fails when someone fixes one — at which point they should extend this
    // file's coverage to it rather than leave a half-true comment above.
    for (const key of ["va_tasks", "va_escalations", "va_scheduled_tasks"]) {
      expect(
        va.includes(`(orgRecord as any)?.settings?.${key}`),
        `${key} no longer reads through a cast — if it has been declared and ` +
          `bounded too, extend the assertions above to cover it and drop it ` +
          `from this list.`,
      ).toBe(true);
    }
  });
});

describe("why the cap matters here specifically", () => {
  it("the org row really is read on every org-scoped request", () => {
    // The premise the whole unit rests on. If org resolution stopped selecting
    // the full row, an uncapped array here would be a much smaller problem —
    // and this file would be enforcing a rule whose reason had gone.
    const mw = stripComments(
      fs.readFileSync(path.join(ROOT, "server/middleware/getOrCreateOrg.ts"), "utf8"),
    );
    expect(mw).toContain("getOrganizationByOwner");
    const repo = stripComments(
      fs.readFileSync(path.join(ROOT, "server/storage/orgRepo.ts"), "utf8"),
    );
    const at = repo.indexOf("async getOrganizationByOwner");
    expect(at, "getOrganizationByOwner is gone").toBeGreaterThan(-1);
    // `db.select()` with no column list is SELECT * — settings included.
    expect(repo.slice(at, at + 400)).toMatch(/db\s*\.?\s*select\(\)/);
  });
});
