/**
 * Underwrite a rental — the buy-and-hold vertical's decision desk.
 *
 * Lives behind the Rentals module (buy-and-hold orgs only), not a new door.
 * The numbers come from the `rental_acquisition` engine; recording freezes them
 * and the operator's call under the buy_and_hold pack, with their own review
 * date (POST /api/buy-and-hold/underwrite).
 *
 * Acquire → pipeline: once an `acquire` call is recorded, the desk offers the
 * next step of the loop for the SAME property — its units in the existing
 * rentals stack (/leases?tab=units). A link a human follows, nothing more: no
 * unit, lease or tenant is created by the decision, and nothing is prefilled
 * from these inputs. The rent typed here is an estimate for a purchase
 * decision; a lease's rent is a fact recorded when a lease exists, and copying
 * one into the other would present an estimate as a fact. `offer` and `pass`
 * offer no pipeline step — their next step is the review date they carry.
 */
import { Link, useSearch } from "wouter";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageShell } from "@/components/page-shell";
import { UnderwritingWorkbench } from "@/components/underwriting/UnderwritingWorkbench";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { RENTAL_ACQUISITION_FIELDS } from "@shared/economics/fields/rentalAcquisition";
import type { ScenarioMetric } from "@shared/economics/scenario";
import type { DecisionKind } from "@shared/decisions/snapshot";

function usd(cents: number | undefined): string {
  return cents === undefined ? "?" : `$${Math.round(cents / 100).toLocaleString("en-US")}`;
}

/** The pipeline handoff for a recorded call — navigation only, and only for `acquire`. */
function rentalNextStep({ kind, propertyId }: { kind: DecisionKind; propertyId: number }) {
  if (kind !== "acquire") return null;
  return (
    <div className="space-y-2 rounded-md border border-border p-3" data-testid="underwrite-rental-next-step">
      <p className="text-sm">
        Next: set up this property's units in Rentals. Nothing has been created there yet, and
        nothing from these numbers is copied over — you'll enter the real units and, once signed,
        the real lease.
      </p>
      <Button asChild variant="outline" size="sm">
        <Link href={`/leases?tab=units&propertyId=${propertyId}`} data-testid="underwrite-rental-next-step-units">
          Set up its units
          <ArrowRight className="ml-1 h-4 w-4" aria-hidden="true" />
        </Link>
      </Button>
    </div>
  );
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
          recordedNextStep={rentalNextStep}
          testIdPrefix="underwrite-rental"
        />
      </div>
    </PageShell>
  );
}
