/**
 * Campaigns domain — barrel file re-exporting campaign and outreach services.
 * Import from "server/services/campaigns" for a clean domain-level API.
 */
export * from "../campaignEnhancements";
export * from "../campaignOptimizer";
export * from "../campaignOverlapDetector";
export * from "../directMail";
export * from "../directMailService";
export * from "../sequenceOptimizer";
export * from "../sequenceProcessor";

// Both campaignOptimizer and sequenceOptimizer export an `OptimizationSuggestion`
// type. Re-export campaignOptimizer's as the canonical one to resolve the
// star-export ambiguity, and expose sequenceOptimizer's under an alias.
export type { OptimizationSuggestion } from "../campaignOptimizer";
export type { OptimizationSuggestion as SequenceOptimizationSuggestion } from "../sequenceOptimizer";
