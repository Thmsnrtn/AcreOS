/**
 * Finance › Commissions — the agent_investor commission wedge (Wave 2 pass C).
 *
 * A CUSTOMER-facing commission surface that lives BEHIND the Finance door
 * (route /finance/commissions, linked from the Finance module's overflow).
 * It is NOT a new top-level nav entry — the five customer doors
 * (Today · Map · Deals · Finance · Pax) are unchanged.
 *
 * Gating: NONE (agent_investor work item 1, 2026-11-25 — tailor, never
 * wall). This page used to return NotFound for every non-agent_investor
 * org — the product's only page-level hard gate — and the Finance overflow
 * child was persona-gated to match. Both gates are removed: the page
 * renders for every org. The data + write paths reuse the existing
 * commission APIs (routes-organization.ts, requireAdminOrAbove +
 * org-scoped) — so any org owner/admin sees THEIR OWN org's records and
 * YTD summaries, with honest empty/zero states when nothing is configured.
 * We do NOT widen the founder-only /commissions surface or the admin
 * write scope.
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
  // No persona gate (agent_investor work item 1, 2026-11-25): every org
  // renders the commission surface with the honest scope note. An org with
  // nothing configured sees CommissionsPage's empty/zero states — never a
  // fabricated commission — exactly as an unconfigured agent_investor org
  // always did.
  return <CommissionsPage intro={<CommissionScopeNote />} />;
}
