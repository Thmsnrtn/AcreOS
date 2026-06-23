/**
 * /contractors/1099-nec — batch 1099-NEC generator (FF-3).
 *
 * Devon §4: "End-of-year batch 1099-NEC generator that signs and mails
 * (you already have the HMAC signing rails). Replaces the spreadsheet I
 * keep on my dining-room table every December."
 */

import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { FileText, Download, AlertTriangle, CheckCircle2 } from "lucide-react";

import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { QueryErrorState } from "@/components/query-error-state";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useToast } from "@/hooks/use-toast";

interface PreviewContractor {
  id: string;
  name: string;
  totalCents: number;
  taxIdMasked: string;
  email: string | null;
  issues: string[];
  ready: boolean;
}

interface PreviewResponse {
  taxYear: number;
  thresholdCents: number;
  contractorCount: number;
  readyCount: number;
  blockedCount: number;
  contractors: PreviewContractor[];
}

interface BatchResponse {
  taxYear: number;
  formCount: number;
  forms: Array<{ contractorId: string; name: string; pdfBase64: string }>;
  warning: string;
}

function fmtUsd(c: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(c / 100);
}

function csrf(): Record<string, string> {
  const m = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/);
  return { "Content-Type": "application/json", "x-csrf-token": decodeURIComponent(m?.[1] ?? "") };
}

export default function Contractor1099NecPage() {
  useDocumentTitle("1099-NEC batch — AcreOS");
  const { toast } = useToast();
  const [taxYear, setTaxYear] = useState(String(new Date().getFullYear() - 1));

  const preview = useQuery<PreviewResponse>({
    queryKey: ["/api/contractors/1099-nec-batch", taxYear],
    queryFn: async () => {
      const res = await fetch(`/api/contractors/1099-nec-batch?taxYear=${taxYear}`, { credentials: "include" });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      return res.json();
    },
  });

  const generate = useMutation<BatchResponse, Error>({
    mutationFn: async () => {
      const res = await fetch(`/api/contractors/1099-nec-batch?taxYear=${taxYear}`, {
        method: "POST", credentials: "include", headers: csrf(), body: "{}",
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        throw new Error(detail.message ?? `Failed (${res.status})`);
      }
      return res.json();
    },
    onSuccess: (r: BatchResponse) => {
      toast({ title: `${r.formCount} 1099-NEC forms generated` });
      // Auto-download each PDF.
      for (const f of r.forms) {
        const bin = atob(f.pdfBase64);
        const arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        const blob = new Blob([arr], { type: "application/pdf" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `1099-NEC-${r.taxYear}-${f.name.replace(/[^a-z0-9]/gi, "-")}.pdf`;
        a.click();
      }
    },
    onError: (err: any) => toast({ title: "Generate failed", description: err.message, variant: "destructive" }),
  });

  const years = useMemo(() => {
    const cur = new Date().getFullYear();
    return [cur, cur - 1, cur - 2, cur - 3];
  }, []);

  return (
    <PageShell label="1099-NEC batch">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <FileText className="w-6 h-6 text-primary" aria-hidden="true" />
          1099-NEC batch
        </h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
          Generates Copy B (recipient copy) PDFs for every contractor over $600
          for the selected tax year. Paper IRS filing requires the red-ink Copy A
          form — use the IRS FIRE / IRIS system for electronic filing.
        </p>
      </div>

      <div className="flex items-end gap-2 mb-6">
        <div>
          <label className="text-xs text-muted-foreground">Tax year</label>
          <Select value={taxYear} onValueChange={setTaxYear}>
            <SelectTrigger className="h-9 w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              {years.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {preview.isLoading ? (
        <Skeleton className="h-32" />
      ) : preview.isError ? (
        <QueryErrorState
          error={preview.error as Error}
          onRetry={() => preview.refetch()}
          isRetrying={preview.isFetching}
          compact
          testId="contractor-1099-nec-error"
        />
      ) : preview.data ? (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            <Card className="p-3">
              <div className="text-xs text-muted-foreground">Eligible</div>
              <div className="text-2xl font-semibold">{preview.data.contractorCount}</div>
              <div className="text-xs text-muted-foreground">over ${preview.data.thresholdCents / 100}</div>
            </Card>
            <Card className="p-3">
              <div className="text-xs text-muted-foreground">Ready</div>
              <div className="text-2xl font-semibold text-acr-pos">{preview.data.readyCount}</div>
              <div className="text-xs text-muted-foreground">all required fields</div>
            </Card>
            <Card className="p-3">
              <div className="text-xs text-muted-foreground">Blocked</div>
              <div className={`text-2xl font-semibold ${preview.data.blockedCount > 0 ? "text-acr-warning" : ""}`}>
                {preview.data.blockedCount}
              </div>
              <div className="text-xs text-muted-foreground">missing W-9 / address</div>
            </Card>
            <Card className="p-3">
              <Button disabled={preview.data.readyCount === 0 || generate.isPending} onClick={() => generate.mutate()} className="w-full mt-2">
                <Download className="w-4 h-4 mr-1" aria-hidden="true" />
                Generate {preview.data.readyCount} PDFs
              </Button>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Eligible contractors</CardTitle>
              <CardDescription>
                Issues blocking a contractor from being included in the batch.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-muted-foreground border-b border-border bg-muted/30">
                    <th className="px-3 py-2 text-left font-medium">Contractor</th>
                    <th className="px-3 py-2 text-left font-medium">Tax ID</th>
                    <th className="px-3 py-2 text-right font-medium">Total</th>
                    <th className="px-3 py-2 text-left font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.data.contractors.map((c) => (
                    <tr key={c.id} className="border-b border-border/40">
                      <td className="px-3 py-2 font-medium">{c.name}</td>
                      <td className="px-3 py-2 font-mono text-xs">{c.taxIdMasked}</td>
                      <td className="px-3 py-2 text-right">{fmtUsd(c.totalCents)}</td>
                      <td className="px-3 py-2">
                        {c.ready ? (
                          <Badge variant="default" className="text-xs"><CheckCircle2 className="w-3 h-3 mr-1" /> ready</Badge>
                        ) : (
                          <span className="text-xs text-acr-warning flex items-center gap-1">
                            <AlertTriangle className="w-3 h-3" /> {c.issues.join(", ")}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </>
      ) : null}
    </PageShell>
  );
}
