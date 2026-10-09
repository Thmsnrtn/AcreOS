/**
 * The route-shadowing gate reads every route in a registrar — not the routes up
 * to the first regex literal that holds a brace.
 *
 * check-route-shadowing.mjs found a registrar's body with a `{`/`}` counter.
 * routes-doc-system.ts holds `previewContent.replace(/\{\{([^}]+)\}\}/g, …)`
 * at line ~489, which nets one extra `}`: the walk ended registerDocSystemRoutes
 * there, and the 31 routes after it were never read — among them a duplicate
 * POST /api/documents/generate, dead behind routes-documents.ts. The gate
 * printed "PASS — 0 shadowed".
 *
 * Two floors, as CLAUDE.md asks of a population claim: a canary per extraction
 * shape (the span is right), and a per-member diff over the real repo (every
 * registration in each single-registrar file is in the table the gate read).
 */
import { describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { functionBodySpan } from "../../scripts/lib/function-body.mjs";
import { nextVerdict } from "../../scripts/lib/next-guard.mjs";
import { stripComments } from "../helpers/stripComments";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";

vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

const ROOT = resolve(__dirname, "../..");
const span = functionBodySpan;

/** The walker the gate used to run — kept here only to prove each fixture defeats it. */
function naiveBodyEnd(src: string, name: string): number {
  const decl = new RegExp(String.raw`function\s+${name}\s*\(`).exec(src)!;
  const start = src.indexOf("{", decl.index + decl[0].length);
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return i;
  }
  return src.length;
}

const SHAPES: Record<string, string> = {
  "regex literal with an unbalanced brace (the live defect)": `
export function registerX(app) {
  app.get("/a", (req, res) => res.send(String(req.body).replace(/\\{\\{([^}]+)\\}\\}/g, "x")));
  app.post("/late", (req, res) => res.send("late"));
}`,
  "string holding a brace": `
export function registerX(app) {
  app.get("/a", (req, res) => res.send("}"));
  app.post("/late", (req, res) => res.send("late"));
}`,
  "template literal with a nested placeholder": `
export function registerX(app) {
  app.get("/a", (req, res) => res.send(\`}\${"{" + \`}\`}\`));
  app.post("/late", (req, res) => res.send("late"));
}`,
};

describe("functionBodySpan — one canary per shape", () => {
  for (const [shape, src] of Object.entries(SHAPES)) {
    it(shape, () => {
      const s = span(src, "registerX");
      expect(s).not.toBeNull();
      const body = src.slice(s!.start, s!.end);
      expect(body).toContain('app.post("/late"');
      expect(src[s!.end]).toBe("}");
      expect(src.slice(s!.end + 1).trim()).toBe("");
      // The fixture really does hide the defect from the old walker.
      expect(naiveBodyEnd(src, "registerX"), "fixture no longer defeats the brace counter").toBeLessThan(src.indexOf('app.post("/late"'));
    });
  }

  it("an arrow-function registrar is found too; an absent one is null (the gate counts it)", () => {
    const src = `export const registerY = (app) => { app.get("/y", (q, r) => r.send("y")); };`;
    expect(src.slice(span(src, "registerY")!.start)).toMatch(/^\{ app\.get/);
    expect(span(src, "registerZ")).toBeNull();
  });
});

describe("the real repo: every registration in a single-registrar file is in the gate's table", () => {
  const listed = execFileSync(process.execPath, [resolve(ROOT, "scripts/check-route-shadowing.mjs"), "--list-routes"], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { method: string; path: string; file: string; line: number; via: string });

  it("finds the table (vacuity floor)", () => {
    expect(listed.length).toBeGreaterThanOrEqual(2400);
  });

  it("no registrar file has a registration the gate did not read", () => {
    const byFile = new Map<string, Set<number>>();
    const registrarFiles = new Set<string>();
    for (const r of listed) {
      if (!r.via.startsWith("registrar ")) continue;
      registrarFiles.add(r.file);
      const set = byFile.get(r.file) ?? new Set<number>();
      set.add(r.line);
      byFile.set(r.file, set);
    }
    expect(registrarFiles.size).toBeGreaterThanOrEqual(120);
    let checked = 0;
    const missed: string[] = [];
    for (const file of registrarFiles) {
      const src = stripComments(readFileSync(resolve(ROOT, file), "utf8"));
      // Only files whose routes all live in ONE registrar function — there,
      // "in the file" and "in the registrar" are the same population.
      if ((src.match(/\bfunction\s+register[A-Za-z0-9_]*\s*\(/g) ?? []).length !== 1) continue;
      checked++;
      const lines = src.split("\n");
      lines.forEach((text, i) => {
        if (/\b(?:app|api)\.(?:get|post|put|patch|delete)\(\s*["']\//.test(text) && !byFile.get(file)!.has(i + 1)) {
          missed.push(`${file}:${i + 1}`);
        }
      });
    }
    expect(checked).toBeGreaterThanOrEqual(100);
    expect(missed).toEqual([]);
  });

  it("routes-doc-system.ts is read to its last route", () => {
    const src = readFileSync(resolve(ROOT, "server/routes-doc-system.ts"), "utf8").split("\n");
    const last = src.reduce((acc, t, i) => (/\bapi\.(?:get|post|put|patch|delete)\(\s*"\//.test(t) ? i + 1 : acc), 0);
    expect(listed.some((r) => r.file === "server/routes-doc-system.ts" && r.line === last)).toBe(true);
  });
});

describe("nextVerdict — a next() guarded on req.params passes only those values", () => {
  const handler = `async (req, res, next) => {
    if (req.params.service === "deep" || req.params.service === "replica") return next();
    res.json(await check(req.params.service));
  }`;
  it("the guarded literals fall through", () => {
    expect(nextVerdict(handler, "/api/health/deep")).toBe("FALLS_THROUGH");
    expect(nextVerdict(handler, "/api/health/replica")).toBe("FALLS_THROUGH");
  });
  it("any other value is answered by the earlier handler (the worker-heartbeat shape)", () => {
    expect(nextVerdict(handler, "/api/health/worker-heartbeat")).toBe("TERMINATES");
  });
  it("an unguarded next(), or one guarded on something else, keeps the conservative verdict", () => {
    expect(nextVerdict("(req, res, next) => { next(); }", "/x")).toBe("FALLS_THROUGH");
    expect(nextVerdict("(req, res, next) => {\n  if (!req.user) return next();\n}", "/x")).toBe("FALLS_THROUGH");
    expect(nextVerdict("(req, res) => res.send(1)", "/x")).toBe("NO_NEXT");
  });
});
