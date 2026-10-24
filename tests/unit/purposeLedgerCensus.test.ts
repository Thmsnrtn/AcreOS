/**
 * D2e — the purpose-ledger CENSUS (the population law).
 *
 * `purposeLedger.test.ts` proves the three ledgered surfaces refuse without a
 * receipt. This file proves the claim it cannot: that those three are the
 * only places person-adjacent contact data leaves the server unrecorded, OR
 * that every other place is named, here, in a debt register that may only
 * shrink. The population is DERIVED from source, never listed by hand:
 *
 *   1. A "person-adjacent read" is a direct read of a lead row, a stored
 *      skip trace, or a parcel owner's mailing address (DIRECT_READ), or a
 *      call to a named server function that performs one — resolved through
 *      the caller's own imports and closed transitively (readerClosure).
 *   2. A "surface" is a unit that hands data to a caller or a model:
 *        route   — `<x>.get|post|put|patch|delete|all("/…", …)` registrations
 *        tool    — MCP `tool("snake_name", …)` registrations
 *        case    — a clause of a dispatch switch with ≥3 snake_case labels
 *                  (every model tool switch has this shape)
 *        webhook — `dispatchWebhookEvent(…, "lead.*", …)` outbound payloads
 *        model   — the nearest named function around an LLM call
 *      Units are AST spans (TypeScript parser), so a nested callback, a
 *      wrapper, a trailing comma or a path on the next line cannot move a
 *      boundary; comments are stripped first with tests/helpers/stripComments.
 *   3. Every candidate (surface ∩ person-adjacent read) is in exactly one
 *      register: LEDGERED (it writes the purpose ledger) or DEBT (it does
 *      not; proposed surface code recorded). A candidate in neither fails; a
 *      register entry with no candidate fails (stale); DEBT may only shrink.
 *
 * What would have to exist for this to be green and the defect present? A
 * read through a path the closure cannot resolve (a registry lookup by
 * string, `storage` reached through a renamed alias, a raw SQL string), or an
 * egress kind not in the list above (e.g. an email digest built from lead
 * rows in a job). docs/compliance/purpose-ledger-census.md lists those
 * limits; they are the next widening, not a claim of absence.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { beforeAll, describe, expect, it } from "vitest";
import { PURPOSE_SURFACES, type PurposeSurface } from "../../server/services/purposeLedger";
import { stripComments } from "../helpers/stripComments";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";

const ROOT = path.join(__dirname, "../..");

// ─── the predicates ──────────────────────────────────────────────────────────

/** A direct read of person-adjacent contact data. */
const DIRECT_READ = new RegExp(
  [
    String.raw`\.from\(\s*(?:leads|skipTraces|parcelSnapshots)\s*\)`,
    String.raw`\bquery\.(?:leads|skipTraces|parcelSnapshots)\.`,
    String.raw`\bstorage\.(?:get|find|search|list)\w*(?:Lead|Leads|SkipTrace|SkipTraces)\w*\(`,
    String.raw`\b(?:ownerAddress|mailingAddress|ownerMailingAddress)\b`,
    String.raw`\bskipTracingService\.trace\(`,
    // Raw SQL (upper-case keywords only, so prose such as "insights from leads"
    // inside a prompt string is not a read): 17 sites on 2026-10-24, among them
    // the global search in services/fullTextSearch.ts.
    String.raw`\b(?:FROM|JOIN)\s+"?(?:leads|skip_traces|parcel_snapshots)"?\b`,
  ].join("|"),
);

/**
 * storage readers whose name matches DIRECT_READ but whose rows carry no
 * contact field. Each is a claim; the census test re-checks every one is
 * still a real call site so a dead exclusion cannot linger.
 */
const NON_CONTACT_READERS: Record<string, string> = {
  getLeadActivities: "activity log rows (type, description, timestamps); no phone/email column",
  getLeadCount: "a count",
  getLeadMetrics: "aggregate counts by status/source",
  getLeadEnrollments: "sequence enrollment rows keyed by lead id",
  getTeamLeadMetrics: "per-member aggregate counts",
  getTeamLeadResponseTimes: "per-member response-time aggregates",
  getBuyerPrequalificationByLead: "buyer prequalification answers (financial), not contact data",
};
const NON_CONTACT_CALL = new RegExp(String.raw`\bstorage\.(?:${Object.keys(NON_CONTACT_READERS).join("|")})\(`, "g");

/** The unit writes the purpose ledger (the three ledgered entry points). */
const LEDGER_WRITE = /\brecordPurpose\(|\breleaseSkipTraceResults\(|\bskipTracingService\.trace\(/;

/**
 * An LLM call: the population of the `model` kind. Measured 2026-10-24: the
 * SDK calls (12 `chat.completions.create`, 2 `messages.create`), the traced
 * wrapper (8) and the router `routeAITask` (79) are every entry point.
 */
const LLM_CALL = /\bchat\.completions\.create\(|\bmessages\.(?:create|stream)\(|\btracedLlmCall\(|\brouteAITask\(/;

/** Generic names that collide with library methods; never treated as readers. */
const NAME_STOPLIST = new Set(["execute", "lookup", "select", "update", "insert", "delete", "create", "filter", "reduce", "values", "returning", "handler", "default"]);

/**
 * The reader closure's rule. A named function is a reader when its body reads
 * directly, calls a reader defined IN ITS OWN FILE, or calls an imported
 * reader from the DATA-ACCESS LAYER (server/storage/**, server/storage.ts —
 * `exportLeadsToCSV` → `wholeBookReads.readAllLeads`); closed to a fixed
 * point. A surface is a candidate when it reads directly or calls a reader
 * its file defines or IMPORTS (one more cross-file hop): surface → service →
 * storage is followed end to end.
 *
 * Chosen by measurement (2026-10-24). An unconditional cross-file closure
 * grew to 669 readers in 11 rounds and pulled in usage-limit gates, the email
 * sender and the credit-pool debit — they read a lead COUNT — drowning 107
 * direct surfaces in ~260 that hand no contact field anywhere; gating the
 * cross-file step on a contact-field token did not help (`email` names the
 * email SENDER everywhere). Cross-file chains of two or more hops are the
 * documented population limit (census doc §Limits), not a claim of absence.
 */
const MAX_CLOSURE_ROUNDS = 20;
const DATA_ACCESS_LAYER = /^server\/(?:storage\/|storage\.ts$)/;

/**
 * A cheap SUPERSET of DIRECT_READ on RAW text, so only files that can read
 * are stripped and parsed. Stripping can only remove a match — except a
 * comment between `.from(` and the table name, allowed for here. A canary
 * pins one sample per DIRECT_READ alternative through this filter: the first
 * draft missed `ownerMailingAddress` (capital M) and silently dropped
 * POST /search in routes-title-search.ts.
 */
const RAW_PREFILTER =
  /\.from\(\s*(?:\/\*[\s\S]*?\*\/\s*|\/\/[^\n]*\n\s*)*(?:leads|skipTraces|parcelSnapshots)\b|query\.(?:leads|skipTraces|parcelSnapshots)|storage\.\w*(?:Lead|SkipTrace)|ownerAddress|[mM]ailingAddress|skipTracingService|\b(?:FROM|JOIN)\s+"?(?:leads|skip_traces|parcel_snapshots)\b/;

/**
 * Projection-aware `.from(…)`: `db.select({ count: sql\`count(*)\` }).from(leads)`
 * reads no contact field, and 5 of the first draft's 8 support-agent "reads"
 * were exactly that. A brace-free explicit projection naming no contact column
 * is neutralised; `select()` (the whole row), a projection naming a contact
 * column, or one with nested braces stays a read — the conservative side.
 */
const CONTACT_COLUMN = /\b(?:phone|phoneNormalized|email|address|firstName|lastName|mailingAddress|ownerAddress|owner|results|relatives|inputData)\b/;
const PROJECTED_FROM = /\.select(?:Distinct)?\(\s*\{([^{}]*)\}\s*\)(\s*)\.from\(/g;
const neutraliseProjections = (text: string) =>
  text.replace(PROJECTED_FROM, (whole, proj: string, ws: string) => (CONTACT_COLUMN.test(proj) ? whole : `.select({${proj}})${ws}.projectedFrom(`));

const readsDirect = (text: string) => DIRECT_READ.test(neutraliseProjections(text.replace(NON_CONTACT_CALL, "")));

// ─── the engine ──────────────────────────────────────────────────────────────

type UnitKind = "route" | "tool" | "case" | "webhook" | "model";
interface Unit {
  kind: UnitKind;
  file: string;
  key: string;
  line: number;
  text: string;
}
interface Candidate extends Unit {
  via: string; // "direct" or the reader function name it reached the data through
  ledgered: boolean;
}
interface Census {
  scannedFiles: string[];
  units: Unit[];
  candidates: Candidate[];
  readers: Map<string, Set<string>>; // function name → files defining it as a reader
  unitsByFile: Map<string, number>;
  rounds: number;
}

const VERBS = new Set(["get", "post", "put", "patch", "delete", "all"]);
const SNAKE = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/;
/** `run` is deliberately absent: job registrations (`{ name, run }`) are not egress. */
const TOOL_HANDLER_PROPS = new Set(["handler", "execute"]);

function resolveImport(fromRel: string, spec: string, exists: (rel: string) => boolean): string | null {
  if (!spec.startsWith(".")) return null;
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromRel), spec.replace(/\.(?:js|mjs|ts)$/, "")));
  for (const c of [`${base}.ts`, `${base}/index.ts`]) if (exists(c)) return c;
  return null;
}

function importsOf(rel: string, src: string, exists: (rel: string) => boolean): Set<string> {
  const out = new Set<string>();
  for (const m of src.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)["']([^"']+)["']/g)) {
    const r = resolveImport(rel, m[1], exists);
    if (r) out.add(r);
  }
  return out;
}

function namedFunctions(sf: ts.SourceFile, src: string): Array<{ name: string; start: number; end: number; text: string }> {
  const out: Array<{ name: string; start: number; end: number; text: string }> = [];
  const visit = (n: ts.Node) => {
    let name: string | undefined;
    if ((ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n)) && n.name && ts.isIdentifier(n.name) && n.body) name = n.name.text;
    else if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer))) name = n.name.text;
    else if (ts.isPropertyAssignment(n) && ts.isIdentifier(n.name) && (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer))) name = n.name.text;
    if (name) out.push({ name, start: n.getStart(), end: n.end, text: src.slice(n.getStart(), n.end) });
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

function extractUnits(rel: string, sf: ts.SourceFile, src: string): Unit[] {
  const units: Unit[] = [];
  const lineOf = (pos: number) => sf.getLineAndCharacterOfPosition(pos).line + 1;
  const seen = new Map<string, number>();
  const spans: Array<[number, number]> = [];
  const fns = namedFunctions(sf, src);
  const stringConsts = new Map<string, string>();
  const consts = (n: ts.Node) => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && ts.isStringLiteralLike(n.initializer)) stringConsts.set(n.name.text, n.initializer.text);
    ts.forEachChild(n, consts);
  };
  consts(sf);
  const push = (kind: UnitKind, rawKey: string, n: ts.Node, extra = "") => {
    const k = `${kind}:${rawKey}`;
    const nth = (seen.get(k) ?? 0) + 1;
    seen.set(k, nth);
    if (kind !== "webhook") spans.push([n.getStart(), n.end]);
    units.push({ kind, file: rel, key: `${rel} ${k}${nth > 1 ? `#${nth}` : ""}`, line: lineOf(n.getStart()), text: src.slice(n.getStart(), n.end) + extra });
  };
  const literal = (e: ts.Expression | undefined): string | null =>
    e && (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) ? e.text : null;

  // Pass 1: route / tool / case, outermost-only (a switch inside a route is the route's).
  const visit = (n: ts.Node, inUnit: boolean) => {
    let isUnit = false;
    if (!inUnit && ts.isCallExpression(n) && n.arguments.length >= 2) {
      const callee = n.expression;
      const a0 = literal(n.arguments[0]);
      if (ts.isPropertyAccessExpression(callee) && VERBS.has(callee.name.text) && a0 !== null && a0.startsWith("/")) {
        push("route", `${callee.name.text.toUpperCase()} ${a0}`, n);
        isUnit = true;
      } else if (
        a0 !== null &&
        SNAKE.test(a0) &&
        ((ts.isIdentifier(callee) && callee.text === "tool") || (ts.isPropertyAccessExpression(callee) && (callee.name.text === "tool" || callee.name.text === "registerTool")))
      ) {
        push("tool", a0, n);
        isUnit = true;
      }
    }
    // A tool-registry entry: `{ name: "snake_name", …, handler|execute: fn }`
    // (founder-chat registerTool, autopilot registerHand). The name may be a
    // same-file string constant (`name: NAME`) and the handler a same-file
    // function referenced by name (`handler,`): its body joins the unit.
    if (!inUnit && ts.isObjectLiteralExpression(n)) {
      let toolName: string | null = null;
      let hasFn = false;
      let referenced: string | null = null;
      for (const p of n.properties) {
        const pname = p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) ? p.name.text : null;
        if (pname === "name" && ts.isPropertyAssignment(p)) {
          toolName = literal(p.initializer) ?? (ts.isIdentifier(p.initializer) ? (stringConsts.get(p.initializer.text) ?? `(dynamic ${p.initializer.text})`) : null);
        }
        // `name,` inside a loop (founder-chat delegation registers one tool per agent).
        if (pname === "name" && ts.isShorthandPropertyAssignment(p)) toolName = "(dynamic name)";
        if (pname && TOOL_HANDLER_PROPS.has(pname)) {
          if (ts.isMethodDeclaration(p)) hasFn = true;
          else if (ts.isPropertyAssignment(p) && (ts.isArrowFunction(p.initializer) || ts.isFunctionExpression(p.initializer))) hasFn = true;
          else if (ts.isShorthandPropertyAssignment(p)) referenced = p.name.text;
          else if (ts.isPropertyAssignment(p) && ts.isIdentifier(p.initializer)) referenced = p.initializer.text;
        }
      }
      const refFn = referenced ? fns.find((f) => f.name === referenced) : undefined;
      if (toolName !== null && (SNAKE.test(toolName) || toolName.startsWith("(dynamic ")) && (hasFn || refFn)) {
        push("tool", toolName, n, refFn ? `\n${refFn.text}` : "");
        isUnit = true;
      }
    }
    if (!inUnit && ts.isSwitchStatement(n)) {
      const snake = n.caseBlock.clauses.filter((c) => ts.isCaseClause(c) && SNAKE.test(literal(c.expression) ?? ""));
      if (snake.length >= 3) {
        let pending: string[] = [];
        for (const c of n.caseBlock.clauses) {
          const label = ts.isCaseClause(c) ? literal(c.expression) : null;
          if (label === null) {
            pending = [];
            continue;
          }
          pending.push(label);
          if (c.statements.length === 0) continue; // fall-through: the label shares the next body
          for (const l of pending) push("case", l, c);
          pending = [];
        }
        isUnit = true;
      }
    }
    ts.forEachChild(n, (c) => visit(c, inUnit || isUnit));
  };
  visit(sf, false);

  // Pass 2: outbound webhooks carrying a lead payload (nested anywhere).
  const hooks = (n: ts.Node) => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "dispatchWebhookEvent") {
      const ev = literal(n.arguments[1]);
      if (ev?.startsWith("lead.")) push("webhook", ev, n);
    }
    ts.forEachChild(n, hooks);
  };
  hooks(sf);

  // Pass 3: the nearest named function around each LLM call that no
  // route/tool/case unit already holds.
  const llmFns = new Set<(typeof fns)[number]>();
  const llm = (n: ts.Node) => {
    if (ts.isCallExpression(n) && LLM_CALL.test(src.slice(n.getStart(), n.end).slice(0, 80))) {
      const pos = n.getStart();
      if (spans.some(([a, b]) => a <= pos && pos < b)) return; // the route/tool/case unit already holds it
      let best: (typeof fns)[number] | undefined;
      for (const f of fns) if (f.start <= pos && pos < f.end && (!best || f.start >= best.start)) best = f;
      if (best) llmFns.add(best);
    }
    ts.forEachChild(n, llm);
  };
  llm(sf);
  for (const f of llmFns) {
    units.push({ kind: "model", file: rel, key: `${rel} model:${f.name}`, line: lineOf(f.start), text: f.text });
  }
  return units;
}

/** Run the census over an in-memory tree: { relPath → raw source }. */
function runCensus(tree: Map<string, string>): Census {
  const exists = (rel: string) => tree.has(rel);
  const stripped = new Map<string, string>();
  const strip = (rel: string) => {
    let s = stripped.get(rel);
    if (s === undefined) {
      s = stripComments(tree.get(rel) ?? "");
      stripped.set(rel, s);
    }
    return s;
  };
  const parsed = new Map<string, ts.SourceFile>();
  const parse = (rel: string) => {
    let sf = parsed.get(rel);
    if (!sf) {
      sf = ts.createSourceFile(rel, strip(rel), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
      parsed.set(rel, sf);
    }
    return sf;
  };
  const rawImports = new Map<string, Set<string>>();
  for (const [rel, raw] of tree) rawImports.set(rel, importsOf(rel, raw, exists));

  // Readers: named functions whose body reads directly, then transitively
  // through imports (a name counts only when the caller imports its file).
  const readers = new Map<string, Set<string>>();
  const fnCache = new Map<string, ReturnType<typeof namedFunctions>>();
  const fnsOf = (rel: string) => {
    let f = fnCache.get(rel);
    if (!f) {
      f = namedFunctions(parse(rel), strip(rel));
      fnCache.set(rel, f);
    }
    return f;
  };
  const addReader = (name: string, rel: string) => {
    if (name.length < 6 || NAME_STOPLIST.has(name)) return false;
    const s = readers.get(name) ?? new Set<string>();
    if (s.has(rel)) return false;
    s.add(rel);
    readers.set(name, s);
    return true;
  };
  const prefilter = (raw: string) => RAW_PREFILTER.test(raw);
  for (const [rel, raw] of tree) {
    if (!prefilter(raw) || !readsDirect(strip(rel))) continue;
    for (const f of fnsOf(rel)) if (readsDirect(f.text)) addReader(f.name, rel);
  }
  const callCache = new WeakMap<object, string[]>();
  const callsOf = (holder: { text: string }): string[] => {
    let c = callCache.get(holder);
    if (!c) {
      c = [...new Set(Array.from(holder.text.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g), (m) => m[1]))];
      callCache.set(holder, c);
    }
    return c;
  };
  const readerReachedVia = (rel: string, holder: { text: string }, scope: "any" | "local" = "any"): string | null => {
    const imported = rawImports.get(rel) ?? new Set<string>();
    for (const name of callsOf(holder)) {
      const defs = readers.get(name);
      if (!defs) continue;
      for (const d of defs) {
        if (d === rel) return name;
        if (imported.has(d) && (scope === "any" || DATA_ACCESS_LAYER.test(d))) return name;
      }
    }
    return null;
  };
  let rounds = 0;
  let converged = false;
  for (; rounds < MAX_CLOSURE_ROUNDS; rounds++) {
    let changed = false;
    const readerFiles = new Set<string>([...readers.values()].flatMap((s) => [...s]));
    const dalReaderFiles = [...readerFiles].filter((f) => DATA_ACCESS_LAYER.test(f));
    const reach = new Set<string>(readerFiles);
    const dalNames = [...readers].filter(([, defs]) => [...defs].some((d) => DATA_ACCESS_LAYER.test(d))).map(([n]) => n);
    const dalCall = new RegExp(String.raw`\b(?:${dalNames.join("|") || "(?!)"})\s*\(`);
    for (const [rel, imps] of rawImports) {
      if (dalReaderFiles.some((d) => imps.has(d)) && dalCall.test(tree.get(rel) ?? "")) reach.add(rel);
    }
    for (const rel of reach) {
      for (const f of fnsOf(rel)) {
        if (readers.get(f.name)?.has(rel)) continue;
        if (readerReachedVia(rel, f, "local") && addReader(f.name, rel)) changed = true;
      }
    }
    if (!changed) {
      converged = true;
      break;
    }
  }
  if (!converged) throw new Error(`reader closure did not converge in ${MAX_CLOSURE_ROUNDS} rounds — the census cannot certify its population`);

  // Surfaces: every file that reads directly or imports a reader file.
  const readerFiles = new Set<string>([...readers.values()].flatMap((s) => [...s]));
  const anyReaderCall = new RegExp(String.raw`\b(?:${[...readers.keys()].join("|") || "(?!)"})\s*\(`);
  const scannedFiles: string[] = [];
  const units: Unit[] = [];
  const candidates: Candidate[] = [];
  const unitsByFile = new Map<string, number>();
  for (const [rel, raw] of tree) {
    const imps = rawImports.get(rel) ?? new Set<string>();
    const touches =
      (prefilter(raw) && readsDirect(strip(rel))) ||
      readerFiles.has(rel) ||
      /\bdispatchWebhookEvent\(/.test(raw) ||
      ([...imps].some((i) => readerFiles.has(i)) && anyReaderCall.test(raw) && readerReachedVia(rel, { text: strip(rel) }) !== null);
    if (!touches) continue;
    scannedFiles.push(rel);
    const us = extractUnits(rel, parse(rel), strip(rel));
    unitsByFile.set(rel, us.length);
    for (const u of us) {
      units.push(u);
      // A `lead.*` webhook's payload IS a lead row, read or not.
      const via = u.kind === "webhook" ? "lead payload" : readsDirect(u.text) ? "direct" : readerReachedVia(rel, u);
      if (via) candidates.push({ ...u, via, ledgered: LEDGER_WRITE.test(u.text) });
    }
  }
  return { scannedFiles, units, candidates, readers, unitsByFile, rounds };
}

function loadServerTree(): Map<string, string> {
  const tree = new Map<string, string>();
  const walk = (dirRel: string) => {
    for (const name of readdirSync(path.join(ROOT, dirRel))) {
      const rel = path.posix.join(dirRel, name);
      if (statSync(path.join(ROOT, rel)).isDirectory()) {
        if (name === "__tests__" || name === "node_modules") continue;
        walk(rel);
      } else if (/\.ts$/.test(name) && !/\.(?:test|spec)\.ts$/.test(name) && !/\.d\.ts$/.test(name)) {
        tree.set(rel, readFileSync(path.join(ROOT, rel), "utf8"));
      }
    }
  };
  walk("server");
  return tree;
}

/** Problems with a census against the registers; [] means the census holds. */
function verdict(c: Census, regs: { ledgered: Record<string, string>; covered: Record<string, string>; debt: Record<string, string> }): string[] {
  const problems: string[] = [];
  const byKey = new Map(c.candidates.map((x) => [x.key, x]));
  for (const x of c.candidates) {
    if (x.ledgered && !(x.key in regs.ledgered)) problems.push(`UNREGISTERED LEDGERED: "${x.key}" (${x.file}:${x.line})`);
    if (!x.ledgered && !(x.key in regs.debt) && !(x.key in regs.covered)) {
      problems.push(`UNLEDGERED, NOT IN DEBT: "${x.key}" (${x.file}:${x.line}, via ${x.via}) — ledger it, or add  "${x.key}": "<proposed code>",  to DEBT`);
    }
  }
  for (const k of Object.keys(regs.ledgered)) {
    const x = byKey.get(k);
    if (!x) problems.push(`STALE LEDGERED entry (no such candidate): "${k}"`);
    else if (!x.ledgered) problems.push(`LEDGERED entry no longer writes the ledger: "${k}"`);
  }
  for (const [k, why] of Object.entries(regs.covered)) {
    const x = byKey.get(k);
    if (!x) problems.push(`STALE COVERED entry: "${k}"`);
    else if (!CHOKEPOINT_COVERED_FILES.test(x.file)) problems.push(`COVERED entry outside a pinned chokepoint's reach: "${k}" (${why})`);
  }
  for (const k of Object.keys(regs.debt)) {
    const x = byKey.get(k);
    if (!x) problems.push(`STALE DEBT entry (fixed or gone — delete it and lower DEBT_BASELINE): "${k}"`);
    else if (x.ledgered) problems.push(`DEBT entry is now ledgered — move it to LEDGERED and lower DEBT_BASELINE: "${k}"`);
  }
  return problems;
}

// ─── the registers ───────────────────────────────────────────────────────────

/** Surfaces that write the purpose ledger today, with their PURPOSE_SURFACES code. */
const LEDGERED: Record<string, PurposeSurface> = {
  "server/routes-skip-tracing.ts route:POST /trace/:leadId": "skip_trace_call",
  "server/routes-skip-tracing.ts route:POST /batch": "skip_trace_call",
  "server/routes-leads.ts route:POST /api/skip-traces": "skip_trace_call",
  "server/routes-leads.ts route:GET /api/skip-traces": "skip_trace_result_read",
  "server/routes-leads.ts route:GET /api/skip-traces/:id": "skip_trace_result_read",
  "server/routes-leads.ts route:GET /api/skip-traces/lead/:leadId": "skip_trace_result_read",
};

/**
 * Vendor-provider internals reachable ONLY through providerRegistry.lookup,
 * which refuses owner_info / skip_trace without an owner_contact_lookup
 * receipt (pinned in purposeLedger.test.ts). Restricted to the provider
 * directory by CHOKEPOINT_COVERED_FILES, so this cannot become a general
 * exemption list.
 */
const CHOKEPOINT_COVERED_FILES = /^server\/services\/providers\//;
const COVERED: Record<string, string> = {
  "server/services/providers/batchdata-provider.ts case:owner_info": "owner_contact_lookup at providerRegistry.lookup",
};

/**
 * Proposed surface codes for the debt — attorney-review input, NOT yet in
 * PURPOSE_SURFACES (a code joins it when its first surface is wired):
 *   lead_contact_read     a lead's phone/email/mailing address returned to the signed-in caller
 *   lead_contact_model    a lead's contact data placed in a model's context (AI tool, agent prompt)
 *   lead_contact_bulk     bulk egress: CSV/JSON export, backup, data-subject export
 *   lead_contact_api      egress to a third-party client: public API v1, MCP
 *   lead_contact_webhook  outbound webhook payload carrying a lead row
 *   owner_mailing_read    a parcel owner's mailing address (public record, natural person)
 *   review                reads person-adjacent rows; egress of a contact field not yet
 *                         established by a human read — ledger it or narrow the predicate
 */
type ProposedSurface =
  | "lead_contact_read"
  | "lead_contact_model"
  | "lead_contact_bulk"
  | "lead_contact_api"
  | "lead_contact_webhook"
  | "owner_mailing_read"
  | "review";

/**
 * Every unledgered candidate, by unit key. MAY ONLY SHRINK: ledgering a
 * surface (or narrowing the predicate with evidence) removes its entry, and
 * DEBT_BASELINE is lowered in the same commit. Generated 2026-10-24 from the
 * census itself; the Tier-A codes were read by hand, see
 * docs/compliance/purpose-ledger-census.md.
 */
const DEBT: Record<string, ProposedSurface> = {
  // server/ai/executive.ts
  "server/ai/executive.ts model:processChatStream": "lead_contact_model",
  // server/ai/supportAgent.ts
  "server/ai/supportAgent.ts case:check_data_integrity": "review",
  "server/ai/supportAgent.ts case:detect_data_integrity_issues": "review",
  "server/ai/supportAgent.ts case:predict_user_issues": "review",
  // server/ai/tools.ts
  "server/ai/tools.ts case:create_properties_batch": "review",
  "server/ai/tools.ts case:create_property": "review",
  "server/ai/tools.ts case:draft_outreach_message": "lead_contact_model",
  "server/ai/tools.ts case:get_lead_details": "lead_contact_model",
  "server/ai/tools.ts case:get_leads": "lead_contact_model",
  "server/ai/tools.ts case:get_stale_leads": "lead_contact_model",
  "server/ai/tools.ts case:get_system_context": "review",
  "server/ai/tools.ts case:schedule_follow_up": "lead_contact_model",
  "server/ai/tools.ts case:send_email": "lead_contact_model",
  "server/ai/tools.ts case:send_sms": "lead_contact_model",
  "server/ai/tools.ts case:update_lead_status": "lead_contact_model",
  // server/ai/vaService.ts
  "server/ai/vaService.ts case:create_lead": "review",
  "server/ai/vaService.ts case:update_lead_status": "review",
  "server/ai/vaService.ts case:update_lead_status#2": "review",
  // server/api-v1/leads.ts
  "server/api-v1/leads.ts route:GET /": "lead_contact_api",
  "server/api-v1/leads.ts route:GET /:id": "lead_contact_api",
  "server/api-v1/leads.ts webhook:lead.created": "lead_contact_webhook",
  "server/api-v1/leads.ts webhook:lead.updated": "lead_contact_webhook",
  // server/index.ts
  "server/index.ts route:POST /mcp": "lead_contact_api",
  // server/mcp-server.ts
  "server/mcp-server.ts case:get_leads": "lead_contact_api",
  "server/mcp-server.ts case:get_portfolio_summary": "review",
  // server/mcp/index.ts
  "server/mcp/index.ts tool:get_portfolio_summary": "review",
  "server/mcp/index.ts tool:search_leads": "lead_contact_api",
  // server/routes-accounting.ts
  "server/routes-accounting.ts route:POST /1098-batch": "review",
  // server/routes-admin.ts
  "server/routes-admin.ts route:GET /api/admin/beta-analytics": "review",
  "server/routes-admin.ts route:GET /api/founder/leading-indicators": "review",
  // server/routes-ai-draft.ts
  "server/routes-ai-draft.ts route:POST /draft-reply": "review",
  // server/routes-ai-operations.ts
  "server/routes-ai-operations.ts route:POST /buyer-matching/match": "review",
  "server/routes-ai-operations.ts route:POST /intent/predict": "review",
  "server/routes-ai-operations.ts route:POST /patterns/analyze": "review",
  // server/routes-ai.ts
  "server/routes-ai.ts route:POST /api/va/actions/:id/approve": "review",
  "server/routes-ai.ts route:POST /api/va/actions/:id/execute": "review",
  "server/routes-ai.ts route:POST /api/va/briefings/generate": "review",
  // server/routes-analytics.ts
  "server/routes-analytics.ts route:GET /api/analytics/cohort-dashboard": "review",
  "server/routes-analytics.ts route:GET /api/analytics/team-kpi": "review",
  "server/routes-analytics.ts route:GET /api/analytics/team-leaderboard": "review",
  // server/routes-borrower.ts
  "server/routes-borrower.ts route:GET /api/borrower/payoff-quote": "review",
  "server/routes-borrower.ts route:GET /api/borrower/periodic-statements/:statementId/pdf": "review",
  "server/routes-borrower.ts route:GET /api/borrower/session": "review",
  "server/routes-borrower.ts route:GET /api/borrower/statements/generate": "review",
  "server/routes-borrower.ts route:POST /api/borrower/auth/exchange": "review",
  "server/routes-borrower.ts route:POST /api/borrower/payment": "review",
  "server/routes-borrower.ts route:POST /api/borrower/verify": "review",
  "server/routes-borrower.ts route:POST /api/borrower/verify-payment": "review",
  "server/routes-borrower.ts route:POST /api/portal/:accessToken/autopay": "review",
  "server/routes-borrower.ts route:POST /api/portal/:accessToken/payment": "review",
  // server/routes-buyer-qualification.ts
  "server/routes-buyer-qualification.ts route:GET /:id/report": "review",
  "server/routes-buyer-qualification.ts route:POST /:id/assess": "review",
  "server/routes-buyer-qualification.ts route:POST /:id/background": "review",
  // server/routes-campaigns.ts
  "server/routes-campaigns.ts route:GET /api/campaigns/overlap-report": "review",
  "server/routes-campaigns.ts route:GET /api/leads/:id/enrollments": "review",
  "server/routes-campaigns.ts route:POST /api/campaigns/:id/pre-send-check": "review",
  "server/routes-campaigns.ts route:POST /api/campaigns/:id/send-direct-mail": "review",
  "server/routes-campaigns.ts route:POST /api/campaigns/:id/send-email": "review",
  "server/routes-campaigns.ts route:POST /api/campaigns/:id/send-sms": "review",
  "server/routes-campaigns.ts route:POST /api/direct-mail/bulk-verify-addresses": "review",
  "server/routes-campaigns.ts route:POST /api/direct-mail/estimate": "review",
  "server/routes-campaigns.ts route:POST /api/sequences/:id/enroll": "review",
  // server/routes-closing.ts
  "server/routes-closing.ts route:POST /api/deals/:id/closing-package": "review",
  // server/routes-communications.ts
  "server/routes-communications.ts route:POST /api/workflows/:id/test": "review",
  // server/routes-contract-chain.ts
  "server/routes-contract-chain.ts route:GET /api/deals/:id/contract-preview": "review",
  "server/routes-contract-chain.ts route:POST /api/deals/:id/contract": "review",
  // server/routes-core-ai.ts
  "server/routes-core-ai.ts route:POST /api/communications/send": "review",
  // server/routes-customer-letter.ts
  "server/routes-customer-letter.ts route:POST /generate": "review",
  // server/routes-dashboard.ts
  "server/routes-dashboard.ts route:GET /api/dashboard/intelligence": "review",
  // server/routes-data-intelligence.ts
  "server/routes-data-intelligence.ts route:GET /lead-intelligence/batch": "review",
  "server/routes-data-intelligence.ts route:GET /prospect/:leadId": "review",
  // server/routes-deal-patterns.ts
  "server/routes-deal-patterns.ts route:POST /extract/:dealId": "review",
  // server/routes-deals.ts
  "server/routes-deals.ts route:GET /api/deals/:id/report": "review",
  "server/routes-deals.ts route:GET /api/deals/coach": "review",
  "server/routes-deals.ts route:GET /api/properties/:id/report": "review",
  "server/routes-deals.ts route:GET /api/properties/:id/report/pdf": "review",
  "server/routes-deals.ts route:POST /api/deals/:id/offer-letter-pdf": "review",
  "server/routes-deals.ts route:POST /api/due-diligence/:propertyId/lookup/tax": "review",
  "server/routes-deals.ts route:PUT /api/deals/:id": "review",
  // server/routes-doc-system.ts
  "server/routes-doc-system.ts route:GET /api/documents/resolve-context": "review",
  "server/routes-doc-system.ts route:POST /api/document-packages/:id/generate-all": "review",
  "server/routes-doc-system.ts route:POST /api/generated-documents": "review",
  // server/routes-documents.ts
  "server/routes-documents.ts route:GET /api/notes/:id/document": "review",
  "server/routes-documents.ts route:GET /api/properties/:id/deed": "review",
  "server/routes-documents.ts route:POST /api/documents/generate": "review",
  "server/routes-documents.ts route:POST /api/documents/generate/promissory-note": "review",
  "server/routes-documents.ts route:POST /api/documents/generate/settlement-statement": "review",
  "server/routes-documents.ts route:POST /api/documents/generate/warranty-deed": "review",
  "server/routes-documents.ts route:POST /api/documents/offer-letter": "review",
  // server/routes-due-diligence.ts
  "server/routes-due-diligence.ts route:GET /:propertyId/owner": "owner_mailing_read",
  "server/routes-due-diligence.ts route:POST /:id/run": "review",
  // server/routes-enhancements.ts
  "server/routes-enhancements.ts route:GET /api/enhancements/aging-leads": "review",
  "server/routes-enhancements.ts route:GET /api/enhancements/lead-duplicates": "lead_contact_read",
  "server/routes-enhancements.ts route:GET /api/enhancements/lead-score-explanation/:id": "review",
  "server/routes-enhancements.ts route:GET /api/enhancements/signup-funnel": "review",
  // server/routes-epic-services.ts
  "server/routes-epic-services.ts route:GET /seller-motivation/:leadId": "review",
  "server/routes-epic-services.ts route:POST /seller-motivation/rescore-org": "review",
  // server/routes-field-scout.ts
  "server/routes-field-scout.ts route:GET /field-scout/visits": "review",
  "server/routes-field-scout.ts route:GET /properties/parcel-lookup": "review",
  "server/routes-field-scout.ts route:POST /leads/:id/photos": "review",
  // server/routes-finance.ts
  "server/routes-finance.ts route:GET /api/finance/ltv-report": "review",
  "server/routes-finance.ts route:GET /api/finance/ltv/:noteId": "review",
  "server/routes-finance.ts route:GET /api/notes/:id/schedule/pdf": "review",
  "server/routes-finance.ts route:POST /api/finance/process": "review",
  "server/routes-finance.ts route:POST /api/notes/:id/dunning": "review",
  "server/routes-finance.ts route:POST /api/notes/:id/send-reminder": "review",
  "server/routes-finance.ts route:POST /api/payments": "review",
  // server/routes-import-export.ts
  "server/routes-import-export.ts route:GET /api/compliance/tcpa/no-consent": "lead_contact_read",
  "server/routes-import-export.ts route:GET /api/compliance/tcpa/opted-out": "lead_contact_read",
  "server/routes-import-export.ts route:GET /api/compliance/tcpa/stats": "review",
  "server/routes-import-export.ts route:GET /api/export/:entityType": "lead_contact_bulk",
  "server/routes-import-export.ts route:GET /api/export/backup": "lead_contact_bulk",
  "server/routes-import-export.ts route:PATCH /api/leads/:id/consent": "review",
  "server/routes-import-export.ts route:POST /api/import/:entityType": "review",
  // server/routes-inbound-email.ts
  "server/routes-inbound-email.ts route:POST /api/webhooks/inbound-email": "review",
  // server/routes-land-data.ts
  "server/routes-land-data.ts route:GET /api/land-data/parcel-lookup": "review",
  "server/routes-land-data.ts route:GET /api/land-data/parcels/:parcelKey": "review",
  // server/routes-lead-enrichment.ts
  "server/routes-lead-enrichment.ts route:GET /:id/completeness": "review",
  "server/routes-lead-enrichment.ts route:POST /:id/enrich": "review",
  "server/routes-lead-enrichment.ts route:POST /bulk-enrich": "review",
  // server/routes-leads.ts
  "server/routes-leads.ts route:DELETE /api/leads/:id": "review",
  "server/routes-leads.ts route:GET /api/leads": "lead_contact_read",
  "server/routes-leads.ts route:GET /api/leads/:id": "lead_contact_read",
  "server/routes-leads.ts route:GET /api/leads/:id/activities": "review",
  "server/routes-leads.ts route:GET /api/leads/:id/deal-state": "review",
  "server/routes-leads.ts route:GET /api/leads/:id/properties": "review",
  "server/routes-leads.ts route:GET /api/leads/aging": "review",
  "server/routes-leads.ts route:GET /api/leads/duplicate-clusters": "review",
  "server/routes-leads.ts route:GET /api/leads/export": "lead_contact_bulk",
  "server/routes-leads.ts route:GET /api/leads/focus": "lead_contact_read",
  "server/routes-leads.ts route:GET /api/leads/insights": "review",
  "server/routes-leads.ts route:GET /api/leads/paginated": "lead_contact_read",
  "server/routes-leads.ts route:PATCH /api/leads/:id/restore": "review",
  "server/routes-leads.ts route:POST /api/leads": "review",
  "server/routes-leads.ts route:POST /api/leads/:id/betty-score": "review",
  "server/routes-leads.ts route:POST /api/leads/:id/contact-event": "review",
  "server/routes-leads.ts route:POST /api/leads/:id/convert-to-deal": "review",
  "server/routes-leads.ts route:POST /api/leads/:id/nurture": "review",
  "server/routes-leads.ts route:POST /api/leads/:id/score": "review",
  "server/routes-leads.ts route:POST /api/leads/batch-score": "review",
  "server/routes-leads.ts route:POST /api/leads/bulk-delete": "review",
  "server/routes-leads.ts route:POST /api/leads/bulk-update": "review",
  "server/routes-leads.ts route:POST /api/leads/check-duplicates": "review",
  "server/routes-leads.ts route:POST /api/leads/csv-import": "review",
  "server/routes-leads.ts route:POST /api/leads/import": "review",
  "server/routes-leads.ts route:POST /api/leads/import/tax-delinquent": "review",
  "server/routes-leads.ts route:PUT /api/leads/:id": "review",
  // server/routes-lifecycle.ts
  "server/routes-lifecycle.ts route:POST /api/founder/pre-churn/sweep": "review",
  // server/routes-micro-features.ts
  "server/routes-micro-features.ts route:GET /api/dashboard/priority": "review",
  "server/routes-micro-features.ts route:GET /api/properties/:id/neighbors": "review",
  // server/routes-misc.ts
  "server/routes-misc.ts route:GET /api/leads/:id/suggested-response": "review",
  "server/routes-misc.ts route:POST /api/check-hot-leads": "review",
  "server/routes-misc.ts route:POST /api/leads/:leadId/sms": "review",
  "server/routes-misc.ts route:POST /api/sms/send": "review",
  "server/routes-misc.ts route:POST /api/webhooks/twilio/sms": "review",
  // server/routes-notes.ts
  "server/routes-notes.ts route:POST /api/notes/from-deal/:dealId": "review",
  // server/routes-onboarding.ts
  "server/routes-onboarding.ts route:POST /complete": "review",
  // server/routes-organization.ts
  "server/routes-organization.ts route:GET /api/recent-items": "review",
  "server/routes-organization.ts route:GET /api/team/performance": "review",
  "server/routes-organization.ts route:POST /api/organization/invitations/accept": "review",
  // server/routes-outreach-mail.ts
  "server/routes-outreach-mail.ts route:POST /api/outreach/mail/preview": "review",
  "server/routes-outreach-mail.ts route:POST /api/outreach/mail/queue": "review",
  "server/routes-outreach-mail.ts route:POST /api/outreach/mail/quote": "review",
  // server/routes-owner-optout.ts
  "server/routes-owner-optout.ts route:POST /api/public/owner-optout": "review",
  // server/routes-pax-controls.ts
  "server/routes-pax-controls.ts route:GET /controls": "review",
  "server/routes-pax-controls.ts route:PATCH /controls": "review",
  "server/routes-pax-controls.ts route:POST /pause": "review",
  "server/routes-pax-controls.ts route:POST /resume": "review",
  // server/routes-pax-insights.ts
  "server/routes-pax-insights.ts route:GET /insights": "review",
  "server/routes-pax-insights.ts route:GET /pax-suggestions": "review",
  // server/routes-platform-features.ts
  "server/routes-platform-features.ts route:GET /api/data/export": "lead_contact_bulk",
  "server/routes-platform-features.ts route:GET /api/pipeline/attribution": "review",
  "server/routes-platform-features.ts route:POST /api/export/full": "lead_contact_bulk",
  // server/routes-privacy-dsar.ts
  "server/routes-privacy-dsar.ts route:POST /api/founder/dsar/:id/generate-export": "lead_contact_bulk",
  // server/routes-properties.ts
  "server/routes-properties.ts route:GET /api/properties/:id/report.pdf": "review",
  "server/routes-properties.ts route:POST /api/parcels/lookup": "review",
  "server/routes-properties.ts route:POST /api/properties/:id/fetch-parcel": "review",
  "server/routes-properties.ts route:POST /api/properties/fetch-all-parcels": "review",
  // server/routes-public-land.ts
  "server/routes-public-land.ts route:GET /api/public/land/county-guide/:state/:county": "review",
  "server/routes-public-land.ts route:GET /land/:state/:county": "review",
  // server/routes-seller-intent.ts
  "server/routes-seller-intent.ts route:GET /:leadId": "review",
  "server/routes-seller-intent.ts route:GET /:leadId/engagement": "review",
  "server/routes-seller-intent.ts route:POST /:leadId/approach": "review",
  "server/routes-seller-intent.ts route:POST /:leadId/offer-range": "review",
  // server/routes-skip-tracing.ts
  "server/routes-skip-tracing.ts route:GET /stats": "review",
  // server/routes-support-tickets.ts
  "server/routes-support-tickets.ts route:POST /api/support/tickets/:id/messages": "review",
  // server/routes-tax-certificates.ts
  "server/routes-tax-certificates.ts route:POST /api/tax-certificates": "review",
  // server/routes-tax-delinquent.ts
  "server/routes-tax-delinquent.ts route:GET /": "lead_contact_read",
  "server/routes-tax-delinquent.ts route:GET /:id": "lead_contact_read",
  // server/routes-tax-researcher.ts
  "server/routes-tax-researcher.ts route:POST /listings/:id/bid-log": "review",
  "server/routes-tax-researcher.ts route:POST /listings/:id/won-certificate": "review",
  // server/routes-team-messaging.ts
  "server/routes-team-messaging.ts route:POST /api/offer-letters/batch": "review",
  // server/routes-title-search.ts
  "server/routes-title-search.ts route:POST /search": "owner_mailing_read",
  // server/routes-today.ts
  "server/routes-today.ts route:GET /": "review",
  "server/routes-today.ts route:POST /queue/clear": "review",
  // server/routes-trust-checks.ts
  "server/routes-trust-checks.ts route:GET /api/deals/:id/fraud-check": "review",
  // server/routes-va-engine.ts
  "server/routes-va-engine.ts route:GET /api/seller-communications/lead/:leadId": "lead_contact_read",
  // server/routes.ts
  "server/routes.ts route:GET /api/leads/deleted": "lead_contact_read",
  "server/routes.ts route:GET /api/search": "lead_contact_read",
  "server/routes.ts route:POST /api/import/auto-delinquent": "review",
  "server/routes.ts route:POST /api/leads/:id/mark-contacted": "review",
  "server/routes.ts route:POST /api/leads/:id/record-contact": "review",
  "server/routes.ts route:POST /api/leads/bulk-delete/preview": "review",
  // server/services/autopilot/hands/send-sms.ts
  "server/services/autopilot/hands/send-sms.ts tool:send_sms": "lead_contact_model",
  // server/services/core-agents.ts
  "server/services/core-agents.ts case:compose_email": "lead_contact_model",
  "server/services/core-agents.ts case:compose_sms": "lead_contact_model",
  "server/services/core-agents.ts case:draft_response": "lead_contact_model",
  "server/services/core-agents.ts case:generate_offer": "lead_contact_model",
  "server/services/core-agents.ts case:nurture_lead": "lead_contact_model",
  "server/services/core-agents.ts case:run_digest": "review",
  // server/services/outcomeVerificationLoop.ts
  "server/services/outcomeVerificationLoop.ts case:send_follow_up": "review",
  // server/services/workflow-engine.ts
  "server/services/workflow-engine.ts case:conditional": "review",
  "server/services/workflow-engine.ts case:send_email#2": "review",
  "server/services/workflow-engine.ts case:update_record#2": "review",
};

/** DEBT may only shrink. Lower this in the same commit that removes an entry. */
const DEBT_BASELINE = 214;

/**
 * Every file holding a dispatch switch (≥10 snake_case case labels, raw count)
 * or an MCP tool registry, with the number of units the extractor must read
 * from it. Per-member vacuity: a parser that silently stops reading one
 * member reads exactly like that member being clean. The tripwire test below
 * fails when a NEW file crosses the threshold without being listed here.
 * Model-facing switches are marked; the census reads all of them alike.
 */
const DISPATCH_MEMBERS: Record<string, { kind: UnitKind; min: number; modelFacing: boolean }> = {
  // model-facing: a model chooses the case, and the return value is what it reads next
  "server/ai/tools.ts": { kind: "case", min: 67, modelFacing: true },
  "server/ai/supportAgent.ts": { kind: "case", min: 74, modelFacing: true }, // executeSupportTool: 74 top-level labels (+17 in nested switches)
  "server/ai/vaService.ts": { kind: "case", min: 15, modelFacing: true },
  "server/mcp/index.ts": { kind: "tool", min: 29, modelFacing: true },
  "server/mcp-server.ts": { kind: "case", min: 6, modelFacing: true },
  "server/services/core-agents.ts": { kind: "case", min: 19, modelFacing: true },
  "server/services/ceoCommandBridge.ts": { kind: "case", min: 28, modelFacing: true }, // NL command → AI classification → case
  "server/services/autonomousDecisionExecutor.ts": { kind: "case", min: 13, modelFacing: true },
  "server/services/solene/dispatchToolExecutor.ts": { kind: "case", min: 18, modelFacing: true },
  "server/services/negotiationOrchestrator.ts": { kind: "case", min: 5, modelFacing: true }, // below the tripwire threshold; listed by hand
  "server/services/solene/chat/businessTools.ts": { kind: "case", min: 6, modelFacing: true }, // below the tripwire threshold; listed by hand
  // not model-facing: state machines and mappers that happen to share the shape
  "server/services/paxAskSummary.ts": { kind: "case", min: 18, modelFacing: false },
  "server/services/workflow-engine.ts": { kind: "case", min: 19, modelFacing: false },
  "server/services/depreciationService.ts": { kind: "case", min: 12, modelFacing: false },
  "server/services/leadIntelligenceEngine.ts": { kind: "case", min: 10, modelFacing: false },
  "server/services/onboarding/sampleSeeder.ts": { kind: "case", min: 14, modelFacing: false },
  "server/services/propertyEnrichment.ts": { kind: "case", min: 23, modelFacing: false },
};

/**
 * Tool-registry directories (`registerTool({ name, handler })`, `registerHand({ … })`)
 * and the tool units each must yield: 80 founder-chat registerTool calls, 8 hands.
 */
const REGISTRY_DIRS: Record<string, number> = {
  "server/services/founder-chat/tools/": 80,
  "server/services/autopilot/hands/": 8,
};

/** Route files whose route count is a floor (the ledgered doors + the public API). */
const ROUTE_MEMBERS: Record<string, number> = {
  "server/routes-skip-tracing.ts": 3,
  "server/routes-leads.ts": 39,
  "server/api-v1/leads.ts": 4,
  "server/routes-import-export.ts": 23,
  "server/routes.ts": 31,
};

/** Whole-population floors (measured 2026-10-24; a drop means the reader lost files or units). */
const SCANNED_FILES_FLOOR = 160;
const UNITS_FLOOR = 1500;
const CANDIDATES_FLOOR = 220;

const DISPATCH_TRIPWIRE = /\bcase\s+["'][a-z][a-z0-9]*_[a-z0-9_]+["']\s*:/g;

// ─── the tests ───────────────────────────────────────────────────────────────

let tree: Map<string, string>;
let census: Census;
beforeAll(() => {
  tree = loadServerTree();
  census = runCensus(tree);
}, REPO_SWEEP_TIMEOUT_MS);

const regs = { ledgered: LEDGERED as Record<string, string>, covered: COVERED, debt: DEBT as Record<string, string> };

describe("purpose-ledger census — the real tree", () => {
  it("every person-adjacent surface is LEDGERED, COVERED by the registry chokepoint, or in DEBT; no entry is stale", () => {
    expect(verdict(census, regs)).toEqual([]);
  });

  it("DEBT may only shrink: its size equals DEBT_BASELINE (lower the baseline when an entry is removed)", () => {
    expect(Object.keys(DEBT).length).toBe(DEBT_BASELINE);
  });

  it("LEDGERED codes are real PURPOSE_SURFACES and agree with the service's enumeration", () => {
    for (const code of Object.values(LEDGERED)) expect((PURPOSE_SURFACES as readonly string[]).includes(code)).toBe(true);
    // skip_trace_call and skip_trace_result_read each have a ledgered door; owner_contact_lookup is the registry chokepoint.
    expect(new Set(Object.values(LEDGERED))).toEqual(new Set(["skip_trace_call", "skip_trace_result_read"]));
  });

  it("vacuity: the population and its units did not silently shrink", () => {
    expect(census.scannedFiles.length, "scanned files").toBeGreaterThanOrEqual(SCANNED_FILES_FLOOR);
    expect(census.units.length, "units").toBeGreaterThanOrEqual(UNITS_FLOOR);
    expect(census.candidates.length, "candidates").toBeGreaterThanOrEqual(CANDIDATES_FLOOR);
    expect(census.rounds, "closure ran").toBeGreaterThan(0);
  });

  it("per-member vacuity: every dispatch member yields its floor of units (scanned or not)", () => {
    for (const [file, { kind, min }] of Object.entries(DISPATCH_MEMBERS)) {
      const src = tree.get(file);
      expect(src, `${file} exists`).toBeDefined();
      const s = stripComments(src ?? "");
      const units = extractUnits(file, ts.createSourceFile(file, s, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS), s).filter((u) => u.kind === kind);
      expect(units.length, `${file}: ${kind} units`).toBeGreaterThanOrEqual(min);
    }
    for (const [dir, min] of Object.entries(REGISTRY_DIRS)) {
      let n = 0;
      for (const [file, raw] of tree) {
        if (!file.startsWith(dir)) continue;
        const s = stripComments(raw);
        n += extractUnits(file, ts.createSourceFile(file, s, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS), s).filter((u) => u.kind === "tool").length;
      }
      expect(n, `${dir}: tool units`).toBeGreaterThanOrEqual(min);
    }
    for (const [file, min] of Object.entries(ROUTE_MEMBERS)) {
      expect(census.scannedFiles, `${file} in the scanned population`).toContain(file);
      expect(census.units.filter((u) => u.file === file && u.kind === "route").length, `${file}: routes`).toBeGreaterThanOrEqual(min);
    }
  });

  it("tripwire: every file with ≥10 snake_case case labels is an enumerated dispatch member", () => {
    const over: string[] = [];
    for (const [file, raw] of tree) if ((stripComments(raw).match(DISPATCH_TRIPWIRE) ?? []).length >= 10) over.push(file);
    expect(over.length, "vacuity: the tripwire matched the known switches").toBeGreaterThanOrEqual(10);
    expect(over.filter((f) => !(f in DISPATCH_MEMBERS))).toEqual([]);
  });

  it("every NON_CONTACT_READERS exclusion is still a real storage call somewhere (no dead exclusions)", () => {
    const all = [...tree.values()].join("\n");
    for (const name of Object.keys(NON_CONTACT_READERS)) expect(all.includes(`storage.${name}(`), name).toBe(true);
  });

  it("the census agrees with purposeLedger.ts: owner_info providers are reached only through the registry", () => {
    // COVERED's premise: no file outside the registry calls a provider's lookup for owner_info directly.
    const direct = [...tree].filter(([f, raw]) => !CHOKEPOINT_COVERED_FILES.test(f) && /\bbatchDataProvider\.lookup\(/.test(stripComments(raw)));
    expect(direct.map(([f]) => f)).toEqual([]);
  });
});

describe("purpose-ledger census — falsified against the real registers", () => {
  it("MUTATION: a ledgered door that stops writing the ledger is caught", () => {
    const mutated: Census = { ...census, candidates: census.candidates.map((x) => (x.key === "server/routes-leads.ts route:GET /api/skip-traces" ? { ...x, ledgered: false } : x)) };
    expect(verdict(mutated, regs)).toEqual(expect.arrayContaining([expect.stringContaining('LEDGERED entry no longer writes the ledger: "server/routes-leads.ts route:GET /api/skip-traces"')]));
  });

  it("MUTATION: a new unledgered surface is caught; removing a DEBT entry without fixing it is caught", () => {
    const fake: Candidate = { kind: "route", file: "server/routes-zz.ts", key: "server/routes-zz.ts route:GET /api/zz/owner-phone", line: 1, text: "", via: "direct", ledgered: false };
    expect(verdict({ ...census, candidates: [...census.candidates, fake] }, regs)).toEqual([expect.stringContaining('UNLEDGERED, NOT IN DEBT: "server/routes-zz.ts route:GET /api/zz/owner-phone"')]);
    const [first, ...rest] = Object.keys(DEBT);
    const shrunk = { ...regs, debt: Object.fromEntries(rest.map((k) => [k, "review"])) };
    expect(verdict(census, shrunk)).toEqual([expect.stringContaining(`UNLEDGERED, NOT IN DEBT: "${first}"`)]);
  });

  it("MUTATION: a stale DEBT entry (surface fixed or gone) is caught", () => {
    expect(verdict(census, { ...regs, debt: { ...regs.debt, "server/routes-gone.ts route:GET /x": "review" } })).toEqual([expect.stringContaining("STALE DEBT entry")]);
  });
});

// ─── canaries: each extraction shape, with the defect hidden inside it ──────

const FIXTURE: Record<string, string> = {
  "server/storage/fixtureRepo.ts": [
    "// SYNTHETIC fixture — not real code.",
    "export function readAllFixtureLeads(orgId: number) {",
    "  return db.select().from(leads).where(eq(leads.organizationId, orgId));",
    "}",
  ].join("\n"),
  "server/services/fixtureExport.ts": [
    'import { readAllFixtureLeads } from "../storage/fixtureRepo";',
    "function toCsv(rows: Array<{ id: number }>) { return rows.map((r) => r.id).join(\",\"); }",
    "export async function exportFixtureCsv(orgId: number) { const rows = await readAllFixtureLeads(orgId); return toCsv(rows); }",
    "export async function fixtureCountOnly() { return db.select({ count: count() }).from(leads); }",
  ].join("\n"),
  "server/routes-fixture.ts": [
    'import { exportFixtureCsv, fixtureCountOnly } from "./services/fixtureExport";',
    "export function register(app: any, api: any) {",
    "  // storage.getLead(1, 2) appears only in this comment — and the next route doesn't read.",
    '  app.get("/api/fixture/comment-only", async (req: any, res: any) => { res.json({ ok: true }); });',
    '  app.get("/api/fixture/inline", async (req: any, res: any) => { const lead = await storage.getLead(1, 2); res.json(lead); });',
    "  api.post(",
    '    "/api/fixture/next-line-wrapped",',
    "    asyncHandler(async (req: any, res: any) => {",
    "      await db.transaction(async (tx: any) => { await tx.insert(audit).values({}); });",
    "      const rows = await db.select().from(leads);",
    "      res.json(rows);",
    "    }),",
    "  );",
    '  app.get("/api/fixture/export", async (req: any, res: any) => res.send(await exportFixtureCsv(1)));',
    '  app.get("/api/fixture/count", async (req: any, res: any) => res.json(await fixtureCountOnly()));',
    '  app.get("/api/fixture/count-call", async (req: any, res: any) => res.json(await storage.getLeadCount(1)));',
    '  app.get("/api/fixture/projection-phone", async (req: any, res: any) => res.json(await db.select({ phone: leads.phone }).from(leads)));',
    '  app.get("/api/fixture/comment-in-from", async (req: any, res: any) => res.json(await db.select().from(/* every row */ leads)));',
    '  app.get("/api/fixture/ledgered", async (req: any, res: any) => { await recordPurpose(entry); res.json(await storage.getLead(1, 2)); });',
    '  app.get("/api/fixture/sync", (req: any, res: any) => { storage.getLeads(1).then((l: unknown) => res.json(l)); });',
    "}",
  ].join("\n"),
  "server/ai/fixtureTools.ts": [
    "export async function run(name: string, args: { id: number }) {",
    "  switch (name) {",
    '    case "fixture_get_lead":',
    '    case "fixture_lookup_lead": {',
    "      return await storage.getLead(1, args.id);",
    "    }",
    '    case "fixture_noop":',
    "      return { ok: true };",
    "  }",
    "}",
  ].join("\n"),
  "server/mcp/fixture.ts": 'export function reg(tool: any) { tool("fixture_search", "d", {}, async () => ok(await storage.getLeads(1))); }',
  "server/api-v1/fixtureHooks.ts": 'export function hook(x: any) { dispatchWebhookEvent(1, "lead.created", { ...serializeLead(x) }); }',
  "server/services/fixtureAi.ts": "export async function draftFixture(id: number) { const lead = await storage.getLead(1, id); return routeAITask({ prompt: lead.phone }); }",
  "server/services/autopilot/hands/fixtureHand.ts": [
    'const NAME = "fixture_send_sms";',
    "async function handler(input: { leadId: number }) { const lead = await storage.getLead(1, input.leadId); return { ok: !!lead }; }",
    "registerHand({ name: NAME, schema: { name: NAME }, handler });",
  ].join("\n"),
  "server/services/founder-chat/tools/fixtureInquiry.ts": 'registerTool({ name: "fixture_founder_lookup", async handler() { return storage.getLeads(1); } });',
  "server/jobs/fixtureJobs.ts": 'scheduleSelfRescheduling({ name: "fixture_job_sweep", run: async () => storage.getLeads(1) });',
};

const FIXTURE_EXPECTED = [
  "server/routes-fixture.ts route:GET /api/fixture/inline",
  "server/routes-fixture.ts route:POST /api/fixture/next-line-wrapped",
  "server/routes-fixture.ts route:GET /api/fixture/export",
  "server/routes-fixture.ts route:GET /api/fixture/projection-phone",
  "server/routes-fixture.ts route:GET /api/fixture/comment-in-from",
  "server/routes-fixture.ts route:GET /api/fixture/ledgered",
  "server/routes-fixture.ts route:GET /api/fixture/sync",
  "server/ai/fixtureTools.ts case:fixture_get_lead",
  "server/ai/fixtureTools.ts case:fixture_lookup_lead",
  "server/mcp/fixture.ts tool:fixture_search",
  "server/api-v1/fixtureHooks.ts webhook:lead.created",
  "server/services/fixtureAi.ts model:draftFixture",
  "server/services/autopilot/hands/fixtureHand.ts tool:fixture_send_sms",
  "server/services/founder-chat/tools/fixtureInquiry.ts tool:fixture_founder_lookup",
].sort();

describe("purpose-ledger census — canaries (SYNTHETIC fixture tree)", () => {
  const fx = () => runCensus(new Map(Object.entries(FIXTURE)));

  it("finds exactly the surfaces hidden in each shape, and none of the decoys", () => {
    const c = fx();
    expect(c.candidates.map((x) => x.key).sort()).toEqual(FIXTURE_EXPECTED);
  });

  it("follows surface → service → storage, and recognises a ledger write", () => {
    const c = fx();
    expect(c.candidates.find((x) => x.key.endsWith("GET /api/fixture/export"))?.via).toBe("exportFixtureCsv");
    expect(c.candidates.filter((x) => x.ledgered).map((x) => x.key)).toEqual(["server/routes-fixture.ts route:GET /api/fixture/ledgered"]);
  });

  it("the verdict goes red on an unregistered fixture surface", () => {
    const c = fx();
    const debt = Object.fromEntries(FIXTURE_EXPECTED.filter((k) => !k.endsWith("/ledgered")).map((k) => [k, "review"]));
    const ledgered = { "server/routes-fixture.ts route:GET /api/fixture/ledgered": "skip_trace_call" };
    expect(verdict(c, { ledgered, covered: {}, debt })).toEqual([]);
    const { ["server/routes-fixture.ts route:GET /api/fixture/sync"]: _dropped, ...without } = debt;
    expect(verdict(c, { ledgered, covered: {}, debt: without })).toEqual([expect.stringContaining('NOT IN DEBT: "server/routes-fixture.ts route:GET /api/fixture/sync"')]);
  });

  it("RAW_PREFILTER is a superset of DIRECT_READ: one sample per alternative passes both", () => {
    const samples = [
      "db.select().from(leads)",
      "db.select().from(skipTraces)",
      "db.select().from(parcelSnapshots)",
      "db.query.leads.findMany()",
      "storage.getLeadsPaginated(1)",
      "storage.findDuplicateLeads(1)",
      "storage.getSkipTraceByLead(1)",
      "row.ownerAddress",
      "row.mailingAddress",
      "row.ownerMailingAddress",
      "skipTracingService.trace(x)",
      "sql`SELECT phone FROM leads WHERE id = ${id}`",
      'sql`SELECT * FROM "skip_traces"`',
    ];
    for (const s of samples) {
      expect(readsDirect(s), `DIRECT_READ: ${s}`).toBe(true);
      expect(RAW_PREFILTER.test(s), `RAW_PREFILTER: ${s}`).toBe(true);
    }
  });
});

