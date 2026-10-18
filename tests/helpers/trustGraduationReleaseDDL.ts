import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";

/** Read executable literal statements, never comments or the historical SQL.
 * These tables have no external prerequisites, so an isolated empty schema
 * can prove the release path without the base migrations masking an omission.
 */
export function trustGraduationReleaseDDL(): string[] {
  const source = ts.createSourceFile("migrate.mjs", readFileSync(resolve(__dirname, "../../scripts/migrate.mjs"), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  let statements: string[] = [];
  for (const node of source.statements) {
    if (!ts.isVariableStatement(node)) continue;
    for (const declaration of node.declarationList.declarations) {
      if (declaration.name.getText(source) !== "STATEMENTS" || !declaration.initializer || !ts.isArrayLiteralExpression(declaration.initializer)) continue;
      statements = declaration.initializer.elements.flatMap(e => ts.isStringLiteralLike(e) ? [e.text] : []);
    }
  }
  return statements.filter(s => /^CREATE\s+(?:TABLE|(?:UNIQUE\s+)?INDEX)\b/i.test(s) && /"agent_(?:action_graduations|proposal_observations)"/.test(s));
}
