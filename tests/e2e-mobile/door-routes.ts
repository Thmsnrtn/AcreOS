/**
 * The canonical routes an end-to-end audit visits — one list, one place.
 *
 * Two suites had grown their own copies, and the copies were the point of
 * failure. mobile-feel-contracts.spec.ts spent its Map-door budget auditing
 * "/map", which has no route and falls through to the 404 catch-all: the suite
 * measured the not-found page and reported a healthy Map door for as long as it
 * existed. The canonical href is "/maps" (nav-items.ts). The same wrong-premise
 * bug hit customer-surface-journeys.spec.ts's J1 independently.
 *
 * A door renamed in nav-items.ts must not be able to leave an audit quietly
 * measuring a 404, so this list is pinned against the client's own nav
 * constants by tests/unit/auditRoutesAreRealDoors.test.ts. Adding a route here
 * that no router serves fails there, not six months later.
 */

/** The five customer doors — CLAUDE.md "five fixed doors". Order is nav order. */
export const CUSTOMER_DOOR_ROUTES = [
  "/today",
  "/maps",
  "/deals",
  "/money",
  "/ai",
] as const;

/** Reachable from the top bar rather than the door row, but customer-facing. */
export const CUSTOMER_TOP_BAR_ROUTES = ["/inbox", "/settings"] as const;

/** The four founder doors — CLAUDE.md "four fixed doors" (founder-doors.ts). */
export const FOUNDER_DOOR_ROUTES = [
  "/founder",
  "/founder/decisions",
  "/founder/autopilot/control",
  "/founder/autopilot/story",
] as const;

/** Everything a customer session can reach without a founder cookie. */
export const CUSTOMER_AUDIT_ROUTES = [
  ...CUSTOMER_DOOR_ROUTES,
  ...CUSTOMER_TOP_BAR_ROUTES,
] as const;
