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
 *   node scripts/check-model-ids.mjs
 */

const CATALOGUE = "https://openrouter.ai/api/v1/models";

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

  const missing = ids.filter((id) => !catalogue.has(id));
  if (missing.length > 0) {
    console.error("\n[check-model-ids] FAIL — these pinned ids are not in the provider catalogue:");
    for (const id of missing) {
      const stem = id.split("/")[1].replace(/-20\d{6}$/, "");
      const near = [...catalogue].filter((c) => c.includes(stem)).slice(0, 4);
      console.error(`  ${id}${near.length ? `   — did you mean: ${near.join(", ")}` : ""}`);
    }
    console.error("\n  A price row in aiCostRates is not an existence proof. Fix the id.");
    process.exit(1);
  }

  console.log("[check-model-ids] PASS — every pinned id exists at the provider.");
}

main().catch((err) => {
  console.error("[check-model-ids] unexpected failure:", err);
  process.exit(1);
});
