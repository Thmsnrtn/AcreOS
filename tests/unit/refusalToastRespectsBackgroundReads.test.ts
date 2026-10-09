/**
 * A refusal toast obeys the same silence rules as every other failure toast.
 *
 * Refusals that name their next step (PLAN_LIMIT_REACHED, Pax credits, seats)
 * were toasted inside `throwIfResNotOk`, which runs before — and cannot see —
 * the query handler's `meta.backgroundRead` opt-out and its 403/404
 * suppression. A polled badge that hit a plan cap would have toasted on every
 * poll. The toast now comes from the global query / mutation handlers, after
 * those checks. Driven through the real QueryClient's configured handlers.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const T = vi.hoisted(() => ({ toasts: [] as Array<{ title?: string; description?: string }> }));
vi.mock("../../client/src/hooks/use-toast", () => ({
  toast: (t: { title?: string; description?: string }) => T.toasts.push(t),
}));
vi.mock("../../client/src/lib/clientLogger", () => ({
  clientLogger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { ApiError, queryClient } from "../../client/src/lib/queryClient";

const PLAN_BODY = {
  error: "PLAN_LIMIT_REACHED",
  message: "You've reached 50 leads on Free. Starter allows 250 leads.",
  statusCode: 429,
  // The server supplies the title and next plan's name (planLimitDetails);
  // the client renders them as sent, so the title asserted below must be the
  // one in this payload — not one the client recomputes.
  details: {
    resourceType: "leads",
    currentTier: "free",
    nextTier: "starter",
    upgradeUrl: "/settings#billing?tier=starter",
    title: "Lead limit reached on Free",
    nextTierName: "Starter",
  },
};

type Handler = (error: unknown, query?: unknown) => void;
const onQueryError = (queryClient.getQueryCache() as unknown as { config: { onError: Handler } }).config.onError;
const onMutationError = (queryClient.getMutationCache() as unknown as { config: { onError: Handler } }).config.onError;

beforeEach(() => {
  T.toasts.length = 0;
});

describe("refusal toasts", () => {
  it("vacuity: the handlers are the configured ones", () => {
    expect(typeof onQueryError).toBe("function");
    expect(typeof onMutationError).toBe("function");
  });

  it("a foreground query refusal toasts once, with the refusal's own title and sentence", () => {
    onQueryError(new ApiError(429, PLAN_BODY.message, PLAN_BODY as never), { meta: {} });
    expect(T.toasts).toHaveLength(1);
    expect(T.toasts[0].title).toBe("Lead limit reached on Free");
    expect(T.toasts[0].description).toBe(PLAN_BODY.message);
  });

  it("the toast title is the one the server sent, not a client recomputation", () => {
    const body = { ...PLAN_BODY, details: { ...PLAN_BODY.details, title: "Server-chosen heading", nextTierName: "Pro" } };
    onQueryError(new ApiError(429, body.message, body as never), { meta: {} });
    expect(T.toasts).toHaveLength(1);
    expect(T.toasts[0].title).toBe("Server-chosen heading");
  });

  it("a background read stays silent, refusal or not", () => {
    onQueryError(new ApiError(429, PLAN_BODY.message, PLAN_BODY as never), { meta: { backgroundRead: true } });
    expect(T.toasts).toHaveLength(0);
  });

  it("the 403/404 suppression still applies before a refusal is considered", () => {
    const body = { ...PLAN_BODY, statusCode: 403 };
    onQueryError(new ApiError(403, "forbidden", body as never), { meta: {} });
    expect(T.toasts).toHaveLength(0);
  });

  it("a mutation refusal toasts with its step, not the generic 'Slow down'", () => {
    onMutationError(new ApiError(429, PLAN_BODY.message, PLAN_BODY as never));
    expect(T.toasts).toHaveLength(1);
    expect(T.toasts[0].title).not.toBe("Slow down");
    expect(T.toasts[0].title).toBe("Lead limit reached on Free");
  });
});
