/**
 * FROZEN surfaces — code-enforced deny-list (launch-week WS1, 2026-07-07).
 *
 * These routes carry a FREEZE/KILL verdict in docs/company/deletion-ledger.md.
 * Their reachability must NOT depend on the platform_feature_flags table
 * being seeded or the /api/config/features endpoint being healthy: the
 * client's flag resolution deliberately fails OPEN ("no flags = show
 * everything") so a flags outage can't hide real features — which meant an
 * unseeded table or an endpoint error un-hid every frozen door and let
 * customers click into 404s.
 *
 * Both sides consume this list:
 *   - client/src/hooks/use-feature-flags.ts checks it BEFORE every other
 *     rule, including the fail-open ones;
 *   - the /api/config/features endpoint merges it into disabledRoutes on
 *     success AND error paths, so older cached clients get it too.
 *
 * Unfreezing a surface = remove it here in the same PR that flips its flag,
 * citing the deletion-ledger reactivation criterion.
 */
export const FROZEN_ROUTES: readonly string[] = [
  "/marketplace", // FREEZE — reactivate at G2 liquidity proof
  "/capital-markets", // FREEZE — reactivate when note securitization is real (H4)
  "/vision-ai", // KILL — deletion scheduled H2
  "/negotiation", // KILL (standalone copilot) — orchestrator lives on in Pax
];

export function isFrozenRoute(route: string): boolean {
  return FROZEN_ROUTES.includes(route);
}
