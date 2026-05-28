/**
 * Optimistic-update mutation factory.
 *
 * Standardizes the snapshot + rollback pattern across the codebase. Most
 * `useMutation` call sites only `invalidateQueries` on success and do
 * nothing on error — which means a server rejection on flaky cellular
 * leaves the UI showing the half-applied optimistic state (or worse,
 * a stale cache that disagrees with the eventual refetch). The two
 * hand-rolled gold-standard implementations are `useUpdateLead`
 * (client/src/hooks/use-leads.ts) and `useDeleteProperty`
 * (client/src/hooks/use-properties.ts) — this helper extracts that
 * pattern so it's a one-liner everywhere else.
 *
 * Scope: partial-update mutations where the optimistic UI is "set the
 * new field locally now and roll back if the server rejects." Do NOT
 * use for CREATE (no id yet) or for mutations whose response shape
 * the client can't predict (use a plain useMutation + invalidate).
 */

import {
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
        const detailKey = config.detailKey(variables);
        const detail = queryClient.getQueryData<any>(detailKey);
        if (detail) {
          snapshots.push([detailKey, detail]);
          queryClient.setQueryData(detailKey, { ...detail, ...patch });
        }
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
