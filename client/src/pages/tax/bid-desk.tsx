/**
 * Work out your max bid — the tax lien / deed vertical's decision desk
 * (Step 0 item T5).
 *
 * Reached from the tax-delinquent pipeline, not a new door. The numbers
 * come from the `tax_max_bid` engine: your stated value for the lot,
 * less the liens your own search says survive, the other taxes, your
 * costs to clear and hold, and the return you require. Recording freezes
 * them and your call under the tax_lien_deed pack, with your own review
 * date (POST /api/tax-lien/underwrite), so the outcome can later be
 * graded against what the lot actually did.
 *
 * The numbers are typed by the operator from their own search and
 * valuation. Nothing here pulls a value, a lien or a bid — and the
 * recorded max bid is a screen, never an auction bid placed by AcreOS.
 */
import { useSearch } from "wouter";
import { PageShell } from "@/components/page-shell";
import { UnderwritingWorkbench } from "@/components/underwriting/UnderwritingWorkbench";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { TAX_MAX_BID_FIELDS } from "@shared/economics/fields/taxMaxBid";
import type { ScenarioMetric } from "@shared/economics/scenario";
import type { DecisionKind } from "@shared/decisions/snapshot";

function usd(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "?";
  return `${cents < 0 ? "−" : ""}$${Math.abs(Math.round(cents / 100)).toLocaleString("en-US")}`;
}

function describeChoice(kind: DecisionKind, _inputs: Record<string, number | string>, metrics: ScenarioMetric[]): string {
  const maxBid = metrics.find((m) => m.id === "max_allowable_offer")?.value;
  if (kind === "pass") return `No bid — my max on this stack is ${usd(maxBid)}`;
  return `Bid up to ${usd(maxBid)}`;
}

export default function TaxBidDeskPage() {
  useDocumentTitle("Work out your max bid");
  const params = new URLSearchParams(useSearch());
  const initial = Number(params.get("propertyId"));
  return (
    <PageShell label="Work out your max bid">
      <div className="mx-auto max-w-3xl space-y-4 p-4">
        <div>
          <h1 className="text-xl font-semibold">Work out your max bid</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Start from what the lot is worth and subtract everything that stands ahead of you:
            the liens your own search says survive the sale, other taxes, your costs to clear
            title and hold, and the return you require. What's left is the most you can bid.
            Record your call and pick when you'll know how it went.
          </p>
        </div>
        <UnderwritingWorkbench
          engineId="tax_max_bid"
          fields={TAX_MAX_BID_FIELDS}
          decideEndpoint="/api/tax-lien/underwrite"
          kinds={["offer", "pass"]}
          headlineMetrics={["max_allowable_offer", "total_cost", "profit"]}
          describeChoice={describeChoice}
          initialPropertyId={Number.isInteger(initial) && initial > 0 ? initial : null}
          testIdPrefix="underwrite-tax-bid"
        />
      </div>
    </PageShell>
  );
}
