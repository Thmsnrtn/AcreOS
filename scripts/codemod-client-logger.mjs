#!/usr/bin/env node
/**
 * One-shot codemod: replace `console.log/warn/error(...)` call sites
 * inside `client/src/` with `clientLogger.info/warn/error(...)`.
 *
 * Skips:
 *   - `console.debug(...)` (intentional dev-only)
 *   - `console.error = ...` and `console.error;` (monkey-patch / capture
 *      assignments — only call sites with `(` are rewritten)
 *   - Files under `client/src/test/`
 *   - `client/src/lib/clientLogger.ts` itself (defines the wrapper)
 *
 * After replacement, ensures `import { clientLogger } from "@/lib/clientLogger"`
 * is present in each touched file (path-aware: same dir uses relative import).
 */
import { readFileSync, writeFileSync, statSync, readdirSync } from "fs";
import { join, relative, dirname } from "path";

const ROOT = join(process.cwd(), "client", "src");
const SKIP_DIRS = ["test", "__tests__"];
const SKIP_FILES = new Set([
  join(ROOT, "lib", "clientLogger.ts"),
]);

const callRegex = /\bconsole\.(log|warn|error)\(/g;
const methodMap = { log: "info", warn: "warn", error: "error" };

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.includes(entry.name)) continue;
      yield* walk(p);
    } else if (entry.isFile()) {
      if (!/\.(ts|tsx)$/.test(entry.name)) continue;
      yield p;
    }
  }
}

function importPath(filePath) {
  // All TS files reach `@/lib/clientLogger` via the path alias from
  // tsconfig (`"@/*": ["client/src/*"]`). Use that uniformly so we
  // don't have to compute relative paths per-file.
  return "@/lib/clientLogger";
}

function ensureImport(content, filePath) {
  if (/from ["']@\/lib\/clientLogger["']/.test(content)) return content;
  if (/from ["']\.\.?\/.*clientLogger["']/.test(content)) return content;

  const stmt = `import { clientLogger } from "${importPath(filePath)}";\n`;

  // Prefer to insert after the last `import` line at the top of the file.
  const lines = content.split("\n");
  let lastImportIdx = -1;
  for (let i = 0; i < Math.min(lines.length, 80); i++) {
    if (/^import\s.+from\s+["'].+["'];?\s*$/.test(lines[i])) {
      lastImportIdx = i;
    } else if (/^\s*$/.test(lines[i])) {
      // skip blank
    } else if (lastImportIdx !== -1) {
      // first non-import line after we've seen imports — stop scanning
      break;
    }
  }

  if (lastImportIdx === -1) {
    return stmt + content;
  }
  lines.splice(lastImportIdx + 1, 0, stmt.trimEnd());
  return lines.join("\n");
}

let totalSites = 0;
let touchedFiles = 0;

for (const file of walk(ROOT)) {
  if (SKIP_FILES.has(file)) continue;

  const original = readFileSync(file, "utf8");
  if (!callRegex.test(original)) continue;
  callRegex.lastIndex = 0; // reset

  let count = 0;
  // Replace only call sites (with the trailing paren), preserving the `(`
  const replaced = original.replace(callRegex, (_match, method) => {
    count++;
    return `clientLogger.${methodMap[method]}(`;
  });

  if (count === 0) continue;

  const final = ensureImport(replaced, file);
  writeFileSync(file, final, "utf8");
  totalSites += count;
  touchedFiles++;
  console.log(`[codemod] ${count.toString().padStart(2)} sites → ${relative(process.cwd(), file)}`);
}

console.log(`\n[codemod] complete — ${totalSites} call sites across ${touchedFiles} files.`);
