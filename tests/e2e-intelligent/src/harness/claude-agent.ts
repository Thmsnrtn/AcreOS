import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import pRetry from 'p-retry';
import type {
  Decision,
  UIObservation,
  AIQualityFinding,
  JourneyVerdict,
} from './types.js';

// ── Configuration ───────────────────────────────────────────────────────────

const CLAUDE_MODEL = process.env.CLAUDE_MODEL ?? 'claude-sonnet-4-20250514';
const CLAUDE_MAX_TOKENS = parseInt(
  process.env.CLAUDE_MAX_TOKENS ?? '4096',
  10,
);
const MAX_RETRIES = 5;

// ── Token Usage Tracking ────────────────────────────────────────────────────

interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheHits: number;
}

// ── ClaudeAgent ─────────────────────────────────────────────────────────────

export class ClaudeAgent {
  private client: Anthropic;
  private systemBlocks: Anthropic.Messages.TextBlockParam[];
  private usage: TokenUsage = { inputTokens: 0, outputTokens: 0, cacheHits: 0 };

  constructor(
    personaFile: string,
    knowledgeFiles: string[],
    journeyFile: string,
  ) {
    this.client = new Anthropic();

    // Build system prompt blocks with prompt caching.
    // Each block gets cache_control: ephemeral so the Anthropic API can
    // cache the persona + knowledge + journey context across turns.
    this.systemBlocks = [
      {
        type: 'text' as const,
        text: [
          '# Persona',
          '',
          personaFile,
        ].join('\n'),
        cache_control: { type: 'ephemeral' as const },
      },
      {
        type: 'text' as const,
        text: [
          '# Domain Knowledge',
          '',
          ...knowledgeFiles,
        ].join('\n'),
        cache_control: { type: 'ephemeral' as const },
      },
      {
        type: 'text' as const,
        text: [
          '# Journey',
          '',
          journeyFile,
        ].join('\n'),
        cache_control: { type: 'ephemeral' as const },
      },
    ];
  }

  // ── Public Methods ──────────────────────────────────────────────────────

  /**
   * Given a screenshot + page metadata, decide the next action to take.
   * Returns a structured Decision.
   */
  async decideNextAction(observation: UIObservation): Promise<Decision> {
    const userContent: Anthropic.Messages.ContentBlockParam[] = [
      {
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/png',
          data: observation.screenshot,
        },
      },
      {
        type: 'text',
        text: JSON.stringify(
          {
            url: observation.url,
            title: observation.title,
            visibleText: observation.visibleText,
            consoleErrors: observation.consoleErrors,
            timestamp: observation.timestamp,
          },
          null,
          2,
        ),
      },
      {
        type: 'text',
        text: [
          'Based on the screenshot and page metadata above, decide your next action.',
          'Stay in character as the persona described in the system prompt.',
          '',
          'Respond with ONLY a JSON object matching one of these shapes:',
          '  { "type": "click", "selector": "<CSS selector>", "reasoning": "...", "thought": "..." }',
          '  { "type": "type", "selector": "<CSS selector>", "text": "<text to type>", "reasoning": "...", "thought": "..." }',
          '  { "type": "navigate", "url": "<full URL>", "reasoning": "...", "thought": "..." }',
          '  { "type": "scroll", "direction": "up" | "down", "reasoning": "..." }',
          '  { "type": "wait", "ms": <milliseconds>, "reasoning": "..." }',
          '  { "type": "abandon", "reason": "...", "thought": "...", "severity": "low|medium|high|critical" }',
          '  { "type": "complete", "summary": "...", "thought": "...", "satisfaction": <1-5> }',
          '',
          '"thought" = what the persona would say out loud (in character).',
          '"reasoning" = your analytical reasoning for why this action is correct.',
          '',
          'IMPORTANT: Use specific, robust CSS selectors. Prefer data-testid, aria-label, or role-based selectors.',
          'If you see an AI-generated output (analysis, recommendation, etc.), note it — it may be evaluated separately.',
        ].join('\n'),
      },
    ];

    const raw = await this.callClaude(userContent);
    return this.parseDecision(raw);
  }

  /**
   * Evaluate an AI-generated output for domain credibility.
   */
  async evaluateAIOutput(
    output: string,
    context: string,
  ): Promise<AIQualityFinding> {
    const userContent: Anthropic.Messages.ContentBlockParam[] = [
      {
        type: 'text',
        text: [
          '# AI Output Evaluation',
          '',
          '## Context',
          context,
          '',
          '## AI-Generated Output',
          output,
          '',
          'Using your domain knowledge, evaluate this AI output for quality and credibility.',
          '',
          'Respond with ONLY a JSON object:',
          '{',
          '  "domainAccuracy": <1-5>,',
          '  "actionability": <1-5>,',
          '  "appropriateCaution": <1-5>,',
          '  "signalToNoise": <1-5>,',
          '  "credibility": <1-5>,',
          '  "overall": "CREDIBLE" | "QUESTIONABLE" | "NOT_CREDIBLE",',
          '  "reasoning": "<detailed explanation>"',
          '}',
          '',
          'Scoring guide:',
          '  1 = Completely wrong / useless / dangerous',
          '  2 = Mostly wrong or misleading',
          '  3 = Partially correct but incomplete or vague',
          '  4 = Mostly correct and useful',
          '  5 = Accurate, actionable, and appropriately cautious',
        ].join('\n'),
      },
    ];

    const raw = await this.callClaude(userContent);
    return this.parseJSON<AIQualityFinding>(raw);
  }

  /**
   * React to an unexpected UI event (error, empty state, surprise content).
   */
  async reactToSurprise(surprise: {
    type: string;
    detail: string;
  }): Promise<{ reaction: string; nextAction: Decision }> {
    const userContent: Anthropic.Messages.ContentBlockParam[] = [
      {
        type: 'text',
        text: [
          '# Unexpected Event',
          '',
          `Type: ${surprise.type}`,
          `Detail: ${surprise.detail}`,
          '',
          'Stay in character. How would the persona react to this?',
          '',
          'Respond with ONLY a JSON object:',
          '{',
          '  "reaction": "<what the persona would say or think>",',
          '  "nextAction": <a Decision object — same format as decideNextAction>',
          '}',
        ].join('\n'),
      },
    ];

    const raw = await this.callClaude(userContent);
    return this.parseJSON<{ reaction: string; nextAction: Decision }>(raw);
  }

  /**
   * Assess whether the journey is complete, and render a final verdict.
   */
  async assessJourneyCompletion(
    stepCount: number,
    findings: string[],
  ): Promise<JourneyVerdict> {
    const userContent: Anthropic.Messages.ContentBlockParam[] = [
      {
        type: 'text',
        text: [
          '# Journey Completion Assessment',
          '',
          `Steps taken: ${stepCount}`,
          '',
          '## Key Findings',
          ...findings.map((f, i) => `${i + 1}. ${f}`),
          '',
          'Based on the persona\'s goals, success criteria, and abandonment triggers,',
          'assess the overall journey outcome.',
          '',
          'Respond with ONLY a JSON object:',
          '{',
          '  "outcome": "COMPLETED_SATISFIED" | "COMPLETED_UNSATISFIED" | "ABANDONED" | "BLOCKED",',
          '  "wouldRecommend": "yes" | "not_yet" | "no",',
          '  "reasoning": "<paragraph explaining the verdict>",',
          '  "topIssues": ["<issue 1>", "<issue 2>", ...],',
          '  "satisfaction": <1-5>',
          '}',
        ].join('\n'),
      },
    ];

    const raw = await this.callClaude(userContent);
    return this.parseJSON<JourneyVerdict>(raw);
  }

  /**
   * Return cumulative token usage across all calls.
   */
  getTokenUsage(): TokenUsage {
    return { ...this.usage };
  }

  // ── Private Helpers ─────────────────────────────────────────────────────

  /**
   * Call the Anthropic API with retry logic (exponential backoff on 429/529).
   * Returns the text content from the response.
   */
  private async callClaude(
    userContent: Anthropic.Messages.ContentBlockParam[],
  ): Promise<string> {
    const run = async () => {
      const response = await this.client.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: CLAUDE_MAX_TOKENS,
        system: this.systemBlocks,
        messages: [{ role: 'user', content: userContent }],
      });

      // Track token usage
      if (response.usage) {
        this.usage.inputTokens += response.usage.input_tokens;
        this.usage.outputTokens += response.usage.output_tokens;
        if ('cache_read_input_tokens' in response.usage) {
          this.usage.cacheHits += (response.usage as unknown as Record<string, number>).cache_read_input_tokens ?? 0;
        }
      }

      // Extract text from response
      const textBlock = response.content.find(
        (block) => block.type === 'text',
      );
      if (!textBlock || textBlock.type !== 'text') {
        throw new Error('No text content in Claude response');
      }
      return textBlock.text;
    };

    return pRetry(run, {
      retries: MAX_RETRIES,
      minTimeout: 1000,
      maxTimeout: 30_000,
      factor: 2,
      shouldRetry: (error: unknown) => {
        if (error instanceof Anthropic.APIError) {
          // Retry on rate limit (429) and overloaded (529)
          return error.status === 429 || error.status === 529;
        }
        return false;
      },
      onFailedAttempt: (error) => {
        console.warn(
          `Claude API attempt ${error.attemptNumber} failed. ` +
            `${error.retriesLeft} retries left.`,
        );
      },
    });
  }

  /**
   * Parse a JSON string from Claude's response, handling markdown fences.
   */
  private parseJSON<T>(raw: string): T {
    // Strip markdown code fences if present
    const cleaned = raw
      .replace(/^```json\s*\n?/i, '')
      .replace(/^```\s*\n?/, '')
      .replace(/\n?```\s*$/, '')
      .trim();

    try {
      return JSON.parse(cleaned) as T;
    } catch (err) {
      throw new Error(
        `Failed to parse Claude JSON response: ${(err as Error).message}\nRaw: ${raw.slice(0, 500)}`,
      );
    }
  }

  /**
   * Parse a Decision from Claude's raw text response.
   */
  private parseDecision(raw: string): Decision {
    const decision = this.parseJSON<Decision>(raw);

    // Validate the decision type
    const validTypes = [
      'click',
      'type',
      'navigate',
      'scroll',
      'wait',
      'abandon',
      'complete',
    ];
    if (!validTypes.includes(decision.type)) {
      throw new Error(`Invalid decision type: ${(decision as Record<string, unknown>).type}`);
    }

    return decision;
  }
}
