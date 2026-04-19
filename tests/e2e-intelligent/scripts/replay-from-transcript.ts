/**
 * Replay a journey from a saved transcript file.
 *
 * This is a stub implementation that reads and prints the transcript.
 * Full replay (re-executing recorded decisions against the live app)
 * requires a decision-replay engine that is not yet implemented.
 *
 * Usage:
 *   tsx scripts/replay-from-transcript.ts --transcript artifacts/2026-04-18_abc12345/transcript.md
 *   tsx scripts/replay-from-transcript.ts --transcript path/to/transcript.md --verbose
 */
import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// ── Argument Parsing ───────────────────────────────────────────────────────

function parseArgs(): { transcriptPath: string; verbose: boolean } {
  const args = process.argv.slice(2);
  let transcriptPath = '';
  let verbose = false;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--transcript':
        transcriptPath = args[++i] ?? '';
        break;
      case '--verbose':
        verbose = true;
        break;
    }
  }

  if (!transcriptPath) {
    console.error(
      'Usage: tsx scripts/replay-from-transcript.ts --transcript <path-to-transcript.md> [--verbose]',
    );
    process.exit(1);
  }

  return { transcriptPath: resolve(transcriptPath), verbose };
}

// ── Transcript Parser (basic) ──────────────────────────────────────────────

interface TranscriptStep {
  stepNumber: number;
  action: string;
  reasoning: string;
  url: string;
}

function parseTranscriptSteps(content: string): TranscriptStep[] {
  const steps: TranscriptStep[] = [];
  const stepPattern = /## Step (\d+)/g;
  let match: RegExpExecArray | null;

  while ((match = stepPattern.exec(content)) !== null) {
    const stepNumber = parseInt(match[1], 10);
    const startIndex = match.index;
    const nextStepIndex = content.indexOf('## Step ', startIndex + 1);
    const stepBlock = nextStepIndex === -1
      ? content.slice(startIndex)
      : content.slice(startIndex, nextStepIndex);

    // Extract action line
    const actionMatch = stepBlock.match(/\*\*Action\*\*:\s*(.+)/);
    const action = actionMatch?.[1]?.trim() ?? 'unknown';

    // Extract reasoning
    const reasoningMatch = stepBlock.match(/\*\*Reasoning\*\*:\s*(.+)/);
    const reasoning = reasoningMatch?.[1]?.trim() ?? '';

    // Extract URL
    const urlMatch = stepBlock.match(/\*\*URL\*\*:\s*(.+)/);
    const url = urlMatch?.[1]?.trim() ?? '';

    steps.push({ stepNumber, action, reasoning, url });
  }

  return steps;
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { transcriptPath, verbose } = parseArgs();

  console.log(`\nReading transcript: ${transcriptPath}\n`);

  let content: string;
  try {
    content = await readFile(transcriptPath, 'utf-8');
  } catch (err) {
    console.error(`Failed to read transcript: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  // Extract header information
  const personaMatch = content.match(/\*\*Persona\*\*:\s*(.+)/);
  const journeyMatch = content.match(/\*\*Journey\*\*:\s*(.+)/);
  const outcomeMatch = content.match(/\*\*Outcome\*\*:\s*(.+)/);
  const satisfactionMatch = content.match(/\*\*Satisfaction\*\*:\s*(.+)/);

  console.log('='.repeat(60));
  console.log('  TRANSCRIPT REPLAY (read-only)');
  console.log('='.repeat(60));

  if (personaMatch) console.log(`  Persona:       ${personaMatch[1].trim()}`);
  if (journeyMatch) console.log(`  Journey:       ${journeyMatch[1].trim()}`);
  if (outcomeMatch) console.log(`  Outcome:       ${outcomeMatch[1].trim()}`);
  if (satisfactionMatch) console.log(`  Satisfaction:  ${satisfactionMatch[1].trim()}`);

  // Parse and display steps
  const steps = parseTranscriptSteps(content);
  console.log(`  Total steps:   ${steps.length}`);
  console.log('='.repeat(60));

  if (steps.length === 0) {
    console.log('\n  No structured steps found in transcript.');
    console.log('  Printing raw content:\n');
    console.log(content);
  } else {
    console.log('');
    for (const step of steps) {
      if (verbose) {
        console.log(`  Step ${step.stepNumber}:`);
        console.log(`    Action:    ${step.action}`);
        if (step.url) console.log(`    URL:       ${step.url}`);
        if (step.reasoning) console.log(`    Reasoning: ${step.reasoning}`);
        console.log('');
      } else {
        const summary = step.reasoning
          ? `${step.action} — ${step.reasoning.slice(0, 60)}`
          : step.action;
        console.log(`  [${String(step.stepNumber).padStart(3)}] ${summary}`);
      }
    }
  }

  console.log('\n  NOTE: This is a read-only replay. Full decision replay');
  console.log('  (re-executing against the live app) is not yet implemented.');
  console.log('  Recorded decisions can be used to compare behavior across');
  console.log('  releases once the replay engine is built.\n');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(2);
});
