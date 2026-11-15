/**
 * Underwrite a wholesale offer — the residential wholesaler's decision desk.
 *
 * Lives behind the Wholesale module (wholesaler orgs only), not a new door.
 * The offer comes from the `wholesale_mao` engine: the lesser of your own
 * ceiling and your end buyer's, less your target fee. Recording freezes the
 * numbers, the sold comps behind the ARV and the reason for the fee under the
 * residential_wholesaler pack, with your own review date
 * (POST /api/wholesale/underwrite).
 *
 * The comps are typed by the operator. Nothing here pulls a list, a comp or an
 * owner — bring-your-own data stays the rule.
 */
import { useMemo, useState } from "react";
import { useSearch } from "wouter";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PageShell } from "@/components/page-shell";
import { UnderwritingWorkbench } from "@/components/underwriting/UnderwritingWorkbench";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { WHOLESALE_MAO_FIELDS } from "@shared/economics/fields/wholesaleMao";
import type { ScenarioMetric } from "@shared/economics/scenario";
import type { DecisionKind } from "@shared/decisions/snapshot";

function usd(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "?";
  return `${cents < 0 ? "−" : ""}$${Math.abs(Math.round(cents / 100)).toLocaleString("en-US")}`;
}

function describeChoice(kind: DecisionKind, inputs: Record<string, number>, metrics: ScenarioMetric[]): string {
  const offer = metrics.find((m) => m.id === "max_allowable_offer")?.value;
  const fee = usd(inputs.targetFeeCents);
  if (kind === "pass") return `Pass — the most I could offer and still assign at ${fee} is ${usd(offer)}`;
  return `Offer up to ${usd(offer)} to assign at a ${fee} fee`;
}

interface CompRow {
  address: string;
  price: string;
  soldOn: string;
}

const EMPTY_COMP: CompRow = { address: "", price: "", soldOn: "" };

/** The evidence body the route requires, or null while it is incomplete. */
export function evidenceBody(comps: CompRow[], arvBasis: string, feeBasis: string) {
  const parsed = comps.map((c) => {
    const dollars = Number(c.price.replace(/[$,\s]/g, ""));
    return {
      address: c.address.trim(),
      soldPriceCents: Number.isFinite(dollars) && dollars > 0 ? Math.round(dollars * 100) : null,
      soldOn: c.soldOn,
    };
  });
  const complete =
    parsed.length > 0 &&
    parsed.every((c) => c.address.length >= 3 && c.soldPriceCents !== null && /^\d{4}-\d{2}-\d{2}$/.test(c.soldOn)) &&
    arvBasis.trim().length >= 10 &&
    feeBasis.trim().length >= 10;
  if (!complete) return null;
  return { evidence: { comps: parsed, arvBasis: arvBasis.trim(), feeBasis: feeBasis.trim() } };
}

export default function UnderwriteWholesaleOfferPage() {
  useDocumentTitle("Underwrite a wholesale offer");
  const params = new URLSearchParams(useSearch());
  const initial = Number(params.get("propertyId"));
  const [comps, setComps] = useState<CompRow[]>([{ ...EMPTY_COMP }]);
  const [arvBasis, setArvBasis] = useState("");
  const [feeBasis, setFeeBasis] = useState("");
  const extras = useMemo(() => evidenceBody(comps, arvBasis, feeBasis), [comps, arvBasis, feeBasis]);

  const setComp = (i: number, patch: Partial<CompRow>) =>
    setComps((rows) => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const evidenceForm = (
    <Card data-testid="underwrite-wholesale-evidence">
      <CardHeader>
        <CardTitle className="text-base">The evidence behind the offer</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          The sold comps behind your ARV and the reason for your fee are frozen with the decision, so
          when the deal closes you can see which number was wrong.
        </p>
        {comps.map((c, i) => (
          <div key={i} className="grid gap-2 sm:grid-cols-[2fr_1fr_1fr_auto]" data-testid={`underwrite-wholesale-comp-${i}`}>
            <div>
              <Label htmlFor={`comp-address-${i}`}>Comp {i + 1} address</Label>
              <Input id={`comp-address-${i}`} value={c.address} onChange={(e) => setComp(i, { address: e.target.value })} />
            </div>
            <div>
              <Label htmlFor={`comp-price-${i}`}>Sold price ($)</Label>
              <Input id={`comp-price-${i}`} inputMode="decimal" value={c.price} onChange={(e) => setComp(i, { price: e.target.value })} />
            </div>
            <div>
              <Label htmlFor={`comp-date-${i}`}>Sold on</Label>
              <Input id={`comp-date-${i}`} type="date" value={c.soldOn} onChange={(e) => setComp(i, { soldOn: e.target.value })} />
            </div>
            <div className="flex items-end">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Remove comp ${i + 1}`}
                disabled={comps.length === 1}
                onClick={() => setComps((rows) => rows.filter((_, j) => j !== i))}
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={comps.length >= 10}
          onClick={() => setComps((rows) => [...rows, { ...EMPTY_COMP }])}
          data-testid="underwrite-wholesale-add-comp"
        >
          <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
          Add a comp
        </Button>
        <div>
          <Label htmlFor="arv-basis">How you got the ARV from these comps</Label>
          <Textarea id="arv-basis" value={arvBasis} onChange={(e) => setArvBasis(e.target.value)} rows={2} />
        </div>
        <div>
          <Label htmlFor="fee-basis">Why this fee</Label>
          <Textarea id="fee-basis" value={feeBasis} onChange={(e) => setFeeBasis(e.target.value)} rows={2} />
        </div>
      </CardContent>
    </Card>
  );

  return (
    <PageShell label="Underwrite a wholesale offer">
      <div className="mx-auto max-w-3xl space-y-4 p-4">
        <div>
          <h1 className="text-xl font-semibold">Underwrite a wholesale offer</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Your offer has to clear two ceilings: your own, and what your end buyer will pay. The
            lower one, less your fee, is the most you can put the house under contract for. Record
            your call and pick when you'll know how it went.
          </p>
        </div>
        <UnderwritingWorkbench
          engineId="wholesale_mao"
          fields={WHOLESALE_MAO_FIELDS}
          decideEndpoint="/api/wholesale/underwrite"
          kinds={["offer", "pass"]}
          headlineMetrics={["max_allowable_offer", "assignment_fee", "profit"]}
          describeChoice={describeChoice}
          initialPropertyId={Number.isInteger(initial) && initial > 0 ? initial : null}
          recordExtras={extras}
          extraForm={evidenceForm}
          testIdPrefix="underwrite-wholesale"
        />
      </div>
    </PageShell>
  );
}
