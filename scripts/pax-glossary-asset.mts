/**
 * Generates shared/pax-glossary.json — the static-asset form of the Pax
 * glossary (BD-6, the #524 learn-content pattern).
 *
 * The TypeScript module (shared/pax-glossary.ts, re-exporting the core
 * subset from shared/pax-glossary-core.ts) stays the source of truth:
 * the server and the tests import it synchronously, exactly as before.
 * The JSON carries every DATA value of that module verbatim; function
 * values cannot serialize, so their paths are recorded under
 * `$functions` and the client loader (client/src/lib/pax-glossary.tsx)
 * rebuilds them from the data — a behaviour battery in
 * tests/unit/paxGlossaryServedAsData.test.ts pins the rebuilt functions
 * against this module's, and the same test pins this JSON deep-equal to
 * the module's data, so a stale regeneration fails CI.
 *
 * Run: npx tsx scripts/pax-glossary-asset.mts
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as glossary from "../shared/pax-glossary";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const functionPaths: string[] = [];

function stripFunctions(value: unknown, at: string): unknown {
  if (typeof value === "function") {
    functionPaths.push(at);
    return undefined;
  }
  if (Array.isArray(value)) {
    return value.map((v, i) => stripFunctions(v, `${at}[${i}]`));
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const stripped = stripFunctions(v, at ? `${at}.${k}` : k);
      if (stripped !== undefined) out[k] = stripped;
    }
    return out;
  }
  return value;
}

const data: Record<string, unknown> = {};
for (const [name, value] of Object.entries(glossary)) {
  const stripped = stripFunctions(value, name);
  if (stripped !== undefined) data[name] = stripped;
}
data.$functions = functionPaths.sort();

const dest = path.join(rootDir, "shared", "pax-glossary.json");
writeFileSync(dest, JSON.stringify(data, null, 2) + "\n");
console.log(`wrote ${dest}: ${Object.keys(data).length} keys, ${functionPaths.length} function paths`);
