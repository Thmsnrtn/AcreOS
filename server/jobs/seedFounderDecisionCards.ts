/**
 * Boot-time founder decision-card seeding, lifted out of runScheduledJobs.ts
 * (S3 decomposition + rail-sunset, 2026-07-16).
 *
 * Each seeder is one-shot and marker-guarded, and NOTHING it seeds
 * auto-executes — a card records a founder ruling for a human-reviewed change.
 * All are fire-and-forget and fail-open: a seed failure logs and retries next
 * boot; boot is never blocked or failed by a seed error.
 *
 * The trust-graduation re-collar below rides the same boot hook. It is not a
 * card seed but a one-shot TIGHTEN-ONLY reconcile (it only ever reduces
 * autonomy, never widens it), so it shares this file's marker-guarded,
 * fail-open, boot-time contract.
 */

import { logger } from "../utils/logger";

export function seedFounderDecisionCardsOnStartup(): void {
  // 2026-07 cost audit — Scale default model; DeepSeek data-governance.
  void import("../services/costDecisionCards")
    .then(({ seedCostDecisionCards }) => seedCostDecisionCards())
    .catch((err) =>
      logger.warn("[seedFounderDecisionCards] cost seed failed (boot unaffected)", {
        metadata: { detail: err instanceof Error ? err.message : String(err) },
      }),
    );

  // 2026-07 usage-rail sunset — founder picked "free taste → BYO"; these cards
  // surface the remaining founder-only calls (sunset order; allowance shape).
  void import("../services/railSunsetDecisionCards")
    .then(({ seedRailSunsetDecisionCards }) => seedRailSunsetDecisionCards())
    .catch((err) =>
      logger.warn("[seedFounderDecisionCards] rail-sunset seed failed (boot unaffected)", {
        metadata: { detail: err instanceof Error ? err.message : String(err) },
      }),
    );

  // 2026-07 trust-graduation re-collar: demote auto-graduated "silent" tiers
  // lacking an explicit founder force_silent override back to notify_only.
  // One law of the leash — silent execution requires the founder's tap.
  void import("../services/trustGraduationReconcile")
    .then(({ recollarSilentTiersOnce }) => recollarSilentTiersOnce())
    .catch((err) =>
      logger.warn("[seedFounderDecisionCards] trust re-collar failed (boot unaffected)", {
        metadata: { detail: err instanceof Error ? err.message : String(err) },
      }),
    );
}
