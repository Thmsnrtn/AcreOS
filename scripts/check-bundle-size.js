#!/usr/bin/env node
/**
 * Check that the production bundle doesn't exceed size limits.
 * Runs after `npm run build` and inspects dist/public/assets/.
 */

import { readdirSync, statSync } from "fs";
import { resolve, join } from "path";

const MAX_SINGLE_CHUNK_KB = 600; // No single chunk > 600 KB
const MAX_TOTAL_JS_KB = 3000; // Total JS < 3 MB
const DIST_DIR = resolve(import.meta.dirname || ".", "../dist/public/assets");

let totalJS = 0;
let violations = [];

try {
  const files = readdirSync(DIST_DIR);
  for (const file of files) {
    if (!file.endsWith(".js")) continue;
    const size = statSync(join(DIST_DIR, file)).size;
    const sizeKB = Math.round(size / 1024);
    totalJS += sizeKB;

    if (sizeKB > MAX_SINGLE_CHUNK_KB) {
      violations.push(`${file}: ${sizeKB} KB (limit: ${MAX_SINGLE_CHUNK_KB} KB)`);
    }
  }
} catch {
  console.log("SKIP: dist/public/assets/ not found — run 'npm run build' first");
  process.exit(0); // Non-blocking if build hasn't run
}

if (totalJS > MAX_TOTAL_JS_KB) {
  violations.push(
    `Total JS: ${totalJS} KB exceeds limit of ${MAX_TOTAL_JS_KB} KB`
  );
}

if (violations.length > 0) {
  console.error("FAIL: Bundle size violations:\n");
  violations.forEach((v) => console.error(`  ${v}`));
  process.exit(1);
}

console.log(`PASS: Bundle size OK (total JS: ${totalJS} KB)`);
process.exit(0);
