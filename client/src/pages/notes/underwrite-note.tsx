/**
 * Underwrite a note — the note investor vertical's decision desk.
 *
 * Lives behind the Mortgage Notes module (note investor and hybrid orgs), not a
 * new door. The numbers come from the `note_acquisition` engine; recording
 * freezes them and the operator's call under the note_investor pack, with their
 * own review date (POST /api/note-underwriting/underwrite). The decision's
 * subject is the collateral property that secures the note.
 */
import { useSearch } from "wouter";
import { PageShell } from "@/components/page-shell";
import { UnderwritingWorkbench } from "@/components/underwriting/UnderwritingWorkbench";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { NOTE_ACQUISITION_FIELDS } from "@shared/economics/fields/noteAcquisition";
import type { ScenarioMetric } from "@shared/economics/scenario";
import type { DecisionKind } from "@shared/decisions/snapshot";

function usd(cents: number | undefined): string {
  return cents === undefined ? "?" : `$${Math.round(cents / 100).toLocaleString("en-US")}`;
}

function describeChoice(kind: DecisionKind, inputs: Record<string, number>, metrics: ScenarioMetric[]): string {
  const price = usd(inputs.purchasePriceCents);
  const face = usd(inputs.unpaidPrincipalCents);
  const irr = metrics.find((m) => m.id === "irr")?.value;
  const irrText = irr === null || irr === undefined ? "" : ` (${(irr * 100).toFixed(1)}% yield if it pays as agreed)`;
  if (kind === "pass") return `Pass on the note at ${price} for ${face} unpaid balance`;
  if (kind === "offer") return `Offer ${price} for the note, ${face} unpaid balance${irrText}`;
  return `Buy the note at ${price} for ${face} unpaid balance${irrText}`;
}

export default function UnderwriteNotePage() {
  useDocumentTitle("Underwrite a note");
  const params = new URLSearchParams(useSearch());
  const initial = Number(params.get("propertyId"));
  return (
    <PageShell label="Underwrite a note">
      <div className="mx-auto max-w-3xl space-y-4 p-4">
        <div>
          <h1 className="text-xl font-semibold">Underwrite a note</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Price a note before you buy it: its discount to the unpaid balance, what you collect,
            and the yield if the borrower pays exactly as scheduled. A default or late payment
            lowers that yield; an early payoff raises it on a note bought at a discount and lowers
            it on one bought at a premium. Pick the property that
            secures the note, record your call, and pick when you'll know how it went. Today asks
            you then, so the result can be compared with what you expected here.
          </p>
        </div>
        <UnderwritingWorkbench
          engineId="note_acquisition"
          fields={NOTE_ACQUISITION_FIELDS}
          decideEndpoint="/api/note-underwriting/underwrite"
          kinds={["acquire", "offer", "pass"]}
          headlineMetrics={["irr", "discount_to_face", "profit", "total_cost", "hold_months", "payoff_total"]}
          describeChoice={describeChoice}
          initialPropertyId={Number.isInteger(initial) && initial > 0 ? initial : null}
          testIdPrefix="underwrite-note"
        />
      </div>
    </PageShell>
  );
}
