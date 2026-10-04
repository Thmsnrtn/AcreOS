/**
 * Development pro-forma — the developer vertical's decision desk.
 *
 * Lives behind the Subdivision module (developer orgs only), not a new door.
 * The numbers come from the `development_proforma` engine; recording freezes
 * them and the operator's call under the developer pack, with their own review
 * date (POST /api/development/underwrite).
 */
import { useSearch } from "wouter";
import { PageShell } from "@/components/page-shell";
import { UnderwritingWorkbench } from "@/components/underwriting/UnderwritingWorkbench";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { DEVELOPMENT_PROFORMA_FIELDS } from "@shared/economics/fields/developmentProforma";
import type { ScenarioMetric } from "@shared/economics/scenario";
import type { DecisionKind } from "@shared/decisions/snapshot";

function usd(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "?";
  const whole = Math.round(cents / 100);
  return `${whole < 0 ? "−" : ""}$${Math.abs(whole).toLocaleString("en-US")}`;
}

function describeChoice(kind: DecisionKind, inputs: Record<string, number>, metrics: ScenarioMetric[]): string {
  const price = usd(inputs.landCostCents);
  const lots = inputs.lotCount;
  const lotsText = lots === undefined ? "" : ` for ${lots.toLocaleString("en-US")} lots`;
  const profit = metrics.find((m) => m.id === "profit")?.value;
  const irr = metrics.find((m) => m.id === "irr")?.value;
  const parts = [
    profit === null || profit === undefined ? null : `${usd(profit)} profit`,
    irr === null || irr === undefined ? null : `${(irr * 100).toFixed(1)}% IRR`,
  ].filter(Boolean);
  const numbers = parts.length ? ` (${parts.join(", ")})` : "";
  if (kind === "pass") return `Pass on the land at ${price}`;
  if (kind === "pursue") return `Keep pursuing the land at ${price}${lotsText}${numbers}`;
  return `Buy and develop at ${price}${lotsText}${numbers}`;
}

export default function DevelopmentProformaPage() {
  useDocumentTitle("Development pro-forma");
  const params = new URLSearchParams(useSearch());
  const initial = Number(params.get("propertyId"));
  return (
    <PageShell label="Development pro-forma">
      <div className="mx-auto max-w-3xl space-y-4 p-4">
        <div>
          <h1 className="text-xl font-semibold">Development pro-forma</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Run the go/no-go on buying land to develop: land, entitlement and improvement costs,
            carry over the whole hold, and what the lots sell for after selling costs. Pick the
            parcel you would buy, then record your call. Pick when you'll know how it went, and
            Today asks you then, so the result can be compared with what you expected here.
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            The timeline is simple on purpose: land and entitlement costs are paid at closing,
            improvement spending is spread evenly over the build months, lots sell evenly over the
            sell-out months, and carry runs every month until the last lot closes.
          </p>
        </div>
        <UnderwritingWorkbench
          engineId="development_proforma"
          fields={DEVELOPMENT_PROFORMA_FIELDS}
          decideEndpoint="/api/development/underwrite"
          kinds={["acquire", "pursue", "pass"]}
          headlineMetrics={["profit", "irr", "roi", "gross_sellout", "total_cost", "hold_months"]}
          describeChoice={describeChoice}
          initialPropertyId={Number.isInteger(initial) && initial > 0 ? initial : null}
          testIdPrefix="development-proforma"
        />
      </div>
    </PageShell>
  );
}
