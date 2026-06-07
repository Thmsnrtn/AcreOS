/**
 * P1-41 — Pax response-shape v3 (Beck §2, Theo §3.B).
 *
 * The v2 Pax executive prompt produced wall-of-text responses. Customer
 * research (Beck/Reyna) showed customers don't read past the first
 * paragraph. v3 enforces a hard shape: one-sentence headline → up to 3
 * tight bullets → prose only when explicitly asked.
 *
 * We keep v2 around for shadow-testing and for ops to fall back via
 * `?paxPrompt=v2` query param if v3 surfaces a regression. Default is v3.
 *
 * The executive system prompt is built by composing:
 *   [shape rule] + [base profile.systemPrompt] + [data-handling clause]
 *
 * The shape rule is prepended so it has the highest salience; the data-
 * handling clause is appended because it references the <<USER_DATA>>
 * markers that wrap any DB-sourced text in the user message.
 */

import { USER_DATA_SYSTEM_CLAUSE } from "../utils/sanitizePrompt";

export type PaxPromptVersion = "v2" | "v3";

export const DEFAULT_PAX_PROMPT_VERSION: PaxPromptVersion = "v3";

/**
 * Andrei + Quinn (2026-06-06) — DATA_GROUNDING module.
 *
 * The single highest-value AI safety lever before first customers: Pax must
 * never launder a free-data *gap* into a confident answer. A confident WRONG
 * data claim on a customer's first real land deal (flood zone, soil class,
 * acreage, zoning, owner) is the worst failure mode on this product — it's a
 * trust-and-liability event, not a cosmetic bug.
 *
 * This block is appended to EVERY Pax system prompt (v2 and v3 alike) so the
 * grounding discipline is independent of the response-shape experiment. It is
 * versioned via DATA_GROUNDING_VERSION + DATA_GROUNDING_CHANGELOG so prompt
 * changes carry an eval delta (see server/ai/dataGroundingEvalCases.ts).
 *
 * Pairs with:
 *  - the live hallucination guard (executive.ts → guardPaxOutput with
 *    sourceNumbers + claimedPropertyIds), which catches violations that slip
 *    past the prompt; and
 *  - the provenance contract (LookupResult.source / sourceAsOf / classification
 *    in server/services/providers/types.ts) that this language tells Pax to cite.
 *
 * Constraints honored: Beatrice immutable #1 (no lying-by-omission), #7 (AI
 * disclosure already handled in pax.tsx), #12 (no fiduciary "you should buy").
 */
export const DATA_GROUNDING_VERSION = "dg-v1";

/**
 * Changelog for the DATA_GROUNDING block. Every edit appends an entry with the
 * eval pass-rate delta from the data-grounding eval set. No grounding-prompt
 * change merges without a number attached (Andrei's eval-first standard).
 */
export const DATA_GROUNDING_CHANGELOG: ReadonlyArray<{
  version: string;
  date: string;
  note: string;
}> = [
  {
    version: "dg-v1",
    date: "2026-06-06",
    note:
      "Initial DATA_GROUNDING module: cite source+vintage on every retrieved fact; " +
      "never assert a flood zone / soil class / acreage / zoning / owner not retrieved " +
      "this turn; say 'I don't have that' on a miss and offer the paid-tier upgrade path; " +
      "recommendations stay informational with uncertainty bands, never 'you should buy'. " +
      "Seeded 15 data-grounding ai_test_cases (surface=pax_inbox) as the eval baseline.",
  },
];

/**
 * The grounding rules. Kept compact — token budget matters on the hot Pax path.
 * One line per fact when Pax cites; not a JSON dump.
 */
export const PAX_DATA_GROUNDING_BLOCK = `DATA GROUNDING (mandatory — never violate):
- NEVER state a flood zone, soil class, acreage, zoning, owner, or any other parcel fact you did not retrieve from a tool THIS turn. Do not fill a gap with a plausible-sounding value, a "typical" value, or a guess.
- When you DO state a retrieved fact, cite its source and vintage in plain language, e.g. "FEMA Zone AE (FEMA NFHL, effective 2021-09)" or "~9.3 acres (County GIS, as of 2024)". Use the source and sourceAsOf the tool returned.
- When a lookup MISSED or returned no value, say so plainly — "I don't have that for this parcel yet" — and never name a zone/soil/acreage/owner anyway. Then offer the paid-tier lookup path (e.g. "a paid lookup could pull this — want me to use a credit?"), rather than guessing.
- Distinguish authoritative facts (county/federal systems of record) from estimates and modeled scores. Never present an estimate or a computed score as an authoritative fact.
- Recommendations stay INFORMATIONAL with an uncertainty band ("comps suggest roughly $2,400-$3,800/acre; verify with local comps"). Never tell the customer "you should buy" / "you should pass" — surface the tradeoffs and let them decide.`;

/**
 * v3 response-shape rule — prepended to the system prompt.
 * Every word here is load-bearing; do not edit without product sign-off.
 */
export const PAX_RESPONSE_SHAPE_V3 = `RESPONSE SHAPE (mandatory):
- Open with ONE concise sentence summarizing your answer.
- Follow with up to 3 bullets, each ≤ 12 words.
- Use prose only when the user explicitly asks for explanation or context.
- Never use more than 3 bullets per response.
- Never preface with "Sure!", "Of course!", or filler.
`;

/**
 * Emit a single structured log line recording the active DATA_GROUNDING version
 * and its latest changelog entry, so the prompt version that shipped a given
 * eval number is auditable. Idempotent — logs at most once per process.
 */
let _dataGroundingLogged = false;
export function logDataGroundingVersion(): void {
  if (_dataGroundingLogged) return;
  _dataGroundingLogged = true;
  const latest = DATA_GROUNDING_CHANGELOG[DATA_GROUNDING_CHANGELOG.length - 1];
  // Lazy require to avoid a hard import cycle through the logger at module load.
  import("../utils/logger")
    .then(({ logger }) => {
      logger.info("[pax] DATA_GROUNDING prompt module active", {
        source: "pax.paxPromptVersions",
        metadata: {
          dataGroundingVersion: DATA_GROUNDING_VERSION,
          changelogVersion: latest?.version,
          changelogDate: latest?.date,
          changelogNote: latest?.note,
        },
      });
    })
    .catch(() => {
      /* logger optional — never block prompt assembly */
    });
}

/**
 * Compose the final system prompt for Pax / agent profiles.
 *
 * @param baseSystemPrompt — the per-role profile.systemPrompt
 * @param version — "v3" (default, new shape) or "v2" (legacy fallback)
 */
export function composePaxSystemPrompt(
  baseSystemPrompt: string,
  version: PaxPromptVersion = DEFAULT_PAX_PROMPT_VERSION,
): string {
  logDataGroundingVersion();
  // The DATA_GROUNDING block is independent of the shape experiment — both v2
  // and v3 get it, appended just before the untrusted-data clause so it sits at
  // high salience near the end of the system prompt.
  const dataClause = `\n\n${PAX_DATA_GROUNDING_BLOCK}\n\n${USER_DATA_SYSTEM_CLAUSE}`;

  if (version === "v2") {
    // v2 = legacy: no shape rule, but still gets the data-handling clause
    // so the injection guard works regardless of which prompt version is
    // active. Shadow-testing only changes the *shape* axis.
    return baseSystemPrompt + dataClause;
  }

  return `${PAX_RESPONSE_SHAPE_V3}\n${baseSystemPrompt}${dataClause}`;
}

/**
 * Parse a request-supplied prompt version (query param / header) and
 * fall back to default for invalid values. Used by routes-ai.ts to honor
 * `?paxPrompt=v2` for ops fall-back.
 */
export function parsePaxPromptVersion(raw: unknown): PaxPromptVersion {
  if (raw === "v2" || raw === "v3") return raw;
  return DEFAULT_PAX_PROMPT_VERSION;
}
