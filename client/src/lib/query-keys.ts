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
 * Adoption status (2026-08-10, master-handoff P1 §2.1): the core CRUD
 * hooks — use-leads, use-deals, use-properties, use-notes — now fan out
 * through `invalidateRelated` / `relatedKeys` instead of hand-rolled
 * key lists, and every RELATED entry includes the Today door's
 * consolidated `/api/today` key (the primary customer door must never
 * go stale after a mutation — audit F-11-1). Remaining hand-rolled
 * call sites (use-campaigns, use-tasks/tasks.tsx, page-level mutations)
 * adopt on next touch. `tests/unit/invalidationRegistry.test.ts` derives
 * the registry's honesty from the codebase: every key here must exist
 * as a real query-key literal, and the hook wiring may not silently
 * un-wire.
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
    // NOTE: a `sparklines` key (["/api/dashboard/sparklines"]) was removed
    // 2026-08-10 — the server route exists but no client query has ever
    // used the key, and the registry only records keys real queries use
    // (tests/unit/invalidationRegistry.test.ts derives this).
  },
  today: {
    // The consolidated Today-door payload (server/routes-today.ts): the
    // decision queue, cash strip, receipts and progress all ride this one
    // key. today.tsx keys its query as ["/api/today", "?since=…&tz=…"], so
    // prefix invalidation on this bare key reaches every variant.
    queue: ["/api/today"] as const,
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
export const RELATED: Record<string, readonly (readonly unknown[])[]> = {
  // Every entity fans out to QK.today.queue: the consolidated /api/today
  // payload (decision queue + cash strip + priorities) derives from leads,
  // deals, properties, tasks, notes and campaign activity server-side, so
  // any entity mutation can move it. Audit F-11-1 found the primary door
  // staying stale for 2 minutes after the customer's first create — the
  // Today key in every entry is the fix, and
  // tests/unit/invalidationRegistry.test.ts pins it.
  lead: [
    QK.leads.list,
    QK.leads.aging,
    QK.dashboard.stats,
    QK.dashboard.intelligence,
    QK.dashboard.todayPriorities,
    QK.onboarding.checklist,
    QK.today.queue,
  ],
  deal: [
    QK.deals.list,
    QK.dashboard.stats,
    QK.dashboard.intelligence,
    QK.dashboard.todayPriorities,
    QK.onboarding.checklist,
    QK.today.queue,
  ],
  property: [
    QK.properties.list,
    QK.dashboard.stats,
    QK.dashboard.todayPriorities,
    QK.onboarding.checklist,
    QK.today.queue,
  ],
  task: [
    QK.tasks.list,
    QK.tasks.my,
    QK.tasks.summary,
    QK.dashboard.todayPriorities,
    QK.today.queue,
  ],
  campaign: [
    QK.campaigns.list,
    QK.dashboard.stats,
    QK.onboarding.checklist,
    QK.today.queue,
  ],
  // Notes (the debt instruments, not annotations): payments/status feed
  // the Today cash strip via the consolidated payload.
  note: [
    QK.notes.list,
    QK.onboarding.checklist,
    QK.today.queue,
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

/**
 * The raw fan-out key set for an entity — for call sites that hand keys
 * to a factory instead of invalidating directly. The optimistic-mutation
 * factories (`useOptimisticUpdate` / `useOptimisticCreate` in
 * lib/optimistic-mutation.ts) take these as `extraInvalidateKeys` so an
 * optimistic hook gets the same registry fan-out as a plain one:
 *
 *   useOptimisticUpdate({ ..., extraInvalidateKeys: relatedKeys("lead") })
 */
export function relatedKeys(
  entity: RelatedEntity,
): readonly (readonly unknown[])[] {
  return RELATED[entity] ?? [];
}
