import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Tautology-test ratchet (Phase 0 audit critique #6 — AI Evals Lead).
 *
 * The repo's single most common defect, per CLAUDE.md, is code that reports
 * success while doing nothing. The test-suite version of it is a unit file that
 * imports ZERO application code and instead re-implements the logic inside the
 * test — so it passes forever regardless of what the product does. The audit
 * found ~85 such files (e.g. acreOSValuation.test.ts reimplements the AVM;
 * encryption/accountLockout/gdprService/doddFrankChecker mirror server logic).
 *
 * This ratchet does not (yet) fix them — it FREEZES the debt so it can only
 * shrink: no NEW tautology test may be added, and when a baselined file is
 * rewired to import real code (or deleted), it must be removed from the
 * baseline in the same commit. Source/config scanners (which import `fs` to
 * assert on file text — a legitimate structural check) are exempt.
 *
 * To burn one down: make the test import and exercise the real module, then
 * delete its entry from TAUTOLOGY_BASELINE below.
 */

// A test "imports app code" if it pulls from server/shared/client (relative or alias).
const APP_IMPORT =
  /(from\s+|import\s*\(?\s*|require\s*\(\s*)["'](\.\.\/\.\.\/(server|shared|client)\/|@shared\/|@\/|@sovereign\/|@content\/|@acreos\/)/;
// fs source/config scanners are legitimately app-code-free.
const FS_IMPORT = /(from|require\(|import\()\s*["'](node:fs|fs|node:fs\/promises)["']/;

const SELF = "tautologyTestRatchet.test.ts";

/**
 * Frozen 2026-08-02. This list may only SHRINK. Adding an entry requires an
 * explicit, reviewed reason (a genuinely un-importable pure-logic test); the
 * default expectation is that a new test imports the code it claims to cover.
 */
const TAUTOLOGY_BASELINE: readonly string[] = [
  "abTestEngine.test.ts", "accountLockout.test.ts", "acreOSValuation.test.ts",
  "addressValidation.test.ts", "aiTools.test.ts", "attributionService.test.ts",
  "blindOfferCalculator.test.ts", "bookkeeping.test.ts", "browserAutomation.test.ts",
  "bulkOperations.test.ts", "buyerMatching.test.ts", "buyerMatchingAI.test.ts",
  "buyerNetwork.test.ts", "campaignOptimizer.test.ts", "capitalMarkets.test.ts",
  "cashFlowForecaster.test.ts", "certification.test.ts", "changePassword.test.ts",
  "churnEngine.test.ts", "cohortAnalysis.test.ts", "commissionService.test.ts",
  "complianceAutomation.test.ts", "contextualComments.test.ts", "costBasisTracker.test.ts",
  "countyBrokerNormalizer.test.ts", "countyRecordingFees.test.ts", "dataIntegrity.test.ts",
  "ddReportGenerator.test.ts", "dealFeedEngine.test.ts", "dealHunter.test.ts",
  "dealPatternCloning.test.ts", "depreciationService.test.ts", "dispositionOptimizer.test.ts",
  "doddFrankChecker.test.ts", "dunningService.test.ts", "encryption.test.ts",
  "exchange1031.test.ts", "flyNightMode.test.ts", "founder-finance.test.ts",
  "freedomCalculator.test.ts", "gdprService.test.ts", "gradientBoostingModel.test.ts",
  "import.test.ts", "integrationCredentials.test.ts", "investorVerification.test.ts",
  "landCredit.test.ts", "landCreditBadge.test.ts", "leadEnrichment.test.ts",
  "leadScoreDecay.test.ts", "marketIntelligence.test.ts", "marketPrediction.test.ts",
  "matchmaking.test.ts", "mentionService.test.ts", "negotiationCopilot.test.ts",
  "negotiationOrchestrator.test.ts", "negotiationPipeline.test.ts",
  "notificationPreferences.test.ts", "opportunityZoneAnalyzer.test.ts", "pagination.test.ts",
  "portfolioHealth.test.ts", "portfolioIntelligence.test.ts", "portfolioOptimizer.test.ts",
  "portfolioSentinel.test.ts", "prefetchSingleAuthority.test.ts", "priceOptimizer.test.ts",
  "privacy-dsar-shim.test.ts", "propertyTaxService.test.ts", "regulatoryIntelligence.test.ts",
  "responseCache.test.ts", "roleHierarchy.test.ts", "schema.test.ts", "schemaIntegrity.test.ts",
  "sellerIntentPredictor.test.ts", "sequenceOptimizer.test.ts", "skipTracing.test.ts",
  "stateDocumentConfig.test.ts", "taxDelinquent.test.ts", "taxOptimizationEngine.test.ts",
  "taxOptimizer.test.ts", "territoryService.test.ts", "usageLimits.test.ts",
  "vaManagement.test.ts", "voiceCallAI.test.ts", "writingStyle.test.ts", "zoningService.test.ts",
];

function currentTautologies(): string[] {
  const dir = __dirname; // tests/unit
  const files = readdirSync(dir).filter(
    (f) => (f.endsWith(".test.ts") || f.endsWith(".test.tsx")) && f !== SELF,
  );
  const out: string[] = [];
  for (const f of files) {
    const src = readFileSync(join(dir, f), "utf8");
    if (APP_IMPORT.test(src)) continue; // imports real code
    if (FS_IMPORT.test(src)) continue; // legitimate source/config scanner
    out.push(f);
  }
  return out.sort();
}

describe("tautology-test ratchet", () => {
  const current = currentTautologies();
  const baseline = new Set(TAUTOLOGY_BASELINE);

  it("adds no NEW tautology test (import the code you claim to cover)", () => {
    const added = current.filter((f) => !baseline.has(f));
    expect(
      added,
      `New unit test(s) import no application code and re-implement logic inline, so they can never fail when the product breaks. Import and exercise the real module instead:\n  ${added.join("\n  ")}`,
    ).toEqual([]);
  });

  it("has no stale baseline entries (shrink the baseline in the same commit)", () => {
    const currentSet = new Set(current);
    const stale = TAUTOLOGY_BASELINE.filter((f) => !currentSet.has(f));
    expect(
      stale,
      `These baselined files no longer read as tautologies (rewired to import app code, or deleted). Remove them from TAUTOLOGY_BASELINE:\n  ${stale.join("\n  ")}`,
    ).toEqual([]);
  });
});
