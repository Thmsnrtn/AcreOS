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
 * The note below claims ONLY what a customer can reach today (W2-AGENT,
 * 2026-11-06). It used to call net-of-split economics, a pipeline GCI
 * forecast, client-vs-own-book tagging, a dual-agency tracker and automatic
 * commission recording "live now" — none had a screen, and recording needs a
 * deal assigned to an agent, which nothing in AcreOS can set. Those are named
 * as not set up yet; agentInvestorCommissionScope.test.tsx pins each live
 * claim to a real client caller.
 */
import { AlertTriangle } from "lucide-react";
import CommissionsPage from "@/pages/commissions";
import NotFound from "@/pages/not-found";
import { PageShell } from "@/components/page-shell";
import { Skeleton } from "@/components/ui/skeleton";
import { useOrganization } from "@/hooks/use-organization";

export function CommissionScopeNote() {
  return (
    <div
      className="rounded-card border border-acr-warn/30 bg-acr-warn/10 p-4"
      role="note"
      aria-label="What commissions covers today"
    >
      <div className="flex items-start gap-3">
        <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-acr-warn" aria-hidden="true" />
        <div className="space-y-1 text-sm text-muted-foreground">
          <p className="font-semibold text-foreground">What works today</p>
          <ul className="list-disc pl-4 space-y-1" data-testid="commission-scope-live">
            <li>
              A CMA on each deal&apos;s Analysis tab, from your connected ATTOM key or
              credits. Without one it says &ldquo;unavailable&rdquo; rather than guess.
            </li>
            <li>
              An agency disclosure record on each deal&apos;s Details tab: the side you
              represented, the date a disclosure was acknowledged and a link to it.
              Record only: AcreOS doesn&apos;t prepare, send or sign disclosures.
            </li>
          </ul>
          <p data-testid="commission-scope-not-yet">
            Not set up in AcreOS yet: your commission rates, your broker split,
            assigning a deal to an agent, tagging your own investments and a
            pipeline forecast. Until then AcreOS records no new commission, and
            it never estimates one.
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

  return <CommissionsPage intro={<CommissionScopeNote />} />;
}
