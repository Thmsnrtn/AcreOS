/**
 * Founder-only AI console (founder directive 2026-09-02, "make the agent area
 * in the ai section way cleaner").
 *
 * These three panels are the founder's own instrument surface. They used to
 * live inside client/src/pages/command-center.tsx — the CUSTOMER's Pax door
 * (/ai) — behind `FOUNDER_ONLY_TABS` + `isFounder`. The guard was real; the
 * FILE was the problem: the founder's vocabulary sat in the customer's file.
 *
 * command-center.tsx still owns the guard and renders each panel behind the
 * same `mainTab === … && isFounder` condition. Nothing here is routed, and
 * nothing here adds a nav entry (CLAUDE.md: four founder doors + the
 * /founder/admin/* instrument namespace).
 */
export { VaTeamPanel } from "./VaTeamPanel";
export { BackgroundServicesPanel } from "./BackgroundServicesPanel";
export { AiOperationsPanel } from "./AiOperationsPanel";
