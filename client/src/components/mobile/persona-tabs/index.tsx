/**
 * Persona-aware tab dispatcher for the MobileShell.
 *
 * Given a tab id and the user's `Persona`, return the right component
 * for that surface. Falls back to `null` when there's no persona-specific
 * implementation yet — the shell then shows its generic placeholder.
 *
 * The Inbox tab is universal (same for all personas) and lives in
 * `../InboxTab.tsx`; only Today / Pipeline / Portfolio dispatch here.
 *
 * Personas with real content today (per audit/leapfrog rankings):
 *   - tax_delinquent
 *   - note_investor (+ note_originator + note_servicer fallback)
 *   - wholesaler
 *   - landlord
 *   - subdivider — Brigid (Lens 19 #1: subdividers run their day from
 *     stalled permit gates, perc-test queue, and lots-in-market; the
 *     Universal tabs are useless to them)
 *
 * Others render the placeholder until their content lands.
 */

import { lazy, Suspense, type ReactNode } from "react";
import type { Persona } from "@shared/models/auth";

type TabId = "today" | "inbox" | "pipeline" | "portfolio";

const TaxDelinquentToday = lazy(() =>
  import("./TaxDelinquentTabs").then((m) => ({ default: m.TaxDelinquentToday })),
);
const TaxDelinquentPortfolio = lazy(() =>
  import("./TaxDelinquentTabs").then((m) => ({ default: m.TaxDelinquentPortfolio })),
);

const NoteInvestorToday = lazy(() =>
  import("./NoteInvestorTabs").then((m) => ({ default: m.NoteInvestorToday })),
);
const NoteInvestorPortfolio = lazy(() =>
  import("./NoteInvestorTabs").then((m) => ({ default: m.NoteInvestorPortfolio })),
);

const WholesalerToday = lazy(() =>
  import("./WholesalerTabs").then((m) => ({ default: m.WholesalerToday })),
);
const WholesalerPortfolio = lazy(() =>
  import("./WholesalerTabs").then((m) => ({ default: m.WholesalerPortfolio })),
);

const LandlordToday = lazy(() =>
  import("./LandlordTabs").then((m) => ({ default: m.LandlordToday })),
);
const LandlordPortfolio = lazy(() =>
  import("./LandlordTabs").then((m) => ({ default: m.LandlordPortfolio })),
);

const SubdividerToday = lazy(() =>
  import("./SubdividerTabs").then((m) => ({ default: m.SubdividerToday })),
);
const SubdividerPortfolio = lazy(() =>
  import("./SubdividerTabs").then((m) => ({ default: m.SubdividerPortfolio })),
);

const InboxTab = lazy(() =>
  import("../InboxTab").then((m) => ({ default: m.InboxTab })),
);

const UniversalToday = lazy(() =>
  import("./UniversalTabs").then((m) => ({ default: m.UniversalToday })),
);
const UniversalPipeline = lazy(() =>
  import("./UniversalTabs").then((m) => ({ default: m.UniversalPipeline })),
);
const UniversalPortfolio = lazy(() =>
  import("./UniversalTabs").then((m) => ({ default: m.UniversalPortfolio })),
);

function tabFallback() {
  return (
    <div className="text-sm text-muted-foreground py-8 text-center">Loading…</div>
  );
}

function wrap(node: ReactNode): ReactNode {
  return <Suspense fallback={tabFallback()}>{node}</Suspense>;
}

export function renderPersonaTab(tab: TabId, persona: Persona | undefined): ReactNode {
  // Universal — same for all personas.
  if (tab === "inbox") return wrap(<InboxTab />);

  // Persona-specific Today / Portfolio + Universal fallback for personas
  // without dedicated content (Land Flipper, Fix & Flip). Pipeline always
  // uses the Universal stage view today; persona-specific Pipeline is the
  // next iteration.
  if (tab === "today") {
    if (persona === "tax_delinquent") return wrap(<TaxDelinquentToday />);
    if (persona === "note_investor" || persona === "note_originator" || persona === "note_servicer") {
      return wrap(<NoteInvestorToday />);
    }
    if (persona === "wholesaler") return wrap(<WholesalerToday />);
    if (persona === "landlord") return wrap(<LandlordToday />);
    if (persona === "subdivider") return wrap(<SubdividerToday />);
    return wrap(<UniversalToday />);
  }

  if (tab === "portfolio") {
    if (persona === "tax_delinquent") return wrap(<TaxDelinquentPortfolio />);
    if (persona === "note_investor" || persona === "note_originator" || persona === "note_servicer") {
      return wrap(<NoteInvestorPortfolio />);
    }
    if (persona === "wholesaler") return wrap(<WholesalerPortfolio />);
    if (persona === "landlord") return wrap(<LandlordPortfolio />);
    if (persona === "subdivider") return wrap(<SubdividerPortfolio />);
    return wrap(<UniversalPortfolio />);
  }

  if (tab === "pipeline") return wrap(<UniversalPipeline />);

  return null;
}
