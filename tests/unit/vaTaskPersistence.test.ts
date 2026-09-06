/**
 * `POST /api/va/tasks` returned 200 with a task it never stored. Now it stores it.
 *
 * WHAT THIS FILE USED TO PIN, AND WHY IT CHANGED
 * ---------------------------------------------
 * `vaManagement.createTask` was a PURE FUNCTION: it stamped an id and timestamps
 * onto its input and returned the object. The route returned that object with a
 * 200. Nothing persisted it, and nothing ever could — `VA_TASKS_KEY = "va_tasks"`
 * was declared in that module and **never used**, alongside a `SOP_LIBRARY_KEY`
 * in the same state. Those two constants were the persistence layer that was
 * never written.
 *
 * `PUT /api/va/tasks/:id` was worse in a second way: it took `{ task, updates }`
 * **from the request body**, merged them in memory, returned the result, and
 * **ignored `:id` entirely**. The caller supplied the record it was "updating".
 * It was a merge function with a URL.
 *
 * Unit 49 made both refuse with 501, and this file pinned the refusals. The
 * refusal was the right answer to "a caller cannot tell a stored record from a
 * fabricated one" — but it was never the destination, because building the layer
 * or deleting the subsystem was a founder decision (BLOCKERS B9).
 *
 * **The founder ruled on 2026-08-13: build it.** So the assertions below are
 * rewritten to the new truth rather than deleted — the invariant they were
 * protecting is *a write endpoint must not report a success it did not perform*,
 * and that invariant is now satisfied by storing rather than by refusing. The
 * checks that would have caught a regression to the old lie are kept in that
 * form: the route must reach a persisting call, and the persisting call must
 * actually reach the database.
 *
 * WHAT WAS BUILT: `va_tasks` and `va_sops` (migration 0235, mirrored in
 * `scripts/migrate.mjs`), an org-scoped service layer, `GET /api/va/tasks` and
 * `GET /api/va/tasks/:id` so a stored task can be read back, and the SOP library
 * `SOP_LIBRARY_KEY` was declared for.
 *
 * THE ONE THING STILL REFUSED: `GET /api/va/scheduled` read
 * `settings.va_scheduled_tasks`, which had exactly ONE reference in the entire
 * repository — that read. Recurring VA tasks are a different feature (a template
 * table AND a runner), and building a scheduler nothing triggers would be the
 * "built but unwired" defect this program keeps finding. It refuses instead.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "../helpers/stripComments";

const ROOT = path.resolve(__dirname, "../..");

const elite = stripComments(
  fs.readFileSync(path.join(ROOT, "server/routes-elite-features.ts"), "utf8"),
);
const vaMgmt = stripComments(
  fs.readFileSync(path.join(ROOT, "server/services/vaManagement.ts"), "utf8"),
);
const engine = stripComments(
  fs.readFileSync(path.join(ROOT, "server/routes-va-engine.ts"), "utf8"),
);

/** One route's handler, bounded at the next registration — never to EOF. */
function handler(src: string, marker: string): string {
  const at = src.indexOf(marker);
  expect(at, `${marker} not found — renamed?`).toBeGreaterThan(-1);
  const rest = src.slice(at + marker.length);
  const next = rest.search(/\b(app|api)\.(get|post|put|patch|delete)\(/);
  return next === -1 ? src.slice(at) : src.slice(at, at + marker.length + next);
}

describe("the write endpoints persist what they report", () => {
  it("POST /api/va/tasks stores the task", () => {
    const h = handler(elite, 'app.post("/api/va/tasks"');
    expect(
      h,
      "the create route is back to refusing. If persistence was removed, the " +
        "subsystem went with it — see BLOCKERS B9 and the deletion ledger.",
    ).not.toContain("Errors.notImplemented(");
    expect(h, "it no longer reaches the persisting service").toContain(
      "vaManagement.createTask(",
    );
  });

  it("it takes the organization from the request, never the body", () => {
    const h = handler(elite, 'app.post("/api/va/tasks"');
    expect(h).toContain("getOrganizationId(req)");
    // A body-supplied organizationId is a cross-tenant write with extra steps.
    expect(
      h,
      "the create route accepts an organization from the request body",
    ).not.toMatch(/organizationId:\s*(req\.body|parsed\.data)/);
  });

  it("who assigned the task is the caller, not a request field", () => {
    // An audit trail anyone can write their own name out of is not one.
    const h = handler(elite, 'app.post("/api/va/tasks"');
    expect(h).toContain("assignedByUserId: req.user?.id");
  });

  it("PUT /api/va/tasks/:id updates the STORED row, by :id", () => {
    const h = handler(elite, 'app.put("/api/va/tasks/:id"');
    expect(h).not.toContain("Errors.notImplemented(");
    expect(h).toContain("vaManagement.updateTask(");
    // The original defect, stated as its own assertion: the record being updated
    // came from the request body and `:id` was ignored entirely.
    expect(h, "the update route reads :id again").toContain("req.params.id");
    expect(
      h,
      "the update route takes the record it is updating from the body again — " +
        "that is a merge function with a URL, not an update",
    ).not.toMatch(/req\.body\.task\b/);
  });

  it("a stored task can be read back", () => {
    // The reason the create endpoint is worth having. A subsystem that can store
    // a task but never show it is the same dead end in a different place.
    expect(elite, "GET /api/va/tasks is gone").toContain('app.get("/api/va/tasks"');
    expect(elite, "GET /api/va/tasks/:id is gone").toContain('app.get("/api/va/tasks/:id"');
  });

  it("a task belonging to another org reads as 404, not 403", () => {
    // 403 confirms the row exists. Both single-task routes must refuse the same
    // way, and the service raises one error for "not yours" and "not there".
    for (const marker of ['app.get("/api/va/tasks/:id"', 'app.put("/api/va/tasks/:id"']) {
      const h = handler(elite, marker);
      expect(h, `${marker} does not handle the tenancy refusal`).toContain(
        "VaTaskNotInOrgError",
      );
      expect(h, `${marker} answers something other than 404`).toContain(
        'Errors.notFound(res, "Task")',
      );
    }
  });
});

describe("the service layer really reaches the database", () => {
  it("createTask inserts", () => {
    // The inverse of the old assertion, which required createTask to contain no
    // `db.` and no `await` — that was how "pure function" was pinned.
    const at = vaMgmt.indexOf("export async function createTask(");
    expect(at, "createTask is gone or is synchronous again").toBeGreaterThan(-1);
    const body = vaMgmt.slice(at, vaMgmt.indexOf("export ", at + 30));
    expect(body).toContain("db\n    .insert(vaTasks)");
    expect(body, "the insert does not carry the organization").toContain("organizationId,");
  });

  it("every persisting function is org-scoped", () => {
    // Not "takes an orgId" — USES it in the predicate. A method that accepts an
    // organization and resolves by primary key anyway is the exact shape
    // check-org-scoped-fetch's rule 2 exists to catch.
    for (const fn of ["getTask", "listTasks", "updateTask", "verifyTask"]) {
      const at = vaMgmt.indexOf(`export async function ${fn}(`);
      expect(at, `${fn} is gone`).toBeGreaterThan(-1);
      const body = vaMgmt.slice(at, vaMgmt.indexOf("export ", at + 30));
      expect(body, `${fn} does not take an organizationId`).toContain(
        "organizationId: number",
      );
      expect(
        body,
        `${fn} accepts an organization and does not filter on it`,
      ).toContain("eq(vaTasks.organizationId, organizationId)");
    }
  });

  it("the lifecycle stamps are derived, never accepted from the caller", () => {
    // A caller-supplied completedAt is how "tasks completed this week" becomes a
    // number someone typed. The update schema must not admit them, and the
    // service must set them from the status transition.
    const at = vaMgmt.indexOf("export interface UpdateVaTaskInput");
    const iface = vaMgmt.slice(at, vaMgmt.indexOf("}", at));
    for (const field of ["completedAt", "startedAt", "verified"]) {
      expect(iface, `UpdateVaTaskInput accepts ${field}`).not.toContain(field);
    }
    const fn = vaMgmt.slice(vaMgmt.indexOf("export async function updateTask("));
    expect(fn).toContain('updates.status === "completed" && !current.completedAt');
    expect(fn).toContain('updates.status === "in_progress" && !current.startedAt');
  });

  it("the dead constants are gone, not merely unused", () => {
    // VA_TASKS_KEY and SOP_LIBRARY_KEY WERE the persistence layer — two strings
    // naming a settings blob nothing ever wrote. Leaving them beside a real
    // table would give the next reader two answers to "where do tasks live?".
    for (const dead of ["VA_TASKS_KEY", "SOP_LIBRARY_KEY", "generateTaskId", "generateSopId"]) {
      expect(vaMgmt, `${dead} is back in vaManagement`).not.toContain(dead);
    }
  });
});

describe("the read endpoints report the table, not an empty blob", () => {
  it("metrics and the audit trail read va_tasks", () => {
    // They used to compute over organizations.settings.va_tasks — an array with
    // no creator anywhere in the repo — and return zeros. Zeros READ as
    // measurements: "0 tasks completed" and "no task tracking exists" are
    // different facts, and these endpoints stated the first while meaning the
    // second.
    for (const marker of ['api.get("/api/va/metrics"', 'api.get("/api/va/audit-trail"']) {
      const h = handler(engine, marker);
      expect(h, `${marker} does not read the table`).toContain("vaManagement.listTasks(");
      expect(h, `${marker} still reads the settings blob`).not.toContain(
        "settings?.va_tasks",
      );
    }
  });

  it("the audit trail no longer invents the VA's own account of the work", () => {
    // It carried `reasoning: t.completionNotes || "Task completed as assigned"`
    // — a default sentence presented as what the assistant said they did. An
    // absent note is an absent note.
    const h = handler(engine, 'api.get("/api/va/audit-trail"');
    expect(h, "the fabricated reasoning default is back").not.toContain(
      "Task completed as assigned",
    );
  });

  it("verify updates the row instead of an array nothing populates", () => {
    // This was the ONLY write to settings.va_tasks in the repository: a
    // read-modify-write of an array with no creator, so it could never find a
    // task and always answered 404.
    const h = handler(engine, 'api.post("/api/va/tasks/:id/verify"');
    expect(h).toContain("vaManagement.verifyTask(");
    expect(h, "the jsonb_set over the settings blob is back").not.toContain("jsonb_set");
    expect(h).toContain("VaTaskNotInOrgError");
  });

  it("nothing writes settings.va_tasks any more", () => {
    // The old version of this check allowed exactly one writer — the verify
    // route's jsonb_set. There should now be none: a second home for the same
    // data is how the two disagree.
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
      if (/settings\?\.\s*va_tasks/.test(src) || /\{va_tasks\}/.test(src)) {
        writers.push(path.relative(ROOT, abs));
      }
    }
    expect(
      writers.join(", "),
      "settings.va_tasks is being read or written again. Tasks live in the " +
        "va_tasks TABLE since 2026-08-13; the blob is read on nearly every " +
        "org-scoped request and concurrent writers clobber each other.",
    ).toBe("");
  });
});

describe("scheduled tasks are refused, not faked", () => {
  it("GET /api/va/scheduled says what is missing", () => {
    // `va_scheduled_tasks` had exactly one reference in the repository: this
    // read. Recurring VA tasks need a template table AND a runner, and building
    // a scheduler nothing triggers is the "built but unwired" defect this
    // program keeps finding. So it refuses rather than returning [] from a store
    // with no writer.
    const h = handler(engine, 'api.get("/api/va/scheduled"');
    expect(h).toContain("Errors.notImplemented(");
    expect(h, "the refusal does not say what is absent").toContain("recurring");
  });
});
