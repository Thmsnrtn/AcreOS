import { useState } from "react";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { CheckCircle2, AlertTriangle, XCircle, Scale, Loader2 } from "lucide-react";

interface FindingItem {
  issue: string;
  detail: string;
  severity: "info" | "warning" | "critical";
}

interface ComplianceResult {
  risk: "compliant" | "review_needed" | "likely_violation" | "attorney_required";
  exemptionApplicable?: string;
  summary: string;
  findings: FindingItem[];
  recommendations: string[];
  requiresLicensedMLO: boolean;
}

const SEVERITY_ICONS = {
  info: <CheckCircle2 className="w-3.5 h-3.5 text-blue-500" />,
  warning: <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />,
  critical: <XCircle className="w-3.5 h-3.5 text-red-500" />,
};

const RISK_BADGE: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  compliant: "default",
  review_needed: "secondary",
  likely_violation: "destructive",
  attorney_required: "destructive",
};

export default function DoddFrankCheckerPage() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ComplianceResult | null>(null);
  const [form, setForm] = useState({
    sellerFinancedDealsLast12Months: "1",
    sellerType: "natural_person",
    hasDwelling: false,
    sellerConstructedDwelling: false,
    isSellerResidence: false,
    rateType: "fixed",
    interestRate: "0.08",
    balloonAfterMonths: "",
  });

  async function runCheck() {
    setLoading(true);
    try {
      const res = await fetch("/api/dodd-frank/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          sellerFinancedDealsLast12Months: parseInt(form.sellerFinancedDealsLast12Months),
          interestRate: parseFloat(form.interestRate),
          balloonAfterMonths: form.balloonAfterMonths ? parseInt(form.balloonAfterMonths) : undefined,
        }),
      });
      setResult(await res.json());
    } finally {
      setLoading(false);
    }
  }

  const set = (key: keyof typeof form, value: any) => setForm(f => ({ ...f, [key]: value }));

  return (
    <PageShell>
      <div>
        <h1 className="text-2xl md:text-3xl font-bold" data-testid="text-dodd-frank-title">
          Dodd-Frank Compliance Checker
        </h1>
        <p className="text-muted-foreground text-sm md:text-base">
          Check if your seller-financing deal qualifies for exemptions under CFPB Reg Z.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Scale className="w-4 h-4" />
            Deal Parameters
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Deals financed (last 12 mo)</Label>
              <Input
                type="number"
                min={1}
                value={form.sellerFinancedDealsLast12Months}
                onChange={e => set("sellerFinancedDealsLast12Months", e.target.value)}
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-xs">Seller type</Label>
              <Select value={form.sellerType} onValueChange={v => set("sellerType", v)}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="natural_person">Natural Person</SelectItem>
                  <SelectItem value="entity">Entity (LLC/Corp)</SelectItem>
                  <SelectItem value="estate_or_trust">Estate or Trust</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Rate type</Label>
              <Select value={form.rateType} onValueChange={v => set("rateType", v)}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="fixed">Fixed</SelectItem>
                  <SelectItem value="adjustable">Adjustable</SelectItem>
                  <SelectItem value="balloon_5yr_plus">Balloon ≥5 years</SelectItem>
                  <SelectItem value="balloon_under_5yr">Balloon &lt;5 years</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Annual interest rate (e.g. 0.08)</Label>
              <Input
                type="number"
                step="0.01"
                min={0}
                max={1}
                value={form.interestRate}
                onChange={e => set("interestRate", e.target.value)}
                className="mt-1"
              />
            </div>
          </div>

          <div className="space-y-3">
            {([
              ["hasDwelling", "Property has a dwelling (house/manufactured home)"],
              ["sellerConstructedDwelling", "Seller constructed the dwelling"],
              ["isSellerResidence", "Property is seller's primary/secondary residence"],
            ] as const).map(([key, label]) => (
              <div key={key} className="flex items-center justify-between">
                <Label className="text-xs">{label}</Label>
                <Switch
                  checked={form[key]}
                  onCheckedChange={v => set(key, v)}
                />
              </div>
            ))}
          </div>

          <Button onClick={runCheck} disabled={loading} className="w-full">
            {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            Run Compliance Check
          </Button>
        </CardContent>
      </Card>

      {result && (
        <Card>
          <CardContent className="p-4 space-y-4">
            <div className="flex items-center justify-between">
              <span className="font-medium text-sm">Compliance Status</span>
              <Badge variant={RISK_BADGE[result.risk]}>
                {result.risk.replace(/_/g, " ")}
              </Badge>
            </div>

            <p className="text-sm text-muted-foreground">{result.summary}</p>

            {result.requiresLicensedMLO && (
              <div className="bg-red-50 border border-red-200 rounded p-3 text-xs text-red-700">
                <strong>Licensed MLO Required</strong> — This deal likely requires a licensed mortgage loan originator.
              </div>
            )}

            {result.exemptionApplicable && result.exemptionApplicable !== "none" && (
              <Badge variant="outline" className="text-xs">
                Exemption: {result.exemptionApplicable.replace(/_/g, " ")}
              </Badge>
            )}

            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Findings</p>
              {result.findings.map((f, i) => (
                <div key={i} className="flex items-start gap-2 text-xs">
                  {SEVERITY_ICONS[f.severity]}
                  <div>
                    <p className="font-medium">{f.issue}</p>
                    <p className="text-muted-foreground">{f.detail}</p>
                  </div>
                </div>
              ))}
            </div>

            {result.recommendations.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">Recommendations</p>
                <ul className="text-xs text-muted-foreground space-y-1 list-disc list-inside">
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
