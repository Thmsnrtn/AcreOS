// ============================================================================
// client/src/lib/contractFetch.ts — client-side contract validation.
// ----------------------------------------------------------------------------
// T3-3E Phase 3. Thin helpers that compose OVER the existing transport
// primitives in queryClient.ts (apiRequest / getQueryFn) and run the
// contract's `responseSchema.parse` on the result, so the client and the
// server validate against the SAME zod source (shared/contracts).
//
// This file imports queryClient.ts — it NEVER modifies it (queryClient.ts is
// on the do-not-touch list). The 401-recovery, CSRF, idempotency, and
// timeout behavior all come for free from the wrapped primitives.
// ============================================================================

import type { z } from "zod";
import type { QueryFunction } from "@tanstack/react-query";
import { apiRequest, getQueryFn, type ApiRequestOptions } from "./queryClient";
import type { ApiContract, ContractMethod } from "@shared/contracts";
import { clientLogger } from "./clientLogger";

/**
 * Run a contract's `responseSchema.parse` on a fetched payload.
 *
 * A client-side mismatch is logged (clientLogger) AND thrown — unlike the
 * server's prod warn-only stance, a broken contract on the client means the
 * consuming component would crash anyway when it reads a field that isn't
 * there, so failing fast at the boundary gives a far clearer error than a
 * downstream `undefined.map`.
 */
function parseWithContract<Res extends z.ZodTypeAny>(
  schema: Res,
  payload: unknown,
  contractKey: string,
): z.infer<Res> {
  const result = schema.safeParse(payload);
  if (!result.success) {
    clientLogger.error(`[contract] ${contractKey} response mismatch`, result.error);
    throw result.error;
  }
  return result.data;
}

/**
 * Mutation helper: send `body` to a contract endpoint via `apiRequest`,
 * then validate the JSON response against the contract's `responseSchema`.
 *
 * Use at useMutation call sites for the contract-covered write endpoints
 * (e.g. POST /api/leads).
 */
export async function contractRequest<
  Req extends z.ZodTypeAny | null,
  Res extends z.ZodTypeAny,
>(
  contract: ApiContract<Req, Res>,
  body?: unknown,
  options?: ApiRequestOptions,
): Promise<z.infer<Res>> {
  const res = await apiRequest(
    contract.method as ContractMethod,
    contract.path,
    body,
    options,
  );
  const json = await res.json();
  return parseWithContract(
    contract.responseSchema,
    json,
    `${contract.method} ${contract.path}`,
  );
}

/**
 * Query helper: build a React Query `queryFn` that fetches the contract
 * endpoint (through the canonical `getQueryFn`, inheriting 401 recovery)
 * and validates the result against the contract's `responseSchema`.
 *
 * `queryKey` defaults to `[contract.path]`; pass an override for query-string
 * variants (e.g. `["/api/properties", { pageSize: 100 }]`).
 */
export function contractQueryFn<
  Req extends z.ZodTypeAny | null,
  Res extends z.ZodTypeAny,
>(
  contract: ApiContract<Req, Res>,
  on401: "returnNull" | "throw" = "throw",
): QueryFunction<z.infer<Res>> {
  const base = getQueryFn<unknown>({ on401 });
  return async (ctx) => {
    const json = await base(ctx);
    if (json === null) {
      // on401 "returnNull" — pass the null straight through (caller opted
      // into the nullable result; don't run it through the schema).
      return null as z.infer<Res>;
    }
    return parseWithContract(
      contract.responseSchema,
      json,
      `${contract.method} ${contract.path}`,
    );
  };
}
