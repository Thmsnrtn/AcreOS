/**
 * Remove comments from SQL, outside string literals.
 *
 * SQL, not TypeScript: the canonical stripper (./stripComments) is a TS parser
 * and cannot read a migration file. Handles `--` line comments, `/* … *\/`
 * block comments, and single-quoted literals with `''` escapes, so a `--`
 * inside a string is kept. Registered in tests/unit/stripCommentsIsALexer.test.ts;
 * this is the one shared copy, not a per-gate spelling.
 */
export function stripSqlComments(sql: string): string {
  let out = "";
  for (let i = 0; i < sql.length; ) {
    const c = sql[i];
    if (c === "'") {
      let j = i + 1;
      for (; j < sql.length; j++) {
        if (sql[j] === "'" && sql[j + 1] === "'") j++;
        else if (sql[j] === "'") break;
      }
      out += sql.slice(i, j + 1);
      i = j + 1;
    } else if (c === "-" && sql[i + 1] === "-") {
      while (i < sql.length && sql[i] !== "\n") i++;
    } else if (c === "/" && sql[i + 1] === "*") {
      const end = sql.indexOf("*/", i + 2);
      i = end < 0 ? sql.length : end + 2;
      out += " ";
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

