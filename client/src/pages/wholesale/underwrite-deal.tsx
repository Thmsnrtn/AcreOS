/**
 * Underwrite a wholesale deal — the residential wholesaler vertical's decision desk.
 *
 * Lives behind the Wholesale module (wholesaler orgs only), not a new door.
 * The numbers come from the `wholesale_assignment` engine; recording freezes
 * them and the operator's call under the residential_wholesaler pack, with
 * their own review date (POST /api/wholesale/underwrite).
 */
import { useSearch } from "wouter";
import { PageShell } from "@/components/page-shell";
import { UnderwritingWorkbench } from "@/components/underwriting/UnderwritingWorkbench";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { WHOLESALE_ASSIGNMENT_FIELDS } from "@shared/economics/fields/wholesaleAssignment";
import type { ScenarioMetric } from "@shared/economics/scenario";
import type { DecisionKind } from "@shared/decisions/snapshot";

function usd(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "?";
  const sign = cents < 0 ? "−" : "";
  return `${sign}$${Math.abs(Math.round(cents / 100)).toLocaleString("en-US")}`;
}

function describeChoice(kind: DecisionKind, inputs: Record<string, number>, metrics: ScenarioMetric[]): string {
  const price = usd(inputs.contractPriceCents);
  const fee = metrics.find((m) => m.id === "assignment_fee")?.value;
  const feeText = fee === null || fee === undefined ? "" : ` (assignment fee ${usd(fee)})`;
  if (kind === "pass") return `Pass at ${price}`;
  if (kind === "offer") return `Offer ${price} to put it under contract${feeText}`;
  return `Keep working the seller toward ${price}${feeText}`;
}

export default function UnderwriteWholesaleDealPage() {
  useDocumentTitle("Underwrite a wholesale deal");
  const params = new URLSearchParams(useSearch());
  const initial = Number(params.get("propertyId"));
  return (
    <PageShell label="Underwrite a wholesale deal">
      <div className="mx-auto max-w-3xl space-y-4 p-4">
        <div>
          <h1 className="text-xl font-semibold">Underwrite a wholesale deal</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Work out what a cash buyer will pay — ARV on their rule, less their repairs — and the fee
            left for you at your contract price, after what the deal cost you. Then record your call.
            Pick when you'll know how it went, and Today asks you then, so the fee you actually got
            can be compared with the one you expected here.
          </p>
        </div>
        <UnderwritingWorkbench
          engineId="wholesale_assignment"
          fields={WHOLESALE_ASSIGNMENT_FIELDS}
          decideEndpoint="/api/wholesale/underwrite"
          kinds={["offer", "pursue", "pass"]}
          headlineMetrics={["assignment_fee", "buyer_max_price", "profit", "total_cost", "roi"]}
          describeChoice={describeChoice}
          initialPropertyId={Number.isInteger(initial) && initial > 0 ? initial : null}
          testIdPrefix="underwrite-wholesale"
        />
      </div>
    </PageShell>
  );
}
