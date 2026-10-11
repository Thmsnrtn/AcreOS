/**
 * A cell a spreadsheet would run as a formula (CSV / formula injection,
 * OWASP): text starting with = + - @ or a tab / CR. Imported rows are
 * customer- and vendor-supplied (CSV, and since W5b .xlsx), so an exported
 * owner name like `=HYPERLINK("http://…","Click")` executed when the
 * customer opened the export in Excel. Neutralised with a leading
 * apostrophe. Plain numbers (`-12.50`) and phone numbers (`+1 (512) 555-0100`)
 * are data, not formulas, and pass unchanged.
 */
export function neutraliseCsvFormula(str: string): string {
  if (!/^[=+\-@\t\r]/.test(str)) return str;
  if (/^[+-]?\d+(\.\d+)?$/.test(str)) return str;
  if (/^\+[\d\s().-]+$/.test(str)) return str;
  return `'${str}`;
}
