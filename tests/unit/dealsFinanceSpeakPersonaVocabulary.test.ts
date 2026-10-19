/**
 * The Deals and Finance doors speak the persona's vocabulary — no hardcoded
 * land-investor terms in the copy they render.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 * The 30-persona walk (tests/e2e/customer-personas.spec.ts) found the persona
 * frame dead behind the Deals and Finance doors: a note investor opened Deals
 * and read "Pipeline · Leads", a "Closed" KPI and "No open deals"; Finance said
 * "Deals closed" and "from Deal #12". The vocabulary registry
 * (client/src/lib/personaVocabulary.ts → getTerm / useTerm) already had the
 * right words ("Note pipeline", "Note opportunities", "Acquired", "Note
 * acquisition") — the surfaces just never asked it. A canonical function with
 * no adoption in the surface that needs it is not canonical (CLAUDE.md).
 *
 * ── WHAT THIS PINS ──────────────────────────────────────────────────────────
 * 1. The forbidden words are DERIVED from the registry: for every key whose
 *    land_investor value differs from some other persona's value, the land
 *    value is a land-investor term ("Deal", "Leads", "Pipeline", "Closed",
 *    "Property", "Offer", …). Add a key to the registry and it is enforced here.
 * 2. Every string the population's files RENDER is read by parsing the TSX
 *    (TypeScript's own parser — a comment is never visited, so the record of
 *    a removed string can't read as the string). No such string may contain a
 *    land-investor term as a word; the persona's word comes from the registry.
 * 3. The population is enumerated and closed: each door entry file's imports
 *    of door-local modules must be listed in POPULATION or in
 *    OUTSIDE_POPULATION with a reason, so a new panel mounted behind either
 *    door without being added here fails. Each member has a floor on the
 *    number of rendered strings read (vacuity: a parser that stops matching a
 *    file reads exactly like that file being clean).
 * 4. One canary per extraction shape the gate relies on (JSX text, string
 *    attribute, attribute expression, ternary, rendered object property,
 *    toast-style call, pluralizer argument): each hides a land term and must
 *    be found; comments, class names and test ids must not be.
 *
 * idempotent: true — pure source reads, no DB.
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { getTerm, PERSONAS, VOCABULARY_KEYS, dealStageLabel, DEAL_STAGE_ORDER } from "../../client/src/lib/personaVocabulary";
import { MOBILE_DOORS, NAV_ITEM_MAP } from "../../client/src/lib/nav-items";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

// ── The forbidden words, derived from the registry ──────────────────────────
const LAND_TERMS: string[] = Array.from(
  new Set(
    VOCABULARY_KEYS.filter((key) => {
      const land = getTerm(key, "land_investor");
      return PERSONAS.some((p) => p !== "land_investor" && getTerm(key, p) !== land);
    }).map((key) => getTerm(key, "land_investor")),
  ),
);
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const LAND_TERM_RE = new RegExp(`\\b(${LAND_TERMS.map(escape).join("|")})\\b`, "i");

/**
 * The five door names are the one place a land word is correct for every
 * persona: the doors are identical for everyone (CLAUDE.md "five fixed
 * doors") — persona changes what is behind "Deals", never the word "Deals".
 * Derived from the canonical door list, and allowed only as the WHOLE string
 * (a door eyebrow), never inside a sentence.
 */
const DOOR_NAMES = new Set(MOBILE_DOORS.map((id) => NAV_ITEM_MAP.get(id)?.label).filter((l): l is string => !!l));
const isLandCopy = (text: string) => !DOOR_NAMES.has(text.trim()) && LAND_TERM_RE.test(text);

// ── What counts as rendered ─────────────────────────────────────────────────
/** JSX attributes whose value reaches the screen or assistive technology. */
const RENDERED_ATTRS = new Set([
  "title", "label", "placeholder", "aria-label", "aria-description", "alt",
  "headline", "subtitle", "description", "confirmLabel", "message",
]);
/** Object-literal keys whose string value is display copy (toasts, sections, CTAs). */
const RENDERED_KEYS = new Set(["title", "label", "headline", "subtitle", "description", "message"]);
/** Helpers whose string arguments ARE display copy. */
const COPY_HELPERS = new Set(["plural"]);

interface RenderedString { text: string; line: number }

/**
 * Every string a TSX module renders, by syntactic position. A literal (or a
 * template's literal pieces) is rendered when — climbing through parentheses,
 * ternary branches, `??`/`||`/`&&`/`+` and template spans — it lands in a JSX
 * child expression, a rendered JSX attribute, a rendered object-literal key,
 * or a copy-helper's arguments.
 */
function renderedStrings(source: string, fileName = "x.tsx"): RenderedString[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out: RenderedString[] = [];
  const lineOf = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;

  const attrName = (a: ts.JsxAttribute) => a.name.getText(sf);
  const keyName = (p: ts.PropertyAssignment) =>
    ts.isIdentifier(p.name) || ts.isStringLiteral(p.name) ? p.name.text : "";

  function isRenderedPosition(start: ts.Node): boolean {
    let child: ts.Node = start;
    let n: ts.Node | undefined = start.parent;
    while (n) {
      if (ts.isParenthesizedExpression(n) || ts.isTemplateSpan(n) || ts.isTemplateExpression(n) || ts.isAsExpression(n)) {
        child = n; n = n.parent; continue;
      }
      if (ts.isConditionalExpression(n)) {
        if (child === n.condition) return false;
        child = n; n = n.parent; continue;
      }
      if (ts.isBinaryExpression(n)) {
        const k = n.operatorToken.kind;
        if (k === ts.SyntaxKind.QuestionQuestionToken || k === ts.SyntaxKind.BarBarToken ||
            k === ts.SyntaxKind.AmpersandAmpersandToken || k === ts.SyntaxKind.PlusToken) {
          child = n; n = n.parent; continue;
        }
        return false;
      }
      if (ts.isJsxExpression(n)) {
        const p = n.parent;
        if (p && ts.isJsxAttribute(p)) return RENDERED_ATTRS.has(attrName(p));
        return true; // a child of an element or fragment
      }
      if (ts.isJsxAttribute(n)) return RENDERED_ATTRS.has(attrName(n));
      if (ts.isPropertyAssignment(n)) return child === n.initializer && RENDERED_KEYS.has(keyName(n));
      if (ts.isCallExpression(n)) {
        const callee = n.expression;
        return ts.isIdentifier(callee) && COPY_HELPERS.has(callee.text) && n.arguments.includes(child as ts.Expression);
      }
      return false;
    }
    return false;
  }

  function visit(node: ts.Node) {
    if (ts.isJsxText(node)) {
      const text = node.text.replace(/\s+/g, " ").trim();
      if (text) out.push({ text, line: lineOf(node) });
    } else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      // Import specifiers, element/attribute names and type positions are
      // never rendered and never reach isRenderedPosition's accepting cases.
      if (node.text.trim() && isRenderedPosition(node)) out.push({ text: node.text, line: lineOf(node) });
    } else if (ts.isTemplateExpression(node)) {
      if (isRenderedPosition(node)) {
        const pieces = [node.head.text, ...node.templateSpans.map((s) => s.literal.text)];
        const text = pieces.join(" … ").trim();
        if (text.replace(/…/g, "").trim()) out.push({ text, line: lineOf(node) });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return out;
}

/**
 * A stored deal status printed as copy — `{deal.status}` or
 * `{deal.status.replace(/_/g, " ")}` — renders the land word ("closed",
 * "offer sent") without any literal for the scan above to see. That was the
 * board card's status chip. Stage names come from dealStageLabel; this finds
 * the raw-status shape in a JSX child position.
 */
function rawDealStatusRenders(source: string, fileName = "x.tsx"): number[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const lines: number[] = [];
  const isDealStatus = (e: ts.Expression): boolean => {
    let x: ts.Expression = e;
    while (ts.isNonNullExpression(x) || ts.isParenthesizedExpression(x)) x = x.expression;
    return ts.isPropertyAccessExpression(x) && x.name.text === "status" &&
      /deal/i.test(x.expression.getText(sf));
  };
  const visit = (n: ts.Node) => {
    if (ts.isJsxExpression(n) && n.expression && n.parent && !ts.isJsxAttribute(n.parent)) {
      let e: ts.Expression = n.expression;
      // `deal.status?.replace(...)`, `deal.status.toUpperCase()`, …
      while (ts.isCallExpression(e) && ts.isPropertyAccessExpression(e.expression)) e = e.expression.expression;
      if (isDealStatus(e)) lines.push(sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return lines;
}

// ── The population ──────────────────────────────────────────────────────────
/**
 * What renders at the Deals door (/deals) and the Finance door (/money, whose
 * default tab is FinancePage) — the door pages and every door-local module
 * they mount. `floor` is a lower bound on rendered strings read from the file
 * (≈ 80% of measured on 2026-10-12): if the parser stops reading a file, this
 * goes red instead of reading as clean.
 */
const POPULATION: Array<{ file: string; floor: number }> = [
  { file: "client/src/pages/deals.tsx", floor: 96 },
  { file: "client/src/components/door-sections.tsx", floor: 2 },
  { file: "client/src/components/deals/DealCoach.tsx", floor: 4 },
  { file: "client/src/components/deals/ForecastCalibration.tsx", floor: 6 },
  { file: "client/src/components/ui/deal-journey.tsx", floor: 3 },
  { file: "client/src/pages/money.tsx", floor: 6 },
  { file: "client/src/pages/finance.tsx", floor: 210 },
  { file: "client/src/components/finance/PersonaFinanceHero.tsx", floor: 76 },
  { file: "client/src/components/finance/CustomerOutcomeCard.tsx", floor: 9 },
  { file: "client/src/components/finance/FinanceBook.tsx", floor: 19 },
  { file: "client/src/components/finance/CollateralWatchPanel.tsx", floor: 9 },
  { file: "client/src/components/finance/OriginationVolumeStrip.tsx", floor: 2 },
  { file: "client/src/components/finance/SmallMultipleTwelveMonth.tsx", floor: 4 },
  { file: "client/src/components/notes-import-dialog.tsx", floor: 60 },
];

/**
 * Door-local modules the door files import that are deliberately NOT in the
 * population — each with the reason. Anything imported from these prefixes
 * and listed in neither table fails the closure check below.
 */
const OUTSIDE_POPULATION: Record<string, string> = {
  // The Finance door's secondary tabs are land-holdings tools (Monte Carlo
  // over owned parcels, acreage/property-type breakdowns, compliance by
  // property): their "property" is the land asset itself, not a persona
  // concept to translate. Tracked as known residue, not certified here.
  "client/src/pages/portfolio.tsx": "secondary Finance tab — land-holdings tool, not yet migrated",
  "client/src/pages/portfolio-optimizer.tsx": "secondary Finance tab — land-holdings tool, not yet migrated",
  "client/src/pages/cash-flow.tsx": "secondary Finance tab — forecast, not yet migrated",
  // Rendered from a deal's detail view, not the door landing.
  "client/src/components/deal-detail-content.tsx": "deal detail (/deals/:id), not the door landing",
};

/** Entry files of the two doors; their door-local imports must all be classified. */
const DOOR_ENTRIES = ["client/src/pages/deals.tsx", "client/src/pages/money.tsx", "client/src/pages/finance.tsx"];
const DOOR_LOCAL_PREFIXES = [
  "@/pages/",
  "@/components/deals/",
  "@/components/finance/",
  "@/components/door-sections",
  "@/components/ui/deal-journey",
  "@/components/notes-import-dialog",
  "@/components/deal-detail-content",
];

function resolveSpecifier(spec: string): string | null {
  const base = path.join(ROOT, "client/src", spec.slice(2));
  for (const ext of [".tsx", ".ts", "/index.tsx", "/index.ts"]) {
    if (fs.existsSync(base + ext)) return path.relative(ROOT, base + ext).split(path.sep).join("/");
  }
  return null;
}

function importsOf(rel: string): string[] {
  const sf = ts.createSourceFile(rel, read(rel), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const specs: string[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) {
      if (!n.importClause?.isTypeOnly) specs.push(n.moduleSpecifier.text);
    }
    if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword && n.arguments[0] && ts.isStringLiteral(n.arguments[0])) {
      specs.push(n.arguments[0].text);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return specs;
}

// ── Canaries: one fixture per extraction shape ─────────────────────────────
describe("renderedStrings — reads every shape the gate relies on", () => {
  const SHAPES: Record<string, string> = {
    jsxText: `export const A = () => <p>No open deals</p>;`,
    stringAttribute: `export const A = () => <Button aria-label="Open deal" />;`,
    attributeTemplate: `export const A = ({ n }: { n: number }) => <Badge title={\`\${n} deals\`} />;`,
    ternaryChild: `export const A = ({ x }: { x: boolean }) => <p>{x ? "Create deal" : "Wait"}</p>;`,
    renderedObjectKey: `export const S = [{ label: "Pipeline", href: "/deals" }];`,
    toastCall: `export function f(toast: (o: object) => void) { toast({ title: "Couldn't move deal" }); }`,
    pluralizerArg: `export const A = ({ n }: { n: number }) => <span>{plural(n, "deal")}</span>;`,
    nullishFallback: `export const A = ({ m }: { m?: string }) => <Err message={m ?? "Failed to load deals."} />;`,
  };
  for (const [shape, src] of Object.entries(SHAPES)) {
    it(`finds the land term hidden in shape: ${shape}`, () => {
      const hits = renderedStrings(src).filter((s) => isLandCopy(s.text));
      expect(hits, `${shape} must be read`).toHaveLength(1);
    });
  }

  it("finds a raw deal status printed as copy", () => {
    expect(rawDealStatusRenders(`export const A = ({ deal }: any) => <span>{deal.status?.replace(/_/g, " ")}</span>;`)).toHaveLength(1);
    expect(rawDealStatusRenders(`export const A = ({ deal }: any) => <span>{deal.status}</span>;`)).toHaveLength(1);
    expect(rawDealStatusRenders(`export const A = ({ deal }: any) => <span className={deal.status}>{label(deal.status)}</span>;`)).toHaveLength(0);
  });

  it("does not read comments, class names, test ids, keys or conditions", () => {
    const src = `
      // No open deals — the old copy, recorded in a comment
      /* Pipeline */
      export const A = ({ status }: { status: string }) => (
        <div className="deal-card pipeline" data-testid="deal-closed" key="deal">
          {status === "closed" ? <b>{"Done"}</b> : null}
        </div>
      );
      const map: Record<string, string> = { closed: "bg-pos", lead: "x" };
    `;
    expect(renderedStrings(src).filter((s) => isLandCopy(s.text))).toEqual([]);
  });
});

// ── The registry-derived term list is the one we think it is ──────────────
describe("land-investor terms are derived from the vocabulary registry", () => {
  it("door names are read from the canonical five-door model", () => {
    expect(DOOR_NAMES.size).toBe(5);
    expect(DOOR_NAMES.has("Deals")).toBe(true);
    expect(isLandCopy("Deals")).toBe(false);
    expect(isLandCopy("No open deals")).toBe(true);
  });

  it("covers the concepts the persona walk checks on these doors", () => {
    for (const t of ["Deal", "Deals", "Lead", "Leads", "Pipeline", "Closed", "Property", "Properties", "Offer"]) {
      expect(LAND_TERMS, `"${t}" must be a land-investor term`).toContain(t);
    }
  });

  it("names every deal stage through the registry (closed → the persona's terminal stage)", () => {
    for (const p of PERSONAS) {
      expect(dealStageLabel("closed", p)).toBe(getTerm("pipeline.stage.closed", p));
      expect(dealStageLabel("offer_sent", p)).toBe(`${getTerm("entity.offer", p)} sent`);
    }
    expect(dealStageLabel("closed", "note_investor")).toBe("Acquired");
    expect(DEAL_STAGE_ORDER).toContain("closed");
  });
});

// ── The gate ────────────────────────────────────────────────────────────────
describe("Deals + Finance doors render no hardcoded land-investor term", () => {
  it("the population is closed over the door files' door-local imports", () => {
    const listed = new Set([...POPULATION.map((p) => p.file), ...Object.keys(OUTSIDE_POPULATION)]);
    const unclassified: string[] = [];
    let seen = 0;
    for (const entry of DOOR_ENTRIES) {
      for (const spec of importsOf(entry)) {
        if (!DOOR_LOCAL_PREFIXES.some((p) => spec.startsWith(p))) continue;
        const rel = resolveSpecifier(spec);
        expect(rel, `${entry} imports ${spec}, which does not resolve`).not.toBeNull();
        seen++;
        if (!listed.has(rel!)) unclassified.push(`${entry} → ${rel}`);
      }
    }
    // Vacuity: the door files do import door-local modules today.
    expect(seen).toBeGreaterThanOrEqual(10);
    expect(unclassified, "add each to POPULATION (and wire its copy to the vocabulary) or to OUTSIDE_POPULATION with a reason").toEqual([]);
  });

  for (const { file, floor } of POPULATION) {
    it(`${file} renders no land-investor term`, () => {
      const strings = renderedStrings(read(file), file);
      expect(strings.length, `${file}: rendered strings read (parser vacuity floor)`).toBeGreaterThanOrEqual(floor);
      const hits = strings
        .filter((s) => isLandCopy(s.text))
        .map((s) => `${file}:${s.line} "${s.text}" — use the persona's word (useVocabulary/useTerm/dealStageLabel)`);
      expect(hits).toEqual([]);
      expect(rawDealStatusRenders(read(file), file), `${file}: a deal status printed raw — use dealStageLabel`).toEqual([]);
    });
  }

  it("the door surfaces consume the canonical vocabulary (adoption, not just absence)", () => {
    const CONSUMERS = [
      "client/src/pages/deals.tsx",
      "client/src/components/door-sections.tsx",
      "client/src/components/deals/DealCoach.tsx",
      "client/src/components/ui/deal-journey.tsx",
      "client/src/pages/finance.tsx",
      "client/src/components/finance/PersonaFinanceHero.tsx",
      "client/src/components/finance/CustomerOutcomeCard.tsx",
      "client/src/components/finance/FinanceBook.tsx",
      "client/src/components/notes-import-dialog.tsx",
    ];
    for (const f of CONSUMERS) {
      const specs = importsOf(f);
      expect(
        specs.some((s) => s === "@/hooks/use-persona" || s === "@/lib/personaVocabulary"),
        `${f} must read its persona copy from the vocabulary registry`,
      ).toBe(true);
    }
  });
});
