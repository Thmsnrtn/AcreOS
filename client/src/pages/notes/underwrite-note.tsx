/**
 * Price a note to your yield — the note investor's decision desk (Step 0
 * item N4).
 *
 * Reached from the acquisition card in the note pipeline, not a new door.
 * The numbers come from the `note_price_yield` engine: the most you can pay
 * for the note's scheduled cash flows and still earn your target yield.
 * Recording freezes them and your call under the note_investor pack, with
 * your own review date (POST /api/note-investor/underwrite), so the outcome
 * can later be graded against what the note actually paid.
 *
 * The numbers are typed by the operator from the seller's tape. Nothing here
 * pulls a tape, a price or a borrower — bring-your-own data stays the rule.
 */
import { useSearch } from "wouter";
import { PageShell } from "@/components/page-shell";
import { UnderwritingWorkbench } from "@/components/underwriting/UnderwritingWorkbench";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { NOTE_PRICE_YIELD_FIELDS } from "@shared/economics/fields/notePriceYield";
import type { ScenarioMetric } from "@shared/economics/scenario";
import type { DecisionKind } from "@shared/decisions/snapshot";

function usd(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "?";
  return `${cents < 0 ? "−" : ""}$${Math.abs(Math.round(cents / 100)).toLocaleString("en-US")}`;
}

function describeChoice(kind: DecisionKind, inputs: Record<string, number | string>, metrics: ScenarioMetric[]): string {
  const price = metrics.find((m) => m.id === "max_allowable_offer")?.value;
  const yieldText = inputs.targetYieldPct === undefined ? "" : ` at a ${inputs.targetYieldPct}% yield`;
  if (kind === "pass") return `Pass — at my target yield this note is worth ${usd(price)}`;
  if (kind === "offer") return `Offer up to ${usd(price)}${yieldText}`;
  return `Acquire at up to ${usd(price)}${yieldText}`;
}

export default function UnderwriteNotePage() {
  useDocumentTitle("Price a note to your yield");
  const params = new URLSearchParams(useSearch());
  const initial = Number(params.get("propertyId"));
  return (
    <PageShell label="Price a note to your yield">
      <div className="mx-auto max-w-3xl space-y-4 p-4">
        <div>
          <h1 className="text-xl font-semibold">Price a note to your yield</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Work backwards from the yield you require: the note's balance, rate and payment set what
            its cash flows are worth, and the price below is the most you can pay and still earn
            that yield. Record your call and pick when you'll know how it went.
          </p>
        </div>
        <UnderwritingWorkbench
          engineId="note_price_yield"
          fields={NOTE_PRICE_YIELD_FIELDS}
          decideEndpoint="/api/note-investor/underwrite"
          kinds={["acquire", "offer", "pass"]}
          headlineMetrics={["max_allowable_offer", "total_cost", "profit", "irr", "discount_to_face", "hold_months"]}
          describeChoice={describeChoice}
          initialPropertyId={Number.isInteger(initial) && initial > 0 ? initial : null}
          testIdPrefix="underwrite-note"
        />
      </div>
    </PageShell>
  );
}
