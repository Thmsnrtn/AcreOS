/**
 * Pillar T — Schema drift detector.
 *
 * Compares the live pg_catalog against shared/schema.ts (indexed via
 * the existing schema-column validator infra). Detects:
 *   - drizzle tables that don't exist in the live DB (missing migration)
 *   - columns declared in schema.ts but missing in pg_catalog
 *   - columns in pg_catalog that aren't declared in schema.ts (drift
 *     introduced via ad-hoc SQL)
 *
 * Read-only. On detection writes a `medium`-severity inbox item; no
 * auto-reconciliation (schema migrations need founder review).
 */

import { db } from "../db";
import { agentEvents, decisionsInboxItems } from "@shared/schema";
import { sql } from "drizzle-orm";
import { logger } from "../utils/logger";
import { Project, Node } from "ts-morph";
import path from "node:path";
import { fileURLToPath } from "node:url";

// @ts-expect-error — pure-Node .mjs helper, no type decls
import { discoverSchemaFiles } from "../../scripts/schema-files.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCHEMA_FILE = path.resolve(__dirname, "../../shared/schema.ts");

export interface SchemaFinding {
  kind: "missing_table" | "missing_column" | "orphan_column";
  table: string;
  column?: string;
  message: string;
}

function indexSchemaSource(): Map<string, Set<string>> {
  const project = new Project({
    skipFileDependencyResolution: true,
    skipAddingFilesFromTsConfig: true,
  });
  // Unified discovery (scripts/schema-files.mjs): schema.ts + schema/*.ts +
  // models/*.ts, so drift on the `users` table (shared/models/auth.ts) — the
  // one that caused the production login outages — is finally detected too.
  // Falls back to shared/schema.ts alone if the helper resolves nothing (e.g. a
  // bundled runtime where only that path exists).
  const schemaFiles: string[] = (discoverSchemaFiles() as string[]);
  const filesToIndex = schemaFiles.length > 0 ? schemaFiles : [SCHEMA_FILE];
  const tables = new Map<string, Set<string>>();
  for (const schemaFile of filesToIndex) {
    let source;
    try {
      source = project.addSourceFileAtPath(schemaFile);
    } catch {
      continue; // unreadable in this context — skip, never crash the daily job
    }
  for (const v of source.getVariableStatements()) {
    for (const decl of v.getDeclarations()) {
      const init = decl.getInitializer();
      if (!init || !Node.isCallExpression(init)) continue;
      if (init.getExpression().getText() !== "pgTable") continue;
      const args = init.getArguments();
      if (args.length < 2) continue;
      const nameArg = args[0];
      if (!Node.isStringLiteral(nameArg)) continue;
      const tableName = nameArg.getLiteralText();
      const colsArg = args[1];
      if (!Node.isObjectLiteralExpression(colsArg)) continue;
      const cols = new Set<string>();
      for (const p of colsArg.getProperties()) {
        if (Node.isPropertyAssignment(p)) {
          const propInit = p.getInitializer();
          if (propInit && Node.isCallExpression(propInit)) {
            // The column builder calls look like `text("col_name")...` —
            // we want the SQL column name (first string arg).
            const sqlNameArg = propInit.getArguments()[0];
            if (sqlNameArg && Node.isStringLiteral(sqlNameArg)) {
              cols.add(sqlNameArg.getLiteralText());
            }
          }
        }
      }
      tables.set(tableName, cols);
    }
  }
  }
  return tables;
}

async function indexPgCatalog(): Promise<Map<string, Set<string>>> {
  const rows = await db.execute<{ table_name: string; column_name: string }>(
    sql`SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'`,
  );
  const tables = new Map<string, Set<string>>();
  for (const r of rows.rows as Array<{ table_name: string; column_name: string }>) {
    const set = tables.get(r.table_name) ?? new Set<string>();
    set.add(r.column_name);
    tables.set(r.table_name, set);
  }
  return tables;
}

export async function detectSchemaDrift(): Promise<SchemaFinding[]> {
  const schemaTables = indexSchemaSource();
  const dbTables = await indexPgCatalog();
  const findings: SchemaFinding[] = [];

  for (const [tableName, cols] of schemaTables) {
    const dbCols = dbTables.get(tableName);
    if (!dbCols) {
      findings.push({
        kind: "missing_table",
        table: tableName,
        message: `Table "${tableName}" is declared in shared/schema.ts but does not exist in the live database — a migration probably hasn't been applied.`,
      });
      continue;
    }
    for (const col of cols) {
      if (!dbCols.has(col)) {
        findings.push({
          kind: "missing_column",
          table: tableName,
          column: col,
          message: `Column ${tableName}.${col} is declared in shared/schema.ts but not present in the live database.`,
        });
      }
    }
    // Orphan columns — present in DB but not in schema.ts. These are
    // common (legacy fields kept for compatibility) so we only flag
    // ones that look generated by drizzle (snake-case multi-word).
    for (const dbCol of dbCols) {
      if (!cols.has(dbCol) && /_/.test(dbCol) && dbCol !== "created_at" && dbCol !== "updated_at" && dbCol !== "id") {
        findings.push({
          kind: "orphan_column",
          table: tableName,
          column: dbCol,
          message: `Column ${tableName}.${dbCol} exists in the live database but is not declared in shared/schema.ts. Likely a legacy column or a drift from an ad-hoc SQL change.`,
        });
      }
    }
  }

  return findings;
}

export async function runSchemaDriftJob(): Promise<{ findings: SchemaFinding[] }> {
  const findings = await detectSchemaDrift();
  if (findings.length === 0) {
    logger.info("[schema-drift] no drift detected");
    return { findings: [] };
  }

  // We expect a baseline of legacy columns; only surface when there are
  // missing_table / missing_column items (real migration gaps). Orphans
  // get logged but don't open inbox items unless count is very high.
  const missing = findings.filter((f) => f.kind === "missing_table" || f.kind === "missing_column");
  const orphans = findings.filter((f) => f.kind === "orphan_column");

  logger.warn(`[schema-drift] ${findings.length} findings (${missing.length} missing, ${orphans.length} orphans)`);

  if (missing.length === 0 && orphans.length < 20) {
    // Quiet baseline — orphans alone don't warrant founder attention
    // until they pile up.
    return { findings };
  }

  try {
    const { getFounderPrimaryOrgId } = await import("./founder");
    const orgId = await getFounderPrimaryOrgId();
    await db.insert(agentEvents).values({
      organizationId: orgId,
      eventType: "schema_drift_detected",
      eventSource: "schema_drift_detector",
      payload: {
        agentCodename: "schema_drift_detector",
        missing: missing.length,
        orphans: orphans.length,
        findings: findings.slice(0, 50),
        actionUrl: "/founder/now#schema-drift",
        title: `Schema drift: ${missing.length} missing, ${orphans.length} orphans`,
        message: findings[0]?.message ?? "Schema drift detected.",
      },
    });

    await db.insert(decisionsInboxItems).values({
      itemType: "schema_drift",
      riskLevel: missing.length > 0 ? "high" : "medium",
      urgencyScore: missing.length > 0 ? 85 : 50,
      sophieAnalysis:
        `Schema drift detector found ${findings.length} discrepancies.\n\n` +
        (missing.length > 0
          ? `Missing tables/columns (migration likely not applied):\n` +
            missing.slice(0, 5).map((f) => `  • ${f.message}`).join("\n") + "\n\n"
          : "") +
        (orphans.length > 0
          ? `Orphan columns (in DB but not in schema.ts):\n` +
            orphans.slice(0, 5).map((f) => `  • ${f.message}`).join("\n")
          : ""),
      recommendedAction:
        missing.length > 0
          ? "Apply the missing migration. If the schema.ts addition was intentional, run migrate.mjs."
          : "Review orphan columns — either declare them in shared/schema.ts or drop them.",
      recommendedActionLabel: missing.length > 0 ? "Apply missing migrations" : "Review schema orphans",
      organizationId: orgId,
      status: "pending",
      ownerAgentCodename: "schema_drift_detector",
    });
  } catch (err) {
    logger.error("[schema-drift] failed to write inbox item", err);
  }

  return { findings };
}
