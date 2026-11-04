/**
 * Underwrite a rental — the buy-and-hold vertical's decision desk.
 *
 * Lives behind the Rentals module (buy-and-hold orgs only), not a new door.
 * The numbers come from the `rental_acquisition` engine; recording freezes them
 * and the operator's call under the buy_and_hold pack, with their own review
 * date (POST /api/buy-and-hold/underwrite).
 */
import { useSearch } from "wouter";
import { PageShell } from "@/components/page-shell";
import { UnderwritingWorkbench } from "@/components/underwriting/UnderwritingWorkbench";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { RENTAL_ACQUISITION_FIELDS } from "@shared/economics/fields/rentalAcquisition";
import type { ScenarioMetric } from "@shared/economics/scenario";
import type { DecisionKind } from "@shared/decisions/snapshot";

function usd(cents: number | undefined): string {
  return cents === undefined ? "?" : `$${Math.round(cents / 100).toLocaleString("en-US")}`;
}

function describeChoice(kind: DecisionKind, inputs: Record<string, number>, metrics: ScenarioMetric[]): string {
  const price = usd(inputs.purchasePriceCents);
  const coc = metrics.find((m) => m.id === "cash_on_cash")?.value;
  const cocText = coc === null || coc === undefined ? "" : ` (${(coc * 100).toFixed(1)}% cash-on-cash)`;
  if (kind === "pass") return `Pass at ${price}`;
  if (kind === "offer") return `Offer ${price}${cocText}`;
  return `Buy and hold at ${price}${cocText}`;
}

export default function UnderwriteRentalPage() {
  useDocumentTitle("Underwrite a rental");
  const params = new URLSearchParams(useSearch());
  const initial = Number(params.get("propertyId"));
  return (
    <PageShell label="Underwrite a rental">
      <div className="mx-auto max-w-3xl space-y-4 p-4">
        <div>
          <h1 className="text-xl font-semibold">Underwrite a rental</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Run the numbers on a buy-and-hold purchase — income after vacancy, real expenses,
            financing — then record your call. Pick when you'll know how it went, and Today asks
            you then, so the result can be compared with what you expected here.
          </p>
        </div>
        <UnderwritingWorkbench
          engineId="rental_acquisition"
          fields={RENTAL_ACQUISITION_FIELDS}
          decideEndpoint="/api/buy-and-hold/underwrite"
          kinds={["acquire", "offer", "pass"]}
          headlineMetrics={["monthly_cash_flow", "cash_on_cash", "cap_rate", "dscr", "cash_required", "total_cost"]}
          describeChoice={describeChoice}
          initialPropertyId={Number.isInteger(initial) && initial > 0 ? initial : null}
          testIdPrefix="underwrite-rental"
        />
      </div>
    </PageShell>
  );
}
