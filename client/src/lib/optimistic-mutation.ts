/**
 * Optimistic mutations — the HOUSE PATTERN (master-handoff P1 §2.1).
 *
 * Every create/status-change on the core entities (Leads, Deals,
 * Properties, Tasks, Notes) should feel instant: the row appears or
 * changes the moment the user acts, reconciles when the server responds,
 * and rolls back with a toast if the server rejects. Two factories
 * implement it:
 *
 *   - `useOptimisticUpdate` — partial updates ("set the new field
 *     locally now, roll back if the server rejects"). Extracted from the
 *     hand-rolled gold standards `useUpdateLead` (use-leads.ts) and
 *     `useDeleteProperty` (use-properties.ts).
 *   - `useOptimisticCreate` — creates. Inserts a temp row (negative id,
 *     `_optimistic: true`) at the head of every cached list, swaps it
 *     for the real server row on success, removes it + toasts on error.
 *     Exemplar: `useCreateLead` (use-leads.ts) — a created lead is
 *     visible in every leads list (including the cache the Today door
 *     renders) before the network round-trip completes.
 *
 * Invalidation fan-out belongs to the registry, not the call site: pass
 * `relatedKeys("<entity>")` from lib/query-keys.ts as
 * `extraInvalidateKeys` so the settled-time refetch reaches every
 * consumer (dashboard KPIs, /api/today, onboarding checklist, …).
 *
 * Honesty boundary (refuse-not-fabricate): optimistic rows carry only
 * what the USER just typed plus client timestamps — never invented
 * server-derived fields (scores, rankings, ids other than the temp id).
 * Server-computed surfaces (e.g. the ranked /api/today decision queue)
 * are refetched via invalidation, never synthesized client-side.
 *
 * Do NOT use either factory for mutations whose response shape the
 * client can't predict — use a plain useMutation + invalidateRelated.
 */

import {
  hashKey,
  useMutation,
  useQueryClient,
  type QueryClient,
  type QueryKey,
  type UseMutationOptions,
  type UseMutationResult,
} from "@tanstack/react-query";

import { useToast } from "@/hooks/use-toast";
import { getErrorMessage, getErrorTitle } from "@/lib/error-utils";

type Snapshot = [readonly unknown[], unknown];

export interface OptimisticMutationContext {
  snapshots: Snapshot[];
}

export interface OptimisticUpdateConfig<TVariables, TData> {
  /**
   * The server call. Receives the same variables passed to .mutate().
   * Use the project's apiRequest from "@/lib/queryClient" inside.
   */
  mutationFn: (variables: TVariables) => Promise<TData>;
  /**
   * Query-key prefixes that hold cached *lists* of this entity. The
   * helper walks every cached query whose key starts with each prefix
   * and patches the matching row in place (supports both flat arrays
   * and `{ data: [...] }` paginated shapes).
   *
   * Each entry can be a static QueryKey or a function that derives
   * a key from the mutation variables (useful when the list key
   * embeds an id from the variables — e.g. property-scoped item lists).
   *
   * Example for leads: [[api.leads.list.path]]
   * Example for property items: [({ propertyId }) => ["/api/properties", propertyId, "due-diligence"]]
   */
  listKeys: ReadonlyArray<QueryKey | ((variables: TVariables) => QueryKey)>;
  /**
   * Optional per-entity detail query key. When provided, the helper
   * also snapshots+patches the detail cache.
   *
   * Example for leads: (vars) => [api.leads.get.path, vars.id]
   */
  detailKey?: (variables: TVariables) => QueryKey;
  /**
   * Extract the entity id from the variables. Used to match rows
   * inside the cached lists.
   */
  getId: (variables: TVariables) => string | number;
  /**
   * Build the optimistic patch from variables. Default: spread every
   * key except `id`. Override for mutations whose variables shape
   * doesn't match the entity row shape (e.g. `{ stage }` -> `{ stage }`
   * is fine; `{ checked }` -> `{ isComplete: checked }` needs a custom
   * mapper).
   */
  buildPatch?: (variables: TVariables) => Record<string, unknown>;
  /**
   * Invalidations to run after the mutation settles (success OR error).
   * The list keys are auto-invalidated; pass additional keys here
   * (e.g. dashboard stats, onboarding checklist).
   */
  extraInvalidateKeys?: ReadonlyArray<QueryKey>;
  /**
   * Toast shown on success. Pass `false` to suppress.
   */
  successToast?: { title: string; description?: string } | false;
}

function defaultBuildPatch<TVariables>(variables: TVariables): Record<string, unknown> {
  if (!variables || typeof variables !== "object") return {};
  // Strip `id` — that's the row key, not a field to patch.
  const { id: _id, ...rest } = variables as Record<string, unknown>;
  return rest;
}

/**
 * Patch every cached list under `listKeys` so any row with `row.id === id`
 * gets the patch merged in. Records the prior cache value into `snapshots`
 * so the caller can roll back on error.
 *
 * Exported for unit testing — the real entry point is useOptimisticUpdate.
 */
export function patchListCaches(
  queryClient: QueryClient,
  listKeys: ReadonlyArray<QueryKey>,
  id: string | number,
  patch: Record<string, unknown>,
  snapshots: Snapshot[],
): void {
  for (const listKey of listKeys) {
    const entries = queryClient.getQueriesData({ queryKey: listKey });
    for (const [key, value] of entries) {
      snapshots.push([key, value]);
      if (Array.isArray(value)) {
        queryClient.setQueryData(
          key,
          value.map((row: any) => (row?.id === id ? { ...row, ...patch } : row)),
        );
      } else if (value && typeof value === "object" && Array.isArray((value as any).data)) {
        const v = value as { data: any[] };
        queryClient.setQueryData(key, {
          ...value,
          data: v.data.map((row: any) => (row?.id === id ? { ...row, ...patch } : row)),
        });
      } else if (value && typeof value === "object" && (value as any).id === id) {
        // Some list keys also happen to host a single entity (rare,
        // but useUpdateDeal handles it). Patch in place.
        queryClient.setQueryData(key, { ...(value as object), ...patch });
      }
    }
  }
}

/**
 * Snapshot + patch the per-entity detail cache — unless the prefix walk
 * in `patchListCaches` already captured that exact key. When a listKeys
 * prefix also matches detailKey (e.g. useUpdateDeal: listKeys
 * [["/api/deals"]] + detailKey ["/api/deals", id]), getQueriesData
 * snapshots+patches the detail entry first; reading it again here would
 * snapshot the *already-patched* value, and the rollback loop would
 * restore pre-patch then re-apply the failed optimistic state.
 *
 * Exported for unit testing — the real entry point is useOptimisticUpdate.
 */
export function patchDetailCache(
  queryClient: QueryClient,
  detailKey: QueryKey,
  patch: Record<string, unknown>,
  snapshots: Snapshot[],
): void {
  const detailHash = hashKey(detailKey);
  const alreadyCaptured = snapshots.some(
    ([key]) => hashKey(key as QueryKey) === detailHash,
  );
  if (alreadyCaptured) return;
  const detail = queryClient.getQueryData<any>(detailKey);
  if (detail) {
    snapshots.push([detailKey, detail]);
    queryClient.setQueryData(detailKey, { ...detail, ...patch });
  }
}

/**
 * Build a useMutation hook that applies an optimistic patch, snapshots
 * every touched cache entry, rolls them back on error, toasts the
 * failure, and invalidates on settled.
 *
 * @example
 *   const updateDeal = useOptimisticUpdate({
 *     mutationFn: async ({ id, ...data }) => {
 *       const res = await apiRequest("PUT", `/api/deals/${id}`, data);
 *       return res.json();
 *     },
 *     listKeys: [["/api/deals"]],
 *     detailKey: ({ id }) => ["/api/deals", id],
 *     getId: ({ id }) => id,
 *     successToast: { title: "Success", description: "Deal updated." },
 *   });
 */
export function useOptimisticUpdate<
  TVariables extends { id: string | number } | Record<string, unknown>,
  TData = unknown,
>(
  config: OptimisticUpdateConfig<TVariables, TData>,
  extraOptions?: Omit<
    UseMutationOptions<TData, Error, TVariables, OptimisticMutationContext>,
    "mutationFn" | "onMutate" | "onError" | "onSettled"
  >,
): UseMutationResult<TData, Error, TVariables, OptimisticMutationContext> {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const buildPatch = config.buildPatch ?? defaultBuildPatch;

  const resolveListKeys = (variables: TVariables): QueryKey[] =>
    config.listKeys.map((k) => (typeof k === "function" ? k(variables) : k));

  return useMutation<TData, Error, TVariables, OptimisticMutationContext>({
    ...extraOptions,
    mutationFn: config.mutationFn,
    onMutate: async (variables) => {
      const id = config.getId(variables);
      const patch = buildPatch(variables);
      const listKeys = resolveListKeys(variables);

      // Cancel any in-flight refetches for keys we're about to mutate.
      const cancels: Promise<void>[] = [];
      for (const key of listKeys) {
        cancels.push(queryClient.cancelQueries({ queryKey: key }));
      }
      if (config.detailKey) {
        cancels.push(queryClient.cancelQueries({ queryKey: config.detailKey(variables) }));
      }
      await Promise.all(cancels);

      const snapshots: Snapshot[] = [];

      patchListCaches(queryClient, listKeys, id, patch, snapshots);

      if (config.detailKey) {
        patchDetailCache(queryClient, config.detailKey(variables), patch, snapshots);
      }

      return { snapshots };
    },
    onError: (error, _variables, context) => {
      if (context?.snapshots) {
        for (const [key, value] of context.snapshots) {
          queryClient.setQueryData(key, value);
        }
      }
      toast({
        title: getErrorTitle(error),
        description: getErrorMessage(error),
        variant: "destructive",
      });
    },
    onSuccess: (data, variables, onMutateResult, context) => {
      if (config.successToast !== false && config.successToast) {
        toast(config.successToast);
      }
      // Let callers pass an onSuccess via extraOptions and still chain.
      // react-query v5 signature: (data, variables, onMutateResult, context).
      extraOptions?.onSuccess?.(data, variables, onMutateResult, context);
    },
    onSettled: (_data, _error, variables) => {
      const listKeys = resolveListKeys(variables);
      for (const key of listKeys) {
        queryClient.invalidateQueries({ queryKey: key });
      }
      if (config.extraInvalidateKeys) {
        for (const key of config.extraInvalidateKeys) {
          queryClient.invalidateQueries({ queryKey: key });
        }
      }
    },
  });
}

// ─── Optimistic CREATE ──────────────────────────────────────────────────

/**
 * Insert `row` at the head of every cached list under `listKeys`,
 * snapshotting each touched cache entry for rollback. Handles the three
 * list cache shapes in this codebase:
 *   - flat arrays                          (useDeals, useProperties, useNotes)
 *   - paginated `{ data: [...] }`          (useLeadsPaginated et al.)
 *   - infinite `{ pages: [{ data }] }`     (useLeads "infinite-flat" — the
 *                                           cache the Today door renders)
 * Non-list caches under the prefix (detail objects, aggregates) are left
 * untouched — a create can't be honestly patched into them; the settled
 * invalidation refetches them instead.
 *
 * Exported for unit testing — the real entry point is useOptimisticCreate.
 */
/**
 * Key suffixes (beyond the list prefix) that still denote THE LIST — the
 * pagination/infinite variants registered in the invalidation registry. Any
 * OTHER extension of the prefix (["/api/leads", <id>, "score-history"],
 * detail sub-resources, aggregates) is a FOREIGN cache that merely
 * prefix-matches: inserting the created row there corrupts it (the fleet-5
 * audit reproduced a lead row landing in a score-history array). Exact-key
 * matches always qualify.
 */
const LIST_VARIANT_SEGMENTS = new Set(["paginated", "infinite-flat", "infinite"]);

function isListVariantKey(prefix: QueryKey, key: QueryKey): boolean {
  if (key.length === prefix.length) return true;
  // The FIRST segment past the prefix names the variant; anything after it
  // is variant params (page numbers, sort, filters — not necessarily strings).
  const first = key[prefix.length];
  return typeof first === "string" && LIST_VARIANT_SEGMENTS.has(first);
}

export function insertIntoListCaches(
  queryClient: QueryClient,
  listKeys: ReadonlyArray<QueryKey>,
  row: Record<string, unknown>,
  snapshots: Snapshot[],
): void {
  for (const listKey of listKeys) {
    const entries = queryClient.getQueriesData({ queryKey: listKey });
    for (const [key, value] of entries) {
      if (!isListVariantKey(listKey, key)) continue;
      if (Array.isArray(value)) {
        snapshots.push([key, value]);
        queryClient.setQueryData(key, [row, ...value]);
      } else if (value && typeof value === "object" && Array.isArray((value as any).data)) {
        const v = value as { data: unknown[]; total?: number };
        snapshots.push([key, value]);
        queryClient.setQueryData(key, {
          ...value,
          data: [row, ...v.data],
          ...(typeof v.total === "number" ? { total: v.total + 1 } : {}),
        });
      } else if (value && typeof value === "object" && Array.isArray((value as any).pages)) {
        const v = value as { pages: Array<{ data?: unknown[] }> };
        if (v.pages.length > 0 && Array.isArray(v.pages[0]?.data)) {
          snapshots.push([key, value]);
          const [first, ...rest] = v.pages;
          queryClient.setQueryData(key, {
            ...value,
            pages: [{ ...first, data: [row, ...first.data!] }, ...rest],
          });
        }
      }
      // else: not a list shape — skip (no snapshot; we didn't touch it).
    }
  }
}

/**
 * Swap the optimistic temp row (matched by `tempId`) for the real server
 * row across every cached list under `listKeys`. Runs on create success
 * so the UI shows the server's row (real id, server-computed fields)
 * without waiting for the settled-time refetch to land.
 *
 * Exported for unit testing — the real entry point is useOptimisticCreate.
 */
export function reconcileCreatedRow(
  queryClient: QueryClient,
  listKeys: ReadonlyArray<QueryKey>,
  tempId: string | number,
  serverRow: Record<string, unknown>,
): void {
  const swap = (rows: unknown[]): unknown[] =>
    rows.map((r: any) => (r?.id === tempId ? serverRow : r));
  for (const listKey of listKeys) {
    const entries = queryClient.getQueriesData({ queryKey: listKey });
    for (const [key, value] of entries) {
      if (Array.isArray(value)) {
        if (value.some((r: any) => r?.id === tempId)) {
          queryClient.setQueryData(key, swap(value));
        }
      } else if (value && typeof value === "object" && Array.isArray((value as any).data)) {
        const v = value as { data: unknown[] };
        if (v.data.some((r: any) => r?.id === tempId)) {
          queryClient.setQueryData(key, { ...value, data: swap(v.data) });
        }
      } else if (value && typeof value === "object" && Array.isArray((value as any).pages)) {
        const v = value as { pages: Array<{ data?: unknown[] }> };
        if (v.pages.some((p) => Array.isArray(p?.data) && p.data!.some((r: any) => r?.id === tempId))) {
          queryClient.setQueryData(key, {
            ...value,
            pages: v.pages.map((p) =>
              Array.isArray(p?.data) ? { ...p, data: swap(p.data!) } : p,
            ),
          });
        }
      }
    }
  }
}

export interface OptimisticCreateContext {
  snapshots: Snapshot[];
  tempId: number;
}

export interface OptimisticCreateConfig<TVariables, TData> {
  /** The server call — POST the new entity, return the created row. */
  mutationFn: (variables: TVariables) => Promise<TData>;
  /**
   * Query-key prefixes that hold cached lists of this entity — same
   * semantics as OptimisticUpdateConfig.listKeys.
   */
  listKeys: ReadonlyArray<QueryKey | ((variables: TVariables) => QueryKey)>;
  /**
   * Build the optimistic row from what the user submitted. The factory
   * stamps `id` (negative timestamp — the useCreateNote convention) and
   * `_optimistic: true` on top. Honesty rule: echo the user's input and
   * client timestamps only — never invent server-computed fields.
   */
  buildOptimisticRow: (variables: TVariables) => Record<string, unknown>;
  /**
   * Extract the created row from the mutation response, for the
   * temp-row swap. Defaults to the response itself when it looks like
   * a row (object with an `id`); reconciliation is skipped otherwise
   * (the settled invalidation still refetches truth).
   */
  getCreatedRow?: (data: TData) => Record<string, unknown> | undefined;
  /**
   * Invalidations to run after the mutation settles (success OR error),
   * on top of the auto-invalidated listKeys. Pass the registry fan-out:
   * `relatedKeys("<entity>")` from lib/query-keys.ts.
   */
  extraInvalidateKeys?: ReadonlyArray<QueryKey>;
  /** Toast shown on success. Pass `false` to suppress. */
  successToast?: { title: string; description?: string } | false;
}

/**
 * Build a useMutation hook for entity CREATE that inserts an optimistic
 * temp row into every cached list, swaps it for the server row on
 * success, rolls back + toasts on error, and invalidates on settled.
 *
 * @example — the useCreateLead exemplar:
 *   useOptimisticCreate({
 *     mutationFn: (data) => postLead(data),
 *     listKeys: [[api.leads.list.path]],
 *     buildOptimisticRow: (data) => ({ ...data, createdAt: new Date().toISOString() }),
 *     extraInvalidateKeys: relatedKeys("lead"),
 *     successToast: { title: "Success", description: "Lead created." },
 *   });
 */
export function useOptimisticCreate<TVariables, TData = unknown>(
  config: OptimisticCreateConfig<TVariables, TData>,
): UseMutationResult<TData, Error, TVariables, OptimisticCreateContext> {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const resolveListKeys = (variables: TVariables): QueryKey[] =>
    config.listKeys.map((k) => (typeof k === "function" ? k(variables) : k));

  const getCreatedRow =
    config.getCreatedRow ??
    ((data: TData) =>
      data && typeof data === "object" && "id" in (data as object)
        ? (data as unknown as Record<string, unknown>)
        : undefined);

  return useMutation<TData, Error, TVariables, OptimisticCreateContext>({
    mutationFn: config.mutationFn,
    onMutate: async (variables) => {
      const listKeys = resolveListKeys(variables);
      await Promise.all(
        listKeys.map((key) => queryClient.cancelQueries({ queryKey: key })),
      );
      // Negative timestamp id — cannot collide with a real serial id, and
      // consumers that key rows by id stay stable until reconciliation.
      const tempId = -Date.now();
      const row = {
        ...config.buildOptimisticRow(variables),
        id: tempId,
        _optimistic: true,
      };
      const snapshots: Snapshot[] = [];
      insertIntoListCaches(queryClient, listKeys, row, snapshots);
      return { snapshots, tempId };
    },
    onError: (error, _variables, onMutateResult) => {
      if (onMutateResult?.snapshots) {
        for (const [key, value] of onMutateResult.snapshots) {
          queryClient.setQueryData(key, value);
        }
      }
      toast({
        title: getErrorTitle(error),
        description: getErrorMessage(error),
        variant: "destructive",
      });
    },
    // react-query v5 signature: (data, variables, onMutateResult, context).
    onSuccess: (data, variables, onMutateResult) => {
      const serverRow = getCreatedRow(data);
      if (serverRow && onMutateResult?.tempId !== undefined) {
        reconcileCreatedRow(
          queryClient,
          resolveListKeys(variables),
          onMutateResult.tempId,
          serverRow,
        );
      }
      if (config.successToast !== false && config.successToast) {
        toast(config.successToast);
      }
    },
    onSettled: (_data, _error, variables) => {
      // refetchType "active" (F-D20): paginated lists use keepPreviousData,
      // so the mounted list must be forced to refetch — a passive
      // invalidation would leave the optimistic/reconciled state unverified
      // until the user navigates.
      for (const key of resolveListKeys(variables)) {
        queryClient.invalidateQueries({ queryKey: key, refetchType: "active" });
      }
      if (config.extraInvalidateKeys) {
        for (const key of config.extraInvalidateKeys) {
          queryClient.invalidateQueries({ queryKey: key });
        }
      }
    },
  });
}
