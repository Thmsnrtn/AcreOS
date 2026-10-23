/**
 * Remove `<!-- … -->` comments from HTML.
 *
 * HTML, not TypeScript: the canonical stripper (./stripComments) is a TS parser
 * and cannot read index.html. One forward pass, as a browser parses: the text
 * either side of a removed comment stays text even if it spells `<!--` once
 * joined (it renders, so a claim in it is a visible claim), and an unterminated
 * comment runs to the end of the input. Registered in tests/unit/stripCommentsIsALexer.test.ts; this is the
 * one shared copy, not a per-gate spelling.
 */
export function stripHtmlComments(html: string): string {
  let out = "";
  let i = 0;
  while (i < html.length) {
    const open = html.indexOf("<!--", i);
    if (open === -1) {
      out += html.slice(i);
      break;
    }
    out += html.slice(i, open);
    const close = html.indexOf("-->", open + 4);
    if (close === -1) break;
    i = close + 3;
  }
  return out;
}
