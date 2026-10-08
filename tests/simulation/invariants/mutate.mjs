#!/usr/bin/env node
// Falsify every invariant against its own canary: for each `detect:<id>` body
// in registry.ts, delete the body (the check then returns nothing), run the
// canary suite, and require it to go RED. Restores the file after each run.
//
//   node tests/simulation/invariants/mutate.mjs [outFile.json]
//
// A mutation that leaves the suite green means that invariant's detection is
// decoration; the run exits 1 and names it.
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const REG = join(ROOT, "tests/simulation/invariants/registry.ts");
const original = readFileSync(REG, "utf8");
const ids = [...original.matchAll(/\/\/ detect:([a-z0-9-]+)\n/g)].map((m) => m[1]);
const results = [];
try {
  for (const id of ids) {
    const re = new RegExp(`(// detect:${id}\\n)([\\s\\S]*?)(\\s*// /detect)`);
    const mutated = original.replace(re, "$1      /* mutated: detection removed */$3");
    if (mutated === original) { results.push({ id, status: "NOT-MUTATED" }); continue; }
    writeFileSync(REG, mutated);
    const r = spawnSync("npx", ["vitest", "run", "tests/simulation/invariants/invariants.test.ts", "-t", id], { cwd: ROOT, encoding: "utf8" });
    const red = r.status !== 0;
    const failed = /Tests\s+(\d+) failed/.exec(r.stdout + r.stderr)?.[1] ?? "0";
    results.push({ id, status: red ? "RED" : "GREEN(decoration)", failedTests: Number(failed) });
    console.log(`${red ? "RED  " : "GREEN"} ${id} (${failed} failed)`);
  }
} finally {
  writeFileSync(REG, original);
}
const out = process.argv[2];
if (out) writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), results }, null, 1));
const bad = results.filter((r) => r.status !== "RED");
if (ids.length < 9 || bad.length) { console.log("FAIL", { mutated: ids.length, notRed: bad }); process.exit(1); }
console.log(`PASS: all ${ids.length} invariant detections go red when removed`);
