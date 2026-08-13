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
// Heuristic
// ─────────
// No TypeScript execution — focused regex passes, same family as
// check-org-leading-index.mjs:
//
//   1. Parse shared/schema*.ts for `export const <ident> = pgTable("<name>",…)`
//      blocks and record the TS identifiers of tables that declare an
//      `organizationId` column ("org-scoped tables").
//   2. Walk server/storage.ts, server/storage/*.ts and server/services/**.
//      For every `async <method>(…) { … }` (brace-matched), collect the
//      org-scoped table identifiers it touches via `from(<ident>)`,
//      `db.update(<ident>)`, or `db.delete(<ident>)`.
//   3. If the method touches at least one org-scoped table and the method
//      text (signature + body) contains NO org context marker
//      (`organizationId`, `orgId`, `forOrg(`, `unscopedForPlatformOps(`),
//      it is an offender.
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
  "server/storage/paxRepo.ts::deletePaxProjectFile",
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
  "server/storage/mailRepo.ts::getEmailSenderIdentityByEmail",
  "server/storage/supportOpsRepo.ts::getEscalatedCases",
  "server/storage/growthConfigRepo.ts::getFieldScoutPhotosByLead",
  "server/storage/growthConfigRepo.ts::getFieldScoutPhotosByVisit",
  "server/storage/growthConfigRepo.ts::getFieldScoutVisit",
  "server/storage/growthConfigRepo.ts::getFieldScoutVisits",
  "server/storage.ts::getMessages",
  "server/storage/gisRepo.ts::getParcelSnapshot",
  "server/storage/paxRepo.ts::getPaxScheduledTasksDue",
  "server/storage/paymentRemindersRepo.ts::getPendingReminders",
  "server/storage/tasksRepo.ts::getRecurringTasksDue",
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
  "server/storage/leadRepo.ts::getLeadActivities",
  // The orgRepo organization-by-id/slug/stripe-id fetchers and the two
  // platform org-list methods were allowlisted only because the pre-masking
  // parser misclassified `organizations` itself as org-scoped. The
  // organizations table IS the org — fetching it by key is the tenancy
  // lookup primitive, not an offense. Entries removed 2026-06-10.
  "server/storage/noteRepo.ts::createPayment",
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
  "server/services/aiAdvisorTeamV15.ts::gatherHealthSnapshot",
  "server/services/alertPolicy.ts::routeAlert",
  "server/services/alerting.ts::acknowledgeAlert",
  "server/services/alerting.ts::resolveAlert",
  "server/services/apiQueue.ts::cleanupOldJobs",
  "server/services/apiQueue.ts::getJob",
  "server/services/apiQueue.ts::getPendingJobs",
  "server/services/apiQueue.ts::updateJob",
  "server/services/autonomousSalesPipeline.ts::identifyLeads",
  "server/services/borrower/autopayAuthorizationChallenge.ts::mandateIdForChallenge",
  "server/services/buyerMatchingAI.ts::generateMatchPitch",
  "server/services/buyerQualificationBot.ts::assessFinancingReadiness",
  "server/services/buyerQualificationBot.ts::getQualificationById",
  "server/services/capitalMarkets.ts::investInSecurity",
  "server/services/cashFlowForecaster.ts::analyzePaymentHealth",
  "server/services/cashFlowForecaster.ts::generateInsights",
  "server/services/cashFlowForecaster.ts::identifyRiskFactors",
  "server/services/cashFlowForecaster.ts::projectExpenses",
  "server/services/cashFlowForecaster.ts::projectNoteIncome",
  "server/services/cashFlowForecaster.ts::projectPropertyIncome",
  "server/services/ceoAbsenceMode.ts::suggestAbsenceWindow",
  "server/services/complianceGuardian.ts::estimateComplianceCosts",
  "server/services/costBasisTracker.ts::addImprovement",
  "server/services/costBasisTracker.ts::adjustBasis",
  "server/services/costBasisTracker.ts::computeGainLoss",
  "server/services/costBasisTracker.ts::getAdjustedBasis",
  "server/services/dealPatternCloning.ts::updateMatchOutcome",
  "server/services/decisionsInbox.ts::defer",
  "server/services/decisionsInbox.ts::override",
  "server/services/decisionsInbox.ts::processDeferredItems",
  "server/services/decisionsInbox.ts::reject",
  "server/services/digest.ts::updateSubscription",
  "server/services/dispositionOptimizer.ts::analyzeTimingFactors",
  "server/services/dispositionOptimizer.ts::calculateOptimalPrice",
  "server/services/dispositionOptimizer.ts::calculateOwnerFinanceTerms",
  "server/services/dispositionOptimizer.ts::getAverageDaysOnMarket",
  "server/services/dispositionOptimizer.ts::getMarketCondition",
  "server/services/dispositionOptimizer.ts::getRecommendation",
  "server/services/dispositionOptimizer.ts::recommendChannels",
  "server/services/documentIntelligence.ts::analyzeRisks",
  "server/services/documentIntelligence.ts::compareDocumentVersions",
  "server/services/documentIntelligence.ts::extractKeyTerms",
  "server/services/documentIntelligence.ts::extractText",
  "server/services/documentIntelligence.ts::generateDocumentSummary",
  "server/services/documentIntelligence.ts::parseDocument",
  "server/services/dueDiligencePods.ts::getDossier",
  "server/services/dueDiligencePods.ts::getPropertyData",
  "server/services/dueDiligencePods.ts::updateAgentStatus",
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
  "server/services/leadNurturer.ts::scoreLead",
  "server/services/leadScoring.ts::calcCampaignTouches",
  "server/services/leadScoring.ts::getScoreHistory",
  "server/services/ltvMonitor.ts::calculateCurrentBalance",
  "server/services/ltvMonitor.ts::estimatePropertyValue",
  "server/services/ltvMonitor.ts::getLTVSnapshot",
  "server/services/marketIntelligence.ts::getHistoricalMetrics",
  "server/services/marketIntelligence.ts::getMarketHealth",
  "server/services/marketIntelligence.ts::trackPredictionAccuracy",
  "server/services/marketIntelligence.ts::verifyPrediction",
  "server/services/marketPrediction.ts::getOpportunityWindows",
  "server/services/marketPrediction.ts::getPrediction",
  "server/services/marketWatchlist.ts::deleteEntry",
  "server/services/marketWatchlist.ts::getEntry",
  "server/services/marketWatchlist.ts::updateEntry",
  "server/services/negotiationCopilot.ts::analyzeSentiment",
  "server/services/negotiationCopilot.ts::getRecommendedStrategy",
  "server/services/negotiationCopilot.ts::getSessionById",
  "server/services/negotiationCopilot.ts::recordLessonsLearned",
  "server/services/negotiationCopilot.ts::suggestCounterOffer",
  "server/services/paxObserver.ts::acknowledgeObservation",
  "server/services/paxObserver.ts::autoResolveObservation",
  "server/services/paxObserver.ts::cleanupOldObservations",
  "server/services/paxObserver.ts::dismissObservation",
  "server/services/paxObserver.ts::escalateObservation",
  "server/services/portfolioSentinel.ts::acknowledgeAlert",
  "server/services/portfolioSentinel.ts::dismissAlert",
  "server/services/portfolioSentinel.ts::resolveAlert",
  "server/services/portfolioSentinel.ts::suggestActions",
  "server/services/priceOptimizer.ts::assessCompetition",
  "server/services/priceOptimizer.ts::getLatestSellerIntent",
  "server/services/priceOptimizer.ts::getMarketTiming",
  "server/services/priceOptimizer.ts::getMarketVolatility",
  "server/services/priceOptimizer.ts::incorporateMarketTrends",
  "server/services/proactiveMonitor.ts::autoResolveAlert",
  "server/services/proactiveMonitor.ts::autoResolveAlertsByMetadata",
  "server/services/proactiveMonitor.ts::cleanupOldAlerts",
  "server/services/productEvolutionEngine.ts::generateSpec",
  "server/services/sellerIntentPredictor.ts::analyzeEngagementSignals",
  "server/services/sellerIntentPredictor.ts::analyzeFinancialSignals",
  "server/services/sellerIntentPredictor.ts::analyzeUrgencySignals",
  "server/services/sellerIntentPredictor.ts::getLeadMessageContent",
  "server/services/taxOptimizationEngine.ts::computeDepreciationStrategy",
  "server/services/voiceCallAI.ts::extractActionItems",
  "server/services/voiceCallAI.ts::extractKeyData",
  "server/services/voiceCallAI.ts::generateCoachingInsights",
  "server/services/whiteLabelService.ts::listTenants",
  "server/services/whiteLabelService.ts::resolveFromDomain",
]);

import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");
const SHARED_DIR = join(REPO_ROOT, "shared");
const SERVER_DIR = join(REPO_ROOT, "server");

// ----------------------------------------------------------------------------
// Schema discovery — org-scoped table identifiers
// ----------------------------------------------------------------------------

function findSchemaFiles() {
  const files = [];
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
    if (ch === '"' || ch === "'" || ch === "`") {
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
    prevChar = ch;
  }
  return out.join("");
}

/** Walk parens from `openIdx` (an opening "(") to its match. */
function matchParen(source, openIdx) {
  let depth = 0;
  let inString = null;
  let prevChar = "";
  for (let i = openIdx; i < source.length; i++) {
    const ch = source[i];
    if (inString) {
      if (ch === inString && prevChar !== "\\") inString = null;
    } else {
      if (ch === '"' || ch === "'" || ch === "`") inString = ch;
      else if (ch === "(") depth += 1;
      else if (ch === ")") {
        depth -= 1;
        if (depth === 0) return i;
      }
    }
    prevChar = ch;
  }
  return -1;
}

/** Walk braces from `openIdx` (an opening "{") to its match. */
function matchBrace(source, openIdx) {
  let depth = 0;
  let inString = null;
  let prevChar = "";
  for (let i = openIdx; i < source.length; i++) {
    const ch = source[i];
    if (inString) {
      if (ch === inString && prevChar !== "\\") inString = null;
    } else {
      if (ch === '"' || ch === "'" || ch === "`") inString = ch;
      else if (ch === "{") depth += 1;
      else if (ch === "}") {
        depth -= 1;
        if (depth === 0) return i;
      }
    }
    prevChar = ch;
  }
  return -1;
}

/**
 * Returns Map<tsIdentifier, tableName> for every exported pgTable whose
 * column map declares an `organizationId` column.
 */
function collectOrgScopedTableIdents() {
  const idents = new Map();
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
      if (/\borganizationId\s*:\s*[a-zA-Z_]+\s*\(\s*["'`]organization_id["'`]/.test(body)) {
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
  const files = [join(SERVER_DIR, "storage.ts")];
  const subdir = join(SERVER_DIR, "storage");
  if (statSync(subdir, { throwIfNoEntry: false })?.isDirectory()) {
    for (const entry of readdirSync(subdir)) {
      if (!entry.endsWith(".ts")) continue;
      if (entry.endsWith(".test.ts") || entry.endsWith(".spec.ts")) continue;
      files.push(join(subdir, entry));
    }
  }
  // server/services/** — added 2026-08-13. See the SERVICE LAYER note in the
  // header: a service that owns its own persistence never passed under this
  // lint, and one of them was leaking KYC records across tenants.
  const servicesDir = join(SERVER_DIR, "services");
  if (statSync(servicesDir, { throwIfNoEntry: false })?.isDirectory()) {
    const stack = [servicesDir];
    while (stack.length > 0) {
      const dir = stack.pop();
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          stack.push(full);
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
    // Find the method-body opening brace (skip return-type annotation).
    const braceOpen = source.indexOf("{", parenClose);
    if (braceOpen === -1) continue;
    const between = source.slice(parenClose + 1, braceOpen);
    // If something other than a return-type annotation sits between the
    // params and the brace (e.g. we ran into the next statement), skip.
    if (/[;=]/.test(between) && !/=>/.test(between)) continue;
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

const ORG_CONTEXT_RE = /organizationId|orgId|forOrg\s*\(|unscopedForPlatformOps\s*\(/;

function touchedOrgScopedTables(methodText, orgScopedIdents) {
  const touched = new Set();
  const accessRe = /\b(?:from|(?:db|tx)\s*\.\s*update|(?:db|tx)\s*\.\s*delete)\s*\(\s*([A-Za-z0-9_]+)\s*[),]/g;
  let m;
  while ((m = accessRe.exec(methodText)) !== null) {
    const ident = m[1];
    if (orgScopedIdents.has(ident)) touched.add(ident);
  }
  return [...touched];
}

// ----------------------------------------------------------------------------
// Main
// ----------------------------------------------------------------------------

function main() {
  const orgScopedIdents = collectOrgScopedTableIdents();
  const scannedFiles = findScannedFiles();

  const newOffenders = [];
  const baselineSeen = new Set();
  let scannedMethods = 0;
  let methodsTouchingOrgTables = 0;
  let conformingMethods = 0;

  for (const file of scannedFiles) {
    const rel = file.replace(REPO_ROOT + "/", "");
    // Masked for the same reason as the schema pass — and as a bonus,
    // commented-out code can no longer count as "touching" a table or as
    // providing org context.
    const source = maskComments(readFileSync(file, "utf8"));
    for (const method of extractAsyncMethods(source)) {
      scannedMethods += 1;
      const touched = touchedOrgScopedTables(method.text, orgScopedIdents);
      if (touched.length === 0) continue;
      methodsTouchingOrgTables += 1;
      if (ORG_CONTEXT_RE.test(method.text)) {
        conformingMethods += 1;
        continue;
      }
      const key = `${rel}::${method.name}`;
      if (BASELINE_OFFENDERS.has(key)) {
        baselineSeen.add(key);
      } else {
        newOffenders.push({ key, file: rel, line: method.line, name: method.name, touched });
      }
    }
  }

  const staleAllowlistEntries = [...BASELINE_OFFENDERS].filter((k) => !baselineSeen.has(k));

  console.log(
    `[check-org-scoped-fetch] org-scoped tables: ${orgScopedIdents.size}; ` +
      `scanned ${scannedMethods} storage + service methods across ${scannedFiles.length} files`,
  );
  console.log(
    `[check-org-scoped-fetch] touching org tables: ${methodsTouchingOrgTables}, ` +
      `with org context: ${conformingMethods}, ` +
      `baseline (allowlisted): ${baselineSeen.size}, ` +
      `new offenders: ${newOffenders.length}, ` +
      `stale allowlist entries: ${staleAllowlistEntries.length}`,
  );

  if (newOffenders.length === 0 && staleAllowlistEntries.length === 0) {
    console.log("[check-org-scoped-fetch] PASS");
    process.exit(0);
  }

  if (newOffenders.length > 0) {
    console.error("");
    console.error(
      "[check-org-scoped-fetch] FAIL — the following NEW storage methods query " +
        "org-scoped tables without any organization context. Convert them to " +
        "take an organizationId (preferably via forOrg() from " +
        "server/utils/orgScopedDb.ts), or — for genuine platform ops — route " +
        "the access through unscopedForPlatformOps(reason).",
    );
    console.error("");
    for (const off of newOffenders) {
      console.error(`  - ${off.file}:${off.line} — ${off.name}() touches: ${off.touched.join(", ")}`);
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
