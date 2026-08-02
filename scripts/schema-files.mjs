/**
 * Canonical Drizzle-schema file discovery — the ONE list every schema guard
 * must agree on.
 *
 * Why this exists: the `users`-table drift outages (2026-04/05) were possible in
 * part because the schema guards each parsed a DIFFERENT subset of the schema.
 * The runtime drift detector, the CI column-ref validator, and the org-index
 * lint all parsed only `shared/schema.ts` (or a partial set) and were therefore
 * blind to `shared/models/auth.ts` — the file that DEFINES the `users` table
 * (re-exported into the barrel via `export * from "./models/auth"`). The very
 * table that caused the incident was watched by none of them.
 *
 * This returns the full set of files that actually contain `pgTable()`
 * definitions, matching drizzle.config.ts's glob PLUS `shared/models/*.ts`.
 * Pure Node (no TS) so the `.mjs` lints, the tsx scripts, and the server service
 * can all import the same source of truth.
 */
import { readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const SHARED_DIR = join(REPO_ROOT, "shared");

function isSchemaSource(entry) {
  return (
    entry.endsWith(".ts") &&
    !entry.endsWith(".test.ts") &&
    !entry.endsWith(".spec.ts") &&
    !entry.endsWith(".d.ts")
  );
}

/**
 * @returns {string[]} absolute paths, sorted, of every file that may declare a
 *   pgTable: shared/schema.ts, shared/schema-*.ts, shared/schema/*.ts, and
 *   shared/models/*.ts (where `users` lives).
 */
export function discoverSchemaFiles() {
  const files = [];

  // shared/schema.ts + shared/schema-*.ts. Resilient by design: the runtime
  // drift detector calls this from a bundled context where the source tree may
  // not resolve — it must degrade to "watch what's present", never throw.
  try {
    for (const entry of readdirSync(SHARED_DIR)) {
      const full = join(SHARED_DIR, entry);
      if (!statSync(full).isFile()) continue;
      if (entry === "schema.ts") files.push(full);
      else if (entry.startsWith("schema-") && isSchemaSource(entry)) files.push(full);
    }
  } catch {
    /* SHARED_DIR unreadable in this context — return whatever we can */
  }

  // shared/schema/*.ts and shared/models/*.ts (the previously-missed dir)
  for (const sub of ["schema", "models"]) {
    const dir = join(SHARED_DIR, sub);
    try {
      if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) continue;
      for (const entry of readdirSync(dir)) {
        if (isSchemaSource(entry)) files.push(join(dir, entry));
      }
    } catch {
      /* subdir unreadable — skip */
    }
  }

  return files.sort();
}

/** Repo-relative form, for stable logging / assertions. */
export function discoverSchemaFilesRelative() {
  return discoverSchemaFiles().map((f) => f.slice(REPO_ROOT.length + 1));
}
