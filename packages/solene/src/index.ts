/**
 * @acreos/solene — the Solene COO / dispatch / constitution / self-audit substrate.
 *
 * This barrel is the FIRST monorepo seam (Tahoe E1). It defines the public API of
 * the Solene package WITHOUT physically relocating any files yet. Every export below
 * re-exports from the canonical implementation that still lives under
 * `server/services/solene/`. This keeps the build green while pinning the public
 * surface that consumers import from `@acreos/solene`.
 *
 * Resolution of the `@acreos/solene` alias is wired through tsconfig `paths`
 * (mirrored in vite.config.ts and vitest.config.ts), identical to the `@shared`
 * mechanism. See packages/solene/README.md for the incremental relocation plan.
 *
 * RULE: Do NOT import deep relative paths (`server/services/solene/...`) from new
 * code outside the Solene boundary. Import the named surface from `@acreos/solene`.
 *
 * Note: schema/db/logger are intentionally NOT part of this package boundary yet —
 * the substrate still depends on the app's `server/db` and `shared/schema`. Those
 * inbound dependencies are the next seam to factor out (see README "Boundary").
 */

// --- Dispatch & execution ---------------------------------------------------
export * from "../../../server/services/solene/dispatchQueue";
export * from "../../../server/services/solene/dispatchRunner";
export * from "../../../server/services/solene/dispatchToolExecutor";
export * from "../../../server/services/solene/planProposals";
export * from "../../../server/services/solene/sessionTaskStore";

// --- COO substrate: capital, paging, continuous loop ------------------------
export * from "../../../server/services/solene/capitalTracker";
export * from "../../../server/services/solene/pagerService";
export * from "../../../server/services/solene/continuousLoop";

// --- Agent coordination -----------------------------------------------------
export * from "../../../server/services/solene/agentClaims";
export * from "../../../server/services/solene/agentIdentity";
export * from "../../../server/services/solene/agentMessages";
export * from "../../../server/services/solene/capabilityDiscovery";
export * from "../../../server/services/solene/distributedReasoning";
export * from "../../../server/services/solene/codeReviewQueue";

// --- Founder collaboration & bypass -----------------------------------------
export * from "../../../server/services/solene/founderCollab";
export * from "../../../server/services/solene/founderBypass";

// --- Constitution, alignment, self-audit ------------------------------------
export * from "../../../server/services/solene/constitutionalGuard";
export * from "../../../server/services/solene/preCallConstitutionalChecker";
export * from "../../../server/services/solene/selfAudit";
export * from "../../../server/services/solene/selfDebug";
export * from "../../../server/services/solene/adversarialTests";
export * from "../../../server/services/solene/failureModeLibrary";

// --- Reasoning, decisions, learning -----------------------------------------
export * from "../../../server/services/solene/decisionTraces";
export * from "../../../server/services/solene/counterfactuals";
export * from "../../../server/services/solene/speculations";
export * from "../../../server/services/solene/timeAwareDecisions";
export * from "../../../server/services/solene/learningLoop";
export * from "../../../server/services/solene/pipeline";

// --- Confidence, evidence, scoring ------------------------------------------
export * from "../../../server/services/solene/confidenceObservations";
export * from "../../../server/services/solene/confidenceParser";
export * from "../../../server/services/solene/evidenceWeights";
export * from "../../../server/services/solene/tokenEconomyScorer";

// --- Memory -----------------------------------------------------------------
export * from "../../../server/services/solene/memoryFileStore";
export * from "../../../server/services/solene/memoryRetrieval";

// --- Chat (conversation surface) --------------------------------------------
export * from "../../../server/services/solene/conversationStore";
export * from "../../../server/services/solene/chat/turnRunner";
export * from "../../../server/services/solene/chat/toolExecutor";
export * from "../../../server/services/solene/chat/openRouterClient";
export * from "../../../server/services/solene/chat/anthropicClient";
export * from "../../../server/services/solene/chat/contextBuilder";
export * from "../../../server/services/solene/chat/modelRouter";
export * from "../../../server/services/solene/chat/providerSelector";

// --- Disambiguation (resolve TS2308 star-export collisions) -----------------
// An explicit named re-export overrides the ambiguity introduced when two
// `export *` modules above export the same name:
//   - `getProposal` is defined by BOTH planProposals and capabilityDiscovery
//     (two distinct async fns). planProposals is canonical for the package API.
//   - `ContentBlock` is re-exported by both conversationStore and
//     openRouterClient; both resolve to the same shared SchemaContentBlock, so
//     the source is equivalent — conversationStore is chosen as canonical.
export { getProposal } from "../../../server/services/solene/planProposals";
export type { ContentBlock } from "../../../server/services/solene/conversationStore";
