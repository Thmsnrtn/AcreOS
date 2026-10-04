/**
 * Underwrite a commercial building — the commercial vertical's decision desk.
 *
 * Lives behind the Rentals module (commercial orgs only), not a new door.
 * The numbers come from the `commercial_acquisition` engine; recording freezes
 * them and the operator's call under the commercial pack, with their own
 * review date (POST /api/commercial-underwriting/underwrite).
 */
import { useSearch } from "wouter";
import { PageShell } from "@/components/page-shell";
import { UnderwritingWorkbench } from "@/components/underwriting/UnderwritingWorkbench";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { COMMERCIAL_ACQUISITION_FIELDS } from "@shared/economics/fields/commercialAcquisition";
import type { ScenarioMetric } from "@shared/economics/scenario";
import type { DecisionKind } from "@shared/decisions/snapshot";

function usd(cents: number | undefined): string {
  return cents === undefined ? "?" : `$${Math.round(cents / 100).toLocaleString("en-US")}`;
}

function usdPerSqft(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/sq ft`;
}

function describeChoice(kind: DecisionKind, inputs: Record<string, number>, metrics: ScenarioMetric[]): string {
  const price = usd(inputs.purchasePriceCents);
  const sqft = inputs.rentableSqft;
  const building =
    sqft !== undefined ? `the ${sqft.toLocaleString("en-US")} sq ft building` : "the building";
  // Price per square foot is the operator's own two inputs divided, not an engine figure.
  const details: string[] = [];
  if (inputs.purchasePriceCents !== undefined && sqft !== undefined && sqft > 0) {
    details.push(usdPerSqft(inputs.purchasePriceCents / sqft));
  }
  const cap = metrics.find((m) => m.id === "cap_rate")?.value;
  if (cap !== null && cap !== undefined) details.push(`${(cap * 100).toFixed(1)}% cap rate`);
  const detailText = details.length > 0 ? ` (${details.join(", ")})` : "";
  if (kind === "pass") return `Pass on ${building} at ${price}`;
  if (kind === "offer") return `Offer ${price} for ${building}${detailText}`;
  return `Buy ${building} at ${price}${detailText}`;
}

export default function UnderwriteCommercialPage() {
  useDocumentTitle("Underwrite a commercial building");
  const params = new URLSearchParams(useSearch());
  const initial = Number(params.get("propertyId"));
  return (
    <PageShell label="Underwrite a commercial building">
      <div className="mx-auto max-w-3xl space-y-4 p-4">
        <div>
          <h1 className="text-xl font-semibold">Underwrite a commercial building</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Run the numbers on an office, retail or industrial building — base rent in place plus
            the expenses your leases bill back to tenants, after vacancy, then operating costs,
            management, reserves, tenant improvements and financing — and record your call. The
            result is year one as you describe it here: what the building returns if these inputs
            hold. It does not model lease rollover, rent steps or tenant credit.
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            Pick when you'll know how it went, and Today asks you then, so the result can be
            compared with what you expected here. Recording sends nothing and moves no money.
          </p>
        </div>
        <UnderwritingWorkbench
          engineId="commercial_acquisition"
          fields={COMMERCIAL_ACQUISITION_FIELDS}
          decideEndpoint="/api/commercial-underwriting/underwrite"
          kinds={["acquire", "offer", "pass"]}
          headlineMetrics={["annual_noi", "cap_rate", "monthly_cash_flow", "dscr", "cash_on_cash", "stabilized_value", "cash_required", "total_cost"]}
          describeChoice={describeChoice}
          initialPropertyId={Number.isInteger(initial) && initial > 0 ? initial : null}
          testIdPrefix="underwrite-commercial"
        />
      </div>
    </PageShell>
  );
}
