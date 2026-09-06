//
// Detects a hand-rolled comment stripper — by SHAPE, not by spelling.
//
// This file is the one place in the repository that names the block-comment
// delimiters in order to look for them. It is therefore an offender by its own
// arm 2, and `stripCommentsIsALexer.test.ts` exempts it EXPLICITLY, by function
// name, asserting the exemption still resolves — rather than letting it hide by
// building the delimiters out of concatenated halves. A hole you can read is
// worth more than one you cannot.
//
// Everything it looks at is an AST node — an identifier, a string literal, a
// regex literal — so it never visits a comment, and structurally cannot read
// its own documentation as the defect it hunts.
//
// Three independent arms, because a stripper can hide from any one of them:
//
//   named               the function says what it is, whatever the body does
//   delimiter-literals  block-delimiter index surgery, under any name
//   delimiter-regex     a regex matching ANY block comment, however assigned
//
import ts from "typescript";

export type StripperArm = "named" | "delimiter-regex" | "delimiter-literals";
export type StripperFinding = { arm: StripperArm; detail: string };

/** A register entry exempts ONE function in ONE file, with its reason. */
export type StripperExemption = { file: string; fn: string; why: string };

/**
 * A name that says "this function is about comments".
 *
 * This was a VERB ALLOWLIST — strip|scrub|mask|clean|remove|drop|kill — which is
 * a spelling gate wearing a shape gate's clothes, and it proved it: falsifying
 * arm 1 with `function purgeComments` left the gate green, because "purge" was
 * not on the list. The fixture had used a verb FROM the list, so the arm looked
 * falsified while testing only its own vocabulary.
 *
 * Any verb, then. The cost is that predicates ABOUT comments — `isWholeLineComment`,
 * `hasAdjacentSourceComment`, `canDeleteComment` — now match the name, so they are
 * excluded by shape instead: a question about comments is not an implementation
 * that removes them, and that distinction needs no register entry to maintain.
 */
export const STRIPPER_NAME = /comments?/i;

/** `isX`, `hasX`, `canX`… — asks a question, does not rewrite a source. */
export const PREDICATE_NAME = /^(is|has|can|should|was|were|does|did|must|will|are)[A-Z_]/;

export function parseSource(source: string, file: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    /\.tsx$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

/**
 * Does this regex match ANY block comment, or one PARTICULAR one?
 *
 * The discriminator is what sits between the two escaped delimiters. A general
 * matcher holds only wildcards (`[\s\S]*?`, `.*?`); a regex hunting one specific
 * comment holds its words. Character classes and backslash escapes are removed
 * first — `[\s\S]` is letters, and counting them as content would exempt the
 * exact idiom this arm exists to catch.
 */
export function isGeneralBlockCommentRegex(body: string): boolean {
  const m = /\\\/\\\*([\s\S]*?)\\\*\\\//.exec(body);
  if (!m) return false;
  const middle = m[1]
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\\./g, "");
  return !/[A-Za-z0-9]/.test(middle);
}

export function localStripperFindings(
  source: string,
  file: string,
  register: ReadonlyArray<StripperExemption> = [],
): StripperFinding[] {
  const sf = parseSource(source, file);

  // Identifiers imported from a canonical stripper module. A function that
  // calls one of them is a wrapper, not a second implementation.
  const delegatesTo = new Set<string>();
  ts.forEachChild(sf, (n) => {
    if (!ts.isImportDeclaration(n) || !ts.isStringLiteral(n.moduleSpecifier)) return;
    if (!/strip-?comments/i.test(n.moduleSpecifier.text)) return;
    const bindings = n.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const el of bindings.elements) delegatesTo.add(el.name.text);
    }
  });
  const delegates = (fn: ts.Node) => {
    const text = fn.getText(sf);
    return [...delegatesTo].some((c) => new RegExp(`\\b${c}\\s*\\(`).test(text));
  };

  const isFnLike = (n: ts.Node): n is ts.SignatureDeclaration =>
    ts.isFunctionDeclaration(n) ||
    ts.isFunctionExpression(n) ||
    ts.isArrowFunction(n) ||
    ts.isMethodDeclaration(n);

  const nameOf = (n: ts.Node): string => {
    if (
      (ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n) || ts.isFunctionExpression(n)) &&
      n.name
    ) {
      return n.name.getText(sf);
    }
    const p = n.parent;
    if (p && ts.isVariableDeclaration(p) && p.name) return p.name.getText(sf);
    if (p && ts.isPropertyAssignment(p) && p.name) return p.name.getText(sf);
    return "";
  };

  const registeredName = (fn: string) =>
    register.some((r) => file.endsWith(r.file) && r.fn === fn);

  /**
   * A registered function covers the helpers declared INSIDE it. Without this
   * the register would exempt `localStripperFindings` while its own nested
   * `visit` and `scanLiterals` still reported the file — an exemption that
   * names a function but not the thing that function is made of.
   */
  const exemptAt = (n: ts.Node): boolean => {
    for (let p: ts.Node | undefined = n; p; p = p.parent) {
      if (isFnLike(p) && registeredName(nameOf(p))) return true;
    }
    return false;
  };

  const findings: StripperFinding[] = [];
  const visit = (n: ts.Node) => {
    if (isFnLike(n)) {
      const name = nameOf(n);
      const exempt = exemptAt(n);

      if (
        name &&
        STRIPPER_NAME.test(name) &&
        !PREDICATE_NAME.test(name) &&
        !exempt &&
        !delegates(n)
      ) {
        findings.push({ arm: "named", detail: name });
      }

      let open = false;
      let close = false;
      const scanLiterals = (x: ts.Node) => {
        if (ts.isStringLiteral(x) || ts.isNoSubstitutionTemplateLiteral(x)) {
          if (x.text === "/*") open = true;
          if (x.text === "*/") close = true;
        }
        ts.forEachChild(x, scanLiterals);
      };
      ts.forEachChild(n, scanLiterals);
      if (open && close && !exempt && !delegates(n)) {
        findings.push({ arm: "delimiter-literals", detail: name || "(anonymous)" });
      }
    }

    if (ts.isRegularExpressionLiteral(n) && isGeneralBlockCommentRegex(n.text)) {
      if (!exemptAt(n)) {
        findings.push({ arm: "delimiter-regex", detail: n.text.slice(0, 48) });
      }
    }
    ts.forEachChild(n, visit);
  };
  ts.forEachChild(sf, visit);
  return findings;
}
