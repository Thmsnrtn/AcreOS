/**
 * The assigned-leads gate must hold on EVERY lead write path.
 *
 * `team_members.viewOnlyAssignedLeads` is a restriction an org owner sets
 * deliberately, and which is forced on for the `va` role. It was enforced on
 * `GET /api/leads`, `GET /api/leads/paginated`, `PUT /api/leads/:id` and the
 * `/api/bulk/leads/*` paths — and **missing from four writes**:
 * `DELETE /api/leads/:id`, `PATCH /api/leads/:id/restore`,
 * `POST /api/leads/bulk-delete` and `POST /api/leads/bulk-update`.
 *
 * A VA restricted to their own leads could delete, restore or mass-update any
 * lead in the org by guessing a numeric id, and the two bulk paths accepted an
 * arbitrary id array.
 *
 * SEVERITY, STATED HONESTLY: intra-org, not cross-tenant. Every affected path is
 * already org-scoped, so nothing crossed an organization boundary. What was
 * bypassed is a permission the org's own owner configured — a real boundary, and
 * not the same thing as a tenant leak.
 *
 * This is the same shape as the `/api/admin` MFA defect found earlier in this
 * program: a correct gate applied to some surfaces and not others, invisible
 * because each surface looks fine read on its own. The only way to see it is to
 * enumerate the surfaces and check them together — which is what this file does,
 * so the next write path cannot quietly join the unprotected set.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

/**
 * Source with comments stripped — a rule must hold in CODE, not in prose.
 *
 * LINE-BY-LINE, deliberately. The obvious one-regex implementation is wrong on
 * real source: an unbalanced block-comment OPENER inside a string or a regex
 * literal starts a comment that never closes where you expect, and everything
 * up to the next closer vanishes. Measured on
 * server/routes.ts it removed **38.8% of the file**, including the
 * `app.use("/api/admin", …)` line an assertion here was checking — so the
 * assertion failed against correct code, and a weaker assertion would have
 * PASSED against broken code.
 *
 * A state machine over lines cannot run away: a block comment must open and
 * close on lines, and a stray opener inside a string affects at most the
 * rest of that one line.
 */
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
    // Only treat `/*` as a comment when the line has no closing `*/` after it
    // AND the line looks like a comment line — anything else stays.
    const open = s.indexOf("/*");
    if (open > -1) {
      const close = s.indexOf("*/", open + 2);
      if (close > -1) {
        s = s.slice(0, open) + s.slice(close + 2);
      } else if (/^\s*\{?\s*\/\*/.test(s)) {
        // `{/*` too: a JSX comment is prose, and prose must not satisfy a
        // code assertion. Without this, a `{/* No "dismiss" ... */}` comment
        // made a test asserting the ABSENCE of "dismiss" fail on the very
        // comment documenting why it is absent.
        s = s.slice(0, open);
        inBlock = true;
      }
    }
    out.push(s.replace(/(^|[^:])\/\/.*$/, "$1"));
  }
  // The guard is STRUCTURAL, not a ratio.
  //
  // A ratio was tried first — "a strip that eats a third of the file is a bug"
  // — and it fired on correct output: this repo's files are deliberately
  // comment-heavy, and server/utils/assignedLeadGate.ts is 72% prose by design.
  // A guard whose premise is wrong is worse than no guard, because it fails on
  // correct input and trains the next reader to loosen it.
  //
  // An unclosed block at EOF is the real signal: it means an opener was taken
  // for a comment that never ended, which is precisely the runaway this
  // function exists to prevent. Comment density is not evidence of anything.
  if (inBlock) {
    throw new Error(
      "stripComments reached EOF inside an unclosed block comment — an opener " +
        "was mistaken for one; assertions against this output would be meaningless.",
    );
  }
  return out.join("\n");
}

function code(rel: string): string {
  return stripComments(read(rel));
}

/**
 * THE POPULATION IS EVERY REGISTRATION OF THESE PATHS, IN ANY FILE — not one file.
 *
 * This test used to read a single hardcoded file:
 *     const LEADS = "server/routes-leads.ts";
 * and proved that the gate's SYMBOLS appeared in the handlers it found there.
 * On 2026-08-27 that turned out to be a false green covering a live
 * authorization hole.
 *
 * POST /api/leads/bulk-delete was registered TWICE. The guarded copy in
 * routes-leads.ts (registered by registerLeadRoutes(app) at server/routes.ts:2335)
 * was UNREACHABLE, because an inline, UNGUARDED copy at server/routes.ts:1247
 * registers first and Express matches in registration order. So this file
 * certified a handler that could never run, while the one that actually served
 * requests carried requirePermission("canDeleteLeads") and nothing else — and
 * `viewOnlyAssignedLeads` is a PER-USER restriction layered on top of a role, so
 * a member carrying it kept canDeleteLeads:true and could bulk-delete every lead
 * in the org, not just their own.
 *
 * That is CLAUDE.md's first law exactly: the gate proved "this symbol appears in
 * this file" rather than "the forbidden behaviour cannot be reached".
 *
 * So the scan is now over EVERY server file. Every registration of a guarded
 * path must carry the gate, wherever it lives and whether or not it is the one
 * Express currently reaches — which also means a future duplicate cannot
 * reintroduce the hole by being added somewhere this test was not looking.
 */
const SERVER_DIR = "server";

/**
 * Every route in routes-leads.ts that MUTATES a lead by id (or id array).
 *
 * Creation is excluded on purpose: a lead that does not exist yet cannot be
 * assigned to someone else, so there is nothing for the restriction to protect.
 * Enrichment and scoring are excluded because they derive facts about a lead
 * rather than changing what it says — if that ever stops being true they belong
 * here, and the completeness check below will not catch it, which is stated so
 * the boundary is a decision rather than an oversight.
 */
const GUARDED_WRITES = [
  { method: "put", pattern: '"/api/leads/:id"', shape: "single" },
  { method: "delete", pattern: '"/api/leads/:id"', shape: "single" },
  { method: "patch", pattern: '"/api/leads/:id/restore"', shape: "single" },
  { method: "post", pattern: '"/api/leads/bulk-delete"', shape: "bulk" },
  { method: "post", pattern: '"/api/leads/bulk-update"', shape: "bulk" },
] as const;

/** Every non-test .ts file under server/. */
function serverFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (!/node_modules|dist|build/.test(rel)) serverFiles(rel, out);
    } else if (/\.ts$/.test(entry.name) && !/\.(test|spec)\.ts$/.test(entry.name)) {
      out.push(rel);
    }
  }
  return out;
}

/**
 * EVERY handler body registering `pattern`, across all of server/.
 *
 * Receiver-agnostic (`api.` / `app.` / `router.`): the hole this test missed was
 * an `app.post(...)` in routes.ts while the scan only recognised `api.`.
 */
function handlers(method: string, pattern: string): Array<{ file: string; body: string }> {
  const found: Array<{ file: string; body: string }> = [];
  for (const rel of serverFiles(SERVER_DIR)) {
    const src = code(rel);
    const needle = new RegExp(
      `\\b(?:api|app|router)\\.${method}\\(\\s*${pattern.replace(/[/\\^$*+?.()|[\]{}]/g, "\\$&")}`,
    );
    const m = needle.exec(src);
    if (!m) continue;
    const start = m.index;
    const rest = src.slice(start + 1);
    const next = rest.search(/\n\s*(?:api|app|router)\.(get|post|put|patch|delete)\(/);
    found.push({ file: rel, body: next === -1 ? src.slice(start) : src.slice(start, start + 1 + next) });
  }
  return found;
}

describe("every lead write path enforces the assigned-leads restriction", () => {
  it("finds every route it claims to check, in at least one file (vacuity guard)", () => {
    // Without this, a renamed path would make the whole file pass by checking
    // nothing — the failure mode of every source-scanning security test.
    for (const w of GUARDED_WRITES) {
      expect(
        handlers(w.method, w.pattern).length,
        `${w.method.toUpperCase()} ${w.pattern} not found anywhere under server/ — renamed?`,
      ).toBeGreaterThan(0);
    }
    // And the scan must actually be walking the tree.
    expect(serverFiles(SERVER_DIR).length).toBeGreaterThan(500);
  });

  it("attaches the permission context, or the gate reads undefined and passes", () => {
    // The check is `context?.permissions.viewOnlyAssignedLeads`. Without
    // attachPermissionContext() the optional chain yields undefined, the
    // condition is falsy, and the gate silently allows everything — a guard that
    // fails OPEN when its input is missing.
    for (const w of GUARDED_WRITES) {
      for (const { file, body } of handlers(w.method, w.pattern)) {
        expect(body, `${w.method.toUpperCase()} ${w.pattern} in ${file}`).toContain(
          "attachPermissionContext()",
        );
      }
    }
  });

  it("calls the shared gate — a single lead is checked against its assignee", () => {
    for (const w of GUARDED_WRITES.filter((x) => x.shape === "single")) {
      for (const { file, body } of handlers(w.method, w.pattern)) {
        expect(body, `${w.method.toUpperCase()} ${w.pattern} in ${file}`).toMatch(
          /assertAssignedLeadWritable\(/,
        );
        // ...and returns immediately on refusal. A gate whose result is computed
        // and ignored is worse than none: it reads as protection.
        expect(
          body,
          `${w.method.toUpperCase()} ${w.pattern} in ${file} ignores the refusal`,
        ).toMatch(/if \(assertAssignedLeadWritable\([^)]*\)\) return;/);
      }
    }
  });

  it("refuses BULK writes outright rather than filtering them", () => {
    // A bulk call that quietly does less than it was asked reports success for
    // work it did not do. Refusal is visible; silent narrowing is not.
    for (const w of GUARDED_WRITES.filter((x) => x.shape === "bulk")) {
      const found = handlers(w.method, w.pattern);
      for (const { file, body } of found) {
        expect(
          body,
          `${w.method.toUpperCase()} ${w.pattern} in ${file} — EVERY registration of a ` +
            `guarded path must carry the gate, not just the one that happens to be ` +
            `reachable today. This assertion is the one that was false-green on ` +
            `2026-08-27: the guarded copy was dead and the live one was unguarded.`,
        ).toMatch(/if \(refuseBulkLeadWrite\([^)]*\)\) return;/);
      }
    }
  });

  it("the refusal happens BEFORE the write, not after it", () => {
    // Ordering is the whole property. The MFA defect this mirrors was a gate
    // registered below the routes it was meant to protect.
    for (const w of GUARDED_WRITES) {
      for (const { file, body: h } of handlers(w.method, w.pattern)) {
        const gate = Math.max(
          h.indexOf("assertAssignedLeadWritable("),
          h.indexOf("refuseBulkLeadWrite("),
        );
        expect(gate, `${w.pattern} in ${file} has no gate`).toBeGreaterThan(-1);
        // The first mutation in the handler, whichever form it takes.
        const mutations = [
          h.indexOf("db.update(leads)"),
          h.indexOf("storage.updateLead("),
          h.indexOf("storage.bulkDeleteLeads("),
          h.indexOf("storage.bulkUpdateLeads("),
        ].filter((i) => i > -1);
        for (const m of mutations) {
          expect(gate, `${w.pattern} in ${file}: gate runs after the write`).toBeLessThan(m);
        }
      }
    }
  });
});

describe("the rule has ONE owner", () => {
  it("lives in a shared module, not in hand-written copies", () => {
    // Five copies of a security rule is not five times the safety; it is five
    // chances to forget the sixth — which is exactly what happened.
    const gate = code("server/utils/assignedLeadGate.ts");
    expect(gate).toContain("export function assertAssignedLeadWritable");
    expect(gate).toContain("export function refuseBulkLeadWrite");
  });

  it("treats an UNASSIGNED lead as not writable by a restricted caller", () => {
    // "Assigned to nobody" must not read as "assigned to everybody" — that
    // would void the restriction for exactly the leads most likely to be
    // unclaimed.
    const gate = code("server/utils/assignedLeadGate.ts");
    expect(gate).toMatch(/assignedTo == null \|\|/);
  });

  it("compares as strings, so a numeric id never mismatches a string one", () => {
    const gate = code("server/utils/assignedLeadGate.ts");
    expect(gate).toMatch(/String\(assignedTo\) !== String\(callerId\)/);
  });

  it("names the restriction, never the ids, so the error is not a probe", () => {
    const gate = read("server/utils/assignedLeadGate.ts");
    const fn = gate.slice(gate.indexOf("export function refuseBulkLeadWrite"));
    expect(fn).not.toMatch(/\$\{ids\}|\$\{leadId\}/);
  });
});
