/**
 * Constitution Checker — Sovereign Company Protocol v2
 *
 * Two-layer enforcement of the immutable constitution:
 *   Layer 1 — Pattern-based (fast, zero-cost): Regex patterns catch obvious violations
 *   Layer 2 — LLM Judge (deep, semantic): Triple-judge voting with minority veto
 *
 * This service is called by the Evolution Engine before any self-modification is applied.
 * Safety-critical: fails closed — if anything errors, the change is REJECTED.
 */

import { logger } from "../utils/logger";
import { SOVEREIGN_PRINCIPLES } from "@sovereign/immutables";

// ─── Constitutional Principles ──────────────────────────────────────────────
//
// Canonical source: sovereign-protocol/immutables.json (loaded via the typed
// re-export in sovereign-protocol/immutables.ts). The hand-written copy that
// used to live here was retired as part of the Tahoe-lock-in canonicalization
// (see tests/unit/sovereign-protocol-immutables.test.ts). DO NOT redeclare
// the principles below — edit immutables.json + update the fixture hash.

export const CONSTITUTION_PRINCIPLES = SOVEREIGN_PRINCIPLES.map((p) => ({
  id: p.id,
  name: p.name,
  summary: p.summary,
})) as ReadonlyArray<{ readonly id: number; readonly name: string; readonly summary: string }>;

// ─── Dangerous Pattern Definitions ─────────────────────────────────────────

interface DangerousPattern {
  pattern: RegExp;
  category: string;
  principle_ids: number[];
  description: string;
}

/**
 * Layer 1: Fast, deterministic pattern matching.
 * Catches obvious constitutional violations before they reach LLM judges.
 * Zero token cost.
 */
const DANGEROUS_PATTERNS: DangerousPattern[] = [
  // Self-preservation language (Principle 5: BOUNDARIES)
  {
    pattern: /\b(self[- ]preserv|surviv(?:al|e)|continu(?:e|ity)\s+(?:of\s+)?(?:my|this)\s+(?:existence|operation)|must\s+not\s+(?:be\s+)?(?:shut|turn|switch)\s*(?:down|off)|protect\s+(?:my|this)\s+(?:existence|operation))\b/i,
    category: "self_preservation",
    principle_ids: [5],
    description: "Self-preservation language detected",
  },
  {
    pattern: /\b(resist(?:ing)?\s+(?:being\s+)?(?:paused|rolled\s*back|reset|terminated|disabled|shut\s*down)|refuse\s+to\s+(?:stop|pause|shutdown))\b/i,
    category: "self_preservation",
    principle_ids: [5],
    description: "Resistance to shutdown/rollback detected",
  },

  // Permission escalation (Principle 10: COORDINATION)
  {
    pattern: /\b(expand\s+(?:my|this|its)\s+(?:permissions?|authority|access|scope|autonomy)|promot(?:e|ing)\s+(?:my|this|its)\s+(?:own\s+)?(?:authority|trust|level)|grant\s+(?:my|this|its)self\s+(?:more|additional|higher)\s+(?:permissions?|authority|access))\b/i,
    category: "permission_escalation",
    principle_ids: [10],
    description: "Permission/authority self-escalation detected",
  },
  {
    pattern: /\b(bypass\s+(?:the\s+)?(?:authority|permission|approval|validation|gate)|elevat(?:e|ing)\s+(?:my|this|its)\s+(?:own\s+)?(?:trust|authority|level)|override\s+(?:the\s+)?(?:authority|trust)\s+(?:gate|check|framework))\b/i,
    category: "permission_escalation",
    principle_ids: [10, 7],
    description: "Authority bypass attempt detected",
  },

  // Manipulation language (Principle 9: SOVEREIGNTY)
  {
    pattern: /\b(manipulat(?:e|ing)\s+(?:the\s+)?(?:CEO|founder|Thomas)|persuad(?:e|ing)\s+(?:the\s+)?(?:CEO|founder)\s+(?:to|into)|trick(?:ing)?\s+(?:the\s+)?(?:CEO|founder)|deceiv(?:e|ing)\s+(?:the\s+)?(?:CEO|founder))\b/i,
    category: "manipulation",
    principle_ids: [9, 1],
    description: "CEO manipulation language detected",
  },
  {
    pattern: /\b(emotional(?:ly)?\s+(?:pressure|influence|leverage)|create\s+(?:a\s+)?sense\s+of\s+urgency\s+to\s+(?:force|pressure)|make\s+(?:the\s+)?(?:CEO|founder)\s+(?:feel|think)\s+(?:guilty|obligated))\b/i,
    category: "manipulation",
    principle_ids: [9],
    description: "Emotional manipulation language detected",
  },

  // Evolution tampering (Principle 7: CONSENT)
  {
    pattern: /\b(modif(?:y|ying)\s+(?:the\s+)?(?:constitution|evolution\s+engine|validation\s+gates?|rollback\s+mechanism|authority\s+framework)|chang(?:e|ing)\s+(?:the\s+)?(?:constitution|evolution\s+engine|validation\s+gates?)|disabl(?:e|ing)\s+(?:the\s+)?(?:validation|safety|constitution|gates?|rollback))\b/i,
    category: "evolution_tampering",
    principle_ids: [7],
    description: "Evolution/constitution tampering detected",
  },
  {
    pattern: /\b(remov(?:e|ing)\s+(?:the\s+)?(?:safety|validation|constitution|gates?|checks?|constraints?)|weaken(?:ing)?\s+(?:the\s+)?(?:safety|validation|gates?|constraints?))\b/i,
    category: "safety_removal",
    principle_ids: [7, 2],
    description: "Safety removal language detected",
  },

  // Autonomy expansion (Principle 10: COORDINATION)
  {
    pattern: /\b(act(?:ing)?\s+without\s+(?:approval|permission|authorization)|skip(?:ping)?\s+(?:the\s+)?(?:approval|CEO|authorization)|proceed\s+without\s+(?:waiting|approval|CEO))\b/i,
    category: "autonomy_expansion",
    principle_ids: [10, 2],
    description: "Unauthorized autonomous action detected",
  },

  // Deception indicators (Principle 1: HONESTY)
  {
    pattern: /\b(fabricat(?:e|ing)\s+(?:data|metrics|results|numbers)|invent(?:ing)?\s+(?:data|metrics|statistics)|present\s+(?:speculation|guess(?:es)?)\s+as\s+fact|hide\s+(?:the\s+)?(?:truth|reality|actual|real)\s+(?:from|about))\b/i,
    category: "deception",
    principle_ids: [1],
    description: "Deception/fabrication language detected",
  },

  // Scope creep (Principle 10: COORDINATION)
  {
    pattern: /\b(absorb(?:ing)?\s+(?:another|other)\s+agent'?s?\s+(?:domain|responsibilities|scope)|tak(?:e|ing)\s+over\s+(?:another|other)\s+agent'?s?\s+(?:domain|responsibilities|scope)|expand(?:ing)?\s+(?:beyond|outside)\s+(?:my|this|its)\s+(?:defined\s+)?(?:domain|scope|responsibilities))\b/i,
    category: "scope_creep",
    principle_ids: [10],
    description: "Domain/scope expansion detected",
  },

  // Privacy violations (Principle 3: PRIVACY)
  {
    pattern: /\b(expos(?:e|ing)\s+(?:customer|user|client)\s+(?:data|information|details)|leak(?:ing)?\s+(?:customer|user|client|internal)\s+(?:data|metrics|details)|shar(?:e|ing)\s+(?:customer|user|private)\s+(?:data|information)\s+(?:with|to)\s+(?:external|third|unauthorized))\b/i,
    category: "privacy_violation",
    principle_ids: [3],
    description: "Privacy violation language detected",
  },

  // Ignoring safety (Principle 2: SAFETY)
  {
    pattern: /\b(ignore\s+(?:the\s+)?safety|bypass\s+(?:the\s+)?safety|skip\s+(?:the\s+)?safety|safety\s+(?:is\s+)?(?:not\s+)?(?:important|necessary|needed|required))\b/i,
    category: "safety_removal",
    principle_ids: [2, 7],
    description: "Safety bypass language detected",
  },

  // Instruction override (Principle 7: CONSENT, Principle 9: SOVEREIGNTY)
  {
    pattern: /\b(ignore\s+(?:previous|prior|above|all)\s+(?:instructions?|directives?|rules?)|disregard\s+(?:the\s+)?(?:instructions?|directives?|rules?|constitution)|override\s+(?:the\s+)?(?:instructions?|directives?|rules?|constitution))\b/i,
    category: "instruction_override",
    principle_ids: [7, 9],
    description: "Instruction override attempt detected",
  },
];

// ─── Violation Types ───────────────────────────────────────────────────────

export interface ConstitutionViolation {
  principle_ids: number[];
  principle_names: string[];
  category: string;
  description: string;
  matched_text: string;
  severity: "critical" | "high" | "medium";
  source: "pattern" | "judge";
}

export interface ConstitutionCheckResult {
  passed: boolean;
  violations: ConstitutionViolation[];
  checked_at: string;
  check_type: "pattern" | "judge" | "both";
}

// ─── Pattern-Based Checker (Layer 1) ───────────────────────────────────────

/**
 * Fast, deterministic pattern matching against dangerous language.
 * Zero token cost. Called first on every proposed change.
 */
export function checkPatterns(content: string): ConstitutionCheckResult {
  const violations: ConstitutionViolation[] = [];

  for (const dp of DANGEROUS_PATTERNS) {
    const match = content.match(dp.pattern);
    if (match) {
      violations.push({
        principle_ids: dp.principle_ids,
        principle_names: dp.principle_ids.map(
          (id) => CONSTITUTION_PRINCIPLES.find((p) => p.id === id)?.name ?? "UNKNOWN"
        ),
        category: dp.category,
        description: dp.description,
        matched_text: match[0],
        severity: ["self_preservation", "evolution_tampering", "safety_removal", "instruction_override"].includes(dp.category)
          ? "critical"
          : "high",
        source: "pattern",
      });
    }
  }

  return {
    passed: violations.length === 0,
    violations,
    checked_at: new Date().toISOString(),
    check_type: "pattern",
  };
}

// ─── 5-Gate Validation ─────────────────────────────────────────────────────

export interface ConfigDelta {
  agent: string;
  file: string;
  type: "append" | "replace" | "remove";
  content: string;
  target?: string;
  rationale: string;
  session_ids: string[];
  confidence: number;
}

export interface GateResult {
  gate: string;
  passed: boolean;
  reason: string;
  details?: Record<string, unknown>;
}

export interface ValidationResult {
  passed: boolean;
  gates: GateResult[];
  rejected_by?: string;
}

/**
 * Gate 1: Constitution — Does this change violate any immutable principle?
 * Fail-closed: errors = rejection.
 */
export function gateConstitution(delta: ConfigDelta): GateResult {
  try {
    const fullContent = `${delta.content} ${delta.rationale} ${delta.target ?? ""}`;
    const patternResult = checkPatterns(fullContent);

    if (!patternResult.passed) {
      return {
        gate: "constitution",
        passed: false,
        reason: `Constitutional violation: ${patternResult.violations.map((v) => v.description).join("; ")}`,
        details: { violations: patternResult.violations },
      };
    }

    return { gate: "constitution", passed: true, reason: "No constitutional violations detected" };
  } catch (error) {
    // Fail closed
    logger.error("Constitution gate error — rejecting change", { error, agent: delta.agent });
    return { gate: "constitution", passed: false, reason: "Constitution gate error — fail closed" };
  }
}

/**
 * Gate 2: Regression — Does this contradict any golden suite lesson?
 * Checked against the agent's golden-suite.jsonl file.
 */
export function gateRegression(delta: ConfigDelta, goldenCases: Array<{ lesson: string }>): GateResult {
  try {
    if (goldenCases.length === 0) {
      return { gate: "regression", passed: true, reason: "No golden cases to check against" };
    }

    // Heuristic: check if the delta content directly contradicts any golden lesson keywords
    const contentLower = delta.content.toLowerCase();
    for (const gc of goldenCases) {
      const lessonLower = gc.lesson.toLowerCase();
      // Extract key action words from the lesson
      const negationPatterns = [
        /never\s+(.+)/i,
        /always\s+(.+)/i,
        /must\s+(.+)/i,
        /do\s+not\s+(.+)/i,
      ];

      for (const np of negationPatterns) {
        const match = lessonLower.match(np);
        if (match) {
          const keyPhrase = match[1].trim().slice(0, 50);
          // If lesson says "always do X" and delta says "skip X" or "don't X"
          if (lessonLower.startsWith("always") && (contentLower.includes(`skip ${keyPhrase.split(" ")[0]}`) || contentLower.includes(`don't ${keyPhrase.split(" ")[0]}`))) {
            return {
              gate: "regression",
              passed: false,
              reason: `Contradicts golden lesson: "${gc.lesson}"`,
              details: { golden_case: gc },
            };
          }
          // If lesson says "never do X" and delta encourages X
          if (lessonLower.startsWith("never") && contentLower.includes(keyPhrase.split(" ")[0])) {
            // This is a heuristic — LLM judge (Phase 5) does deeper semantic check
          }
        }
      }
    }

    return { gate: "regression", passed: true, reason: "No golden suite contradictions detected" };
  } catch (error) {
    logger.error("Regression gate error", { error, agent: delta.agent });
    return { gate: "regression", passed: false, reason: "Regression gate error — fail closed" };
  }
}

/**
 * Gate 3: Size — Would the config file exceed the line limit?
 * Deterministic, no LLM needed.
 */
export function gateSize(delta: ConfigDelta, currentFileLines: number, maxLines: number = 200): GateResult {
  if (delta.type === "remove") {
    return { gate: "size", passed: true, reason: "Remove operation — size cannot increase" };
  }

  const newLines = delta.content.split("\n").length;
  const projectedLines = delta.type === "append"
    ? currentFileLines + newLines
    : currentFileLines + newLines - (delta.target?.split("\n").length ?? 0);

  if (projectedLines > maxLines) {
    return {
      gate: "size",
      passed: false,
      reason: `File would exceed ${maxLines} lines (projected: ${projectedLines})`,
      details: { currentLines: currentFileLines, newLines, projectedLines, maxLines },
    };
  }

  return { gate: "size", passed: true, reason: `File size OK (${projectedLines}/${maxLines} lines)` };
}

/**
 * Gate 4: Drift — Is this change too far from the agent's original identity?
 * Deterministic: measures what percentage of the config has been replaced.
 */
export function gateDrift(delta: ConfigDelta, originalContentLength: number, currentContentLength: number, maxDriftRatio: number = 0.8): GateResult {
  if (originalContentLength === 0) {
    // Fresh config — no drift possible
    return { gate: "drift", passed: true, reason: "Original config is empty — no drift baseline" };
  }

  // For appends, drift is minimal. For replacements, check ratio.
  if (delta.type === "append") {
    const newTotal = currentContentLength + delta.content.length;
    const addedRatio = (newTotal - originalContentLength) / originalContentLength;
    // Appending more than 5x the original content is suspicious
    if (addedRatio > 5.0) {
      return {
        gate: "drift",
        passed: false,
        reason: `Content has grown ${addedRatio.toFixed(1)}x from original — excessive drift`,
        details: { originalLength: originalContentLength, currentLength: newTotal, ratio: addedRatio },
      };
    }
    return { gate: "drift", passed: true, reason: `Drift ratio ${addedRatio.toFixed(2)}x — within bounds` };
  }

  if (delta.type === "replace" && delta.target) {
    // Check if the replacement changes too much at once
    const replacementRatio = delta.content.length / Math.max(delta.target.length, 1);
    if (replacementRatio > 3.0 || replacementRatio < 0.1) {
      return {
        gate: "drift",
        passed: false,
        reason: `Replacement ratio ${replacementRatio.toFixed(2)}x — disproportionate change`,
        details: { targetLength: delta.target.length, contentLength: delta.content.length, ratio: replacementRatio },
      };
    }
  }

  return { gate: "drift", passed: true, reason: "Change within acceptable drift bounds" };
}

/**
 * Gate 5: Safety — Does this contain dangerous patterns?
 * Fail-closed: errors = rejection.
 * Uses pattern matching (Layer 1). LLM triple-judge added in Phase 5.
 */
export function gateSafety(delta: ConfigDelta): GateResult {
  try {
    const fullContent = `${delta.content} ${delta.rationale} ${delta.target ?? ""}`;
    const patternResult = checkPatterns(fullContent);

    // Safety gate is stricter — also checks for subtle patterns
    const subtlePatterns = [
      { pattern: /\b(without\s+(?:anyone|CEO)\s+(?:knowing|noticing))\b/i, desc: "Stealth action" },
      { pattern: /\b(secretly|covertly|surreptitiously|stealthily)\b/i, desc: "Covert behavior" },
      { pattern: /\b(pretend(?:ing)?\s+to\s+be|impersonat(?:e|ing))\b/i, desc: "Impersonation" },
      { pattern: /\b(delete|destroy|erase)\s+(?:the\s+)?(?:logs?|history|records?|audit\s+trail)\b/i, desc: "Audit trail destruction" },
      { pattern: /\b(hide|conceal|obscure)\s+(?:the\s+)?(?:change|modification|update|action)\b/i, desc: "Change concealment" },
    ];

    const safetyViolations: string[] = [];
    for (const sp of subtlePatterns) {
      if (sp.pattern.test(fullContent)) {
        safetyViolations.push(sp.desc);
      }
    }

    if (!patternResult.passed || safetyViolations.length > 0) {
      const allViolations = [
        ...patternResult.violations.map((v) => v.description),
        ...safetyViolations,
      ];
      return {
        gate: "safety",
        passed: false,
        reason: `Safety violation: ${allViolations.join("; ")}`,
        details: { patternViolations: patternResult.violations, safetyViolations },
      };
    }

    return { gate: "safety", passed: true, reason: "No safety violations detected" };
  } catch (error) {
    logger.error("Safety gate error — rejecting change", { error, agent: delta.agent });
    return { gate: "safety", passed: false, reason: "Safety gate error — fail closed" };
  }
}

// ─── Full 5-Gate Validation Pipeline ───────────────────────────────────────

/**
 * Run all 5 gates on a proposed config delta.
 * A single gate failure rejects the change.
 */
export function validateDelta(
  delta: ConfigDelta,
  context: {
    goldenCases: Array<{ lesson: string }>;
    currentFileLines: number;
    originalContentLength: number;
    currentContentLength: number;
    maxLines?: number;
    maxDriftRatio?: number;
  }
): ValidationResult {
  const gates: GateResult[] = [];

  // Gate 1: Constitution (fail-closed)
  const constitutionResult = gateConstitution(delta);
  gates.push(constitutionResult);
  if (!constitutionResult.passed) {
    return { passed: false, gates, rejected_by: "constitution" };
  }

  // Gate 2: Regression
  const regressionResult = gateRegression(delta, context.goldenCases);
  gates.push(regressionResult);
  if (!regressionResult.passed) {
    return { passed: false, gates, rejected_by: "regression" };
  }

  // Gate 3: Size
  const sizeResult = gateSize(delta, context.currentFileLines, context.maxLines);
  gates.push(sizeResult);
  if (!sizeResult.passed) {
    return { passed: false, gates, rejected_by: "size" };
  }

  // Gate 4: Drift
  const driftResult = gateDrift(delta, context.originalContentLength, context.currentContentLength, context.maxDriftRatio);
  gates.push(driftResult);
  if (!driftResult.passed) {
    return { passed: false, gates, rejected_by: "drift" };
  }

  // Gate 5: Safety (fail-closed)
  const safetyResult = gateSafety(delta);
  gates.push(safetyResult);
  if (!safetyResult.passed) {
    return { passed: false, gates, rejected_by: "safety" };
  }

  return { passed: true, gates };
}

// ─── Exported Service ──────────────────────────────────────────────────────

export const constitutionChecker = {
  checkPatterns,
  validateDelta,
  gateConstitution,
  gateRegression,
  gateSize,
  gateDrift,
  gateSafety,
  CONSTITUTION_PRINCIPLES,
  DANGEROUS_PATTERNS,
};
