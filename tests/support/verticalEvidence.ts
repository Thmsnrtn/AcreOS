/**
 * Measure, from source, what this repository can actually demonstrate about
 * each vertical.
 *
 * ── WHY THIS IS SHARED RATHER THAN COPIED ───────────────────────────────────
 * Two tests need it, and they need it to be the SAME measurement.
 * `verticalReadiness.test.ts` uses it to hold the overclaim ratchet;
 * `publicMaturityRendered.test.tsx` uses it as the independent anchor for what
 * the landing may call `core`. A projection compared against itself proves only
 * that it is a function, so the anchor has to come from the evidence.
 *
 * ── EVIDENCE RULE v2 (founder directive, 2026-10-04) ────────────────────────
 * decision-memos/2026-10-04-vertical-program.md §3. Ownership used to be a
 * hand-kept map of route FILE → vertical, judged by menu gating. That kept land
 * BETA although its blind-offer wizard is land arithmetic under land rules —
 * because every persona can open it from the Map door.
 *
 * Now a vertical is evidenced DECISION BY DECISION, parsed with the TypeScript
 * compiler (a parser never reads a comment). A decision counts for vertical V
 * only when ALL of these hold:
 *   1. it is recorded under V's pack, written as a literal (a computed pack is
 *      evidence of nothing);
 *   2. it CITES a scenario, and the cited scenario is traced to the very
 *      `recordScenario(…)` call that produced it, whose engine DECLARES V
 *      (`EngineSpec.verticals`, read off the live registry objects). A scenario
 *      recorded by another handler, or from another vertical's engine,
 *      credits nothing;
 *   3. the store functions it calls are the real ones: imported BY THEIR OWN
 *      NAME from decisions/decisionStore and economics/scenarioStore, or the
 *      kit's `recordUnderwrittenDecision` from services/underwriting, and
 *      called as a bare identifier. A local function with the same name, an
 *      alias (`import { other as recordDecision }`) or a method that happens to
 *      share the name is not the store;
 *   4. its handler is REACHABLE: the file is registered in server/routes.ts —
 *      a default-imported router passed to `app.use(prefix, …)`, or a named
 *      `registerX(app)` import that is actually CALLED there — and the client
 *      references that exact endpoint. An API no customer surface calls, or a
 *      register function nobody calls, is not evidence.
 *
 * Values are resolved only through `const` bindings in an enclosing scope (a
 * `let` can be reassigned; a parameter of an enclosing function shadows any
 * outer name). A spread placed AFTER `strategyPackId`, `engineId` or
 * `reviewDueAt` can override it, so it voids the literal.
 *
 * GRADEABLE additionally needs the decision's `reviewDueAt` not hard-coded to
 * "never". That covers `null`, `undefined`, an omitted key, or a constant bound
 * to null. It also needs the route's request schema not to make `reviewDueAt`
 * omittable (`.optional()`, `.nullish()`, `.default()`, `.catch()`, `.or()`,
 * `z.preprocess(…)`, or `.partial()` over a schema that names it): an omittable
 * key lets a client that never asked record "never review" in silence, which
 * is how the land wizard's decisions were ungradeable while its route looked
 * fine. A schema in ANOTHER file (the kit's) is outside this static check; the
 * kit's own tests and each route's behavioural test hold it. And it needs the
 * cited engine to predict a metric an outcome answer measures (MEASURED_OUTCOME_METRIC_IDS: `acquisition_cost` at "Acquired", `profit` at "Sold").
 * The law in verticalReadiness.test.ts is universal, not existential: every
 * crediting decision of a decided vertical must be gradeable.
 *
 * The legacy file-ownership map is EMPTY since V2: the last entry
 * (`routes-lot-pricing.ts` → subdivider) left when the lot-price lock began
 * recording a `subdivision_lot_sale` scenario with the operator's review date.
 *
 * The crediting itself is a PURE function (`creditVerticals`), so the tests can
 * feed it fixtures. The audit of V0 found the first draft could not be fed
 * anything but the live tree, and that let a per-FILE engine match pass for a
 * per-decision one.
 */

import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { type BusinessTypeId } from "../../shared/business-types";
import { type VerticalEvidence } from "../../shared/business-types/readiness";
import { ALL_ENGINES } from "../../server/services/economics/engines";
import { stripComments } from "../helpers/stripComments";
import { OUTCOME_MEASURES } from "../../shared/outcomes/outcomeMeasures";

/** The metrics Today's outcome answers measure — derived from the definition the prompt renders. */
const MEASURED_OUTCOME_METRIC_IDS: readonly string[] = Object.values(OUTCOME_MEASURES).map((m) => m.metricId);

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string): string => fs.readFileSync(path.join(ROOT, p), "utf8");

/** Template ids the workflow engine really defines (`id: "tpl_…"`). */
function definedTemplateIds(): Set<string> {
  const src = read("server/services/workflow-engine.ts");
  return new Set([...src.matchAll(/\bid:\s*"(tpl_[a-z0-9_]+)"/g)].map((m) => m[1]));
}

/**
 * Decision routes owned by a vertical WITHOUT an engine scenario. Down-only:
 * an entry leaves when its route records a scenario from an engine declaring
 * the vertical. Do not add to this list — give the route an engine.
 */
export const LEGACY_DECISION_ROUTE_OWNER: Readonly<Record<string, BusinessTypeId>> = {
  // EMPTIED in V2 (2026-10-04): the lot-pricing lock now records a
  // `subdivision_lot_sale` scenario and cites it, so subdivider decides through
  // its own engine like every other vertical. Kept, typed, so the down-only
  // test can prove it stays empty.
};

export type EngineTable = Map<string, { verticals: BusinessTypeId[]; gradeable: boolean }>;

/** Engine id → the verticals it declares, read off the live registry objects. */
export function engineVerticals(): EngineTable {
  const out: EngineTable = new Map();
  for (const e of ALL_ENGINES) {
    out.set(e.id, {
      verticals: [...(e.verticals ?? [])],
      // Gradeable = predicts a metric an outcome answer actually MEASURES (the
      // shared definition Today's prompt asks from), not a hand-kept pair.
      gradeable: e.produces.some((m) => MEASURED_OUTCOME_METRIC_IDS.includes(m)),
    });
  }
  return out;
}

/** Every `export const NAME = "value"` in the engine and calculator modules. */
function exportedStringConstants(): Map<string, string> {
  const out = new Map<string, string>();
  const dirs = ["shared/calculators", "shared/economics", "server/services/economics/engines"];
  for (const dir of dirs) {
    const abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs)) continue;
    for (const f of fs.readdirSync(abs)) {
      if (!/\.ts$/.test(f) || f.includes(".test.")) continue;
      const src = fs.readFileSync(path.join(abs, f), "utf8");
      for (const m of src.matchAll(/export const ([A-Z][A-Z0-9_]*)\s*=\s*"([a-z0-9_]+)"/g)) out.set(m[1], m[2]);
    }
  }
  return out;
}

// ── Parsing one route file ────────────────────────────────────────────────

export interface DecisionFact {
  /** The literal pack, or null when computed / absent. */
  pack: string | null;
  /** Engine ids of the scenarios this decision CITES, traced to their own recordScenario calls. */
  citedEngineIds: string[];
  /** reviewDueAt is hard-coded to "never": null, undefined, omitted, or a null-bound constant. */
  reviewHardNull: boolean;
  /** The registered path of the handler this decision sits in, or null. */
  handlerPath: string | null;
}

export interface RouteFacts {
  /** Engine ids of every genuine recordScenario / kit call in the file. */
  scenarioEngineIds: string[];
  decisions: DecisionFact[];
  /** The file declares a zod `reviewDueAt` that may be omitted (optional / nullish / default). */
  optionalReviewSchema: boolean;
}

const STORE_MODULES: Record<string, RegExp> = {
  recordScenario: /economics\/scenarioStore$/,
  recordDecision: /decisions\/decisionStore$/,
  recordUnderwrittenDecision: /services\/underwriting\/verticalDecision$/,
};

const unwrap = (e: ts.Expression): ts.Expression => {
  let x = e;
  while (ts.isParenthesizedExpression(x) || ts.isAsExpression(x) || ts.isSatisfiesExpression(x) || ts.isNonNullExpression(x) || ts.isTypeAssertionExpression(x) || ts.isAwaitExpression(x)) {
    x = x.expression;
  }
  return x;
};

/**
 * Local name → { module, the name it was exported under } — static imports and
 * `await import()` destructures. The exported name matters: `import { other as
 * recordDecision }` binds the local name to a different function.
 */
function importedNames(sf: ts.SourceFile): Map<string, { module: string; imported: string }> {
  const out = new Map<string, { module: string; imported: string }>();
  const visit = (n: ts.Node) => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier) && n.importClause?.namedBindings && ts.isNamedImports(n.importClause.namedBindings)) {
      for (const el of n.importClause.namedBindings.elements) {
        out.set(el.name.text, { module: n.moduleSpecifier.text, imported: (el.propertyName ?? el.name).text });
      }
    }
    if (ts.isVariableDeclaration(n) && ts.isObjectBindingPattern(n.name) && n.initializer) {
      const init = unwrap(n.initializer);
      if (ts.isCallExpression(init) && init.expression.kind === ts.SyntaxKind.ImportKeyword && init.arguments[0] && ts.isStringLiteralLike(init.arguments[0])) {
        for (const el of n.name.elements) {
          if (!ts.isIdentifier(el.name)) continue;
          const imported = el.propertyName && ts.isIdentifier(el.propertyName) ? el.propertyName.text : el.name.text;
          out.set(el.name.text, { module: init.arguments[0].text, imported });
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

/** True when `name` is a parameter of `fn` (any destructuring depth). */
function bindsParameter(fn: ts.SignatureDeclaration, name: string): boolean {
  const has = (b: ts.BindingName): boolean =>
    ts.isIdentifier(b) ? b.text === name : b.elements.some((e) => !ts.isOmittedExpression(e) && has(e.name));
  return fn.parameters.some((p) => has(p.name));
}

/**
 * The nearest `const` declaration of `name` visible from `at` (walks enclosing
 * blocks). Null when a nearer scope rebinds the name as a parameter, or when
 * the nearest declaration is a `let`/`var` — either can hold anything at the
 * call, so its initializer proves nothing.
 */
function findBinding(name: string, at: ts.Node): ts.VariableDeclaration | null {
  for (let n: ts.Node | undefined = at.parent; n; n = n.parent) {
    if (ts.isFunctionLike(n) && bindsParameter(n, name)) return null;
    const stmts = ts.isBlock(n) || ts.isSourceFile(n) || ts.isModuleBlock(n) || ts.isCaseClause(n) || ts.isDefaultClause(n) ? n.statements : null;
    if (!stmts) continue;
    for (const s of stmts) {
      if (!ts.isVariableStatement(s)) continue;
      for (const d of s.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.name.text === name) return (s.declarationList.flags & ts.NodeFlags.Const) !== 0 ? d : null;
      }
    }
  }
  return null;
}

export function analyzeRouteSource(file: string, src: string, constants: Map<string, string>): RouteFacts {
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const imports = importedNames(sf);
  const isStore = (name: string | null): name is keyof typeof STORE_MODULES => {
    if (!name || !Object.hasOwn(STORE_MODULES, name)) return false;
    const imp = imports.get(name);
    return !!imp && imp.imported === name && STORE_MODULES[name].test(imp.module);
  };

  const resolveString = (e: ts.Expression | undefined, depth = 0): string | null => {
    if (!e || depth > 5) return null;
    const x = unwrap(e);
    if (ts.isStringLiteralLike(x)) return x.text;
    if (ts.isIdentifier(x)) {
      const b = findBinding(x.text, x);
      if (b?.initializer) {
        const v = resolveString(b.initializer, depth + 1);
        if (v !== null) return v;
      }
      // An exported engine/calculator constant counts only when this file
      // IMPORTS that name — a local of the same name is something else.
      return imports.has(x.text) ? (constants.get(x.text) ?? null) : null;
    }
    return null;
  };

  /**
   * The LAST assignment of `name` in the literal, or `overridden` when a spread
   * follows it (or, with no assignment, any spread at all) — at runtime the
   * spread may set or replace it, so the literal proves nothing.
   */
  const prop = (obj: ts.ObjectLiteralExpression, name: string): { value?: ts.Expression; present: boolean; overridden?: boolean } => {
    let found: { value?: ts.Expression; present: boolean; overridden?: boolean } = { present: false };
    for (const p of obj.properties) {
      if (ts.isSpreadAssignment(p)) found = { ...found, overridden: true };
      else if (ts.isPropertyAssignment(p) && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) && p.name.text === name) found = { value: p.initializer, present: true };
      else if (ts.isShorthandPropertyAssignment(p) && p.name.text === name) found = { value: p.name, present: true };
    }
    return found;
  };
  const literal = (obj: ts.ObjectLiteralExpression, name: string): string | null => {
    const p = prop(obj, name);
    return p.overridden ? null : resolveString(p.value);
  };

  const isHardNull = (p: { value?: ts.Expression; present: boolean; overridden?: boolean }, depth = 0): boolean => {
    if (p.overridden) return true;
    if (!p.present || !p.value) return true;
    const x = unwrap(p.value);
    if (x.kind === ts.SyntaxKind.NullKeyword || ts.isVoidExpression(x)) return true;
    if (ts.isIdentifier(x)) {
      if (x.text === "undefined") return true;
      const b = findBinding(x.text, x);
      if (b?.initializer && depth < 5) return isHardNull({ value: b.initializer, present: true }, depth + 1);
    }
    return false;
  };

  /** recordScenario call → its engine id. */
  const scenarioEngineOf = (call: ts.CallExpression): string | null => {
    const obj = call.arguments[1];
    return obj && ts.isObjectLiteralExpression(obj) ? literal(obj, "engineId") : null;
  };

  /** A cited element (`scenario.id` / `scenarioId`) → the engine of the recordScenario call that bound it. */
  const citedEngine = (el: ts.Expression): string | null => {
    let x = unwrap(el);
    if (ts.isPropertyAccessExpression(x)) x = x.expression;
    if (!ts.isIdentifier(x)) return null;
    const b = findBinding(x.text, x);
    if (!b?.initializer) return null;
    const init = unwrap(b.initializer);
    if (ts.isCallExpression(init) && ts.isIdentifier(init.expression) && init.expression.text === "recordScenario" && isStore("recordScenario")) return scenarioEngineOf(init);
    return null;
  };

  const handlerPathOf = (node: ts.Node): string | null => {
    for (let n: ts.Node | undefined = node.parent; n; n = n.parent) {
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && ["get", "post", "put", "patch", "delete"].includes(n.expression.name.text)) {
        const first = n.arguments[0];
        if (first && ts.isStringLiteralLike(first)) return first.text;
      }
    }
    return null;
  };

  /** Methods that let a zod field be absent (or swallow its absence). */
  const OMITTING = ["optional", "nullish", "default", "catch", "or"];
  /** `reviewDueAt: z.….optional()` (or any OMITTING method) in the chain, or `z.preprocess(…)`. */
  const omittable = (e: ts.Expression): boolean => {
    for (let x: ts.Expression = unwrap(e); ts.isCallExpression(x) && ts.isPropertyAccessExpression(x.expression); x = x.expression.expression) {
      if (OMITTING.includes(x.expression.name.text) || x.expression.name.text === "preprocess") return true;
    }
    return false;
  };
  /** The receiver of `.partial()` names a reviewDueAt field (following const bindings). */
  const namesReviewDueAt = (e: ts.Expression, depth = 0): boolean => {
    if (depth > 5) return false;
    let hit = false;
    const walk = (n: ts.Node) => {
      if (hit) return;
      if ((ts.isPropertyAssignment(n) || ts.isShorthandPropertyAssignment(n)) && (ts.isIdentifier(n.name) || ts.isStringLiteral(n.name)) && n.name.text === "reviewDueAt") hit = true;
      else if (ts.isIdentifier(n)) {
        const b = findBinding(n.text, n);
        if (b?.initializer && namesReviewDueAt(b.initializer, depth + 1)) hit = true;
      } else ts.forEachChild(n, walk);
    };
    walk(e);
    return hit;
  };

  const facts: RouteFacts = { scenarioEngineIds: [], decisions: [], optionalReviewSchema: false };
  const visit = (n: ts.Node) => {
    if (
      (ts.isPropertyAssignment(n) && (ts.isIdentifier(n.name) || ts.isStringLiteral(n.name)) && n.name.text === "reviewDueAt" && omittable(n.initializer)) ||
      (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === "partial" && namesReviewDueAt(n.expression.expression))
    ) {
      facts.optionalReviewSchema = true;
    }
    if (ts.isCallExpression(n)) {
      // Only a bare identifier call is a store call; `x.recordDecision()` is
      // some other object's method, whatever this file imports.
      const name = ts.isIdentifier(n.expression) ? n.expression.text : null;
      const obj = n.arguments[1];
      if (isStore(name) && obj && ts.isObjectLiteralExpression(obj)) {
        if (name === "recordScenario") {
          const id = scenarioEngineOf(n);
          if (id) facts.scenarioEngineIds.push(id);
        } else if (name === "recordDecision") {
          const ids = n.arguments[3];
          const cited = ids && ts.isArrayLiteralExpression(ids) ? ids.elements.map(citedEngine).filter((e): e is string => !!e) : [];
          facts.decisions.push({
            pack: literal(obj, "strategyPackId"),
            citedEngineIds: cited,
            reviewHardNull: isHardNull(prop(obj, "reviewDueAt")),
            handlerPath: handlerPathOf(n),
          });
        } else if (name === "recordUnderwrittenDecision") {
          const id = literal(obj, "engineId");
          if (id) facts.scenarioEngineIds.push(id);
          facts.decisions.push({
            pack: literal(obj, "strategyPackId"),
            // The kit records the scenario and cites it by construction
            // (verticalDecision.test.ts proves it).
            citedEngineIds: id ? [id] : [],
            reviewHardNull: isHardNull(prop(obj, "reviewDueAt")),
            handlerPath: handlerPathOf(n),
          });
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return facts;
}

// ── Reachability ──────────────────────────────────────────────────────────

/**
 * Route file → the prefix server/routes.ts serves it under. A default-imported
 * router passed to `app.use(prefix, …)` maps to that prefix; a named
 * `registerX` import that is CALLED maps to "" (its handlers register absolute
 * paths). A file in neither form is not registered, whatever paths it declares.
 */
export function routeMounts(routesTs: string): Map<string, string> {
  const sf = ts.createSourceFile("routes.ts", routesTs, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const defaultImports = new Map<string, string>();
  const namedImports = new Map<string, string>();
  for (const s of sf.statements) {
    if (!ts.isImportDeclaration(s) || !ts.isStringLiteral(s.moduleSpecifier)) continue;
    if (s.importClause?.name) defaultImports.set(s.importClause.name.text, s.moduleSpecifier.text);
    const nb = s.importClause?.namedBindings;
    if (nb && ts.isNamedImports(nb)) for (const el of nb.elements) namedImports.set(el.name.text, s.moduleSpecifier.text);
  }
  const fileOf = (spec: string) => {
    const f = spec.replace(/^\.\//, "server/");
    return f.endsWith(".ts") ? f : `${f}.ts`;
  };
  const out = new Map<string, string>();
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === "use") {
      const [prefix, ...rest] = n.arguments;
      const last = rest[rest.length - 1];
      if (prefix && ts.isStringLiteralLike(prefix) && last && ts.isIdentifier(last) && defaultImports.has(last.text)) {
        out.set(fileOf(defaultImports.get(last.text)!), prefix.text);
      }
    }
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && /^register[A-Z]/.test(n.expression.text) && namedImports.has(n.expression.text)) {
      const file = fileOf(namedImports.get(n.expression.text)!);
      if (!out.has(file)) out.set(file, "");
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

/** The full endpoint a decision's handler serves, or null when its file is not registered. */
export function endpointOf(file: string, handlerPath: string | null, mounts: Map<string, string>): string | null {
  if (!handlerPath) return null;
  const prefix = mounts.get(file);
  if (prefix === undefined) return null;
  if (prefix === "") return handlerPath.startsWith("/api/") ? handlerPath : null;
  return `${prefix}${handlerPath === "/" ? "" : handlerPath}`;
}

/** True when comment-stripped client source references the endpoint (":param" matches any segment). */
export function clientCalls(endpoint: string, clientSource: string): boolean {
  const pattern = endpoint
    .split("/")
    .map((seg) => (seg.startsWith(":") ? "[^/\"'`\\s]+" : seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
    .join("/");
  return new RegExp(`["'\`]${pattern}["'\`?]`).test(clientSource);
}

// ── Crediting (pure) ──────────────────────────────────────────────────────

export interface FileEvidence {
  file: string;
  facts: RouteFacts;
  /** For each decision (by index), whether its endpoint is registered AND called by the client. */
  reachable: boolean[];
}

export interface Credit {
  underwritten: Set<BusinessTypeId>;
  deciding: Set<BusinessTypeId>;
  gradeable: Set<BusinessTypeId>;
  /** Crediting decisions that can never be graded, per vertical (file names). */
  ungradeable: Map<BusinessTypeId, string[]>;
  decidedBy: Map<BusinessTypeId, string[]>;
}

export function creditVerticals(
  files: readonly FileEvidence[],
  engines: EngineTable,
  legacy: Readonly<Record<string, BusinessTypeId>> = LEGACY_DECISION_ROUTE_OWNER,
): Credit {
  const c: Credit = { underwritten: new Set(), deciding: new Set(), gradeable: new Set(), ungradeable: new Map(), decidedBy: new Map() };
  const push = (m: Map<BusinessTypeId, string[]>, v: BusinessTypeId, f: string) => m.set(v, [...(m.get(v) ?? []), f]);
  for (const { file, facts, reachable } of files) {
    // `underwritten`: a genuine scenario writer for the vertical's engine.
    for (const id of facts.scenarioEngineIds) for (const v of engines.get(id)?.verticals ?? []) c.underwritten.add(v);
    facts.decisions.forEach((d, i) => {
      if (!reachable[i] || !d.pack) return;
      const v = d.pack as BusinessTypeId;
      const owning = d.citedEngineIds.filter((id) => engines.get(id)?.verticals.includes(v));
      if (owning.length > 0) {
        c.deciding.add(v);
        push(c.decidedBy, v, file);
        if (!d.reviewHardNull && !facts.optionalReviewSchema && owning.some((id) => engines.get(id)?.gradeable)) c.gradeable.add(v);
        else push(c.ungradeable, v, file);
      } else if (legacy[file] === v) {
        c.deciding.add(v);
        push(c.decidedBy, v, file);
        push(c.ungradeable, v, file);
      }
    });
  }
  // A vertical is gradeable only if NONE of its crediting decisions is ungradeable.
  for (const v of c.ungradeable.keys()) c.gradeable.delete(v);
  return c;
}

/** Production route files: server/routes*.ts and server/routes/**. */
export function routeFiles(): string[] {
  const top = fs
    .readdirSync(path.join(ROOT, "server"))
    .filter((f) => f.startsWith("routes") && f.endsWith(".ts") && !f.includes(".test."))
    .map((f) => `server/${f}`);
  const nested: string[] = [];
  const walk = (rel: string) => {
    for (const e of fs.readdirSync(path.join(ROOT, rel), { withFileTypes: true })) {
      const child = `${rel}/${e.name}`;
      if (e.isDirectory()) walk(child);
      else if (e.name.endsWith(".ts") && !e.name.includes(".test.")) nested.push(child);
    }
  };
  if (fs.existsSync(path.join(ROOT, "server/routes"))) walk("server/routes");
  return [...top, ...nested];
}

function clientSourceText(): string {
  const parts: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(e.name)) parts.push(stripComments(fs.readFileSync(p, "utf8")));
    }
  };
  walk(path.join(ROOT, "client/src"));
  return parts.join("\n");
}

export interface MeasuredEvidence extends VerticalEvidence {
  gradeableBusinessTypes: ReadonlySet<BusinessTypeId>;
  ungradeable: ReadonlyMap<BusinessTypeId, string[]>;
  /** How many route files were parsed — the population floor. */
  routeFilesRead: number;
  decidedBy: ReadonlyMap<BusinessTypeId, string[]>;
}

/**
 * The measured evidence. Callers MUST vacuity-guard it — a scan that silently
 * finds nothing reports the most flattering possible answer.
 */
export function measureVerticalEvidence(): MeasuredEvidence {
  const engines = engineVerticals();
  const constants = exportedStringConstants();
  const mounts = routeMounts(read("server/routes.ts"));
  const client = clientSourceText();
  const files = routeFiles();
  const evidence: FileEvidence[] = files.map((file) => {
    const facts = analyzeRouteSource(file, read(file), constants);
    return {
      file,
      facts,
      reachable: facts.decisions.map((d) => {
        const url = endpointOf(file, d.handlerPath, mounts);
        return !!url && clientCalls(url, client);
      }),
    };
  });
  const c = creditVerticals(evidence, engines);
  return {
    definedWorkflowTemplateIds: definedTemplateIds(),
    underwrittenBusinessTypes: c.underwritten,
    decidingBusinessTypes: c.deciding,
    gradeableBusinessTypes: c.gradeable,
    ungradeable: c.ungradeable,
    routeFilesRead: files.length,
    decidedBy: c.decidedBy,
  };
}
