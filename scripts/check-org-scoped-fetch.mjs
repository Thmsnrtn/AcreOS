#!/usr/bin/env node
// ============================================================================
// scripts/check-org-scoped-fetch.mjs
// ----------------------------------------------------------------------------
// Tier 1F tenancy-by-construction ratchet lint — flags methods that query an
// ORG-SCOPED table without any organization context.
//
// Why
// ───
// The Tier 1F conversion (elevation blueprint 2026-06-10) moved the
// highest-risk fetch-by-bare-id storage methods onto the org-scoped
// repository layer (`forOrg()` in server/utils/orgScopedDb.ts), so a
// cross-tenant id resolves to "not found" by construction. This lint keeps
// the ratchet from sliding back: any NEW method that selects /
// updates / deletes against a table carrying an `organizationId` column,
// while its signature+body never mentions an org identifier, fails CI.
//
// THE SERVICE LAYER (added 2026-08-13)
// ────────────────────────────────────
// Until then this lint walked `server/storage.ts` + `server/storage/*.ts` and
// nothing else — so the rule was real, enforced, and applied to one layer.
// A service that owns its own persistence never passed under it, and one of
// them was leaking KYC records across tenants: every route-reachable method on
// `services/investorVerification.ts` resolved rows by primary key while the
// table carried `organizationId NOT NULL` and an org-leading index. Any
// authenticated member of any org could read another org's verification status
// and audit trail, attach documents, advance its state machine, and — as an
// admin of their own org — approve it.
//
// Pointed at `server/services/**`, THIS LINT FLAGS ALL SIX of the methods that
// fix touched. That is checkable, not a claim: run it against
// `git show <the commit>~1:server/services/investorVerification.ts`.
//
// The moral is the one the repo keeps relearning — the defect was never a
// missing rule, only a rule applied to some surfaces and not others.
//
// THE FUNCTION SHAPE (added 2026-08-16, enforcement audit GAP A)
// ─────────────────────────────────────────────────────────────
// The same moral, one level down. Having been pointed at the right FILES,
// this lint was still only looking at the right SYNTAX: it extracted
// `async <name>(` — class / object-literal method form — and nothing else.
// `async function <name>(` never matched, because the regex read the
// identifier as "function" and then demanded an immediate `(`.
//
// So the rule was enforced against a keyword rather than against a defect:
//
//     async getDeal(dealId: number) { … }          → CAUGHT
//     export async function getDeal(dealId) { … }  → GREEN
//
// Identical table, identical bare id, identical cross-tenant read, in a file
// this lint already walked. Widening extraction to the function shape raised
// the scanned population from 2,485 units to 4,606 and surfaced 122 rule-1 +
// 63 rule-2 offenders that had always been there. They are frozen in the
// clearly-labelled FUNCTION SHAPE registers below — see that block for the
// measured triage split and for why the predicate was deliberately not
// narrowed further.
//
// Heuristic
// ─────────
// No TypeScript execution — focused regex passes, same family as
// check-org-leading-index.mjs:
//
//   1. Parse shared/schema*.ts for `export const <ident> = pgTable("<name>",…)`
//      blocks and record the TS identifiers of tables that declare an
//      `organizationId` column ("org-scoped tables").
//   2. Walk server/storage.ts, server/storage/*.ts and server/services/**.
//      For every `async <method>(…) { … }` AND every
//      `async function <name>(…) { … }` (both brace-matched), collect the
//      org-scoped table identifiers it touches via `from(<ident>)`,
//      `db.update(<ident>)`, or `db.delete(<ident>)`.
//   3. If the unit touches at least one org-scoped table and its text
//      (signature + body) contains NO org context marker
//      (`organizationId`, `orgId`, `forOrg(`, `unscopedForPlatformOps(`),
//      it is an offender. Method-shape offenders answer to BASELINE_OFFENDERS,
//      function-shape offenders to BASELINE_FUNCTION_OFFENDERS; likewise for
//      rule 2. One rule, two shapes, two independently shrinkable registers.
//   4. VACUITY GUARD: if the scan sees implausibly few files, tables, methods,
//      functions or org-touching units, it FAILS instead of reporting PASS.
//      An empty scan is a broken scanner, not a clean repo — this file's own
//      comment-masking bug once blanked the lines a scan was counting.
//
// `unscopedForPlatformOps(reason)` is the sanctioned escape hatch — it is
// greppable and logs its reason, so methods using it are intentionally
// exempt here (the audit surface is the grep, not this lint).
//
// Exit codes
// ──────────
//   0 — no NEW offenders and no stale allowlist entries
//   1 — at least one NEW offender, or a stale baseline entry (ratchet is
//        enforced both directions)
//
// Baseline allowlist
// ──────────────────
// Pre-existing offenders are frozen below so the lint can land NOW and block
// regressions. The list only ratchets DOWN: to remove an entry, convert the
// method to take an org id (preferably via `forOrg(...)`) or route it
// through `unscopedForPlatformOps(reason)` if it is a genuine platform op,
// then delete the entry. NEW entries require Iris-CTO sign-off.
//
// Known limitations (documented, raise if they become real):
//   - A method that ACCEPTS an orgId but forgets to apply the predicate is
//     not caught (text-level heuristic). The vitest suite covers the
//     converted methods' emitted SQL instead. This is not hypothetical: it is
//     the precise gap `investorVerificationTenancy.test.ts` fills with source
//     assertions over the emitted `where(...)`, because a behavioural test
//     against a storage double cannot see a missing predicate either.
//   - Passing this lint means a method MENTIONS an org, not that it is safe.
//     A service can take `orgId` and still hand it to nobody.
//   - Tables queried through helper indirection (variable holding the table)
//     are missed. Not a pattern in storage today.
// ============================================================================

const BASELINE_OFFENDERS = new Set([
  // ── RE-SEED 2026-08-17 (founder-approved, OD-3) ──────────────────────────
  // NOT new code and NOT newly broken. The extractor's body-finder landed on
  // the brace of an inline `): Promise<{ … }> {` return type, so these bodies
  // were never scanned and were silently exempt from this gate. Fixing the
  // finder made them visible: the count rose because the gate got its sight
  // back, not because anything got worse. DOWN-ONLY from here.
  //
  // A sample was hand-verified before freezing — none was an artifact, and the
  // two classes map exactly onto the two rules:
  //   RULE 1 (this register) — no organization anywhere. Both samples are
  //   genuine platform ops that never declared themselves as such:
  //   trustEvolution.runTrustEvolution and platformOpsRepo.getApiUsageStats
  //   read across every org without routing through
  //   unscopedForPlatformOps(reason), which is what this gate requires so the
  //   intent is STATED rather than inferred from a filename.
  "server/services/agentOrchestration.ts::approveStep",
  "server/services/alertPolicy.ts::generateWeeklyDigest",
  "server/services/customerSupportAutoResolver.ts::attemptResolution",
  "server/services/decisionsInbox.ts::approve",
  "server/services/dunning.ts::getSummary",
  "server/services/etlHandlers.ts::upsert",
  "server/services/paxLearning.ts::getAllLearnings",
  "server/services/paxLearning.ts::getKnownFixPatterns",
  "server/storage.ts::getSubscriptionStats",
  "server/storage/platformOpsRepo.ts::getApiUsageStats",
  "server/storage/supportOpsRepo.ts::acknowledgeAlert",
  "server/storage/supportOpsRepo.ts::acknowledgeAllAlerts",
  "server/storage/platformOpsRepo.ts::cleanExpiredBorrowerSessions",
  "server/storage/growthConfigRepo.ts::countFieldScoutVisits",
  // noteRepo entries below: pre-existing methods that became VISIBLE when
  // comment-masking fixed the parser (2026-06-10) — they are not new code.
  // getNoteByAccessToken is capability-based by design (the token IS the
  // auth for borrower-facing links); the others take a bare id from callers
  // that org-verify upstream. Tighten when touched.
  // (createAutomationExecution entry removed 2026-07-29: the method was
  // deleted with the dead automation-rules surface — Wave A "Nothing lies".)
  "server/storage.ts::createMessage",
  "server/storage/paxRepo.ts::createPaxProjectFile",
  "server/storage/platformOpsRepo.ts::deleteBorrowerSession",
  // deletePaxProjectFile removed 2026-08-21: the DELETE now proves the file's
  // parent project belongs to the caller's org inside the statement
  // (`project_id IN (SELECT id FROM pax_projects WHERE id = $p AND
  // organization_id = $o)`), and the fileCount UPDATE carries the same
  // predicate. It used to resolve the file by bare id and then scope the
  // project update to the projectId READ OFF THAT ROW — another org's row.
  // Pinned behaviourally by tests/unit/paxProjectFileTenancy.test.ts.
  "server/storage/integrationsRepo.ts::findOrganizationIntegrationByCredential",
  "server/storage/sequencesRepo.ts::getAbTestByCampaign",
  "server/storage/vaEngineRepo.ts::getAdPostingsByProperty",
  "server/storage/supportOpsRepo.ts::getAdminDashboardData",
  "server/storage/agentWorkflowsRepo.ts::getAgentFeedbackByTask",
  "server/storage/platformOpsRepo.ts::getAllFeatureRequestsForFounder",
  "server/storage/platformOpsRepo.ts::getBorrowerSession",
  "server/storage/vaEngineRepo.ts::getBuyerPrequalificationByLead",
  "server/storage/commsRepo.ts::getCampaignByTrackingCode",
  "server/storage/commsRepo.ts::getCampaignResponsesCount",
  "server/storage/vaEngineRepo.ts::getCollectionEnrollmentsByNote",
  "server/storage/vaEngineRepo.ts::getCollectionEnrollmentsBySequence",
  "server/storage/documentsRepo.ts::getDocumentSignatures",
  "server/storage/acquisitionRepo.ts::getDueDiligenceChecklist",
  "server/storage/agentWorkflowsRepo.ts::getDueScheduledTasks",
  "server/storage/supportOpsRepo.ts::getEscalatedCases",
  "server/storage/growthConfigRepo.ts::getFieldScoutPhotosByLead",
  "server/storage/growthConfigRepo.ts::getFieldScoutPhotosByVisit",
  "server/storage/growthConfigRepo.ts::getFieldScoutVisit",
  "server/storage/growthConfigRepo.ts::getFieldScoutVisits",
  "server/storage.ts::getMessages",
  "server/storage/gisRepo.ts::getParcelSnapshot",
  "server/storage/paxRepo.ts::getPaxScheduledTasksDue",
  "server/storage/paymentRemindersRepo.ts::getRemindersForNote",
  "server/storage/agentWorkflowsRepo.ts::getScheduledTask",
  "server/storage/vaEngineRepo.ts::getSellerCommunicationsByLead",
  "server/storage/vaRepo.ts::getVaAction",
  "server/storage/mailRepo.ts::incrementMailingOrderPieces",
  // markNotificationRead removed 2026-08-06 (audit F-23-4): it now takes an
  // optional organizationId and scopes the update when supplied, so it is no
  // longer an unscoped offender.
  "server/storage/supportOpsRepo.ts::resolveAlert",
  "server/storage/supportOpsRepo.ts::resolveAllAlerts",
  "server/storage/documentsRepo.ts::seedSystemTemplates",
  "server/storage/paxRepo.ts::setConversationProject",
  "server/storage/platformOpsRepo.ts::updateBorrowerSessionAccess",
  "server/storage/supportOpsRepo.ts::updateSystemAlert",
  "server/storage/gisRepo.ts::upsertParcelSnapshot",
  "server/storage/campaignRepo.ts::getCampaignOptimizations",
  "server/storage/campaignRepo.ts::markOptimizationImplemented",
  "server/storage/dealRepo.ts::_autoGenerateClosingChecklist",
  // getLeadActivities removed 2026-08-21: the SELECT now binds
  // `lead_activities.organization_id` to a REQUIRED leading org argument
  // alongside the lead id. It used to take `(leadId, limit)` with no org in
  // signature or body, and four of its five callers passed
  // `(organizationId, leadId)` — both `number`, so `npm run check` stayed
  // green while the query read `lead_id = <organizationId> limit <leadId>`.
  // Pinned behaviourally by tests/unit/leadActivityTenancy.test.ts.
  // The orgRepo organization-by-id/slug/stripe-id fetchers and the two
  // platform org-list methods were allowlisted only because the pre-masking
  // parser misclassified `organizations` itself as org-scoped. The
  // organizations table IS the org — fetching it by key is the tenancy
  // lookup primitive, not an offense. Entries removed 2026-06-10.
  // createPayment removed 2026-08-21: it now scopes BOTH note queries — the
  // SELECT … FOR UPDATE and the balance UPDATE — to `payment.organizationId`,
  // so a payment posted by org A can no longer rewrite an org B note it names
  // by id. Pinned behaviourally by tests/unit/notePaymentTenancy.test.ts.
  "server/storage/noteRepo.ts::getNoteByAccessToken",

  // ── SERVICE LAYER, frozen 2026-08-13 ──────────────────────────────────────
  //
  // 136 pre-existing offenders, admitted as a DEBT REGISTER, not as approval.
  // The storage half of this lint landed the same way ("Pre-existing offenders
  // are frozen below so the lint can land NOW and block regressions"), and the
  // alternative — converting 136 methods across 43 files, several of them on
  // the ACH payment rail — is a refactor with its own risk, not a safer choice.
  //
  // Context for whoever triages these: 744 service+storage methods touch an
  // org-scoped table and 556 already carry org context, so the service layer is
  // ~81% conformant. 22 of the 43 offender files are imported by a `routes-*`
  // file and are therefore the ones that can take an id straight from a URL —
  // triage those first. The rest are jobs and analytics that iterate rows they
  // already selected with an org filter; the heuristic cannot tell the two
  // apart, which is exactly why this is a register and not a verdict.
  //
  // Removing an entry means the method now takes an org id (preferably via
  // forOrg()) or routes through unscopedForPlatformOps(reason). A stale entry
  // FAILS this lint, so a fix cannot be landed without deleting its line.
  "server/services/achAutopay.ts::getActiveMandateForNote",
  "server/services/achAutopay.ts::getMandateById",
  "server/services/achAutopay.ts::getNote",
  "server/services/achAutopay.ts::listAttemptsForPeriod",
  "server/services/achAutopay.ts::listAutopayDueNotes",
  "server/services/achAutopay.ts::listInFlightAttempts",
  "server/services/achAutopay.ts::markAttemptCanceled",
  "server/services/achAutopay.ts::markAttemptFailed",
  "server/services/achAutopay.ts::markAttemptSettled",
  "server/services/achAutopay.ts::markAttemptSubmitted",
  "server/services/achAutopay.ts::recordReturn",
  "server/services/achAutopay.ts::setMandateStatus",
  "server/services/agentOrchestration.ts::completeSession",
  "server/services/agentOrchestration.ts::getSession",
  "server/services/agentOrchestration.ts::getSessionSteps",
  "server/services/agentOrchestration.ts::requestApproval",
  "server/services/agentOrchestration.ts::unsubscribe",
  "server/services/agentOrchestration.ts::updateSessionContext",
  "server/services/alertPolicy.ts::routeAlert",
  "server/services/alerting.ts::acknowledgeAlert",
  "server/services/alerting.ts::resolveAlert",
  "server/services/apiQueue.ts::cleanupOldJobs",
  "server/services/apiQueue.ts::getPendingJobs",
  "server/services/apiQueue.ts::updateJob",
  "server/services/borrower/autopayAuthorizationChallenge.ts::mandateIdForChallenge",
  "server/services/buyerQualificationBot.ts::assessFinancingReadiness",
  "server/services/decisionsInbox.ts::defer",
  "server/services/decisionsInbox.ts::override",
  "server/services/decisionsInbox.ts::processDeferredItems",
  "server/services/decisionsInbox.ts::reject",
  "server/services/dispositionOptimizer.ts::analyzeTimingFactors",
  "server/services/dispositionOptimizer.ts::calculateOptimalPrice",
  "server/services/dispositionOptimizer.ts::calculateOwnerFinanceTerms",
  "server/services/dispositionOptimizer.ts::getAverageDaysOnMarket",
  "server/services/dispositionOptimizer.ts::getMarketCondition",
  "server/services/dispositionOptimizer.ts::getRecommendation",
  "server/services/dispositionOptimizer.ts::recommendChannels",
  "server/services/dunning.ts::getActiveCases",
  "server/services/dunning.ts::getHistory",
  "server/services/etlHandlers.ts::softDelete",
  "server/services/externalStatusMonitor.ts::resolveOutageNotifications",
  "server/services/founder-chat/tools/action.ts::handler",
  "server/services/founder-chat/tools/action.ts::handler",
  "server/services/founder-chat/tools/inquiry.ts::handler",
  "server/services/founder-chat/tools/inquiry.ts::handler",
  "server/services/founder-chat/tools/inquiry.ts::handler",
  "server/services/founder-chat/tools/inquiry.ts::handler",
  "server/services/founder-chat/tools/inquiry.ts::handler",
  "server/services/founder-chat/tools/inquiry.ts::handler",
  "server/services/founder-chat/tools/inquiry.ts::handler",
  "server/services/founder-chat/tools/inquiry.ts::handler",
  "server/services/founder-chat/tools/inquiry.ts::handler",
  "server/services/founder-chat/tools/inquiry.ts::handler",
  "server/services/founder-chat/tools/synthesis.ts::handler",
  "server/services/founder-chat/tools/synthesis.ts::handler",
  "server/services/founder-chat/tools/synthesis.ts::handler",
  "server/services/founder-chat/tools/synthesis.ts::handler",
  "server/services/healthCheck.ts::checkTwilio",
  "server/services/leadNurturer.ts::scheduleFollowUp",
  "server/services/leadScoring.ts::calcCampaignTouches",
  "server/services/marketIntelligence.ts::getHistoricalMetrics",
  "server/services/marketIntelligence.ts::getMarketHealth",
  "server/services/marketIntelligence.ts::trackPredictionAccuracy",
  "server/services/marketIntelligence.ts::verifyPrediction",
  "server/services/marketPrediction.ts::getOpportunityWindows",
  "server/services/marketPrediction.ts::getPrediction",
  "server/services/marketWatchlist.ts::deleteEntry",
  "server/services/marketWatchlist.ts::getEntry",
  "server/services/marketWatchlist.ts::updateEntry",
  "server/services/paxObserver.ts::cleanupOldObservations",
  "server/services/priceOptimizer.ts::assessCompetition",
  "server/services/priceOptimizer.ts::getLatestSellerIntent",
  "server/services/priceOptimizer.ts::getMarketTiming",
  "server/services/priceOptimizer.ts::getMarketVolatility",
  "server/services/priceOptimizer.ts::incorporateMarketTrends",
  "server/services/proactiveMonitor.ts::autoResolveAlertsByMetadata",
  "server/services/proactiveMonitor.ts::cleanupOldAlerts",
  "server/services/voiceCallAI.ts::extractActionItems",
  "server/services/voiceCallAI.ts::extractKeyData",
  "server/services/voiceCallAI.ts::generateCoachingInsights",
  // whiteLabelService.ts::listTenants was REMOVED 2026-09-04 — it had never
  // been an offender. It reads `where(eq(whiteLabelConfigs.parentOrganizationId,
  // parentOrganizationId))`, which is exactly right; ORG_CONTEXT_RE was
  // case-sensitive on `organizationId` and so did not match
  // `parentOrganizationId`. Widening it to `[Oo]rganizationId` for the
  // marketplace's role-qualified keys cleared this one too, and the gate
  // reported the entry stale on the next run — which is the register working.
  "server/services/whiteLabelService.ts::resolveFromDomain",
]);

const BASELINE_UNUSED_ORG = new Set([
  // ── RE-SEED 2026-08-17 (founder-approved, OD-3) ──────────────────────────
  // NOT new code and NOT newly broken. The extractor's body-finder landed on
  // the brace of an inline `): Promise<{ … }> {` return type, so these bodies
  // were never scanned and were silently exempt from this gate. Fixing the
  // finder made them visible: the count rose because the gate got its sight
  // back, not because anything got worse. DOWN-ONLY from here.
  //
  // A sample was hand-verified before freezing — none was an artifact, and the
  // two classes map exactly onto the two rules:
  //   RULE 2 (this register) — has an org and resolves by id anyway, the
  //   shape that lets a caller-supplied id reach another tenant's row.
  //
  // ── CORRECTED 2026-08-20, AND BOTH WORKED EXAMPLES WERE WRONG ─────────────
  // This paragraph used to name `campaignOptimizer.optimizeCampaign` and
  // `autonomyHealth.gradeRecentDecisions` as "real tenancy weaknesses on live
  // paths, not annotation debt". A full adjudication of all 140 rule-2 entries
  // (cross-pollination ledger 49) checked both, and neither holds:
  //
  //   • optimizeCampaign takes a `Campaign` ROW, not an id. Its only route
  //     caller does `storage.getCampaign(org.id, campaignId)` first
  //     (routes-campaigns.ts:1318), so the row is proven owned before the
  //     primary-key UPDATE runs. Textbook class (b).
  //   • gradeRecentDecisions takes NO arguments and sweeps every org on
  //     purpose. Its callers are a cron and a `requireFounder` route
  //     (routes-founder-intelligence.ts:1799). Platform-wide by design.
  //
  // Two false examples at the top of a register are worse than none: this
  // paragraph is what a reader uses to decide how to triage the list, and it was
  // teaching them to look for the wrong thing. The audit's real numbers, for
  // calibration: of 140 entries, SIX were confirmed live cross-tenant paths (all
  // fixed and removed from these registers in that commit), 35 claims were
  // raised and refuted, and the large majority were class (b). Expect a low hit
  // rate, and verify every claim against the CALLER, not the signature.
  "server/services/agentOrchestration.ts::publishEvent",
  "server/services/campaignOptimizer.ts::optimizeCampaign",
  "server/services/dunning.ts::cancelCase",
  "server/services/dunning.ts::resolveCase",
  "server/services/dunning.ts::retryPayment",
  "server/services/leadNurturer.ts::processLeadsForOrg",
  "server/services/sequenceOptimizer.ts::identifyBestPerformingSegments",
  // ── RULE 2 BASELINE, frozen 2026-08-13 ────────────────────────────────────
  //
  // Methods that HAVE an organization and still resolve an org-scoped table by
  // primary key. Frozen as a register, not as approval — the same landing
  // strategy as rule 1's.
  //
  // TWO KINDS SIT IN HERE and the triage depends on telling them apart:
  //
  //   (a) THE ID COMES FROM THE CALLER. This is the real risk, and it is what
  //       cashFlowForecaster, documentIntelligence, dueDiligencePods and
  //       priceOptimizer.recordPriceOutcome each turned out to be. Start here.
  //
  //   (b) THE ID COMES FROM AN INSERT THIS METHOD JUST MADE — typically
  //       `.returning()` then `.where(eq(t.id, inserted.id))`. Safe, and
  //       textually identical to (a). `priceOptimizer`'s three recommend*
  //       methods are this kind; they are listed because the check cannot see
  //       the difference, not because they are wrong.
  //
  // Adding the org predicate to a (b) is free and correct — the row was
  // inserted with that org — so the cheapest way to shrink this register is to
  // scope the safe ones and be left with a list that is only (a).
  "server/services/achAutopay.ts::postReversal",
  "server/services/achAutopay.ts::postSettlement",
  "server/services/acquisitionRadar.ts::processOpportunityAlerts",
  "server/services/acquisitionRadar.ts::saveOpportunityScore",
  "server/services/agentOrchestration.ts::executeStep",
  "server/services/autonomousAgentEngine.ts::recordAction",
  "server/services/autonomousAgentEngine.ts::setAutonomyLevel",
  "server/services/autonomousAgentEngine.ts::updateAgentConfig",
  "server/services/buyerMatchingAI.ts::matchBuyerToProperties",
  "server/services/buyerMatchingAI.ts::matchPropertyToBuyers",
  "server/services/buyerMatchingAI.ts::presentMatchToBuyer",
  "server/services/buyerMatchingAI.ts::recordBuyerResponse",
  "server/services/buyerMatchingAI.ts::updateBuyerProfile",
  "server/services/buyerQualificationBot.ts::generateAssessment",
  "server/services/buyerQualificationBot.ts::generateQualificationReport",
  "server/services/buyerQualificationBot.ts::runBackgroundChecks",
  "server/services/buyerQualificationBot.ts::runFinancialCheck",
  "server/services/buyerQualificationBot.ts::updateQualificationStatus",
  "server/services/complianceGuardian.ts::resolveCheck",
  "server/services/complianceGuardian.ts::runSingleCheck",
  "server/services/complianceGuardian.ts::updateCheckStatus",
  "server/services/dealPatternCloning.ts::extractPattern",
  "server/services/dealPatternCloning.ts::recordPatternFromClosedDeal",
  "server/services/dealPatternCloning.ts::savePatternMatch",
  "server/services/decisionsInbox.ts::createFromFeatureRequest",
  "server/services/dispositionOptimizer.ts::findComparables",
  "server/services/dunning.ts::sendDunningSMS",
  "server/services/leadScoring.ts::scoreLead",
  "server/services/negotiationOrchestrator.ts::recordMove",
  "server/services/paxObserver.ts::updateBatchedObservation",
  "server/services/portfolioSentinel.ts::checkCompetitorActivity",
  "server/services/portfolioSentinel.ts::checkMarketChanges",
  "server/services/portfolioSentinel.ts::checkTaxStatus",
  "server/services/priceOptimizer.ts::findComparables",
  "server/services/priceOptimizer.ts::recommendAcquisitionPrice",
  "server/services/priceOptimizer.ts::recommendCounterOffer",
  "server/services/priceOptimizer.ts::recommendDispositionPrice",
  "server/services/sequenceOptimizer.ts::generateOptimizationSuggestions",
  "server/services/sequenceOptimizer.ts::recordMessagePerformance",
  "server/services/sequenceOptimizer.ts::runABTest",
  "server/services/voiceCallAI.ts::analyzeTranscript",
  "server/services/voiceCallAI.ts::applyCRMUpdates",
  "server/services/voiceCallAI.ts::processCallComplete",
  "server/services/voiceCallAI.ts::transcribeCall",
  "server/storage/agentWorkflowsRepo.ts::getWorkflowById",
  "server/storage/customizationRepo.ts::setDefaultView",
  "server/storage/customizationRepo.ts::upsertNotificationPreference",
  "server/storage/dealRepo.ts::updateDeal",
  "server/storage/integrationsRepo.ts::upsertOrganizationIntegration",
  "server/storage/supportOpsRepo.ts::getSupportCaseForPlatformOps",
  "server/storage/tasksRepo.ts::createNextRecurringTask",
]);

// ============================================================================
// FUNCTION SHAPE — registers frozen 2026-08-16 (enforcement audit, GAP A)
// ============================================================================
//
// THE MOVE, AND WHY THE COUNT WENT UP
// ───────────────────────────────────
// Until now this lint extracted only `async <name>(` — class / object-literal
// METHOD syntax. `async function <name>(` never matched, so the rule ("a unit
// that queries an org-scoped table with no org context is a tenancy defect")
// was enforced against a SYNTAX rather than against the rule. The bypass was
// not theoretical: an exported async function doing
// `db.select().from(deals).where(eq(deals.id, dealId))` shipped GREEN in a
// file this lint already walked, while the identical method was caught.
//
// Adding `extractAsyncFunctions` raised the scanned population from 2,485 to
// 4,606 units and surfaced 122 rule-1 offenders and 63 rule-2 offenders that
// were always there and always invisible. This is a ONE-TIME RE-SEED of newly
// VISIBLE debt, not a raised ceiling: the pre-existing method registers above
// were not touched, and both registers below may only SHRINK from here.
//
// MEASURED, NOT ASSUMED (the audit's own discipline applied to itself)
// ────────────────────────────────────────────────────────────────────
// 13 of the 122 were hand-read against schema before freezing. 13/13 are real
// instances of the rule — zero parser false positives, zero mis-spanned
// bodies. Every table involved was confirmed to carry `organization_id`.
// Triage split, measured across all 122 by predicate shape:
//
//   43  resolve a row by id / FK  → START HERE. This is the KYC-leak shape.
//                                   e.g. writingStyle.deleteStyleProfile(id)
//                                   is a bare-PK DELETE; leadQualification
//                                   .acknowledgeAlert is the exact twin of
//                                   the already-registered alerting.ts one;
//                                   wireInstructions.recordWireConfirmation
//                                   and achMandateSetup.revokeAchMandates-
//                                   ForNote sit on the money rail.
//   38  eq() on a non-id column (token / email / natural key). Mixed: some
//       are capability-based by design — same class as the already-registered
//       noteRepo::getNoteByAccessToken, where the token IS the auth.
//   41  aggregate / range scan, no eq() at all. Mostly founder + platform
//       instruments that span all orgs deliberately (ai-telemetry model
//       distribution, aiCostCeiling's explicitly platform-wide sum). These
//       are real by the rule and cheap to clear: wrap the access in
//       `unscopedForPlatformOps(reason)` and delete the line.
//
// The predicate was deliberately NOT narrowed to the 43. Narrowing to
// "resolves by id" would have made the function shape mean something
// different from the method shape — and would have opened a fresh bypass,
// since a filterless cross-tenant LIST leaks more than a single-row fetch.
// The existing 151-entry method register already carries aggregate entries
// (countFieldScoutVisits, getCampaignResponsesCount) for the same reason, and
// it has demonstrably shrunk (entries removed 2026-07-29 and 2026-08-06), so
// a register of this size is workable in this repo rather than aspirational.
//
// NOT INCLUDED, AND MEASURED RATHER THAN WAVED AT: `server/routes-*.ts` +
// `server/routes/**` are still outside findScannedFiles(). Measured cost of
// admitting them WITH inline `async (req, res) => {}` handler extraction:
// 271 files, 66 rule-1 + 73 rule-2 = 139 further entries. That is a separate
// unit of work with its own extractor, not a tail on this one — seeding 139
// more rows here would produce a register nobody works down, which is how a
// gate earns a re-baseline. Recorded here so the number is known, not
// rediscovered.
//
// Stale-entry discipline is identical to the registers above: a fix that is
// not accompanied by deleting its line FAILS this lint.

const BASELINE_FUNCTION_OFFENDERS = new Set([
  // ── RE-SEED 2026-08-17 (founder-approved, OD-3) ──────────────────────────
  // NOT new code and NOT newly broken. The extractor's body-finder landed on
  // the brace of an inline `): Promise<{ … }> {` return type, so these bodies
  // were never scanned and were silently exempt from this gate. Fixing the
  // finder made them visible: the count rose because the gate got its sight
  // back, not because anything got worse. DOWN-ONLY from here.
  //
  // A sample was hand-verified before freezing — none was an artifact, and the
  // two classes map exactly onto the two rules:
  //   RULE 1 (this register) — no organization anywhere. Both samples are
  //   genuine platform ops that never declared themselves as such:
  //   trustEvolution.runTrustEvolution and platformOpsRepo.getApiUsageStats
  //   read across every org without routing through
  //   unscopedForPlatformOps(reason), which is what this gate requires so the
  //   intent is STATED rather than inferred from a filename.
  "server/services/autonomousDecisionExecutor.ts::executeAlertAcknowledgement",
  "server/services/autonomousDecisionExecutor.ts::executeFeatureRequestApproval",
  "server/services/autonomyFinalMile.ts::generateDailyAutonomousSummary",
  "server/services/autopilot/rootCause.ts::runIncidentTriage",
  "server/services/data-cache/lookup-cache.ts::getCacheHitRate",
  "server/services/emailSuppressions.ts::filterSuppressed",
  "server/services/evolutionPrGenerator.ts::openPullRequestForEvolution",
  "server/services/onboardingAutonomy.ts::getActivationStats",
  "server/services/recourseDrafter.ts::aggregateAndDraft",
  "server/services/rosyRiver.ts::getWeeklyAgentSpend",
  "server/services/trustEvolution.ts::runTrustEvolution",
  "server/services/actions/outwardAction.ts::markClaim",
  "server/services/agentLlmTraces.ts::getTraceById",
  "server/services/agentMemoryConsolidation.ts::buildAgentWeekSlice",
  "server/services/agentRetractCron.ts::snapshotCurrentTelemetry",
  "server/services/ai-telemetry.ts::getCacheHitRate",
  "server/services/ai-telemetry.ts::getModelDistribution",
  "server/services/ai-telemetry.ts::getPromptCacheAdoption",
  "server/services/aiCostCeiling.ts::sumPlatformCostCentsSince",
  "server/services/andrei/supportResolverCalibration.ts::computeSupportResolverCalibration",
  "server/services/andrei/supportResolverCalibration.ts::runSupportResolverCalibrationGrader",
  "server/services/audit/detectors/observationRateDetector.ts::countObservations",
  "server/services/audit/detectors/taxReserveDetector.ts::trailing12moRevenueCents",
  "server/services/autonomousDecisionExecutor.ts::captureTelemetryBaseline",
  "server/services/autonomousDecisionExecutor.ts::runAutonomousDecisionExecutor",
  "server/services/autonomyHealth.ts::gradeAvgOutcomeScore",
  "server/services/autonomyHealth.ts::gradeFounderInterventionRate",
  "server/services/autonomyHealth.ts::gradePendingQueue",
  "server/services/autonomyHealth.ts::gradeSafetyRailTripRate",
  "server/services/autopilot/attribution.ts::getConversionSummary",
  "server/services/autopilot/guidedResume.ts::resumePreflight",
  "server/services/autopilot/learnedGates.ts::readSupportConfidenceOutcomeHistory",
  "server/services/autopilot/narrate.ts::composeFounderBrief",
  "server/services/autopilot/proofReceiptStore.ts::auditAllReceiptChains",
  "server/services/autopilot/proofReceiptStore.ts::getPrevReceiptHash",
  "server/services/autopilot/proofReceiptStore.ts::verifyReceiptChain",
  "server/services/autopilot/senses.ts::getOpenSupportCaseCount",
  "server/services/browserAutomation.ts::executeJob",
  "server/services/browserAutomation.ts::getJobById",
  "server/services/browserAutomation.ts::updateJobStatus",
  "server/services/calibration.ts::computeCalibration",
  "server/services/ceoCommandBridge.ts::handlePauseMarketing",
  "server/services/ceoCommandBridge.ts::handleResumeMarketing",
  "server/services/comms/tracking-pool.ts::releaseNumber",
  "server/services/companyBriefingGenerator.ts::generateCompanyBriefing",
  "server/services/companyMind.ts::recentFounderOverrides",
  "server/services/companyMind.ts::recentNegativeOutcomes",
  "server/services/coverageLedger.ts::discoverCountyEndpoint",
  "server/services/customer-surface/errorBoundaryAggregator.ts::detectAndPageOnSpike",
  "server/services/customer-surface/errorBoundaryAggregator.ts::getRecentTripCounts",
  "server/services/dailyAiCostGuard.ts::summarizeAiCostLast24h",
  "server/services/dataCoop/countyRollupJob.ts::gatherCountyRollup",
  "server/services/decisionExperiments.ts::analyzeExperiment",
  "server/services/decisionExplanation.ts::explainAction",
  "server/services/decisionLogRag.ts::findSimilarPastDecisions",
  "server/services/emailSuppressions.ts::isSuppressed",
  "server/services/evolutionPipeline.ts::processPendingProposals",
  "server/services/evolutionPipeline.ts::stage5Deploy",
  "server/services/evolutionPipeline.ts::stage6RegressionCheck",
  "server/services/expansionRadar.ts::resolveExpansionCandidate",
  "server/services/finance/runwayModel.ts::bucketBalanceAsOf",
  "server/services/finance/runwayModel.ts::monthlyOpexUsd",
  "server/services/financial-ledger-invariant.ts::assertFinancialLedgerInvariant",
  "server/services/financial-ledger.ts::getBucketBalance",
  "server/services/form1098Batch.ts::loadBorrowers",
  "server/services/form1098Batch.ts::loadProperties",
  "server/services/founder/readinessLadder.ts::measureMailRail",
  "server/services/founderBriefing.ts::gatherStats",
  "server/services/founderNarrative.ts::buildSummary",
  "server/services/founderTodo.ts::fetchDecisions",
  "server/services/founderTodo.ts::fetchExperimentPromotions",
  "server/services/gdprService.ts::exportUserData",
  "server/services/ledgerDeadLetter.ts::runLedgerDeadLetterSweep",
  "server/services/marketNetworkContributor.ts::getStagingEntries",
  "server/services/migrationJobs.ts::runImportJob",
  "server/services/mlSnapshots.ts::pairOutcome",
  "server/services/multiWeekPlanner.ts::readWindowMetrics",
  "server/services/orgEmailIdentity.ts::verifyIdentity",
  "server/services/outcomeLedger.ts::applyCheckInAnswer",
  "server/services/outcomeLedger.ts::getOutcomeLedgerCounts",
  "server/services/outcomeVerificationV12.ts::verifyEmailDelivery",
  "server/services/outcomeVerificationV12.ts::verifyMetricChange",
  "server/services/outreachStopLoss.ts::readMonthToDateMailDataSpendCents",
  "server/services/pax/userContext.ts::deleteUserContext",
  "server/services/pax/userContext.ts::getContextDistribution",
  "server/services/pax/userContext.ts::loadUserContext",
  "server/services/pax/userContext.ts::setPersonalizationOptOut",
  "server/services/promptEvolutionMetaAgent.ts::analyseAgent",
  "server/services/reconciliation.ts::fetchAcreosTotal",
  "server/services/recourseDrafter.ts::generateDraftReply",
  "server/services/reliability/sloCompute.ts::aiSuccessBurnRate",
  "server/services/reliability/sloCompute.ts::aiSuccessSlo",
  "server/services/reserveFloorChecker.ts::computeReserveFloor",
  "server/services/solene/connectionsSweep.ts::buildSweepBrief",
  "server/services/solene/letterReply.ts::confirmLetterReply",
  "server/services/solene/tickMetric.ts::countFounderDecisionsThisWeek",
  "server/services/solene/tickMetric.ts::getTickMetric",
  "server/services/strategicProposals.ts::buildWeeklyDomainSummary",
  "server/services/team-system-audit/index.ts::defaultAuditFiringSource",
  "server/services/teamWebhookDispatcher.ts::markDispatched",
  "server/services/teamWebhookDispatcher.ts::markError",
  "server/services/telemetryDigest.ts::readTelemetrySnapshot",
  "server/services/telemetryDigest.ts::runTelemetryDigest",
  "server/services/telemetryOptimizer.ts::queryRawStats",
  "server/services/trendAnalyzer.ts::getWeeklyTrends",
  "server/services/unsubscribeTokens.ts::markTokenUsed",
  "server/services/vendorSecretRotation.ts::getLastRotationTimestamp",
]);

// RULE 2, FUNCTION SHAPE — frozen 2026-08-16, same re-seed as above.
//
// Functions that HAVE an organization and still resolve an org-scoped table by
// primary key. The (a)/(b) triage in BASELINE_UNUSED_ORG applies unchanged.
// A worked example of each, both verified by hand:
//
//   (a) amlMonitor.checkDealAmlPatterns(orgId, dealId, …) takes an org and
//       then runs `where(eq(deals.id, dealId))` with no org predicate — the
//       precise cashFlowForecaster shape that motivated rule 1, in a shape
//       rule 1 could not see. A dealId from another tenant reads that
//       tenant's deal through a signature whose type says it is scoped.
//   (b) byok/key-vault.getByokCredential selects under a correct org filter,
//       then bumps lastUsedAt via `where(eq(byokCredentials.id, row.id))` on
//       the row it just read. Safe, and textually identical to (a).
const BASELINE_FUNCTION_UNUSED_ORG = new Set([
  // ── RE-SEED 2026-08-17 (founder-approved, OD-3) ──────────────────────────
  // NOT new code and NOT newly broken. The extractor's body-finder landed on
  // the brace of an inline `): Promise<{ … }> {` return type, so these bodies
  // were never scanned and were silently exempt from this gate. Fixing the
  // finder made them visible: the count rose because the gate got its sight
  // back, not because anything got worse. DOWN-ONLY from here.
  //
  // A sample was hand-verified before freezing — none was an artifact, and the
  // two classes map exactly onto the two rules:
  //   RULE 2 (this register) — has an org and resolves by id anyway, the
  //   shape that lets a caller-supplied id reach another tenant's row.
  //
  // ── CORRECTED 2026-08-20, AND BOTH WORKED EXAMPLES WERE WRONG ─────────────
  // This paragraph used to name `campaignOptimizer.optimizeCampaign` and
  // `autonomyHealth.gradeRecentDecisions` as "real tenancy weaknesses on live
  // paths, not annotation debt". A full adjudication of all 140 rule-2 entries
  // (cross-pollination ledger 49) checked both, and neither holds:
  //
  //   • optimizeCampaign takes a `Campaign` ROW, not an id. Its only route
  //     caller does `storage.getCampaign(org.id, campaignId)` first
  //     (routes-campaigns.ts:1318), so the row is proven owned before the
  //     primary-key UPDATE runs. Textbook class (b).
  //   • gradeRecentDecisions takes NO arguments and sweeps every org on
  //     purpose. Its callers are a cron and a `requireFounder` route
  //     (routes-founder-intelligence.ts:1799). Platform-wide by design.
  //
  // Two false examples at the top of a register are worse than none: this
  // paragraph is what a reader uses to decide how to triage the list, and it was
  // teaching them to look for the wrong thing. The audit's real numbers, for
  // calibration: of 140 entries, SIX were confirmed live cross-tenant paths (all
  // fixed and removed from these registers in that commit), 35 claims were
  // raised and refuted, and the large majority were class (b). Expect a low hit
  // rate, and verify every claim against the CALLER, not the signature.
  // ── ADDED 2026-09-04, HAND-VERIFIED, with the fix that made it safe ──────
  // `executeSupportTool` became readable to this gate for the first time on
  // 2026-09-04: the walkers desynchronised on a nested template literal in the
  // same file, so the whole 91-case switch — a model-driven dispatch reachable
  // by any authenticated org member through POST
  // /api/support/tickets/:id/pax-resolve — had never been in the population.
  //
  // What rule 2 matched, both verified by reading:
  //   • supportTickets — `update_ticket_status`, `draft_customer_response` and
  //     `record_customer_feedback` key on the `ticketId` PARAMETER. All three
  //     call sites happened to check ownership first, so nothing was live, but
  //     that was a property of the callers. An ownership check now runs ONCE at
  //     the top of executeSupportTool (founders excepted, matching the
  //     pax-resolve route's own rule), so a fourth caller cannot forget it.
  //     The bare-id reads remain, which is what keeps this entry here.
  //   • paxMemory — the UPDATE keys on `existing[0].id`, and `existing` is read
  //     three lines above with eq(paxMemory.organizationId, org.id). Verified
  //     parent; class (b).
  //
  // Four cross-org READS were found in the same pass and FIXED rather than
  // registered: search_resolved_tickets, get_similar_resolutions,
  // get_best_resolution_approach and the resolution-analytics tool all read
  // support_resolution_history with no organization predicate, returning
  // another tenant's `resolutionApproach` and `lessonLearned` free text into
  // the context of a model then talking to a different paying customer.
  // It is NOT listed here: this register is a down-only ratchet, and admitting
  // a key raises it. Debt that appears because the POPULATION grew belongs in
  // scripts/org-scope-route-widening.json, which is the register for exactly
  // that and carries the reasoning above under _TRIAGED.
  "server/services/autonomyHealth.ts::gradeRecentDecisions",
  "server/services/customerSupportAutoResolver.ts::sophieGeniusMode",
  "server/services/disclosureTimingDispatcher.ts::runDisclosureTimingDispatch",
  "server/services/inboundEmailService.ts::processInboundEmail",
  "server/services/leadScoreDecay.ts::decayOrganizationLeads",
  "server/services/migrationJobs.ts::processCommunicationsImport",
  "server/services/migrationJobs.ts::processDocumentImport",
  "server/services/onboardingAutonomy.ts::sweepAndFireDueSteps",
  "server/services/propertyTaxService.ts::recordTaxPaymentFromEscrow",
  "server/services/recognitionWorker.ts::runRecognitionTick",
  "server/services/sellerMotivationEngine.ts::rescoreLeadsForOrg",
  "server/services/smsService.ts::handleIncomingSMS",
  "server/services/smsService.ts::saveTwilioCredentials",
  "server/services/smsService.ts::sendSMSToLead",
  "server/services/achMandateSetup.ts::confirmAchMandateSetup",
  "server/services/actions/outwardAction.ts::withOutwardAction",
  "server/services/agentPromotionGate.ts::addSimulationRequirement",
  "server/services/amlMonitor.ts::checkDealAmlPatterns",
  "server/services/andrei/supportResolverCalibration.ts::gradeAutoResolvedTicket",
  "server/services/atlasMemory.ts::storeMemory",
  "server/services/atrSafeHarbor.ts::persistAtrDetermination",
  "server/services/autonomousDecisionExecutor.ts::processInboxItem",
  "server/services/autopilot/hands/registry.ts::executeHandWitnessed",
  "server/services/byok/key-vault.ts::getByokCredential",
  "server/services/commissionService.ts::saveCommissionConfig",
  "server/services/commissionService.ts::saveCommissionRecordsStore",
  "server/services/commissionService.ts::saveSplitConfig",
  "server/services/comms/tracking-pool.ts::assignTrackingNumberForMailShipment",
  "server/services/dealFeedEngine.ts::getTodaysFeed",
  "server/services/dealHandoffService.ts::saveHandoffsStore",
  "server/services/disclosureTimingDispatcher.ts::resolveRecipientEmail",
  "server/services/dueDiligence.ts::generateDueDiligenceReport",
  "server/services/form1099Batch.ts::generate1099Batch",
  // KEPT ON PURPOSE, AND ADDING A PREDICATE HERE WOULD BE A BUG. `resolveEntityOrg`
  // IS the ownership oracle: it answers "which org owns this entity?" by selecting
  // the org COLUMN by primary key, and returns `row?.orgId ?? null`. It takes no
  // expected org — there is nothing in scope to filter by, and filtering would
  // collapse "belongs to org 7" into "unresolvable", destroying the `actualOrgId`
  // its caller reports in the mismatch error. The real predicate is one frame up
  // (`actualOrgId !== expectedOrgId` -> AtlasEntityOrgMismatchError, fail-closed
  // on null). The lint fires on the SELECT projection, not on an input.
  // Adjudicated 2026-08-20, ledger 49.
  "server/services/founder-chat/assert-entity-org.ts::resolveEntityOrg",
  "server/services/gdprService.ts::anonymizeUser",
  "server/services/leadEnrichment.ts::enrichLead",
  "server/services/leadQualification.ts::checkForHotLeads",
  "server/services/leadScoreDecay.ts::applyScoreRecovery",
  "server/services/mail/mailFlusher.ts::bookFreeSendAcquisitionCogs",
  "server/services/migrationJobs.ts::createImportJob",
  "server/services/migrationJobs.ts::markImportComplete",
  "server/services/migrationJobs.ts::runExportJob",
  "server/services/offerBatchService.ts::createOfferBatch",
  "server/services/onboardingAutonomy.ts::handleActivationVerdict",
  "server/services/onboardingAutonomy.ts::handleWeek1Checkin",
  "server/services/outcomeLedger.ts::writeOutcome",
  "server/services/pax/continuousAudit.ts::runPaxAudit",
  "server/services/paxMemoryTriggers.ts::onConstraintMentioned",
  "server/services/paxMemoryTriggers.ts::onDealClosed",
  "server/services/paxMemoryTriggers.ts::onGoalSet",
  "server/services/paxMemoryTriggers.ts::onUserCorrection",
  "server/services/paymentApplication/index.ts::applyAcquiredNotePayment",
  "server/services/paymentApplication/index.ts::applyPayment",
  "server/services/periodicStatements/delivery.ts::notifyStatementGenerated",
  "server/services/periodicStatements/index.ts::generateOneAcquiredStatement",
  "server/services/periodicStatements/index.ts::generateOneStatement",
  "server/services/pipelineIntelligence.ts::recommendDisposition",
  "server/services/propertyTaxService.ts::creditMonthlyTaxEscrow",
  "server/services/propertyVisionReimaging.ts::reimageProperty",
  "server/services/publicWebhookDispatcher.ts::attemptDelivery",
  "server/services/rental/depositClock.ts::startDepositClock",
  "server/services/revenueProtection.ts::processOrganization",
  "server/services/solene/doctrineIngest.ts::ingestDoctrineFile",
  "server/services/solene/founderPrecedent.ts::recordFounderPrecedent",
  "server/services/solene/verifyQueue.ts::enqueueDunningEventVerify",
  "server/services/solene/verifyQueue.ts::enqueueMailShipmentVerify",
  "server/services/solene/verifyQueue.ts::enqueueVerifyDispatch",
  "server/services/solene/verifyQueue.ts::recordVerifyOutcome",
  "server/services/taxDelinquentPipeline.ts::addToOutreach",
  "server/services/territoryService.ts::saveTerritoriesStore",
  "server/services/titleChainService.ts::runPostCloseAutomation",
  "server/services/webhookDispatcher.ts::saveWebhookEndpoints",
]);

import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * `--root DIR` — scan a FIXTURE TREE instead of the repository.
 *
 * THE REASON, because it is not a convenience. This gate's own canary test used
 * to write `server/services/__rule3_canary__.ts` into the LIVE tree, run the
 * real gate over ~906 files, and delete it. Roughly 69 other test files walk
 * `server/**`, vitest runs them in parallel workers, and one of them would list
 * the canary and read it after the delete — dying with an fs stack trace
 * instead of an assertion. That happened twice on 2026-08-20. Two other gates
 * were moved to fixture trees the same day (ledger 43); this was the last
 * writer, so with it moved the tree no longer rewrites itself under a test run
 * at all.
 *
 * A fixture tree is a different KIND of tree, and three things below have to be
 * told so: the vacuity floors (sized for the repo, unmeetable by five files),
 * the register-staleness checks (every baseline entry names a real file, so all
 * of them look stale against a fixture), and the rule-3 chain floor. Everything
 * that ENFORCES — new offenders, new unscoped chains — runs identically, which
 * is what makes the canary meaningful.
 */
const argv = process.argv.slice(2);
function argValue(flag) {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : null;
}
const DEFAULT_ROOT = resolve(__dirname, "..");
const REPO_ROOT = resolve(argValue("--root") ?? DEFAULT_ROOT);
/** False when pointed at a fixture — see the note above for what that changes. */
const SCANNING_REAL_REPO = REPO_ROOT === DEFAULT_ROOT;
const SHARED_DIR = join(REPO_ROOT, "shared");
const SERVER_DIR = join(REPO_ROOT, "server");

/**
 * Files the walk listed that were gone by the time they were read.
 *
 * Kept even though this gate no longer writes probes itself: OTHER tooling can
 * still rewrite the tree under a scan, and crashing with an fs stack trace
 * reads as a finding when it is not one. Counted, not ignored — a tree
 * rewriting itself mid-scan is not a tree this gate can certify — and checked
 * against a ceiling in the verdict.
 */
let vanishedDuringScan = 0;
const VANISHED_CEILING = 5;

// ----------------------------------------------------------------------------
// Schema discovery — org-scoped table identifiers
// ----------------------------------------------------------------------------

function findSchemaFiles() {
  const files = [];
  if (!statSync(SHARED_DIR, { throwIfNoEntry: false })?.isDirectory()) return files;
  for (const entry of readdirSync(SHARED_DIR)) {
    const full = join(SHARED_DIR, entry);
    if (!statSync(full).isFile()) continue;
    if (entry === "schema.ts") files.push(full);
    else if (entry.startsWith("schema-") && entry.endsWith(".ts")) files.push(full);
  }
  const subdir = join(SHARED_DIR, "schema");
  if (statSync(subdir, { throwIfNoEntry: false })?.isDirectory()) {
    for (const entry of readdirSync(subdir)) {
      if (!entry.endsWith(".ts")) continue;
      if (entry.endsWith(".test.ts") || entry.endsWith(".spec.ts")) continue;
      files.push(join(subdir, entry));
    }
  }
  return files.sort();
}

/**
 * Replace `//` and `/* … *​/` comment spans with spaces (string-aware: a
 * `//` inside a string literal is left alone). Same-length output, so every
 * index and line number in the masked source maps 1:1 onto the original.
 *
 * Why this exists: matchParen/matchBrace track string state but used to walk
 * the RAW source, so an apostrophe inside a comment ("the calibrator's
 * weights") opened phantom string state and desynced the depth counter. The
 * resulting table/method spans were garbage that silently re-shuffled which
 * tables counted as org-scoped whenever unrelated schema text moved —
 * at one point dropping `properties` itself from the org-scoped set.
 */
/**
 * Index of the backtick that closes the template literal opening at `start`.
 *
 * A template is not a quoted string: `${…}` holes contain arbitrary code,
 * INCLUDING further template literals. Treating a backtick as a plain quote
 * and scanning to the next one therefore closes the OUTER template on an
 * INNER one, after which every brace, paren and quote in between is read at
 * the wrong nesting.
 *
 * Measured 2026-09-04 on `POST /api/founder/escalations/:id/generate-prompt`,
 * whose prompt builder nests three deep:
 *
 *     ${messages.map(m => `**${m.role === 'agent' ? `Pax (${m.agentName})` : 'System'}:** …`)}
 *
 * The registration's paren walk ran off the end of the handler and the route
 * left the population. It was the LAST silently-dropped declaration in the
 * repository; everything else the walkers could not read is now counted.
 *
 * Returns -1 for an unterminated template, which every caller must treat as a
 * loud skip rather than a guess.
 */
function skipTemplate(source, start) {
  let i = start + 1;
  while (i < source.length) {
    const c = source[i];
    if (c === "\\") { i += 2; continue; }
    if (c === "`") return i;
    if (c === "$" && source[i + 1] === "{") {
      let depth = 1;
      let prev = "{";
      i += 2;
      while (i < source.length && depth > 0) {
        const d = source[i];
        if (d === "\\") { i += 2; continue; }
        if (d === "`") {
          const end = skipTemplate(source, i);
          if (end === -1) return -1;
          i = end + 1;
          prev = "`";
          continue;
        }
        if (d === "/" && source[i + 1] === "/") {
          const nl = source.indexOf("\n", i);
          if (nl === -1) return -1;
          i = nl + 1;
          prev = "\n";
          continue;
        }
        if (d === "/" && source[i + 1] === "*") {
          const e = source.indexOf("*/", i + 2);
          if (e === -1) return -1;
          i = e + 2;
          prev = "/";
          continue;
        }
        // A hole is arbitrary code, so it can hold a regex literal — and this
        // one does, in the wild: `${(v.notes || "").replace(/"/g, '""')}` in
        // server/routes-field-scout.ts puts a DOUBLE QUOTE inside a regex
        // inside a hole inside a template. Read as a string, it desynchronised
        // the hole's brace count and the whole registration stopped closing.
        if (d === "/" && regexCanStartAfter(prev, source, i)) {
          let j = i + 1;
          let inClass = false;
          let closed = false;
          while (j < source.length) {
            const e = source[j];
            if (e === "\\") { j += 2; continue; }
            if (e === "\n") break;
            if (inClass) { if (e === "]") inClass = false; }
            else if (e === "[") inClass = true;
            else if (e === "/") { closed = true; break; }
            j += 1;
          }
          if (closed) { i = j + 1; prev = "/"; continue; }
        }
        if (d === '"' || d === "'") {
          const quote = d;
          i += 1;
          while (i < source.length && source[i] !== quote) i += source[i] === "\\" ? 2 : 1;
          i += 1;
          prev = quote;
          continue;
        }
        if (d === "{") depth += 1;
        else if (d === "}") depth -= 1;
        prev = d;
        i += 1;
      }
      continue;
    }
    i += 1;
  }
  return -1;
}

function maskComments(source) {
  const out = source.split("");
  let inString = null;
  let prevChar = "";
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (inString) {
      if (ch === inString && prevChar !== "\\") inString = null;
      prevChar = ch;
      continue;
    }
    if (ch === "`") {
      const end = skipTemplate(source, i);
      if (end === -1) break; // unterminated — leave the rest untouched
      i = end;
      prevChar = "`";
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = ch;
      prevChar = ch;
      continue;
    }
    if (ch === "/" && source[i + 1] === "/") {
      while (i < source.length && source[i] !== "\n") {
        out[i] = " ";
        i++;
      }
      prevChar = "\n";
      continue;
    }
    if (ch === "/" && source[i + 1] === "*") {
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) {
        if (source[i] !== "\n") out[i] = " ";
        i++;
      }
      if (i < source.length) {
        out[i] = " ";
        out[i + 1] = " ";
        i++;
      }
      prevChar = " ";
      continue;
    }
    // Tried AFTER the two comment branches above, deliberately: `/** doc */`
    // on a single line closes on its own trailing slash, so a regex check
    // placed first swallows the comment and leaves its prose as live code.
    // That cost three org-scoped tables and 36 route handlers when it was
    // tried the other way round.
    // A REGEX LITERAL is neither code to scan nor a comment to blank, and its
    // character class may hold quotes. `s.replace(/[<>&'"]/g, …)` opened a
    // string on the apostrophe HERE, in the mask itself — after which this
    // function's own string state was wrong for the rest of the file, so it
    // blanked live code it mistook for comments and left comments unblanked.
    // Everything downstream reads this output, so one regex literal could put
    // an arbitrary amount of a route file outside the population.
    //
    // Measured 2026-09-04: it cost four route registrations that no extractor
    // could then close. The regex branch below matchDelimiter has the same
    // reason; both use the same regex-vs-division rule.
    if (ch === "/" && regexCanStartAfter(prevChar, source, i)) {
      let j = i + 1;
      let inClass = false;
      let closed = false;
      while (j < source.length) {
        const c = source[j];
        if (c === "\\") { j += 2; continue; }
        if (c === "\n") break;
        if (inClass) { if (c === "]") inClass = false; }
        else if (c === "[") inClass = true;
        else if (c === "/") { closed = true; break; }
        j += 1;
      }
      if (closed) { i = j; prevChar = "/"; continue; }
    }
    prevChar = ch;
  }
  return out.join("");
}

/**
 * Walk a balanced pair from `openIdx`, skipping strings AND COMMENTS.
 *
 * ── WHY COMMENTS ────────────────────────────────────────────────────────────
 * Both walkers used to track quotes only. An APOSTROPHE IN A COMMENT — English
 * prose, which this repository is full of — therefore opened a string that ran
 * until the next apostrophe anywhere in the file, and every bracket in between
 * was counted wrong or not at all. When the walk cannot close, the extractor
 * drops the whole declaration, silently.
 *
 * Measured 2026-09-04: four route registrations were being dropped this way,
 * one of them on the sentence
 *
 *     // deployment doesn't carry it (never send a placeholder).
 *
 * inside `POST /break-glass/email`. Nothing in the verdict said so; the handler
 * simply was not in the population. A tenant-isolation gate losing units to a
 * contraction is not a parsing curiosity, it is the third law again: the
 * population is an assumption, and this one was invisible.
 *
 * `<` / `>` are deliberately NOT tracked here — these walk brackets, not
 * generics — and a regex literal whose character class holds an unmatched
 * quote would still confuse the string state. `unreadableDeclarations` and the
 * per-shape scan floors are what keep that honest: a walk that cannot close is
 * COUNTED, not skipped quietly.
 */
function matchDelimiter(source, openIdx, open, close) {
  let depth = 0;
  let inString = null;
  let prevChar = "";
  for (let i = openIdx; i < source.length; i++) {
    const ch = source[i];
    if (inString) {
      if (ch === inString && prevChar !== "\\") inString = null;
      prevChar = prevChar === "\\" && ch === "\\" ? "" : ch;
      continue;
    }
    if (ch === "/" && source[i + 1] === "/") {
      const nl = source.indexOf("\n", i);
      if (nl === -1) return -1;
      i = nl;
      prevChar = "\n";
      continue;
    }
    if (ch === "/" && source[i + 1] === "*") {
      const end = source.indexOf("*/", i + 2);
      if (end === -1) return -1;
      i = end + 1;
      prevChar = "/";
      continue;
    }
    // A REGEX LITERAL, which may hold quotes and brackets that are not code.
    // `esc = (s) => s.replace(/[<>&'"]/g, …)` in server/routes-founder-letters.ts
    // put BOTH quote characters inside a character class; the walk opened a
    // string on the apostrophe and never closed the call, dropping
    // `GET /sitemap-notes.xml` out of the population without a word.
    //
    // Regex-vs-division is decided the standard way: a `/` starts a literal
    // only where an expression may begin, which is after an operator, an
    // opening bracket, a comma, a semicolon, or a keyword like `return`.
    // Getting it wrong is not silent — the walk fails to close and the
    // declaration is COUNTED as unreadable.
    if (ch === "/" && regexCanStartAfter(prevChar, source, i)) {
      let j = i + 1;
      let inClass = false;
      let closed = false;
      while (j < source.length) {
        const c = source[j];
        if (c === "\\") { j += 2; continue; }
        if (c === "\n") break; // an unterminated literal is not a literal
        if (inClass) { if (c === "]") inClass = false; }
        else if (c === "[") inClass = true;
        else if (c === "/") { closed = true; break; }
        j += 1;
      }
      if (closed) { i = j; prevChar = "/"; continue; }
      // Not a regex after all — fall through and treat `/` as division.
    }
    if (ch === "`") {
      const end = skipTemplate(source, i);
      if (end === -1) return -1;
      i = end;
      prevChar = "`";
      continue;
    }
    if (ch === '"' || ch === "'") inString = ch;
    else if (ch === open) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth === 0) return i;
    }
    prevChar = ch;
  }
  return -1;
}

/**
 * Can a regex literal begin at `idx`? True where an EXPRESSION may begin.
 *
 * `prevChar` is the previous character the walk consumed, which is already
 * comment- and string-aware. Whitespace is walked back over so
 * `replace(\n  /re/, …)` reads the same as `replace(/re/, …)`.
 */
function regexCanStartAfter(prevChar, source, idx) {
  let k = idx - 1;
  while (k >= 0 && /\s/.test(source[k])) k -= 1;
  const c = k >= 0 ? source[k] : "";
  if (c === "") return true;
  // POSTFIX operators look exactly like prefix ones one character at a time,
  // and TypeScript adds a third. `Math.round((cac.cacUsd! / perCustomer) * 10)`
  // has a non-null assertion before the slash: read as a prefix `!`, the
  // division became a regex literal that swallowed the rest of the handler.
  // `x++ / 2` and `x-- / 2` are the same mistake in plain JavaScript.
  const isPostfix = (op) => {
    let j = k;
    while (j >= 0 && source[j] === op) j -= 1;
    while (j >= 0 && /\s/.test(source[j])) j -= 1;
    return j >= 0 && /[\w$)\]"'`]/.test(source[j]);
  };
  if (c === "!" && isPostfix("!")) return false;
  if ((c === "+" || c === "-") && source[k - 1] === c && isPostfix(c)) return false;
  if ("(,=:[!&|?{};+-*%^~<>".includes(c)) return true;
  // `return /re/`, `typeof /re/`, `case /re/:` — a word boundary before the
  // slash is a keyword, not an identifier, only for these.
  const word = /([A-Za-z_$][\w$]*)$/.exec(source.slice(Math.max(0, k - 12), k + 1));
  if (word && ["return", "typeof", "case", "in", "of", "delete", "void", "instanceof", "new", "do", "else", "yield", "await"].includes(word[1])) {
    return true;
  }
  return false;
}

/** Walk parens from `openIdx` (an opening "(") to its match. */
function matchParen(source, openIdx) {
  return matchDelimiter(source, openIdx, "(", ")");
}

/** Walk braces from `openIdx` (an opening "{") to its match. */
function matchBrace(source, openIdx) {
  return matchDelimiter(source, openIdx, "{", "}");
}

/**
 * Returns Map<tsIdentifier, tableName> for every exported pgTable whose
 * column map declares an `organizationId` column.
 */
/**
 * Per-SPELLING tally of the org-scoped table population, published in the
 * verdict and floored by the coverage test.
 *
 * The aggregate ("org-scoped tables: 404") cannot tell "both tenant-key
 * spellings are read" from "one is read and the other silently stopped
 * matching" — the latter prints a healthy 364 while 40 tables leave the
 * population entirely, taking every query against them out of all three rules.
 * That is not hypothetical: it is the state this gate was in until 2026-09-04.
 */
export const orgScopedTablesBySpelling = { organizationId: 0, orgId: 0, orgForeignKey: 0 };

/**
 * A column of ANY NAME carrying a NOT NULL foreign key to organizations.id.
 *
 * Not anchored to the column's name — that is the point: the marketplace keys
 * its tables by ROLE (`seller_organization_id`, `buyer_organization_id`,
 * `bidder_organization_id`), which no list of spellings would have caught.
 *
 * NOT NULL is load-bearing, and was added after measuring. An unconditioned FK
 * arm also pulls in `cached_lookups.first_fetched_by` and
 * `county_discovery_queue.first_requested_by` — both NULLABLE, both PROVENANCE
 * ("the org that first asked"), on a shared provider cache and a platform crawl
 * queue where cross-org reads are the entire design. A nullable org FK records
 * who touched a row; a NOT NULL one says whose the row IS. The two name arms
 * above stay unconditioned, because a column explicitly NAMED organization_id
 * declares its intent regardless of nullability; this arm INFERS tenancy from a
 * relationship, and an inference should be the conservative one.
 */
const ORG_FOREIGN_KEY_RE =
  /\b[A-Za-z0-9_]+\s*:\s*[a-zA-Z_]+\s*\(\s*["'`][a-z0-9_]+["'`]\s*\)[^\n]*references\(\s*\(\s*\)\s*=>\s*organizations\.id\s*\)[^\n]*\.notNull\(\)/;

function collectOrgScopedTableIdents() {
  const idents = new Map();
  orgScopedTablesBySpelling.organizationId = 0;
  orgScopedTablesBySpelling.orgId = 0;
  orgScopedTablesBySpelling.orgForeignKey = 0;
  const callRe = /\bexport\s+const\s+([A-Za-z0-9_]+)\s*=\s*pgTable\s*\(\s*["'`]([a-zA-Z0-9_]+)["'`]/g;
  for (const file of findSchemaFiles()) {
    const source = maskComments(readFileSync(file, "utf8"));
    let match;
    while ((match = callRe.exec(source)) !== null) {
      const [, ident, tableName] = match;
      const openIdx = source.indexOf("(", match.index + match[0].indexOf("pgTable"));
      if (openIdx === -1) continue;
      const endIdx = matchParen(source, openIdx);
      if (endIdx === -1) continue;
      const body = source.slice(openIdx + 1, endIdx);
      // TWO SPELLINGS, and until 2026-09-04 this front door knew one.
      // `orgId: integer("org_id")` keys 40 of this schema's tables; a unit
      // whose only org-table access was one of those reported "touches no
      // org-scoped table" and was skipped before rules 1, 2 AND 3 ran. Same
      // shape as the `.from(`-only keying fixed earlier the same day, one
      // layer further out: not a rule that was wrong, a POPULATION smaller
      // than the claim made about it.
      if (/\borganizationId\s*:\s*[a-zA-Z_]+\s*\(\s*["'`]organization_id["'`]/.test(body)) {
        orgScopedTablesBySpelling.organizationId += 1;
        idents.set(ident, tableName);
      } else if (/\borgId\s*:\s*[a-zA-Z_]+\s*\(\s*["'`]org_id["'`]/.test(body)) {
        orgScopedTablesBySpelling.orgId += 1;
        idents.set(ident, tableName);
      } else if (ORG_FOREIGN_KEY_RE.test(body)) {
        // THIRD ARM, and the one that closes the class rather than enumerating
        // it: a column of ANY name that declares a foreign key to
        // organizations.id is a tenant key. The marketplace tables name theirs
        // by ROLE — seller_organization_id, buyer_organization_id,
        // bidder_organization_id — so no spelling list would ever have caught
        // them, and all three sat outside this gate's population while the
        // surface they belong to was found (2026-09-03) serving every tenant's
        // investor profiles through an ungated door.
        //
        // It is an OR with the two name arms, not a replacement for them: 226
        // tables declare `organization_id` with no `.references()` at all, so
        // an FK-only predicate would SHRINK the population from 404 to 183 —
        // a widening that reads as one and is the opposite.
        orgScopedTablesBySpelling.orgForeignKey += 1;
        idents.set(ident, tableName);
      }
    }
  }
  return idents;
}

// ----------------------------------------------------------------------------
// Storage-method scanner
// ----------------------------------------------------------------------------

function findScannedFiles() {
  const files = [];
  const storageEntry = join(SERVER_DIR, "storage.ts");
  if (statSync(storageEntry, { throwIfNoEntry: false })?.isFile()) files.push(storageEntry);
  const subdir = join(SERVER_DIR, "storage");
  if (statSync(subdir, { throwIfNoEntry: false })?.isDirectory()) {
    for (const entry of readdirSync(subdir)) {
      if (!entry.endsWith(".ts")) continue;
      if (entry.endsWith(".test.ts") || entry.endsWith(".spec.ts")) continue;
      files.push(join(subdir, entry));
    }
  }
  // THE WHOLE SERVER — widened 2026-09-04, and this is the third widening in
  // this file's life for the same reason each time: the population was the
  // assumption, not the predicate.
  //
  //   2026-08-13  server/services/** joined server/storage — a service that
  //               owned its own persistence had never passed under the lint,
  //               and one was leaking KYC records across tenants.
  //   2026-08-16  the `async function` shape joined the method shape.
  //   2026-09-04  server/** — routes, jobs, middleware, ai, mcp, utils and
  //               webhookHandlers had NEVER been read. On that day an
  //               independent review found six live cross-tenant routes
  //               (6c8bd244) and two more the next (779bc251). Every one was
  //               in a file outside this walk. A gate proves its property
  //               only over the population it actually reads.
  //
  // The widening is only half the change and would have been close to
  // worthless alone: a route file's units are inline `async (req, res) => {}`
  // handlers, which neither extractor could see, so every query landed on the
  // enclosing registerRoutes(). `extractRouteHandlers` is the other half.
  //
  // EXCLUSIONS are named, not implied. Anything not listed is scanned.
  const EXCLUDED_DIRS = new Set([
    "node_modules",
    "__tests__",
    "__mocks__",
    // Generated or vendored surfaces with no hand-written queries.
    "public",
    "dist",
  ]);
  const servicesDir = SERVER_DIR;
  if (statSync(servicesDir, { throwIfNoEntry: false })?.isDirectory()) {
    const stack = [servicesDir];
    while (stack.length > 0) {
      const dir = stack.pop();
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        // throwIfNoEntry:false — a path can vanish between readdir and stat.
        const st = statSync(full, { throwIfNoEntry: false });
        if (!st) {
          vanishedDuringScan += 1;
          continue;
        }
        if (st.isDirectory()) {
          if (!EXCLUDED_DIRS.has(entry)) stack.push(full);
          continue;
        }
        if (!entry.endsWith(".ts")) continue;
        if (entry.endsWith(".test.ts") || entry.endsWith(".spec.ts")) continue;
        files.push(full);
      }
    }
  }
  return files.sort();
}

/**
 * Declarations whose BODY could not be located.
 *
 * A skip has to be LOUD. The defect this gate just fixed WAS a body silently
 * not scanned: the extractor found the wrong brace, read a return type instead
 * of a body, saw no unscoped query and reported clean. So a declaration the
 * corrected finder cannot resolve is named here and printed in the verdict —
 * a shape nobody can read is coverage this gate does not have, and it must say
 * so rather than count it as passing. Measured 0 across 910 files.
 */
const unreadableDeclarations = [];

/**
 * Routes whose handler is a BARE REFERENCE to a function declared elsewhere.
 * Not a gap — the referenced declaration is scanned under its own name by the
 * async-function extractor — but counted and printed so the hand-off is
 * visible and a sudden growth in it is noticed rather than assumed benign.
 */
const namedHandlerReferences = [];

/**
 * Extract every `async <name>(…) { … }` method from a source file as
 * { name, text (signature+body), line }.
 */
function extractAsyncMethods(source) {
  const methods = [];
  const methodRe = /\basync\s+([A-Za-z0-9_]+)\s*(?:<[^>(]*>)?\s*\(/g;
  let match;
  while ((match = methodRe.exec(source)) !== null) {
    const name = match[1];
    const parenOpen = source.indexOf("(", match.index + match[0].length - 1);
    if (parenOpen === -1) continue;
    const parenClose = matchParen(source, parenOpen);
    if (parenClose === -1) continue;
    // Walk PAST any return-type annotation to the real body brace.
    // `indexOf("{")` lands inside `): Promise<{ … }> {`, so matchBrace then
    // closed the RETURN TYPE and the body was never scanned — see
    // findBodyBrace. A -1 is a LOUD skip, recorded and printed.
    const braceOpen = findBodyBrace(source, parenClose);
    if (braceOpen === -1) {
      unreadableDeclarations.push(
        `${name} (line ${source.slice(0, match.index).split("\n").length})`,
      );
      continue;
    }
    const braceClose = matchBrace(source, braceOpen);
    if (braceClose === -1) continue;
    const text = source.slice(match.index, braceClose + 1);
    const line = source.slice(0, match.index).split("\n").length;
    methods.push({ name, text, line });
    // Resume scanning after the signature (methods can nest async callbacks —
    // we deliberately continue from the params close so inner `async (…)`
    // arrow callbacks aren't double-counted as named methods).
    methodRe.lastIndex = parenClose;
  }
  return methods;
}

/**
 * Extract every `async function <name>(…) { … }` — the FUNCTION SHAPE.
 *
 * Added 2026-08-16 (enforcement audit, GAP A). `extractAsyncMethods` above
 * keys on `async <name>(`, which is class/object-literal method syntax. A
 * plain or exported async FUNCTION is `async function <name>(` — the regex
 * sees the identifier "function", then demands `(` and finds ` <name>(`, so
 * it never matches. The result was a gate that keyed on SYNTAX rather than on
 * the rule: this ships GREEN in a file the lint already walks —
 *
 *     export async function getDeal(dealId: number) {
 *       return db.select().from(deals).where(eq(deals.id, dealId));
 *     }
 *
 * — while the semantically identical `async getDeal(dealId)` method is caught.
 * Same table, same bare id, same cross-tenant read; only the keyword differs.
 * Covers `export async function`, `export default async function`, bare
 * `async function`, and the `async function*` generator form.
 */
function extractAsyncFunctions(source) {
  const functions = [];
  const fnRe = /\basync\s+function\s*\*?\s*([A-Za-z0-9_$]+)\s*(?:<[^>(]*>)?\s*\(/g;
  let match;
  while ((match = fnRe.exec(source)) !== null) {
    const name = match[1];
    const parenOpen = source.indexOf("(", match.index + match[0].length - 1);
    if (parenOpen === -1) continue;
    const parenClose = matchParen(source, parenOpen);
    if (parenClose === -1) continue;
    // Same correction as extractAsyncMethods — this extractor had the
    // identical flaw, which is why the blind spot spanned both shapes.
    const braceOpen = findBodyBrace(source, parenClose);
    if (braceOpen === -1) {
      unreadableDeclarations.push(
        `${name} (line ${source.slice(0, match.index).split("\n").length})`,
      );
      continue;
    }
    const braceClose = matchBrace(source, braceOpen);
    if (braceClose === -1) continue;
    const text = source.slice(match.index, braceClose + 1);
    const line = source.slice(0, match.index).split("\n").length;
    functions.push({ name, text, line, start: match.index, end: braceClose + 1 });
    fnRe.lastIndex = parenClose;
  }
  return functions;
}


/**
 * Extract every INLINE ROUTE HANDLER — the third shape, and the one that made
 * the whole route layer unreadable to this gate.
 *
 * WHY IT WAS MISSING, AND WHAT IT COST. The two extractors above key on
 * `async <name>(` and `async function <name>(`. A route handler is neither:
 *
 *     api.get("/api/leads/:id", isAuthenticated, getOrCreateOrg, async (req, res) => { … })
 *
 * It is an anonymous async ARROW passed as an argument. So when this lint's
 * walk is pointed at a route file, the only unit it can see is the enclosing
 * registration function — `registerRoutes()` in server/routes.ts is 1,400+
 * lines and `registerMiscRoutes()` similar — and EVERY query in every handler
 * is attributed to that one unit. That unit mentions `organizationId`
 * somewhere, of course it does, so rule 1 can never fire and rule 2 drowns.
 * The route layer was not merely unscanned: it was unscannable.
 *
 * That is why widening the walk is not, by itself, the fix. On 2026-09-04 six
 * live cross-tenant routes were found BY HAND (commit 6c8bd244) and two more
 * the day after — every one of them in a route file, in a handler shaped
 * exactly like the line above.
 *
 * The name is the route, not a symbol: `GET /api/leads/:id`. A register entry
 * an engineer can find in ten seconds beats one naming a 1,400-line function.
 *
 * Deliberately narrow. Only `<ident>.<method>(<string literal>, … )` where the
 * final argument is an async arrow or async function expression. A handler
 * assembled some other way is NOT guessed at — it falls to the enclosing unit
 * as before, and `unreadableDeclarations` records what could not be read, the
 * same honesty the two extractors above already practise.
 */
const ROUTE_VERBS = "get|post|put|patch|delete|options|head|all";
/**
 * Start of a call's LAST TOP-LEVEL argument.
 *
 * ── WHY THE OBVIOUS RULE IS WRONG ───────────────────────────────────────────
 * This extractor's first version took "the LAST `async (` inside the call
 * text" as the handler. But the call text spans the handler's whole BODY, so
 * any nested async callback inside it — `db.transaction(async (tx) => …)`,
 * `rows.map(async (r) => …)` — is later in the string than the handler itself
 * and wins. The extracted unit then becomes the INNER callback, and every
 * query in the outer handler body is invisible to a tenant-isolation gate.
 *
 * Measured 2026-09-04: 51 of 2620 route handlers under server/ contained a
 * nested async callback, so 51 handlers were being read at the wrong
 * boundary — the exact "population the gate actually reads" failure this file
 * was widened to fix, reintroduced one level down.
 *
 * So the argument list is parsed instead of pattern-matched: walk from the
 * opening paren tracking (), [], {} depth, skipping strings, template
 * literals (including their `${}` holes) and comments, and remember where the
 * last depth-0 comma was. Everything after it is the final argument, which for
 * an Express registration is the handler and nothing else.
 *
 * Returns -1 when the scan cannot complete, which the caller must record as an
 * unreadable declaration rather than guess at.
 */
function lastTopLevelArgStart(source, callOpen, callClose) {
  let i = callOpen + 1;
  let depth = 0;
  let start = i;
  // A multi-line Express registration usually ends `},\n);` — a TRAILING
  // comma. Taking "everything after the last depth-0 comma" then yields
  // whitespace, and the handler is dropped from the population without a
  // word. 432 of 2620 registrations under server/ are written that way.
  // The previous argument boundary is kept so the trailing comma can be
  // stepped back over.
  let previous = i;
  while (i < callClose) {
    const c = source[i];
    if (c === "\\") { i += 2; continue; }
    if (c === '"' || c === "'") {
      const quote = c;
      i++;
      while (i < callClose && source[i] !== quote) i += source[i] === "\\" ? 2 : 1;
      i++;
      continue;
    }
    if (c === "`") {
      i++;
      let holes = 0;
      while (i < callClose) {
        if (source[i] === "\\") { i += 2; continue; }
        if (source[i] === "$" && source[i + 1] === "{") { holes++; i += 2; continue; }
        if (source[i] === "}" && holes > 0) { holes--; i++; continue; }
        if (source[i] === "`" && holes === 0) break;
        i++;
      }
      i++;
      continue;
    }
    if (c === "/" && source[i + 1] === "/") { while (i < callClose && source[i] !== "\n") i++; continue; }
    if (c === "/" && source[i + 1] === "*") {
      const e = source.indexOf("*/", i + 2);
      if (e === -1 || e > callClose) return -1;
      i = e + 2;
      continue;
    }
    if (c === "(" || c === "[" || c === "{") { depth++; i++; continue; }
    if (c === ")" || c === "]" || c === "}") { depth--; i++; continue; }
    if (c === "," && depth === 0) { previous = start; start = i + 1; i++; continue; }
    i++;
  }
  return source.slice(start, callClose).trim() === "" ? previous : start;
}

function extractRouteHandlers(source) {
  const handlers = [];
  const re = new RegExp(
    String.raw`\b([A-Za-z_$][\w$]*)\.(` + ROUTE_VERBS + String.raw`)\s*\(\s*(["'` + "`" + String.raw`])([^"'` + "`" + String.raw`]+)\3`,
    "g",
  );
  let match;
  while ((match = re.exec(source)) !== null) {
    const verb = match[2].toUpperCase();
    const routePath = match[4];
    // Only a path, never a mount of a router or a bare middleware.
    if (!routePath.startsWith("/")) continue;
    const callOpen = source.indexOf("(", match.index);
    const callClose = matchParen(source, callOpen);
    if (callClose === -1) {
      // The walk could not close the registration, so the handler is NOT in
      // the population. Counted, never skipped quietly — an unreadable unit
      // that nothing reports is indistinguishable from a clean one.
      unreadableDeclarations.push(
        `${verb} ${routePath} (line ${source.slice(0, match.index).split("\n").length}, call did not close)`,
      );
      continue;
    }
    // The handler is the call's LAST TOP-LEVEL argument — parsed, not
    // pattern-matched. See lastTopLevelArgStart: taking "the last `async (`
    // in the call text" picks a nested callback out of the handler's own body
    // and reads the wrong unit entirely.
    const argStart = lastTopLevelArgStart(source, callOpen, callClose);
    const line = source.slice(0, match.index).split("\n").length;
    if (argStart === -1) {
      unreadableDeclarations.push(`${verb} ${routePath} (line ${line})`);
      continue;
    }
    // Resolve the final argument to an INLINE function, unwrapping the
    // call-expression wrappers this codebase registers handlers through —
    // `asyncHandler(async (req, res) => …)` (40 routes) and
    // `withCostClass("high", async (req, res) => …)`. Without unwrapping,
    // every one of those handlers sits outside the population while the gate
    // reports a healthy route count.
    let unitStart = argStart;
    let unitEnd = callClose;
    let parenOpen = -1;
    for (let hop = 0; hop < 4; hop++) {
      const rel = source.slice(unitStart, unitEnd);
      // Sync handlers count too: an unawaited `db.select()` chain or a
      // `.then()` is as much a cross-tenant read as an awaited one, and
      // "it wasn't async" is not a property this gate should depend on.
      const inline = /^\s*(?:async\s*)?(?:function\s*\*?\s*[A-Za-z0-9_$]*\s*)?\(/.exec(rel);
      if (inline) { parenOpen = unitStart + inline[0].length - 1; break; }
      const wrap = /^\s*[A-Za-z_$][\w$]*\s*\(/.exec(rel);
      if (!wrap) break;
      const wrapOpen = unitStart + wrap[0].length - 1;
      const wrapClose = matchParen(source, wrapOpen);
      if (wrapClose === -1) break;
      const inner = lastTopLevelArgStart(source, wrapOpen, wrapClose);
      if (inner === -1) break;
      unitStart = inner;
      unitEnd = wrapClose;
    }
    if (parenOpen === -1) {
      // The final argument is a BARE REFERENCE to a handler declared
      // elsewhere (`router.get("/metrics", metricsHandler)`). That declaration
      // is read by the async-function extractor under its own name, so this is
      // a deliberate hand-off, not a gap — counted so the hand-off stays
      // visible and a growing number is noticed.
      namedHandlerReferences.push(`${verb} ${routePath} (line ${line})`);
      continue;
    }
    const parenClose = matchParen(source, parenOpen);
    if (parenClose === -1) {
      unreadableDeclarations.push(`${verb} ${routePath} (line ${line})`);
      continue;
    }
    const absolute = unitStart;
    const braceOpen = findBodyBrace(source, parenClose);
    let text;
    if (braceOpen === -1) {
      // An expression-bodied arrow (`(_req, res) => Errors.gone(res, …)`) has
      // no block, but it still has a body — read it to the end of the unit
      // rather than dropping it.
      if (/^\s*(?::[^=]*)?=>\s*[^{\s]/.test(source.slice(parenClose + 1, unitEnd))) {
        text = source.slice(absolute, unitEnd);
      } else {
        unreadableDeclarations.push(`${verb} ${routePath} (line ${line})`);
        continue;
      }
    } else {
      const braceClose = matchBrace(source, braceOpen);
      if (braceClose === -1) {
        unreadableDeclarations.push(`${verb} ${routePath} (line ${line})`);
        continue;
      }
      text = source.slice(absolute, braceClose + 1);
    }
    handlers.push({ name: `${verb} ${routePath}`, text, line, start: absolute, end: absolute + text.length });
    re.lastIndex = callOpen;
  }
  return handlers;
}


/**
 * Find the brace that opens a FUNCTION BODY, skipping a return-type annotation.
 *
 * THE BLIND SPOT THIS EXISTS TO MEASURE. Both extractors above locate a body
 * with `source.indexOf("{", parenClose)`. When the declaration carries an
 * INLINE OBJECT RETURN TYPE —
 *
 *     export async function getSummary(id: number): Promise<{ total: number }> {
 *
 * — the first `{` after the parameters is the one inside `Promise<`, not the
 * body. `matchBrace` then closes the RETURN TYPE, so the extracted unit text is
 * the signature plus the type, the body is never scanned, and every query
 * inside it is invisible to a TENANT-ISOLATION gate. The `[;=]` guard does not
 * catch it, because a return-type annotation contains neither.
 *
 * Measured 2026-08-17: 348 `async function` declarations under server/ match
 * `): Promise<{`, and the flaw is at BOTH extraction sites, so methods are
 * affected too.
 *
 * This walks the annotation, tracking `<>`, `()` and `[]` depth and skipping
 * string literals, and returns the first `{` seen at depth 0 — the body. It
 * returns -1 when it cannot tell, which the caller must treat as a LOUD skip
 * rather than a silent one; refusing to guess is the whole point, since a
 * mis-identified body is exactly the defect being fixed.
 */
function findBodyBrace(source, parenClose) {
  let i = parenClose + 1;
  let angle = 0;
  let paren = 0;
  let square = 0;
  while (i < source.length) {
    const c = source[i];
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      i++;
      while (i < source.length) {
        if (source[i] === "\\") { i += 2; continue; }
        if (source[i] === quote) break;
        i++;
      }
      i++;
      continue;
    }
    if (c === "/" && source[i + 1] === "/") { while (i < source.length && source[i] !== "\n") i++; continue; }
    if (c === "/" && source[i + 1] === "*") { const e = source.indexOf("*/", i + 2); if (e === -1) return -1; i = e + 2; continue; }
    if (c === "<") { angle++; i++; continue; }
    if (c === ">") { if (angle > 0) angle--; i++; continue; }
    if (c === "(") { paren++; i++; continue; }
    if (c === ")") { if (paren > 0) paren--; i++; continue; }
    if (c === "[") { square++; i++; continue; }
    if (c === "]") { if (square > 0) square--; i++; continue; }
    if (c === "{") {
      if (angle === 0 && paren === 0 && square === 0) return i;
      // A brace inside a type annotation — skip its whole balanced block.
      const close = matchBrace(source, i);
      if (close === -1) return -1;
      i = close + 1;
      continue;
    }
    // `=>` is part of a FUNCTION TYPE in the annotation, not an assignment.
    // Consuming it as a unit matters twice: the bare `=` bail below would
    // otherwise refuse the whole declaration, and letting the `>` fall through
    // to the `>` arm would decrement angle depth that no `<` ever opened —
    // after which the annotation's real closing `>` drives depth negative and
    // the body brace is found at the wrong nesting.
    // Measured on server/services/autopilot/operator.ts:198, whose return type
    // is `Promise<((prompt: string) => Promise<string>) | null>`.
    if (c === "=" && source[i + 1] === ">") { i += 2; continue; }
    if (c === ";" || c === "=") return -1; // ran off the declaration
    i++;
  }
  return -1;
}

// Role-QUALIFIED org identifiers count as naming the organization: the
// marketplace tables key on `sellerOrganizationId`, `buyerOrganizationId` and
// `bidderOrganizationId`, and a case-sensitive `organizationId` matches none of
// them — so a chain predicated on exactly the right column read as orgless the
// moment those tables entered the population (2026-09-04). An identifier
// ending in OrganizationId / OrgId is an organization reference by
// construction; nothing else in this codebase is spelled that way.
const ORG_CONTEXT_RE = /[Oo]rganizationId|[Oo]rgId|forOrg\s*\(|unscopedForPlatformOps\s*\(/;

/**
 * RULE 2 — "has an org and does not use it".
 *
 * Rule 1 asks whether a method MENTIONS an organization. That is the right
 * question for a method with no org at all, and it is blind to the shape units
 * 56–60 kept finding: a method that ACCEPTS an organizationId and then resolves
 * an org-scoped table by primary key anyway.
 *
 * The worst instance was `cashFlowForecaster.generateForecast(organizationId,
 * params)` — scoped signature, and five internal calls that dropped the org, so
 * a noteId from another org in the request body forecast that org's note
 * through a front door whose type said it was safe. Rule 1 passed it.
 *
 * The check: inside a method that has org context, every `where(eq(<table>.id,
 * …))` on an org-scoped table must also constrain `organizationId`. Whitespace
 * tolerant, and it looks at the WHOLE where() call, so
 * `where(and(eq(t.id, x), eq(t.organizationId, o)))` is fine.
 */
// TWO SPELLINGS OF `where`, and until 2026-09-04 this matched one.
//
// The classic builder writes `.where(eq(t.id, x))` — a CALL. Drizzle's
// relational API writes `{ where: eq(t.id, x) }` — a PROPERTY. This regex
// required the parenthesis, so every relational by-primary-key read was
// invisible to rule 2.
//
// That mattered more than a missing spelling usually does, because of how rule
// 3 is drawn: it deliberately SKIPS any chain containing `eq(<table>.id,` on
// the grounds that "primary-key resolution belongs to rule 2" (see the (b)
// discriminator). So a relational by-id read fell BETWEEN the two rules —
// excluded by rule 3 as rule 2's job, and unreadable by rule 2 for want of a
// bracket. It is the single most dangerous shape in this codebase (a
// caller-supplied id resolving a row by primary key with no organization
// predicate), and neither rule could see it.
//
// FOUND BY FALSIFYING A FIX, which is the only way it could have been found.
// negotiationOrchestrator's AI tool handler resolved a property by a
// MODEL-SUPPLIED id; after scoping it, the mutation that put the defect back
// left the gate GREEN. Its register entry had covered that chain only
// incidentally — a second, non-id chain in the same unit — so when that one was
// scoped the entry went stale and took the by-id chain's only coverage with it.
//
// Measured 2026-09-04: 1,069 call-spelling reads the gate could already see,
// and 79 relational ones it never could.
const LONE_ID_WHERE = /where\s*[(:]\s*eq\(\s*([A-Za-z0-9_]+)\s*\.\s*id\s*,[^)]*\)\s*,?\s*\)?/g;

/**
 * `const owned = eq(t.id, x)` … `.where(owned)`.
 *
 * Hoisting the predicate into a local is GOOD practice — one expression, two
 * call sites, guaranteed identical — and it made the check above blind, because
 * the text at the `where()` is an identifier. Found by mutation-testing the
 * rule against a fix that had just been written in exactly that style, which is
 * the argument for mutating your own work rather than only the code you are
 * accusing.
 *
 * Single assignment only: no reassignment tracking, no scopes. A predicate
 * built conditionally is out of reach and stays out of reach — this reports
 * what it can see and never guesses.
 */
const HOISTED_LONE_ID = /(?:const|let)\s+([A-Za-z0-9_]+)\s*=\s*eq\(\s*([A-Za-z0-9_]+)\s*\.\s*id\s*,[^)]*\)\s*;/g;

/**
 * Sanctioned-root exemption for rule 2, added 2026-09-04 for the same reason
 * rule 3 got one on 2026-08-31 — and found the same way: writing a cross-org
 * read in the ONE form the codebase sanctions made the gate fire.
 *
 * `unscopedForPlatformOps(reason)` is deliberately loud: it takes a >=12-char
 * reason, logs every use, and greps in one line. Rule 1 already accepts it as
 * org context (ORG_CONTEXT_RE) and rule 3 already skips chains rooted in it.
 * Rule 2 did not, so a hatch call resolving a row by id — which is precisely
 * what a platform-op id-collision probe does — was reported as "has an org and
 * resolves by id anyway". That is a true statement about the text and a false
 * one about the defect: rule 2 exists to catch a *scoped-looking* signature
 * that silently crosses tenants, and this signature is the opposite of quiet.
 *
 * The exemption is CHAIN-scoped, not unit-scoped: it looks back only to the
 * enclosing statement's boundary. A unit that calls the hatch once and also
 * runs a plain `db.select()...where(eq(t.id, x))` still fails rule 2 on the
 * plain one — see the canary fixture, which pins exactly that.
 */
/**
 * The start of the statement containing `index` — the offset just after the
 * last `;` that is real CODE rather than text inside a string.
 *
 * `lastIndexOf(";", index)` cannot tell a statement terminator from a semicolon
 * inside a string literal, and the difference is not academic here. The
 * sanctioned hatch takes a REASON SENTENCE, and a reason that contains a
 * semicolon —
 *
 *   unscopedForPlatformOps(
 *     "daily referral maturity sweep resolves each referrer's own organization
 *      from their user id; there is no caller org to scope by",
 *   ).select(...).from(teamMembers)
 *
 * — moved the "statement start" INTO the reason, so the lookback below never
 * reached the call and rule 3 flagged the very form the hatch exists to
 * satisfy. Silent, and in the direction that looks like a finding.
 *
 * Scanning forward with string and template awareness is the only version that
 * is right; walking backwards cannot know whether a quote opens or closes.
 */
function statementStart(text, index) {
  let start = 0;
  let i = 0;
  while (i < index) {
    const c = text[i];
    if (c === "\\") { i += 2; continue; }
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      i += 1;
      while (i < index) {
        if (text[i] === "\\") { i += 2; continue; }
        if (text[i] === quote) break;
        i += 1;
      }
      i += 1;
      continue;
    }
    if (c === ";") start = i + 1;
    i += 1;
  }
  return start;
}

function rootedInSanctionedHatch(methodText, index) {
  const stmtStart = statementStart(methodText, index);
  return methodText.slice(stmtStart, index).includes("unscopedForPlatformOps(");
}

/** Count of lone-id predicates skipped by the hatch exemption, for the floor. */
let hatchExemptedLoneIds = 0;
function loneIdPredicates(methodText, orgScopedIdents) {
  const hits = [];
  LONE_ID_WHERE.lastIndex = 0;
  let m;
  while ((m = LONE_ID_WHERE.exec(methodText)) !== null) {
    if (!orgScopedIdents.has(m[1])) continue;
    if (rootedInSanctionedHatch(methodText, m.index)) {
      hatchExemptedLoneIds += 1;
      continue;
    }
    hits.push(m[1]);
  }
  HOISTED_LONE_ID.lastIndex = 0;
  let h;
  while ((h = HOISTED_LONE_ID.exec(methodText)) !== null) {
    const [, varName, table] = h;
    if (!orgScopedIdents.has(table)) continue;
    // The hoisted case hangs the predicate off a variable, so the hatch — if
    // there is one — sits on the QUERY statement, not the `const`. Judge the
    // use site.
    const useRe = new RegExp(`where\\(\\s*${varName}\\s*\\)`);
    const use = useRe.exec(methodText);
    if (!use) continue;
    if (rootedInSanctionedHatch(methodText, use.index)) {
      hatchExemptedLoneIds += 1;
      continue;
    }
    hits.push(table);
  }
  return hits;
}


/**
 * RULE 3 — "the UNIT is scoped, this QUERY is not".
 *
 * Rules 1 and 2 judge a unit. Rule 1 asks whether it mentions an org; rule 2
 * asks whether a unit that has one uses it on primary-key lookups. Both are
 * blind to the shape that produced a LIVE cross-tenant read on 2026-08-18:
 *
 *   generateDealFeed(orgId)                     // org-scoped six other ways
 *     …
 *     await db.select().from(properties)        // <- no org predicate
 *       .where(and(LOWER(state) = …, LOWER(county) = …))
 *
 * `properties.organization_id` is NOT NULL with a cascade FK, so that query
 * returned every organization's parcels in the target counties, and the feed
 * persisted them into the READING org's `daily_deal_feed` — APN, address,
 * coordinates, assessed value, tax-delinquency signals.
 *
 * Rule 1 passed because `organizationId` appears elsewhere in the function.
 * Rule 2 passed because the query does not resolve by primary key. The gate's
 * blind spot is therefore not "unscoped functions" but "unscoped QUERIES in
 * scoped functions" — which gets strictly MORE likely as a codebase gets more
 * correct, because every fix that adds an org predicate somewhere in a function
 * pushes the rest of that function out of rule 1's view.
 *
 * The check walks each `.from(<org-scoped table>)` CHAIN — from `.from(` to the
 * statement's terminating `;` at paren depth 0 — and asks whether THAT chain
 * names the org.
 *
 * Four discriminators, each for a family verified by hand across the 361 raw
 * chains this finds, so the register holds cases worth reading rather than a
 * wall of noise:
 *
 *   (a) the enclosing unit must HAVE an org — a unit with none is rule 1's job;
 *   (b) the chain must not resolve by primary key — `eq(t.id, x)` is rule 2's
 *       job, and is routinely verified by a guard query above it;
 *   (c) founder / platform / admin / telemetry / migration paths are excluded,
 *       because a platform-wide read is the POINT there;
 *   (d) chains whose predicate is a hoisted variable are not reachable by text
 *       and are not guessed at — see HOISTED_LONE_ID for the same limitation
 *       stated honestly rather than papered over.
 *
 * The remaining entries are mostly legitimate and are recorded as such: a
 * verified-parent join (`offers.batchId` after the batch was org-checked), a
 * deliberately all-org sweep that then loops per org, a frozen cross-org
 * marketplace. The register exists so a NEW one has to be looked at, and so the
 * count can only shrink.
 */
/**
 * THE ROUTE-WIDENING DEBT REGISTER — scripts/org-scope-route-widening.json.
 *
 * Kept in a separate FILE, deliberately. Every key in the registers above was
 * read by a human and carries a recorded reason; the 210 keys in that file
 * were surfaced in one stroke on 2026-09-04 by widening the walk to the whole
 * server AND teaching this lint the inline route-handler shape, and NONE of
 * them has been cleared. Mixing the two would quietly convert "verified safe"
 * into "has been seen by a regex".
 *
 * It may only shrink, it excuses nothing new, and its own header states the
 * obligation. See the file.
 */
const ROUTE_WIDENING = JSON.parse(
  readFileSync(join(__dirname, "org-scope-route-widening.json"), "utf8"),
);
const WIDENING_RULE1 = new Set([
  ...ROUTE_WIDENING.rule1.method,
  ...ROUTE_WIDENING.rule1.function,
  ...ROUTE_WIDENING.rule1.route,
]);
const WIDENING_RULE2 = new Set([
  ...ROUTE_WIDENING.rule2.method,
  ...ROUTE_WIDENING.rule2.function,
  ...ROUTE_WIDENING.rule2.route,
]);
const WIDENING_RULE3 = new Set(ROUTE_WIDENING.rule3);

/**
 * How many held keys carry an individual, hand-written reason in `_TRIAGED`.
 *
 * Counted against the held sets rather than taken from the file's own header,
 * so a reason left behind for a key that has since been fixed or deleted does
 * not inflate the number. "Read" has to mean read, or the line is worse than
 * not printing it.
 */
/**
 * A note that says it is UNREAD does not count as read.
 *
 * The predicate above was "a `_TRIAGED` key exists", which is presence of
 * DOCUMENTATION rather than presence of a RULING — and on 2026-09-05 two of the
 * notes it counted opened with the words "UNREAD as of 2026-09-04". The verdict
 * line printed "272 read, 0 NOT read" over them, which is the failure this
 * block's own comment warns about, committed by the code the comment sits on.
 *
 * It is the fourth law in its purest form: the gate read its own documentation
 * as the property. The fix is not a longer comment — it is to make the note say
 * something the predicate can be wrong about.
 */
const declaresItselfUnread = (note) => /\bUNREAD\b/.test(String(note ?? ""));

const wideningTriagedCount = Object.entries(ROUTE_WIDENING._TRIAGED ?? {}).filter(
  ([k, note]) =>
    (WIDENING_RULE1.has(k) || WIDENING_RULE2.has(k) || WIDENING_RULE3.has(k)) &&
    !declaresItselfUnread(note),
).length;
/** Keys actually seen this run, so a stale (fixed) entry can be reported. */
const wideningSeen = new Set();

const RULE3_BASELINE = new Set([
  // leaseExpiryDetector::rentalLeases and notePaymentDueDetector::notes were
  // REMOVED 2026-09-04 — fixed, not re-baselined. Both are daily SCHEDULED
  // PLATFORM JOBS that sweep every organization's leases/notes and publish a
  // per-org mesh event per finding, so a per-org predicate would make them scan
  // nothing. They now say that through unscopedForPlatformOps(reason) instead of
  // reading as forgotten predicates, and the gate reported these entries stale
  // on the next run — which is the register confirming the change.
  "server/services/achAutopay.ts::postReversal::payments",
  "server/services/achAutopay.ts::postSettlement::payments",
  "server/services/achMandateSetup.ts::confirmAchMandateSetup::achMandates",
  "server/services/achMandateSetup.ts::startAchMandateSetup::achMandates",
  "server/services/agentLlmTraces.ts::listRecentTraces::agentLlmTraces",
  "server/services/agentOrchestration.ts::addStep::agentSessionSteps",
  "server/services/agentOrchestration.ts::executeStep::agentSessionSteps",
  "server/services/agentPromotionGate.ts::canPromoteToLive::agentTasks",
  "server/services/alerting.ts::getAlerts::systemAlerts",
  "server/services/autonomyFinalMile.ts::checkDelegationCompletions::agentEvents",
  "server/services/autonomyFinalMile.ts::retryFailedActions::agentEvents",
  "server/services/autonomyHealth.ts::gradeRecentDecisions::decisionsInboxItems",
  "server/services/autopilot/attribution.ts::attributeSignup::marketingTouch",
  "server/services/autopilot/hands/counterpartyMatch.ts::counterpartyMatch::buyerReservations",
  "server/services/buyerMatchingAI.ts::matchBuyerToProperties::buyerPropertyMatches",
  "server/services/buyerMatchingAI.ts::matchPropertyToBuyers::buyerPropertyMatches",
  "server/services/cashFlowForecaster.ts::analyzePaymentHealth::payments",
  "server/services/cashFlowForecaster.ts::compareActualVsProjected::payments",
  "server/services/comms/tracking-pool.ts::assignTrackingNumberForMailShipment::trackingNumberAssignments",
  "server/services/comms/tracking-pool.ts::attributeInbound::trackingNumberAssignments",
  "server/services/creditPool.ts::poolDebit::financialLedger",
  "server/services/customerNarrative.ts::deliverAllPendingLettersForMonth::customerLetters",
  "server/services/dataNetworkVisibility.ts::getCountyIntelligenceOverview::properties",
  "server/services/digest.ts::getSubscriptionsNeedingDigest::digestSubscriptions",
  "server/services/disclosureTimingDispatcher.ts::runDisclosureTimingDispatch::disclosureTimingScheduled",
  "server/services/emailSuppressions.ts::recordSoftBounce::emailSuppressions",
  "server/services/expansionRadar.ts::runWeeklyExpansionScan::expansionCandidates",
  "server/services/externalStatusMonitor.ts::notifyUsersOfOutage::systemAlerts",
  "server/services/financial-ledger.ts::postRefund::financialLedger",
  "server/services/financial-ledger.ts::postRevenue::financialLedger",
  "server/services/form1098Batch.ts::collectAcquiredCandidates::notePayments",
  "server/services/form1098Batch.ts::collectOriginatedCandidates::payments",
  "server/services/gdprService.ts::anonymizeUser::leads",
  "server/services/gdprService.ts::anonymizeUser::teamMembers",
  "server/services/lateFees/index.ts::assessLateFee::lateFeeAssessments",
  "server/services/lateFees/index.ts::assessLateFee::paymentApplications",
  "server/services/lcsCalibrator.ts::runLcsCalibrationSweep::deals",
  "server/services/leadScoreDecay.ts::processLeadScoreDecay::leads",
  "server/services/leadScoring.ts::scoreLead::leadScoreHistory",
  "server/services/lifecycleProgram.ts::verifyReactivationToken::reactivationTokens",
  "server/services/offerBatchService.ts::getBatchStatus::offers",
  "server/services/onboarding/firstValueInstrumentation.ts::computeFunnelMetrics::lifecycleEvents",
  "server/services/onboardingAutonomy.ts::listJourneys::onboardingJourneys",
  "server/services/outcomeLedger.ts::scoreDueCheckIns::decisionsInboxItems",
  "server/services/paymentApplication/index.ts::applyPayment::suspenseBalances",
  "server/services/periodicStatements/index.ts::generateOneAcquiredStatement::paymentApplications",
  "server/services/periodicStatements/index.ts::generateOneAcquiredStatement::periodicStatements",
  "server/services/periodicStatements/index.ts::generateOneStatement::periodicStatements",
  "server/services/portfolioOptimizer.ts::analyzeDiversification::properties",
  "server/services/portfolioSentinel.ts::checkCompetitorActivity::marketMetrics",
  "server/services/portfolioSentinel.ts::checkMarketChanges::marketMetrics",
  "server/services/proactiveMonitor.ts::getActiveAlerts::systemAlerts",
  "server/services/propertyVisionReimaging.ts::findPropertiesDueForReimaging::properties",
  "server/services/propertyVisionReimaging.ts::reimageProperty::propertyVisionSnapshots",
  "server/services/realtimeAlerts.ts::syncDealAlertsToWebSocket::dealAlerts",
  "server/services/recognitionWorker.ts::runRecognitionTick::recognitionSchedules",
  "server/services/recourseDrafter.ts::collectRecourseSignals::cancellationSurveys",
  "server/services/recourseDrafter.ts::collectRecourseSignals::supportCases",
  "server/services/recourseDrafter.ts::collectRecourseSignals::systemAlerts",
  "server/services/rental/leaseSigningPacket.ts::getLeaseSignatureStatus::signingConsentAudit",
  "server/services/revenueRecognition.ts::getPeriodTotals::revenueRecognitionPeriods",
  "server/services/selfAssessmentAgent.ts::analyzeToolFailures::agentTasks",
  "server/services/sellerIntentPredictor.ts::getLeadMessageContent::messages",
  "server/services/unsubscribeTokens.ts::resolveToken::unsubscribeTokens",
  "server/storage.ts::getSubscriptionEvents::subscriptionEvents",
  "server/storage/leadRepo.ts::getLeadsCursor::leads",
  "server/storage/paymentRemindersRepo.ts::findLadderReminder::paymentReminders",
  "server/storage/paymentRemindersRepo.ts::getDispatchableReminders::paymentReminders",
  "server/storage/paymentRemindersRepo.ts::getOrganizationIdsWithActiveNotes::notes",
  "server/storage/supportOpsRepo.ts::getSystemAlerts::systemAlerts",
]);

/**
 * Every query CHAIN in a unit, in both of Drizzle's spellings.
 *
 * ── THE SECOND SPELLING ─────────────────────────────────────────────────────
 * This walked `.from(<table>)` and nothing else. Drizzle's RELATIONAL query
 * API — `db.query.<table>.findMany({ where: … })` — has no `.from(`, so every
 * one of its call sites was outside the population this gate reads. Measured
 * 2026-09-04: 280 of them under server/, roughly a seventh of the query
 * surface, invisible to rule 3 in a gate whose entire subject is tenant
 * isolation. The org-scope lint's own blind spot, in the shape CLAUDE.md's
 * third law describes: the rule was right, the population was a regex.
 *
 * `db.query.<key>` keys on the SCHEMA EXPORT NAME, the same identifier
 * `orgScopedIdents` holds, so the two spellings share one table set and one
 * predicate. Only the entry point differs.
 */
function queryChainsFrom(unitText, orgScopedIdents) {
  const chains = [];
  // `.from(leads)` and `db.query.leads.findMany(`/`.findFirst(` — group 1 is
  // the table identifier in both, so the body below is shared.
  const re =
    /\.from\(\s*([A-Za-z0-9_]+)\s*\)|\b(?:db|tx)\s*\.\s*query\s*\.\s*([A-Za-z0-9_]+)\s*\.\s*(?:findMany|findFirst)\s*\(/g;
  let m;
  while ((m = re.exec(unitText)) !== null) {
    const table = m[1] ?? m[2];
    if (!orgScopedIdents.has(table)) continue;
    // Sanctioned-root exemption (2026-08-31): a chain whose ROOT is
    // unscopedForPlatformOps(...) is the explicit, logged, greppable escape
    // hatch — rules 1/2 already treat that token as satisfying org context,
    // but this slicer starts at `.from(` and could not see the root, so the
    // hatch's OWN presence made the unit "org-having" for rule 3 while the
    // chain text stayed orgless: using the sanctioned form tripped the gate
    // the form exists to satisfy. Look back to the chain's start (the
    // previous statement boundary) and skip chains rooted in the hatch.
    // A plain db.select() in the same unit still answers to rule 3.
    const stmtStart = statementStart(unitText, m.index);
    if (unitText.slice(stmtStart, m.index).includes("unscopedForPlatformOps(")) continue;
    let depth = 0;
    let end = -1;
    for (let j = m.index; j < unitText.length; j++) {
      const ch = unitText[j];
      if (ch === "(") depth += 1;
      else if (ch === ")") depth -= 1;
      else if (ch === ";" && depth <= 0) { end = j; break; }
    }
    if (end === -1) end = unitText.length;
    chains.push({ table, text: unitText.slice(m.index, end) });
  }
  return chains;
}

const RULE3_EXCLUDED_PATH = /founder|platform|admin|telemetry|migration|backfill/i;

/**
 * The chain text PLUS any local predicate list it spreads in.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * `queryChainsFrom` slices a chain from `.from(table)` to its terminating `;`,
 * and rule 3 then tests THAT TEXT for an organization token. The single most
 * common way this repo builds a query is:
 *
 *     const conditions = [eq(leads.organizationId, orgId)];
 *     if (filters?.assignedTo) conditions.push(eq(leads.assignedTo, …));
 *     await db.select().from(leads).where(and(...conditions))
 *
 * The org predicate is right there and the chain text cannot see it, because it
 * lives in a variable declared several lines earlier. Measured 2026-08-20 during
 * the rule-3 adjudication: **roughly 40 of the 120 baselined entries were this
 * shape** — `leadRepo.getLeads`, `auditRepo.getAuditLogs`,
 * `automationRepo.getNotifications`, `vaRepo.getVaActions` and ~36 more. All
 * correctly scoped, all reported as offenders.
 *
 * That is worth fixing for two reasons, and the second is the important one: the
 * baseline overstated real tenancy debt by a third, AND a reader working the
 * list met false positives one time in three, which is how a security list stops
 * being read. A gate whose findings are mostly noise trains people to skim it.
 *
 * ── WHY THIS DOES NOT WEAKEN THE RULE ───────────────────────────────────────
 * It does not lower the bar; it applies the SAME bar to text the chain
 * demonstrably uses. `ORG_CONTEXT_RE` is unchanged, and it was never
 * table-specific — an inline `.where(eq(leads.organizationId, orgId))` passes on
 * exactly the token match used here. A predicate list is only consulted when the
 * chain actually spreads it (`...ident`), and only that identifier's own
 * declaration and `.push(` calls are read. A `conditions` array that does NOT
 * carry an org predicate still fails, which is the case
 * `orgScopedFetchCoverage.test.ts` pins with a fixture.
 */
function chainScopeText(chain, unitText, depth = 0) {
  let text = chain.text;
  if (depth > 3) return text;
  // TWO UNAMBIGUOUS SHAPES ONLY, and the restriction is what keeps this safe.
  //
  //   `.where(and(...conditions))`  → the spread
  //   `.where(whereClause)`         → the whole clause held in one variable
  //
  // Both mean "this identifier IS the predicate". Resolving ARBITRARY
  // identifiers in the chain would pull in `eq`, `and` and the table name and
  // drag unrelated text into the org-token test, which is how a scoping gate
  // quietly starts passing everything. `leadRepo.getLeadsPaginated` is the
  // second shape: `const whereClause = conditions.length ? and(...conditions) : …`,
  // which is also why this recurses — one variable holds the clause, another
  // holds the predicate list.
  const idents = new Set([
    ...[...chain.text.matchAll(/\.\.\.\s*([A-Za-z0-9_$]+)/g)].map((m) => m[1]),
    ...[...chain.text.matchAll(/\.\s*where\s*\(\s*([A-Za-z0-9_$]+)\s*\)/g)].map((m) => m[1]),
    // Drizzle's RELATIONAL form names its predicate as an object PROPERTY —
    // `findMany({ where: conditions })` — not as a `.where(conditions)` call,
    // so the line above could not see it. complianceAI.getAlertsForOrganization
    // builds `const where = status ? and(eq(org…), eq(status…)) : eq(org…)` and
    // was reported as unscoped on its own correct predicate (2026-09-04). A
    // gate whose findings are mostly noise trains people to skim it, which
    // this file's own header says in as many words.
    ...[...chain.text.matchAll(/\bwhere\s*:\s*([A-Za-z0-9_$]+)\s*[,}]/g)].map((m) => m[1]),
    // …and the shorthand `{ where }`, where the identifier IS `where`.
    ...[...chain.text.matchAll(/\{\s*where\s*[,}]/g)].map(() => "where"),
  ]);
  for (const ident of idents) {
    // The declaration's initializer, sliced with balanced brackets so a nested
    // array or call cannot terminate it early — the truncating-reader defect
    // this repo has now hit five times.
    const declRe = new RegExp(
      `\\b(?:const|let|var)\\s+${ident}\\s*(?::[^=\n]*)?=\\s*`,
    );
    const dm = declRe.exec(unitText);
    if (dm) {
      // To the STATEMENT's end, not to the first balanced group.
      //
      // This used to stop the moment a bracket group closed at depth 0, which
      // is right for `const conditions = [ … ];` and wrong for a ternary chain:
      //
      //     const where = orgId && status ? and(eq(org…), eq(status…))
      //                 : orgId ? eq(org…)
      //                 : status ? eq(status…)
      //                 : undefined;
      //
      // it truncated at the closing paren of the FIRST `and(…)`, so the
      // `: undefined` arm — the one that makes the query cross-org whenever the
      // optional organizationId is omitted — was never read, and the initializer
      // looked unconditionally scoped. The same truncating-reader defect this
      // repo has now hit six times, in the reader written to avoid it.
      let i = dm.index + dm[0].length;
      let depth = 0;
      for (; i < unitText.length; i++) {
        const ch = unitText[i];
        if (ch === "[" || ch === "(" || ch === "{") depth += 1;
        else if (ch === "]" || ch === ")" || ch === "}") depth -= 1;
        else if (ch === ";" && depth <= 0) break;
      }
      const initializer = unitText.slice(dm.index, i);
      // A predicate that can be `undefined` is not a predicate.
      //
      // Following a `where` variable was added the same day and immediately
      // certified two queries that are cross-org at runtime:
      //
      //     const where = organizationId && status ? and(eq(org…), eq(status…))
      //                 : organizationId ? eq(org…)
      //                 : status ? eq(status…)
      //                 : undefined;
      //     db.query.noteSecurities.findMany({ where })
      //
      // `organizationId?: number` is optional, and `findMany({ where: undefined })`
      // reads every organization's rows. The org token IS in the initializer, so
      // crediting it made the widening produce a FALSE NEGATIVE — the first law's
      // failure inside a change meant to remove one. An initializer with an
      // `undefined` branch is not credited; the query answers to rule 3 as if the
      // variable were not there.
      if (!/\bundefined\b/.test(initializer)) text += "\n" + initializer;
      // Transitive: the clause variable's initializer may itself name the list.
      if (/\.\.\.\s*[A-Za-z0-9_$]+/.test(initializer)) {
        text += "\n" + chainScopeText({ text: initializer }, unitText, depth + 1);
      }
    }
    // …and every `ident.push(…)`, because the org predicate is sometimes pushed
    // conditionally rather than declared inline.
    const pushRe = new RegExp(`\\b${ident}\\s*\\.\\s*push\\s*\\(`, "g");
    let pm;
    while ((pm = pushRe.exec(unitText)) !== null) {
      const open = unitText.indexOf("(", pm.index + pm[0].length - 1);
      const close = matchParen(unitText, open);
      if (close === -1) continue;
      text += "\n" + unitText.slice(pm.index, close + 1);
    }
  }
  return text;
}

function unscopedChains(unitText, orgScopedIdents, rel) {
  if (RULE3_EXCLUDED_PATH.test(rel)) return [];
  const out = [];
  for (const chain of queryChainsFrom(unitText, orgScopedIdents)) {
    if (ORG_CONTEXT_RE.test(chainScopeText(chain, unitText))) continue;
    // (b) primary-key resolution belongs to rule 2.
    if (new RegExp(`eq\\(\\s*${chain.table}\\.id\\s*,`).test(chain.text)) continue;
    out.push(chain.table);
  }
  return out;
}

function touchedOrgScopedTables(methodText, orgScopedIdents) {
  const touched = new Set();
  const accessRe = /\b(?:from|(?:db|tx)\s*\.\s*update|(?:db|tx)\s*\.\s*delete)\s*\(\s*([A-Za-z0-9_]+)\s*[),]/g;
  let m;
  while ((m = accessRe.exec(methodText)) !== null) {
    const ident = m[1];
    if (orgScopedIdents.has(ident)) touched.add(ident);
  }
  // Drizzle's RELATIONAL query API, which has no `.from(` and so was invisible
  // to this predicate — and therefore to ALL THREE rules, because a unit that
  // "touches no org-scoped table" is skipped before any of them run. Measured
  // 2026-09-04: 280 `db.query.<table>.findMany` / `.findFirst` call sites
  // under server/. The table key is the schema export name, the same
  // identifier `orgScopedIdents` holds.
  const relationalRe =
    /\b(?:db|tx)\s*\.\s*query\s*\.\s*([A-Za-z0-9_]+)\s*\.\s*(?:findMany|findFirst)\s*\(/g;
  while ((m = relationalRe.exec(methodText)) !== null) {
    const ident = m[1];
    if (orgScopedIdents.has(ident)) touched.add(ident);
  }
  return [...touched];
}

// ----------------------------------------------------------------------------
// Main
// ----------------------------------------------------------------------------

/**
 * `--blind-spot`: how many declarations a NAIVE body-finder would mis-read.
 *
 * REWRITTEN 2026-08-17, and the change of meaning is the point. This flag was
 * built to measure a hole that was OPEN: the extractors located a body with
 * `indexOf("{", parenClose)`, which lands inside an inline
 * `): Promise<{ … }> {` return type, so 335 bodies were never scanned and the
 * gate reported them clean. The verdict was deliberately left untouched then,
 * because fixing the extractor re-baselines four frozen registers and raising a
 * baseline here needs sign-off.
 *
 * That sign-off was given (OD-3), the extractors now use `findBodyBrace`, and
 * the registers were re-seeded once with a hand-verified sample. So this no
 * longer measures a live blind spot — it measures the COST OF REGRESSING to the
 * naive finder, which is why it is kept rather than deleted. The number it
 * prints is what would go unscanned again if someone "simplified"
 * `findBodyBrace` back to an `indexOf`.
 *
 * The gate's own coverage claim now lives in the verdict instead: every run
 * prints "declarations whose body could not be located", including the zero.
 */
function reportBlindSpot() {
  const files = findScannedFiles();
  // Two separate populations, each with its OWN list. An earlier version of
  // this function printed one sampled list under the other's count, so eight
  // names appeared beneath the number 1 — a report that misattributes its own
  // evidence is worse than one that prints no evidence at all.
  const misExtracted = [];
  const unparseable = [];
  const fnRe = /\basync\s+function\s*\*?\s*([A-Za-z0-9_$]+)\s*(?:<[^>(]*>)?\s*\(/g;
  for (const file of files) {
    const source = maskComments(readFileSync(file, "utf8"));
    const rel = file.replace(process.cwd() + "/", "");
    fnRe.lastIndex = 0;
    let match;
    while ((match = fnRe.exec(source)) !== null) {
      const parenOpen = source.indexOf("(", match.index + match[0].length - 1);
      if (parenOpen === -1) continue;
      const parenClose = matchParen(source, parenOpen);
      if (parenClose === -1) continue;
      const naive = source.indexOf("{", parenClose);
      const correct = findBodyBrace(source, parenClose);
      const where = `${rel}:${source.slice(0, match.index).split("\n").length}  ${match[1]}`;
      if (correct === -1) { unparseable.push(where); continue; }
      if (naive !== correct) misExtracted.push(where);
      fnRe.lastIndex = parenClose;
    }
  }
  console.log(`[check-org-scoped-fetch] --blind-spot: ${files.length} files scanned`);
  console.log(`  ${misExtracted.length} async function(s) whose BODY the current extractor never reads`);
  console.log(`  (the naive indexOf("{") lands on an inline return type's brace, e.g. \`): Promise<{ … }> {\`)`);
  for (const e of misExtracted.slice(0, 8)) console.log(`    - ${e}`);
  if (misExtracted.length > 8) console.log(`    … and ${misExtracted.length - 8} more (sample of ${misExtracted.length})`);
  console.log("");
  console.log(`  ${unparseable.length} declaration(s) the correct finder also could not resolve — these would be LOUD skips, not silent ones`);
  // Listed in FULL, not sampled: this is the population that would make the
  // fixed gate say "I could not read this" out loud, so the owner needs all of
  // them, not a taste.
  for (const e of unparseable) console.log(`    - ${e}`);
  console.log("");
  console.log("  The extractors NO LONGER use the naive finder — OD-3 was approved on");
  console.log("  2026-08-17 and they call findBodyBrace, so the number above is the cost");
  console.log("  of REGRESSING to indexOf, not a live gap. The gate's current coverage is");
  console.log("  the \"declarations whose body could not be located\" line in its verdict.");
}

function main() {
  if (process.argv.includes("--blind-spot")) { reportBlindSpot(); return; }

  const orgScopedIdents = collectOrgScopedTableIdents();
  const scannedFiles = findScannedFiles();

  const newOffenders = [];
  // Register hits are counted PER SHAPE. The method-shape counts keep the
  // exact reporting shape (and the exact numbers) that
  // tests/unit/orgScopedFetchCoverage.test.ts pins as a down-only ratchet, so
  // widening the walk to functions cannot quietly inflate that ceiling. The
  // function-shape registers report their own baselines on their own line.
  // NEW offenders and STALE entries stay COMBINED — those are the enforcement,
  // and a regression in either shape must fail the whole gate.
  const baselineSeen = new Set();
  const baselineSeenFunction = new Set();
  const newUnusedOrg = [];
  const unusedOrgSeen = new Set();
  const unusedOrgSeenFunction = new Set();
  const newUnscopedChains = [];
  const rule3Seen = new Set();
  let rule3ChainsScanned = 0;
  let scannedMethods = 0;
  let scannedFunctions = 0;
  let scannedRouteHandlers = 0;
  let methodsTouchingOrgTables = 0;
  let conformingMethods = 0;

  for (const file of scannedFiles) {
    const rel = file.replace(REPO_ROOT + "/", "");
    // Masked for the same reason as the schema pass — and as a bonus,
    // commented-out code can no longer count as "touching" a table or as
    // providing org context.
    let raw;
    try {
      raw = readFileSync(file, "utf8");
    } catch (err) {
      if (!err || err.code !== "ENOENT") throw err;
      vanishedDuringScan += 1;
      continue;
    }
    const source = maskComments(raw);

    // Two SHAPES, one RULE. `async name(` is method syntax; `async function
    // name(` is function syntax. They were never semantically different for
    // tenancy purposes — only the method shape used to be looked at, which is
    // what made the function shape a working bypass (see the FUNCTION SHAPE
    // register header). Each shape answers to its own register so the two
    // ratchets stay independently auditable and independently shrinkable.
    // THREE shapes, one rule. `async name(` is method syntax; `async function
    // name(` is function syntax; an inline `api.get("/path", …, async (req,
    // res) => {})` is neither, and it is what a route file is made of. Until
    // the third was added (2026-09-04) every query in every handler was
    // attributed to the enclosing registerRoutes() — a 1,400-line unit that
    // mentions organizationId, so rule 1 could never fire on any of them.
    const routeUnits = extractRouteHandlers(source).map((u) => ({ ...u, shape: "route" }));
    // ATTRIBUTE EACH QUERY TO ITS INNERMOST UNIT. A route file's registrar —
    // `registerRoutes`, `registerMiscRoutes` — is an async function that
    // ENCLOSES every handler in the file, so without this every finding is
    // reported twice: once against the handler you can act on, and once
    // against a 1,400-line function whose name tells a reader nothing. Nine
    // such duplicates were in the debt register on the day this was written.
    //
    // Masking with SPACES rather than deleting keeps the enclosing unit's
    // remaining text at its original offsets, so nothing downstream that
    // measures a distance inside that text starts measuring a different thing.
    // It also leaves the registrar itself genuinely checked: a query written
    // directly in the registrar body, outside every handler, still belongs to
    // it and is still read.
    const maskNested = (u) => {
      if (typeof u.start !== "number") return u;
      const inner = routeUnits.filter((h) => h.start >= u.start && h.end <= u.end && h.start !== u.start);
      if (inner.length === 0) return u;
      let text = u.text;
      for (const h of inner) {
        const a = h.start - u.start;
        const b = h.end - u.start;
        if (a < 0 || b > text.length) continue;
        text = text.slice(0, a) + " ".repeat(b - a) + text.slice(b);
      }
      return { ...u, text };
    };
    const units = [
      ...extractAsyncMethods(source).map((u) => ({ ...u, shape: "method" })),
      ...extractAsyncFunctions(source).map((u) => maskNested({ ...u, shape: "function" })),
      ...routeUnits,
    ];
    for (const unit of units) {
      if (unit.shape === "method") scannedMethods += 1;
      else if (unit.shape === "route") scannedRouteHandlers += 1;
      else scannedFunctions += 1;
      const touched = touchedOrgScopedTables(unit.text, orgScopedIdents);
      if (touched.length === 0) continue;
      methodsTouchingOrgTables += 1;
      const isFn = unit.shape === "function";
      const key = `${rel}::${unit.name}`;
      if (ORG_CONTEXT_RE.test(unit.text)) {
        conformingMethods += 1;
        // Rule 3: the UNIT is scoped — is every QUERY in it? Rules 1 and 2
        // both pass a scoped function that contains one unscoped chain, which
        // is how a live cross-tenant read shipped. See RULE3_BASELINE.
        rule3ChainsScanned += queryChainsFrom(unit.text, orgScopedIdents).length;
        for (const table of new Set(unscopedChains(unit.text, orgScopedIdents, rel))) {
          const chainKey = `${rel}::${unit.name}::${table}`;
          if (RULE3_BASELINE.has(chainKey)) rule3Seen.add(chainKey);
          else if (WIDENING_RULE3.has(chainKey)) wideningSeen.add(chainKey);
          else newUnscopedChains.push({ key: chainKey, file: rel, line: unit.line, name: unit.name, table });
        }
        // Rule 2: it HAS an org — does it use it? See the note on
        // loneIdPredicates for why rule 1 cannot answer that.
        const lone = loneIdPredicates(unit.text, orgScopedIdents);
        if (lone.length > 0) {
          const register = isFn ? BASELINE_FUNCTION_UNUSED_ORG : BASELINE_UNUSED_ORG;
          if (register.has(key)) (isFn ? unusedOrgSeenFunction : unusedOrgSeen).add(key);
          else if (WIDENING_RULE2.has(key)) wideningSeen.add(key);
          else
            newUnusedOrg.push({
              key,
              file: rel,
              line: unit.line,
              name: unit.name,
              shape: unit.shape,
              touched: [...new Set(lone)],
            });
        }
        continue;
      }
      const register = isFn ? BASELINE_FUNCTION_OFFENDERS : BASELINE_OFFENDERS;
      if (register.has(key)) {
        (isFn ? baselineSeenFunction : baselineSeen).add(key);
      } else if (WIDENING_RULE1.has(key)) {
        wideningSeen.add(key);
      } else {
        newOffenders.push({ key, file: rel, line: unit.line, name: unit.name, shape: unit.shape, touched });
      }
    }
  }

  // STALENESS IS A CLAIM ABOUT THIS REPOSITORY, so it is only asked of this
  // repository. Every register key names a real file::method here; against a
  // five-file fixture all ~540 of them look stale at once, which would drown
  // the one finding a fixture run exists to show. The registers still act as
  // ALLOWLISTS in fixture mode — a fixture offender is not in them, so it is
  // reported, which is the half the canary depends on.
  const staleAllowlistEntries = !SCANNING_REAL_REPO ? [] : [
    ...[...BASELINE_OFFENDERS].filter((k) => !baselineSeen.has(k)),
    ...[...BASELINE_FUNCTION_OFFENDERS].filter((k) => !baselineSeenFunction.has(k)),
  ];
  // The widening register may only SHRINK. An entry nothing matches has been
  // fixed (or the code was deleted) — either way it must go, so the count is
  // a real burn-down and not a number that drifts down by accident.
  const staleWidening = !SCANNING_REAL_REPO
    ? []
    : [...WIDENING_RULE1, ...WIDENING_RULE2, ...WIDENING_RULE3].filter((k) => !wideningSeen.has(k));
  const staleUnusedOrg = !SCANNING_REAL_REPO ? [] : [
    ...[...BASELINE_UNUSED_ORG].filter((k) => !unusedOrgSeen.has(k)),
    ...[...BASELINE_FUNCTION_UNUSED_ORG].filter((k) => !unusedOrgSeenFunction.has(k)),
  ];
  const staleRule3 = !SCANNING_REAL_REPO
    ? []
    : [...RULE3_BASELINE].filter((k) => !rule3Seen.has(k));

  // ── VACUITY GUARD ────────────────────────────────────────────────────────
  // A scan that stops SEEING things must FAIL, never read as a clean bill of
  // health. This repo has been bitten by exactly that: a block-comment
  // stripper mispaired and blanked the very lines a scan was counting, and
  // the scan reported PASS. The floors below are set well under the measured
  // 2026-08-16 values (365 tables / 906 files / 2485 methods / 2121
  // functions), so ordinary churn never trips them, but a regex that stops
  // matching or a directory walk that returns nothing does.
  //
  // FIXTURE MODE (`--root`): these floors are sized for the repository and a
  // five-file fixture cannot meet any of them, so they are skipped there. That
  // is not a hole — a fixture run is driven by this gate's own tests, which
  // assert on the FINDINGS, and `orgScopedFetchCoverage.test.ts` still runs the
  // real repo through the floored path.
  const vacuity = [];
  if (!SCANNING_REAL_REPO) {
    console.log(
      `[check-org-scoped-fetch] fixture mode (--root ${REPO_ROOT}) — vacuity ` +
        `floors and register-staleness checks do not apply; enforcement does.`,
    );
  }
  if (SCANNING_REAL_REPO) {
  if (scannedFiles.length < 300) vacuity.push(`only ${scannedFiles.length} files scanned (expected >= 300)`);
  if (orgScopedIdents.size < 200) vacuity.push(`only ${orgScopedIdents.size} org-scoped tables found (expected >= 200)`);
  if (scannedMethods < 1500) vacuity.push(`only ${scannedMethods} async methods extracted (expected >= 1500)`);
  if (scannedFunctions < 1200) vacuity.push(`only ${scannedFunctions} async functions extracted (expected >= 1200)`);
  if (methodsTouchingOrgTables < 700)
    vacuity.push(`only ${methodsTouchingOrgTables} units touch org-scoped tables (expected >= 700)`);
  }
  if (vanishedDuringScan > VANISHED_CEILING) {
    vacuity.push(
      `${vanishedDuringScan} file(s) vanished between the walk and the read ` +
        `(ceiling ${VANISHED_CEILING}) — the tree is being rewritten under this scan`,
    );
  }
  if (vacuity.length > 0) {
    console.error("");
    console.error(
      "[check-org-scoped-fetch] FAIL (VACUITY GUARD) — this scan saw far less " +
        "than it should. That is a broken scanner reporting a clean bill of " +
        "health, not a clean repo. Do NOT lower these floors to get green; " +
        "find out why the scan went blind:",
    );
    for (const v of vacuity) console.error(`  - ${v}`);
    console.error("");
    process.exit(1);
  }

  // NOTE ON THE SHAPE OF THIS OUTPUT. The two lines below keep their original
  // wording and their METHOD-SHAPE numbers on purpose: orgScopedFetchCoverage
  // .test.ts parses them and pins `baseline (allowlisted)` and rule 2's
  // `baseline` as down-only ceilings. Reporting the widened total there would
  // have read as those registers growing by 185 — the opposite of the truth,
  // which is that the method registers did not move at all and a previously
  // invisible population was frozen alongside them. `new offenders` and
  // `stale allowlist entries` DO span both shapes: they are the enforcement.
  console.log(
    `[check-org-scoped-fetch] org-scoped tables: ${orgScopedIdents.size} ` +
      `(organizationId ${orgScopedTablesBySpelling.organizationId}, ` +
      `orgId ${orgScopedTablesBySpelling.orgId}, ` +
      `org-FK-by-other-name ${orgScopedTablesBySpelling.orgForeignKey}); ` +
      `scanned ${scannedMethods} storage + service methods across ${scannedFiles.length} files`,
  );
  console.log(
    `[check-org-scoped-fetch] touching org tables: ${methodsTouchingOrgTables}, ` +
      `with org context: ${conformingMethods}, ` +
      `baseline (allowlisted): ${baselineSeen.size}, ` +
      `new offenders: ${newOffenders.length}, ` +
      `stale allowlist entries: ${staleAllowlistEntries.length}`,
  );

  console.log(
    `[check-org-scoped-fetch] rule 2 (has an org, resolves by id anyway): ` +
      `baseline ${unusedOrgSeen.size}, new ${newUnusedOrg.length}, stale ${staleUnusedOrg.length}`,
  );

  console.log(
    `[check-org-scoped-fetch] function shape (widened 2026-08-16): ` +
      `scanned ${scannedFunctions} async functions, ${scannedRouteHandlers} route handlers; ` +
      `rule 1 baseline ${baselineSeenFunction.size}, ` +
      `rule 2 baseline ${unusedOrgSeenFunction.size} — both down-only`,
  );

  // The sanctioned hatch is an EXEMPTION, so its usage is a number the gate
  // must publish rather than absorb. Printed always, including the zero: an
  // exemption nobody counts is how "use the loud form" quietly becomes "use
  // the loud form to silence rule 2". The coverage test holds this at a
  // ceiling, so a new exemption has to be argued for in a diff.
  console.log(
    `[check-org-scoped-fetch] rule-2 predicates exempted as sanctioned-hatch ` +
      `roots: ${hatchExemptedLoneIds} (chain-scoped — a plain by-id read in ` +
      `the same unit still fails)`,
  );

  console.log(
    `[check-org-scoped-fetch] rule 3 (scoped unit, unscoped query; added ` +
      `2026-08-18): scanned ${rule3ChainsScanned} query chains inside scoped ` +
      `units; baseline ${rule3Seen.size}, new ${newUnscopedChains.length}, ` +
      `stale ${staleRule3.length} — down-only`,
  );

  // ALWAYS PRINTED, including the zero. A line that appears only when something
  // is wrong teaches nobody that the check exists — and "no body was skipped"
  // is exactly the claim this gate could not previously make.
  console.log(
    `[check-org-scoped-fetch] declarations whose body could not be located: ` +
      `${unreadableDeclarations.length}` +
      (unreadableDeclarations.length === 0
        ? " (every declaration was read)"
        : ` — NOT SCANNED, so this gate says nothing about them:\n  ` +
          unreadableDeclarations.join("\n  ")),
  );

  // The other way a route leaves this population: its handler is a bare
  // reference to a function declared elsewhere. That declaration IS scanned,
  // under its own name, by the async-function extractor — so this is a
  // hand-off, not a hole. It is printed anyway, because an unprinted hand-off
  // is indistinguishable from a hole that grew, and the population is exactly
  // the assumption a green result hides.
  console.log(
    `[check-org-scoped-fetch] routes whose handler is a named function ` +
      `declared elsewhere: ${namedHandlerReferences.length} (read by the ` +
      `async-function extractor under their own names, not here)`,
  );

  // Rule 3's own vacuity floor. A chain walk that stops finding chains reads
  // as "every query is scoped", which is the exact false green this rule was
  // added to remove.
  if (SCANNING_REAL_REPO && rule3ChainsScanned < 300) {
    console.error("");
    console.error(
      `[check-org-scoped-fetch] FAIL (VACUITY GUARD) — rule 3 found only ` +
        `${rule3ChainsScanned} query chains inside scoped units (expected >= 300; ` +
        `measured 947 across the repo on 2026-08-18). A chain walk that sees ` +
        `nothing certifies everything. Do NOT lower this floor.`,
    );
    process.exit(1);
  }

  // Say the quiet part out loud on every run, pass or fail. A PASS that does
  // not mention 210 held entries reads as "the route layer is clean", which
  // is the exact misreading this register exists to prevent.
  console.log(
    `[check-org-scoped-fetch] route-widening debt register: ` +
      `${WIDENING_RULE1.size} rule-1 + ${WIDENING_RULE2.size} rule-2 + ${WIDENING_RULE3.size} rule-3 = ` +
      `${WIDENING_RULE1.size + WIDENING_RULE2.size + WIDENING_RULE3.size} held ` +
      // The split is the point of the line. "Held" alone reads as a backlog;
      // what a reader needs is how much of it anyone has actually opened,
      // because an unread entry is not a smaller problem than an unscanned
      // file — it is the same problem with a number attached.
      `(${wideningTriagedCount} read, ${WIDENING_RULE1.size + WIDENING_RULE2.size + WIDENING_RULE3.size - wideningTriagedCount} NOT read), ` +
      `${staleWidening.length} stale — down-only, excuses nothing NEW. ` +
      `scripts/org-scope-route-widening.json`,
  );

  // And the VERDICT MIX, derived on every run.
  //
  // This tally used to live as prose inside the register's own
  // _TRIAGE_PROGRESS, and by 2026-09-05 that block said "31 UNREACHABLE" three
  // lines below a paragraph explaining that UNREACHABLE had been retired as a
  // verdict — a document contradicting itself about its own contents. A count
  // typed into prose is stale the day the contents change, which is the same
  // rot as a page hardcoding "three watchdogs" beside a list of six.
  //
  // "271 held" answers how much; this answers OF WHAT, which is the question
  // that decides whether the number is debt at all. Most of it is not: an entry
  // read and ruled SAFE BY DESIGN belongs in the hand-verified register inside
  // this file, per the register's own _THE_OBLIGATION.
  {
    const leading = (note) => {
      const m = /^\s*([A-Z][A-Z0-9 _\-/]{2,40}?)(?=[\s]*[(.,:—-]|\s+\d)/.exec(String(note ?? ""));
      return m ? m[1].trim() : "(unlabelled)";
    };
    const held = new Set([...WIDENING_RULE1, ...WIDENING_RULE2, ...WIDENING_RULE3]);
    const mix = new Map();
    for (const [key, note] of Object.entries(ROUTE_WIDENING._TRIAGED ?? {})) {
      if (!held.has(key)) continue;
      const verdict = leading(note);
      mix.set(verdict, (mix.get(verdict) ?? 0) + 1);
    }
    const rendered = [...mix.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([verdict, n]) => `${n} ${verdict}`)
      .join(", ");
    console.log(`[check-org-scoped-fetch] register verdicts: ${rendered || "(none)"}`);
  }
  if (staleWidening.length > 0) {
    console.error("");
    console.error(
      "[check-org-scoped-fetch] FAIL — route-widening entries no longer match " +
        "anything. They were fixed or deleted (good!) — delete them from " +
        "scripts/org-scope-route-widening.json in the same commit so the " +
        "burn-down is real and not drift:",
    );
    for (const k of staleWidening.slice(0, 25)) console.error(`  - ${k}`);
    if (staleWidening.length > 25) console.error(`  … and ${staleWidening.length - 25} more`);
    process.exit(1);
  }

  if (
    newOffenders.length === 0 &&
    staleAllowlistEntries.length === 0 &&
    newUnusedOrg.length === 0 &&
    staleUnusedOrg.length === 0 &&
    newUnscopedChains.length === 0 &&
    staleRule3.length === 0
  ) {
    console.log("[check-org-scoped-fetch] PASS");
    process.exit(0);
  }

  if (newUnscopedChains.length > 0) {
    console.error("");
    console.error(
      "[check-org-scoped-fetch] FAIL — the following QUERIES sit inside a " +
        "unit that has an organization, read an org-scoped table, and do not " +
        "name the organization themselves. This is the shape that shipped a " +
        "live cross-tenant read in the daily deal feed: the function was " +
        "org-scoped six other ways, so rules 1 and 2 both passed it.",
    );
    for (const o of newUnscopedChains) {
      console.error(`  ${o.file}:${o.line}  ${o.name}()  <- ${o.table}`);
    }
    console.error(
      "\n  Add the organization predicate to the QUERY. If the read is " +
        "legitimately cross-org (a verified-parent join, a deliberate " +
        "all-org sweep), add the key to RULE3_BASELINE with the reason — and " +
        "write the reason, because the next reader has to be able to check it.",
    );
  }

  if (staleRule3.length > 0) {
    console.error("");
    console.error(
      "[check-org-scoped-fetch] FAIL — rule 3 baseline entries that no longer " +
        "match. If you fixed them, DELETE them here in the same commit: a " +
        "stale-high baseline is free headroom for the next unscoped query.",
    );
    for (const k of staleRule3) console.error(`  ${k}`);
  }

  if (newUnusedOrg.length > 0) {
    console.error("");
    console.error(
      "[check-org-scoped-fetch] FAIL — the following methods HAVE an " +
        "organization and still resolve an org-scoped table by primary key. " +
        "That is the shape that let a caller-supplied id reach another " +
        "tenant's row through a scoped-looking signature: add the " +
        "organizationId predicate to the WHERE, or thread the org into the " +
        "helper that runs the query.",
    );
    console.error("");
    for (const off of newUnusedOrg) {
      console.error(`  - [${off.shape}] ${off.file}:${off.line} — ${off.name}() on: ${off.touched.join(", ")}`);
    }
    console.error("");
  }

  if (staleUnusedOrg.length > 0) {
    console.error("");
    console.error(
      "[check-org-scoped-fetch] FAIL — the following BASELINE_UNUSED_ORG " +
        "entries no longer match. Delete them in the commit that fixed them:",
    );
    for (const key of staleUnusedOrg) console.error(`  - "${key}"`);
    console.error("");
  }

  if (newOffenders.length > 0) {
    console.error("");
    console.error(
      "[check-org-scoped-fetch] FAIL — the following NEW methods/functions " +
        "query org-scoped tables without any organization context. Convert " +
        "them to take an organizationId (preferably via forOrg() from " +
        "server/utils/orgScopedDb.ts), or — for genuine platform ops — route " +
        "the access through unscopedForPlatformOps(reason). Writing the unit " +
        "as `async function` rather than a class method is not a way out: " +
        "both shapes are checked.",
    );
    console.error("");
    for (const off of newOffenders) {
      console.error(`  - [${off.shape}] ${off.file}:${off.line} — ${off.name}() touches: ${off.touched.join(", ")}`);
    }
    console.error("");
  }

  if (staleAllowlistEntries.length > 0) {
    console.error("");
    console.error(
      "[check-org-scoped-fetch] FAIL — the following BASELINE_OFFENDERS entries " +
        "no longer match an offending method (fixed or removed). Delete them " +
        "from the allowlist to tighten the ratchet:",
    );
    for (const key of staleAllowlistEntries) {
      console.error(`  - "${key}"`);
    }
    console.error("");
  }

  process.exit(1);
}

main();
