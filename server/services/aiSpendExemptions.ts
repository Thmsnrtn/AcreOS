/**
 * aiSpendExemptions — the NAMED, DELIBERATE exemptions from AI spend
 * metering (P1-5 / I-5 R2, decided 2026-11-12).
 *
 * Every other production AI spend path goes through the metered gateway
 * (routeAITask / aiSpendGuard) and lands in ai_telemetry_events, where
 * the cost ceilings can see it. The two capabilities below do NOT, and
 * that is a decision recorded here — not silence, not an oversight:
 *
 *   - Their pricing does not fit the token table. Whisper bills per
 *     audio MINUTE and DALL·E per IMAGE; aiCostRates prices per token.
 *     Forcing either through a token rate would fabricate a number that
 *     looks measured and is not — worse than an honest exemption.
 *   - Their per-call cost is bounded by shape, not by a loop budget:
 *     one transcription per uploaded/recorded audio file (length-capped
 *     by the upload limits), one image per spec in a founder-run batch.
 *
 * The exemption is for METERING only. These paths still spend real
 * platform money and are still bounded operationally (upload caps,
 * founder-only surfaces). Revisit trigger, per entry: when
 * recordExternalAiSpend supports duration-/unit-based pricing, meter
 * the path and delete its entry here in the same commit.
 * tests/unit/aiSpendExemptions.test.ts pins this registry to the actual
 * call sites, so an entry cannot outlive its site (or a site its entry).
 */

export interface AiSpendExemption {
  /** Stable key other code/tests reference. */
  key: string;
  /** Production call sites (repo-relative) this exemption covers. */
  sites: readonly string[];
  /** Why this path is exempt — the decision, in one paragraph. */
  reason: string;
  /** What has to become true for the exemption to be revisited. */
  revisitWhen: string;
}

export const AI_SPEND_EXEMPTIONS: readonly AiSpendExemption[] = [
  {
    key: "whisper_transcription",
    sites: [
      "server/services/voiceCallAI.ts",
      "server/routes-ai.ts",
      "server/routes-field-scout.ts",
    ],
    reason:
      "Whisper transcription bills per audio minute, which the per-token aiCostRates table cannot price honestly. " +
      "OpenRouter does not proxy the audio transcriptions endpoint, so these calls go to OpenAI direct and cannot ride the chat gateway. " +
      "Per-call cost is bounded by the audio length (upload-capped); the exposure shape is a looped upload endpoint, watched via the provider invoice and the daily cost guard's provider rollup once duration metering exists.",
    revisitWhen:
      "recordExternalAiSpend accepts a duration-based (per-minute) cost, or OpenAI transcription responses are recorded with their duration at every site.",
  },
  {
    key: "dalle_image_generation",
    sites: ["server/services/adCreativeService.ts"],
    reason:
      "DALL·E image generation bills per image, not per token, and runs only in founder-triggered ad-creative batches — one image per spec in IMAGE_SPECS, so a run's cost is bounded by the spec count. " +
      "It is founder-side marketing spend, never customer-triggered, and never inside an automated loop.",
    revisitWhen:
      "recordExternalAiSpend accepts a per-unit (per-image) cost, or ad-creative generation becomes automated/recurring instead of founder-triggered.",
  },
];

/** The marker every exempt call site carries in a comment, pinned by test. */
export const AI_SPEND_EXEMPTION_MARKER = "AI_SPEND_EXEMPTION";
