/**
 * Underwrite a tax-lien certificate — the tax lien / deed vertical's decision
 * desk.
 *
 * Lives behind the Tax-delinquent module (tax lien / deed orgs only), not a new
 * door. The numbers come from the `tax_lien_bid` engine; recording freezes them
 * and the operator's call under the tax_lien_deed pack, with their own review
 * date (POST /api/tax-lien-underwriting/underwrite). Every rate is the
 * operator's own input; the State rules page is linked for reference only.
 */
import { Link, useSearch } from "wouter";
import { PageShell } from "@/components/page-shell";
import { UnderwritingWorkbench } from "@/components/underwriting/UnderwritingWorkbench";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { TAX_LIEN_BID_FIELDS } from "@shared/economics/fields/taxLienBid";
import type { ScenarioMetric } from "@shared/economics/scenario";
import type { DecisionKind } from "@shared/decisions/snapshot";

function usd(cents: number | undefined): string {
  return cents === undefined ? "?" : `$${Math.round(cents / 100).toLocaleString("en-US")}`;
}

function describeChoice(kind: DecisionKind, inputs: Record<string, number>, metrics: ScenarioMetric[]): string {
  const face = usd(inputs.faceAmountCents);
  const premium = inputs.premiumCents === 0 ? "no premium" : `a ${usd(inputs.premiumCents)} premium`;
  const rate = inputs.interestRatePct === undefined ? "" : ` at ${inputs.interestRatePct}% a year`;
  const month = inputs.redemptionMonth;
  const profit = metrics.find((m) => m.id === "profit")?.value;
  const ifRedeemed =
    profit === null || profit === undefined || month === undefined
      ? ""
      : ` (${profit < 0 ? "a loss of " : ""}${usd(Math.abs(profit))}${profit < 0 ? "" : " profit"} if the owner redeems in month ${month})`;
  if (kind === "pass") return `Pass on the ${face} certificate`;
  if (kind === "offer") return `Bid face plus ${premium} on the ${face} certificate${rate}${ifRedeemed}`;
  return `Bought the ${face} certificate with ${premium}${rate}${ifRedeemed}`;
}

export default function UnderwriteLienPage() {
  useDocumentTitle("Underwrite a tax lien");
  const params = new URLSearchParams(useSearch());
  const initial = Number(params.get("propertyId"));
  return (
    <PageShell label="Underwrite a tax lien">
      <div className="mx-auto max-w-3xl space-y-4 p-4">
        <div>
          <h1 className="text-xl font-semibold">Underwrite a tax lien</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Decide what to bid on a tax-lien certificate. Enter the face amount, your premium, the
            rate the certificate earns and your state's rules on penalties and premiums, then pick
            the month you expect the owner to redeem. Every return shown is the result if they
            redeem in that month, with simple interest on face. If the owner never redeems and
            you move to a deed, that is a different decision with different costs, and it is not
            modelled here.
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            No state's rate is filled in for you. Look yours up on{" "}
            <Link
              href="/state-rules"
              className="rounded-sm text-foreground underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              data-testid="underwrite-lien-state-rules-link"
            >
              State rules
            </Link>{" "}
            and confirm it with the county. Then record your call and pick when you'll know how it
            went. Today asks you then, so the result can be compared with what you expected here.
          </p>
        </div>
        <UnderwritingWorkbench
          engineId="tax_lien_bid"
          fields={TAX_LIEN_BID_FIELDS}
          decideEndpoint="/api/tax-lien-underwriting/underwrite"
          kinds={["offer", "acquire", "pass"]}
          headlineMetrics={["profit", "irr", "annualized_return", "roi", "total_cost", "hold_months"]}
          describeChoice={describeChoice}
          initialPropertyId={Number.isInteger(initial) && initial > 0 ? initial : null}
          testIdPrefix="underwrite-lien"
        />
      </div>
    </PageShell>
  );
}
