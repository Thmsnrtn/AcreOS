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
 * Three priority personas have real content today (per the 12-agent
 * audit's leapfrog rankings):
 *   - tax_delinquent
 *   - note_investor (+ note_originator + note_servicer fallback)
 *   - wholesaler
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

const InboxTab = lazy(() =>
  import("../InboxTab").then((m) => ({ default: m.InboxTab })),
);

function tabFallback() {
  return (
    <div className="text-sm text-muted-foreground py-8 text-center">Loading…</div>
  );
}

export function renderPersonaTab(tab: TabId, persona: Persona | undefined): ReactNode {
  // Universal — same for all personas.
  if (tab === "inbox") {
    return (
      <Suspense fallback={tabFallback()}>
        <InboxTab />
      </Suspense>
    );
  }

  // Persona-specific Today / Portfolio. Pipeline still falls through to
  // the generic placeholder; the existing `/deals` page handles that
  // surface today and a persona-aware Pipeline tab is the next iteration.
  if (tab === "today") {
    if (persona === "tax_delinquent") {
      return <Suspense fallback={tabFallback()}><TaxDelinquentToday /></Suspense>;
    }
    if (persona === "note_investor" || persona === "note_originator" || persona === "note_servicer") {
      return <Suspense fallback={tabFallback()}><NoteInvestorToday /></Suspense>;
    }
    if (persona === "wholesaler") {
      return <Suspense fallback={tabFallback()}><WholesalerToday /></Suspense>;
    }
  }

  if (tab === "portfolio") {
    if (persona === "tax_delinquent") {
      return <Suspense fallback={tabFallback()}><TaxDelinquentPortfolio /></Suspense>;
    }
    if (persona === "note_investor" || persona === "note_originator" || persona === "note_servicer") {
      return <Suspense fallback={tabFallback()}><NoteInvestorPortfolio /></Suspense>;
    }
    if (persona === "wholesaler") {
      return <Suspense fallback={tabFallback()}><WholesalerPortfolio /></Suspense>;
    }
  }

  // Pipeline + unsupported persona/tab combos fall through to the
  // shell's generic placeholder card.
  return null;
}
