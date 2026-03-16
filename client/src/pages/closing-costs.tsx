import { useState } from "react";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { DollarSign, MapPin, AlertCircle } from "lucide-react";

interface ClosingCostsResult {
  state: string;
  county: string;
  purchasePrice: number;
  recordingFee: number;
  transferTax: number;
  total: number;
}

interface RecordingFeeInfo {
  state: string;
  county: string;
  recordingFeePerPage: number;
  typicalPages: number;
  estimatedRecordingFee: number;
  transferTaxPer1000: number;
  transferTaxPaidBy: "buyer" | "seller" | "split" | "none";
  specialNotes: string[];
  source: string;
  confidence: "high" | "medium" | "low";
}

const CONFIDENCE_COLORS = {
  high: "default" as const,
  medium: "secondary" as const,
  low: "outline" as const,
};

export default function ClosingCostsPage() {
  const [state, setState] = useState("TX");
  const [county, setCounty] = useState("");
  const [price, setPrice] = useState("");
  const [result, setResult] = useState<ClosingCostsResult | null>(null);
  const [feeInfo, setFeeInfo] = useState<RecordingFeeInfo | null>(null);
  const [loading, setLoading] = useState(false);

  async function calculate() {
    if (!state || !county || !price) return;
    setLoading(true);
    try {
      const [closingRes, feeRes] = await Promise.all([
        fetch(`/api/recording-fees/closing?state=${state}&county=${encodeURIComponent(county)}&price=${price}`).then(r => r.json()),
        fetch(`/api/recording-fees?state=${state}&county=${encodeURIComponent(county)}`).then(r => r.json()),
      ]);
      setResult(closingRes);
      setFeeInfo(feeRes);
    } finally {
      setLoading(false);
    }
  }

  const fmt = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2 })}`;

  return (
    <PageShell>
      <div>
        <h1 className="text-2xl md:text-3xl font-bold" data-testid="text-closing-costs-title">
          Closing Cost Calculator
        </h1>
        <p className="text-muted-foreground text-sm md:text-base">
          Estimate recording fees and transfer taxes by state and county.
        </p>
      </div>

      <Card>
        <CardContent className="p-4 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">State</Label>
              <Input
                placeholder="TX"
                value={state}
                onChange={e => setState(e.target.value.toUpperCase().slice(0, 2))}
                maxLength={2}
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-xs">County</Label>
              <Input
                placeholder="Travis"
                value={county}
                onChange={e => setCounty(e.target.value)}
                className="mt-1"
              />
            </div>
          </div>
          <div>
            <Label className="text-xs">Purchase Price ($)</Label>
            <Input
              type="number"
              placeholder="50000"
              value={price}
              onChange={e => setPrice(e.target.value)}
              className="mt-1"
            />
          </div>
          <Button onClick={calculate} disabled={loading || !state || !county || !price} className="w-full">
            Calculate Closing Costs
          </Button>
        </CardContent>
      </Card>

      {result && feeInfo && (
        <>
          <div className="grid grid-cols-3 gap-3">
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <DollarSign className="w-3.5 h-3.5" />
                  <span className="text-xs">Recording Fee</span>
                </div>
                <p className="text-lg font-bold">{fmt(result.recordingFee)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <DollarSign className="w-3.5 h-3.5" />
                  <span className="text-xs">Transfer Tax</span>
                </div>
                <p className="text-lg font-bold">{fmt(result.transferTax)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground mb-1">Total Est.</p>
                <p className="text-lg font-bold text-primary">{fmt(result.total)}</p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm flex items-center gap-2">
                  <MapPin className="w-4 h-4" />
                  {feeInfo.state} — {feeInfo.county}
                </CardTitle>
                <Badge variant={CONFIDENCE_COLORS[feeInfo.confidence]}>
                  {feeInfo.confidence} confidence
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="p-4 pt-0 space-y-2 text-sm">
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <p className="text-muted-foreground">Recording fee/page</p>
                  <p className="font-medium">{fmt(feeInfo.recordingFeePerPage)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Transfer tax</p>
                  <p className="font-medium">${feeInfo.transferTaxPer1000.toFixed(2)}/$1,000</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Paid by</p>
                  <p className="font-medium capitalize">{feeInfo.transferTaxPaidBy}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Source</p>
                  <p className="font-medium">{feeInfo.source.replace("_", " ")}</p>
                </div>
              </div>
              {feeInfo.specialNotes.length > 0 && (
                <div className="space-y-1">
                  {feeInfo.specialNotes.map((note, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs text-amber-600 bg-amber-50 rounded p-2">
                      <AlertCircle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                      <span>{note}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </PageShell>
  );
}
