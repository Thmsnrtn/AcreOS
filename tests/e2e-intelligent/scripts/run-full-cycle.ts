/**
 * Run a full test cycle: all 12 personas on their assigned journeys.
 *
 * Usage:
 *   tsx scripts/run-full-cycle.ts
 *   tsx scripts/run-full-cycle.ts --headless false
 *   tsx scripts/run-full-cycle.ts --base-url http://localhost:3000
 */
import 'dotenv/config';
import { resolve, join } from 'node:path';
import { readdir, writeFile, mkdir } from 'node:fs/promises';
import { runJourney } from '../src/harness/runner.js';
import { loadPersona } from '../src/harness/persona-loader.js';
import type { RunResult } from '../src/harness/types.js';

// ── Paths ──────────────────────────────────────────────────────────────────

const HARNESS_ROOT = resolve(new URL('.', import.meta.url).pathname, '..');
const PERSONAS_DIR = join(HARNESS_ROOT, 'personas');
const JOURNEYS_DIR = join(HARNESS_ROOT, 'journeys');
const ARTIFACTS_DIR = join(HARNESS_ROOT, 'artifacts');

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
  headless: boolean;
  maxSteps?: number;
  baseUrl?: string;
} {
  const args = process.argv.slice(2);
  let headless = true;
  let maxSteps: number | undefined;
  let baseUrl: string | undefined;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
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

  return { headless, maxSteps, baseUrl };
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

// ── Cycle Report Generator ─────────────────────────────────────────────────

interface CycleReport {
  cycleId: string;
  startedAt: string;
  completedAt: string;
  totalRuns: number;
  completed: number;
  abandoned: number;
  blocked: number;
  averageSatisfaction: number;
  averageSteps: number;
  totalTokensInput: number;
  totalTokensOutput: number;
  results: Array<{
    personaId: string;
    journeyId: string;
    outcome: string;
    satisfaction: number;
    steps: number;
    durationSeconds: number;
    topIssues: string[];
  }>;
}

function generateCycleReport(results: RunResult[], cycleStart: number): CycleReport {
  const cycleId = new Date(cycleStart).toISOString().replace(/[:.]/g, '-');

  return {
    cycleId,
    startedAt: new Date(cycleStart).toISOString(),
    completedAt: new Date().toISOString(),
    totalRuns: results.length,
    completed: results.filter(
      (r) => r.verdict.outcome === 'COMPLETED_SATISFIED' || r.verdict.outcome === 'COMPLETED_UNSATISFIED',
    ).length,
    abandoned: results.filter((r) => r.verdict.outcome === 'ABANDONED').length,
    blocked: results.filter((r) => r.verdict.outcome === 'BLOCKED').length,
    averageSatisfaction:
      results.length > 0
        ? results.reduce((sum, r) => sum + r.verdict.satisfaction, 0) / results.length
        : 0,
    averageSteps:
      results.length > 0
        ? results.reduce((sum, r) => sum + r.stepCount, 0) / results.length
        : 0,
    totalTokensInput: results.reduce((sum, r) => sum + r.tokenUsage.inputTokens, 0),
    totalTokensOutput: results.reduce((sum, r) => sum + r.tokenUsage.outputTokens, 0),
    results: results.map((r) => ({
      personaId: r.personaId,
      journeyId: r.journeyId,
      outcome: r.verdict.outcome,
      satisfaction: r.verdict.satisfaction,
      steps: r.stepCount,
      durationSeconds: Math.round((r.completedAt - r.startedAt) / 1000),
      topIssues: r.verdict.topIssues,
    })),
  };
}

// ── Summary Printer ────────────────────────────────────────────────────────

function printSummary(report: CycleReport): void {
  console.log('\n' + '='.repeat(110));
  console.log('  FULL CYCLE REPORT');
  console.log('='.repeat(110));

  console.log(`  Cycle ID:          ${report.cycleId}`);
  console.log(`  Started:           ${report.startedAt}`);
  console.log(`  Completed:         ${report.completedAt}`);
  console.log(`  Total runs:        ${report.totalRuns}`);
  console.log(`  Completed:         ${report.completed}`);
  console.log(`  Abandoned:         ${report.abandoned}`);
  console.log(`  Blocked:           ${report.blocked}`);
  console.log(`  Avg satisfaction:  ${report.averageSatisfaction.toFixed(1)}/5`);
  console.log(`  Avg steps:         ${report.averageSteps.toFixed(0)}`);
  console.log(`  Total tokens in:   ${report.totalTokensInput.toLocaleString()}`);
  console.log(`  Total tokens out:  ${report.totalTokensOutput.toLocaleString()}`);

  console.log('\n  ' + '-'.repeat(106));

  const header = [
    'Persona'.padEnd(28),
    'Journey'.padEnd(30),
    'Outcome'.padEnd(22),
    'Steps'.padEnd(7),
    'Sat'.padEnd(5),
    'Duration',
  ].join(' | ');

  console.log(`  ${header}`);
  console.log('  ' + '-'.repeat(106));

  for (const r of report.results) {
    const row = [
      r.personaId.padEnd(28),
      r.journeyId.padEnd(30),
      r.outcome.padEnd(22),
      String(r.steps).padEnd(7),
      `${r.satisfaction}/5`.padEnd(5),
      `${r.durationSeconds}s`,
    ].join(' | ');
    console.log(`  ${row}`);
  }

  console.log('  ' + '-'.repeat(106));

  // Print issues summary
  const allIssues = report.results.flatMap((r) => r.topIssues);
  if (allIssues.length > 0) {
    // Deduplicate and count
    const issueCounts = new Map<string, number>();
    for (const issue of allIssues) {
      issueCounts.set(issue, (issueCounts.get(issue) ?? 0) + 1);
    }

    const sortedIssues = [...issueCounts.entries()].sort((a, b) => b[1] - a[1]);

    console.log('\n  Top Issues (by frequency):');
    for (const [issue, count] of sortedIssues.slice(0, 10)) {
      console.log(`    [${count}x] ${issue}`);
    }
  }

  console.log('='.repeat(110) + '\n');
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { headless, maxSteps, baseUrl } = parseArgs();
  const cycleStart = Date.now();

  console.log('\n' + '='.repeat(60));
  console.log('  AcreOS Full Cycle E2E Run');
  console.log('='.repeat(60));
  console.log(`  Started:  ${new Date(cycleStart).toISOString()}`);
  console.log(`  Headless: ${headless}`);
  if (maxSteps) console.log(`  Max steps: ${maxSteps}`);
  if (baseUrl) console.log(`  Base URL: ${baseUrl}`);
  console.log('');

  // Discover all persona files
  const personaFiles = (await readdir(PERSONAS_DIR))
    .filter((f) => f.endsWith('.md'))
    .sort();

  console.log(`  Found ${personaFiles.length} personas\n`);

  const results: RunResult[] = [];
  let runIndex = 0;

  for (const personaFile of personaFiles) {
    const personaPath = join(PERSONAS_DIR, personaFile);
    const persona = await loadPersona(personaPath);
    const journeyFileNames = resolveJourneyIds(persona.assignedJourneys);

    console.log(
      `\n  Persona: ${persona.name} (${persona.id}) — ${journeyFileNames.length} journey(s)`,
    );

    for (const journeyFileName of journeyFileNames) {
      runIndex++;
      const journeyPath = join(JOURNEYS_DIR, `${journeyFileName}.md`);

      console.log(`\n  [${runIndex}] ${persona.id} x ${journeyFileName}`);
      console.log('  ' + '-'.repeat(56));

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
        console.error(
          `    => FATAL ERROR: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  // Generate and save cycle report
  const report = generateCycleReport(results, cycleStart);

  await mkdir(ARTIFACTS_DIR, { recursive: true });
  const reportPath = join(ARTIFACTS_DIR, `cycle-report-${report.cycleId}.json`);
  await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf-8');
  console.log(`\n  Cycle report saved: ${reportPath}`);

  printSummary(report);

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
