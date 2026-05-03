// Surface-specific empty states (legacy / pre-archetype components)
export { LeadsEmptyState } from "./LeadsEmptyState";
export { PropertiesEmptyState } from "./PropertiesEmptyState";
export { DealsEmptyState } from "./DealsEmptyState";
export { TasksEmptyState } from "./TasksEmptyState";
export { CampaignsEmptyState } from "./CampaignsEmptyState";

// Archetypes — the three reusable patterns every surface should map to:
//   - FirstHelloEmpty: org has zero data, optimistic onboarding CTAs
//   - ClearedEmpty:    "inbox zero" — affirming, archive escape hatch
//   - EmptyFilter:     filters returned nothing, "clear filters" CTA
export { FirstHelloEmpty, type FirstHelloSurface } from "./FirstHelloEmpty";
export { ClearedEmpty } from "./ClearedEmpty";
export { EmptyFilter } from "./EmptyFilter";
