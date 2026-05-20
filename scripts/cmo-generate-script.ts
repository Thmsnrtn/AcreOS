#!/usr/bin/env tsx
/**
 * CLI entry point for the CMO script generator.
 *
 * Usage:
 *   npm run cmo:generate-script -- --intent cold-traffic-tiktok-9x16 --count 3
 *   npm run cmo:generate-script -- --intent retargeting-meta-1x1 --count 3 --dry-run
 *   npm run cmo:generate-script -- --intent cold-traffic-tiktok-9x16 --count 3 --notes "lean into the comps speed angle"
 *
 * Behavior:
 *   1. Loads (or seeds on first run) the AcreOS brand profile and archetypes
 *   2. Generates N scripts via OpenRouter (Haiku default; --premium → Sonnet)
 *   3. Persists each script + runs banned-phrase / compliance check
 *   4. Scores each passing script via Haiku classifier; sub-threshold scripts
 *      flip to status='rejected_pre_render' with the lowest-axis reason
 *   5. Prints a single-screen summary: ID, archetype, score, status, cost
 *
 * --dry-run skips every external API call but still prints the full plan
 * + cost estimate so you can sanity-check before spending.
 */

import { seedAcreosBrandProfile, getAcreosBrandProfile } from "../server/services/cmo/brandProfiles";
import { seedHookArchetypes } from "../server/services/cmo/archetypes";
import {
  generateScripts,
  persistScripts,
  type GenerateScriptInput,
} from "../server/services/cmo/scriptGenerator";
import { scoreScript } from "../server/services/cmo/scriptScorer";

interface CliArgs {
  intent: string;
  count: number;
  notes?: string;
  premium: boolean;
  dryRun: boolean;
  funnelStage: "cold" | "warm" | "retargeting";
}

function parseArgs(argv: string[]): CliArgs {
  const args: Partial<CliArgs> = {
    count: 3,
    premium: false,
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--intent":
        args.intent = argv[++i];
        break;
      case "--count":
        args.count = parseInt(argv[++i], 10);
        break;
      case "--notes":
        args.notes = argv[++i];
        break;
      case "--premium":
        args.premium = true;
        break;
      case "--dry-run":
        args.dryRun = true;
        break;
      case "--funnel":
        args.funnelStage = argv[++i] as CliArgs["funnelStage"];
        break;
    }
  }

  if (!args.intent) {
    console.error("missing --intent. Examples: cold-traffic-tiktok-9x16, retargeting-meta-1x1");
    process.exit(1);
  }
  if (!args.count || args.count < 1 || args.count > 12) {
    console.error("--count must be 1-12");
    process.exit(1);
  }

  // Infer funnel stage from intent if not passed explicitly.
  if (!args.funnelStage) {
    if (args.intent.includes("cold")) args.funnelStage = "cold";
    else if (args.intent.includes("retargeting") || args.intent.includes("warm-back")) args.funnelStage = "retargeting";
    else args.funnelStage = "warm";
  }

  return args as CliArgs;
}

function dollars(cents: number): string {
  return `$${(cents / 100).toFixed(3)}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  console.log("[cmo] seeding brand profile + archetypes…");
  await seedHookArchetypes();
  let brand = await getAcreosBrandProfile();
  if (!brand) brand = await seedAcreosBrandProfile();

  console.log(`[cmo] brand: ${brand.displayName} (id=${brand.id})`);
  console.log(`[cmo] intent: ${args.intent} | funnel: ${args.funnelStage} | count: ${args.count} | model: ${args.premium ? "Sonnet 4.6" : "Haiku 4.5"}`);
  if (args.notes) console.log(`[cmo] notes: ${args.notes}`);

  const generationInput: GenerateScriptInput = {
    brandProfile: brand,
    intent: args.intent,
    funnelStage: args.funnelStage,
    count: args.count,
    notes: args.notes,
    forcePremium: args.premium,
    dryRun: args.dryRun,
  };

  const result = await generateScripts(generationInput);

  if (result.dryRun) {
    console.log("");
    console.log("─── DRY RUN — no API calls fired ───");
    console.log(`  generation model:   ${result.model}`);
    console.log(`  generation cost:    ~${dollars(result.estimatedCostCents ?? 0)}`);
    console.log(`  scoring cost (est): ~${dollars((result.estimatedCostCents ?? 0) * args.count)} (one classifier per script)`);
    console.log(`  TOTAL estimate:     ~${dollars((result.estimatedCostCents ?? 0) * (1 + args.count))}`);
    console.log("");
    console.log("rerun without --dry-run to actually generate.");
    process.exit(0);
  }

  console.log(`[cmo] generated ${result.scripts.length} candidate scripts in ${result.model} (${dollars(result.costCents)})`);

  const persisted = await persistScripts(
    brand,
    args.intent,
    args.funnelStage,
    result.scripts,
    result.model,
    result.costCents,
    args.notes,
  );

  console.log("[cmo] scoring each script…");
  let totalScoringCost = 0;
  let passedCount = 0;
  let rejectedPreRenderCount = 0;

  for (const script of persisted) {
    if (script.status === "rejected_pre_render") {
      // Already failed the mechanical banned-phrase check; skip the Haiku scorer.
      console.log(`  ${shortId(script.id)} [${script.hookArchetype}] BANNED  ${script.rejectionReason}`);
      rejectedPreRenderCount++;
      continue;
    }
    const scoreResult = await scoreScript(brand, script);
    totalScoringCost += scoreResult.costCents;
    if (scoreResult.passed) {
      console.log(`  ${shortId(script.id)} [${script.hookArchetype}] PASS  score=${scoreResult.score} (bv=${scoreResult.breakdown.brandVoice} hs=${scoreResult.breakdown.hookStrength} cp=${scoreResult.breakdown.compliance} nv=${scoreResult.breakdown.novelty})`);
      passedCount++;
    } else {
      console.log(`  ${shortId(script.id)} [${script.hookArchetype}] REJECT score=${scoreResult.score} (${scoreResult.breakdown.notes.slice(0, 80)})`);
      rejectedPreRenderCount++;
    }
  }

  const totalCost = result.costCents + totalScoringCost;
  console.log("");
  console.log("─── summary ───");
  console.log(`  generated:           ${persisted.length}`);
  console.log(`  passed pre-render:   ${passedCount}`);
  console.log(`  rejected pre-render: ${rejectedPreRenderCount}`);
  console.log(`  generation cost:     ${dollars(result.costCents)}`);
  console.log(`  scoring cost:        ${dollars(totalScoringCost)}`);
  console.log(`  TOTAL:               ${dollars(totalCost)}`);
  console.log("");
  console.log("next: passing scripts (status='scored') are ready for voice + render in Phase 2/3.");
  process.exit(0);
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

main().catch((err) => {
  console.error("[cmo] FATAL:", err);
  process.exit(1);
});
