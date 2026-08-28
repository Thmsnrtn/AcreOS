import { useState, useId } from "react";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DataProvenanceChip, type DataClassification } from "@/components/data-provenance-chip";
import { useToast } from "@/hooks/use-toast";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { usd } from "@/lib/format";
import { DollarSign, MapPin, AlertCircle, Loader2 } from "lucide-react";

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
  source: "database" | "state_default" | "estimate";
  confidence: "high" | "medium" | "low";
}

/**
 * Canonical truth-state per fee-data source (shared/dataClassification.ts):
 * a county-specific fee of record is authoritative; a state-level default or
 * the generic fallback is a data-backed estimate. The server's high/medium/low
 * tier is derived 1:1 from `source`, so this map carries the same information
 * without inventing a percentage that was never measured.
 */
const SOURCE_CLASSIFICATION: Record<RecordingFeeInfo["source"], DataClassification> = {
  database: "authoritative",
  state_default: "estimate",
  estimate: "estimate",
};

export default function ClosingCostsPage() {
  useDocumentTitle("Closing cost calculator");
  const { toast } = useToast();
  const [state, setState] = useState("TX");
  const [county, setCounty] = useState("");
  const [price, setPrice] = useState("");
  const [result, setResult] = useState<ClosingCostsResult | null>(null);
  const [feeInfo, setFeeInfo] = useState<RecordingFeeInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const stateId = useId();
  const countyId = useId();
  const priceId = useId();

  async function calculate() {
    if (!state || !county || !price) return;
    setLoading(true);
    try {
      const [closingRes, feeRes] = await Promise.all([
        fetch(`/api/recording-fees/closing?state=${state}&county=${encodeURIComponent(county)}&price=${price}`).then(r => {
          if (!r.ok) throw new Error("Closing calc failed");
          return r.json();
        }),
        fetch(`/api/recording-fees?state=${state}&county=${encodeURIComponent(county)}`).then(r => {
          if (!r.ok) throw new Error("Fee lookup failed");
          return r.json();
        }),
      ]);
      setResult(closingRes);
      setFeeInfo(feeRes);
    } catch {
      toast({
        title: "Couldn't calculate closing costs",
        description: "No figures were computed — your inputs are preserved. Try again in a moment.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <PageShell>
      <div>
        <h1 className="text-2xl md:text-3xl font-bold" data-testid="text-closing-costs-title">
          Closing cost calculator
        </h1>
        <p className="text-muted-foreground text-sm md:text-base">
          Estimate recording fees and transfer taxes by state and county.
        </p>
      </div>

      <Card>
        <CardContent className="p-4">
          <form
            className="space-y-4"
            onSubmit={(e) => { e.preventDefault(); calculate(); }}
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label htmlFor={stateId} className="text-xs">
                  State <span className="text-destructive" aria-label="required">*</span>
                </Label>
                <Input
                  id={stateId}
                  placeholder="TX"
                  value={state}
                  onChange={e => setState(e.target.value.toUpperCase().slice(0, 2))}
                  maxLength={2}
                  className="mt-1 uppercase"
                  autoCapitalize="characters"
                  autoComplete="address-level1"
                  autoCorrect="off"
                  spellCheck={false}
                />
              </div>
              <div>
                <Label htmlFor={countyId} className="text-xs">
                  County <span className="text-destructive" aria-label="required">*</span>
                </Label>
                <Input
                  id={countyId}
                  placeholder="Travis"
                  value={county}
                  onChange={e => setCounty(e.target.value)}
                  className="mt-1"
                  autoCapitalize="words"
                  autoComplete="address-level2"
                />
              </div>
            </div>
            <div>
              <Label htmlFor={priceId} className="text-xs">
                Purchase price ($) <span className="text-destructive" aria-label="required">*</span>
              </Label>
              <Input
                id={priceId}
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                placeholder="50000"
                value={price}
                onChange={e => setPrice(e.target.value)}
                className="mt-1 tabular-nums"
              />
            </div>
            <Button
              type="submit"
              disabled={loading || !state || !county || !price}
              className="w-full min-h-11"
            >
              {loading ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" /> Calculating…</>
              ) : (
                "Calculate closing costs"
              )}
            </Button>
          </form>
        </CardContent>
      </Card>

      {result && feeInfo && (
        <>
          <dl className="grid grid-cols-3 gap-3">
            <Card>
              <CardContent className="p-4">
                <dt className="flex items-center gap-2 text-muted-foreground mb-1">
                  <DollarSign className="w-3.5 h-3.5" aria-hidden="true" />
                  <span className="text-xs">Recording fee</span>
                </dt>
                <dd className="text-lg font-bold tabular-nums">{usd(result.recordingFee)}</dd>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <dt className="flex items-center gap-2 text-muted-foreground mb-1">
                  <DollarSign className="w-3.5 h-3.5" aria-hidden="true" />
                  <span className="text-xs">Transfer tax</span>
                </dt>
                <dd className="text-lg font-bold tabular-nums">{usd(result.transferTax)}</dd>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <dt className="text-xs text-muted-foreground mb-1">Total est.</dt>
                <dd className="text-lg font-bold text-primary tabular-nums">{usd(result.total)}</dd>
              </CardContent>
            </Card>
          </dl>

          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm flex items-center gap-2">
                  <MapPin className="w-4 h-4" aria-hidden="true" />
                  {feeInfo.state} — {feeInfo.county}
                </CardTitle>
                <DataProvenanceChip
                  source={feeInfo.source.replace(/_/g, " ")}
                  classification={SOURCE_CLASSIFICATION[feeInfo.source]}
                />
              </div>
            </CardHeader>
            <CardContent className="p-4 pt-0 space-y-2 text-sm">
              <dl className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <dt className="text-muted-foreground">Recording fee/page</dt>
                  <dd className="font-medium tabular-nums">{usd(feeInfo.recordingFeePerPage)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Transfer tax</dt>
                  <dd className="font-medium tabular-nums">${feeInfo.transferTaxPer1000.toFixed(2)}/$1,000</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Paid by</dt>
                  <dd className="font-medium capitalize">{feeInfo.transferTaxPaidBy}</dd>
                </div>
              </dl>
              {feeInfo.specialNotes.length > 0 && (
                <ul className="space-y-1" aria-label="Special notes for this county">
                  {feeInfo.specialNotes.map((note, i) => (
                    <li
                      key={i}
                      className="flex items-start gap-2 text-xs text-acr-warn bg-acr-warn-soft rounded p-2"
                      role="note"
                    >
                      <AlertCircle className="w-3 h-3 mt-0.5 flex-shrink-0" aria-hidden="true" />
                      <span>{note}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </PageShell>
  );
}
