/**
 * The refusal-words gate's reader (tests/unit/refusalsArePlainWords.test.ts).
 *
 * A "refusal object" is an object literal that says an action did not happen
 * — `success` / `ok` set to anything but the literal `true` — and carries the
 * words a model relays to a person (`error` / `output` / `text`). This reader
 * PARSES the source (TypeScript compiler, never a regex: a parse never visits
 * a comment, so a comment quoting a raw refusal cannot fail the gate, and a
 * raw refusal cannot hide in one), and judges what each refusal would say with
 * the product's own checker (shared/refusal/plainRefusal.ts → judgeRefusal).
 *
 * The words must be built where they are returned, so the gate can read them:
 *   - `toolRefusal({ what, why, unlock })` / `plainRefusal({ … })` with each
 *     part a string or template literal (interpolations are filled with a
 *     neutral number and may not carry an exception's `.message`);
 *   - `toolFailure(what, unlock?)` with literal arguments;
 *   - a literal string that is itself plain;
 *   - or a REGISTERED builder, whose every output the test checks by calling it.
 * Anything else — `error: result.error`, `err.message`, a variable — is text
 * the gate cannot read, and is a violation.
 */
import ts from "typescript";
import { judgeRefusal, plainRefusal } from "../../shared/refusal/plainRefusal";
import { parseSource, unwrap } from "./serverPopulation";

const FAIL_KEYS = new Set(["success", "ok"]);
const TEXT_KEYS = new Set(["error", "output", "text"]);
const PART_BUILDERS = new Set(["toolRefusal", "plainRefusal"]);

export interface RefusalScan {
  /** Refusal objects found (fail key not `true`, plus a text key). */
  objects: number;
  /** toolRefusal / plainRefusal / toolFailure calls judged. */
  builderCalls: number;
  violations: string[];
  /** Text passed through from a registered pass-through (counted, not judged). */
  passThrough: number;
  /** Refusal objects whose words are not plain (one per object, however many problems). */
  rawObjects: number;
}

export interface RefusalScanOptions {
  /** Function names whose outputs the test verifies by calling them. */
  registeredBuilders?: ReadonlySet<string>;
  /** Identifiers / property paths whose text the test verifies by reading them. */
  registeredConstants?: ReadonlySet<string>;
  /** Property paths passed through from code outside the population (counted). */
  registeredPassThrough?: ReadonlySet<string>;
}

function propName(p: ts.ObjectLiteralElementLike): string | null {
  if (!("name" in p) || !p.name) return null;
  const n = p.name;
  if (ts.isIdentifier(n) || ts.isStringLiteral(n)) return n.text;
  return null;
}

/** The text a string-ish expression would produce, with `${…}` filled by "7"; null if not literal. */
function literalText(e: ts.Expression, why: string[]): string | null {
  e = unwrap(e);
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return e.text;
  if (ts.isTemplateExpression(e)) {
    let out = e.head.text;
    for (const span of e.templateSpans) {
      const src = span.expression.getText();
      if (/\.message\b|\berr(or)?\b(?!\w)/.test(src) && !/\bmessage\)\.join\b/.test(src)) {
        why.push(`interpolates an exception or raw error (\${${src.slice(0, 60)}})`);
      }
      out += "7" + span.literal.text;
    }
    return out;
  }
  if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const l = literalText(e.left, why);
    const r = literalText(e.right, why);
    return l != null && r != null ? l + r : null;
  }
  return null;
}

function where(sf: ts.SourceFile, n: ts.Node): string {
  const { line } = sf.getLineAndCharacterOfPosition(n.getStart(sf));
  return `${sf.fileName}:${line + 1}`;
}

function judgeParts(sf: ts.SourceFile, call: ts.CallExpression, out: string[]): void {
  const arg = call.arguments[0] ? unwrap(call.arguments[0]) : undefined;
  if (!arg || !ts.isObjectLiteralExpression(arg)) {
    out.push(`${where(sf, call)} ${call.expression.getText()}(…) is not given its three parts here`);
    return;
  }
  const parts: Record<string, string> = {};
  for (const p of arg.properties) {
    const k = propName(p);
    if (!k || !ts.isPropertyAssignment(p)) continue;
    const why: string[] = [];
    const t = literalText(p.initializer, why);
    for (const w of why) out.push(`${where(sf, p)} ${k}: ${w}`);
    if (t == null) {
      out.push(`${where(sf, p)} ${k}: is not written here (${p.initializer.getText().slice(0, 60)}), so it cannot be judged`);
      continue;
    }
    parts[k] = t;
  }
  for (const k of ["what", "why", "unlock"]) if (!(k in parts) && !out.some((o) => o.includes(`${k}:`))) out.push(`${where(sf, call)} is missing "${k}"`);
  if (parts.what && parts.why && parts.unlock) {
    const v = judgeRefusal(plainRefusal({ what: parts.what, why: parts.why, unlock: parts.unlock }));
    if (!v.plain) out.push(`${where(sf, call)} "${plainRefusal({ what: parts.what, why: parts.why, unlock: parts.unlock }).slice(0, 120)}" — ${v.problems.join("; ")}`);
  }
}

function judgeFailure(sf: ts.SourceFile, call: ts.CallExpression, out: string[]): void {
  const why: string[] = [];
  const what = call.arguments[0] ? literalText(call.arguments[0], why) : null;
  const unlock = call.arguments[1] ? literalText(call.arguments[1], why) : "Try again in a minute; if it keeps happening, open a support ticket and we will look.";
  for (const w of why) out.push(`${where(sf, call)} toolFailure: ${w}`);
  if (what == null || unlock == null) {
    out.push(`${where(sf, call)} toolFailure(…) arguments are not written here`);
    return;
  }
  const text = plainRefusal({ what, why: "The system hit a problem on our side; nothing about your account caused it", unlock });
  const v = judgeRefusal(text);
  if (!v.plain) out.push(`${where(sf, call)} "${text.slice(0, 120)}" — ${v.problems.join("; ")}`);
}

export function scanRefusals(fileName: string, source: string, opts: RefusalScanOptions = {}): RefusalScan {
  const sf = parseSource(fileName, source);
  const res: RefusalScan = { objects: 0, builderCalls: 0, violations: [], passThrough: 0, rawObjects: 0 };
  const builders = opts.registeredBuilders ?? new Set<string>();
  const constants = opts.registeredConstants ?? new Set<string>();
  const passThrough = opts.registeredPassThrough ?? new Set<string>();

  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
      if (PART_BUILDERS.has(n.expression.text)) { res.builderCalls++; judgeParts(sf, n, res.violations); }
      else if (n.expression.text === "toolFailure") { res.builderCalls++; judgeFailure(sf, n, res.violations); }
    }
    if (ts.isObjectLiteralExpression(n)) {
      let fail: ts.PropertyAssignment | null = null;
      let text: ts.PropertyAssignment | null = null;
      for (const p of n.properties) {
        const k = propName(p);
        if (!k || !ts.isPropertyAssignment(p)) continue;
        if (FAIL_KEYS.has(k)) fail = p;
        if (TEXT_KEYS.has(k)) text = p;
      }
      if (fail && text && unwrap(fail.initializer).kind !== ts.SyntaxKind.TrueKeyword) {
        res.objects++;
        const init = unwrap(text.initializer);
        const key = propName(text);
        if (ts.isCallExpression(init) && ts.isIdentifier(init.expression) && (PART_BUILDERS.has(init.expression.text) || builders.has(init.expression.text))) {
          /* parts judged by the call visitor; registered builders are called by the test */
        } else if ((ts.isIdentifier(init) || ts.isPropertyAccessExpression(init)) && constants.has(init.getText())) {
          /* registered constant — read and judged by the test */
        } else if (ts.isPropertyAccessExpression(init) && passThrough.has(init.getText())) {
          res.passThrough++;
        } else {
          const before = res.violations.length;
          const why: string[] = [];
          const t = literalText(init, why);
          for (const w of why) res.violations.push(`${where(sf, text)} ${key}: ${w}`);
          if (t == null) {
            res.violations.push(`${where(sf, text)} ${key}: passes through text that is not written here (${init.getText().slice(0, 60)})`);
          } else {
            const v = judgeRefusal(t);
            if (!v.plain) res.violations.push(`${where(sf, text)} "${t.slice(0, 100)}" — ${v.problems.join("; ")}`);
          }
          if (res.violations.length > before) res.rawObjects++;
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return res;
}

/** Cheap text prefilter, then the parse: how many refusal objects a file holds. */
export function countRefusalObjects(fileName: string, source: string): number {
  if (!/\b(success|ok)\s*:/.test(source)) return 0;
  return scanRefusals(fileName, source).objects;
}
