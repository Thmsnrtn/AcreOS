/**
 * The customer surface is honest about Pax — one control surface, in the
 * customer's words (AUTONOMY_SPEC.md §2 banned words, §3a, §7
 * paxControlsSurfaceIsHonest; constitution `ai.one-pax-control-surface`).
 *
 * WHAT THIS PROVES, and over which population:
 *
 *   1. BANNED WORDS. Every file under client/src/pages/** and
 *      client/src/components/** (the landing lives under pages/landing and is
 *      counted as its own population member) is parsed with the TypeScript
 *      compiler, and every string a customer can READ — JSX text, string
 *      literals, template text — is scanned for the §2 list. Identifiers,
 *      comments, import specifiers, type positions, className/testid/route
 *      attributes and class-list-shaped strings are not customer prose and
 *      are not scanned. Founder directories are allowlisted by path; nothing
 *      else is. Each banned entry is proven live against its own planted
 *      sample (per-member vacuity), and each population directory must
 *      contribute at least one parsed file (per-directory vacuity), because
 *      a parser that silently stops matching one directory reads exactly like
 *      that directory being clean.
 *
 *   2. THE PAGE RENDERS FROM THE REGISTRY. client/src/pages/settings/
 *      pax-controls.tsx imports UNATTENDED_PATHS from shared/pax-controls and
 *      filters it on `pauseStops` — the same registry
 *      paxPauseCoverage.test.ts reads — and no path label is retyped inline
 *      anywhere in the population.
 *
 *   3. STANCE AND PAUSE STRINGS COME FROM THE GLOSSARY. No customer file
 *      types a stance label, a stance sentence, a stance toast, a pause
 *      sentence, the standing line, the mental-model sentences or the two
 *      fixed labels ("Waiting for your tap", "What Pax did") as a literal;
 *      they are imported from shared/pax-glossary.ts or not rendered at all.
 *
 *   4. THE RETIRED LABELS ARE GONE. "Settings → Pax controls" and
 *      "Pax > Controls" appear in no string literal under client/, server/
 *      or shared/.
 *
 *   5. PAX_CONTROLS_PATH RESOLVES. App.tsx carries a <Route> at exactly that
 *      path, nested under /settings (never a door), rendering the lazy
 *      pax-controls page through ProtectedRoute.
 *
 * MUTATION PROBES (run by hand before merge; each must go red):
 *   - type `Ask before sending` as a literal in any customer component;
 *   - put the word "autopilot" in a customer component's JSX text;
 *   - drop UNATTENDED_PATHS from the page's import;
 *   - change the App.tsx route path away from PAX_CONTROLS_PATH;
 *   - unwrap a founder page in App.tsx (drop FounderProtectedRoute from
 *     /dunning) — its banned words must start counting;
 *   - rename FounderProtectedRoute — the derived-guard assertion must go red
 *     rather than silently exempting nothing.
 *
 * FOUNDER CONTEXT is derived, not hand-listed: (a) founder directories and
 * Founder*-named files by path; (b) any page or component App.tsx mounts
 * ONLY behind a founder guard — a wrapper DECLARED IN App.tsx that takes a
 * `component` prop and decides on `isFounder` (today: FounderProtectedRoute),
 * parsed with the TypeScript AST from the real route table, so a page moved
 * to a customer route is scanned the moment it moves; (c) a literal inside a
 * branch whose condition names `isFounder`, inside an object literal carrying
 * `founderOnly: true`, or under an object key named `founder`, or inside a
 * function/component whose name says founder (NewFounderSidebar); (d) a line
 * carrying the reviewed eslint marker `no-founder-codenames-in-customer-jsx`.
 * Nothing else is exempt.
 *
 * WHY THE GUARD, NOT THE PATH (third law — the population is an assumption).
 * An earlier version of this derivation also treated "mounted under /founder
 * or /admin" as founder-only. It is not: `/admin/decisions` renders
 * DecisionQueuePage through ProtectedRoute, deliberately open to every
 * authenticated user (App.tsx: "autonomous-decision-review is a customer-
 * facing feature … so non-founders can see the Decisions Inbox for their own
 * org"). A path prefix is a naming convention; the guard is the authority. It
 * also matched with a regex that required `{() => <Wrapper component={…}` to
 * follow `<Route path=…>` immediately, so any route carrying an explanatory
 * JSX comment — /dunning and /commissions, both FounderProtectedRoute-only —
 * fell out of the derivation and had their FOUNDER copy reported as customer
 * violations. Both failure modes are invisible in a green result, which is why
 * the derivation is asserted below against a known founder page, a known
 * customer page, and the guard's own name.
 *
 * THE BANNED LIST IS MATCHED IN ITS AUTONOMY SENSE. Over the program's own
 * files (paxGlossaryBannedWords.test.ts) every "threshold" is an autonomy
 * threshold; over the whole client it is not — a 1099 threshold, a pricing
 * matrix, a mailing envelope, a listing agent's commission, an AVM's own
 * confidence column and the skip-trace feature's verb are the product's
 * domain, and a gate that fires on them measures the symbol, not the
 * defect (first law). Each narrowed entry keeps a planted sample of the
 * DEFECT it must still catch, and the domain senses removed before matching
 * are full phrases listed with the sense they protect — never a bare word.
 */

import { describe, expect, it, vi } from "vitest";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import {
  PAX_CONTROLS_PATH,
  PAX_CONTROLS_LABEL,
  PAX_LABELS,
  PAX_PAUSE_COPY,
  PAX_STANCE_COPY,
  PAX_STANDING_LINE,
} from "@shared/pax-glossary";
import { OFFERED_STANCES, STANCE_LABELS, UNATTENDED_PATHS } from "@shared/pax-controls";
// This gate walks the source tree; its cost scales with the repo, and under the
// coverage run it does not fit the suite’s 30s default. A killed gate reports
// nothing about what it guards, so the budget is declared, not inherited.
vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });


const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const exists = (rel: string) => fs.existsSync(path.join(ROOT, rel));

// ── Population ──────────────────────────────────────────────────────────────

/** The three roots the spec names. The landing is inside pages/ and is also counted on its own. */
const POPULATION_ROOTS = ["client/src/pages", "client/src/components", "client/src/pages/landing"] as const;

/** The page the spec says renders "what Pause stops" from the registry. */
const PAX_PAGE = "client/src/pages/settings/pax-controls.tsx";
const APP = "client/src/App.tsx";

/**
 * Founder-only surfaces (spec §2: "/founder/** allowlisted"). Path-based and
 * narrow: the founder pages and the components only founder pages import.
 * components/dashboard is the founder-dashboard widget set (the eslint
 * codename rule allowlists the same directory for the same reason).
 */
const FOUNDER_ALLOWLIST: readonly RegExp[] = [
  /^client\/src\/pages\/founder\//,
  /^client\/src\/pages\/founder-[\w-]+\.tsx?$/,
  /^client\/src\/components\/founder\//,
  /^client\/src\/components\/founder-bridge\//,
  /^client\/src\/components\/founder-chat\//,
  /^client\/src\/components\/solene\//,
  /^client\/src\/components\/dashboard\//,
];

/**
 * The real route table, parsed from App.tsx with the TypeScript AST.
 *
 * `guards` are the founder guards App.tsx DECLARES (a wrapper taking a
 * `component` prop whose body decides on `isFounder`) — derived, not spelled,
 * so a second founder guard is covered the day it is written; the name is
 * still pinned below so renaming one cannot quietly empty the set.
 * `modules` maps every local name App.tsx binds to a file under @/pages or
 * @/components (React.lazy or a static default import).
 * `mounts` records, for each of those names, ONE FLAG PER PLACE App.tsx mounts
 * it — true when that mount sits behind a founder guard. A page is founder-only
 * only when EVERY mount is guarded, so a page that gains one customer route is
 * scanned from that commit on.
 */
interface AppRouteFacts {
  guards: Set<string>;
  modules: Map<string, string>;
  mounts: Map<string, boolean[]>;
}

function parseAppRoutes(): AppRouteFacts {
  const src = read(APP);
  const sf = ts.createSourceFile(APP, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

  const guards = new Set<string>();
  for (const st of sf.statements) {
    if (!ts.isFunctionDeclaration(st) || !st.name || !st.body) continue;
    if (!/Route$/.test(st.name.text)) continue;
    if (st.parameters.length === 0 || !/\bcomponent\b/.test(st.parameters[0].getText(sf))) continue;
    if (/\bisFounder\b/.test(st.body.getText(sf))) guards.add(st.name.text);
  }

  const modules = new Map<string, string>();
  for (const m of src.matchAll(
    /(\w+)\s*=\s*React\.lazy\(\(\)\s*=>\s*import\("@\/((?:pages|components)\/[\w/.-]+)"\)/g,
  )) {
    modules.set(m[1], `client/src/${m[2]}`);
  }
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier)) continue;
    const mm = /^@\/((?:pages|components)\/[\w/.-]+)$/.exec(st.moduleSpecifier.text);
    const local = st.importClause?.name?.text;
    if (mm && local) modules.set(local, `client/src/${mm[1]}`);
  }

  const mounts = new Map<string, boolean[]>();
  const record = (name: string, guarded: boolean) => {
    if (!modules.has(name)) return;
    const arr = mounts.get(name) ?? [];
    arr.push(guarded);
    mounts.set(name, arr);
  };
  /** `component={X}` on a route/guard element, when X is a plain identifier. */
  const componentOf = (el: ts.JsxOpeningLikeElement): string | null => {
    for (const a of el.attributes.properties) {
      if (!ts.isJsxAttribute(a) || a.name.getText(sf) !== "component") continue;
      const init = a.initializer;
      if (init && ts.isJsxExpression(init) && init.expression && ts.isIdentifier(init.expression))
        return init.expression.text;
      return null;
    }
    return null;
  };
  const visit = (node: ts.Node, guarded: boolean) => {
    let inner = guarded;
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const el = ts.isJsxElement(node) ? node.openingElement : node;
      const tag = el.tagName.getText(sf);
      inner = guarded || guards.has(tag);
      const comp = componentOf(el);
      // `<FounderProtectedRoute component={Page} />` guards Page itself; a
      // page rendered directly (`<Page />`) is guarded by its ancestors.
      if (comp) record(comp, inner);
      record(tag, inner);
    }
    ts.forEachChild(node, (child) => visit(child, inner));
  };
  visit(sf, false);

  return { guards, modules, mounts };
}

const APP_ROUTES = parseAppRoutes();

/** Files App.tsx mounts ONLY behind a founder guard. */
function founderOnlyPages(): Set<string> {
  const out = new Set<string>();
  for (const [name, flags] of APP_ROUTES.mounts) {
    if (flags.length === 0 || !flags.every(Boolean)) continue;
    const file = APP_ROUTES.modules.get(name);
    if (!file) continue;
    for (const ext of [".tsx", ".ts", "/index.tsx", "/index.ts"]) {
      if (exists(file + ext)) {
        out.add(file + ext);
        break;
      }
    }
  }
  return out;
}

const FOUNDER_PAGES = founderOnlyPages();

const isFounderPath = (rel: string) =>
  FOUNDER_ALLOWLIST.some((re) => re.test(rel)) || /\/[Ff]ounder[\w-]*\.tsx?$/.test(rel) || FOUNDER_PAGES.has(rel);
const isSourceFile = (name: string) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !/\.d\.ts$/.test(name);

function walk(dirRel: string): string[] {
  const out: string[] = [];
  const abs = path.join(ROOT, dirRel);
  if (!fs.existsSync(abs)) return out;
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = `${dirRel}/${entry.name}`;
    if (entry.isDirectory()) out.push(...walk(rel));
    else if (entry.isFile() && isSourceFile(entry.name)) out.push(rel);
  }
  return out;
}

/** Every customer file, once, regardless of how many roots contain it. */
function population(): string[] {
  const seen = new Set<string>();
  for (const root of POPULATION_ROOTS) for (const f of walk(root)) if (!isFounderPath(f)) seen.add(f);
  return [...seen].sort();
}

/** Immediate subdirectories of a root — the per-directory vacuity members. */
function subdirectories(root: string): string[] {
  const abs = path.join(ROOT, root);
  return fs
    .readdirSync(abs, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => `${root}/${e.name}`)
    .filter((d) => !isFounderPath(`${d}/`));
}

// ── The extractor ───────────────────────────────────────────────────────────

interface Literal {
  text: string;
  line: number;
  kind: "string" | "template" | "jsx";
}

/** JSX attributes whose values are never prose (routes, classes, ids, SVG geometry, motion props). */
const MACHINE_ATTRS = new Set([
  "className", "class", "data-testid", "testId", "key", "id", "href", "to", "src", "srcSet", "sizes",
  "type", "role", "variant", "size", "name", "style", "htmlFor", "for", "target", "rel", "method",
  "action", "encType", "lang", "dir", "fill", "stroke", "viewBox", "d", "transform", "points", "xmlns",
  "cx", "cy", "r", "rx", "ry", "x", "y", "x1", "x2", "y1", "y2", "dx", "dy", "width", "height",
  "preserveAspectRatio", "autoComplete", "autoCapitalize", "autoCorrect", "inputMode", "pattern",
  "accept", "loading", "decoding", "fontFamily", "strokeLinecap", "strokeLinejoin", "strokeWidth",
  "strokeDasharray", "gradientUnits", "offset", "stopColor", "clipPath", "mask", "filter", "in",
  "result", "values", "dur", "repeatCount", "begin", "mode", "layout", "layoutId", "initial", "animate",
  "exit", "transition", "variants", "whileHover", "whileTap", "whileInView", "align", "side",
  "sideOffset", "orientation", "asChild", "data-state", "data-side", "modal", "position", "itemProp",
  "itemType", "itemScope", "as", "component", "element", "tag", "shape", "color", "bg", "gap", "px",
  "py", "p", "m", "mx", "my", "w", "h", "ref", "tabIndex", "frameBorder", "allow", "sandbox",
  "referrerPolicy", "crossOrigin", "integrity", "media", "charSet", "httpEquiv", "property", "prefix",
  "data-slot", "data-side-offset", "data-align", "data-tone", "data-variant", "data-size", "data-mode",
  "data-surface", "data-door", "data-route", "data-track", "data-analytics", "data-key", "data-id",
]);

/** Object keys whose values are routes, keys, class lists or event names — not prose. */
const MACHINE_KEYS = new Set([
  "className", "queryKey", "testId", "data-testid", "href", "to", "path", "route", "key", "id", "icon",
  "url", "endpoint", "method", "src", "variant", "color", "type", "kind", "status", "event", "eventType",
  "surface", "ctaId", "channel", "field", "column", "sortBy", "orderBy", "table", "module", "dir",
  "format", "mime", "contentType", "toolName", "tool", "fn", "file", "glob", "pattern", "regex", "re",
  "slug", "value", "name", "sku", "tier", "plan", "persona", "role", "scope", "permission", "mutationKey",
  "queryFn", "storageKey", "cookie", "header", "headers", "token", "provider", "model", "font", "family",
  "weight", "ease", "easing", "transition", "layout", "animate", "initial", "exit", "variants",
]);

/** Calls whose string arguments are class lists, telemetry names or log lines — not prose. */
const MACHINE_CALLS = new Set([
  "cn", "clsx", "cva", "twMerge", "classNames", "console.log", "console.warn", "console.error",
  "console.debug", "console.info", "logger.info", "logger.warn", "logger.error", "logger.debug",
  "telemetry.track", "telemetry.event", "track", "capture", "posthog.capture", "emitMarketingTouch",
  "useQuery", "useMutation", "useInfiniteQuery", "invalidateQueries", "setQueryData", "getQueryData",
  "removeQueries", "prefetchQueries", "prefetchQuery", "fetchQuery", "apiRequest", "fetch", "fetchJsonArray",
  "fetchJson", "localStorage.getItem", "localStorage.setItem", "localStorage.removeItem",
  "sessionStorage.getItem", "sessionStorage.setItem", "sessionStorage.removeItem", "useDocumentTitle",
  "usePageMeta", "useWebSocketChannel", "useFlag", "isRouteEnabled", "hasPermission", "can", "navigate",
  "setLocation", "requestAnimationFrame", "addEventListener", "removeEventListener", "querySelector",
  "querySelectorAll", "getElementById", "getAttribute", "setAttribute", "matchMedia", "createElement",
  "classList.add", "classList.remove", "classList.toggle", "classList.contains", "startsWith", "endsWith",
  "includes", "indexOf", "split", "replace", "replaceAll", "match", "test", "RegExp", "Intl.DateTimeFormat",
  "Intl.NumberFormat", "toLocaleString", "format", "formatDate", "formatDistanceToNow", "parse",
  "JSON.parse", "JSON.stringify", "Object.keys", "Symbol", "import", "require", "lazy", "React.lazy",
]);

function calleeText(node: ts.CallExpression): string {
  const e = node.expression;
  if (ts.isIdentifier(e)) return e.text;
  if (ts.isPropertyAccessExpression(e)) {
    const left = e.expression;
    if (ts.isIdentifier(left)) return `${left.text}.${e.name.text}`;
    if (ts.isPropertyAccessExpression(left) && ts.isIdentifier(left.expression))
      return `${left.expression.text}.${left.name.text}.${e.name.text}`;
    return e.name.text;
  }
  return "";
}

/**
 * Whether a literal sits somewhere a customer never reads: an import, a type,
 * a machine attribute/key, a class/telemetry/query call, a `case` label, a
 * comparison against an enum value, an object key.
 */
/** The reviewed marker the eslint codename rule already uses for founder-gated lines. */
const FOUNDER_LINE_MARKER = /no-founder-codenames-in-customer-jsx/;

function conditionNamesFounder(expr: ts.Expression): boolean {
  return /\b(?:isFounder|founderMode|founderOnly|persona\s*===\s*["']founder["'])\b/.test(expr.getText());
}

/**
 * A literal the FOUNDER reads, not the customer: under `isFounder && …`, a
 * founder ternary/if, an object carrying `founderOnly: true`, an object key
 * named `founder`, or a line carrying the reviewed eslint founder marker.
 */
function inFounderContext(node: ts.Node, sf: ts.SourceFile): boolean {
  const start = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line;
  const lines = sf.text.split("\n");
  for (const l of [lines[start - 1] ?? "", lines[start] ?? ""]) if (FOUNDER_LINE_MARKER.test(l)) return true;
  let child: ts.Node = node;
  let parent: ts.Node | undefined = node.parent;
  while (parent && !ts.isSourceFile(parent)) {
    if (ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken && parent.right === child) {
      if (conditionNamesFounder(parent.left)) return true;
    }
    if (ts.isConditionalExpression(parent) && parent.condition !== child && conditionNamesFounder(parent.condition)) {
      if (parent.whenTrue === child) return true;
    }
    if (ts.isIfStatement(parent) && parent.thenStatement === child && conditionNamesFounder(parent.expression)) return true;
    if (ts.isObjectLiteralExpression(parent)) {
      const founderOnly = parent.properties.some(
        (p) => ts.isPropertyAssignment(p) && p.name.getText() === "founderOnly" && p.initializer.kind === ts.SyntaxKind.TrueKeyword,
      );
      if (founderOnly) return true;
    }
    if (ts.isPropertyAssignment(parent) && parent.initializer === child && parent.name.getText() === "founder") return true;
    // A component or helper whose NAME says founder (NewFounderSidebar,
    // FounderMobileBottomNav) renders for the founder.
    if ((ts.isFunctionDeclaration(parent) || ts.isFunctionExpression(parent)) && parent.name && /founder/i.test(parent.name.text)) return true;
    if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name) && /founder/i.test(parent.name.text)) return true;
    child = parent;
    parent = parent.parent;
  }
  return false;
}

function inMachineContext(node: ts.Node): boolean {
  let child: ts.Node = node;
  let parent: ts.Node | undefined = node.parent;
  while (parent) {
    if (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent) || ts.isImportTypeNode(parent)) return true;
    if (ts.isTypeNode(parent) || ts.isLiteralTypeNode(parent) || ts.isTypeAliasDeclaration(parent)) return true;
    if (ts.isCaseClause(parent) && parent.expression === child) return true;
    if (ts.isBinaryExpression(parent)) {
      const op = parent.operatorToken.kind;
      if (
        op === ts.SyntaxKind.EqualsEqualsEqualsToken ||
        op === ts.SyntaxKind.ExclamationEqualsEqualsToken ||
        op === ts.SyntaxKind.EqualsEqualsToken ||
        op === ts.SyntaxKind.ExclamationEqualsToken
      )
        return true;
    }
    if (ts.isJsxAttribute(parent)) {
      const name = parent.name.getText();
      return MACHINE_ATTRS.has(name) || name.startsWith("data-") || name.startsWith("on");
    }
    if (ts.isPropertyAssignment(parent)) {
      if (parent.name === child) return true; // an object KEY is never prose
      const key = ts.isIdentifier(parent.name) || ts.isStringLiteral(parent.name) ? parent.name.text : "";
      if (MACHINE_KEYS.has(key)) return true;
    }
    if (ts.isComputedPropertyName(parent) || ts.isElementAccessExpression(parent)) return true;
    if (ts.isCallExpression(parent) && parent.expression !== child) {
      if (MACHINE_CALLS.has(calleeText(parent))) return true;
    }
    if (ts.isNewExpression(parent) && parent.expression !== child) {
      const c = parent.expression.getText();
      if (c === "RegExp" || c === "URL" || c === "URLSearchParams" || c === "Intl.DateTimeFormat") return true;
    }
    if (ts.isTaggedTemplateExpression(parent)) return true; // styled/css/graphql tags
    // Stop climbing at statement or JSX element boundaries — the context is decided.
    if (ts.isStatement(parent) || ts.isJsxElement(parent) || ts.isJsxFragment(parent) || ts.isSourceFile(parent)) break;
    child = parent;
    parent = parent.parent;
  }
  return false;
}

/** Identifier-, path-, key- or class-list-shaped: never a sentence a customer reads. */
export function isMachineToken(raw: string): boolean {
  const t = raw.trim();
  if (t.length === 0) return true;
  if (!/\s/.test(t)) {
    if (/[/_.:@#$%{}[\]()=<>|\\?&;,]/.test(t)) return true; // path / key / expression shaped
    if (t === t.toLowerCase()) return true; // a bare lowercase token
    if (/^[A-Z]{2}$/.test(t)) return true; // a state code ("VA", "TX")
    if (/^[A-Z0-9]+$/.test(t) && t.length <= 4) return true; // "USD", "APN", "N/A"-style codes
    return false;
  }
  // A class list: every whitespace-separated token is a lowercase hyphen/colon/bracket utility.
  const tokens = t.split(/\s+/);
  if (tokens.every((tok) => /^[a-z0-9\-:/[\]&_.%!()#,>~*+='"]+$/.test(tok) && /[-:[]/.test(tok))) return true;
  return false;
}

/** Every customer-readable string in a TS/TSX file: JSX text, string literals, template text. */
export function customerStrings(rel: string, src: string = read(rel)): Literal[] {
  const sf = ts.createSourceFile(rel, src, ts.ScriptTarget.Latest, true, rel.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: Literal[] = [];
  const lineOf = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const push = (text: string, node: ts.Node, kind: Literal["kind"]) => {
    if (isMachineToken(text)) return;
    if (inFounderContext(node, sf)) return;
    out.push({ text, line: lineOf(node), kind });
  };
  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node)) {
      const text = node.getText(sf).replace(/\s+/g, " ").trim();
      if (text.length > 0 && !inMachineContext(node)) push(text, node, "jsx");
      return;
    }
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      if (!inMachineContext(node)) push(node.text, node, ts.isStringLiteral(node) ? "string" : "template");
      return;
    }
    if (ts.isTemplateExpression(node)) {
      if (!inMachineContext(node)) {
        const text = [node.head.text, ...node.templateSpans.map((s) => s.literal.text)].join(" ").replace(/\s+/g, " ").trim();
        if (text.length > 0) push(text, node, "template");
      }
      return; // the spans' expressions are code, not prose
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

// ── The banned list (spec §2) ───────────────────────────────────────────────

/**
 * Each entry carries a `sample` that MUST match — the per-member vacuity
 * assertion. A regex that stops matching its own sample is decoration.
 */
const BANNED: Array<{ word: string; re: RegExp; sample: string }> = [
  { word: "autopilot", re: /\bautopilot\b/i, sample: "Full autopilot" },
  { word: "autonomy / autonomous(ly)", re: /\bautonom(?:y|ous|ously)\b/i, sample: "Pax works autonomously" },
  { word: "unattended", re: /\bunattended\b/i, sample: "unattended sends" },
  { word: "autonomy level / slider", re: /\bslider\b/i, sample: "an autonomy slider per surface" },
  // An AUTONOMY threshold — "auto-approve above", "confidence threshold", "trust
  // threshold", "Pax threshold". A 1099 / AVM-alert / risk / approval-dollar
  // threshold is the product's own arithmetic and is not this defect.
  {
    word: "threshold (autonomy)",
    re: /\b(?:auto(?:-|\s)?\w*|autonom\w*|confidence|trust|pax|ai|agent)\s+thresholds?\b/i,
    sample: "Auto-approve threshold",
  },
  // An AUTONOMY / permission matrix. A pricing matrix is a pricing matrix.
  { word: "matrix (autonomy)", re: /\b(?:autonomy|autopilot|pax|ai|permission|approval|agent)\s+matrix\b/i, sample: "Autonomy matrix" },
  // "assisted / supervised" AS LABELS — a whole string, alone or in a label
  // list. "AI-assisted outputs" in a sentence is description, not a stance.
  { word: "assisted / supervised (as labels)", re: /^\s*(?:(?:assisted|supervised)\s*(?:[·/|,]\s*)?)+$/i, sample: "Assisted" },
  { word: "supervised (label)", re: /^\s*(?:(?:assisted|supervised)\s*(?:[·/|,]\s*)?)+$/i, sample: "Supervised" },
  { word: "Observe / Draft / Execute", re: /\bObserve\s*\/\s*Draft\s*\/\s*Execute\b/i, sample: "Observe / Draft / Execute" },
  { word: "Suggest only", re: /\bSuggest only\b/i, sample: "Suggest only" },
  { word: "Ask first", re: /\bAsk first\b/i, sample: "Ask first" },
  { word: "Act & tell", re: /\bAct & tell\b/i, sample: "Act & tell" },
  { word: "Off / Suggest (labels)", re: /\bOff\s*\/\s*Suggest\b/, sample: "Off / Suggest / Review-then-send" },
  { word: "Review-then-send", re: /\bReview-then-send\b/i, sample: "Review-then-send" },
  { word: "Auto-send", re: /\bAuto-send\b/i, sample: "Auto-send" },
  { word: "Auto above N%", re: /\bAuto above\b/i, sample: "Auto above 80%" },
  // A confidence percentage on a DECISION. The AVM's own confidence column is
  // the provider's figure (inline-provenance census) and carries "AVM".
  { word: "confidence %", re: /^(?![\s\S]*\bAVM\b)[\s\S]*confidence\s*%/i, sample: "confidence %" },
  { word: "Pax would handle", re: /\bPax would handle\b/i, sample: "Pax would handle this" },
  // "Override" as the CTA over a Pax decision — the bare label, or the word in
  // a sentence about Pax / a decision / the AI. Overriding a CSV column mapping
  // or a lot share is the product, not the defect.
  {
    word: "Override (over a Pax decision)",
    re: /^\s*Override\s*$|\bOverride\b(?=[^.]*\b(?:Pax|decision|recommendation|AI)\b)|\b(?:Pax|decision|recommendation|AI)\b[^.]*\bOverride\b/,
    sample: "Override",
  },
  { word: "agent / agents", re: /\bagents?\b/i, sample: "Deploy Agent" },
  { word: "Background agents", re: /\bBackground agents\b/i, sample: "Background agents" },
  { word: "AI executive team", re: /\bAI executive team\b/i, sample: "operated by an AI executive team" },
  { word: "co-pilot / coworker", re: /\bco-?(?:pilot|worker)\b/i, sample: "your AI coworker" },
  // Pax (or an AI) described as a VA. A human VA on the team ("Add a VA, a
  // partner, or a teammate"; the VA role) is a person, and "VA loan" is a
  // loan program.
  {
    word: "VA (Pax as a virtual assistant)",
    re: /\bVA agents?\b|\b(?:AI|Pax|autonomous|digital|background)\s+VA\b|\bVA\s+(?:runtime|engine|roster)\b|\bPax (?:is|as) (?:your |a )?VA\b/i,
    sample: "No VA agents yet",
  },
  { word: "codename", re: /\b(?:Atlas|Sophie|Solene|Forge|Samantha|Alex|Maya|Charlie|Riley)\b/, sample: "Ask Atlas" },
  { word: "AI Hub", re: /\bAI Hub\b/i, sample: "AI Hub" },
  { word: "Command center", re: /\bCommand center\b/i, sample: "Command center" },
  { word: "AI Tasks", re: /\bAI Tasks\b/i, sample: "Scheduled AI Tasks" },
  { word: "witnessed", re: /\bwitnessed\b/i, sample: "witnessed send" },
  { word: "kernel", re: /\bkernel\b/i, sample: "the approval kernel" },
  { word: "executor", re: /\bexecutors?\b/i, sample: "the autonomous executor" },
  // The kernel's envelope. A mailing envelope is direct mail, the product.
  {
    word: "envelope (kernel)",
    re: /\b(?:send|execution|approval|kernel|tool|action|trace|request|event|message|json|payload|witnessed)\s+envelopes?\b|\benvelopes?\s+(?:id|hash|signature|version)\b/i,
    sample: "the send envelope",
  },
  { word: "trace (not skip-trace)", re: /(?<!skip[- ])\btrace\b/i, sample: "see the trace" },
  { word: "circuit breaker", re: /\bcircuit breaker\b/i, sample: "circuit breaker tripped" },
  { word: "manual-only", re: /\bmanual-only\b/i, sample: "manual-only mode" },
  { word: "Reset Pax", re: /\bReset Pax\b/i, sample: "Reset Pax" },
  { word: "cost-saving / full-power mode", re: /\b(?:cost-saving|full-power) mode\b/i, sample: "full-power mode" },
  { word: "dunning", re: /\bdunning\b/i, sample: "dunning sequence" },
  { word: "Settings → Pax controls", re: /Settings → Pax controls/, sample: "Resume under Settings → Pax controls" },
  { word: "Pax > Controls", re: /Pax > Controls/, sample: "Settings (Pax > Controls)" },
  { word: "$0.02 per task", re: /\$0\.02 per task/, sample: "$0.02 per task" },
  { word: "Insights (as a menu label)", re: /^\s*Insights\s*$/, sample: "Insights" },
  { word: "Pax always asks before taking an action", re: /Pax always asks before taking an action/i, sample: "Pax always asks before taking an action" },
  { word: "it never decides for you", re: /it never decides for you/i, sample: "it never decides for you" },
  { word: "Pax can take real actions", re: /Pax can take real actions/i, sample: "Pax can take real actions" },
];

/** The one honest exception the spec keeps. */
const ALLOWED_PHRASES = [PAX_LABELS.notYetLive];

/**
 * Domain senses of a banned word that have nothing to do with AI. Each is
 * removed from the text before matching. Keep this list SHORT and each entry
 * a full phrase, never a bare word — a bare "agent" here would re-admit the
 * defect.
 */
const DOMAIN_SENSES: readonly RegExp[] = [
  // A real-estate professional, never an AI.
  /\b(?:real[- ]estate|listing|buyer'?s?|seller'?s?|title|closing|escrow|insurance|registered|licensed|leasing|property|rental|user|transfer|paying|collection)[- ]agents?\b/gi,
  /\b(?:broker|brokers|realtor|realtors)(?:,| or| and|\/)\s*agents?\b/gi,
  /\bagent[- ]investors?\b/gi,
  /\bagents?\s+(?:commission|license|fee|referral|network|split)s?\b/gi,
  /\bagents?, closing\b/gi, // resale cost line: "Agent, closing, concessions"
  /\brepresenting you as your agent\b/gi, // the offer letter's agency disclaimer
  // Legal boilerplate ("employees, contractors, agents, licensors").
  /\b(?:contractors|employees|officers|directors|affiliates), agents\b/gi,
  // Probate.
  /\b(?:estate|probate)\s+executors?\b/gi,
  /\bexecutors? (?:of|for) (?:the|an?|your|their|his|her) (?:estate|will)\b/gi,
  /\bexecutor(?:s)?\/administrator(?:s)?\b/gi,
  /\bpersonal representative or executor\b/gi,
  // A bank trace number on a payment, never an LLM trace.
  /\b(?:ACH|wire|bank|check|payment|transaction)\s+trace\b/gi,
];

/**
 * Feature files whose NAME is the domain sense: inside them one banned entry
 * is that feature's own vocabulary. Skip-trace is the spec's carve-out; the
 * commissions surface is the agent-investor persona tracking real-estate
 * agents' commissions.
 */
const DOMAIN_FILE_SENSES: ReadonlyArray<{ file: RegExp; words: readonly string[]; sense: string }> = [
  { file: /skip-trac/i, words: ["trace (not skip-trace)"], sense: "the skip-trace feature's own verb" },
  { file: /commission/i, words: ["agent / agents"], sense: "real-estate agents' commissions (agent-investor persona)" },
];

function scrub(text: string): string {
  let t = text;
  for (const ok of ALLOWED_PHRASES) t = t.split(ok).join(" ");
  for (const re of DOMAIN_SENSES) t = t.replace(re, " ");
  return t;
}

function bannedHits(rel: string, literals: Literal[]): string[] {
  const hits: string[] = [];
  const skipWords = new Set(DOMAIN_FILE_SENSES.filter((d) => d.file.test(rel)).flatMap((d) => d.words));
  for (const lit of literals) {
    const text = scrub(lit.text);
    for (const b of BANNED) {
      if (skipWords.has(b.word)) continue;
      if (b.re.test(text)) hits.push(`${rel}:${lit.line}  [${b.word}]  ${JSON.stringify(lit.text).slice(0, 140)}`);
    }
  }
  return hits;
}

// ── Scan once ───────────────────────────────────────────────────────────────

const FILES = population();
const SCANNED = new Map<string, Literal[]>();
for (const rel of FILES) SCANNED.set(rel, customerStrings(rel));

// ── Vacuity ─────────────────────────────────────────────────────────────────

describe("the scanner can see (vacuity)", () => {
  it("the population is the customer client, not a sample", () => {
    expect(FILES.length, "fewer than 400 customer files parsed — the walk went blind").toBeGreaterThanOrEqual(400);
    const total = [...SCANNED.values()].reduce((n, l) => n + l.length, 0);
    expect(total, "fewer than 5000 customer strings extracted — the extractor went blind").toBeGreaterThanOrEqual(5000);
  });

  it("every population root contributes parsed files with prose", () => {
    for (const root of POPULATION_ROOTS) {
      const members = FILES.filter((f) => f.startsWith(`${root}/`));
      expect(members.length, `${root} contributed no files`).toBeGreaterThan(0);
      const prose = members.reduce((n, f) => n + (SCANNED.get(f)?.length ?? 0), 0);
      expect(prose, `${root} yielded no customer strings`).toBeGreaterThan(0);
    }
  });

  it("every non-founder directory under pages/ and components/ is read in full (per-directory vacuity)", () => {
    // The walker's count per directory must equal an INDEPENDENT recursive
    // listing's count — a walker that silently stops descending one
    // directory reads exactly like that directory being clean. A directory
    // with no source files at all (pages/styles holds CSS) is allowed to
    // contribute nothing; a directory with source files must contribute all
    // of them, and one with prose must yield prose.
    const problems: string[] = [];
    for (const root of ["client/src/pages", "client/src/components"] as const) {
      for (const dir of subdirectories(root)) {
        const independent = (fs.readdirSync(path.join(ROOT, dir), { recursive: true }) as string[])
          .map((p) => `${dir}/${String(p).replace(/\\/g, "/")}`)
          .filter((p) => isSourceFile(path.basename(p)) && fs.statSync(path.join(ROOT, p)).isFile() && !isFounderPath(p));
        const members = FILES.filter((f) => f.startsWith(`${dir}/`));
        if (members.length !== independent.length) problems.push(`${dir}: walker saw ${members.length}, listing has ${independent.length}`);
        if (independent.length >= 3 && members.reduce((n, f) => n + (SCANNED.get(f)?.length ?? 0), 0) === 0)
          problems.push(`${dir}: ${members.length} files, zero customer strings — the extractor went blind here`);
      }
    }
    expect(problems, "per-directory blind spots").toEqual([]);
  });

  it("founder surfaces are the ONLY allowlisted paths, and they exist", () => {
    // The allowlist must not have drifted into covering customer paths.
    for (const rel of FILES) expect(isFounderPath(rel), `${rel} matched the founder allowlist`).toBe(false);
    expect(isFounderPath("client/src/pages/founder/letter.tsx")).toBe(true);
    expect(isFounderPath("client/src/pages/founder-letter.tsx")).toBe(true);
    expect(isFounderPath("client/src/components/mobile/FounderMobileBottomNav.tsx")).toBe(true);
    expect(isFounderPath("client/src/pages/today.tsx")).toBe(false);
    expect(isFounderPath("client/src/components/pax/PaxAskCard.tsx")).toBe(false);
    expect(exists("client/src/pages/founder"), "the founder pages directory moved — re-aim the allowlist").toBe(true);
    expect(
      isFounderPath("client/src/components/founder/ai-console/VaTeamPanel.tsx"),
      "the founder-only AI console left the allowlisted founder directory",
    ).toBe(true);
  });

  it("the App.tsx route-table derivation is alive, and says founder only where App.tsx does", () => {
    // A parser that silently stops matching reads exactly like a clean repo,
    // so every step of the derivation is pinned to something knowable.
    expect(APP_ROUTES.modules.size, "App.tsx binds no @/pages or @/components modules — the import parse went blind")
      .toBeGreaterThanOrEqual(150);
    expect(APP_ROUTES.mounts.size, "no route mounts were parsed out of App.tsx — the JSX walk went blind")
      .toBeGreaterThanOrEqual(150);

    // The guard set is DERIVED (a wrapper taking `component` that decides on
    // isFounder) and then pinned: renaming FounderProtectedRoute must fail
    // here rather than quietly exempting nothing.
    expect(
      [...APP_ROUTES.guards].sort(),
      "the founder route guard changed — re-read App.tsx before trusting this exemption",
    ).toEqual(["FounderProtectedRoute"]);
    expect(APP_ROUTES.guards.has("ProtectedRoute"), "the customer guard was derived as a founder guard").toBe(false);
    expect(APP_ROUTES.guards.has("FlaggedRoute"), "the flag guard was derived as a founder guard").toBe(false);

    expect(FOUNDER_PAGES.size, "App.tsx parse found no founder-guarded pages — the derivation went blind")
      .toBeGreaterThanOrEqual(40);
    for (const p of FOUNDER_PAGES) expect(exists(p), `${p} derived from App.tsx but missing on disk`).toBe(true);

    // Known member, OUTSIDE client/src/pages/founder/: the case the directory
    // allowlist structurally cannot see. /dunning is FounderProtectedRoute-only
    // (its API is requireFounder on the whole router), and its route carries an
    // explanatory JSX comment — the shape the old regex derivation missed.
    expect(
      FOUNDER_PAGES.has("client/src/pages/dunning-manager.tsx"),
      "dunning-manager is FounderProtectedRoute-only in App.tsx but was not derived — the parse is broken",
    ).toBe(true);
    expect(FOUNDER_PAGES.has("client/src/pages/commissions.tsx")).toBe(true);

    // Known non-members: customer doors. App.tsx must really mount them, or
    // "not founder" would be true of a page the parser never saw.
    const mounted = new Set(
      [...APP_ROUTES.mounts.keys()].map((name) => APP_ROUTES.modules.get(name)).filter(Boolean) as string[],
    );
    for (const door of ["client/src/pages/today", "client/src/pages/finance"]) {
      expect(mounted.has(door), `${door} is not mounted in App.tsx — this check proves nothing`).toBe(true);
      expect(FOUNDER_PAGES.has(`${door}.tsx`), `${door} was derived as founder-only`).toBe(false);
      expect(isFounderPath(`${door}.tsx`)).toBe(false);
    }

    // A /founder- or /admin-PREFIXED path is not authority: /admin/decisions
    // renders DecisionQueuePage through ProtectedRoute for every authenticated
    // user, so its copy stays in the customer population.
    expect(
      FOUNDER_PAGES.has("client/src/pages/decision-queue.tsx"),
      "an /admin path was mistaken for a founder guard — decision-queue is customer-facing",
    ).toBe(false);
  });

  it("every banned entry matches its own planted sample (per-member vacuity)", () => {
    const dead = BANNED.filter((b) => !b.re.test(b.sample)).map((b) => b.word);
    expect(dead, "banned regexes that no longer match their own sample").toEqual([]);
    expect(BANNED.length).toBeGreaterThanOrEqual(44);
  });

  it("the extractor reads JSX text, literals and templates, and skips what is not prose", () => {
    const fixture = [
      'import { x } from "./autopilot-agent";',
      "// autopilot in a comment is not a customer word",
      "/* the kernel, in a block comment */",
      'type Mode = "autopilot" | "Full autopilot";',
      'const origin = "autopilot";',
      'if (mode === "Full autopilot") {}',
      'const label = "Full autopilot";',
      "const line = `Every ${thing} waits for your tap.`;",
      'const el = <div className="lp-agent-tab lp-agent-tab-active" data-testid="agent-card" aria-label="Deploy Agent">Background agents run here</div>;',
      'const q = useQuery({ queryKey: ["/api/agents/tasks"] });',
      'const c = cn("agent-chip", active && "Agent Chip Active");',
      'const o = { className: "kernel-panel", title: "The kernel" };',
      "const t = <p>{`Pax would handle ${n} items`}</p>;",
      'const f = isFounder && <span>Atlas says hi</span>;',
      'const g = isFounder ? "Sophie" : "Pax";',
      'const nav = [{ id: "x", label: "Agent traces", founderOnly: true }, { id: "y", label: "Agent traces for customers" }];',
      'const desc = { founder: "Founder dashboard, agents, controls", customer: "Today, leads, deals, money" };',
      "// eslint-disable-next-line acreos/no-founder-codenames-in-customer-jsx -- founder-gated",
      'const marked = "Forge";',
      'function NewFounderSidebar() { return <p>Chat with Solene</p>; }',
      'function CustomerSidebar() { return <p>Chat with Pax</p>; }',
    ].join("\n");
    const got = customerStrings("fixture.tsx", fixture).map((l) => l.text);
    expect(got).toEqual([
      "Full autopilot",
      "Every waits for your tap.",
      "Deploy Agent",
      "Background agents run here",
      "The kernel",
      "Pax would handle items",
      "Pax",
      "Agent traces for customers",
      "Today, leads, deals, money",
      "Chat with Pax",
    ]);
  });

  it("the skip-trace carve-out is narrow and the domain senses are phrases, not words", () => {
    const trace = BANNED.find((b) => b.word.startsWith("trace"))!;
    expect(trace.re.test("skip-trace from chat")).toBe(false);
    expect(trace.re.test("skip trace the owner")).toBe(false);
    expect(trace.re.test("see the trace")).toBe(true);
    const agent = BANNED.find((b) => b.word === "agent / agents")!;
    expect(agent.re.test(scrub("the listing agent called"))).toBe(false);
    expect(agent.re.test(scrub("Agent-investor"))).toBe(false);
    expect(agent.re.test(scrub("Deploy Agent"))).toBe(true);
    expect(agent.re.test(scrub("your AI agent"))).toBe(true);
    const va = BANNED.find((b) => b.word.startsWith("VA"))!;
    expect(va.re.test(scrub("a VA loan"))).toBe(false);
    expect(va.re.test(scrub("Add a VA, a partner, or a teammate."))).toBe(false);
    expect(va.re.test(scrub("Pax is your VA"))).toBe(true);
    expect(va.re.test(scrub("When your VA agents propose actions"))).toBe(true);
    expect(isMachineToken("VA")).toBe(true); // a bare state code is never scanned
    const threshold = BANNED.find((b) => b.word.startsWith("threshold"))!;
    expect(threshold.re.test("the $600 1099-NEC threshold")).toBe(false);
    expect(threshold.re.test("Authority levels by trust threshold")).toBe(true);
    const override = BANNED.find((b) => b.word.startsWith("Override"))!;
    expect(override.re.test("Override any mapping below before importing.")).toBe(false);
    expect(override.re.test("Pax would handle this — Override")).toBe(true);
    const labels = BANNED.find((b) => b.word.startsWith("assisted"))!;
    expect(labels.re.test("AI-assisted offer suggestions")).toBe(false);
    expect(labels.re.test("Assisted · Supervised")).toBe(true);
    const conf = BANNED.find((b) => b.word === "confidence %")!;
    expect(conf.re.test("Address,AVM Value,Confidence %,Low")).toBe(false);
    expect(conf.re.test("Auto above 80% confidence %")).toBe(true);
  });
});

// ── 1. Banned words ─────────────────────────────────────────────────────────

describe("no banned word reaches a customer surface (spec §2)", () => {
  it("the whole population is clean", () => {
    const hits: string[] = [];
    for (const rel of FILES) hits.push(...bannedHits(rel, SCANNED.get(rel) ?? []));
    expect(
      hits.join("\n"),
      "banned vocabulary in a customer-readable string (JSX text, literal or template)",
    ).toBe("");
  });
});

// ── 2. The page renders from the registry ───────────────────────────────────

describe("the Pax page renders 'what Pause stops' from UNATTENDED_PATHS", () => {
  it("imports UNATTENDED_PATHS from shared/pax-controls", () => {
    expect(exists(PAX_PAGE), `${PAX_PAGE} is gone`).toBe(true);
    const sf = ts.createSourceFile(PAX_PAGE, read(PAX_PAGE), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let imported = false;
    for (const stmt of sf.statements) {
      if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) continue;
      if (stmt.moduleSpecifier.text !== "@shared/pax-controls") continue;
      const named = stmt.importClause?.namedBindings;
      if (named && ts.isNamedImports(named) && named.elements.some((e) => e.name.text === "UNATTENDED_PATHS")) imported = true;
    }
    expect(imported, "the page no longer imports UNATTENDED_PATHS from @shared/pax-controls").toBe(true);
  });

  it("filters the registry on pauseStops (the list is derived, not retyped)", () => {
    const src = read(PAX_PAGE);
    expect(src).toMatch(/UNATTENDED_PATHS\s*\.filter\s*\(/);
    expect(src).toMatch(/\bpauseStops\b/);
    expect(src).toMatch(/\bcustomerVisible\b/);
  });

  it("no path label or paused-line is retyped as a literal anywhere in the population", () => {
    // Sentences only: a one-word label ("Workflows") is also the name of the
    // editor it links to, and its presence elsewhere proves nothing.
    const strings = UNATTENDED_PATHS.flatMap((p) => [p.label, p.whilePaused]).filter((s) => s.split(/\s+/).length >= 3);
    expect(strings.length).toBeGreaterThanOrEqual(20);
    const hits: string[] = [];
    for (const rel of FILES) {
      for (const lit of SCANNED.get(rel) ?? []) {
        for (const s of strings) if (lit.text.includes(s)) hits.push(`${rel}:${lit.line}  ${JSON.stringify(s)}`);
      }
    }
    expect(hits.join("\n"), "UNATTENDED_PATHS text typed inline — render it from the registry").toBe("");
  });
});

// ── 3. Stance and pause strings come from the glossary ─────────────────────

describe("every stance and pause string comes from shared/pax-glossary.ts", () => {
  /** Static sentences and labels the glossary owns. Any literal CONTAINING one is inline typing. */
  const GLOSSARY_OWNED: Array<{ what: string; text: string }> = [
    ...OFFERED_STANCES.flatMap((s) => [
      { what: `stance label ${s}`, text: PAX_STANCE_COPY[s].label },
      { what: `stance sentence ${s}`, text: PAX_STANCE_COPY[s].sentence },
      { what: `stance toast ${s}`, text: PAX_STANCE_COPY[s].toast },
    ]),
    { what: "pause: still works", text: PAX_PAUSE_COPY.stillWorks },
    { what: "pause: check failed", text: PAX_PAUSE_COPY.checkFailedRefusal },
    { what: "pause: sentence", text: "Everything Pax and your rules do on their own is stopped" },
    { what: "pause: refusal", text: "so this wasn't done" },
    { what: "pause: resumes by itself", text: "Pax resumes by itself on" },
    { what: "standing line", text: PAX_STANDING_LINE },
    { what: "fixed rule", text: PAX_LABELS.fixedRule },
    ...PAX_LABELS.mentalModel.map((text, i) => ({ what: `mental model sentence ${i + 1}`, text })),
    { what: "you start on", text: PAX_LABELS.youStartOn },
    { what: "queue label", text: PAX_LABELS.queue },
    { what: "receipts label", text: PAX_LABELS.receipts },
  ];

  it("the glossary still exports the strings this check reads (vacuity)", () => {
    expect(GLOSSARY_OWNED.length).toBeGreaterThanOrEqual(16);
    for (const g of GLOSSARY_OWNED) expect(g.text.length, g.what).toBeGreaterThan(8);
    expect(STANCE_LABELS.ask_before_sending).toBe(PAX_STANCE_COPY.ask_before_sending.label);
    expect(STANCE_LABELS.ask_before_everything).toBe(PAX_STANCE_COPY.ask_before_everything.label);
  });

  it("no customer file types one of them as a literal", () => {
    const hits: string[] = [];
    for (const rel of FILES) {
      for (const lit of SCANNED.get(rel) ?? []) {
        for (const g of GLOSSARY_OWNED) {
          if (lit.text.includes(g.text)) hits.push(`${rel}:${lit.line}  [${g.what}]  ${JSON.stringify(lit.text).slice(0, 120)}`);
        }
      }
    }
    expect(hits.join("\n"), "a glossary-owned sentence typed inline — import it from @shared/pax-glossary").toBe("");
  });
});

// ── 4. Retired labels are gone ──────────────────────────────────────────────

describe("the retired labels appear nowhere", () => {
  const RETIRED = ["Settings → Pax controls", "Pax > Controls"];

  it("no string literal under client/, server/ or shared/ carries them", () => {
    const roots = ["client/src", "server", "shared"];
    const hits: string[] = [];
    const walkAll = (dirRel: string) => {
      const abs = path.join(ROOT, dirRel);
      for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
        const rel = `${dirRel}/${entry.name}`;
        if (entry.isDirectory()) walkAll(rel);
        else if (entry.isFile() && /\.tsx?$/.test(entry.name)) {
          const src = read(rel);
          src.split("\n").forEach((line, i) => {
            for (const r of RETIRED) {
              if (new RegExp(`["'\`][^"'\`\\n]*${r.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(line))
                hits.push(`${rel}:${i + 1}  ${JSON.stringify(r)}`);
            }
          });
        }
      }
    };
    for (const r of roots) walkAll(r);
    expect(hits.join("\n")).toBe("");
    expect(PAX_CONTROLS_LABEL).toBe("Settings → Pax");
  });
});

// ── 5. PAX_CONTROLS_PATH resolves ───────────────────────────────────────────

describe("PAX_CONTROLS_PATH resolves to a real, nested route in App.tsx", () => {
  const app = read(APP);

  it("stays nested under /settings — never a door", () => {
    expect(PAX_CONTROLS_PATH).toMatch(/^\/settings\/[a-z-]+$/);
  });

  it("App.tsx lazy-loads the pax-controls page and routes PAX_CONTROLS_PATH to it through ProtectedRoute", () => {
    const lazy = app.match(/const\s+(\w+)\s*=\s*React\.lazy\(\(\)\s*=>\s*import\("@\/pages\/settings\/pax-controls"\)\)/);
    expect(lazy, "App.tsx no longer lazy-imports @/pages/settings/pax-controls").not.toBeNull();
    const component = lazy![1];
    const esc = PAX_CONTROLS_PATH.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const route = new RegExp(
      `<Route\\s+path=(?:"${esc}"|\\{PAX_CONTROLS_PATH\\})\\s*>\\s*\\{\\(\\)\\s*=>\\s*<ProtectedRoute\\s+component=\\{${component}\\}`,
    );
    expect(
      route.test(app),
      `App.tsx has no <Route path="${PAX_CONTROLS_PATH}"> rendering ${component} through ProtectedRoute`,
    ).toBe(true);
  });

  it("every customer link to the Pax settings uses the canonical path", () => {
    // Any literal that names a /settings/pax* path must be exactly PAX_CONTROLS_PATH.
    const hits: string[] = [];
    for (const rel of FILES) {
      const src = read(rel);
      src.split("\n").forEach((line, i) => {
        for (const m of line.matchAll(/["'`](\/settings\/pax[\w/-]*)["'`]/g)) {
          if (m[1] !== PAX_CONTROLS_PATH) hits.push(`${rel}:${i + 1}  ${m[1]}`);
        }
      });
    }
    expect(hits.join("\n"), "a Pax settings link that is not PAX_CONTROLS_PATH").toBe("");
  });
});
