/**
 * Request-scoped marker for a customer Pax turn, read by the allowance
 * enforcement (aiAllowance.enforceAiAllowance) deep inside the AI call chain.
 *
 * Founder decision 2026-10-17 (docs/company/founder-decisions-2026-10-12.md):
 * past the shared monthly AI allowance, PURCHASED credits fund a platform-key
 * Pax turn (metered at the existing per-turn price), as does the org's own
 * key. A Pax turn route mounts `paxTurnScope()`; once the turn has passed its
 * credit check on the org's own balance, the handler calls `markPaxTurn`, and
 * the allowance then lets the call run on the platform key while the handler
 * charges the turn. Any other customer AI call past the allowance (no meter of
 * its own) is still refused, so credits are never a free pass for unmetered
 * features.
 *
 * The scope is `AsyncLocalStorage.run` per request — NOT `enterWith`, which
 * under Express leaks the store into later requests on the same server.
 * Without a scope, `markPaxTurn` does nothing and the wall stays shut (fails
 * closed). Dependency-free on purpose: aiAllowance imports it.
 */
import { AsyncLocalStorage } from "node:async_hooks";

interface PaxTurnMark {
  orgId: number | null;
  creditFunded: boolean;
}

const store = new AsyncLocalStorage<PaxTurnMark>();

/** Route middleware: one Pax-turn scope for this request. */
export function paxTurnScope() {
  return (_req: unknown, _res: unknown, next: () => void): void => {
    store.run({ orgId: null, creditFunded: false }, next);
  };
}

/** Mark this request's scope as a Pax turn for `orgId`. No scope → no-op. */
export function markPaxTurn(orgId: number, creditFunded: boolean): void {
  const mark = store.getStore();
  if (!mark) return;
  mark.orgId = orgId;
  mark.creditFunded = creditFunded;
}

/** The Pax-turn mark for `orgId` in the current request scope, if any. */
export function paxTurnMarkFor(orgId: number): { creditFunded: boolean } | null {
  const mark = store.getStore();
  return mark && mark.orgId === orgId ? { creditFunded: mark.creditFunded } : null;
}

/**
 * Run `fn` OUTSIDE any Pax-turn scope. Fire-and-forget work a turn starts
 * (memory extraction, quality scoring) must not inherit the turn's credit
 * mark: only the turn itself is credit-funded. Wrap the SCHEDULING call
 * (`detachedFromPaxTurn(() => setImmediate(...))`) so the callback captures
 * the exited context.
 */
export function detachedFromPaxTurn<T>(fn: () => T): T {
  return store.exit(fn);
}
