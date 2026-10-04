/**
 * Underwrite a wrap — the creative-finance vertical's decision desk.
 *
 * "Do I take this property subject-to (or on seller-carry) and resell it on a
 * wrap-around note?" Lives behind the Creative finance module (creative_finance
 * orgs only), not a new door. The numbers come from the `creative_wrap` engine;
 * recording freezes them and the operator's call under the creative_finance
 * pack, with their own review date (POST /api/creative-finance/underwrite).
 *
 * Arithmetic only: not a compliance or legal determination, and AcreOS never
 * collects or disburses the payments it models.
 */
import { Link, useSearch } from "wouter";
import { PageShell } from "@/components/page-shell";
import { UnderwritingWorkbench } from "@/components/underwriting/UnderwritingWorkbench";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { CREATIVE_WRAP_FIELDS } from "@shared/economics/fields/creativeWrap";
import type { ScenarioMetric } from "@shared/economics/scenario";
import type { DecisionKind } from "@shared/decisions/snapshot";

function usd(cents: number | undefined): string {
  return cents === undefined ? "?" : `$${Math.round(cents / 100).toLocaleString("en-US")}`;
}

function describeChoice(kind: DecisionKind, inputs: Record<string, number>, metrics: ScenarioMetric[]): string {
  const price = usd(inputs.salePriceCents);
  const balance = usd(inputs.underlyingBalanceCents);
  const deal = `the property subject to the ${balance} loan`;
  const details: string[] = [];
  const spread = metrics.find((m) => m.id === "monthly_cash_flow")?.value;
  if (spread !== null && spread !== undefined) details.push(`${spread < 0 ? "−" : ""}${usd(Math.abs(spread))}/mo spread`);
  if (inputs.horizonMonths !== undefined) details.push(`buyer pays off in month ${inputs.horizonMonths}`);
  const detailText = details.length > 0 ? ` (${details.join(", ")})` : "";
  if (kind === "pass") return `Pass on taking ${deal}`;
  if (kind === "offer") return `Offer ${usd(inputs.cashToSellerCents)} cash to the seller for ${deal}, to resell at ${price} on a wrap${detailText}`;
  return `Take ${deal} and resell at ${price} on a wrap${detailText}`;
}

const linkClass =
  "underline underline-offset-2 hover:text-foreground rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export default function UnderwriteWrapPage() {
  useDocumentTitle("Underwrite a wrap");
  const params = new URLSearchParams(useSearch());
  const initial = Number(params.get("propertyId"));
  return (
    <PageShell label="Underwrite a wrap">
      <div className="mx-auto max-w-3xl space-y-4 p-4">
        <div className="space-y-2">
          <h1 className="text-xl font-semibold">Underwrite a wrap</h1>
          <p className="text-sm text-muted-foreground">
            Take a property subject to its loan (or on a seller carry-back), resell it on a
            wrap-around note, and see what you earn: the monthly spread between the buyer's payment
            and the loan you keep paying, and the balance spread when the buyer refinances or pays
            off. Profit and IRR are the result if the inputs hold — the buyer pays every month and
            pays off in the month you pick, and the underlying lender keeps the loan on its schedule.
            A missed payment, an earlier or later payoff, or a lender calling the loan due changes
            them. The model also assumes you resell on the wrap in the same month you take the
            property: months spent repairing or marketing it, while you pay the underlying loan with
            no wrap payment coming in, are not counted, and would lower the result.
          </p>
          <p className="text-sm text-muted-foreground">
            This is arithmetic only — not a compliance or legal determination about whether you may
            originate the wrap. Screen the terms with the{" "}
            <Link href="/dodd-frank" className={linkClass}>
              Dodd-Frank checker
            </Link>{" "}
            and read your state's{" "}
            <Link href="/regulatory-intel" className={linkClass}>
              seller-financing rules
            </Link>
            .
          </p>
          <p className="text-sm text-muted-foreground">
            Pick the property, record your call, and pick when you'll know how it went. Today asks
            you then, so the result can be compared with what you expected here. Recording a decision
            sends nothing and moves no money: AcreOS does not collect the buyer's payments or pay the
            underlying loan.
          </p>
        </div>
        <UnderwritingWorkbench
          engineId="creative_wrap"
          fields={CREATIVE_WRAP_FIELDS}
          decideEndpoint="/api/creative-finance/underwrite"
          kinds={["acquire", "offer", "pass"]}
          headlineMetrics={["monthly_cash_flow", "profit", "irr", "cash_required", "total_cost", "hold_months"]}
          describeChoice={describeChoice}
          initialPropertyId={Number.isInteger(initial) && initial > 0 ? initial : null}
          testIdPrefix="underwrite-wrap"
        />
      </div>
    </PageShell>
  );
}
