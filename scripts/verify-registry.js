#!/usr/bin/env node
/**
 * Verify that the defect registry has 0 open P0/P1 entries.
 * Parses docs/audits/defect-registry.md and exits non-zero if any
 * entry has Status: OPEN and Severity: P0 or P1.
 */

import { readFileSync } from "fs";
import { resolve } from "path";

const registryPath = resolve(
  import.meta.dirname || ".",
  "../docs/audits/defect-registry.md"
);

let content;
try {
  content = readFileSync(registryPath, "utf-8");
} catch {
  console.error(`Cannot read registry at ${registryPath}`);
  process.exit(1);
}

// Parse defect entries
const defectPattern =
  /### (DEFECT-\d+)\nTitle: (.+)\nSeverity: (P\d)\nStatus: (\w+)/g;

const openBlockers = [];
let match;

while ((match = defectPattern.exec(content)) !== null) {
  const [, id, title, severity, status] = match;
  if (status === "OPEN" && (severity === "P0" || severity === "P1")) {
    openBlockers.push({ id, title, severity, status });
  }
}

if (openBlockers.length > 0) {
  console.error(`FAIL: ${openBlockers.length} open P0/P1 defect(s):\n`);
  for (const d of openBlockers) {
    console.error(`  ${d.id} [${d.severity}] ${d.title}`);
  }
  process.exit(1);
}

console.log("PASS: 0 open P0/P1 defects in registry");
process.exit(0);
