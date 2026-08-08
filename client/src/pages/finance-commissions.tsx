/**
 * Finance › Commissions — the agent_investor commission wedge (Wave 2 pass C).
 *
 * A CUSTOMER-facing commission surface that lives BEHIND the Finance door
 * (route /finance/commissions, linked from the Finance module's overflow with
 * a businessTypeOnly=["agent_investor"] gate). It is NOT a new top-level nav
 * entry — the five customer doors (Today · Map · Deals · Finance · Pax) are
 * unchanged.
 *
 * Gating: agent_investor orgs only. Any other org gets NotFound (the surface
 * genuinely does not exist for them). The data + write paths reuse the existing
 * commission APIs (routes-organization.ts, requireAdminOrAbove + org-scoped) —
 * so an agent_investor org owner/admin sees THEIR OWN org's records and YTD
 * summaries, with honest empty/zero states when nothing is configured. We do
 * NOT widen the founder-only /commissions surface or the admin write scope.
 *
 * The honest-partial disclosure below names what is live (commission tracking)
 * and what stays roadmap-for-core (MLS, client-vs-own-book, dual-agency) so the
 * beta is never oversold.
 */
import { AlertTriangle } from "lucide-react";
import CommissionsPage from "@/pages/commissions";
import NotFound from "@/pages/not-found";
import { PageShell } from "@/components/page-shell";
import { Skeleton } from "@/components/ui/skeleton";
import { useOrganization } from "@/hooks/use-organization";

function CommissionRoadmapDisclosure() {
  return (
    <div
      className="rounded-card border border-acr-warn/30 bg-acr-warn/10 p-4"
      role="note"
      aria-label="Commission tracking — beta scope"
    >
      <div className="flex items-start gap-3">
        <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-acr-warn" aria-hidden="true" />
        <div className="space-y-1 text-sm">
          <p className="font-semibold text-foreground">
            Commission tracking is a beta — here's exactly what's live
          </p>
          <p className="text-muted-foreground">
            Live now: tiered commission tracking, YTD summaries, and per-agent
            statements, with a commission recorded automatically when a deal
            closes (only once you've configured your tiers — never a made-up
            number before then).
          </p>
          <p className="text-muted-foreground">
            Still on the roadmap, deliberately not built yet: MLS integration
            (this is a land workspace — MLS comps are residential), separating
            client deals from your own book, and dual-agency disclosure
            paperwork. We'd rather show you nothing than fake these.
          </p>
        </div>
      </div>
    </div>
  );
}

export default function FinanceCommissionsPage() {
  const { data: organization, isLoading } = useOrganization();

  if (isLoading) {
    return (
      <PageShell label="Commissions">
        <div className="space-y-4" role="status" aria-busy="true" aria-live="polite">
          <span className="sr-only">Loading commissions</span>
          <Skeleton announce={false} className="h-20 w-full" />
          <Skeleton announce={false} className="h-32 w-full" />
        </div>
      </PageShell>
    );
  }

  const businessType = (organization?.onboardingData as any)?.businessType as
    | string
    | undefined;

  // The commission surface exists only for the agent_investor persona. Any
  // other workspace gets NotFound — honest, and it keeps the Finance door's
  // content persona-scoped without adding a nav entry.
  if (businessType !== "agent_investor") {
    return <NotFound />;
  }

  return <CommissionsPage intro={<CommissionRoadmapDisclosure />} />;
}
