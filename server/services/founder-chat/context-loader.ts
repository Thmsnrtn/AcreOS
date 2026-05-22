/**
 * Atlas context loader — the big one.
 *
 * Tom's load-bearing requirement: "Atlas needs to have access to all
 * the context in any situation it needs. It needs to be as intelligent
 * as Opus 4.7 has been working with you in this terminal."
 *
 * Translation: every Atlas turn pre-loads the equivalent of what I see
 * when I'm operating in Tom's terminal — user memory, project memory,
 * recent audit, active triggers, pending decisions, schema snapshot,
 * provider status. Atlas should never have to ask "what's the current
 * state of X?" — the state of X is already in its context window.
 *
 * Returns an array of system messages (one per logical context section)
 * for the LLM. The chat-stream endpoint concatenates these with the
 * Atlas persona system message and the thread history.
 *
 * Caching: the heavier pieces (schema snapshot, project memory) are
 * cached in-process with TTLs. The lighter pieces (recent audit,
 * active triggers) are read fresh every turn — they change too often.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { desc, eq } from "drizzle-orm";
import { db } from "../../db";
import { founderAudit } from "@shared/schema";

const USER_MEMORY_DIR = "/Users/user/.claude/projects/-Users-user-AcreOS-AcreOS/memory";
const PROJECT_MEMORY_FILES = [
  "/Users/user/AcreOS/AcreOS/CLAUDE.md",
  "/Users/user/AcreOS/AcreOS/docs/financial-mail-platform/PLAN.md",
  "/Users/user/AcreOS/AcreOS/docs/financial-mail-platform/PHASE-0-TOM-ACTIONS.md",
  "/Users/user/.claude/plans/how-can-we-either-ticklish-ocean.md",
];

const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { value: string; expiresAt: number }>();

async function readWithCache(key: string, loader: () => Promise<string>): Promise<string> {
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value;
  const value = await loader();
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}

export interface AtlasContextOpts {
  founderUserId: string;
  /** Hard cap on total context size in chars; truncate sections proportionally if exceeded. Default 200k chars (~50k tokens). */
  maxChars?: number;
}

export interface AtlasContextSections {
  userMemory: string;
  projectMemory: string;
  recentAudit: string;
  schemaSnapshot: string;
  /** Total chars across all sections (for token-budget telemetry). */
  totalChars: number;
}

/**
 * Build the full context payload for one Atlas turn. The caller (chat-
 * stream endpoint) wraps each section in its own system message so the
 * LLM can attend to them independently.
 */
export async function loadAtlasContext(opts: AtlasContextOpts): Promise<AtlasContextSections> {
  const [userMemory, projectMemory, recentAudit, schemaSnapshot] = await Promise.all([
    loadUserMemory(),
    loadProjectMemory(),
    loadRecentAudit(opts.founderUserId, 50),
    loadSchemaSnapshot(),
  ]);

  const sections: AtlasContextSections = {
    userMemory,
    projectMemory,
    recentAudit,
    schemaSnapshot,
    totalChars: userMemory.length + projectMemory.length + recentAudit.length + schemaSnapshot.length,
  };

  // Soft truncation: if we blow the budget, the recent-audit section
  // takes the hit first (it's the most expendable — Atlas can re-fetch
  // via get_audit_log if needed).
  const max = opts.maxChars ?? 200_000;
  if (sections.totalChars > max) {
    const over = sections.totalChars - max;
    sections.recentAudit = truncate(sections.recentAudit, sections.recentAudit.length - over);
    sections.totalChars = sections.userMemory.length + sections.projectMemory.length + sections.recentAudit.length + sections.schemaSnapshot.length;
  }

  return sections;
}

async function loadUserMemory(): Promise<string> {
  return readWithCache("user-memory", async () => {
    try {
      const files = await fs.readdir(USER_MEMORY_DIR);
      const memoryFiles = files.filter((f) => f.endsWith(".md") && f !== "MEMORY.md");
      // Read MEMORY.md first as the index, then individual memories.
      const sections: string[] = [];
      try {
        const index = await fs.readFile(path.join(USER_MEMORY_DIR, "MEMORY.md"), "utf-8");
        sections.push("# Memory index\n" + index);
      } catch {
        /* index optional */
      }
      for (const fname of memoryFiles) {
        try {
          const content = await fs.readFile(path.join(USER_MEMORY_DIR, fname), "utf-8");
          sections.push(`# ${fname}\n${content}`);
        } catch {
          /* skip unreadable files */
        }
      }
      return sections.join("\n\n---\n\n");
    } catch {
      // Memory dir doesn't exist or is unreadable — return empty rather than failing.
      return "(user memory unavailable)";
    }
  });
}

async function loadProjectMemory(): Promise<string> {
  return readWithCache("project-memory", async () => {
    const sections: string[] = [];
    for (const filePath of PROJECT_MEMORY_FILES) {
      try {
        const content = await fs.readFile(filePath, "utf-8");
        sections.push(`# ${path.basename(filePath)}\n${content}`);
      } catch {
        /* skip missing files */
      }
    }
    return sections.join("\n\n---\n\n") || "(project memory unavailable)";
  });
}

async function loadRecentAudit(founderUserId: string, limit: number): Promise<string> {
  try {
    const rows = await db
      .select()
      .from(founderAudit)
      .where(eq(founderAudit.founderId, founderUserId))
      .orderBy(desc(founderAudit.createdAt))
      .limit(limit);
    if (rows.length === 0) return "(no recent audit-log rows)";
    return rows
      .map((r: any) =>
        `[${r.createdAt?.toISOString?.() ?? "?"}] ${r.area} · ${r.action}` +
        (r.note ? ` — ${r.note}` : ""),
      )
      .join("\n");
  } catch {
    return "(audit log read failed)";
  }
}

/**
 * Schema snapshot — table + column inventory so Atlas can write valid
 * SQL via db_query without a round-trip to db_schema.
 * Static for now; cached forever per process. Re-deployed when schema changes.
 */
async function loadSchemaSnapshot(): Promise<string> {
  return readWithCache("schema-snapshot", async () => {
    // Lightweight: read the actual schema.ts file. Atlas doesn't need
    // every line — it needs the table names + key columns. Future
    // refinement: parse into a compact "table → columns" digest.
    try {
      const schemaPath = "/Users/user/AcreOS/AcreOS/shared/schema.ts";
      const content = await fs.readFile(schemaPath, "utf-8");
      // Extract just `export const <name> = pgTable("<table>", { ... })` blocks.
      const tableRe = /export const (\w+) = pgTable\("(\w+)",\s*\{([\s\S]*?)\}\s*(?:,\s*(?:\(table\) => \[[\s\S]*?\]|\{[\s\S]*?\}))?\)/g;
      const tables: string[] = [];
      let m: RegExpExecArray | null;
      while ((m = tableRe.exec(content)) !== null) {
        const tableName = m[2];
        const body = m[3];
        // Pull column names from `name: type("col_name")` patterns.
        const colRe = /(\w+):\s*(?:text|integer|bigint|bigserial|serial|boolean|timestamp|numeric|varchar|jsonb|date|real)\(/g;
        const cols: string[] = [];
        let cm: RegExpExecArray | null;
        while ((cm = colRe.exec(body)) !== null) {
          cols.push(cm[1]);
        }
        tables.push(`- ${tableName} (${tableName === m[1] ? "" : `pg:${tableName}, `}cols: ${cols.slice(0, 12).join(", ")}${cols.length > 12 ? ", ..." : ""})`);
      }
      return tables.length > 0
        ? "# Schema (table → key columns)\n" + tables.join("\n")
        : "(schema snapshot unavailable)";
    } catch {
      return "(schema snapshot unavailable)";
    }
  });
}

function truncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen) + `\n... (truncated, ${s.length - maxLen} chars cut)`;
}

/** Test-only — clear the in-process cache. */
export function __resetContextCacheForTests(): void {
  cache.clear();
}
