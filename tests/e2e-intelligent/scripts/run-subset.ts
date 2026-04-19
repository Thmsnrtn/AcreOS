/**
 * Run a subset of personas on their assigned (or specified) journeys.
 *
 * Usage:
 *   tsx scripts/run-subset.ts --personas 01-new-to-land-suburban,04-tax-delinquent-hunter
 *   tsx scripts/run-subset.ts --personas 01-new-to-land-suburban --journeys 01-first-deal-evaluation,07-pax-conversation-strategy
 *   tsx scripts/run-subset.ts --personas 01-new-to-land-suburban,02-experienced-wholesaler-rural --headless false
 */
import 'dotenv/config';
import { resolve, join } from 'node:path';
import { readdir } from 'node:fs/promises';
import { runJourney } from '../src/harness/runner.js';
import { loadPersona } from '../src/harness/persona-loader.js';
import type { RunResult } from '../src/harness/types.js';

// ── Paths ──────────────────────────────────────────────────────────────────

const HARNESS_ROOT = resolve(new URL('.', import.meta.url).pathname, '..');
const PERSONAS_DIR = join(HARNESS_ROOT, 'personas');
const JOURNEYS_DIR = join(HARNESS_ROOT, 'journeys');

// ── Journey ID to filename mapping ─────────────────────────────────────────

const JOURNEY_FILE_MAP: Record<string, string> = {
  '01': '01-first-deal-evaluation',
  '02': '02-mail-campaign-to-county',
  '03': '03-analyze-distressed-parcel',
  '04': '04-note-servicing-setup',
  '05': '05-portfolio-import-and-review',
  '06': '06-skip-trace-and-outreach',
  '07': '07-pax-conversation-strategy',
  '08': '08-autonomous-decision-review',
  '09': '09-pipeline-dealflow',
  '10': '10-settings-billing-tier-change',
};

// ── Argument Parsing ───────────────────────────────────────────────────────

function parseArgs(): {
  personas: string[];
  journeys: string[] | null;
  headless: boolean;
  maxSteps?: number;
  baseUrl?: string;
} {
  const args = process.argv.slice(2);
  let personas: string[] = [];
  let journeys: string[] | null = null;
  let headless = true;
  let maxSteps: number | undefined;
  let baseUrl: string | undefined;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--personas':
        personas = (args[++i] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
        break;
      case '--journeys':
        journeys = (args[++i] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
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

  if (personas.length === 0) {
    console.error(
      'Usage: tsx scripts/run-subset.ts --personas <id1,id2,...> [--journeys <id1,id2,...>] [--headless false] [--max-steps N] [--base-url URL]',
    );
    process.exit(1);
  }

  return { personas, journeys, headless, maxSteps, baseUrl };
}

// ── Resolve journey IDs from persona config ────────────────────────────────

function resolveJourneyIds(assignedJourneys: string[]): string[] {
  return assignedJourneys
    .map((id) => {
      const padded = id.padStart(2, '0');
      return JOURNEY_FILE_MAP[padded] ?? null;
    })
    .filter((f): f is string => f !== null);
}

// ── Summary Printer ────────────────────────────────────────────────────────

function printSummaryTable(results: RunResult[]): void {
  console.log('\n' + '='.repeat(100));
  console.log('  SUBSET RUN SUMMARY');
  console.log('='.repeat(100));

  const header = [
    'Persona'.padEnd(28),
    'Journey'.padEnd(30),
    'Outcome'.padEnd(22),
    'Steps'.padEnd(7),
    'Sat'.padEnd(5),
    'Duration',
  ].join(' | ');

  console.log(`  ${header}`);
  console.log('  ' + '-'.repeat(96));

  for (const r of results) {
    const durationSec = ((r.completedAt - r.startedAt) / 1000).toFixed(1);
    const row = [
      r.personaId.padEnd(28),
      r.journeyId.padEnd(30),
      r.verdict.outcome.padEnd(22),
      String(r.stepCount).padEnd(7),
      `${r.verdict.satisfaction}/5`.padEnd(5),
      `${durationSec}s`,
    ].join(' | ');
    console.log(`  ${row}`);
  }

  console.log('  ' + '-'.repeat(96));

  const completed = results.filter(
    (r) => r.verdict.outcome === 'COMPLETED_SATISFIED' || r.verdict.outcome === 'COMPLETED_UNSATISFIED',
  ).length;
  const abandoned = results.filter((r) => r.verdict.outcome === 'ABANDONED').length;
  const blocked = results.filter((r) => r.verdict.outcome === 'BLOCKED').length;
  const avgSatisfaction =
    results.length > 0
      ? (results.reduce((sum, r) => sum + r.verdict.satisfaction, 0) / results.length).toFixed(1)
      : 'N/A';

  console.log(`\n  Total runs:        ${results.length}`);
  console.log(`  Completed:         ${completed}`);
  console.log(`  Abandoned:         ${abandoned}`);
  console.log(`  Blocked:           ${blocked}`);
  console.log(`  Avg satisfaction:  ${avgSatisfaction}/5`);
  console.log('='.repeat(100) + '\n');
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { personas, journeys: journeyOverrides, headless, maxSteps, baseUrl } = parseArgs();

  const results: RunResult[] = [];
  let runIndex = 0;

  for (const personaId of personas) {
    const personaPath = join(PERSONAS_DIR, `${personaId}.md`);

    // Determine which journeys to run
    let journeyFileNames: string[];

    if (journeyOverrides) {
      journeyFileNames = journeyOverrides;
    } else {
      // Load persona config to get assigned journeys
      const persona = await loadPersona(personaPath);
      journeyFileNames = resolveJourneyIds(persona.assignedJourneys);
    }

    for (const journeyFileName of journeyFileNames) {
      runIndex++;
      const journeyPath = join(JOURNEYS_DIR, `${journeyFileName}.md`);

      console.log(
        `\n[${runIndex}] Running: ${personaId} x ${journeyFileName}`,
      );
      console.log('-'.repeat(60));

      try {
        const result = await runJourney({
          personaPath,
          journeyPath,
          headless,
          maxSteps,
          baseUrl,
        });

        results.push(result);
        console.log(
          `    => ${result.verdict.outcome} (satisfaction: ${result.verdict.satisfaction}/5, steps: ${result.stepCount})`,
        );
      } catch (err) {
        console.error(`    => FATAL ERROR: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  printSummaryTable(results);

  // Exit with non-zero if any journey was abandoned or blocked
  const hasFailures = results.some(
    (r) => r.verdict.outcome === 'ABANDONED' || r.verdict.outcome === 'BLOCKED',
  );
  if (hasFailures) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(2);
});
