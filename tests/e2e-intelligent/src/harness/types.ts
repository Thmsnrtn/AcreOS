/**
 * Core types for the AcreOS intelligent E2E test harness.
 */

// ── Claude Agent Decisions ──────────────────────────────────────────────────

export type Decision =
  | { type: 'click'; selector: string; reasoning: string; thought: string }
  | { type: 'type'; selector: string; text: string; reasoning: string; thought: string }
  | { type: 'navigate'; url: string; reasoning: string; thought: string }
  | { type: 'scroll'; direction: 'up' | 'down'; reasoning: string }
  | { type: 'wait'; ms: number; reasoning: string }
  | { type: 'abandon'; reason: string; thought: string; severity: string }
  | { type: 'complete'; summary: string; thought: string; satisfaction: number };

// ── Browser Observations ────────────────────────────────────────────────────

export interface UIObservation {
  screenshot: string; // base64 PNG
  url: string;
  title: string;
  visibleText: string;
  consoleErrors: string[];
  timestamp: number;
}

// ── AI Quality Evaluation ───────────────────────────────────────────────────

export interface AIQualityFinding {
  domainAccuracy: number; // 1-5
  actionability: number; // 1-5
  appropriateCaution: number; // 1-5
  signalToNoise: number; // 1-5
  credibility: number; // 1-5
  overall: 'CREDIBLE' | 'QUESTIONABLE' | 'NOT_CREDIBLE';
  reasoning: string;
}

// ── Journey Verdict ─────────────────────────────────────────────────────────

export interface JourneyVerdict {
  outcome: 'COMPLETED_SATISFIED' | 'COMPLETED_UNSATISFIED' | 'ABANDONED' | 'BLOCKED';
  wouldRecommend: 'yes' | 'not_yet' | 'no';
  reasoning: string;
  topIssues: string[];
  satisfaction: number; // 1-5
}

// ── Persona & Journey Configs ───────────────────────────────────────────────

export interface PersonaConfig {
  id: string;
  name: string;
  age: number;
  location: string;
  yearsInvesting: string;
  capitalAvailable: string;
  investmentThesis: string;
  sourceOfInterest: string;
  techComfort: string;
  patience: string;
  preferredDevice: string;
  competitorMentalModel: string;
  assignedJourneys: string[];
  viewport: { width: number; height: number };
  successCriteria: string[];
  abandonmentTriggers: string[];
  backstory: string;
}

export interface JourneyConfig {
  id: string;
  name: string;
  description: string;
  startUrl: string;
  maxSteps: number;
  timeoutMinutes: number;
  successConditions: string[];
  body: string;
}

// ── Run Results ─────────────────────────────────────────────────────────────

export interface StepRecord {
  stepNumber: number;
  timestamp: number;
  observation: UIObservation;
  decision: Decision;
  screenshotPath: string;
  durationMs: number;
}

export interface AIOutputEvaluation {
  stepNumber: number;
  output: string;
  context: string;
  finding: AIQualityFinding;
}

export interface RunResult {
  runId: string;
  personaId: string;
  journeyId: string;
  startedAt: number;
  completedAt: number;
  stepCount: number;
  verdict: JourneyVerdict;
  steps: StepRecord[];
  aiEvaluations: AIOutputEvaluation[];
  tokenUsage: { inputTokens: number; outputTokens: number; cacheHits: number };
  transcriptPath: string;
}
