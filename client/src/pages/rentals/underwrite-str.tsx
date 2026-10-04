/**
 * Underwrite a short-term rental — the short_term_rental vertical's decision
 * desk.
 *
 * Lives behind the Rentals module (short-term rental orgs only), not a new
 * door. The numbers come from the `str_acquisition` engine; recording freezes
 * them and the operator's call under the short_term_rental pack, with their own
 * review date (POST /api/str/underwrite).
 */
import { useSearch } from "wouter";
import { PageShell } from "@/components/page-shell";
import { UnderwritingWorkbench } from "@/components/underwriting/UnderwritingWorkbench";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { STR_ACQUISITION_FIELDS } from "@shared/economics/fields/strAcquisition";
import type { ScenarioMetric } from "@shared/economics/scenario";
import type { DecisionKind } from "@shared/decisions/snapshot";

function usd(cents: number | undefined): string {
  return cents === undefined ? "?" : `$${Math.round(cents / 100).toLocaleString("en-US")}`;
}

function describeChoice(kind: DecisionKind, inputs: Record<string, number>, metrics: ScenarioMetric[]): string {
  const price = usd(inputs.purchasePriceCents);
  // Nightly rate and occupancy are the operator's own inputs, not engine figures.
  const details: string[] = [];
  if (inputs.averageDailyRateCents !== undefined) details.push(`${usd(inputs.averageDailyRateCents)}/night`);
  if (inputs.occupancyPct !== undefined) details.push(`${inputs.occupancyPct}% occupancy`);
  const cap = metrics.find((m) => m.id === "cap_rate")?.value;
  if (cap !== null && cap !== undefined) details.push(`${(cap * 100).toFixed(1)}% cap rate`);
  const detailText = details.length > 0 ? ` (${details.join(", ")})` : "";
  if (kind === "pass") return `Pass on the short-term rental at ${price}`;
  if (kind === "offer") return `Offer ${price} to run it as a short-term rental${detailText}`;
  return `Buy at ${price} to run as a short-term rental${detailText}`;
}

export default function UnderwriteStrPage() {
  useDocumentTitle("Underwrite a short-term rental");
  const params = new URLSearchParams(useSearch());
  const initial = Number(params.get("propertyId"));
  return (
    <PageShell label="Underwrite a short-term rental">
      <div className="mx-auto max-w-3xl space-y-4 p-4">
        <div>
          <h1 className="text-xl font-semibold">Underwrite a short-term rental</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Run the numbers on buying a property to rent by the night — your nightly rate on the
            nights you expect to book, a cleaning cost for every turnover, platform and management
            fees, fixed costs, reserves and financing — then record your call. Pick when you'll
            know how it went, and Today asks you then, so the result can be compared with what you
            expected here.
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            The nightly rate and occupancy are your own figures; no market rate is looked up.
            Lodging and occupancy tax is charged to guests and passed through, so it is not
            modelled — enter rates and fees without it. The results are what the property earns
            if your inputs hold, not a forecast.
          </p>
        </div>
        <UnderwritingWorkbench
          engineId="str_acquisition"
          fields={STR_ACQUISITION_FIELDS}
          decideEndpoint="/api/str/underwrite"
          kinds={["acquire", "offer", "pass"]}
          headlineMetrics={["annual_noi", "monthly_cash_flow", "cap_rate", "cash_on_cash", "dscr", "effective_gross_income", "cash_required", "total_cost"]}
          describeChoice={describeChoice}
          initialPropertyId={Number.isInteger(initial) && initial > 0 ? initial : null}
          testIdPrefix="underwrite-str"
        />
      </div>
    </PageShell>
  );
}
