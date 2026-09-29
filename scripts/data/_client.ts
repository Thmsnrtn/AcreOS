/**
 * Shared plumbing for the founder-executed data scripts
 * (docs/company/founder-decisions-2026-09-29.md, "How the data rulings are
 * executed"): a minimal query interface so each script's core runs against
 * a real `pg` client in production and a recording double in tests, plus
 * the one flag convention — nothing mutates without `--apply`.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export interface ScriptFlags {
  apply: boolean;
  outDir: string;
}

export function parseFlags(argv: string[]): ScriptFlags {
  const out = argv.find((a) => a.startsWith("--out="))?.slice("--out=".length);
  return {
    apply: argv.includes("--apply"),
    outDir: out ?? join("data-exports", new Date().toISOString().slice(0, 10)),
  };
}

/** Write rows to a JSON file before anything deletes them. Returns the path. */
export function exportRows(outDir: string, name: string, rows: unknown[]): string {
  mkdirSync(outDir, { recursive: true });
  const path = join(outDir, `${name}.json`);
  writeFileSync(path, JSON.stringify(rows, null, 2) + "\n");
  return path;
}

export async function connect(): Promise<{ client: Queryable; end: () => Promise<void> }> {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL not set — aborting");
    process.exit(1);
  }
  const pg = await import("pg");
  const client = new pg.default.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  return { client: client as unknown as Queryable, end: () => client.end() };
}

/** True when this module is the script being run (not imported by a test). */
export function isMain(metaUrl: string): boolean {
  return !!process.argv[1] && metaUrl === pathToFileURL(resolve(process.argv[1])).href;
}
