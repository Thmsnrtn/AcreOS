import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { ClaudeAgent } from './claude-agent.js';
import { BrowserController } from './browser-controller.js';
import { TranscriptWriter } from './transcript-writer.js';
import { loadPersona } from './persona-loader.js';
import { loadJourney } from './journey-loader.js';
import { loadKnowledge } from './knowledge-loader.js';
import type { Decision, RunResult, StepRecord, UIObservation } from './types.js';

// ── Constants ───────────────────────────────────────────────────────────────

const HARNESS_ROOT = resolve(
  new URL('.', import.meta.url).pathname,
  '../../..',
);
const ARTIFACTS_DIR = join(HARNESS_ROOT, 'artifacts');
const KNOWLEDGE_DIR = join(HARNESS_ROOT, 'knowledge');
const BASE_URL = process.env.ACREOS_BASE_URL ?? 'https://acreos.fly.dev';
const MAX_STEPS_DEFAULT = parseInt(
  process.env.MAX_STEPS_PER_JOURNEY ?? '150',
  10,
);
const HEADLESS = process.env.HEADLESS !== 'false';

// Patterns that suggest AI-generated output is on screen
const AI_OUTPUT_MARKERS = [
  'atlas analysis',
  'ai analysis',
  'ai recommendation',
  'pax suggests',
  'sophie says',
  'confidence:',
  'risk assessment',
  'comps analysis',
  'estimated value',
  'ai-generated',
];

// ── Runner Options ──────────────────────────────────────────────────────────

export interface RunOptions {
  personaPath: string;
  journeyPath: string;
  knowledgeDir?: string;
  headless?: boolean;
  maxSteps?: number;
  baseUrl?: string;
}

// ── Main Runner ─────────────────────────────────────────────────────────────

/**
 * Orchestrate a single persona-journey run:
 * 1. Load persona, knowledge, journey files
 * 2. Create ClaudeAgent and BrowserController
 * 3. Run the observe-decide-execute loop
 * 4. Evaluate AI outputs when detected
 * 5. Write transcript and return RunResult
 */
export async function runJourney(options: RunOptions): Promise<RunResult> {
  const {
    personaPath,
    journeyPath,
    knowledgeDir = KNOWLEDGE_DIR,
    headless = HEADLESS,
    maxSteps: maxStepsOverride,
    baseUrl = BASE_URL,
  } = options;

  const runId = `${new Date().toISOString().slice(0, 10)}_${randomUUID().slice(0, 8)}`;
  const startedAt = Date.now();

  // ── Load inputs ───────────────────────────────────────────────────────

  const [persona, journey, knowledgeFiles] = await Promise.all([
    loadPersona(personaPath),
    loadJourney(journeyPath),
    loadKnowledge(knowledgeDir),
  ]);

  const personaFileContent = await readFile(personaPath, 'utf-8');
  const journeyFileContent = await readFile(journeyPath, 'utf-8');

  const maxSteps = maxStepsOverride ?? journey.maxSteps ?? MAX_STEPS_DEFAULT;

  // ── Initialize components ─────────────────────────────────────────────

  const agent = new ClaudeAgent(personaFileContent, knowledgeFiles, journeyFileContent);
  const browser = new BrowserController();
  const transcript = new TranscriptWriter(ARTIFACTS_DIR, runId);

  await transcript.initialize();

  await browser.launch({
    headless,
    viewport: persona.viewport,
  });

  const findings: string[] = [];

  try {
    // ── Start URL ─────────────────────────────────────────────────────

    const startUrl = journey.startUrl
      ? resolveUrl(journey.startUrl, baseUrl)
      : baseUrl;

    let observation = await browser.navigate(startUrl);
    let stepNumber = 0;

    // ── Decision loop ─────────────────────────────────────────────────

    while (stepNumber < maxSteps) {
      stepNumber++;
      const stepStart = Date.now();

      // Ask Claude what to do
      const decision = await agent.decideNextAction(observation);

      // Save screenshot
      const screenshotPath = await transcript.saveScreenshot(
        stepNumber,
        observation.screenshot,
      );

      // Check for AI-generated output in visible text
      await checkForAIOutput(
        agent,
        transcript,
        observation,
        stepNumber,
      );

      // Execute the action
      let nextObservation: UIObservation;
      try {
        nextObservation = await browser.executeAction(decision);
      } catch (err) {
        // Action failed — record it, ask Claude to react
        const errorDetail =
          err instanceof Error ? err.message : String(err);
        findings.push(
          `Step ${stepNumber}: Action failed — ${formatDecision(decision)}: ${errorDetail}`,
        );

        const surprise = await agent.reactToSurprise({
          type: 'action_failed',
          detail: `${formatDecision(decision)} failed: ${errorDetail}`,
        });

        findings.push(
          `Step ${stepNumber}: Persona reaction — "${surprise.reaction}"`,
        );

        // Re-observe current state after the failure
        nextObservation = await browser.observe();
      }

      const durationMs = Date.now() - stepStart;

      // Record the step
      const step: StepRecord = {
        stepNumber,
        timestamp: Date.now(),
        observation,
        decision,
        screenshotPath,
        durationMs,
      };
      transcript.recordStep(step);

      // Check for console errors
      if (observation.consoleErrors.length > 0) {
        findings.push(
          `Step ${stepNumber}: ${observation.consoleErrors.length} console error(s) — ` +
            observation.consoleErrors[0].slice(0, 100),
        );
      }

      // Check for terminal decisions
      if (decision.type === 'abandon') {
        findings.push(
          `ABANDONED at step ${stepNumber}: ${decision.reason}`,
        );
        break;
      }

      if (decision.type === 'complete') {
        findings.push(
          `COMPLETED at step ${stepNumber}: satisfaction=${decision.satisfaction}/5 — ${decision.summary}`,
        );
        break;
      }

      // Advance to next iteration
      observation = nextObservation;
    }

    // If we hit max steps without terminal decision, note it
    if (stepNumber >= maxSteps) {
      findings.push(
        `Reached max steps (${maxSteps}) without completion or abandonment.`,
      );
    }

    // ── Journey verdict ───────────────────────────────────────────────

    const verdict = await agent.assessJourneyCompletion(stepNumber, findings);

    // Write transcript
    const transcriptPath = await transcript.writeTranscript(
      persona.id,
      journey.id,
      verdict,
    );

    const { steps, aiEvaluations } = transcript.getRecords();

    const result: RunResult = {
      runId,
      personaId: persona.id,
      journeyId: journey.id,
      startedAt,
      completedAt: Date.now(),
      stepCount: stepNumber,
      verdict,
      steps,
      aiEvaluations,
      tokenUsage: agent.getTokenUsage(),
      transcriptPath,
    };

    return result;
  } finally {
    await browser.close();
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Resolve a possibly-relative journey startUrl against the base URL.
 */
function resolveUrl(url: string, baseUrl: string): string {
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url;
  }
  // Relative path
  return new URL(url, baseUrl).toString();
}

/**
 * Format a Decision for logging.
 */
function formatDecision(decision: Decision): string {
  switch (decision.type) {
    case 'click':
      return `click(${decision.selector})`;
    case 'type':
      return `type(${decision.selector}, "${decision.text.slice(0, 40)}")`;
    case 'navigate':
      return `navigate(${decision.url})`;
    case 'scroll':
      return `scroll(${decision.direction})`;
    case 'wait':
      return `wait(${decision.ms}ms)`;
    case 'abandon':
      return `abandon(${decision.reason.slice(0, 60)})`;
    case 'complete':
      return `complete(${decision.summary.slice(0, 60)})`;
  }
}

/**
 * Check if the current page shows AI-generated output, and if so,
 * evaluate its quality using the ClaudeAgent.
 */
async function checkForAIOutput(
  agent: ClaudeAgent,
  transcript: TranscriptWriter,
  observation: UIObservation,
  stepNumber: number,
): Promise<void> {
  const lowerText = observation.visibleText.toLowerCase();
  const hasAIOutput = AI_OUTPUT_MARKERS.some((marker) =>
    lowerText.includes(marker),
  );

  if (!hasAIOutput) return;

  try {
    // Extract the portion of text that looks AI-generated.
    // We send the full visible text to Claude for evaluation.
    const finding = await agent.evaluateAIOutput(
      observation.visibleText,
      `Page: ${observation.url} | Title: ${observation.title}`,
    );

    transcript.recordAIEvaluation({
      stepNumber,
      output: observation.visibleText.slice(0, 2000),
      context: `${observation.url} — ${observation.title}`,
      finding,
    });
  } catch {
    // Non-critical — don't let evaluation failures break the run
  }
}
