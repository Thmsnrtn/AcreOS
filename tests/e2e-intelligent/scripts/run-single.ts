/**
 * Run a single persona-journey combination.
 *
 * Usage:
 *   tsx scripts/run-single.ts --persona 01-new-to-land-suburban --journey 01-first-deal-evaluation
 *   tsx scripts/run-single.ts --persona 04-tax-delinquent-hunter --journey 03-analyze-distressed-parcel --headless false
 */
import 'dotenv/config';
import { resolve, join } from 'node:path';
import { runJourney } from '../src/harness/runner.js';
import type { RunResult } from '../src/harness/types.js';

// ── Paths ──────────────────────────────────────────────────────────────────

const HARNESS_ROOT = resolve(new URL('.', import.meta.url).pathname, '..');
const PERSONAS_DIR = join(HARNESS_ROOT, 'personas');
const JOURNEYS_DIR = join(HARNESS_ROOT, 'journeys');

// ── Argument Parsing ───────────────────────────────────────────────────────

function parseArgs(): {
  persona: string;
  journey: string;
  headless: boolean;
  maxSteps?: number;
  baseUrl?: string;
} {
  const args = process.argv.slice(2);
  let persona = '';
  let journey = '';
  let headless = true;
  let maxSteps: number | undefined;
  let baseUrl: string | undefined;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--persona':
        persona = args[++i] ?? '';
        break;
      case '--journey':
        journey = args[++i] ?? '';
        break;
      case '--headless':
        headless = args[++i] !== 'false';
        break;
      case '--max-steps':
        maxSteps = parseInt(args[++i] ?? '', 10) || undefined;
        break;
      case '--base-url':
        baseUrl = args[++i];
        break;
    }
  }

  if (!persona || !journey) {
    console.error(
      'Usage: tsx scripts/run-single.ts --persona <persona-id> --journey <journey-id> [--headless false] [--max-steps N] [--base-url URL]',
    );
    process.exit(1);
  }

  return { persona, journey, headless, maxSteps, baseUrl };
}

// ── Resolve file paths ─────────────────────────────────────────────────────

function resolvePersonaPath(personaId: string): string {
  // Support both "01-new-to-land-suburban" and "new-to-land-suburban"
  const candidates = [
    join(PERSONAS_DIR, `${personaId}.md`),
    // Try glob-style: persona ID might not include the numeric prefix
  ];
  return candidates[0];
}

function resolveJourneyPath(journeyId: string): string {
  return join(JOURNEYS_DIR, `${journeyId}.md`);
}

// ── Summary Printer ────────────────────────────────────────────────────────

function printSummary(result: RunResult): void {
  const durationSec = ((result.completedAt - result.startedAt) / 1000).toFixed(1);

  console.log('\n' + '='.repeat(70));
  console.log('  JOURNEY RESULT');
  console.log('='.repeat(70));
  console.log(`  Run ID:       ${result.runId}`);
  console.log(`  Persona:      ${result.personaId}`);
  console.log(`  Journey:      ${result.journeyId}`);
  console.log(`  Steps:        ${result.stepCount}`);
  console.log(`  Duration:     ${durationSec}s`);
  console.log(`  Outcome:      ${result.verdict.outcome}`);
  console.log(`  Satisfaction: ${result.verdict.satisfaction}/5`);
  console.log(`  Recommend:    ${result.verdict.wouldRecommend}`);
  console.log(`  Transcript:   ${result.transcriptPath}`);

  if (result.verdict.topIssues.length > 0) {
    console.log('\n  Top Issues:');
    for (const issue of result.verdict.topIssues) {
      console.log(`    - ${issue}`);
    }
  }

  console.log('\n  Token Usage:');
  console.log(`    Input:       ${result.tokenUsage.inputTokens.toLocaleString()}`);
  console.log(`    Output:      ${result.tokenUsage.outputTokens.toLocaleString()}`);
  console.log(`    Cache hits:  ${result.tokenUsage.cacheHits.toLocaleString()}`);

  if (result.aiEvaluations.length > 0) {
    console.log(`\n  AI Output Evaluations: ${result.aiEvaluations.length}`);
    for (const evaluation of result.aiEvaluations) {
      console.log(
        `    Step ${evaluation.stepNumber}: ${evaluation.finding.overall} (domain=${evaluation.finding.domainAccuracy}/5, actionability=${evaluation.finding.actionability}/5)`,
      );
    }
  }

  console.log('\n  Reasoning:');
  console.log(`    ${result.verdict.reasoning}`);
  console.log('='.repeat(70) + '\n');
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { persona, journey, headless, maxSteps, baseUrl } = parseArgs();

  const personaPath = resolvePersonaPath(persona);
  const journeyPath = resolveJourneyPath(journey);

  console.log(`\nStarting single journey run:`);
  console.log(`  Persona: ${persona} (${personaPath})`);
  console.log(`  Journey: ${journey} (${journeyPath})`);
  console.log(`  Headless: ${headless}`);
  if (maxSteps) console.log(`  Max steps: ${maxSteps}`);
  if (baseUrl) console.log(`  Base URL: ${baseUrl}`);
  console.log('');

  const result = await runJourney({
    personaPath,
    journeyPath,
    headless,
    maxSteps,
    baseUrl,
  });

  printSummary(result);

  // Exit with non-zero if the journey was abandoned or blocked
  if (result.verdict.outcome === 'ABANDONED' || result.verdict.outcome === 'BLOCKED') {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(2);
});
