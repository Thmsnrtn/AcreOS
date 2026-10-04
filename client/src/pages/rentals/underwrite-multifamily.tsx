/**
 * Underwrite an apartment building — the multifamily vertical's decision desk.
 *
 * Lives behind the Rentals module (multifamily orgs only), not a new door.
 * The numbers come from the `multifamily_acquisition` engine; recording freezes
 * them and the operator's call under the multifamily pack, with their own
 * review date (POST /api/multifamily/underwrite).
 */
import { useSearch } from "wouter";
import { PageShell } from "@/components/page-shell";
import { UnderwritingWorkbench } from "@/components/underwriting/UnderwritingWorkbench";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { MULTIFAMILY_ACQUISITION_FIELDS } from "@shared/economics/fields/multifamilyAcquisition";
import type { ScenarioMetric } from "@shared/economics/scenario";
import type { DecisionKind } from "@shared/decisions/snapshot";

function usd(cents: number | undefined): string {
  return cents === undefined ? "?" : `$${Math.round(cents / 100).toLocaleString("en-US")}`;
}

function describeChoice(kind: DecisionKind, inputs: Record<string, number>, metrics: ScenarioMetric[]): string {
  const price = usd(inputs.purchasePriceCents);
  const units = inputs.unitCount;
  const building = units !== undefined ? `the ${units}-unit building` : "the building";
  // Price per unit is the operator's own two inputs divided, not an engine figure.
  const details: string[] = [];
  if (inputs.purchasePriceCents !== undefined && units !== undefined && units > 0) {
    details.push(`${usd(inputs.purchasePriceCents / units)}/unit`);
  }
  const cap = metrics.find((m) => m.id === "cap_rate")?.value;
  if (cap !== null && cap !== undefined) details.push(`${(cap * 100).toFixed(1)}% cap rate`);
  const detailText = details.length > 0 ? ` (${details.join(", ")})` : "";
  if (kind === "pass") return `Pass on ${building} at ${price}`;
  if (kind === "offer") return `Offer ${price} for ${building}${detailText}`;
  return `Buy ${building} at ${price}${detailText}`;
}

export default function UnderwriteMultifamilyPage() {
  useDocumentTitle("Underwrite a building");
  const params = new URLSearchParams(useSearch());
  const initial = Number(params.get("propertyId"));
  return (
    <PageShell label="Underwrite a building">
      <div className="mx-auto max-w-3xl space-y-4 p-4">
        <div>
          <h1 className="text-xl font-semibold">Underwrite a building</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Run the numbers on an apartment building unit by unit — rents and other income after
            vacancy, operating costs, management, per-unit reserves and financing — then record
            your call. Pick when you'll know how it went, and Today asks you then, so the result
            can be compared with what you expected here.
          </p>
        </div>
        <UnderwritingWorkbench
          engineId="multifamily_acquisition"
          fields={MULTIFAMILY_ACQUISITION_FIELDS}
          decideEndpoint="/api/multifamily/underwrite"
          kinds={["acquire", "offer", "pass"]}
          headlineMetrics={["annual_noi", "cap_rate", "monthly_cash_flow", "dscr", "cash_on_cash", "stabilized_value", "cash_required", "total_cost"]}
          describeChoice={describeChoice}
          initialPropertyId={Number.isInteger(initial) && initial > 0 ? initial : null}
          testIdPrefix="underwrite-multifamily"
        />
      </div>
    </PageShell>
  );
}
