/**
 * A request body is never the source of a row's server-owned fields.
 *
 * The primary key, the tenant key and the lifecycle timestamps (`id`,
 * `organizationId`, `createdAt`, `updatedAt`, `deletedAt`) are set by the
 * server, never by the request. The lead create contract once ran its schema
 * through `.passthrough()` — deliberately, so transport-only extras (consent
 * evidence, coordinates for enrichment) reach the handler — and with them a
 * body's `id` and `createdAt` reached the insert as well. A schema that keeps
 * unknown keys is not the only way to get there: a handler that spreads the raw
 * body into a repository call never consults a schema at all.
 *
 * So this gate reads THREE populations, each enumerated from the route files'
 * syntax trees rather than listed by hand:
 *
 *   1. Every zod schema exported from `shared/` that a POST handler references
 *      (static imports, dynamic `await import(...)` bindings, namespace access,
 *      contract `.requestSchema`, and the shared base of any local schema the
 *      handler uses). Each is PARSED with a minimal valid body plus each
 *      server-owned key, and the output must refuse or drop every one. A schema
 *      whose output legitimately carries `organizationId` must only ever be fed
 *      one the server composed after the request's own fields.
 *   2. Every schema declared locally in a route file and used by a POST
 *      handler: its top-level spine may not keep unknown keys.
 *   3. Every write handler (POST/PUT/PATCH): the raw request body — or a
 *      variable holding it — may be spread only into the argument of a schema
 *      parse, and may not be handed whole to ANY call but a schema parse, a
 *      named sanitizer or a shape-only built-in. A service method that spreads
 *      its argument into `.set()` writes the body's fields as surely as a
 *      `.set()` in the handler does; the call site is where that is visible.
 *
 * Each population carries a floor and a per-member vacuity check, and every
 * extraction shape the gate relies on has a canary below that must go red.
 */

import { describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";

vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

const ROOT = process.cwd();
const SHARED_DIR = path.join(ROOT, "shared");

/* ────────────────────────────────────────────────────────────────────────────
 * The probe. Values are what a JSON body can actually carry.
 * ──────────────────────────────────────────────────────────────────────────── */

const PROBE: Record<string, unknown> = {
  id: 987654,
  organizationId: 999,
  createdAt: "2001-02-03T04:05:06.000Z",
  updatedAt: "2001-02-03T04:05:06.000Z",
  deletedAt: "2001-02-03T04:05:06.000Z",
};
const PROBE_KEYS = Object.keys(PROBE);

const WRITE_METHODS = new Set(["post", "put", "patch"]);
const PARSE_METHODS = new Set(["parse", "safeParse", "parseAsync", "safeParseAsync"]);
const LOOSE_METHODS = new Set(["passthrough", "loose", "catchall", "looseObject"]);

/* ────────────────────────────────────────────────────────────────────────────
 * Floors, measured 2026-10-06 (218 files, 1175 write registrations, 34 shared
 * schema members, 266 local schema references). A drop means the extractor
 * stopped reading something; lower a floor only in the commit that really
 * removes routes, and say so here.
 * ──────────────────────────────────────────────────────────────────────────── */

const ROUTE_FILE_FLOOR = 218;
const WRITE_REGISTRATION_FLOOR = 1175;
const SHARED_SCHEMA_MEMBER_FLOOR = 34;
const LOCAL_SCHEMA_MEMBER_FLOOR = 266;

/**
 * Registrations whose handler is defined in another module. They are named
 * here so a new one is a decision, not a silent gap in population 3.
 */
const OUT_OF_FILE_HANDLERS = new Set([
  "server/routes.ts post /api/mcp/execute",
  "server/routes.ts post /api/mcp",
]);

/**
 * Raw-body spreads that are reviewed. Every entry must still match a real
 * site (a stale entry fails), and every entry says why it is here.
 */
const REVIEWED_RAW_BODY_SITES: Record<string, string> = {
  "server/routes-documents.ts post /api/documents/deed-of-trust":
    "renders a PDF from the body; nothing is persisted",
  "server/routes-documents.ts post /api/documents/land-contract":
    "renders a PDF from the body; nothing is persisted",
  "server/routes-deals.ts post /api/deals/:id/offer-letter-pdf":
    "renders a PDF from the body; nothing is persisted",
  "server/routes-analytics.ts post /api/offers/batch":
    "createOfferBatch inserts named fields only and takes the org from the server",
  "server/routes-deals.ts put /api/checklist-templates/:id":
    "updateChecklistTemplate strips protected fields (omitProtectedFields) before the write",
  "server/index.ts post /mcp :: handleRequest":
    "the MCP transport reads a JSON-RPC message; it is not a row",
  "server/routes-billing.ts post /api/stripe/connect/webhook :: constructEvent":
    "signature verification of the raw webhook payload; nothing is written from the body",
  "server/stripeWebhookRoute.ts post /api/stripe/webhook :: processWebhook":
    "the signature-verified provider payload, not a customer-supplied row",
  "server/routes-sendgrid-events.ts post /api/webhooks/sendgrid/events :: ingestSendGridEvents":
    "the signature-verified provider event batch, not a customer-supplied row",
  "server/routes-title-partners.ts post /api/webhooks/title-orders/:orderId/status :: stringify":
    "serialised only to verify the HMAC signature",
  "server/routes/lob-webhooks.ts post /api/webhooks/lob :: readLobEvent":
    "readLobEvent extracts four named event fields; it returns no body field whole",
  "server/routes-deals.ts post /api/deals :: validateOfferAmounts":
    "a validator; returns an error message or null and writes nothing",
  "server/routes-deals.ts put /api/deals/:id :: validateOfferAmounts":
    "a validator; returns an error message or null and writes nothing",
  "server/routes-leads.ts post /api/leads :: refuseUnpermittedAssignment":
    "an authority check on the named assignee; writes nothing",
  "server/routes-leads.ts put /api/leads/:id :: refuseUnpermittedAssignment":
    "an authority check on the named assignee; writes nothing",
  "server/routes-onboarding.ts patch /progress :: withoutOrgLevelKeys":
    "removes org-level keys; the result is merged into the onboardingData jsonb, never into row columns",
  "server/routes-acquisition-radar.ts post /score :: scoreParcel":
    "computes a score from the parcel fields; persists nothing",
  "server/routes-avm.ts post /generate :: generateValuation":
    "computes a valuation from named inputs; the org comes from the server",
  "server/routes-crm-extras.ts post /api/ai/generate-letter :: generateOfferLetter":
    "generates text; persists nothing",
  "server/routes-crm-extras.ts post /api/ai/generate-offer :: generateOfferSuggestions":
    "generates suggestions; persists nothing",
  "server/routes-crm-extras.ts post /api/ai/predict-acceptance :: predictAcceptanceProbability":
    "computes a prediction; persists nothing",
  "server/routes-data-intelligence.ts post /county-score :: scoreCounty":
    "a pure scoring function; persists nothing",
  "server/routes-data-intelligence.ts post /opportunity-score :: calculateOpportunityScore":
    "a pure scoring function; persists nothing",
  "server/routes-deal-underwriting.ts post /analyze :: analyzeScenarios":
    "computes scenarios from named inputs; the org comes from the server",
  "server/routes-epic-services.ts post /financial/deal-pnl :: calculateDealPnL":
    "a pure calculation; persists nothing",
  "server/routes-epic-services.ts post /seller-motivation/score :: computeSellerMotivationScore":
    "a pure scoring function; persists nothing",
  "server/routes-acquisition-radar.ts post /score :: saveOpportunityScore":
    "inserts named columns; organizationId is the server's argument",
  "server/routes-avm.ts post /record-transaction :: recordTransactionForTraining":
    "inserts named, anonymised columns; the contributor org is the server's argument",
  "server/routes-capital-markets.ts post /lenders :: addLender":
    "inserts named columns; organizationId is the server's argument",
  "server/routes-capital-markets.ts post /raises :: createCapitalRaise":
    "inserts named columns; organizationId is the server's argument and the status and totals are fixed",
  "server/routes-market-watchlist.ts patch /:id :: updateEntry":
    "the service checks the entry's org, drops the owner and last-alert fields, and sets named columns only",
  "server/routes-marketplace.ts post /listings :: createListing":
    "inserts named columns; the seller org, status and premium placement are set by the server",
  "server/routes-notifications.ts put /preferences :: updatePreferences":
    "writes five named preference keys into the caller's own notificationPrefs",
  "server/routes-white-label.ts post /tenants :: createTenant":
    "inserts named branding and feature columns; commercial terms (revenue share, limits, plan) are platform defaults",
  "server/routes-white-label.ts patch /config :: updateConfig":
    "sets named branding and feature columns of the caller's own config; commercial terms are not written",
  "server/routes-ai-operations.ts post /buyer-matching/profile :: createBuyerProfile":
    "validateRequest replaces the body with a closed local schema's output; the service takes the org from the server",
  "server/routes-ai-operations.ts post /cashflow/forecast :: generateForecast":
    "validateRequest replaces the body with a closed local schema's output; computes a forecast",
  "server/routes-ai-operations.ts post /compliance/rules :: addRule":
    "validateRequest replaces the body with a closed local schema's output; addRule inserts named columns",
  "server/routes-ai-operations.ts post /documents/analyze :: uploadDocument":
    "validateRequest replaces the body with a closed local schema's output; the service takes the org from the server",
  "server/routes-ai-operations.ts post /sequences/performance :: recordMessagePerformance":
    "validateRequest replaces the body with a closed local schema's output; the service takes the org from the server",
  "server/routes-ai-operations.ts post /voice/record :: recordCall":
    "validateRequest replaces the body with a closed local schema's output; the service takes the org from the server",
  "server/routes-founder-intelligence.ts post /experiments :: createExperiment":
    "founder-only (requireFounder); inserts named columns",
  "server/routes-founder-real-runtime.ts post /api/founder/v12/integrations/credentials :: registerCredential":
    "founder-only (/api/founder/v12 gate); inserts named columns",
  "server/routes-founder-real-runtime.ts post /api/founder/v12/verification/contracts :: createContract":
    "founder-only (/api/founder/v12 gate); inserts named columns",
  "server/routes-founder-real-runtime.ts post /api/founder/v12/versions :: createVersion":
    "founder-only (/api/founder/v12 gate); inserts named columns",
  "server/routes-founder-self-running-company.ts post /api/founder/v14/autonomy/dependency-events :: recordDependencyEvent":
    "founder-only (/api/founder/v14 gate); inserts named columns",
  "server/routes-founder-self-running-company.ts post /api/founder/v14/cascade/resolve :: resolve":
    "founder-only (/api/founder/v14 gate); inserts named columns",
  "server/routes-founder-self-running-company.ts post /api/founder/v14/overrides :: recordOverride":
    "founder-only (/api/founder/v14 gate); inserts named columns",
};

/**
 * A reviewed entry is either a whole registration (`<file> <method> <route>`)
 * or one callee within it (`<file> <method> <route> :: <callee>`). The narrow
 * form is preferred: a new raw-body call added to a reviewed handler is then a
 * new finding rather than inheriting the handler's review.
 */
function reviewedEntryMatches(entry: string, finding: string): boolean {
  const [regKey, callee] = entry.split(" :: ");
  if (!finding.startsWith(regKey + " @")) return false;
  return callee === undefined || finding.endsWith(` whole to ${callee}`);
}

/**
 * Functions that may take the raw body whole because what they return no
 * longer carries any server-owned field. Each is named with the module that
 * exports it; the gate checks the export still exists, so a rename cannot
 * leave a dead name here that silently exempts a new function of that name.
 */
const SANITIZERS: Record<string, { module: string; reason: string }> = {
  omitServerOwnedFields: {
    module: "server/utils/updatePayload.ts",
    reason: "strips the canonical server-owned list (shared/contracts/serverOwnedFields.ts)",
  },
  omitProtectedFields: {
    module: "server/utils/updatePayload.ts",
    reason: "strips identity, tenancy and audit columns",
  },
  stripServerOwnedFields: {
    module: "shared/contracts/serverOwnedFields.ts",
    reason: "the canonical server-owned strip itself",
  },
  investorProfileEdits: {
    module: "server/services/marketplace.ts",
    reason: "keeps only the customer-editable investor-profile columns (an allowlist)",
  },
};

/**
 * Built-ins that read a body's SHAPE and return none of its values. Matched on
 * the whole callee, so a function of the same short name elsewhere is not
 * exempt.
 */
const INSPECTION_CALLS = new Set(["Object.keys", "Array.isArray", "Buffer.isBuffer"]);

/**
 * Per-schema valid bodies, for a member the sample generator cannot satisfy
 * (a cross-field refinement, say). A member with neither a generated nor a
 * fixture body FAILS — it is never skipped.
 */
const FIXTURES: Record<string, Record<string, unknown>> = {};

/* ────────────────────────────────────────────────────────────────────────────
 * Population of route files.
 * ──────────────────────────────────────────────────────────────────────────── */

function walkTs(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (e === "node_modules" || e === "dist") continue;
    const abs = path.join(dir, e);
    if (statSync(abs).isDirectory()) walkTs(abs, out);
    else if (/\.ts$/.test(e) && !/\.test\.ts$/.test(e) && !/\.d\.ts$/.test(e)) out.push(abs);
  }
  return out;
}

/**
 * The population is DERIVED, not listed: every non-test file under server/
 * whose syntax tree registers a write route. (A fixed list of route-file
 * globs missed server/api-v1/ the first time this gate ran.) The regex is
 * only a cheap prefilter; membership is decided by the parse.
 */
function routeFiles(): string[] {
  return walkTs(path.join(ROOT, "server")).filter((abs) => {
    if (!/\.(post|put|patch)\s*\(/.test(readFileSync(abs, "utf8"))) return false;
    return writeRegistrations(parseFile(abs), rel(abs)).regs.length > 0;
  });
}

const parseCache = new Map<string, ts.SourceFile>();
function parseFile(abs: string): ts.SourceFile {
  let sf = parseCache.get(abs);
  if (!sf) {
    sf = ts.createSourceFile(abs, readFileSync(abs, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    parseCache.set(abs, sf);
  }
  return sf;
}

const rel = (abs: string) => path.relative(ROOT, abs).split(path.sep).join("/");

/* ────────────────────────────────────────────────────────────────────────────
 * Syntax helpers.
 * ──────────────────────────────────────────────────────────────────────────── */

function unwrap(e: ts.Node): ts.Node {
  let cur = e;
  for (;;) {
    if (
      ts.isParenthesizedExpression(cur) ||
      ts.isAsExpression(cur) ||
      ts.isNonNullExpression(cur) ||
      ts.isSatisfiesExpression(cur) ||
      ts.isTypeAssertionExpression(cur) ||
      ts.isAwaitExpression(cur)
    ) {
      cur = cur.expression;
      continue;
    }
    return cur;
  }
}

/** The node an expression's value flows into, skipping wrappers. */
function consumerOf(n: ts.Node): ts.Node {
  let cur = n;
  while (
    cur.parent &&
    (ts.isParenthesizedExpression(cur.parent) ||
      ts.isAsExpression(cur.parent) ||
      ts.isNonNullExpression(cur.parent) ||
      ts.isSatisfiesExpression(cur.parent) ||
      ts.isTypeAssertionExpression(cur.parent))
  ) {
    cur = cur.parent;
  }
  return cur;
}

function isFunctionLike(n: ts.Node): n is ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration {
  return ts.isArrowFunction(n) || ts.isFunctionExpression(n) || ts.isFunctionDeclaration(n);
}

function dynamicImportSpecifier(e: ts.Node): string | null {
  const u = unwrap(e);
  if (
    ts.isCallExpression(u) &&
    u.expression.kind === ts.SyntaxKind.ImportKeyword &&
    u.arguments.length === 1 &&
    ts.isStringLiteralLike(u.arguments[0])
  ) {
    return u.arguments[0].text;
  }
  return null;
}

function resolveShared(spec: string, fromFile: string): string | null {
  let abs: string;
  if (spec === "@shared" || spec.startsWith("@shared/")) abs = path.join(SHARED_DIR, spec.slice("@shared".length));
  else if (spec.startsWith(".")) abs = path.resolve(path.dirname(fromFile), spec);
  else return null;
  if (abs !== SHARED_DIR && !abs.startsWith(SHARED_DIR + path.sep)) return null;
  for (const c of [abs + ".ts", path.join(abs, "index.ts"), abs]) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return null;
}

type SharedBinding = { mod: string; name: string }; // name "*" = namespace

/** Local name → shared export, from static AND dynamic imports anywhere in the file. */
function sharedBindings(sf: ts.SourceFile, resolve: (spec: string) => string | null): Map<string, SharedBinding> {
  const out = new Map<string, SharedBinding>();
  const visit = (n: ts.Node) => {
    if (ts.isImportDeclaration(n) && n.importClause && !n.importClause.isTypeOnly) {
      const mod = resolve((n.moduleSpecifier as ts.StringLiteral).text);
      const nb = n.importClause.namedBindings;
      if (mod && nb && ts.isNamedImports(nb)) {
        for (const el of nb.elements) {
          if (!el.isTypeOnly) out.set(el.name.text, { mod, name: (el.propertyName ?? el.name).text });
        }
      }
      if (mod && nb && ts.isNamespaceImport(nb)) out.set(nb.name.text, { mod, name: "*" });
    }
    if (ts.isVariableDeclaration(n) && n.initializer) {
      const spec = dynamicImportSpecifier(n.initializer);
      const mod = spec ? resolve(spec) : null;
      if (mod && ts.isObjectBindingPattern(n.name)) {
        for (const el of n.name.elements) {
          if (!ts.isIdentifier(el.name) || el.dotDotDotToken) continue;
          const exported = el.propertyName && ts.isIdentifier(el.propertyName) ? el.propertyName.text : el.name.text;
          out.set(el.name.text, { mod, name: exported });
        }
      }
      if (mod && ts.isIdentifier(n.name)) out.set(n.name.text, { mod, name: "*" });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

type Registration = {
  file: string;
  method: string;
  route: string;
  key: string;
  bodies: ts.Node[];
  bodyParams: Set<string>;
};

/** Every `<x>.post|put|patch("/path", ...handlers)` in the file. */
function writeRegistrations(sf: ts.SourceFile, file: string): { regs: Registration[]; outOfFile: string[] } {
  const fns = new Map<string, ts.Node>();
  const collect = (n: ts.Node) => {
    if (ts.isFunctionDeclaration(n) && n.name) fns.set(n.name.text, n);
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && isFunctionLike(unwrap(n.initializer))) {
      fns.set(n.name.text, unwrap(n.initializer));
    }
    ts.forEachChild(n, collect);
  };
  collect(sf);

  const regs: Registration[] = [];
  const outOfFile: string[] = [];
  const visit = (n: ts.Node) => {
    if (
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      WRITE_METHODS.has(n.expression.name.text) &&
      n.arguments.length >= 2 &&
      ts.isStringLiteralLike(n.arguments[0]) &&
      n.arguments[0].text.startsWith("/")
    ) {
      const method = n.expression.name.text;
      const route = n.arguments[0].text;
      const key = `${file} ${method} ${route}`;
      const bodies: ts.Node[] = [];
      let hasHandler = false;
      for (const arg of n.arguments.slice(1)) {
        bodies.push(arg);
        const u = unwrap(arg);
        if (ts.isIdentifier(u) && fns.has(u.text)) {
          bodies.push(fns.get(u.text)!);
          hasHandler = true;
        }
        const findFn = (x: ts.Node) => {
          if (isFunctionLike(x)) hasHandler = true;
          else ts.forEachChild(x, findFn);
        };
        findFn(arg);
      }
      if (!hasHandler) outOfFile.push(key);
      const bodyParams = new Set<string>();
      const params = (x: ts.Node) => {
        if (isFunctionLike(x) && x.parameters.length > 0 && ts.isIdentifier(x.parameters[0].name)) {
          bodyParams.add(x.parameters[0].name.text);
        }
        ts.forEachChild(x, params);
      };
      bodies.forEach(params);
      regs.push({ file, method, route, key, bodies, bodyParams });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return { regs, outOfFile };
}

/** The method spine of a schema expression: root identifier + calls from root outward. */
function spineOf(e: ts.Node): { root: string | null; calls: { name: string; call: ts.CallExpression }[] } {
  const calls: { name: string; call: ts.CallExpression }[] = [];
  let cur = unwrap(e);
  for (;;) {
    if (ts.isCallExpression(cur) && ts.isPropertyAccessExpression(cur.expression)) {
      calls.unshift({ name: cur.expression.name.text, call: cur });
      cur = unwrap(cur.expression.expression);
      continue;
    }
    if (ts.isPropertyAccessExpression(cur)) {
      cur = unwrap(cur.expression);
      continue;
    }
    break;
  }
  return { root: ts.isIdentifier(cur) ? cur.text : null, calls };
}

function omitsKey(calls: { name: string; call: ts.CallExpression }[], key: string): boolean {
  return calls.some(
    ({ name, call }) =>
      name === "omit" &&
      call.arguments.length > 0 &&
      ts.isObjectLiteralExpression(unwrap(call.arguments[0])) &&
      (unwrap(call.arguments[0]) as ts.ObjectLiteralExpression).properties.some(
        (p) => (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) && p.name.getText() === key,
      ),
  );
}

type LocalSchema = { name: string; decl: ts.VariableDeclaration; root: string; calls: { name: string; call: ts.CallExpression }[] };

/** `const X = <zod expression>` anywhere in the file, rooted at `z` or a shared/local schema. */
function localSchemas(sf: ts.SourceFile, bindings: Map<string, SharedBinding>): Map<string, LocalSchema[]> {
  const raw: LocalSchema[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) {
      const { root, calls } = spineOf(n.initializer);
      if (root && calls.length > 0 && !PARSE_METHODS.has(calls[calls.length - 1].name) && !calls.some((c) => PARSE_METHODS.has(c.name))) {
        raw.push({ name: n.name.text, decl: n, root, calls });
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  const out = new Map<string, LocalSchema[]>();
  const isSchemaRoot = (root: string, seen: Set<string>): boolean => {
    if (root === "z") return true;
    if (bindings.has(root)) return true;
    if (seen.has(root)) return false;
    seen.add(root);
    return raw.some((r) => r.name === root && isSchemaRoot(r.root, seen));
  };
  for (const r of raw) {
    if (!isSchemaRoot(r.root, new Set([r.name]))) continue;
    if (!out.has(r.name)) out.set(r.name, []);
    out.get(r.name)!.push(r);
  }
  return out;
}

/** Is `n` a reference (not a declaration name / property name / binding) to identifier text? */
function isReference(id: ts.Identifier): boolean {
  const p = id.parent;
  if (ts.isPropertyAccessExpression(p) && p.name === id) return false;
  if ((ts.isPropertyAssignment(p) || ts.isPropertyDeclaration(p) || ts.isMethodDeclaration(p)) && p.name === id) return false;
  if (ts.isBindingElement(p) || ts.isVariableDeclaration(p) || ts.isParameter(p)) return false;
  if (ts.isImportSpecifier(p) || ts.isNamespaceImport(p) || ts.isImportClause(p)) return false;
  return true;
}

type Site = { file: string; route: string; line: number; ref: ts.Node; extraCalls: { name: string; call: ts.CallExpression }[] };

/** Climb from a schema reference to the parse call it feeds, collecting the spine in between. */
function parseCallFor(ref: ts.Node): { parseCall: ts.CallExpression | null; calls: { name: string; call: ts.CallExpression }[] } {
  const calls: { name: string; call: ts.CallExpression }[] = [];
  let cur: ts.Node = ref;
  for (;;) {
    const p = cur.parent;
    if (!p) return { parseCall: null, calls };
    if (ts.isPropertyAccessExpression(p) && p.expression === cur) {
      const gp = p.parent;
      if (ts.isCallExpression(gp) && gp.expression === p) {
        if (PARSE_METHODS.has(p.name.text)) return { parseCall: gp, calls };
        calls.push({ name: p.name.text, call: gp });
        cur = gp;
        continue;
      }
      cur = p;
      continue;
    }
    if (ts.isParenthesizedExpression(p) || ts.isAsExpression(p) || ts.isNonNullExpression(p)) {
      cur = p;
      continue;
    }
    return { parseCall: null, calls };
  }
}

/** The parse argument puts a server-side `organizationId` AFTER every spread of request data. */
function serverComposesTenantKey(parseCall: ts.CallExpression | null): boolean {
  if (!parseCall || parseCall.arguments.length === 0) return false;
  const arg = unwrap(parseCall.arguments[0]);
  if (!ts.isObjectLiteralExpression(arg)) return false;
  let lastSpread = -1;
  let org = -1;
  arg.properties.forEach((p, i) => {
    if (ts.isSpreadAssignment(p)) lastSpread = i;
    if ((ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) && p.name.getText() === "organizationId") {
      const init = ts.isPropertyAssignment(p) ? p.initializer.getText() : p.name.getText();
      org = /\b(req|request)\.(body|query|params)\b/.test(init) ? -2 : i;
    }
  });
  return org >= 0 && org > lastSpread;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Population 1 + 2: schemas referenced by POST handlers.
 * ──────────────────────────────────────────────────────────────────────────── */

type SharedMember = { key: string; mod: string; name: string; prop: string | null; sites: Site[] };

function schemaReferences(
  sf: ts.SourceFile,
  file: string,
  regs: Registration[],
  resolve: (spec: string) => string | null,
): { shared: Map<string, SharedMember>; locals: { local: LocalSchema; site: Site }[] } {
  const bindings = sharedBindings(sf, resolve);
  const locals = localSchemas(sf, bindings);
  const shared = new Map<string, SharedMember>();
  const localHits: { local: LocalSchema; site: Site }[] = [];

  const addShared = (mod: string, name: string, prop: string | null, site: Site) => {
    const key = `${rel(mod)}#${name}${prop ? "." + prop : ""}`;
    if (!shared.has(key)) shared.set(key, { key, mod, name, prop, sites: [] });
    shared.get(key)!.sites.push(site);
  };

  for (const reg of regs.filter((r) => r.method === "post")) {
    const seen = new Set<ts.Node>();
    const visit = (n: ts.Node) => {
      if (seen.has(n)) return;
      seen.add(n);
      const line = sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;
      // `(await import("@shared/x")).name`
      if (ts.isPropertyAccessExpression(n)) {
        const spec = dynamicImportSpecifier(n.expression);
        const mod = spec ? resolve(spec) : null;
        if (mod) addShared(mod, n.name.text, null, { file, route: reg.route, line, ref: n, extraCalls: [] });
      }
      if (ts.isIdentifier(n) && isReference(n)) {
        const b = bindings.get(n.text);
        if (b) {
          let ref: ts.Node = n;
          let name = b.name;
          if (name === "*") {
            if (ts.isPropertyAccessExpression(n.parent) && n.parent.expression === n) {
              name = n.parent.name.text;
              ref = n.parent;
            } else name = "";
          }
          if (name) {
            // A contract is read through its `.requestSchema`.
            let prop: string | null = null;
            if (ts.isPropertyAccessExpression(ref.parent) && ref.parent.expression === ref) {
              const pn = ref.parent.name.text;
              if (pn === "requestSchema" || pn === "responseSchema") {
                prop = pn;
                ref = ref.parent;
              }
            }
            if (prop !== "responseSchema") addShared(b.mod, name, prop, { file, route: reg.route, line, ref, extraCalls: [] });
          }
        }
        const ls = locals.get(n.text);
        if (ls) {
          for (const local of ls) {
            localHits.push({ local, site: { file, route: reg.route, line, ref: n, extraCalls: local.calls } });
            // The shared base of a locally derived schema is a member too.
            const base = bindings.get(local.root);
            if (base && base.name !== "*") {
              addShared(base.mod, base.name, null, { file, route: reg.route, line, ref: n, extraCalls: local.calls });
            }
          }
        }
      }
      ts.forEachChild(n, visit);
    };
    reg.bodies.forEach(visit);
  }
  return { shared, locals: localHits };
}

/* ────────────────────────────────────────────────────────────────────────────
 * Population 3: raw request bodies reaching a row writer.
 * ──────────────────────────────────────────────────────────────────────────── */

function rawBodyFindings(sf: ts.SourceFile, reg: Registration): string[] {
  const findings: string[] = [];
  const aliases = new Set<string>();
  const isRaw = (e: ts.Node): boolean => {
    const u = unwrap(e);
    if (ts.isBinaryExpression(u) && (u.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken || u.operatorToken.kind === ts.SyntaxKind.BarBarToken)) {
      return isRaw(u.left);
    }
    if (ts.isPropertyAccessExpression(u) && u.name.text === "body" && ts.isIdentifier(u.expression) && reg.bodyParams.has(u.expression.text)) return true;
    if (ts.isIdentifier(u) && aliases.has(u.text)) return true;
    if (ts.isObjectLiteralExpression(u) && u.properties.length > 0 && u.properties.every((p) => ts.isSpreadAssignment(p))) {
      return u.properties.some((p) => isRaw((p as ts.SpreadAssignment).expression));
    }
    return false;
  };
  // Pass 1: aliases (including a rest element destructured from the body).
  const collect = (n: ts.Node) => {
    if (ts.isVariableDeclaration(n) && n.initializer && isRaw(n.initializer)) {
      if (ts.isIdentifier(n.name)) aliases.add(n.name.text);
      if (ts.isObjectBindingPattern(n.name)) {
        for (const el of n.name.elements) if (el.dotDotDotToken && ts.isIdentifier(el.name)) aliases.add(el.name.text);
      }
    }
    ts.forEachChild(n, collect);
  };
  // Aliases chain (`const a = req.body; const b = { ...a }`), so iterate to a fixed point.
  for (let i = 0, before = -1; i < 5 && before !== aliases.size; i++) {
    before = aliases.size;
    reg.bodies.forEach(collect);
  }
  const where = (n: ts.Node) => `${reg.key} @${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}`;
  const isParseCall = (c: ts.Node): boolean =>
    ts.isCallExpression(c) && ts.isPropertyAccessExpression(c.expression) && PARSE_METHODS.has(c.expression.name.text);
  // A raw body handed WHOLE to any call is a finding unless the callee is a
  // schema parse or a named sanitizer. A row writer is not the only way the
  // body's fields reach a row: a service method that spreads its argument
  // into `.set()` is just as much a writer, and it lives in another file.
  const calleeName = (c: ts.CallExpression): string | null => {
    const e = unwrap(c.expression);
    if (ts.isIdentifier(e)) return e.text;
    if (ts.isPropertyAccessExpression(e)) return e.name.text;
    return null;
  };
  const isSanitizingCall = (c: ts.CallExpression): boolean => {
    if (INSPECTION_CALLS.has(c.expression.getText())) return true;
    const name = calleeName(c);
    return name !== null && (PARSE_METHODS.has(name) || name in SANITIZERS);
  };
  // Pass 2: where the body's fields flow.
  const visit = (n: ts.Node) => {
    if (ts.isSpreadAssignment(n) && isRaw(n.expression)) {
      const lit = consumerOf(n.parent);
      const consumer = lit.parent;
      const ok =
        (consumer && isParseCall(consumer) && (consumer as ts.CallExpression).arguments.includes(lit as ts.Expression)) ||
        (consumer && ts.isVariableDeclaration(consumer) && consumer.initializer === lit);
      if (!ok) findings.push(`${where(n)} spreads the request body into ${consumer ? ts.SyntaxKind[consumer.kind] : "?"}`);
    }
    if (ts.isCallExpression(n) && !isSanitizingCall(n)) {
      // An object literal is judged by its spreads, above; this is the body
      // (or an alias of it) passed as the argument itself.
      for (const a of n.arguments) {
        if (!ts.isObjectLiteralExpression(unwrap(a)) && isRaw(a)) {
          findings.push(`${where(a)} hands the request body whole to ${calleeName(n) ?? "a call"}`);
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  reg.bodies.forEach(visit);
  return findings;
}

/* ────────────────────────────────────────────────────────────────────────────
 * A minimal valid body for a zod (v4) schema: built from its definition, with
 * every leaf checked against the leaf schema itself.
 * ──────────────────────────────────────────────────────────────────────────── */

type ZodLike = { _zod: { def: any }; safeParse: (v: unknown) => { success: boolean; data?: unknown; error?: any } };
const isZod = (v: unknown): v is ZodLike =>
  !!v && typeof v === "object" && "_zod" in (v as object) && typeof (v as ZodLike).safeParse === "function";

const LEAF_CANDIDATES: unknown[] = [
  "probe-value",
  "a@example.com",
  "https://example.com",
  "00000000-0000-4000-8000-000000000000",
  "2024-01-02T03:04:05.000Z",
  "2024-01-02",
  "AZ",
  "12345",
  "1",
  1,
  0,
  10,
  100,
  1000,
  1.5,
  true,
  false,
  new Date("2024-01-02T03:04:05.000Z"),
  [],
  {},
  null,
];

function sample(schema: ZodLike, depth = 0): { ok: boolean; value?: unknown } {
  if (depth > 12) return { ok: false };
  const def = schema._zod.def;
  const check = (value: unknown) => (schema.safeParse(value).success ? { ok: true, value } : { ok: false });
  switch (def.type) {
    case "optional":
    case "default":
    case "prefault":
    case "catch":
    case "readonly":
    case "nonoptional":
      return sample(def.innerType, depth + 1);
    case "nullable": {
      const inner = sample(def.innerType, depth + 1);
      return inner.ok ? inner : { ok: true, value: null };
    }
    case "lazy":
      return sample(def.getter(), depth + 1);
    case "object": {
      const value: Record<string, unknown> = {};
      for (const [k, child] of Object.entries(def.shape as Record<string, ZodLike>)) {
        if (child.safeParse(undefined).success) continue;
        const s = sample(child, depth + 1);
        if (!s.ok) return { ok: false };
        value[k] = s.value;
      }
      return check(value);
    }
    case "pipe": {
      for (const side of [def.out, def.in]) {
        const s = sample(side, depth + 1);
        if (s.ok && schema.safeParse(s.value).success) return s;
      }
      break;
    }
    case "union": {
      for (const opt of def.options as ZodLike[]) {
        const s = sample(opt, depth + 1);
        if (s.ok && schema.safeParse(s.value).success) return s;
      }
      break;
    }
    case "intersection": {
      const l = sample(def.left, depth + 1);
      const r = sample(def.right, depth + 1);
      if (l.ok && r.ok) {
        const merged =
          l.value && r.value && typeof l.value === "object" && typeof r.value === "object"
            ? { ...(l.value as object), ...(r.value as object) }
            : l.value;
        return check(merged);
      }
      break;
    }
    case "array": {
      const el = sample(def.element, depth + 1);
      if (el.ok && schema.safeParse([el.value]).success) return { ok: true, value: [el.value] };
      return check([]);
    }
    case "tuple": {
      const items = (def.items as ZodLike[]).map((i) => sample(i, depth + 1));
      if (items.every((i) => i.ok)) return check(items.map((i) => i.value));
      break;
    }
    case "record":
      return check({});
    case "literal":
      return check((def.values as unknown[])[0]);
    case "enum":
      return check(Object.values(def.entries as Record<string, unknown>)[0]);
    default:
      break;
  }
  for (const c of LEAF_CANDIDATES) if (schema.safeParse(c).success) return { ok: true, value: c };
  return { ok: false };
}

/* ────────────────────────────────────────────────────────────────────────────
 * The probe verdict for one schema.
 * ──────────────────────────────────────────────────────────────────────────── */

type KeyOutcome = "dropped" | "refused" | "taken" | "broken";

function probeKey(schema: ZodLike, valid: Record<string, unknown>, key: string): { outcome: KeyOutcome; detail: string } {
  const r = schema.safeParse({ ...valid, [key]: PROBE[key] });
  if (r.success) {
    const out = (r.data ?? {}) as Record<string, unknown>;
    if (key in out && out[key] !== undefined) return { outcome: "taken", detail: `output.${key} = ${JSON.stringify(out[key])}` };
    return { outcome: "dropped", detail: "" };
  }
  const issues = (r.error?.issues ?? []) as Array<{ path: PropertyKey[] }>;
  if (issues.length > 0 && issues.every((i) => i.path[0] === key)) return { outcome: "refused", detail: "" };
  return { outcome: "broken", detail: `refused for another reason: ${JSON.stringify(issues).slice(0, 300)}` };
}

function probeAll(schema: ZodLike, valid: Record<string, unknown>): string[] {
  const r = schema.safeParse({ ...valid, ...PROBE });
  if (!r.success) {
    const issues = (r.error?.issues ?? []) as Array<{ path: PropertyKey[] }>;
    const stray = issues.filter((i) => !PROBE_KEYS.includes(String(i.path[0])));
    return stray.length ? [`combined probe refused for another reason: ${JSON.stringify(stray).slice(0, 300)}`] : [];
  }
  const out = (r.data ?? {}) as Record<string, unknown>;
  return PROBE_KEYS.filter((k) => k !== "organizationId" && k in out && out[k] !== undefined).map(
    (k) => `combined probe kept ${k}`,
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * Assemble the populations once.
 * ──────────────────────────────────────────────────────────────────────────── */

type Populations = {
  files: string[];
  regs: Registration[];
  outOfFile: string[];
  shared: Map<string, SharedMember>;
  locals: { local: LocalSchema; site: Site }[];
  rawFindings: string[];
  sourceFiles: Map<string, ts.SourceFile>;
};

let memo: Populations | null = null;
function populations(): Populations {
  if (memo) return memo;
  const files = routeFiles();
  const regs: Registration[] = [];
  const outOfFile: string[] = [];
  const shared = new Map<string, SharedMember>();
  const locals: { local: LocalSchema; site: Site }[] = [];
  const rawFindings: string[] = [];
  const sourceFiles = new Map<string, ts.SourceFile>();
  for (const abs of files) {
    const sf = parseFile(abs);
    const file = rel(abs);
    sourceFiles.set(file, sf);
    const r = writeRegistrations(sf, file);
    regs.push(...r.regs);
    outOfFile.push(...r.outOfFile);
    const refs = schemaReferences(sf, file, r.regs, (spec) => resolveShared(spec, abs));
    for (const [k, m] of refs.shared) {
      if (!shared.has(k)) shared.set(k, { ...m, sites: [] });
      shared.get(k)!.sites.push(...m.sites);
    }
    locals.push(...refs.locals);
    for (const reg of r.regs) rawFindings.push(...rawBodyFindings(sf, reg));
  }
  memo = { files, regs, outOfFile, shared, locals, rawFindings, sourceFiles };
  return memo;
}

async function loadMember(m: SharedMember): Promise<ZodLike | null> {
  const mod = await import(m.mod);
  const v = mod[m.name];
  if (m.prop) return isZod(v?.[m.prop]) ? v[m.prop] : null;
  if (isZod(v)) return v;
  if (v && isZod(v.requestSchema)) return v.requestSchema;
  return null;
}

/* ────────────────────────────────────────────────────────────────────────────
 * The gate.
 * ──────────────────────────────────────────────────────────────────────────── */

describe("request schemas never carry server-owned fields", () => {
  it("reads every file that registers a write route, and every handler in them", () => {
    const { files, regs, outOfFile } = populations();
    expect(files.length).toBeGreaterThanOrEqual(ROUTE_FILE_FLOOR);
    expect(regs.length).toBeGreaterThanOrEqual(WRITE_REGISTRATION_FLOOR);
    // The conventional route files are all inside the derived population — if
    // one is missing, the registration extractor stopped reading it.
    const members = new Set(files.map(rel));
    const conventional = readdirSync(path.join(ROOT, "server"))
      .filter((e) => /^routes-.*\.ts$/.test(e) && !/\.test\.ts$/.test(e))
      .map((e) => `server/${e}`)
      .filter((f) => /\.(post|put|patch)\s*\(\s*["'`]\//.test(readFileSync(path.join(ROOT, f), "utf8")));
    expect(conventional.filter((f) => !members.has(f)), "route files the extractor found no registration in").toEqual([]);
    expect(new Set(outOfFile)).toEqual(OUT_OF_FILE_HANDLERS);
  });

  it("every shared schema a POST handler parses refuses or drops each server-owned field", async () => {
    const { shared } = populations();
    expect(shared.size).toBeGreaterThanOrEqual(SHARED_SCHEMA_MEMBER_FLOOR);

    const failures: string[] = [];
    let parsed = 0;
    let zodMembers = 0;
    for (const m of [...shared.values()].sort((a, b) => a.key.localeCompare(b.key))) {
      const schema = await loadMember(m);
      if (!schema) continue; // a table, a constant, a function — not a schema
      zodMembers++;
      const valid = (FIXTURES[m.key] ?? sample(schema).value) as Record<string, unknown> | undefined;
      if (!valid || typeof valid !== "object" || !schema.safeParse(valid).success) {
        failures.push(`${m.key}: no valid body could be built — add one to FIXTURES`);
        continue;
      }
      parsed++;
      for (const key of PROBE_KEYS) {
        const { outcome, detail } = probeKey(schema, valid, key);
        if (outcome === "broken") failures.push(`${m.key}: ${key} probe ${detail}`);
        if (outcome !== "taken") continue;
        if (key !== "organizationId") {
          failures.push(`${m.key}: takes the request's ${key} (${detail})`);
          continue;
        }
        // The tenant key may sit in a schema's output only when every POST
        // site composes it server-side, after the request's own fields.
        for (const site of m.sites) {
          const { parseCall, calls } = parseCallFor(site.ref);
          if (omitsKey([...site.extraCalls, ...calls], "organizationId")) continue;
          if (!serverComposesTenantKey(parseCall)) {
            failures.push(`${m.key}: ${site.file}:${site.line} (${site.route}) parses a request-supplied organizationId`);
          }
        }
      }
      failures.push(...probeAll(schema, valid).map((f) => `${m.key}: ${f}`));
    }
    expect(zodMembers).toBeGreaterThanOrEqual(SHARED_SCHEMA_MEMBER_FLOOR);
    expect(parsed, "every schema member must actually be parsed").toBe(zodMembers);
    expect(failures).toEqual([]);
  });

  it("no POST handler parses with a local schema that keeps unknown keys", () => {
    const { locals } = populations();
    const names = new Set(locals.map((l) => `${l.site.file}#${l.local.name}`));
    expect(names.size).toBeGreaterThanOrEqual(LOCAL_SCHEMA_MEMBER_FLOOR);
    const loose = locals
      .filter((l) => l.local.calls.some((c) => LOOSE_METHODS.has(c.name)))
      .map((l) => `${l.site.file}:${l.site.line} (${l.site.route}) ${l.local.name}`);
    expect(loose).toEqual([]);
  });

  it("no write handler spreads the raw request body anywhere but a schema parse", () => {
    const { rawFindings } = populations();
    const reviewed = Object.keys(REVIEWED_RAW_BODY_SITES);
    const unreviewed = rawFindings.filter((f) => !reviewed.some((k) => reviewedEntryMatches(k, f)));
    expect(unreviewed).toEqual([]);
    const stale = reviewed.filter((k) => !rawFindings.some((f) => reviewedEntryMatches(k, f)));
    expect(stale, "reviewed entries that no longer match a site — delete them").toEqual([]);
  });

  it("every named sanitizer is still exported by the module it names", () => {
    // Read from the syntax tree, so a comment naming the function does not count.
    const exported = (sf: ts.SourceFile): Set<string> => {
      const out = new Set<string>();
      for (const st of sf.statements) {
        const isExport = ts.canHaveModifiers(st) && ts.getModifiers(st)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
        if (!isExport) continue;
        if (ts.isFunctionDeclaration(st) && st.name) out.add(st.name.text);
        if (ts.isVariableStatement(st)) {
          for (const d of st.declarationList.declarations) if (ts.isIdentifier(d.name)) out.add(d.name.text);
        }
      }
      return out;
    };
    const missing = Object.entries(SANITIZERS)
      .filter(([, { module }]) => module)
      .filter(([name, { module }]) => !exported(parseFile(path.join(ROOT, module))).has(name))
      .map(([name, { module }]) => `${module} no longer exports ${name}`);
    expect(missing).toEqual([]);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * Canaries: each extraction shape the gate relies on, with the defect hidden
 * inside it. Each must be FOUND; a shape that stops being read goes red here.
 * ──────────────────────────────────────────────────────────────────────────── */

describe("canaries: the gate sees the shapes it claims to read", () => {
  const FAKE = path.join(ROOT, "server", "routes-canary.ts");
  const parse = (src: string) => ts.createSourceFile(FAKE, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const resolver = (spec: string) => resolveShared(spec, FAKE);

  const raw = (src: string) => {
    const sf = parse(src);
    const { regs } = writeRegistrations(sf, "server/routes-canary.ts");
    return regs.flatMap((r) => rawBodyFindings(sf, r));
  };

  it("an inline handler spreading the body into a repository call", () => {
    expect(raw(`api.post("/x", auth, async (req, res) => { await storage.createX({ ...req.body, organizationId: 1 }); });`)).toHaveLength(1);
  });
  it("the same, through a wrapper and a trailing comma", () => {
    expect(raw(`api.post("/x", asyncHandler(async (req, res) => { await storage.createX({ ...req.body, organizationId: 1 }); }),\n);`)).toHaveLength(1);
  });
  it("the same, in a sync handler with a renamed request parameter", () => {
    expect(raw(`router.put("/x", (request, res) => { db.update(t).set({ ...request.body }); });`)).toHaveLength(1);
  });
  it("the same, in a named handler defined elsewhere in the file", () => {
    expect(raw(`async function h(req, res) { await storage.createX({ ...req.body, organizationId: 1 }); }\napi.post("/x", auth, h);`)).toHaveLength(1);
  });
  it("the same, through an alias, a rest element and a nested transaction callback", () => {
    expect(raw(`api.post("/x", async (req, res) => { const b = req.body ?? {}; await db.transaction(async (tx) => { await tx.insert(t).values({ ...b }); }); });`)).toHaveLength(1);
    expect(raw(`api.patch("/x", async (req, res) => { const { userId, ...rest } = req.body; await db.update(t).set({ ...rest }); });`)).toHaveLength(1);
    expect(raw(`api.patch("/x", async (req, res) => { const u = { ...req.body }; await storage.updateX(1, u); });`)).toHaveLength(1);
  });
  it("the body handed whole to a service method, directly or through an alias", () => {
    expect(raw(`router.post("/x", async (req, res) => { await svc.updateProfile(org.id, req.body); });`)).toHaveLength(1);
    expect(raw(`router.post("/x", async (req, res) => { const data = req.body; await svc.updateProfile(org.id, data); });`)).toHaveLength(1);
    expect(raw(`router.post("/x", async (req, res) => { const { propertyId, ...data } = req.body; await svc.create(org.id, propertyId, data); });`)).toHaveLength(1);
    expect(raw(`router.post("/x", async (req, res) => { await helper(req.body || {}); });`)).toHaveLength(1);
  });
  it("a named sanitizer and a shape-only built-in are not findings; a same-named method elsewhere is", () => {
    expect(raw(`router.post("/x", async (req, res) => { await svc.updateProfile(org.id, investorProfileEdits(req.body)); });`)).toEqual([]);
    expect(raw(`router.put("/x", async (req, res) => { log(Object.keys(req.body)); if (Array.isArray(req.body)) return; });`)).toEqual([]);
    expect(raw(`router.put("/x", async (req, res) => { await svc.keys(req.body); });`)).toHaveLength(1);
  });
  it("a spread into a schema parse is not a finding", () => {
    expect(raw(`api.post("/x", async (req, res) => { const input = s.parse({ ...req.body, organizationId: 1 }); await storage.createX(input); });`)).toEqual([]);
  });

  const refs = (src: string) => {
    const sf = parse(src);
    const { regs } = writeRegistrations(sf, "server/routes-canary.ts");
    return schemaReferences(sf, "server/routes-canary.ts", regs, resolver);
  };

  it("finds shared schemas by static, dynamic, namespace and contract access, and through a local", () => {
    const r = refs(`
      import { insertLeadSchema } from "@shared/schema";
      import * as S from "@shared/schema";
      import { createLeadContract } from "@shared/contracts";
      const local = insertLeadSchema.partial();
      api.post("/a", async (req, res) => { insertLeadSchema.parse(req.body); });
      api.post("/b", async (req, res) => { const { insertDealSchema } = await import("@shared/schema"); insertDealSchema.parse(req.body); });
      api.post("/c", async (req, res) => { S.insertNoteSchema.parse(req.body); });
      api.post("/d", async (req, res) => { createLeadContract.requestSchema.safeParse(req.body); });
      api.post("/e", async (req, res) => { (await import("@shared/schema")).insertTaskSchema.parse(req.body); });
      api.post("/f", async (req, res) => { local.parse(req.body); });
    `);
    const keys = [...r.shared.keys()].sort();
    expect(keys).toEqual(
      [
        "shared/contracts/index.ts#createLeadContract.requestSchema",
        "shared/schema.ts#insertDealSchema",
        "shared/schema.ts#insertLeadSchema",
        "shared/schema.ts#insertNoteSchema",
        "shared/schema.ts#insertTaskSchema",
      ].sort(),
    );
    expect(r.locals.map((l) => l.local.name)).toContain("local");
  });

  it("tells a server-composed tenant key from a request-supplied one", () => {
    const site = (src: string) => {
      const sf = parse(`import { insertTaskSchema } from "@shared/schema";\napi.post("/x", async (req, res) => { ${src} });`);
      const { regs } = writeRegistrations(sf, "server/routes-canary.ts");
      const m = schemaReferences(sf, "server/routes-canary.ts", regs, resolver).shared.get("shared/schema.ts#insertTaskSchema")!;
      const { parseCall, calls } = parseCallFor(m.sites[0].ref);
      return omitsKey(calls, "organizationId") || serverComposesTenantKey(parseCall);
    };
    expect(site(`insertTaskSchema.parse({ ...req.body, organizationId: org.id });`)).toBe(true);
    expect(site(`insertTaskSchema.omit({ organizationId: true }).parse(req.body);`)).toBe(true);
    expect(site(`insertTaskSchema.parse({ organizationId: org.id, ...req.body });`)).toBe(false);
    expect(site(`insertTaskSchema.parse(req.body);`)).toBe(false);
    expect(site(`insertTaskSchema.parse({ ...req.body, organizationId: req.body.organizationId });`)).toBe(false);
  });

  it("a local schema that keeps unknown keys is seen", () => {
    const r = refs(`const s = z.object({ a: z.string() }).passthrough();\napi.post("/x", async (req, res) => { s.parse(req.body); });`);
    expect(r.locals.some((l) => l.local.calls.some((c) => LOOSE_METHODS.has(c.name)))).toBe(true);
  });

  it("the probe reads a kept key as taken and a stripped one as dropped", async () => {
    const { z } = await import("zod");
    const kept = z.object({ name: z.string() }).passthrough() as unknown as ZodLike;
    const strict = z.object({ name: z.string() }) as unknown as ZodLike;
    const dated = z.object({ name: z.string(), deletedAt: z.date().nullable().optional() }) as unknown as ZodLike;
    const v = sample(kept).value as Record<string, unknown>;
    expect(probeKey(kept, v, "id").outcome).toBe("taken");
    expect(probeKey(kept, v, "createdAt").outcome).toBe("taken");
    expect(probeAll(kept, v).length).toBeGreaterThan(0);
    expect(probeKey(strict, v, "id").outcome).toBe("dropped");
    expect(probeAll(strict, v)).toEqual([]);
    expect(probeKey(dated, v, "deletedAt").outcome).toBe("refused");
  });
});
