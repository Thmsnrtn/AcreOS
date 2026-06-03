/**
 * SOLENE — failure-mode library (Layer 3 capability L3.12).
 *
 * Reads the disk-backed ledger at `docs/internal/failure-modes/*.md`,
 * parses YAML frontmatter + markdown body, exposes:
 *
 *   loadFailureModeLibrary()           — read + cache all entries (60s)
 *   seedFailureModesFromDisk()         — idempotent UPSERT into DB
 *   loadFailureModePreambleFor(role, plannedFiles?)
 *                                      — render markdown preamble for a
 *                                        dispatch's system prompt
 *
 * Disk is the source of truth. The DB table mirrors for analytics + future
 * surfaces; if it ever drifts from disk, disk wins (seedFailureModesFromDisk
 * is idempotent on slug).
 *
 * The frontmatter parser is intentionally hand-rolled — js-yaml is in
 * node_modules but has no @types, and the frontmatter shape here is
 * bounded + simple (strings, arrays of strings, block scalars). Keeps the
 * dependency surface zero + the type surface fully checked.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { db } from "../../db";
import {
  soleneFailureModes,
  FAILURE_MODE_SEVERITIES,
  FAILURE_MODE_CATEGORIES,
  FAILURE_MODE_DISK_CACHE_MS,
  FAILURE_MODE_PREAMBLE_MAX_BYTES,
  type SoleneFailureModeSeverity,
  type SoleneFailureModeCategory,
} from "@shared/schema/solene-failure-modes";
import type { SoleneDispatchAgentRole } from "@shared/schema/solene-dispatch";
import { logger } from "../../utils/logger";

// ============================================================================
// Types
// ============================================================================

export interface FailureMode {
  slug: string;
  title: string;
  severity: SoleneFailureModeSeverity;
  category: SoleneFailureModeCategory;
  description: string; // markdown body
  triggerPatterns: string[];
  prevention: string;
  exampleIncidentRefs: string[];
}

export interface SeedResult {
  inserted: number;
  skipped: number; // already-present rows (slug already in DB)
}

// ============================================================================
// Config + cache
// ============================================================================

const DEFAULT_LEDGER_DIR = path.resolve(
  process.cwd(),
  "docs/internal/failure-modes",
);

function ledgerDir(): string {
  return process.env.SOLENE_FAILURE_MODE_DIR ?? DEFAULT_LEDGER_DIR;
}

interface CacheEntry {
  loadedAt: number;
  ledgerDir: string;
  modes: FailureMode[];
}
let cache: CacheEntry | null = null;

/** Test-only — clear the in-process cache. */
export function _resetFailureModeCache(): void {
  cache = null;
}

const PREAMBLE_EMPTY_FALLBACK =
  "_No failure modes on file. Operate per CLAUDE.md engineering standards._";
const PREAMBLE_TRUNCATION_SUFFIX = "\n… [truncated]";

// ============================================================================
// loadFailureModeLibrary
// ============================================================================

export async function loadFailureModeLibrary(): Promise<FailureMode[]> {
  const dir = ledgerDir();
  const now = Date.now();
  if (
    cache &&
    cache.ledgerDir === dir &&
    now - cache.loadedAt < FAILURE_MODE_DISK_CACHE_MS
  ) {
    return cache.modes;
  }

  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch (err) {
    logger.warn(
      `[failureModeLibrary] ledger dir unreadable at ${dir}: ${err instanceof Error ? err.message : String(err)}`,
    );
    cache = { loadedAt: now, ledgerDir: dir, modes: [] };
    return [];
  }

  const mdFiles = entries
    .filter((f) => f.endsWith(".md"))
    .filter((f) => f.toLowerCase() !== "readme.md")
    .sort();

  const modes: FailureMode[] = [];
  for (const file of mdFiles) {
    const fullPath = path.join(dir, file);
    try {
      const raw = await fs.readFile(fullPath, "utf8");
      const parsed = parseFrontmatterDoc(raw, file);
      if (parsed) modes.push(parsed);
    } catch (err) {
      logger.warn(
        `[failureModeLibrary] failed to read ${fullPath}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  cache = { loadedAt: now, ledgerDir: dir, modes };
  return modes;
}

// ============================================================================
// seedFailureModesFromDisk — UPSERT into Postgres from disk.
//
// TODO(Solene follow-up): wire this into the worker boot path
// (server/worker.ts or server/jobs/runScheduledJobs.ts) so the DB mirror is
// refreshed on every deploy. This commit leaves the call ungated because
// the cron + worker registration files are frozen this wave.
// ============================================================================

export async function seedFailureModesFromDisk(): Promise<SeedResult> {
  const modes = await loadFailureModeLibrary();
  let inserted = 0;
  let skipped = 0;

  for (const m of modes) {
    try {
      // Look up first to distinguish insert vs skip in the returned count.
      const existing = await db
        .select({ id: soleneFailureModes.id })
        .from(soleneFailureModes)
        .where(eq(soleneFailureModes.slug, m.slug))
        .limit(1);

      if (existing.length > 0) {
        // Refresh non-key columns so disk changes propagate.
        await db
          .update(soleneFailureModes)
          .set({
            title: m.title,
            severity: m.severity,
            category: m.category,
            description: m.description,
            triggerPatterns: m.triggerPatterns,
            prevention: m.prevention,
            exampleIncidentRefs: m.exampleIncidentRefs,
            retiredAt: null,
          })
          .where(eq(soleneFailureModes.slug, m.slug));
        skipped += 1;
        continue;
      }

      await db.insert(soleneFailureModes).values({
        slug: m.slug,
        title: m.title,
        severity: m.severity,
        category: m.category,
        description: m.description,
        triggerPatterns: m.triggerPatterns,
        prevention: m.prevention,
        exampleIncidentRefs: m.exampleIncidentRefs,
      });
      inserted += 1;
    } catch (err) {
      logger.warn(
        `[failureModeLibrary] upsert failed for slug=${m.slug}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return { inserted, skipped };
}

// ============================================================================
// loadFailureModePreambleFor — markdown for the dispatch system prompt.
//
// Always include the top-3 critical/high failure modes. If `plannedFiles` is
// provided, additionally surface entries whose trigger_patterns substring-
// match any of those paths.
// ============================================================================

export async function loadFailureModePreambleFor(
  _agentRole: SoleneDispatchAgentRole,
  plannedFiles?: string[],
): Promise<string> {
  void _agentRole; // role-specific weighting is a future hook
  const modes = await loadFailureModeLibrary();
  if (modes.length === 0) return PREAMBLE_EMPTY_FALLBACK;

  const selected = selectRelevantModes(modes, plannedFiles);
  if (selected.length === 0) return PREAMBLE_EMPTY_FALLBACK;

  const lines: string[] = [];
  for (const m of selected) {
    lines.push(
      `### [${m.severity.toUpperCase()}] ${m.title} (\`${m.slug}\`)`,
      "",
      `- **Category**: ${m.category}`,
      `- **Triggers**: ${
        m.triggerPatterns.length > 0
          ? m.triggerPatterns.map((p) => `\`${p}\``).join(", ")
          : "_(none specified)_"
      }`,
      `- **Prevention**: ${collapseWs(m.prevention)}`,
      "",
    );
  }

  let block = lines.join("\n").trimEnd();
  if (Buffer.byteLength(block, "utf8") > FAILURE_MODE_PREAMBLE_MAX_BYTES) {
    const buf = Buffer.from(block, "utf8");
    const room =
      FAILURE_MODE_PREAMBLE_MAX_BYTES -
      Buffer.byteLength(PREAMBLE_TRUNCATION_SUFFIX, "utf8");
    block =
      buf.slice(0, Math.max(0, room)).toString("utf8") +
      PREAMBLE_TRUNCATION_SUFFIX;
  }
  return block;
}

// Internal: rank failure modes by relevance for the upcoming dispatch.
function selectRelevantModes(
  modes: FailureMode[],
  plannedFiles: string[] | undefined,
): FailureMode[] {
  const severityRank: Record<SoleneFailureModeSeverity, number> = {
    critical: 4,
    high: 3,
    medium: 2,
    low: 1,
  };

  // 1. Top-3 by severity (critical+high always included).
  const bySeverity = [...modes]
    .filter((m) => m.severity === "critical" || m.severity === "high")
    .sort((a, b) => severityRank[b.severity] - severityRank[a.severity])
    .slice(0, 3);

  // 2. Pattern-matched modes (any trigger_pattern is a substring of any
  //    planned-file path).
  const matched: FailureMode[] = [];
  if (plannedFiles && plannedFiles.length > 0) {
    for (const m of modes) {
      if (bySeverity.includes(m)) continue;
      const hit = m.triggerPatterns.some((p) =>
        plannedFiles.some((f) => f.includes(p) || p.includes(f)),
      );
      if (hit) matched.push(m);
    }
  }

  // Merge: severity-top first, then pattern-matched, dedupe by slug.
  const seen = new Set<string>();
  const out: FailureMode[] = [];
  for (const m of [...bySeverity, ...matched]) {
    if (seen.has(m.slug)) continue;
    seen.add(m.slug);
    out.push(m);
  }
  return out;
}

// ============================================================================
// Frontmatter parser — bounded YAML subset.
//
// Supports:
//   key: value                       (scalar)
//   key: |                           (block scalar — captures multi-line)
//     multi
//     line
//   key:                             (array)
//     - item
//     - item
//
// Anything else (anchors, flow style, nested mappings) is intentionally
// rejected. The frontmatter shape is bounded by the schema in
// docs/internal/failure-modes/README.md.
// ============================================================================

const FRONTMATTER_OPEN = /^---\s*$/;
const FRONTMATTER_CLOSE = /^---\s*$/;

function parseFrontmatterDoc(
  raw: string,
  filename: string,
): FailureMode | null {
  const lines = raw.split(/\r?\n/);
  if (lines.length === 0 || !FRONTMATTER_OPEN.test(lines[0] ?? "")) {
    logger.warn(`[failureModeLibrary] ${filename}: missing frontmatter open`);
    return null;
  }

  let closeIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (FRONTMATTER_CLOSE.test(lines[i] ?? "")) {
      closeIdx = i;
      break;
    }
  }
  if (closeIdx === -1) {
    logger.warn(`[failureModeLibrary] ${filename}: missing frontmatter close`);
    return null;
  }

  const fmLines = lines.slice(1, closeIdx);
  const body = lines.slice(closeIdx + 1).join("\n").trim();

  const fm = parseFrontmatterBlock(fmLines, filename);
  if (!fm) return null;

  const slug = stringField(fm, "slug", filename);
  const title = stringField(fm, "title", filename);
  const severity = stringField(fm, "severity", filename);
  const category = stringField(fm, "category", filename);
  const prevention = stringField(fm, "prevention", filename);
  if (!slug || !title || !severity || !category || !prevention) return null;

  if (!(FAILURE_MODE_SEVERITIES as readonly string[]).includes(severity)) {
    logger.warn(
      `[failureModeLibrary] ${filename}: unknown severity=${severity}; coercing to medium`,
    );
  }
  if (!(FAILURE_MODE_CATEGORIES as readonly string[]).includes(category)) {
    logger.warn(
      `[failureModeLibrary] ${filename}: unknown category=${category}; coercing to other`,
    );
  }

  return {
    slug,
    title,
    severity: (FAILURE_MODE_SEVERITIES as readonly string[]).includes(severity)
      ? (severity as SoleneFailureModeSeverity)
      : "medium",
    category: (FAILURE_MODE_CATEGORIES as readonly string[]).includes(category)
      ? (category as SoleneFailureModeCategory)
      : "other",
    description: body,
    triggerPatterns: arrayField(fm, "trigger_patterns"),
    prevention,
    exampleIncidentRefs: arrayField(fm, "example_incident_refs"),
  };
}

type ParsedField =
  | { kind: "scalar"; value: string }
  | { kind: "array"; value: string[] };

function parseFrontmatterBlock(
  lines: string[],
  filename: string,
): Record<string, ParsedField> | null {
  const out: Record<string, ParsedField> = {};
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (line.trim() === "") {
      i += 1;
      continue;
    }
    // top-level keys have no leading whitespace.
    const m = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*):\s*(.*)$/);
    if (!m) {
      logger.warn(
        `[failureModeLibrary] ${filename}: unparsable frontmatter line ${i + 1}: ${line}`,
      );
      return null;
    }
    const key = m[1];
    const rest = (m[2] ?? "").trim();

    if (rest === "|") {
      // Block scalar — consume indented lines.
      const collected: string[] = [];
      let j = i + 1;
      while (j < lines.length) {
        const next = lines[j] ?? "";
        if (next.length === 0) {
          collected.push("");
          j += 1;
          continue;
        }
        if (!/^\s+/.test(next)) break;
        collected.push(next.replace(/^\s\s/, "").replace(/^\s/, ""));
        j += 1;
      }
      out[key] = { kind: "scalar", value: collected.join("\n").trim() };
      i = j;
      continue;
    }

    if (rest === "") {
      // Array — consume `  - item` lines.
      const items: string[] = [];
      let j = i + 1;
      while (j < lines.length) {
        const next = lines[j] ?? "";
        if (next.trim() === "") {
          j += 1;
          continue;
        }
        const am = next.match(/^\s+-\s+(.*)$/);
        if (!am) break;
        items.push(stripQuotes(am[1].trim()));
        j += 1;
      }
      out[key] = { kind: "array", value: items };
      i = j;
      continue;
    }

    // Scalar inline.
    out[key] = { kind: "scalar", value: stripQuotes(rest) };
    i += 1;
  }
  return out;
}

function stringField(
  fm: Record<string, ParsedField>,
  key: string,
  filename: string,
): string {
  const field = fm[key];
  if (!field) {
    logger.warn(`[failureModeLibrary] ${filename}: missing required key ${key}`);
    return "";
  }
  if (field.kind !== "scalar") {
    logger.warn(
      `[failureModeLibrary] ${filename}: key ${key} must be a scalar`,
    );
    return "";
  }
  return field.value;
}

function arrayField(
  fm: Record<string, ParsedField>,
  key: string,
): string[] {
  const field = fm[key];
  if (!field) return [];
  if (field.kind === "array") return field.value;
  // Tolerate a single-scalar value as a one-element array.
  return [field.value];
}

function stripQuotes(s: string): string {
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    return s.slice(1, -1);
  }
  return s;
}

function collapseWs(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

// Keep tree-shaker happy for downstream queries.
void sql;
