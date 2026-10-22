/**
 * Any connector executor that WRITES outward (POST/PUT/PATCH/DELETE) must be
 * reached only through the human tap — its tool must be in
 * APPROVAL_REQUIRED_TOOLS.
 *
 * ── THE DEFECT (audit 2026-10) ──────────────────────────────────────────────
 * `trigger_zapier` and `trigger_make` POSTed a model-composed payload — lead
 * names, phones, emails included — to the customer's webhook, which can fan
 * out to any of Zapier's 6,000 apps. shared/pax-controls.ts classed both as
 * `changes_records` and neither was in APPROVAL_REQUIRED_TOOLS, so Pax could
 * fire them on its own word. `create_calendar_event` (POST to Google Calendar,
 * which emails every attendee) had the same shape.
 *
 * ── WHY THE POPULATION IS DERIVED FROM THE EXECUTOR, NOT FROM TOOL NAMES ───
 * A list of tool names is exactly what went stale: nobody thought "trigger"
 * was a send. So this gate reads the executor modules with the TypeScript
 * parser, decides per function whether it can write outward — it holds a
 * write-method string literal, or (transitively) calls a local function that
 * does — and then maps each writing executor to the tool(s) whose dispatch
 * case calls it in server/ai/tools.ts. The parser never visits a comment.
 *
 * A writing executor reached by NO tool case is also a failure: the mapping
 * lost it, and an unmapped writer reads exactly like a clean one.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { APPROVAL_REQUIRED_TOOLS } from "../../server/services/approvalKernel";
import { groupForTool } from "@shared/pax-controls";

const ROOT = path.resolve(__dirname, "../..");

/** Every module whose exports a Pax tool case dispatches to for an external call. Add new ones here. */
const EXECUTOR_MODULES = [
  { file: "server/services/connectors/executor.ts", importSpecifier: "../services/connectors/executor" },
] as const;
const DISPATCH_FILE = "server/ai/tools.ts";

const WRITE_METHOD = /^(POST|PUT|PATCH|DELETE)$/;

function parse(file: string, text?: string): ts.SourceFile {
  const src = text ?? fs.readFileSync(path.join(ROOT, file), "utf8");
  return ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

interface FnInfo {
  exported: boolean;
  literalWrite: boolean;
  calls: Set<string>;
}

/** Map of top-level function name → whether it can write outward (transitively). */
function writingFunctions(sf: ts.SourceFile): { all: Map<string, FnInfo>; writers: Set<string>; exported: string[] } {
  const all = new Map<string, FnInfo>();
  for (const st of sf.statements) {
    let name: string | undefined;
    let body: ts.Node | undefined;
    let exported = false;
    if (ts.isFunctionDeclaration(st) && st.name && st.body) {
      name = st.name.text;
      body = st.body;
      exported = !!st.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    } else if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))) {
          name = d.name.text;
          body = d.initializer;
          exported = !!st.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
        }
      }
    }
    if (!name || !body) continue;
    const info: FnInfo = { exported, literalWrite: false, calls: new Set() };
    const visit = (n: ts.Node) => {
      if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && WRITE_METHOD.test(n.text)) info.literalWrite = true;
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) info.calls.add(n.expression.text);
      ts.forEachChild(n, visit);
    };
    visit(body);
    all.set(name, info);
  }
  const writers = new Set<string>([...all].filter(([, i]) => i.literalWrite).map(([n]) => n));
  let grew = true;
  while (grew) {
    grew = false;
    for (const [n, i] of all) {
      if (!writers.has(n) && [...i.calls].some((c) => writers.has(c))) {
        writers.add(n);
        grew = true;
      }
    }
  }
  return { all, writers, exported: [...all].filter(([, i]) => i.exported).map(([n]) => n) };
}

/** tool name → executor function names its dispatch case imports from `specifier`. */
function dispatchMap(specifier: string): Map<string, Set<string>> {
  const sf = parse(DISPATCH_FILE);
  const out = new Map<string, Set<string>>();
  const visit = (n: ts.Node) => {
    if (ts.isCaseClause(n) && ts.isStringLiteral(n.expression)) {
      const tool = n.expression.text;
      const fns = new Set<string>();
      const inner = (m: ts.Node) => {
        // const { fnName } = await import("<specifier>")
        if (
          ts.isVariableDeclaration(m) &&
          ts.isObjectBindingPattern(m.name) &&
          m.initializer &&
          ts.isAwaitExpression(m.initializer) &&
          ts.isCallExpression(m.initializer.expression) &&
          m.initializer.expression.expression.kind === ts.SyntaxKind.ImportKeyword &&
          ts.isStringLiteral(m.initializer.expression.arguments[0]) &&
          (m.initializer.expression.arguments[0] as ts.StringLiteral).text === specifier
        ) {
          for (const el of m.name.elements) {
            const imported = el.propertyName && ts.isIdentifier(el.propertyName) ? el.propertyName.text : ts.isIdentifier(el.name) ? el.name.text : "";
            if (imported) fns.add(imported);
          }
        }
        ts.forEachChild(m, inner);
      };
      n.statements.forEach(inner);
      if (fns.size) out.set(tool, fns);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

describe("vacuity: the executors and the dispatch switch parsed", () => {
  for (const mod of EXECUTOR_MODULES) {
    it(`${mod.file}: found exported executors and writers`, () => {
      const { exported, writers } = writingFunctions(parse(mod.file));
      expect(exported.length, "no exported executors parsed").toBeGreaterThanOrEqual(10);
      // Known writers today; if the parser stops seeing them, the gate is blind.
      for (const known of ["sendGmail", "sendSlackMessage", "createStripePaymentLink", "triggerZapier", "triggerMake", "createCalendarEvent"]) {
        expect(writers.has(known), `writer detection lost ${known}`).toBe(true);
      }
      // Negative controls: read-only executors are not writers.
      for (const reader of ["searchGmail", "getStripeCustomer", "listCalendarEvents", "searchMlsListings"]) {
        expect(writers.has(reader), `${reader} misread as a writer`).toBe(false);
      }
      const map = dispatchMap(mod.importSpecifier);
      expect(map.size, "no dispatch cases import this executor").toBeGreaterThanOrEqual(10);
    });
  }

  it("canary: a POST hidden behind a local helper, or in a comment", () => {
    const fixture = `
      async function postIt(url: string, body: object) { return fetch(url, { method: "POST", body: JSON.stringify(body) }); }
      async function getIt(url: string, method = "GET") { return fetch(url, { method }); }
      export async function hidden(org: any) { return postIt("https://x", {}); }
      export async function passed(org: any) { return getIt("https://x", "PUT"); }
      export async function readOnly(org: any) { /* method: "POST" */ return getIt("https://x"); }
    `;
    const { writers } = writingFunctions(parse("fixture.ts", fixture));
    expect(writers.has("hidden")).toBe(true);
    expect(writers.has("passed")).toBe(true);
    expect(writers.has("readOnly")).toBe(false);
  });
});

describe("every outward-writing connector executor is approval-required", () => {
  for (const mod of EXECUTOR_MODULES) {
    it(`${mod.file}: writers are reachable only through the tap`, () => {
      const { exported, writers } = writingFunctions(parse(mod.file));
      const map = dispatchMap(mod.importSpecifier);
      const exportedWriters = exported.filter((f) => writers.has(f));

      const unmapped = exportedWriters.filter((f) => ![...map.values()].some((s) => s.has(f)));
      expect(unmapped, "writing executors no tool case dispatches to — the mapping lost them, or dead code").toEqual([]);

      const offenders: string[] = [];
      for (const [tool, fns] of map) {
        if ([...fns].some((f) => writers.has(f)) && !APPROVAL_REQUIRED_TOOLS.has(tool)) offenders.push(tool);
      }
      expect(
        offenders,
        "these Pax tools write to an external service (POST/PUT/PATCH/DELETE) without the human " +
          "tap — add them to APPROVAL_REQUIRED_TOOLS (server/services/approvalKernel.ts) and class " +
          "them as `sends` in shared/pax-controls.ts",
      ).toEqual([]);
    });
  }

  it("and pax-controls classes them as sends, not record changes", () => {
    const map = dispatchMap(EXECUTOR_MODULES[0].importSpecifier);
    const { writers } = writingFunctions(parse(EXECUTOR_MODULES[0].file));
    for (const [tool, fns] of map) {
      if (![...fns].some((f) => writers.has(f))) continue;
      expect(groupForTool(tool), `${tool} writes outward but is not classed as a send`).toBe("sends");
    }
  });

  it("FIRES if trigger_zapier leaves the approval set (falsification)", () => {
    const map = dispatchMap(EXECUTOR_MODULES[0].importSpecifier);
    const { writers } = writingFunctions(parse(EXECUTOR_MODULES[0].file));
    const without = new Set([...APPROVAL_REQUIRED_TOOLS].filter((t) => t !== "trigger_zapier"));
    const offenders = [...map].filter(([t, fns]) => [...fns].some((f) => writers.has(f)) && !without.has(t)).map(([t]) => t);
    expect(offenders).toEqual(["trigger_zapier"]);
  });
});
