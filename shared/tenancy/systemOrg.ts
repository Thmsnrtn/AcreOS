/**
 * ONE definition of "the platform's own organization".
 *
 * Several founder-plane subsystems store rows in org-scoped tables that belong
 * to AcreOS itself rather than to any customer — company-agent memory,
 * self-assessment findings, agent promotion rules, market-network staging. Each
 * one named that org privately, and they DID NOT AGREE:
 *
 *   server/jobs/indexAnalyzer.ts:22        const PLATFORM_ORG_ID = 0
 *   server/services/selfAssessmentAgent.ts const SYSTEM_ORG_ID = 1
 *   server/services/agentPromotionGate.ts  const SYSTEM_ORG_ID = 1
 *   server/services/marketNetworkContributor.ts   organizationId: 1  (comment:
 *                                          "Sentinel org … 1 = system placeholder")
 *   server/services/marketIntelligence.ts  organizationId: 1  ("System-wide event")
 *   server/jobs/courseCompletionCheck.ts   organizationId: 1  ("platform org")
 *
 * Five spellings of one concept and a 0/1 disagreement about which row it is.
 * That is the same defect shape as the four competing parcel keys: a value that
 * decides which tenant owns a row, defined privately in several places, drifting.
 *
 * WHY 1 AND NOT 0. Not a preference — 1 is what production already uses. Four
 * of the six sites use 1, including two live services. `organizations.id` is a
 * `serial`, which begins at 1, so a row with id 0 does not exist unless someone
 * inserted it explicitly; every org-scoped table that carries a foreign key to
 * `organizations` would reject 0 outright. `PLATFORM_ORG_ID = 0` in
 * indexAnalyzer.ts is therefore very likely matching nothing at all — but it
 * reads from `organization_integrations` rather than writing, so it fails as an
 * empty result rather than an error, which is exactly how it went unnoticed.
 *
 * RECONCILED 2026-08-17 on the founder's decision (OD-4). indexAnalyzer.ts now
 * imports this constant; all six sites agree. It was escalated rather than
 * silently "corrected" because repointing a live job changes which rows it acts
 * on, and no session has had a `DATABASE_URL` to look first.
 *
 * WHAT THE FIX ACTUALLY REPAIRED, which was more than a stale constant. The
 * queued note called it a read that returns nothing. It is not: `saveReport`
 * INSERTs with this id, so the write failed its foreign key on EVERY weekly
 * run — and the catch logged it at INFO with the error discarded. `getLastReport`
 * then found nothing, so GET /api/admin/index-analysis (founder-only) answered
 * "No analysis run yet" indefinitely while the job computed a report and threw
 * it away. A wrong tenant id plus a swallowed error is invisible in a way that
 * either alone is not.
 */

/**
 * The organization id that owns AcreOS's OWN founder-plane rows.
 *
 * NOT a customer tenant, and never a substitute for a real `organizationId` on
 * a customer path. If a customer-facing code path reaches for this constant,
 * the tenancy is missing somewhere upstream — thread the real org through
 * instead.
 */
export const SYSTEM_ORG_ID = 1;
