/**
 * AcreOS query-key registry + per-entity invalidation map.
 *
 * Why this exists:
 *   Deleting a lead must invalidate the leads list AND the dashboard
 *   KPI tile AND the today decision queue AND the leads-aging chart
 *   AND the onboarding checklist. The 2026-05-12 bug "deleted 17
 *   sample leads still showed on dashboard" was caused by
 *   `useDeleteLead` invalidating only `["/api/leads"]` and leaving
 *   five other consumers stale.
 *
 * Pattern:
 *   - `QK` exports the canonical query-key shape for each entity.
 *     Mutation hooks and queries import these instead of inlining
 *     string array literals (which drift across files).
 *   - `RELATED` maps each entity type to the full fan-out set of
 *     query keys that must be invalidated when that entity changes.
 *     The map is the single place to add a new consumer — adding a
 *     new dashboard widget that reads from leads means appending one
 *     key here, not auditing every mutation hook.
 *   - `invalidateRelated(entity, qc)` performs the fan-out.
 *
 * Adoption is incremental. Existing hooks continue to work; they
 * adopt the registry on next touch. Track A owns the hook migration.
 */
import type { QueryClient } from "@tanstack/react-query";

export const QK = {
  leads: {
    list: ["/api/leads"] as const,
    detail: (id: number | string) => ["/api/leads", id] as const,
    aging: ["/api/leads/aging"] as const,
    scoreHistory: (id: number | string) =>
      ["/api/leads", id, "score-history"] as const,
    sms: (id: number | string) => [`/api/leads/${id}/sms`] as const,
  },
  deals: {
    list: ["/api/deals"] as const,
    detail: (id: number | string) => ["/api/deals", id] as const,
  },
  properties: {
    list: ["/api/properties"] as const,
    detail: (id: number | string) => ["/api/properties", id] as const,
  },
  tasks: {
    list: ["/api/tasks"] as const,
    my: ["/api/tasks/my"] as const,
    summary: ["/api/tasks/dashboard-summary"] as const,
  },
  notes: {
    list: ["/api/notes"] as const,
    forEntity: (entityType: string, entityId: number) =>
      ["/api/notes", { entityType, entityId }] as const,
  },
  campaigns: {
    list: ["/api/campaigns"] as const,
    detail: (id: number) => ["/api/campaigns", id] as const,
    attribution: (id: number) =>
      ["/api/campaigns", id, "mail-attribution"] as const,
    responseTrend: (id: number) =>
      ["/api/campaigns", id, "response-trend"] as const,
    optimizations: (id: number) =>
      ["/api/campaigns", id, "optimizations"] as const,
  },
  dashboard: {
    stats: ["/api/dashboard/stats"] as const,
    intelligence: ["/api/dashboard/intelligence"] as const,
    todayPriorities: ["/api/dashboard/today-priorities"] as const,
    sparklines: ["/api/dashboard/sparklines"] as const,
  },
  onboarding: {
    checklist: ["/api/onboarding/checklist-status"] as const,
  },
  credits: {
    balance: ["/api/credits"] as const,
  },
} as const;

/**
 * For each entity, the list of query keys that must be invalidated
 * when something about that entity changes. Used by `invalidateRelated`.
 *
 * Add new consumers HERE rather than at every mutation callsite — a new
 * dashboard widget reading from leads should be a one-line append, not
 * a sweep through 40 hooks.
 */
const RELATED: Record<string, readonly (readonly unknown[])[]> = {
  lead: [
    QK.leads.list,
    QK.leads.aging,
    QK.dashboard.stats,
    QK.dashboard.intelligence,
    QK.dashboard.todayPriorities,
    QK.onboarding.checklist,
  ],
  deal: [
    QK.deals.list,
    QK.dashboard.stats,
    QK.dashboard.intelligence,
    QK.dashboard.todayPriorities,
    QK.onboarding.checklist,
  ],
  property: [
    QK.properties.list,
    QK.dashboard.stats,
    QK.onboarding.checklist,
  ],
  task: [
    QK.tasks.list,
    QK.tasks.my,
    QK.tasks.summary,
    QK.dashboard.todayPriorities,
  ],
  campaign: [
    QK.campaigns.list,
    QK.dashboard.stats,
    QK.onboarding.checklist,
  ],
};

export type RelatedEntity = keyof typeof RELATED;

/**
 * Invalidate every query consumer that depends on the given entity.
 *
 * Usage from a mutation hook:
 *
 *   const qc = useQueryClient();
 *   useMutation({
 *     mutationFn: deleteLead,
 *     onSuccess: () => invalidateRelated("lead", qc),
 *   });
 */
export function invalidateRelated(
  entity: RelatedEntity,
  qc: QueryClient,
): void {
  const keys = RELATED[entity];
  if (!keys) return;
  for (const key of keys) {
    qc.invalidateQueries({ queryKey: key as unknown as readonly unknown[] });
  }
}
