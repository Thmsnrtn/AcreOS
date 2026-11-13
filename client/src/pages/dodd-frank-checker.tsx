import { useState, useId } from "react";
import { PageShell } from "@/components/page-shell";
import { RequiredDisclaimer } from "@/components/required-disclaimer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useNotes } from "@/hooks/use-notes";
import { CheckCircle2, AlertTriangle, XCircle, Scale, Loader2 } from "lucide-react";

interface FindingItem {
  issue: string;
  detail: string;
  severity: "info" | "warning" | "critical";
}

interface BookCounts {
  noteId: number;
  trackA_dwellingSecuredRolling12Months: number;
  unknownDwellingRolling12Months: number;
  thisDealAddedToTrackA: boolean;
  sellerKeyLimitation: string;
}

interface ComplianceResult {
  risk: "compliant" | "review_needed" | "likely_violation" | "attorney_required";
  exemptionApplicable?: string;
  summary: string;
  findings: FindingItem[];
  recommendations: string[];
  requiresLicensedMLO: boolean;
  countSource?: "book" | "hypothetical";
  bookCounts?: BookCounts;
}

const SEVERITY_META: Record<FindingItem["severity"], { label: string; render: () => JSX.Element }> = {
  info: { label: "Informational", render: () => <CheckCircle2 className="w-3.5 h-3.5 text-acr-accent" aria-hidden="true" /> },
  warning: { label: "Warning", render: () => <AlertTriangle className="w-3.5 h-3.5 text-acr-warn" aria-hidden="true" /> },
  critical: { label: "Critical", render: () => <XCircle className="w-3.5 h-3.5 text-acr-neg" aria-hidden="true" /> },
};

const RISK_BADGE: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  compliant: "default",
  review_needed: "secondary",
  likely_violation: "destructive",
  attorney_required: "destructive",
};

export default function DoddFrankCheckerPage() {
  useDocumentTitle("Dodd-Frank compliance");
  const { toast } = useToast();
  const dealsId = useId();
  const notePickerId = useId();
  const sellerTypeId = useId();
  const rateTypeId = useId();
  const interestId = useId();
  const dwellingId = useId();
  const constructedId = useId();
  const atrId = useId();
  const negAmId = useId();
  const firstAdjustId = useId();

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ComplianceResult | null>(null);
  // §5.5: pick a note from the book and the count is counted for real;
  // leave it on "hypothetical" and the typed count stands, labelled as such.
  const [selectedNoteId, setSelectedNoteId] = useState<string>("hypothetical");
  const { data: bookNotes } = useNotes();
  const [form, setForm] = useState({
    sellerFinancedDealsLast12Months: "1",
    sellerType: "natural_person",
    hasDwelling: false,
    sellerConstructedDwelling: false,
    rateType: "fixed",
    // Exclusion elements left unanswered block a grant (12 CFR 1026.36(a)(4),
    // (a)(5)); "unknown" is sent as omitted, never as a guessed yes/no.
    abilityToRepayDetermined: "unknown" as "yes" | "no" | "unknown",
    negativeAmortization: "unknown" as "yes" | "no" | "unknown",
    firstRateAdjustmentMonths: "",
    interestRate: "0.08",
    balloonAfterMonths: "",
  });

  async function runCheck(e?: React.FormEvent) {
    e?.preventDefault();
    setLoading(true);
    try {
      const res = await fetch("/api/dodd-frank/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          ...(selectedNoteId !== "hypothetical" ? { noteId: parseInt(selectedNoteId, 10) } : {}),
          sellerFinancedDealsLast12Months: parseInt(form.sellerFinancedDealsLast12Months),
          interestRate: parseFloat(form.interestRate),
          balloonAfterMonths: form.balloonAfterMonths ? parseInt(form.balloonAfterMonths) : undefined,
          abilityToRepayDetermined: form.abilityToRepayDetermined === "unknown" ? undefined : form.abilityToRepayDetermined === "yes",
          negativeAmortization: form.negativeAmortization === "unknown" ? undefined : form.negativeAmortization === "yes",
          firstRateAdjustmentMonths: form.rateType === "adjustable" && form.firstRateAdjustmentMonths
            ? parseInt(form.firstRateAdjustmentMonths)
            : undefined,
        }),
      });
      if (!res.ok) {
        throw new Error(`Check failed (${res.status})`);
      }
      setResult(await res.json());
    } catch (err: any) {
      toast({
        title: "Couldn't run compliance check",
        description: `${err?.message ?? "Network error"}. Your inputs are unchanged — try again in a moment. This tool is informational; it does not constitute legal advice either way.`,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  const set = (key: keyof typeof form, value: any) => setForm(f => ({ ...f, [key]: value }));

  return (
    <PageShell>
      <div>
        <h1 className="text-2xl md:text-3xl font-bold" data-testid="text-dodd-frank-title">
          Dodd-Frank compliance checker
        </h1>
        <p className="text-muted-foreground text-sm md:text-base">
          Check if your seller-financing deal qualifies for exemptions under CFPB Reg Z. Informational only — not legal advice.
        </p>
        {/* Standing disclaimer — automated screening only, not legal advice */}
        <RequiredDisclaimer type="legal" className="mt-3" />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Scale className="w-4 h-4" aria-hidden="true" />
            Deal parameters
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          <form onSubmit={runCheck} className="space-y-4">
            <div>
              <Label htmlFor={notePickerId} className="text-xs">Count the deals from a note in your book?</Label>
              <Select value={selectedNoteId} onValueChange={setSelectedNoteId}>
                <SelectTrigger id={notePickerId} className="mt-1" aria-label="Count the deals from a note in your book">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="hypothetical">Hypothetical — I'll type the count myself</SelectItem>
                  {(bookNotes ?? []).map((n) => (
                    <SelectItem key={n.id} value={String(n.id)}>
                      Note #{n.id} — {n.borrowerId ? `Borrower #${n.borrowerId}` : "Unassigned borrower"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedNoteId !== "hypothetical" && (
                <p className="text-xs text-muted-foreground mt-1">
                  The deals count below is ignored — the server counts this seller's deals from your book.
                </p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor={dealsId} className="text-xs">Deals financed (last 12 mo)</Label>
                <Input
                  id={dealsId}
                  type="number"
                  min={1}
                  inputMode="numeric"
                  value={form.sellerFinancedDealsLast12Months}
                  onChange={e => set("sellerFinancedDealsLast12Months", e.target.value)}
                  className="mt-1 tabular-nums"
                />
              </div>
              <div>
                <Label htmlFor={sellerTypeId} className="text-xs">Seller type</Label>
                <Select value={form.sellerType} onValueChange={v => set("sellerType", v)}>
                  <SelectTrigger id={sellerTypeId} className="mt-1" aria-label="Seller type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="natural_person">Natural person — an individual, not an entity</SelectItem>
                    <SelectItem value="entity">Entity — LLC, corporation, or partnership</SelectItem>
                    <SelectItem value="estate_or_trust">Estate or trust</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor={rateTypeId} className="text-xs">Rate type</Label>
                <Select value={form.rateType} onValueChange={v => set("rateType", v)}>
                  <SelectTrigger id={rateTypeId} className="mt-1" aria-label="Rate type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="fixed">Fixed — rate stays the same for the life of the loan</SelectItem>
                    <SelectItem value="adjustable">Adjustable — rate can change at scheduled intervals</SelectItem>
                    <SelectItem value="balloon_5yr_plus">Balloon ≥5 years — final lump-sum payment after 5+ years</SelectItem>
                    <SelectItem value="balloon_under_5yr">Balloon &lt;5 years — final lump sum within 5 years</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor={interestId} className="text-xs">Annual interest rate (decimal, e.g. 0.08 = 8%)</Label>
                <Input
                  id={interestId}
                  type="number"
                  step="0.01"
                  min={0}
                  max={1}
                  inputMode="decimal"
                  value={form.interestRate}
                  onChange={e => set("interestRate", e.target.value)}
                  className="mt-1 tabular-nums"
                />
              </div>
            </div>

            <div className="space-y-3">
              {([
                ["hasDwelling", dwellingId, "Property has a dwelling (house/manufactured home)"],
                ["sellerConstructedDwelling", constructedId, "Seller constructed the dwelling"],
              ] as const).map(([key, id, label]) => (
                <div key={key} className="flex items-center justify-between gap-3">
                  <Label htmlFor={id} className="text-xs">{label}</Label>
                  <Switch
                    id={id}
                    checked={form[key]}
                    onCheckedChange={v => set(key, v)}
                    aria-label={label}
                  />
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {([
                ["abilityToRepayDetermined", atrId, "Good-faith ability-to-repay determination made?"],
                ["negativeAmortization", negAmId, "Can payments fall below the interest due (negative amortization)?"],
              ] as const).map(([key, id, label]) => (
                <div key={key}>
                  <Label htmlFor={id} className="text-xs">{label}</Label>
                  <Select value={form[key]} onValueChange={v => set(key, v)}>
                    <SelectTrigger id={id} className="mt-1" aria-label={label}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="unknown">Not answered yet</SelectItem>
                      <SelectItem value="yes">Yes</SelectItem>
                      <SelectItem value="no">No</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              ))}
              {form.rateType === "adjustable" && (
                <div>
                  <Label htmlFor={firstAdjustId} className="text-xs">Months until the rate can first change</Label>
                  <Input
                    id={firstAdjustId}
                    type="number"
                    min={1}
                    inputMode="numeric"
                    value={form.firstRateAdjustmentMonths}
                    onChange={e => set("firstRateAdjustmentMonths", e.target.value)}
                    className="mt-1 tabular-nums"
                  />
                </div>
              )}
            </div>

            <Button type="submit" disabled={loading} className="w-full">
              {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" aria-hidden="true" /> : null}
              {loading ? "Running…" : "Run compliance check"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {result && (
        <Card aria-live="polite">
          <CardContent className="p-4 space-y-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <span className="font-medium text-sm">Compliance status</span>
              <Badge variant={RISK_BADGE[result.risk]} className="capitalize">
                {result.risk.replace(/_/g, " ")}
              </Badge>
            </div>

            <p className="text-sm text-muted-foreground">{result.summary}</p>

            {result.countSource === "book" && result.bookCounts ? (
              <div className="text-xs space-y-1" aria-label="Count source">
                <p>
                  <span className="font-medium">Count from your book:</span>{" "}
                  {result.bookCounts.trackA_dwellingSecuredRolling12Months} dwelling-secured deal
                  {result.bookCounts.trackA_dwellingSecuredRolling12Months === 1 ? "" : "s"} in the last 12 months
                  {result.bookCounts.thisDealAddedToTrackA ? ", plus this deal" : " (this deal is already among them)"}.
                </p>
                {result.bookCounts.unknownDwellingRolling12Months > 0 && (
                  <p className="text-muted-foreground">
                    Plus {result.bookCounts.unknownDwellingRolling12Months} deal
                    {result.bookCounts.unknownDwellingRolling12Months === 1 ? "" : "s"} where the dwelling answer
                    isn't recorded — the activation gate counts those as dwelling-secured.
                  </p>
                )}
                <p className="text-muted-foreground italic">{result.bookCounts.sellerKeyLimitation}</p>
              </div>
            ) : result.countSource === "hypothetical" ? (
              <p className="text-xs text-muted-foreground" aria-label="Count source">
                <span className="font-medium">Hypothetical</span> — the deals count is the number you typed, not a
                count from your book.
              </p>
            ) : null}

            {result.requiresLicensedMLO && (
              <div className="bg-acr-neg-soft border border-acr-neg-soft rounded p-3 text-xs text-acr-neg-soft-ink" role="alert">
                <strong>Licensed MLO required.</strong> This deal likely requires a licensed mortgage loan originator.
              </div>
            )}

            {result.exemptionApplicable && result.exemptionApplicable !== "none" && (
              <Badge variant="outline" className="text-xs capitalize">
                Exemption: {result.exemptionApplicable.replace(/_/g, " ")}
              </Badge>
            )}

            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Findings</p>
              {result.findings.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">No findings.</p>
              ) : (
                <ul className="space-y-2" aria-label="Compliance findings">
                  {result.findings.map((f, i) => {
                    const meta = SEVERITY_META[f.severity];
                    return (
                      <li
                        key={i}
                        className="flex items-start gap-2 text-xs"
                        role={f.severity === "critical" ? "alert" : undefined}
                      >
                        <span aria-label={meta.label}>{meta.render()}</span>
                        <div className="min-w-0">
                          <p className="font-medium">{f.issue}</p>
                          <p className="text-muted-foreground">{f.detail}</p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {result.recommendations.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">Recommendations</p>
                <ul className="text-xs text-muted-foreground space-y-1 list-disc list-inside" aria-label="Recommendations">
                  {result.recommendations.map((r, i) => <li key={i}>{r}</li>)}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </PageShell>
  );
}
