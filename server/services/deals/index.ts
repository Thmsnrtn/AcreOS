/**
 * Deals domain — barrel file re-exporting deal-related services.
 * Import from "server/services/deals" for a clean domain-level API.
 */
export * from "../dealFeedEngine";
export * from "../dealFeedEnhancements";
export * from "../dealHandoffService";
// dealHunter retired 2026-06-08 — sourcing role lives in dealFeedEngine.
export * from "../dealPatternCloning";
export * from "../dealUnderwriting";
