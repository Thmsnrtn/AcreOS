import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TrendingUp, CheckCircle, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { DisclaimerBanner } from "@/components/disclaimer-banner";

/**
 * Bulk AVM — values every property the org already OWNS in AcreOS.
 *
 * This page used to offer a CSV upload ("Required columns: address, county,
 * state, acreage") and animate a setInterval progress bar to 90% while it
 * waited. POST /api/avm/bulk never read the file: it valued the org's own
 * properties. The upload, the column guide, the fake progress and the
 * per-row results table it could never fill are gone; the page now says what
 * the route does and shows the counts the route actually returns.
 */
export interface BulkValuationResponse {
  success: boolean;
  total: number;
  valuated: number;
  refused: number;
  skipped: number;
  failed: number;
  message: string;
}

export function BulkValuationSummary({ data }: { data: BulkValuationResponse }) {
  const rows: Array<{ label: string; value: number }> = [
    { label: "Properties you own", value: data.total },
    { label: "Valued", value: data.valuated },
    { label: "Refused (not enough comparable sales)", value: data.refused },
    { label: "Skipped (missing acreage/state/county, or not fee-simple)", value: data.skipped },
    { label: "Failed", value: data.failed },
  ];
  return (
    <Card data-testid="bulk-valuation-summary">
      <CardContent className="pt-6 space-y-4">
        <div className="flex items-start gap-3" role="status" aria-live="polite">
          <CheckCircle className="h-5 w-5 text-acr-pos mt-0.5" aria-hidden="true" />
          <p className="text-sm">{data.message}</p>
        </div>
        <dl className="grid grid-cols-1 sm:grid-cols-5 gap-4">
          {rows.map((r) => (
            <div key={r.label}>
              <dd className="text-2xl font-bold tabular-nums">{r.value}</dd>
              <dt className="text-xs text-muted-foreground">{r.label}</dt>
            </div>
          ))}
        </dl>
        <p className="text-xs text-muted-foreground">
          Each valued property's estimate is on its AVM page under valuation history.
        </p>
      </CardContent>
    </Card>
  );
}

export default function AvmBulk() {
  useDocumentTitle("Bulk AVM valuation");
  const { toast } = useToast();

  const bulkMutation = useMutation({
    mutationFn: async (): Promise<BulkValuationResponse> => {
      const res = await apiRequest("POST", "/api/avm/bulk", {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["avm"] });
    },
    onError: (err: Error) =>
      toast({
        title: "Couldn't run bulk valuation",
        description: `${err.message} — no properties were revalued.`,
        variant: "destructive",
      }),
  });

  return (
    <div className="p-6 space-y-6">
      <DisclaimerBanner type="avm" />
      <div>
        <h1 className="text-2xl font-bold">Bulk AVM valuation</h1>
        <p className="text-muted-foreground">
          Run the AVM on every property you own in AcreOS. Properties without enough comparable sales are refused, not guessed.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" aria-hidden="true" /> Value my properties
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Button
            onClick={() => bulkMutation.mutate()}
            disabled={bulkMutation.isPending}
            data-testid="button-run-bulk-valuation"
          >
            {bulkMutation.isPending ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden="true" />Valuing properties…</>
            ) : (
              "Value all my properties"
            )}
          </Button>
        </CardContent>
      </Card>

      {bulkMutation.data && <BulkValuationSummary data={bulkMutation.data} />}
    </div>
  );
}
