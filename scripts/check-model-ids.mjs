#!/usr/bin/env node
/**
 * Probe every pinned model id against the provider's live catalogue.
 *
 * WHY THIS IS A SCRIPT AND NOT A TEST
 * -----------------------------------
 * It needs the network. A vitest case that fetches would pass whenever the
 * network is down — a gate that goes green in exactly the environment that
 * cannot check it, which is the vacuous-green shape this repository fails gates
 * for. `tests/unit/modelIdsAreReal.test.ts` carries the OFFLINE, deterministic
 * rules derived from what this probe found; this is the thing you run when you
 * want the answer fresh, or after adding a model.
 *
 * WHAT IT CAUGHT WHEN IT WAS WRITTEN (2026-08-19)
 * -----------------------------------------------
 *   anthropic/claude-haiku-4-5-20251001   404   ← MODEL_MODERATE, the cheap tier
 *   deepseek/deepseek-reasoner            404   ← MODEL_REASONING
 *
 * Both had price rows in aiCostRates, which is all the boot guard in models.ts
 * ever checked. A price is not an existence proof.
 *
 * WHAT IT COVERS
 * --------------
 * Not just the MODELS registry. A registry is only authoritative over the call
 * sites that USE it, and most do not: sixty-odd sites across thirty-one files
 * passed their own literal to the platform client. So this probes both — the
 * registry's ids AND every prefixed model literal in server/ — because the
 * defect was never "the registry is wrong", it was "an id that does not exist
 * reached a provider", and a literal reaches one just as well.
 *
 *   node scripts/check-model-ids.mjs
 */

import { readFileSync, readdirSync, lstatSync, existsSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { stripCommentsPreservingLines } from "./lib/strip-comments.mjs";

const CATALOGUE = "https://openrouter.ai/api/v1/models";
const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");

const SKIP_DIRS = new Set(["node_modules", "dist", "build", "coverage", "test-results"]);
function walkTs(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry) || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    const st = lstatSync(full);
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) walkTs(full, out);
    else if (/\.ts$/.test(entry) && !/\.(test|spec)\.ts$/.test(entry)) out.push(full);
  }
  return out;
}

/**
 * Every PREFIXED model literal in server/, with where it came from. Bare ids
 * are `check-model-prefix.mjs`'s job (it runs offline and has the register of
 * deliberate exceptions); this only asks whether a prefixed id is real.
 * Comments are stripped: a docblock example is not a request.
 */
function sourceLiterals() {
  const found = new Map();
  for (const abs of walkTs(join(REPO, "server"))) {
    const rel = relative(REPO, abs).split("\\").join("/");
    let rawSrc;
    try {
      rawSrc = readFileSync(abs, "utf8");
    } catch (err) {
      // Same reason as check-model-prefix.mjs: gate self-tests write probe
      // files into server/services and delete them again, so a file listed by
      // the walk can be gone by the time it is read. Skipping one file cannot
      // hide an id — this probe FAILS on an empty literal set anyway, which is
      // the vacuity guard for a walk that lost too much.
      if (err && err.code === "ENOENT") continue;
      throw err;
    }
    const code = stripCommentsPreservingLines(rawSrc);
    const re = /\b(?:model|modelKey|modelId|aiModel|forceModel|tierCeilingModel)\s*:\s*(["'])([a-z0-9-]+\/[^"'\n]+)\1/g;
    let m;
    while ((m = re.exec(code)) !== null) {
      const line = code.slice(0, m.index).split("\n").length;
      if (!found.has(m[2])) found.set(m[2], []);
      found.get(m[2]).push(`${rel}:${line}`);
    }
  }
  return found;
}

async function main() {
  // The registry is TypeScript; read the ids out of the SOURCE rather than
  // importing it, so this script needs no build step and no server env.
  //
  // An earlier draft also imported the registry dynamically and discarded the
  // result. It was dead, and it was not harmless: a dynamic import marks every
  // export of the target module "opaque" to lint-reachability, which moved two
  // of that gate's counters.
  //
  // Deleting it did NOT move them back, and the reason is the finding: the
  // sentence you are reading used to SPELL the dynamic-import call, and
  // lint-reachability scans raw source with no idea what a comment is. The
  // prose kept the exemption alive after the code was gone. Do not restore the
  // literal form here; the gate is being taught to strip comments separately,
  // but a gate that can be moved by a sentence is a gate you can move by
  // accident.
  const fs = await import("node:fs");
  const text = fs.readFileSync(new URL("../server/services/models.ts", import.meta.url), "utf8");
  const block = text.slice(text.indexOf("export const MODELS = {"), text.indexOf("} as const;", text.indexOf("export const MODELS = {")));
  const ids = [...block.matchAll(/"([a-z0-9-]+\/[^"]+)"/g)].map((m) => m[1]);

  if (ids.length === 0) {
    console.error("[check-model-ids] FAIL — parsed no ids out of MODELS. The registry moved or was reformatted; fix this parser rather than accepting a green.");
    process.exit(1);
  }
  console.log(`[check-model-ids] pinned ids: ${ids.length} — ${ids.join(", ")}`);

  let catalogue;
  try {
    const res = await fetch(CATALOGUE, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`catalogue returned ${res.status}`);
    catalogue = new Set((await res.json()).data.map((m) => m.id));
  } catch (err) {
    console.error(`[check-model-ids] COULD NOT REACH THE CATALOGUE (${err.message}).`);
    console.error("  Refusing rather than passing: an unreachable catalogue is not");
    console.error("  a catalogue that says every id is fine.");
    process.exit(2);
  }

  console.log(`[check-model-ids] catalogue size: ${catalogue.size}`);
  if (catalogue.size < 50) {
    console.error("[check-model-ids] FAIL — the catalogue came back implausibly small; not trusting it.");
    process.exit(1);
  }

  const literals = sourceLiterals();
  console.log(`[check-model-ids] prefixed literals in server/: ${literals.size} distinct across ${[...literals.values()].reduce((n, v) => n + v.length, 0)} site(s)`);
  if (literals.size === 0) {
    console.error("[check-model-ids] FAIL — the source walk found no prefixed model literal at all. That is a broken scan reporting compliance, not a clean tree.");
    process.exit(1);
  }

  const nearest = (id) => {
    const stem = (id.split("/")[1] ?? id).replace(/-20\d{6}$/, "").replace(/[.-]\d+([.-]\d+)?$/, "");
    const near = [...catalogue].filter((c) => c.includes(stem)).slice(0, 4);
    return near.length ? `   — did you mean: ${near.join(", ")}` : "";
  };

  const missing = ids.filter((id) => !catalogue.has(id));
  const missingLiterals = [...literals.keys()].filter((id) => !catalogue.has(id));

  if (missing.length > 0 || missingLiterals.length > 0) {
    console.error("\n[check-model-ids] FAIL — these ids are not in the provider catalogue:");
    for (const id of missing) console.error(`  MODELS   ${id}${nearest(id)}`);
    for (const id of missingLiterals) {
      console.error(`  literal  ${id}${nearest(id)}`);
      for (const site of literals.get(id).slice(0, 6)) console.error(`             ${site}`);
    }
    console.error("\n  A price row in aiCostRates is not an existence proof. Fix the id.");
    process.exit(1);
  }

  console.log("[check-model-ids] PASS — every pinned id AND every prefixed source literal exists at the provider.");
}

main().catch((err) => {
  console.error("[check-model-ids] unexpected failure:", err);
  process.exit(1);
});
