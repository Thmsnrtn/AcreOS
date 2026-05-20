#!/usr/bin/env tsx
/**
 * Render an already-generated + scored script to 3 MP4s.
 *
 * Usage:
 *   npm run cmo:render-ad -- --script-id <uuid>
 *   npm run cmo:render-ad -- --script-id <uuid> --aspect 9:16
 *
 * Most common flow:
 *   1. `npm run cmo:generate-script -- --intent cold-traffic-tiktok-9x16 --count 3`
 *      → prints 3 script IDs with scores
 *   2. Pick one passing script, render it:
 *      `npm run cmo:render-ad -- --script-id <id-from-step-1>`
 *   3. Approval surfaces in /founder/cmo
 */

import { renderScriptToBundle } from "../server/services/cmo/renderOrchestrator";

interface CliArgs {
  scriptId: string;
  aspectRatios?: Array<"9:16" | "1:1" | "16:9">;
}

function parseArgs(argv: string[]): CliArgs {
  const args: Partial<CliArgs> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--script-id") args.scriptId = argv[++i];
    if (arg === "--aspect") {
      const ratio = argv[++i] as "9:16" | "1:1" | "16:9";
      args.aspectRatios = [ratio];
    }
  }
  if (!args.scriptId) {
    console.error("missing --script-id <uuid>");
    process.exit(1);
  }
  return args as CliArgs;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(`[cmo:render] script=${args.scriptId.slice(0, 8)} aspect=${(args.aspectRatios ?? ["9:16", "1:1", "16:9"]).join(", ")}`);

  const result = await renderScriptToBundle({
    scriptId: args.scriptId,
    aspectRatios: args.aspectRatios,
  });

  console.log("");
  console.log("─── render complete ───");
  console.log(`  bundle ID:               ${result.bundleId}`);
  console.log(`  decisions_inbox_items:   #${result.decisionsInboxItemId}`);
  console.log(`  total cost:              $${(result.costBreakdown.totalCents / 100).toFixed(2)}`);
  console.log("");
  console.log("  renders:");
  for (const render of result.renders) {
    console.log(`    [${render.aspectRatio}] ${render.id.slice(0, 8)}  ${render.storagePath}  ${render.status}`);
  }
  console.log("");
  console.log("next: open /founder/cmo to review + approve. Approved bundles broadcast via outbox to Meta + TikTok.");
  process.exit(0);
}

main().catch((err) => {
  console.error("[cmo:render] FATAL:", err);
  process.exit(1);
});
