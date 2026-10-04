/**
 * Underwrite a deal for your own account — the agent-investor vertical's
 * decision desk.
 *
 * Lives behind the Deals door (agent-investor orgs only), not a new door. The
 * numbers come from the `agent_flip` engine: the buy-side commission the agent
 * keeps is credited against the purchase, and only the brokerage's cut of the
 * agent's own listing commission is a selling cost. Recording freezes them and
 * the operator's call under the agent_investor pack, with their own review
 * date (POST /api/agent-investor/underwrite).
 */
import { Link, useSearch } from "wouter";
import { PageShell } from "@/components/page-shell";
import { UnderwritingWorkbench } from "@/components/underwriting/UnderwritingWorkbench";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { AGENT_FLIP_FIELDS } from "@shared/economics/fields/agentFlip";
import { buySideCreditCents } from "@shared/calculators/agentFlip";
import type { ScenarioMetric } from "@shared/economics/scenario";
import type { DecisionKind } from "@shared/decisions/snapshot";

function usd(cents: number | undefined): string {
  if (cents === undefined) return "?";
  const whole = Math.round(cents / 100);
  return `${whole < 0 ? "−" : ""}$${Math.abs(whole).toLocaleString("en-US")}`;
}

function describeChoice(kind: DecisionKind, inputs: Record<string, number>, metrics: ScenarioMetric[]): string {
  const price = usd(inputs.purchasePriceCents);
  const { purchasePriceCents: p, buySideCommissionPct: c, buySideBrokerageSplitPct: s } = inputs;
  // The same arithmetic the engine uses, from the operator's own three inputs.
  const credit = p === undefined || c === undefined || s === undefined ? undefined : buySideCreditCents(p, c, s);
  const creditText = credit === undefined || credit === 0 ? "" : `, keeping ${usd(credit)} of buy-side commission`;
  const profit = metrics.find((m) => m.id === "profit")?.value;
  const profitText = profit === null || profit === undefined ? "" : ` (${usd(profit)} profit if the inputs hold)`;
  if (kind === "pass") return `Pass at ${price}`;
  if (kind === "offer") return `Offer ${price} for my own account${creditText}${profitText}`;
  return `Buy for my own account at ${price}${creditText}${profitText}`;
}

export default function UnderwriteOwnDealPage() {
  useDocumentTitle("Underwrite a deal for your own account");
  const params = new URLSearchParams(useSearch());
  const initial = Number(params.get("propertyId"));
  return (
    <PageShell label="Underwrite a deal for your own account">
      <div className="mx-auto max-w-3xl space-y-4 p-4">
        <div>
          <h1 className="text-xl font-semibold">Underwrite a deal for your own account</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Run a flip the way a licensed agent actually pays for one. The buy-side commission you
            earn on your own purchase, less your brokerage's split, comes off what the deal costs
            you. On the sale, your own listing commission is money you pay yourself, so only your
            brokerage's cut of it counts as a cost; the co-op commission to the buyer's agent counts
            in full. The profit shown is the result if these inputs hold. Record your call and pick
            when you'll know how it went. Today asks you then, so the result can be compared with
            what you expected here.
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            Buying for your own account carries disclosure duties to the seller and your brokerage.
            Meeting them is yours to do; nothing on this page checks them, and nothing here is legal
            advice. Enter your split by hand here; your commission records are on{" "}
            <Link
              href="/finance/commissions"
              className="rounded-sm underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Commissions
            </Link>
            .
          </p>
        </div>
        <UnderwritingWorkbench
          engineId="agent_flip"
          fields={AGENT_FLIP_FIELDS}
          decideEndpoint="/api/agent-investor/underwrite"
          kinds={["acquire", "offer", "pass"]}
          headlineMetrics={["profit", "roi", "annualized_return", "total_cost", "net_proceeds", "hold_months"]}
          describeChoice={describeChoice}
          initialPropertyId={Number.isInteger(initial) && initial > 0 ? initial : null}
          testIdPrefix="underwrite-own-deal"
        />
      </div>
    </PageShell>
  );
}
