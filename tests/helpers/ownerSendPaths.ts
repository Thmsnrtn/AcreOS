/**
 * The population of AcreOS's outreach send paths, found by PARSING (never a
 * text scan — a parse never mistakes a comment for a call), for the owner
 * opt-out gate (tests/unit/ownerSuppressionEverySendPath.test.ts).
 *
 * A "shape" is the last step before something leaves AcreOS toward a person,
 * or before a person's record enters it:
 *   sms         a Twilio Messages.json URL; a carrier `.sendSms(` dispatch
 *   voice       a Twilio Calls.json URL; a carrier `.initiateCall(` dispatch
 *   email       `new SendRawEmailCommand(` / `new SendEmailCommand(` (SES);
 *               `sgMail.send(`; Gmail `/messages/send`; Graph `/sendMail`
 *   mail        Lob `.postcards.create(` / `.letters.create(`; the PostGrid
 *               "/letters" / "/postcards" request paths
 *   skip_trace  BatchSkipTracing / REISkip hosts; BatchData `/property/skip-trace`
 *   list_import `.insert(<leads table>)` — every lead write, alias-aware
 *
 * A shape is GUARDED when its UNIT — the nearest enclosing function that is a
 * declaration, a method, a named binding, or a route handler (callbacks passed
 * to .map / withRetry / transaction are climbed through, never treated as the
 * unit) — calls a guard BEFORE the shape. A guard in a sibling handler, after
 * the shape, or in a comment does not count; the canaries in the test prove
 * each of those goes red.
 */
import fs from "node:fs";
import ts from "typescript";
import { listServerSources, parseSource, rel } from "./serverPopulation";

export type OwnerChannel = "sms" | "voice" | "email" | "mail" | "skip_trace" | "list_import";

export const SEND_GUARDS = new Set(["assertOwnerContactAllowed", "ownerContactRefusal"]);
export const IMPORT_GUARDS = new Set(["stampOwnerSuppression"]);

export interface ShapeHit {
  file: string;
  channel: OwnerChannel;
  unit: string;
  guarded: boolean;
  line: number;
}

const STRING_SHAPES: Array<[RegExp, OwnerChannel]> = [
  [/\/Messages\.json\b/, "sms"],
  [/\/Calls\.json\b/, "voice"],
  [/\/messages\/send\b/, "email"],
  [/\/sendMail\b/, "email"],
  [/api\.sendgrid\.com\/v3\/mail\/send/, "email"],
  [/^\/(letters|postcards)$/, "mail"],
  [/api\.batchskiptracing\.com/, "skip_trace"],
  [/api\.reiskip\.com/, "skip_trace"],
  [/\/property\/skip-trace\b/, "skip_trace"],
];

function isFunctionLike(n: ts.Node): n is ts.FunctionLikeDeclaration {
  return (
    ts.isFunctionDeclaration(n) ||
    ts.isMethodDeclaration(n) ||
    ts.isFunctionExpression(n) ||
    ts.isArrowFunction(n) ||
    ts.isGetAccessorDeclaration(n) ||
    ts.isConstructorDeclaration(n)
  );
}

const ROUTE_VERBS = new Set(["get", "post", "put", "patch", "delete", "all", "use"]);

function isUnitBoundary(fn: ts.Node): boolean {
  if (ts.isFunctionDeclaration(fn) || ts.isMethodDeclaration(fn) || ts.isGetAccessorDeclaration(fn) || ts.isConstructorDeclaration(fn)) return true;
  const p = fn.parent;
  if (ts.isVariableDeclaration(p) || ts.isPropertyAssignment(p) || ts.isPropertyDeclaration(p)) return true;
  if (ts.isCallExpression(p) && p.arguments.includes(fn as ts.Expression) && ts.isPropertyAccessExpression(p.expression)) {
    return ROUTE_VERBS.has(p.expression.name.text);
  }
  return false;
}

function unitOf(node: ts.Node): ts.Node | null {
  let n: ts.Node | undefined = node.parent;
  while (n) {
    if (isFunctionLike(n) && isUnitBoundary(n)) return n;
    n = n.parent;
  }
  return null;
}

function unitName(unit: ts.Node | null, sf: ts.SourceFile): string {
  if (!unit) return "<module>";
  const u = unit as ts.FunctionLikeDeclaration;
  if (u.name && (ts.isIdentifier(u.name) || ts.isStringLiteral(u.name))) return u.name.text;
  const p = unit.parent;
  if ((ts.isVariableDeclaration(p) || ts.isPropertyAssignment(p)) && ts.isIdentifier(p.name)) return p.name.text;
  if (ts.isCallExpression(p) && ts.isPropertyAccessExpression(p.expression)) {
    const first = p.arguments[0];
    const route = first && ts.isStringLiteralLike(first) ? first.text : "?";
    return `${p.expression.name.text} ${route}`;
  }
  return `<fn@${sf.getLineAndCharacterOfPosition(unit.getStart(sf)).line + 1}>`;
}

/** Names the `leads` table is imported under in this file (alias-aware). */
function leadsTableNames(sf: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier)) continue;
    if (!/@shared\/schema$|shared\/schema(\.ts)?$/.test(st.moduleSpecifier.text)) continue;
    const nb = st.importClause?.namedBindings;
    if (!nb || !ts.isNamedImports(nb)) continue;
    for (const el of nb.elements) {
      const imported = (el.propertyName ?? el.name).text;
      if (imported === "leads") names.add(el.name.text);
    }
  }
  return names;
}

function callName(e: ts.Expression): string | null {
  if (ts.isIdentifier(e)) return e.text;
  if (ts.isPropertyAccessExpression(e)) return e.name.text;
  return null;
}

function guardBefore(unit: ts.Node | null, sf: ts.SourceFile, shapePos: number, guards: Set<string>): boolean {
  const scope = unit ?? sf;
  let found = false;
  const visit = (n: ts.Node) => {
    if (found) return;
    if (ts.isCallExpression(n) && n.getStart(sf) < shapePos) {
      const name = callName(n.expression);
      if (name && guards.has(name)) {
        found = true;
        return;
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(scope);
  return found;
}

export function scanSourceForShapes(fileLabel: string, text: string): ShapeHit[] {
  const sf = parseSource(fileLabel, text);
  const leadsNames = leadsTableNames(sf);
  const hits: ShapeHit[] = [];
  const record = (node: ts.Node, channel: OwnerChannel) => {
    const unit = unitOf(node);
    const pos = node.getStart(sf);
    hits.push({
      file: fileLabel,
      channel,
      unit: unitName(unit, sf),
      guarded: guardBefore(unit, sf, pos, channel === "list_import" ? IMPORT_GUARDS : SEND_GUARDS),
      line: sf.getLineAndCharacterOfPosition(pos).line + 1,
    });
  };
  const visit = (n: ts.Node) => {
    if (ts.isStringLiteralLike(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) {
      const t = (n as ts.LiteralLikeNode).text;
      for (const [re, ch] of STRING_SHAPES) {
        if (re.test(t)) {
          // A literal that is the route path of a registration is a route, not a send.
          record(n, ch);
          break;
        }
      }
    } else if (ts.isNewExpression(n) && ts.isIdentifier(n.expression) && /^Send(Raw)?EmailCommand$/.test(n.expression.text)) {
      record(n, "email");
    } else if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
      const name = n.expression.name.text;
      const recv = n.expression.expression;
      if (name === "create" && ts.isPropertyAccessExpression(recv) && /^(postcards|letters)$/.test(recv.name.text)) record(n, "mail");
      else if (name === "create" && ts.isParenthesizedExpression(recv)) {
        const inner = recv.expression;
        const core = ts.isAsExpression(inner) ? inner.expression : inner;
        if (ts.isPropertyAccessExpression(core) && /^(postcards|letters)$/.test(core.name.text)) record(n, "mail");
      } else if (name === "send" && ts.isIdentifier(recv) && recv.text === "sgMail") record(n, "email");
      // Carrier dispatch (`provider.sendSms(`); a class's own step method
      // (`this.sendSms(lead, …)`, the sequence processor) is not a carrier.
      else if (name === "sendSms" && recv.kind !== ts.SyntaxKind.ThisKeyword) record(n, "sms");
      else if (name === "initiateCall" && recv.kind !== ts.SyntaxKind.ThisKeyword) record(n, "voice");
      else if (name === "insert" && n.arguments.length === 1 && ts.isIdentifier(n.arguments[0]) && leadsNames.has(n.arguments[0].text)) {
        record(n, "list_import");
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return hits;
}

export function scanServerForShapes(): { files: number; hits: ShapeHit[] } {
  const files = listServerSources();
  const hits: ShapeHit[] = [];
  for (const f of files) {
    const text = fs.readFileSync(f, "utf8");
    hits.push(...scanSourceForShapes(rel(f), text));
  }
  return { files: files.length, hits };
}
