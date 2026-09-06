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
import { stripComments } from "../helpers/stripComments";

const ROOT = path.resolve(__dirname, "../..");

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
    // Scoped to this collection ON PURPOSE. `routes-va-engine.ts` held three
    // more undeclared collections in the same blob. `va_escalations` has since
    // been fixed by unit 48 — the inverted assertion below CAUGHT that, which
    // is what it is for — and `va_tasks` and `va_scheduled_tasks` remain.
    // Asserting against the whole file would either fail or pressure someone
    // into a blanket change, so the remainder is pinned rather than implied.
    expect(
      /\(orgRecord as any\)\??\.settings\?\.va_workflows/.test(va),
      "the va_workflows reads reach settings through `as any` again — the cast " +
        "is what let the field stay undeclared",
    ).toBe(false);
    expect(va).toContain("orgRecord?.settings?.va_workflows");
  });

  it("no sibling collection reads settings through a cast any more", () => {
    // THIS ASSERTION USED TO BE INVERTED, and it worked exactly as designed —
    // twice. It listed the collections in this file that still reached
    // `settings` through `(orgRecord as any)` and REQUIRED them to still be
    // broken, so that fixing one failed here and forced the fixer to extend
    // this file's coverage rather than leave a half-true comment above.
    //
    //   - `va_escalations` came off the list in unit 48 (it notified nobody and
    //     nothing read it back). Covered by vaEscalationDelivery.test.ts.
    //   - `va_tasks` and `va_scheduled_tasks` came off it on 2026-08-13, when
    //     the founder ruled on BLOCKERS B9. Tasks moved to the `va_tasks` TABLE
    //     (migration 0235) — the blob was never a good home for an unbounded
    //     history read on every org-scoped request. `va_scheduled_tasks` had
    //     exactly one reference in the repo, that read, and now refuses with
    //     501 rather than returning `[]` from a store with no writer. Covered
    //     by vaTaskPersistence.test.ts.
    //
    // With the list empty, the inversion has nothing left to protect, so it
    // flips to the plain form: none of them may come back.
    for (const key of ["va_tasks", "va_scheduled_tasks", "va_escalations"]) {
      expect(
        va.includes(`(orgRecord as any)?.settings?.${key}`),
        `${key} reads organizations.settings through \`as any\` again. The cast ` +
          `is what let these fields stay undeclared, and an undeclared field ` +
          `cannot be carried by a typed write and can be erased by one (unit 43).`,
      ).toBe(false);
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
