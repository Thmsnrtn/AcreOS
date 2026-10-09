/**
 * One purchase intent per purchase action.
 *
 * The server keys a credit checkout on the request's Idempotency-Key
 * (stripeService.creditCheckoutIdempotencyKey). A fresh key per click would
 * let a double-click open two checkouts; one key per pack forever would block
 * buying the same pack twice. So: while a purchase of `scope` is in flight,
 * every call returns the SAME key; once it settles, the next call mints a new
 * one.
 */
const inFlight = new Map<string, { key: string; holders: number }>();

function mint(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c?.randomUUID) return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function beginPurchaseIntent(scope: string): string {
  const cur = inFlight.get(scope);
  if (cur) {
    cur.holders++;
    return cur.key;
  }
  const key = mint();
  inFlight.set(scope, { key, holders: 1 });
  return key;
}

export function settlePurchaseIntent(scope: string): void {
  const cur = inFlight.get(scope);
  if (!cur) return;
  cur.holders--;
  if (cur.holders <= 0) inFlight.delete(scope);
}
