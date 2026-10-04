/**
 * Underwrite a mobile-home park — the mobile_home vertical's decision desk.
 *
 * Lives behind the Rentals module (mobile_home orgs only), not a new door.
 * The numbers come from the `park_acquisition` engine; recording freezes them
 * and the operator's call under the mobile_home pack, with their own review
 * date (POST /api/park-underwriting/underwrite).
 */
import { useSearch } from "wouter";
import { PageShell } from "@/components/page-shell";
import { UnderwritingWorkbench } from "@/components/underwriting/UnderwritingWorkbench";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { PARK_ACQUISITION_FIELDS } from "@shared/economics/fields/parkAcquisition";
import type { ScenarioMetric } from "@shared/economics/scenario";
import type { DecisionKind } from "@shared/decisions/snapshot";

function usd(cents: number | undefined): string {
  return cents === undefined ? "?" : `$${Math.round(cents / 100).toLocaleString("en-US")}`;
}

function describeChoice(kind: DecisionKind, inputs: Record<string, number>, metrics: ScenarioMetric[]): string {
  const price = usd(inputs.purchasePriceCents);
  const lots = inputs.totalLots;
  const park = lots !== undefined ? `the ${lots}-lot park` : "the park";
  // Occupancy and price per lot are the operator's own inputs divided, not
  // engine figures.
  const details: string[] = [];
  if (lots !== undefined && lots > 0 && inputs.occupiedLots !== undefined) {
    details.push(`${Math.round((inputs.occupiedLots / lots) * 100)}% of lots occupied`);
  }
  if (inputs.purchasePriceCents !== undefined && lots !== undefined && lots > 0) {
    details.push(`${usd(inputs.purchasePriceCents / lots)}/lot`);
  }
  const cap = metrics.find((m) => m.id === "cap_rate")?.value;
  if (cap !== null && cap !== undefined) details.push(`${(cap * 100).toFixed(1)}% cap rate`);
  const detailText = details.length > 0 ? ` (${details.join(", ")})` : "";
  if (kind === "pass") return `Pass on ${park} at ${price}${detailText}`;
  if (kind === "offer") return `Offer ${price} for ${park}${detailText}`;
  return `Buy ${park} at ${price}${detailText}`;
}

export default function UnderwriteParkPage() {
  useDocumentTitle("Underwrite a park");
  const params = new URLSearchParams(useSearch());
  const initial = Number(params.get("propertyId"));
  return (
    <PageShell label="Underwrite a park">
      <div className="mx-auto max-w-3xl space-y-4 p-4">
        <div>
          <h1 className="text-xl font-semibold">Underwrite a park</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Run the numbers on a mobile-home park: lot rent from the lots that are occupied today,
            park-owned home rent as its own line, other income, credit loss, operating costs,
            management, a per-lot capex reserve and financing. Then record your call. Pick when
            you'll know how it went, and Today asks you then, so the result can be compared with
            what you expected here.
          </p>
        </div>
        <UnderwritingWorkbench
          engineId="park_acquisition"
          fields={PARK_ACQUISITION_FIELDS}
          decideEndpoint="/api/park-underwriting/underwrite"
          kinds={["acquire", "offer", "pass"]}
          headlineMetrics={["annual_noi", "cap_rate", "monthly_cash_flow", "dscr", "cash_on_cash", "stabilized_value", "cash_required", "total_cost"]}
          describeChoice={describeChoice}
          initialPropertyId={Number.isInteger(initial) && initial > 0 ? initial : null}
          testIdPrefix="underwrite-park"
        />
      </div>
    </PageShell>
  );
}
