import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  Decision,
  StepRecord,
  AIOutputEvaluation,
  JourneyVerdict,
  RunResult,
} from './types.js';

// ── TranscriptWriter ────────────────────────────────────────────────────────

export class TranscriptWriter {
  private runDir: string;
  private screenshotDir: string;
  private steps: StepRecord[] = [];
  private aiEvaluations: AIOutputEvaluation[] = [];
  private decisionLog: object[] = [];
  private initialized = false;

  constructor(
    private artifactsBase: string,
    private runId: string,
  ) {
    this.runDir = join(artifactsBase, 'runs', runId);
    this.screenshotDir = join(this.runDir, 'screenshots');
  }

  /**
   * Create the run directory structure.
   */
  async initialize(): Promise<void> {
    await mkdir(this.screenshotDir, { recursive: true });
    this.initialized = true;
  }

  /**
   * Save a screenshot to disk and return the relative path.
   */
  async saveScreenshot(
    stepNumber: number,
    base64Png: string,
  ): Promise<string> {
    this.ensureInitialized();
    const filename = `step-${String(stepNumber).padStart(3, '0')}.png`;
    const filePath = join(this.screenshotDir, filename);
    await writeFile(filePath, Buffer.from(base64Png, 'base64'));
    return `screenshots/${filename}`;
  }

  /**
   * Record a step in the transcript.
   */
  recordStep(step: StepRecord): void {
    this.steps.push(step);

    // Also add to the JSONL decision log
    this.decisionLog.push({
      step: step.stepNumber,
      timestamp: step.timestamp,
      url: step.observation.url,
      decision: step.decision,
      consoleErrors: step.observation.consoleErrors,
      durationMs: step.durationMs,
    });
  }

  /**
   * Record an AI output evaluation.
   */
  recordAIEvaluation(evaluation: AIOutputEvaluation): void {
    this.aiEvaluations.push(evaluation);
  }

  /**
   * Write the final transcript files:
   * - transcript.md (human-readable markdown)
   * - claude-reasoning.jsonl (machine-readable decision log)
   */
  async writeTranscript(
    personaId: string,
    journeyId: string,
    verdict: JourneyVerdict,
  ): Promise<string> {
    this.ensureInitialized();

    const transcriptPath = join(this.runDir, 'transcript.md');
    const jsonlPath = join(this.runDir, 'claude-reasoning.jsonl');

    // Build markdown transcript
    const md = this.buildMarkdownTranscript(personaId, journeyId, verdict);
    await writeFile(transcriptPath, md, 'utf-8');

    // Write JSONL decision log
    const jsonl = this.decisionLog
      .map((entry) => JSON.stringify(entry))
      .join('\n');
    await writeFile(jsonlPath, jsonl + '\n', 'utf-8');

    return transcriptPath;
  }

  /**
   * Return collected steps and evaluations (for RunResult assembly).
   */
  getRecords(): {
    steps: StepRecord[];
    aiEvaluations: AIOutputEvaluation[];
  } {
    return {
      steps: [...this.steps],
      aiEvaluations: [...this.aiEvaluations],
    };
  }

  // ── Private ─────────────────────────────────────────────────────────────

  private buildMarkdownTranscript(
    personaId: string,
    journeyId: string,
    verdict: JourneyVerdict,
  ): string {
    const lines: string[] = [];

    lines.push(`# E2E Intelligent Test Transcript`);
    lines.push('');
    lines.push(`- **Run ID**: ${this.runId}`);
    lines.push(`- **Persona**: ${personaId}`);
    lines.push(`- **Journey**: ${journeyId}`);
    lines.push(`- **Date**: ${new Date().toISOString()}`);
    lines.push(`- **Steps**: ${this.steps.length}`);
    lines.push('');

    // Steps
    lines.push('---');
    lines.push('');
    lines.push('## Steps');
    lines.push('');

    for (const step of this.steps) {
      lines.push(`### Step ${step.stepNumber}`);
      lines.push('');
      lines.push(`- **URL**: ${step.observation.url}`);
      lines.push(`- **Screenshot**: ![step](${step.screenshotPath})`);
      lines.push(`- **Action**: \`${formatDecision(step.decision)}\``);
      lines.push(`- **Duration**: ${step.durationMs}ms`);

      if ('reasoning' in step.decision) {
        lines.push(`- **Reasoning**: ${step.decision.reasoning}`);
      }
      if ('thought' in step.decision && step.decision.thought) {
        lines.push(`- **In-character thought**: _"${step.decision.thought}"_`);
      }

      if (step.observation.consoleErrors.length > 0) {
        lines.push(`- **Console errors**: ${step.observation.consoleErrors.length}`);
        for (const err of step.observation.consoleErrors) {
          lines.push(`  - \`${err.slice(0, 200)}\``);
        }
      }

      lines.push('');
    }

    // AI Output Evaluations
    if (this.aiEvaluations.length > 0) {
      lines.push('---');
      lines.push('');
      lines.push('## AI Output Evaluations');
      lines.push('');

      for (const ev of this.aiEvaluations) {
        lines.push(`### Evaluation at Step ${ev.stepNumber}`);
        lines.push('');
        lines.push(`- **Context**: ${ev.context}`);
        lines.push(`- **Overall**: ${ev.finding.overall}`);
        lines.push(`- **Domain Accuracy**: ${ev.finding.domainAccuracy}/5`);
        lines.push(`- **Actionability**: ${ev.finding.actionability}/5`);
        lines.push(`- **Appropriate Caution**: ${ev.finding.appropriateCaution}/5`);
        lines.push(`- **Signal to Noise**: ${ev.finding.signalToNoise}/5`);
        lines.push(`- **Credibility**: ${ev.finding.credibility}/5`);
        lines.push(`- **Reasoning**: ${ev.finding.reasoning}`);
        lines.push('');
      }
    }

    // Journey Verdict
    lines.push('---');
    lines.push('');
    lines.push('## Journey Verdict');
    lines.push('');
    lines.push(`- **Outcome**: ${verdict.outcome}`);
    lines.push(`- **Satisfaction**: ${verdict.satisfaction}/5`);
    lines.push(`- **Would Recommend**: ${verdict.wouldRecommend}`);
    lines.push(`- **Reasoning**: ${verdict.reasoning}`);
    lines.push('');

    if (verdict.topIssues.length > 0) {
      lines.push('### Top Issues');
      lines.push('');
      for (const issue of verdict.topIssues) {
        lines.push(`- ${issue}`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error(
        'TranscriptWriter not initialized. Call initialize() first.',
      );
    }
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function formatDecision(decision: Decision): string {
  switch (decision.type) {
    case 'click':
      return `click(${decision.selector})`;
    case 'type':
      return `type(${decision.selector}, "${decision.text.slice(0, 50)}")`;
    case 'navigate':
      return `navigate(${decision.url})`;
    case 'scroll':
      return `scroll(${decision.direction})`;
    case 'wait':
      return `wait(${decision.ms}ms)`;
    case 'abandon':
      return `abandon: ${decision.reason.slice(0, 80)}`;
    case 'complete':
      return `complete: ${decision.summary.slice(0, 80)}`;
  }
}
