#!/usr/bin/env tsx
/**
 * Layer 3 — LLM Exploratory Testing
 *
 * Uses Claude to autonomously explore the AcreOS API as a given persona,
 * making decisions about what to do next based on response data.
 * Produces a structured friction report at the end.
 *
 * After each action, Claude also rates conversion funnel metrics:
 *   - continueProbability (0-100)
 *   - primaryFriction (one sentence)
 *   - wouldPay ("yes" | "no" | "maybe" with reasoning)
 *
 * Usage:
 *   npx tsx tests/simulation/llm-explorer.ts --persona firstTimer --actions 50
 *   npx tsx tests/simulation/llm-explorer.ts --persona firstTimer --actions 20 --runs 10
 *
 * Environment:
 *   ANTHROPIC_API_KEY — required (exits gracefully if missing)
 *   SIM_BASE_URL     — override base URL (default: http://localhost:5000)
 */

import { createAuthenticatedSession, apiCall, type AuthSession, type ApiCallResult } from "./helpers";
import { PERSONAS, type PersonaKey } from "./personas";
import * as fs from "node:fs";
import * as path from "node:path";

// ── CLI Args ──────────────────────────────────────────────────────────────

function parseArgs(): { persona: PersonaKey; actions: number; runs: number } {
  const args = process.argv.slice(2);
  let persona: PersonaKey = "firstTimer";
  let actions = 50;
  let runs = 20;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--persona" && args[i + 1]) {
      const val = args[i + 1];
      if (val in PERSONAS) {
        persona = val as PersonaKey;
      } else {
        console.error(`[explorer] Unknown persona: ${val}`);
        console.error(`[explorer] Available: ${Object.keys(PERSONAS).join(", ")}`);
        process.exit(1);
      }
      i++;
    } else if (args[i] === "--actions" && args[i + 1]) {
      actions = parseInt(args[i + 1], 10);
      if (isNaN(actions) || actions < 1) actions = 50;
      i++;
    } else if (args[i] === "--runs" && args[i + 1]) {
      runs = parseInt(args[i + 1], 10);
      if (isNaN(runs) || runs < 1) runs = 20;
      i++;
    }
  }

  return { persona, actions, runs };
}

// ── API Endpoint Catalog ────────────────────────────────────────────────

const API_ENDPOINTS = `
## Core Endpoints

### Auth
- GET  /api/auth/user           — Get current user profile
- POST /api/auth/user           — Update user profile

### Onboarding
- GET  /api/onboarding/status   — Get onboarding state
- POST /api/onboarding/complete — Complete onboarding wizard
- POST /api/onboarding/skip     — Skip onboarding
- GET  /api/onboarding/checklist — Get checklist items
- POST /api/onboarding/checklist/:item — Mark checklist item done

### Leads
- GET    /api/leads             — List leads (supports ?page, ?limit, ?search, ?status)
- POST   /api/leads             — Create a lead (firstName, lastName, email, phone, status)
- GET    /api/leads/:id         — Get lead detail
- PUT    /api/leads/:id         — Update a lead
- DELETE /api/leads/:id         — Delete a lead
- POST   /api/leads/import      — Import leads from CSV (multipart form)

### Deals
- GET    /api/deals             — List deals
- POST   /api/deals             — Create a deal (name, stage, offerAmount)
- GET    /api/deals/:id         — Get deal detail
- PUT    /api/deals/:id         — Update a deal
- DELETE /api/deals/:id         — Delete a deal

### Properties
- GET    /api/properties        — List properties
- POST   /api/properties        — Create property (address, county, state, acreage, askingPrice)
- GET    /api/properties/:id    — Get property detail
- PUT    /api/properties/:id    — Update property
- DELETE /api/properties/:id    — Delete property

### Notes (Seller Finance)
- GET    /api/notes             — List notes
- POST   /api/notes             — Create note (borrowerName, borrowerEmail, originalBalance, currentBalance, interestRate, termMonths, monthlyPayment, startDate, status)
- GET    /api/notes/:id         — Get note detail
- PUT    /api/notes/:id         — Update note
- DELETE /api/notes/:id         — Delete note

### Campaigns
- GET    /api/campaigns         — List campaigns
- POST   /api/campaigns         — Create campaign (name, type, status)
- GET    /api/campaigns/:id     — Get campaign detail
- PUT    /api/campaigns/:id     — Update campaign
- DELETE /api/campaigns/:id     — Delete campaign

### Dashboard & Analytics
- GET  /api/dashboard/stats     — Dashboard summary stats
- GET  /api/usage/summary       — Usage breakdown

### Billing & Credits
- GET  /api/credits/balance     — Credit balance
- GET  /api/credits/transactions — Transaction history

### Settings
- GET  /api/settings            — Get org settings
- PUT  /api/settings            — Update org settings

### Team
- GET    /api/team              — List team members
- POST   /api/team/invite       — Invite team member
`.trim();

// ── System Prompt Builder ────────────────────────────────────────────────

function buildSystemPrompt(personaKey: PersonaKey, dataState: string): string {
  const persona = PERSONAS[personaKey];
  return `You are a simulated user testing the AcreOS land investing platform API.

## Your Persona
- Name: ${persona.name}
- Email: ${persona.email}
- Subscription tier: ${persona.tier}
- Onboarding path: ${persona.onboardingPath}
- Expected journey: ${persona.expectedJourney.join(" → ")}

## Your Goal
Explore the API naturally as this persona would. Try to complete tasks from the expected journey. Look for:
- Confusing error messages
- Missing validation feedback
- Slow responses (>500ms is notable, >2000ms is a problem)
- 500 errors (always a problem)
- Unexpected 404s or 403s
- Workflows that feel incomplete or broken
- Missing features you'd expect

## Available API Endpoints
${API_ENDPOINTS}

## Current Data State
${dataState}

## Response Format
For each action, respond with EXACTLY one JSON block:
\`\`\`json
{
  "reasoning": "Brief explanation of what you're trying to do and why",
  "method": "GET|POST|PUT|DELETE",
  "path": "/api/...",
  "body": null
}
\`\`\`

Use null for body on GET/DELETE requests. For POST/PUT, provide the request body as a JSON object.
Only respond with ONE action at a time. Do not include any text outside the JSON block.`;
}

// ── Conversion Funnel Rating Prompt ──────────────────────────────────────

function buildFunnelRatingPrompt(
  action: ParsedAction,
  result: ApiCallResult,
  iteration: number,
  totalActions: number,
): string {
  return `You just performed action ${iteration}/${totalActions}: ${action.method} ${action.path}
Result: status ${result.status}, ${result.durationMs}ms${result.error ? `, error: ${result.error}` : ""}

Rate the following as this persona experiencing this product. Respond with ONLY a JSON block:
\`\`\`json
{
  "continueProbability": <0-100 integer — how likely is this user to continue to the next step?>,
  "primaryFriction": "<one sentence — what is the primary friction at this point?>",
  "wouldPay": "<yes|no|maybe>",
  "wouldPayReasoning": "<one sentence explaining why>"
}
\`\`\``;
}

// ── Friction Report Prompt ──────────────────────────────────────────────

const FRICTION_REPORT_PROMPT = `Based on all the API interactions in this conversation, produce a structured friction report as a single JSON block.

\`\`\`json
{
  "persona": "personaKey",
  "totalActions": 0,
  "errorCount": 0,
  "avgResponseMs": 0,
  "frictionPoints": [
    {
      "severity": "high|medium|low",
      "action": "What was attempted",
      "endpoint": "METHOD /api/path",
      "statusCode": 200,
      "responseMs": 0,
      "issue": "What went wrong or was confusing",
      "suggestion": "How to improve this"
    }
  ],
  "performanceIssues": [
    {
      "endpoint": "METHOD /api/path",
      "avgMs": 0,
      "maxMs": 0,
      "suggestion": "How to improve"
    }
  ],
  "missingFeatures": [
    {
      "description": "What's missing",
      "impact": "high|medium|low",
      "suggestion": "What to build"
    }
  ],
  "summary": "2-3 sentence overall assessment"
}
\`\`\`

Only output the JSON block, no other text.`;

// ── LLM Client ──────────────────────────────────────────────────────────

interface Message {
  role: "user" | "assistant";
  content: string;
}

async function callClaude(
  apiKey: string,
  systemPrompt: string,
  messages: Message[],
  maxTokens: number = 1024,
  temperature: number = 1.0,
): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: maxTokens,
      temperature,
      system: systemPrompt,
      messages,
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${errBody}`);
  }

  const data = await res.json() as any;
  return data.content?.[0]?.text ?? "";
}

// ── Action Parser ────────────────────────────────────────────────────────

interface ParsedAction {
  reasoning: string;
  method: string;
  path: string;
  body: any;
}

export interface FunnelRating {
  continueProbability: number;
  primaryFriction: string;
  wouldPay: "yes" | "no" | "maybe";
  wouldPayReasoning: string;
}

function parseAction(text: string): ParsedAction | null {
  // Extract JSON from markdown code block or raw JSON
  const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  const jsonStr = codeBlockMatch ? codeBlockMatch[1].trim() : text.trim();

  try {
    const parsed = JSON.parse(jsonStr);
    if (parsed.method && parsed.path) {
      return {
        reasoning: parsed.reasoning ?? "",
        method: parsed.method.toUpperCase(),
        path: parsed.path,
        body: parsed.body ?? null,
      };
    }
  } catch {
    // Try to find any JSON object in the text
    const jsonMatch = text.match(/\{[\s\S]*"method"[\s\S]*"path"[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          reasoning: parsed.reasoning ?? "",
          method: parsed.method.toUpperCase(),
          path: parsed.path,
          body: parsed.body ?? null,
        };
      } catch {
        // give up
      }
    }
  }
  return null;
}

function parseFunnelRating(text: string): FunnelRating | null {
  const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  const jsonStr = codeBlockMatch ? codeBlockMatch[1].trim() : text.trim();
  try {
    const parsed = JSON.parse(jsonStr);
    return {
      continueProbability: typeof parsed.continueProbability === "number" ? parsed.continueProbability : 50,
      primaryFriction: parsed.primaryFriction ?? "Unknown",
      wouldPay: ["yes", "no", "maybe"].includes(parsed.wouldPay) ? parsed.wouldPay : "maybe",
      wouldPayReasoning: parsed.wouldPayReasoning ?? "",
    };
  } catch {
    return null;
  }
}

function parseFrictionReport(text: string): any {
  const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  const jsonStr = codeBlockMatch ? codeBlockMatch[1].trim() : text.trim();
  try {
    return JSON.parse(jsonStr);
  } catch {
    return { error: "Failed to parse friction report", raw: text };
  }
}

// ── Single Run ──────────────────────────────────────────────────────────

export interface ActionLogEntryWithFunnel {
  iteration: number;
  reasoning: string;
  method: string;
  path: string;
  status: number;
  durationMs: number;
  error?: string;
  body?: any;
  funnelRating?: FunnelRating;
}

async function runExploration(
  apiKey: string,
  persona: PersonaKey,
  actions: number,
  runIndex: number,
  temperature: number,
): Promise<{
  actionLog: ActionLogEntryWithFunnel[];
  frictionReport: any;
}> {
  const personaDef = PERSONAS[persona];

  console.log(`[explorer] Run ${runIndex + 1}: temp=${temperature.toFixed(2)}, persona=${personaDef.name}`);

  // Authenticate
  let session: AuthSession;
  try {
    session = await createAuthenticatedSession(persona);
  } catch (err) {
    console.error(`[explorer] Run ${runIndex + 1}: Failed to authenticate:`, err);
    return { actionLog: [], frictionReport: { error: "Auth failed" } };
  }

  // Build initial data state summary
  const initialState = await gatherDataState(session);

  const systemPrompt = buildSystemPrompt(persona, initialState);
  const messages: Message[] = [];
  const actionLog: Array<{
    iteration: number;
    reasoning: string;
    method: string;
    path: string;
    body: any;
    result: ApiCallResult;
    funnelRating?: FunnelRating;
  }> = [];

  // Exploration loop
  let consecutiveFailures = 0;
  const MAX_CONSECUTIVE_FAILURES = 5;

  for (let i = 0; i < actions; i++) {
    console.log(`[explorer]   Run ${runIndex + 1}, Action ${i + 1}/${actions}`);

    // Build user message with previous result context
    let userMsg: string;
    if (i === 0) {
      userMsg = "You are now logged in. Begin exploring the API. What would you like to do first?";
    } else {
      const prev = actionLog[actionLog.length - 1];
      const bodyPreview = JSON.stringify(prev.result.body)?.slice(0, 500);
      userMsg = `Previous action result:
- Status: ${prev.result.status}
- Duration: ${prev.result.durationMs}ms
- Response: ${bodyPreview}${prev.result.error ? `\n- Error: ${prev.result.error}` : ""}

What would you like to do next?`;
    }

    messages.push({ role: "user", content: userMsg });

    // Ask Claude what to do
    let assistantText: string;
    try {
      assistantText = await callClaude(apiKey, systemPrompt, messages, 1024, temperature);
    } catch (err) {
      console.error(`[explorer]   LLM call failed at action ${i + 1}:`, err);
      consecutiveFailures++;
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        console.error("[explorer]   Too many consecutive LLM failures, stopping.");
        break;
      }
      // Pop the user message and retry next iteration
      messages.pop();
      continue;
    }

    messages.push({ role: "assistant", content: assistantText });

    // Parse the action
    const action = parseAction(assistantText);
    if (!action) {
      console.warn(`[explorer]   Could not parse action from LLM response at iteration ${i + 1}`);
      consecutiveFailures++;
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        console.error("[explorer]   Too many consecutive parse failures, stopping.");
        break;
      }
      continue;
    }

    consecutiveFailures = 0;
    console.log(`[explorer]     ${action.method} ${action.path} — ${action.reasoning.slice(0, 80)}`);

    // Execute the action
    const result = await apiCall(
      action.method,
      action.path,
      action.body,
      session,
    );

    console.log(`[explorer]     → ${result.status} (${result.durationMs}ms)`);

    // Get conversion funnel rating
    let funnelRating: FunnelRating | undefined;
    try {
      const ratingPrompt = buildFunnelRatingPrompt(action, result, i + 1, actions);
      messages.push({ role: "user", content: ratingPrompt });
      const ratingText = await callClaude(apiKey, systemPrompt, messages, 256, temperature);
      messages.push({ role: "assistant", content: ratingText });
      funnelRating = parseFunnelRating(ratingText) ?? undefined;
    } catch {
      // Non-critical — continue without rating
    }

    actionLog.push({
      iteration: i + 1,
      reasoning: action.reasoning,
      method: action.method,
      path: action.path,
      body: action.body,
      result,
      funnelRating,
    });
  }

  // Ask for friction report
  console.log(`[explorer]   Run ${runIndex + 1}: Requesting friction report...`);

  messages.push({ role: "user", content: FRICTION_REPORT_PROMPT });

  let reportText: string;
  try {
    reportText = await callClaude(apiKey, systemPrompt, messages, 4096, temperature);
  } catch (err) {
    console.error("[explorer]   Failed to generate friction report:", err);
    reportText = JSON.stringify({ error: "Failed to generate report" });
  }

  const frictionReport = parseFrictionReport(reportText);

  return {
    actionLog: actionLog.map((a) => ({
      iteration: a.iteration,
      reasoning: a.reasoning,
      method: a.method,
      path: a.path,
      status: a.result.status,
      durationMs: a.result.durationMs,
      error: a.result.error,
      funnelRating: a.funnelRating,
    })),
    frictionReport,
  };
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Check for API key
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.log("[explorer] ANTHROPIC_API_KEY not set — skipping LLM exploratory testing.");
    console.log("[explorer] Set ANTHROPIC_API_KEY to enable Layer 3 exploration.");
    process.exit(0);
  }

  const { persona, actions, runs } = parseArgs();
  const personaDef = PERSONAS[persona];

  console.log(`[explorer] Starting LLM exploration as ${personaDef.name} (${persona})`);
  console.log(`[explorer] Planned actions: ${actions}, Runs: ${runs}`);

  const allRuns: Array<{
    runIndex: number;
    temperature: number;
    actionLog: ActionLogEntryWithFunnel[];
    frictionReport: any;
  }> = [];

  for (let r = 0; r < runs; r++) {
    // Vary temperature between 0.7 and 1.0 across runs
    const temperature = runs === 1 ? 1.0 : 0.7 + (r / (runs - 1)) * 0.3;

    const result = await runExploration(apiKey, persona, actions, r, temperature);
    allRuns.push({
      runIndex: r,
      temperature,
      ...result,
    });
  }

  // Build combined report
  const allActionLogs = allRuns.flatMap((r) => r.actionLog);

  // Merge friction reports: use first valid one as base, aggregate friction points
  const baseFrictionReport = allRuns.find((r) => !r.frictionReport.error)?.frictionReport ?? {};
  const allFrictionPoints = allRuns.flatMap(
    (r) => r.frictionReport?.frictionPoints ?? [],
  );
  const allPerformanceIssues = allRuns.flatMap(
    (r) => r.frictionReport?.performanceIssues ?? [],
  );
  const allMissingFeatures = allRuns.flatMap(
    (r) => r.frictionReport?.missingFeatures ?? [],
  );

  const fullReport = {
    ...baseFrictionReport,
    frictionPoints: allFrictionPoints,
    performanceIssues: allPerformanceIssues,
    missingFeatures: allMissingFeatures,
    meta: {
      persona,
      personaName: personaDef.name,
      tier: personaDef.tier,
      totalActionsPlanned: actions,
      totalActionsExecuted: allActionLogs.length,
      totalRuns: runs,
      timestamp: new Date().toISOString(),
    },
    actionLog: allActionLogs,
    runs: allRuns.map((r) => ({
      runIndex: r.runIndex,
      temperature: r.temperature,
      actionsExecuted: r.actionLog.length,
      errors: r.actionLog.filter((a) => a.status >= 400).length,
      summary: r.frictionReport?.summary,
    })),
  };

  // Write report
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const reportsDir = path.join(import.meta.dirname ?? __dirname, "reports");
  fs.mkdirSync(reportsDir, { recursive: true });

  const reportPath = path.join(reportsDir, `explorer-${persona}-${timestamp}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(fullReport, null, 2));

  console.log(`[explorer] Report written to ${reportPath}`);
  console.log(`[explorer] Total runs: ${runs}, Total actions executed: ${allActionLogs.length}`);
  console.log(
    `[explorer] Errors: ${allActionLogs.filter((a) => a.status >= 400).length}`,
  );
}

// ── Data State Gathering ─────────────────────────────────────────────────

async function gatherDataState(session: AuthSession): Promise<string> {
  const sections: string[] = [];

  const endpoints = [
    { label: "Leads", path: "/api/leads?limit=5" },
    { label: "Deals", path: "/api/deals?limit=5" },
    { label: "Properties", path: "/api/properties?limit=5" },
    { label: "Notes", path: "/api/notes?limit=5" },
    { label: "Campaigns", path: "/api/campaigns?limit=5" },
    { label: "Onboarding", path: "/api/onboarding/status" },
  ];

  for (const ep of endpoints) {
    try {
      const res = await apiCall("GET", ep.path, undefined, session);
      if (res.status === 200) {
        const preview = JSON.stringify(res.body)?.slice(0, 300);
        sections.push(`### ${ep.label}\n${preview}`);
      } else {
        sections.push(`### ${ep.label}\nStatus ${res.status}: ${res.error ?? "unavailable"}`);
      }
    } catch {
      sections.push(`### ${ep.label}\nFailed to fetch`);
    }
  }

  return sections.join("\n\n") || "No data loaded yet.";
}

main().catch((err) => {
  console.error("[explorer] Fatal error:", err);
  process.exit(1);
});
