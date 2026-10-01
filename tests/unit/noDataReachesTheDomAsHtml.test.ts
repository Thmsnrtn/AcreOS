/**
 * W10.1b — no data reaches the DOM as HTML.
 *
 * Two live sinks were found in client/src: the property map's comp popup
 * interpolated `comp.address` / `comp.apn` (outside parcel data) into
 * `Popup.setHTML`, which does not sanitize; and Pax's artifact print window
 * `document.write`-d the artifact's title and body — Pax output that carries
 * lead and customer text — into a blank window that shares the app's origin.
 * Both now build DOM text (`setDOMContent`, `textContent`).
 *
 * The rule is over the defect, not one symbol: every way this codebase can hand
 * a string to the HTML parser is a SINK, and a sink may receive only a constant
 * or `DOMPurify.sanitize(...)`. Parsed with the TypeScript compiler, so a
 * comment naming a sink (this one, the fixes' own) is never read. Each sink
 * shape has a canary below that hides the defect in it and must go red; a
 * shape without a canary is a shape this gate is free to stop reading.
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";
vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

/** Calls that parse their string argument as HTML, whatever the receiver. */
const HTML_METHODS = new Set(["setHTML", "insertAdjacentHTML", "createContextualFragment"]);
/** `document.write` / `writeln`, on `…document` or a local bound to one. */
const DOCUMENT_WRITES = new Set(["write", "writeln"]);
/** Properties (and object-literal keys) whose value is parsed as HTML. */
const HTML_PROPS = new Set(["innerHTML", "outerHTML", "srcdoc", "srcDoc", "__html"]);

/**
 * Sinks that take a non-constant, unsanitized value on purpose. Keyed by file,
 * enclosing function and shape, each with its exact count — a new sink beside
 * an exempt one, or an exempt one swapped for another, fails.
 */
const EXEMPT: Record<string, { sinks: number; why: string }> = {
  "client/src/components/ui/chart.tsx#ChartStyle#{ __html }": { sinks: 1, why: "shadcn chart: a <style> block built from the developer's chart config colours, never user data" },
  "client/src/pages/tools/calculator.tsx#CalculatorPage#{ __html }": { sinks: 1, why: "JSON-LD: JSON.stringify of a module constant into <script type=application/ld+json>" },
  "client/src/pages/tools/parcel-check.tsx#ParcelCheckSurface#{ __html }": { sinks: 1, why: "JSON-LD: JSON.stringify of a module constant into <script type=application/ld+json>" },
};

type Sink = { file: string; line: number; shape: string; where: string };

const isConstant = (e: ts.Expression): boolean =>
  ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e) || (ts.isParenthesizedExpression(e) && isConstant(e.expression));
const isSanitized = (e: ts.Expression): boolean =>
  ts.isCallExpression(e) && e.expression.getText() === "DOMPurify.sanitize";
const safe = (e: ts.Expression | undefined) => e !== undefined && (isConstant(e) || isSanitized(e));
const DOCUMENT = /(^|\.)document$/;

/** The method name a call invokes: `a.b(...)` and `a["b"](...)` alike. */
function calledName(call: ts.CallExpression): { name: string; receiver: string } | null {
  const c = call.expression;
  if (ts.isPropertyAccessExpression(c)) return { name: c.name.text, receiver: c.expression.getText() };
  if (ts.isElementAccessExpression(c) && ts.isStringLiteralLike(c.argumentExpression)) return { name: c.argumentExpression.text, receiver: c.expression.getText() };
  return null;
}
/** The property an assignment target or object-literal key names. */
function propName(n: ts.Node): string | null {
  if (ts.isPropertyAccessExpression(n)) return n.name.text;
  if (ts.isElementAccessExpression(n) && ts.isStringLiteralLike(n.argumentExpression)) return n.argumentExpression.text;
  if (ts.isIdentifier(n) || ts.isStringLiteralLike(n)) return n.text;
  if (ts.isComputedPropertyName(n) && ts.isStringLiteralLike(n.expression)) return n.expression.text;
  return null;
}
/** The nearest named function around a node — the unit an exemption names. */
function enclosing(node: ts.Node): string {
  for (let n: ts.Node | undefined = node.parent; n; n = n.parent) {
    if ((ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n)) && n.name) return n.name.getText();
    if ((ts.isArrowFunction(n) || ts.isFunctionExpression(n)) && ts.isVariableDeclaration(n.parent)) return n.parent.name.getText();
  }
  return "<module>";
}
const isAssignment = (k: ts.SyntaxKind) => k >= ts.SyntaxKind.FirstAssignment && k <= ts.SyntaxKind.LastAssignment;

/** Returns the sinks, and how many parse errors the file had (a misparse hides sinks). */
function scan(file: string, src: string): { sinks: Sink[]; parseErrors: number } {
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, /\.[jt]sx$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: Sink[] = [];
  const hit = (node: ts.Node, shape: string) =>
    out.push({ file, line: sf.getLineAndCharacterOfPosition(node.getStart()).line + 1, shape, where: enclosing(node) });
  // `const doc = win.document` — a local the file binds to a document.
  const documentAliases = new Set<string>();
  const collect = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && DOCUMENT.test(node.initializer.getText())) documentAliases.add(node.name.text);
    ts.forEachChild(node, collect);
  };
  collect(sf);
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const called = calledName(node);
      if (called && HTML_METHODS.has(called.name)) {
        // insertAdjacentHTML(position, html): the HTML is the last argument.
        if (!safe(node.arguments[node.arguments.length - 1])) hit(node, called.name);
      } else if (called && DOCUMENT_WRITES.has(called.name) && (DOCUMENT.test(called.receiver) || documentAliases.has(called.receiver))) {
        if (!node.arguments.every((a) => safe(a))) hit(node, "document.write");
      } else if (called?.name === "setAttribute") {
        const [attr, value] = node.arguments;
        if (attr && ts.isStringLiteralLike(attr) && attr.text.toLowerCase() === "srcdoc" && !safe(value)) hit(node, "setAttribute(srcdoc)");
      }
    } else if (ts.isBinaryExpression(node) && isAssignment(node.operatorToken.kind)) {
      const name = propName(node.left);
      // Any compound operator (`+=`, `||=`, `??=`) can carry data: never constant.
      if (name && HTML_PROPS.has(name) && (node.operatorToken.kind !== ts.SyntaxKind.EqualsToken || !safe(node.right))) hit(node, name);
    } else if (ts.isPropertyAssignment(node)) {
      // Object.assign(el, { innerHTML: x }), { __html: x } in JSX, createElement or a spread.
      const name = propName(node.name);
      if (name && HTML_PROPS.has(name) && !safe(node.initializer)) hit(node, `{ ${name} }`);
    } else if (ts.isShorthandPropertyAssignment(node)) {
      if (HTML_PROPS.has(node.name.text)) hit(node, `{ ${node.name.text} }`);
    } else if (ts.isJsxAttribute(node)) {
      const attr = node.name.getText();
      const init = node.initializer;
      const expr = init && ts.isJsxExpression(init) ? init.expression : undefined;
      if (attr === "dangerouslySetInnerHTML") {
        // An object literal's `__html` is judged as a property above; anything else hides it.
        if (!expr || !ts.isObjectLiteralExpression(expr)) hit(node, "dangerouslySetInnerHTML");
      } else if (attr.toLowerCase() === "srcdoc" && init && !ts.isStringLiteral(init) && !safe(expr)) {
        hit(node, "srcDoc");
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  const parseErrors = (sf as unknown as { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics?.length ?? 0;
  return { sinks: out, parseErrors };
}
const findSinks = (file: string, src: string) => scan(file, src).sinks;

const ROOT = path.resolve(process.cwd(), "client/src");
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(name) && !name.endsWith(".d.ts")) out.push(p);
  }
  return out;
}
const files = walk(ROOT).map((f) => path.relative(process.cwd(), f).split(path.sep).join("/"));
const scans = files.map((f) => ({ file: f, ...scan(f, readFileSync(f, "utf8")) }));
const sinks = scans.flatMap((s) => s.sinks);
const keyOf = (s: Sink) => `${s.file}#${s.where}#${s.shape}`;

describe("no data reaches the DOM as HTML", () => {
  it("vacuity: the whole client is the population, the fixed files included", () => {
    expect(files.length).toBeGreaterThan(500);
    for (const f of ["client/src/components/property-map.tsx", "client/src/components/pax-artifact.tsx"]) expect(files).toContain(f);
  });

  it("every file parses cleanly — a misparsed file is in the population but unread", () => {
    expect(scans.filter((s) => s.parseErrors > 0).map((s) => s.file)).toEqual([]);
    // …and the parse-error probe itself works, or the line above proves nothing.
    expect(scan("probe.ts", "const = ;").parseErrors).toBeGreaterThan(0);
  });

  it("every sink gets a constant or DOMPurify.sanitize — outside the exempt register", () => {
    const bad = sinks.filter((s) => !EXEMPT[keyOf(s)]);
    expect(bad).toEqual([]);
  });

  it("each exemption holds exactly its registered sinks — it cannot grow, move or rot", () => {
    for (const [key, { sinks: n }] of Object.entries(EXEMPT)) {
      expect(sinks.filter((s) => keyOf(s) === key).length, key).toBe(n);
    }
  });

  describe("canaries: each sink shape, with data hidden in it, is found", () => {
    const red: Array<[string, string]> = [
      ["popup.setHTML", "popup.setHTML(`<b>${comp.address}</b>`);"],
      ["popup['setHTML']", 'popup["setHTML"](comp.address);'],
      ["innerHTML =", "el.innerHTML = `<i>${name}</i>`;"],
      ["innerHTML +=", 'el.innerHTML += "<br>";'],
      ["outerHTML =", "el.outerHTML = html;"],
      ["Object.assign innerHTML", "Object.assign(el, { innerHTML: html });"],
      ["insertAdjacentHTML", 'el.insertAdjacentHTML("beforeend", html);'],
      ["document.write", "document.write(`<title>${title}</title>`);"],
      ["win.document.write", "win.document.write(html);"],
      ["document.writeln", "window.document.writeln(html);"],
      ["createContextualFragment", "range.createContextualFragment(html);"],
      ["dangerouslySetInnerHTML", "const x = <div dangerouslySetInnerHTML={{ __html: body }} />;"],
      ["dangerouslySetInnerHTML from a variable", "const x = <div dangerouslySetInnerHTML={markup} />;"],
      ["createElement __html", 'React.createElement("div", { dangerouslySetInnerHTML: { __html: body } });'],
      ["spread __html", "const x = <div {...{ dangerouslySetInnerHTML: { __html: body } }} />;"],
      ["a local bound to a document", "const doc = win.document; doc.write(html);"],
      ["shorthand { innerHTML }", "Object.assign(el, { innerHTML });"],
      ["innerHTML ||=", "el.innerHTML ||= html;"],
      ["innerHTML ??=", "el.innerHTML ??= html;"],
      ["iframe srcDoc", "const x = <iframe srcDoc={html} />;"],
      ["srcdoc property", "frame.srcdoc = html;"],
      ["setAttribute srcdoc", 'frame.setAttribute("srcdoc", html);'],
    ];
    for (const [shape, src] of red) {
      it(`red: ${shape}`, () => expect(findSinks("canary.tsx", src)).toHaveLength(1));
    }
    const green: Array<[string, string]> = [
      ["a constant innerHTML (the marker glyph)", 'el.innerHTML = `<svg viewBox="0 0 24 24"></svg>`;'],
      ["sanitized dangerouslySetInnerHTML", "const x = <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(body) }} />;"],
      ["DOM text", "div.textContent = comp.address; popup.setDOMContent(div);"],
      ["a non-document write", "stream.write(chunk);"],
      ["a comment naming a sink", "// el.innerHTML = data; popup.setHTML(x)\nconst y = 1;"],
      ["a constant srcDoc", 'const x = <iframe srcDoc="<p>hi</p>" />;'],
      ["a non-srcdoc setAttribute", 'el.setAttribute("title", name);'],
      ["a write on a non-document local", "const out = process.stdout; out.write(chunk);"],
    ];
    for (const [shape, src] of green) {
      it(`green: ${shape}`, () => expect(findSinks("canary.tsx", src)).toEqual([]));
    }
  });
});
