// shared/support/register.ts
/**
 * The support-inbox register (PKG-2 Stage 2): a state FILE (markdown, the same
 * bookkeeping pattern as the licensing watch's licensing-threads.md).
 *
 * DELIBERATELY NOT A DATABASE TABLE. If volume ever justifies a table, that is
 * a fresh founder decision that needs volume evidence — do not add one here.
 *
 * This module is the register's format + math only: pure functions over row
 * objects and register text. It performs no I/O and sends nothing.
 *
 * Clocks are [PROPOSED] until ratified (see ./triage).
 */

import {
  SUPPORT_TRIAGE_CATEGORIES,
  isClockBreached,
  type SupportTriageCategory,
} from "./triage";

export type SupportRegisterStatus = "open" | "drafted" | "answered" | "escalated" | "closed";

const STATUSES: readonly SupportRegisterStatus[] = [
  "open",
  "drafted",
  "answered",
  "escalated",
  "closed",
];

export interface SupportRegisterRow {
  /** e.g. "SUP-2026-0001" — caller-assigned, stable. */
  id: string;
  /** ISO — the MESSAGE's arrival time, never the watch-run time. */
  arrivedAt: string;
  from: string;
  subject: string;
  category: SupportTriageCategory;
  status: SupportRegisterStatus;
  /** privacy: the DSAR stamp deadline; others: the first-response deadline; null only if not yet stamped. */
  deadlineAt: string | null;
  /** Set once the PKG-1 intake creates the DSAR record for a privacy row. */
  dsarRecordId: string | null;
  reAlert50FiredAt: string | null;
  reAlert90FiredAt: string | null;
  firstResponseAt: string | null;
  /** Where the drafted reply lives / reviewer note; "" when none. */
  draftNote: string;
}

export const SUPPORT_REGISTER_HEADER = [
  "# Support inbox register",
  "",
  "State file for the support@ watch (PKG-2). No database table by design.",
  "Privacy rows carry DSAR deadline stamps.",
  "Response clocks are [PROPOSED] until ratified.",
].join("\n");

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

function oneLine(s: string): string {
  return s.replace(/\r\n|\r|\n/g, " ");
}

function nullable(v: string | null): string {
  return v === null ? "-" : v;
}

function renderRow(row: SupportRegisterRow): string {
  return [
    `### ${oneLine(row.id)}`,
    `- arrived: ${row.arrivedAt}`,
    `- from: ${oneLine(row.from)}`,
    `- subject: ${oneLine(row.subject)}`,
    `- category: ${row.category}`,
    `- status: ${row.status}`,
    `- deadline: ${nullable(row.deadlineAt)}`,
    `- dsar: ${nullable(row.dsarRecordId)}`,
    `- alert50: ${nullable(row.reAlert50FiredAt)}`,
    `- alert90: ${nullable(row.reAlert90FiredAt)}`,
    `- first-response: ${nullable(row.firstResponseAt)}`,
    `- draft: ${JSON.stringify(row.draftNote)}`,
  ].join("\n");
}

export function renderRegister(
  rows: SupportRegisterRow[],
  header: string = SUPPORT_REGISTER_HEADER,
): string {
  const head = header.replace(/\s+$/, "");
  const blocks = rows.map(renderRow);
  const parts = head.length > 0 ? [head, ...blocks] : blocks;
  return parts.join("\n\n") + "\n";
}

// ---------------------------------------------------------------------------
// Parse
// ---------------------------------------------------------------------------

const FIELD_RE = /^- ([a-z0-9-]+):(?: (.*))?$/;

function parseBlock(id: string, lines: string[]): SupportRegisterRow | null {
  const fields = new Map<string, string>();
  for (const line of lines) {
    const m = FIELD_RE.exec(line);
    if (!m) continue;
    if (!fields.has(m[1])) fields.set(m[1], m[2] ?? "");
  }

  const required = [
    "arrived",
    "from",
    "subject",
    "category",
    "status",
    "deadline",
    "dsar",
    "alert50",
    "alert90",
    "first-response",
    "draft",
  ];
  for (const k of required) if (!fields.has(k)) return null;

  const category = fields.get("category")!.trim();
  const status = fields.get("status")!.trim();
  if (!(SUPPORT_TRIAGE_CATEGORIES as readonly string[]).includes(category)) return null;
  if (!(STATUSES as readonly string[]).includes(status)) return null;

  const arrivedAt = fields.get("arrived")!.trim();
  if (arrivedAt === "" || arrivedAt === "-") return null;

  const nul = (k: string): string | null => {
    const v = fields.get(k)!.trim();
    return v === "-" || v === "" ? null : v;
  };

  let draftNote: string;
  try {
    const parsed: unknown = JSON.parse(fields.get("draft")!.trim());
    if (typeof parsed !== "string") return null;
    draftNote = parsed;
  } catch {
    return null;
  }

  return {
    id,
    arrivedAt,
    // from/subject are raw one-line text: "-" is a legitimate value, not null.
    from: fields.get("from")!,
    subject: fields.get("subject")!,
    category: category as SupportTriageCategory,
    status: status as SupportRegisterStatus,
    deadlineAt: nul("deadline"),
    dsarRecordId: nul("dsar"),
    reAlert50FiredAt: nul("alert50"),
    reAlert90FiredAt: nul("alert90"),
    firstResponseAt: nul("first-response"),
    draftNote,
  };
}

/**
 * Ignores the header prose and any non-row lines. Never throws: an unknown
 * category or a malformed block is SKIPPED — a skipped block on a hand-edited
 * register is safer than a crashed watch.
 */
export function parseRegister(text: string): SupportRegisterRow[] {
  const rows: SupportRegisterRow[] = [];
  const lines = text.split("\n").map((l) => l.replace(/\r$/, ""));

  let currentId: string | null = null;
  let buf: string[] = [];

  const flush = () => {
    if (currentId !== null) {
      const row = parseBlock(currentId, buf);
      if (row) rows.push(row);
    }
    currentId = null;
    buf = [];
  };

  for (const line of lines) {
    const h = /^### (\S.*)$/.exec(line);
    if (h) {
      flush();
      currentId = h[1].trim();
      continue;
    }
    if (currentId === null) continue;
    if (line.trim() === "") {
      flush(); // blank line ends a block
      continue;
    }
    buf.push(line);
  }
  flush();
  return rows;
}

export function upsertRow(
  rows: SupportRegisterRow[],
  row: SupportRegisterRow,
): SupportRegisterRow[] {
  const idx = rows.findIndex((r) => r.id === row.id);
  if (idx === -1) return [...rows, row];
  const next = rows.slice();
  next[idx] = row;
  return next;
}

// ---------------------------------------------------------------------------
// Digest
// ---------------------------------------------------------------------------

export interface SupportDigest {
  totalOpen: number;
  byCategory: Record<SupportTriageCategory, { open: number; closed: number; breached: number }>;
  /** Categories with breached > 0, in the fixed category order. */
  breachesByCategory: SupportTriageCategory[];
}

export function buildDigest(rows: SupportRegisterRow[], now: Date | string): SupportDigest {
  const byCategory = {} as SupportDigest["byCategory"];
  for (const c of SUPPORT_TRIAGE_CATEGORIES) byCategory[c] = { open: 0, closed: 0, breached: 0 };

  let totalOpen = 0;
  for (const row of rows) {
    const bucket = byCategory[row.category];
    if (!bucket) continue;
    if (row.status === "answered" || row.status === "closed") {
      bucket.closed += 1;
    } else {
      bucket.open += 1;
      totalOpen += 1;
    }
    if (row.deadlineAt && isClockBreached(row.deadlineAt, row.firstResponseAt, now)) {
      bucket.breached += 1;
    }
  }

  const breachesByCategory = SUPPORT_TRIAGE_CATEGORIES.filter((c) => byCategory[c].breached > 0);
  return { totalOpen, byCategory, breachesByCategory };
}

export function formatDigestBlock(digest: SupportDigest): string {
  const lines = ["**Support digest**"];
  for (const c of SUPPORT_TRIAGE_CATEGORIES) {
    const b = digest.byCategory[c];
    lines.push(`${c}: open ${b.open} · closed ${b.closed} · breached ${b.breached}`);
  }
  lines.push(`Total open: ${digest.totalOpen}`);
  lines.push(
    digest.breachesByCategory.length > 0
      ? `Breaches: ${digest.breachesByCategory.join(", ")}`
      : "Breaches: none",
  );
  return lines.join("\n");
}
