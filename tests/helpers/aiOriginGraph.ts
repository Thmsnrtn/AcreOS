/**
 * Who reaches each metered AI call: a customer-facing route, a background job,
 * or both — and what origin the call declares.
 *
 * The shared AI allowance counts spend recorded with origin "customer" only,
 * and every caller declares its own origin. A background job that claims
 * "customer" drains a customer's allowance for work they never asked for; a
 * route that claims "background" hands out AI the allowance never sees. This
 * module builds the evidence a gate needs to refuse both:
 *
 *   UNITS     every function-shaped declaration in server/ — function
 *             declarations, const arrow/function expressions, class methods,
 *             object-literal methods — plus every inline route handler
 *             (`x.get("/api/…", …, handler)`) as its own unit.
 *   EDGES     a call `f(…)`, `obj.f(…)` or `new F(…)` inside a unit, resolved
 *             by name through the file's imports (static named imports,
 *             namespace imports, and `const { f } = await import("…")`) or
 *             to a same-file unit. Name-based and deliberately generous: an
 *             edge that resolves to every unit of that name in the module.
 *   ROOTS     customer: a handler registered on a non-founder, non-admin
 *             /api route. job: every unit in server/jobs/**, server/worker.ts,
 *             and any unit that calls withJobLock(…).
 *   SITES     every call of a metered entrypoint outside the two modules that
 *             define them, with the origin it declares: an explicit literal,
 *             an implicit one (routeAITask defaults to "customer" unless
 *             skipQuota), "forwarded" (a non-literal the caller supplies), or
 *             "n/a" (no orgId on the call, so no allowance is involved).
 *
 * Pure: takes { path → source } so a test can feed it fixtures (canaries).
 */
import ts from "typescript";
import path from "node:path";

/** Metered entrypoint → index of its meta/config argument. */
export const METERED_ENTRYPOINTS: Record<string, number> = {
  meteredChatCompletion: 2,
  meteredAnthropicMessage: 2,
  recordExternalAiSpend: 0,
  routeAITask: 1,
  routeSimpleTask: 2,
  routeComplexTask: 2,
  routeVisionTask: 2,
  generateWithAutoRouting: 3,
  routeReasoningTask: 3,
  routeCriticalTask: 3,
  routeExtendedThinkingTask: 4,
  routeWithRegisteredPrompt: 3,
};
/** The modules that define the entrypoints; calls inside them are plumbing. */
export const DEFINING_MODULES = ["server/services/aiSpendGuard.ts", "server/services/aiRouter.ts"];

export type DeclaredOrigin = "customer" | "background" | "forwarded" | "n/a";
export interface MeteredSite {
  file: string;
  line: number;
  entry: string;
  unit: string;
  declared: DeclaredOrigin;
  implicit: boolean;
  reachedByCustomer: boolean;
  reachedByJob: boolean;
}
export interface OriginGraph {
  units: number;
  customerRoots: number;
  jobRoots: number;
  edges: number;
  sites: MeteredSite[];
  /** Units containing a call the walker could not attribute to any unit. */
  unattributedCalls: number;
}

const VERBS = new Set(["get", "post", "put", "patch", "delete", "all"]);

function isFounderOrAdminRoute(file: string, routePath: string): boolean {
  if (/\/api\/(founder|admin)\b/.test(routePath)) return true;
  if (/^\/(founder|admin)\b/.test(routePath)) return true;
  return /routes-(founder|admin)/.test(path.basename(file));
}

function resolveModule(fromFile: string, spec: string, files: Set<string>): string | null {
  let base: string | null = null;
  if (spec.startsWith("@shared/")) base = "shared/" + spec.slice("@shared/".length);
  else if (spec.startsWith(".")) base = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), spec));
  if (!base) return null;
  for (const c of [base, base + ".ts", base + ".tsx", base + "/index.ts"]) if (files.has(c)) return c;
  return null;
}

interface Unit {
  id: string; // file#name
  file: string;
  name: string;
  node: ts.Node;
  customerRoot: boolean;
  jobRoot: boolean;
}

export function buildOriginGraph(sources: Record<string, string>): OriginGraph {
  const fileSet = new Set(Object.keys(sources));
  const units: Unit[] = [];
  const unitsByFileName = new Map<string, Unit[]>(); // `${file}#${name}`
  const unitOfNode = new Map<ts.Node, Unit>();
  const imports = new Map<string, Map<string, { module: string; imported: string | "*" }>>();
  const parsed = new Map<string, ts.SourceFile>();

  const addUnit = (file: string, name: string, node: ts.Node, flags: Partial<Unit> = {}) => {
    const u: Unit = { id: `${file}#${name}`, file, name, node, customerRoot: false, jobRoot: false, ...flags };
    units.push(u);
    unitOfNode.set(node, u);
    const k = `${file}#${name}`;
    if (!unitsByFileName.has(k)) unitsByFileName.set(k, []);
    unitsByFileName.get(k)!.push(u);
    return u;
  };

  for (const [file, text] of Object.entries(sources)) {
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    parsed.set(file, sf);
    const imp = new Map<string, { module: string; imported: string | "*" }>();
    imports.set(file, imp);
    const isJobFile = /^server\/jobs\//.test(file) || file === "server/worker.ts";

    const visit = (n: ts.Node) => {
      // imports
      if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier) && n.importClause) {
        const mod = resolveModule(file, n.moduleSpecifier.text, fileSet);
        if (mod) {
          const nb = n.importClause.namedBindings;
          if (n.importClause.name) imp.set(n.importClause.name.text, { module: mod, imported: "default" });
          if (nb && ts.isNamespaceImport(nb)) imp.set(nb.name.text, { module: mod, imported: "*" });
          if (nb && ts.isNamedImports(nb)) for (const el of nb.elements) imp.set(el.name.text, { module: mod, imported: (el.propertyName ?? el.name).text });
        }
      }
      // const { a, b: c } = await import("…")  /  const m = await import("…")
      if (ts.isVariableDeclaration(n) && n.initializer) {
        let init: ts.Expression = n.initializer;
        if (ts.isAwaitExpression(init)) init = init.expression;
        if (ts.isCallExpression(init) && init.expression.kind === ts.SyntaxKind.ImportKeyword && init.arguments[0] && ts.isStringLiteralLike(init.arguments[0])) {
          const mod = resolveModule(file, (init.arguments[0] as ts.StringLiteral).text, fileSet);
          if (mod) {
            if (ts.isObjectBindingPattern(n.name)) {
              for (const el of n.name.elements) if (ts.isIdentifier(el.name)) imp.set(el.name.text, { module: mod, imported: (el.propertyName && ts.isIdentifier(el.propertyName) ? el.propertyName : el.name).text });
            } else if (ts.isIdentifier(n.name)) imp.set(n.name.text, { module: mod, imported: "*" });
          }
        }
      }
      // units
      if (ts.isFunctionDeclaration(n) && n.name && n.body) addUnit(file, n.name.text, n, { jobRoot: isJobFile });
      else if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer))) addUnit(file, n.name.text, n.initializer, { jobRoot: isJobFile });
      else if ((ts.isMethodDeclaration(n) || ts.isGetAccessorDeclaration(n)) && n.body && n.name && (ts.isIdentifier(n.name) || ts.isStringLiteral(n.name))) addUnit(file, n.name.text, n, { jobRoot: isJobFile });
      else if (ts.isPropertyAssignment(n) && (ts.isIdentifier(n.name) || ts.isStringLiteral(n.name)) && (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer))) addUnit(file, n.name.text, n.initializer, { jobRoot: isJobFile });
      // route handlers: x.verb("/path", ...handlers) — each function argument is a root
      if (
        ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && VERBS.has(n.expression.name.text) &&
        n.arguments.length >= 2 && ts.isStringLiteralLike(n.arguments[0]) && n.arguments[0].text.startsWith("/")
      ) {
        const routePath = n.arguments[0].text;
        const customer = !isFounderOrAdminRoute(file, routePath);
        n.arguments.slice(1).forEach((a, i) => {
          if (ts.isArrowFunction(a) || ts.isFunctionExpression(a)) {
            addUnit(file, `${n.expression.getText(sf)}(${routePath})#${i}`, a, { customerRoot: customer });
          } else if (ts.isCallExpression(a)) {
            // wrapper: asyncHandler(async (req, res) => …)
            for (const inner of a.arguments) if (ts.isArrowFunction(inner) || ts.isFunctionExpression(inner)) addUnit(file, `${n.expression.getText(sf)}(${routePath})#${i}w`, inner, { customerRoot: customer });
          }
        });
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }

  // Nearest enclosing unit for any node.
  const enclosingUnit = (n: ts.Node): Unit | null => {
    let p: ts.Node | undefined = n.parent;
    while (p) {
      const u = unitOfNode.get(p);
      if (u) return u;
      p = p.parent;
    }
    return null;
  };

  // A unit containing a withJobLock(…) call is a job root.
  // Edges callee → callers (reverse graph).
  const callers = new Map<Unit, Set<Unit>>();
  let edges = 0;
  let unattributedCalls = 0;
  const link = (callee: Unit, caller: Unit) => {
    if (callee === caller) return;
    if (!callers.has(callee)) callers.set(callee, new Set());
    if (!callers.get(callee)!.has(caller)) edges++;
    callers.get(callee)!.add(caller);
  };
  // A nested unit (a callback inside a function) is "called" by its parent.
  for (const u of units) {
    const parent = enclosingUnit(u.node);
    if (parent) link(u, parent);
  }

  const sites: { file: string; line: number; entry: string; unit: Unit | null; call: ts.CallExpression }[] = [];
  for (const [file, sf] of parsed) {
    const imp = imports.get(file)!;
    const visit = (n: ts.Node) => {
      if (ts.isCallExpression(n) || ts.isNewExpression(n)) {
        const callee = n.expression;
        let name: string | null = null;
        let targets: Unit[] = [];
        if (ts.isIdentifier(callee)) {
          name = callee.text;
          const im = imp.get(name);
          if (im) targets = unitsByFileName.get(`${im.module}#${im.imported}`) ?? [];
          else targets = unitsByFileName.get(`${file}#${name}`) ?? [];
        } else if (ts.isPropertyAccessExpression(callee)) {
          name = callee.name.text;
          const obj = callee.expression;
          if (ts.isIdentifier(obj) && imp.has(obj.text)) {
            targets = unitsByFileName.get(`${imp.get(obj.text)!.module}#${name}`) ?? [];
          } else if (obj.kind === ts.SyntaxKind.ThisKeyword || ts.isIdentifier(obj)) {
            targets = unitsByFileName.get(`${file}#${name}`) ?? [];
          }
        }
        const caller = enclosingUnit(n);
        if (name === "withJobLock" && caller) caller.jobRoot = true;
        if (caller) for (const t of targets) link(t, caller);
        if (name && Object.prototype.hasOwnProperty.call(METERED_ENTRYPOINTS, name) && !DEFINING_MODULES.includes(file) && ts.isCallExpression(n)) {
          sites.push({ file, line: sf.getLineAndCharacterOfPosition(n.getStart()).line + 1, entry: name, unit: caller, call: n });
        }
        if (caller && targets.length === 0 && name && imp.has(ts.isIdentifier(callee) ? callee.text : "")) unattributedCalls++;
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }

  // Reverse reachability from a unit to roots.
  const memo = new Map<Unit, { c: boolean; j: boolean }>();
  const reach = (start: Unit) => {
    const hit = memo.get(start);
    if (hit) return hit;
    let c = false;
    let j = false;
    const seen = new Set<Unit>([start]);
    const stack = [start];
    while (stack.length && !(c && j)) {
      const u = stack.pop()!;
      if (u.customerRoot) c = true;
      if (u.jobRoot) j = true;
      for (const p of callers.get(u) ?? []) if (!seen.has(p)) { seen.add(p); stack.push(p); }
    }
    const r = { c, j };
    memo.set(start, r);
    return r;
  };

  const out: MeteredSite[] = sites.map((s) => {
    const { declared, implicit } = declaredOrigin(s.call, s.entry);
    const r = s.unit ? reach(s.unit) : { c: false, j: false };
    return {
      file: s.file,
      line: s.line,
      entry: s.entry,
      unit: s.unit ? s.unit.name : "<module>",
      declared,
      implicit,
      reachedByCustomer: r.c,
      reachedByJob: r.j,
    };
  });

  return {
    units: units.length,
    customerRoots: units.filter((u) => u.customerRoot).length,
    jobRoots: units.filter((u) => u.jobRoot).length,
    edges,
    sites: out,
    unattributedCalls,
  };
}

function prop(obj: ts.ObjectLiteralExpression, name: string): ts.Expression | "shorthand" | null {
  for (const p of obj.properties) {
    if (ts.isPropertyAssignment(p) && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) && p.name.text === name) return p.initializer;
    if (ts.isShorthandPropertyAssignment(p) && p.name.text === name) return "shorthand";
  }
  return null;
}
function hasSpread(obj: ts.ObjectLiteralExpression): boolean {
  return obj.properties.some((p) => ts.isSpreadAssignment(p));
}

/** The origin a metered call declares. */
export function declaredOrigin(call: ts.CallExpression, entry: string): { declared: DeclaredOrigin; implicit: boolean } {
  const idx = METERED_ENTRYPOINTS[entry];
  const arg = call.arguments[idx];
  const isRouter = entry.startsWith("route") || entry === "generateWithAutoRouting";
  if (!arg) return { declared: isRouter ? "n/a" : "forwarded", implicit: true }; // router default {} → no orgId
  if (!ts.isObjectLiteralExpression(arg)) return { declared: "forwarded", implicit: false };
  const origin = prop(arg, "origin");
  const orgId = prop(arg, "orgId");
  // No org on the call: platform/founder spend, nobody's allowance.
  if (!hasSpread(arg) && (!orgId || (orgId !== "shorthand" && orgId.kind === ts.SyntaxKind.NullKeyword))) return { declared: "n/a", implicit: !origin };
  if (origin && origin !== "shorthand" && ts.isStringLiteralLike(origin)) {
    const v = origin.text;
    return { declared: v === "customer" || v === "background" ? v : "forwarded", implicit: false };
  }
  if (origin) return { declared: "forwarded", implicit: false };
  if (hasSpread(arg)) return { declared: "forwarded", implicit: false };
  if (!orgId || (orgId !== "shorthand" && orgId.kind === ts.SyntaxKind.NullKeyword)) return { declared: "n/a", implicit: true };
  if (isRouter) {
    const sq = prop(arg, "skipQuota");
    if (sq && sq !== "shorthand" && sq.kind === ts.SyntaxKind.TrueKeyword) return { declared: "background", implicit: true };
    if (sq) return { declared: "forwarded", implicit: true };
    return { declared: "customer", implicit: true };
  }
  return { declared: "forwarded", implicit: true };
}
