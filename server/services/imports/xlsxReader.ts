/**
 * Minimal XLSX reader for lead imports (W5b) — the first worksheet as a header
 * row plus string cells, no dependency added.
 *
 * An .xlsx is a ZIP of XML parts (ECMA-376). This reads the ZIP through its
 * CENTRAL DIRECTORY (not the local headers: Excel, Google Sheets and
 * LibreOffice all may write a data descriptor with zero sizes in the local
 * header), inflates the four parts it needs, and walks the sheet's <row>/<c>
 * cells. Shared strings, inline strings, formula strings, booleans and numbers
 * are read; a number is returned as written in the cell (Excel stores a ZIP
 * code as a number, so "07102" arrives as "7102" — restoreZip puts the zero
 * back, as it does for CSV). Dates come through as Excel serial numbers; no
 * lead field the importer maps is a date.
 *
 * It REFUSES (throws XlsxReadError) rather than guessing: an encrypted or
 * legacy .xls file, a missing sheet, an oversize part.
 */
import zlib from "node:zlib";

export class XlsxReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "XlsxReadError";
  }
}

const MAX_PART_BYTES = 64 * 1024 * 1024;

interface CdEntry {
  name: string;
  method: number;
  compressedSize: number;
  localOffset: number;
}

function readCentralDirectory(buf: Buffer): Map<string, CdEntry> {
  // End of central directory: signature 0x06054b50, within the last 64 KiB + 22 bytes.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new XlsxReadError("This file isn't a readable .xlsx workbook (no ZIP directory). Save it as .xlsx or .csv and try again.");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = new Map<string, CdEntry>();
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) {
      throw new XlsxReadError("The workbook's ZIP directory is damaged.");
    }
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString("utf8");
    if (flags & 0x1) throw new XlsxReadError("This workbook is password-protected. Remove the password, or export it as .csv.");
    out.set(name, { name, method, compressedSize, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

function readPart(buf: Buffer, dir: Map<string, CdEntry>, name: string): string | null {
  const e = dir.get(name);
  if (!e) return null;
  if (buf.readUInt32LE(e.localOffset) !== 0x04034b50) throw new XlsxReadError("The workbook's ZIP entries are damaged.");
  const nameLen = buf.readUInt16LE(e.localOffset + 26);
  const extraLen = buf.readUInt16LE(e.localOffset + 28);
  const start = e.localOffset + 30 + nameLen + extraLen;
  const raw = buf.subarray(start, start + e.compressedSize);
  let data: Buffer;
  if (e.method === 0) data = raw;
  else if (e.method === 8) data = zlib.inflateRawSync(raw, { maxOutputLength: MAX_PART_BYTES });
  else throw new XlsxReadError(`The workbook uses a compression method (${e.method}) this importer can't read. Export it as .csv.`);
  return data.toString("utf8");
}

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, "&");
}

/** Every <t>…</t> inside one string item, concatenated (rich text has several runs). */
function textOf(xml: string): string {
  let out = "";
  for (const m of xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g)) out += m[1] ?? "";
  return decodeXml(out);
}

function columnIndex(ref: string): number {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? "";
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function firstSheetPath(buf: Buffer, dir: Map<string, CdEntry>): string {
  const workbook = readPart(buf, dir, "xl/workbook.xml");
  const rels = readPart(buf, dir, "xl/_rels/workbook.xml.rels");
  if (workbook && rels) {
    const sheet = /<sheet\b[^>]*\br:id="([^"]+)"/.exec(workbook) ?? /<sheet\b[^>]*\bid="([^"]+)"/.exec(workbook);
    if (sheet) {
      const rel = new RegExp(`<Relationship\\b[^>]*\\bId="${sheet[1]}"[^>]*\\bTarget="([^"]+)"`).exec(rels)
        ?? new RegExp(`<Relationship\\b[^>]*\\bTarget="([^"]+)"[^>]*\\bId="${sheet[1]}"`).exec(rels);
      if (rel) {
        const target = rel[1].replace(/^\//, "");
        return target.startsWith("xl/") ? target : `xl/${target}`;
      }
    }
  }
  if (dir.has("xl/worksheets/sheet1.xml")) return "xl/worksheets/sheet1.xml";
  throw new XlsxReadError("The workbook has no worksheet this importer can find.");
}

export function readXlsx(buf: Buffer, opts: { maxRows: number }): { headers: string[]; rows: string[][]; truncated: boolean } {
  if (buf.length < 22) throw new XlsxReadError("The file is empty.");
  if (buf.readUInt32LE(0) === 0xe011cfd0) {
    throw new XlsxReadError("This is an older .xls (or a password-protected) workbook. Save it as .xlsx or .csv and try again.");
  }
  const dir = readCentralDirectory(buf);
  const sheetXml = readPart(buf, dir, firstSheetPath(buf, dir));
  if (!sheetXml) throw new XlsxReadError("The workbook's first sheet is missing.");
  const sstXml = readPart(buf, dir, "xl/sharedStrings.xml");
  const shared: string[] = [];
  if (sstXml) for (const m of sstXml.matchAll(/<si>([\s\S]*?)<\/si>|<si\/>/g)) shared.push(textOf(m[1] ?? ""));

  const grid: string[][] = [];
  let truncated = false;
  for (const rowMatch of sheetXml.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const body = rowMatch[1] ?? "";
    const cells: string[] = [];
    let next = 0;
    for (const c of body.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1];
      const inner = c[2] ?? "";
      const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1];
      const col = ref ? columnIndex(ref) : next;
      const type = /\bt="([^"]+)"/.exec(attrs)?.[1] ?? "n";
      const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
      let value = "";
      if (type === "s") value = v !== undefined ? (shared[Number(v)] ?? "") : "";
      else if (type === "inlineStr") value = textOf(inner);
      else if (type === "b") value = v === "1" ? "TRUE" : v === "0" ? "FALSE" : "";
      else value = v !== undefined ? decodeXml(v) : "";
      while (cells.length < col) cells.push("");
      cells[col] = value.trim();
      next = col + 1;
    }
    grid.push(cells);
    if (grid.length > opts.maxRows + 1) {
      truncated = true;
      break;
    }
  }
  const headerIdx = grid.findIndex((r) => r.some((c) => c.length > 0));
  if (headerIdx < 0) return { headers: [], rows: [], truncated: false };
  const headers = grid[headerIdx];
  const rows = grid
    .slice(headerIdx + 1, headerIdx + 1 + opts.maxRows)
    .map((r) => headers.map((_, i) => r[i] ?? ""))
    .filter((r) => r.some((c) => c.length > 0));
  return { headers, rows, truncated };
}
