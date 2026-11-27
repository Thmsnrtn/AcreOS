/**
 * Work out the underwrite — the commercial vertical's decision desk
 * (Step 0 gap sheet commercial.md, work item 2, bar (b)).
 *
 * Reached from the Commercial tab on /leases, not a new door. The numbers
 * come from the `commercial_underwrite` engine: the price the operator
 * entered, the recorded leases' in-place rent (escalation-aware as of the
 * stated month), recorded CAM recoveries, and operating expenses measured
 * from the expense records. Recording freezes them and the operator's
 * call under the commercial pack, with the operator's own review date
 * (POST /api/commercial/underwrite), so the outcome can later be graded
 * against what the asset actually did.
 *
 * Nothing here pulls a market rent, a comp or a valuation — there is no
 * such source in AcreOS and the desk invents none. With expenses
 * unmeasured the engine returns no NOI, and the desk shows that rather
 * than a figure built on an assumed expense.
 */
import { useSearch } from "wouter";
import { PageShell } from "@/components/page-shell";
import { UnderwritingWorkbench } from "@/components/underwriting/UnderwritingWorkbench";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { COMMERCIAL_UNDERWRITE_FIELDS } from "@shared/economics/fields/commercialUnderwrite";
import type { ScenarioMetric } from "@shared/economics/scenario";
import type { DecisionKind } from "@shared/decisions/snapshot";

function usd(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "?";
  return `${cents < 0 ? "−" : ""}$${Math.abs(Math.round(cents / 100)).toLocaleString("en-US")}`;
}

function describeChoice(kind: DecisionKind, _inputs: Record<string, number | string>, metrics: ScenarioMetric[]): string {
  const noi = metrics.find((m) => m.id === "annual_noi")?.value;
  const cap = metrics.find((m) => m.id === "cap_rate")?.value;
  const capText = cap === null || cap === undefined ? "" : ` at a ${(cap * 100).toFixed(2)}% cap rate`;
  if (noi === null || noi === undefined) {
    if (kind === "pass") return "Pass — no NOI on these figures: expenses are unmeasured";
    if (kind === "hold") return "Hold — no NOI on these figures: expenses are unmeasured";
    return "Acquire — no NOI on these figures: expenses are unmeasured";
  }
  if (kind === "pass") return `Pass — NOI ${usd(noi)}/yr${capText} on the recorded figures`;
  if (kind === "hold") return `Hold — NOI ${usd(noi)}/yr${capText} on the recorded figures`;
  return `Acquire — NOI ${usd(noi)}/yr${capText} on the recorded figures`;
}

export default function CommercialUnderwritePage() {
  useDocumentTitle("Work out the underwrite");
  const params = new URLSearchParams(useSearch());
  const initial = Number(params.get("propertyId"));
  return (
    <PageShell label="Work out the underwrite">
      <div className="mx-auto max-w-3xl space-y-4 p-4">
        <div>
          <h1 className="text-xl font-semibold">Work out the underwrite</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Start from the price you are underwriting and the leases actually recorded:
            the in-place rent with its recorded steps applied, the recoveries on recorded
            CAM reconciliations, and the rent that rolls within twelve months. Expenses
            come from your expense records — unmeasured, there is no NOI and the desk
            says so. Record your call and pick when you'll know how it went.
          </p>
        </div>
        <UnderwritingWorkbench
          engineId="commercial_underwrite"
          fields={COMMERCIAL_UNDERWRITE_FIELDS}
          decideEndpoint="/api/commercial/underwrite"
          kinds={["acquire", "hold", "pass"]}
          headlineMetrics={["annual_noi", "cap_rate", "effective_gross_income", "rollover_rent_share_12m"]}
          describeChoice={describeChoice}
          initialPropertyId={Number.isInteger(initial) && initial > 0 ? initial : null}
          testIdPrefix="underwrite-commercial"
        />
      </div>
    </PageShell>
  );
}
