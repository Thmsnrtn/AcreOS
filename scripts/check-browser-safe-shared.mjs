#!/usr/bin/env node
/**
 * check-browser-safe-shared — shared/ must never crash a browser.
 *
 * shared/ modules are bundled into BOTH the server and the client. A bare
 * `process.env.X` evaluates fine in Node but throws
 * `ReferenceError: process is not defined` at module-evaluation time in
 * the browser — which kills EVERY lazy chunk that transitively includes
 * the module. That is exactly how the founder's Decisions/Controls doors
 * went blank on 2026-07-11: shared/schema/solene-chat-config.ts read five
 * env vars at top level and rode into the founder chunks via the Solene
 * chat components.
 *
 * Rule: any file under shared/ that mentions `process.` (outside comments)
 * must guard it with a `typeof process` check somewhere in the file (the
 * shared/billing/tier-pricing.ts pattern). This is deliberately coarse —
 * one guard per file is enough because the idiom is to hoist a single
 * guarded `env` object and use it everywhere.
 */
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

const ROOT = new URL("..", import.meta.url).pathname;
const SHARED = join(ROOT, "shared");

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) yield* walk(p);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\./.test(name)) yield p;
  }
}

/** Strip // line comments and /* block comments so prose mentions don't count. */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "")
    .replace(/([^:'"])\/\/[^\n]*/g, "$1");
}

const offenders = [];
let scanned = 0;
for (const file of walk(SHARED)) {
  scanned += 1;
  const src = readFileSync(file, "utf8");
  const code = stripComments(src);
  if (!/\bprocess\s*\.\s*env\b/.test(code)) continue;
  if (/typeof\s+process\s*(!==|===|!=|==)\s*["']undefined["']/.test(code)) continue;
  offenders.push(file.replace(ROOT, ""));
}

if (offenders.length) {
  console.error(
    `[check-browser-safe-shared] FAIL — ${offenders.length} shared/ file(s) read process.env without a \`typeof process\` guard.`,
  );
  console.error(
    "  Bare `process` throws in the browser and blanks every chunk that includes the module.",
  );
  console.error(
    "  Fix: hoist `const env = typeof process !== \"undefined\" && process.env ? process.env : {};` and read from `env` (see shared/billing/tier-pricing.ts).",
  );
  for (const f of offenders) console.error(`    ${f}`);
  process.exit(1);
}
console.log(`[check-browser-safe-shared] PASS — ${scanned} shared/ files scanned, 0 unguarded process.env reads.`);
