/**
 * `POST /api/va/tasks` returned 200 with a task it never stored.
 *
 * `vaManagement.createTask` is a PURE FUNCTION: it stamps an id and timestamps
 * onto its input and returns the object. The route returned that object with a
 * 200. Nothing persisted it, and nothing ever could — `VA_TASKS_KEY =
 * "va_tasks"` is declared in that module and **never used**, alongside a
 * `SOP_LIBRARY_KEY` in the same state. Those two constants are the persistence
 * layer that was never written.
 *
 * `PUT /api/va/tasks/:id` was worse in a second way: it took `{ task, updates }`
 * **from the request body**, merged them in memory, returned the result, and
 * **ignored `:id` entirely**. The caller supplied the record it was "updating".
 * It was a merge function with a URL.
 *
 * A caller could not tell a stored record from a fabricated one. That is the
 * constitution's fabrication rule at the API boundary, and removing it is not a
 * product decision — so both routes now refuse with 501 and a message naming
 * what is missing.
 *
 * WHY 501 AND NOT A BUILD. `settings.va_tasks` has no creator anywhere in the
 * repo; `/api/va/metrics`, `/api/va/audit-trail` and `/api/va/tasks/:id/verify`
 * all read an array nothing populates; `GET /api/va/scheduled` reads
 * `va_scheduled_tasks`, which has exactly ONE reference in the entire
 * repository — that read. No client calls any of them. Building persistence
 * means a table, a migration and a UI; removing the subsystem means deleting six
 * reachable API routes. **Both are founder decisions** (BLOCKERS B9), and either
 * would discard a refusal written in the meantime — so nothing further was
 * invented.
 *
 * THE READ ROUTES WERE LEFT ALONE, deliberately. `[]` and zeros are accurate for
 * an empty collection. What is wrong is that the collection can never be
 * non-empty, which is the same decision above rather than a separate defect.
 * Asserting them as broken would be asserting a product opinion.
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

const elite = stripComments(
  fs.readFileSync(path.join(ROOT, "server/routes-elite-features.ts"), "utf8"),
);
const vaMgmt = stripComments(
  fs.readFileSync(path.join(ROOT, "server/services/vaManagement.ts"), "utf8"),
);

/** One route's handler, bounded at the next registration — never to EOF. */
function handler(src: string, marker: string): string {
  const at = src.indexOf(marker);
  expect(at, `${marker} not found — renamed?`).toBeGreaterThan(-1);
  const rest = src.slice(at + marker.length);
  const next = rest.search(/\bapp\.(get|post|put|patch|delete)\(/);
  return next === -1 ? src.slice(at) : src.slice(at, at + marker.length + next);
}

describe("a write that stores nothing does not report success", () => {
  it("POST /api/va/tasks refuses", () => {
    const h = handler(elite, 'app.post("/api/va/tasks"');
    expect(
      h,
      "the create route returns a task-shaped 200 again — a caller cannot tell " +
        "a stored record from a fabricated one",
    ).toContain("Errors.notImplemented(");
    expect(h, "it still calls the pure createTask and returns the result")
      .not.toContain("vaManagement.createTask(");
  });

  it("PUT /api/va/tasks/:id refuses", () => {
    const h = handler(elite, 'app.put("/api/va/tasks/:id"');
    expect(h).toContain("Errors.notImplemented(");
    expect(h).not.toContain("vaManagement.updateTask(");
  });

  it("each refusal names what is missing", () => {
    // A 501 with no explanation is honest and useless. The message has to say
    // WHY, so a caller knows this is absent rather than broken.
    for (const marker of ['app.post("/api/va/tasks"', 'app.put("/api/va/tasks/:id"']) {
      const h = handler(elite, marker);
      expect(h, `${marker} refuses without saying why`).toContain("not stored");
      expect(h, `${marker} does not point at the record`).toContain("B9");
    }
  });

  it("501, not 4xx or 503", () => {
    // notImplemented is reserved for an absent implementation. `badRequest`
    // would blame the caller's input; `serviceUnavailable` would promise it
    // works again later. Neither is true.
    const errors = stripComments(
      fs.readFileSync(path.join(ROOT, "server/utils/errors.ts"), "utf8"),
    );
    const at = errors.indexOf("notImplemented(");
    expect(at, "Errors.notImplemented is gone").toBeGreaterThan(-1);
    expect(errors.slice(at, at + 200)).toContain("501");
  });
});

describe("the premise: there is no persistence to report", () => {
  it("VA_TASKS_KEY is declared and never used", () => {
    // The constant that would have been the persistence layer. If it gains a
    // use, this subsystem may have grown one — at which point the refusals
    // above should be revisited rather than left in place.
    const uses = [...vaMgmt.matchAll(/VA_TASKS_KEY/g)].length;
    expect(uses, "VA_TASKS_KEY not found in vaManagement").toBeGreaterThan(0);
    expect(
      uses,
      "VA_TASKS_KEY is now used somewhere — if VA tasks are persisted, the 501 " +
        "refusals in routes-elite-features are stale and should be replaced " +
        "with the real implementation. See BLOCKERS B9.",
    ).toBe(1);
  });

  it("createTask is still pure — it returns, it does not save", () => {
    const at = vaMgmt.indexOf("export function createTask(");
    expect(at, "createTask is gone").toBeGreaterThan(-1);
    const body = vaMgmt.slice(at, vaMgmt.indexOf("export function", at + 30));
    for (const persist of ["storage.", "db.", "await "]) {
      expect(
        body,
        `createTask now reaches ${persist} — if it persists, the refusal above is stale`,
      ).not.toContain(persist);
    }
  });

  it("nothing creates settings.va_tasks", () => {
    // The whole basis for the refusal. Scanned across server/ rather than
    // asserted from memory, and the ONE write that exists is the verify
    // route's jsonb_set over an array nothing populates.
    const walk = (dir: string, out: string[] = []): string[] => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p, out);
        else if (e.name.endsWith(".ts") && !e.name.endsWith(".test.ts")) out.push(p);
      }
      return out;
    };
    const writers: string[] = [];
    for (const abs of walk(path.join(ROOT, "server"))) {
      const src = stripComments(fs.readFileSync(abs, "utf8"));
      // A write means the key appears on the LEFT of an assignment into
      // settings, or inside a jsonb_set path.
      if (/va_tasks['"]?\s*:/.test(src) || /\{va_tasks\}/.test(src)) {
        writers.push(path.relative(ROOT, abs));
      }
    }
    expect(
      writers,
      "a new writer of settings.va_tasks appeared — the subsystem may now " +
        "persist, so revisit the 501 refusals and BLOCKERS B9",
    ).toEqual(["server/routes-va-engine.ts"]);
  });
});
