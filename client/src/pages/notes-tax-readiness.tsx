/**
 * /notes/tax-readiness — 1099-INT pre-flight panel for note investors.
 *
 * Linnea: "I have to send a 1099-INT to every borrower who paid me $600+
 * in interest in the calendar year. Sixty-three notes = up to 63 forms,
 * plus the IRS copy. I search AcreOS for '1099.' Nothing in the UI."
 *
 * This is the UI. Server side already exists:
 *   GET  /api/bookkeeping/1099?year=YYYY  — per-note form data
 *   POST /api/accounting/1099-batch?taxYear=YYYY — batch PDF + FIRE file
 *   GET  /api/accounting/1099-batch/:jobId — poll status / fetch result
 *
 * Surfaces: eligible vs. blocked notes, per-borrower YTD interest, batch
 * generation, blocker reasons (missing TIN, sub-$600, etc.).
 */

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { FileText, AlertTriangle, CheckCircle2, Download, Loader2, Users, Shield, Landmark, ChevronRight } from "lucide-react";

import { PageShell } from "@/components/page-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState } from "@/components/empty-state";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useToast } from "@/hooks/use-toast";

interface Form1099Int {
  taxYear: number;
  accountNumber: string;
  payerName: string;
  recipientName: string;
  recipientTin: string;
  box1_interestIncome: number;
  box10_marketDiscount: number;
}

interface FormsResponse {
  taxYear: number;
  forms: Form1099Int[];
}

interface BatchResponse {
  jobId: string;
  status: "success" | "failure" | "queued" | "running";
  formCount?: number;
  totalInterestCents?: number;
  recipientPdfs?: Array<{ recipientName: string; pdfBase64: string; box1Cents: number }>;
  transmittalPdfBase64?: string;
  fireFile?: string;
  errors?: string[];
  message?: string;
}

interface TaxIdentityError {
  error: "tax_identity_missing";
  code: string;
  message: string;
  noteId?: string;
}

function fmtUsd(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

const CURRENT_YEAR = new Date().getFullYear();
const DEFAULT_YEAR = CURRENT_YEAR - 1; // Most users want the previous tax year

export default function NotesTaxReadinessPage() {
  useDocumentTitle("Tax readiness — AcreOS");
  const { toast } = useToast();
  const [taxYear, setTaxYear] = useState(DEFAULT_YEAR);
  const [batchResult, setBatchResult] = useState<BatchResponse | null>(null);

  // Per-note 1099 data. The endpoint returns 422 if TINs are missing —
  // we handle that as the "blockers" path.
  const formsQuery = useQuery<FormsResponse | TaxIdentityError>({
    queryKey: ["/api/bookkeeping/1099", taxYear],
    queryFn: async () => {
      const res = await fetch(`/api/bookkeeping/1099?year=${taxYear}`, {
        credentials: "include",
      });
      const json = await res.json();
      if (res.status === 422) {
        return json as TaxIdentityError;
      }
      if (!res.ok) {
        throw new Error(json?.error || `Failed to load (${res.status})`);
      }
      return json as FormsResponse;
    },
  });

  // allow-no-invalidation: batch results render from mutation.data — no cached query reads them
  const batchMutation = useMutation({
    mutationFn: async () => {
      const csrfToken = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/)?.[1] || "";
      const res = await fetch(`/api/accounting/1099-batch?taxYear=${taxYear}`, {
        method: "POST",
        credentials: "include",
        headers: { "x-csrf-token": decodeURIComponent(csrfToken) },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.message || "Batch failed");
      return json as BatchResponse;
    },
    onSuccess: (data) => {
      setBatchResult(data);
      toast({
        title: data.status === "success" ? "Batch generated" : "Batch failed",
        description: data.status === "success"
          ? `${data.formCount} forms ready.`
          : (data.errors?.[0] ?? "Check errors below."),
        variant: data.status === "success" ? "default" : "destructive",
      });
    },
    onError: (err: any) => {
      toast({ title: "Batch failed", description: err.message, variant: "destructive" });
    },
  });

  // Branching: forms loaded vs. tax_identity_missing vs. error
  const formsData = formsQuery.data && !("error" in formsQuery.data) ? formsQuery.data : null;
  const blockerError = formsQuery.data && "error" in formsQuery.data ? formsQuery.data : null;
  const forms = formsData?.forms ?? [];
  const eligibleCount = forms.length;
  const totalInterest = forms.reduce((sum, f) => sum + f.box1_interestIncome, 0);

  return (
    <PageShell label="Tax readiness">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">1099-INT readiness</h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
          Pre-flight check for the 1099-INT batch you'll send borrowers in January.
          Counts only borrowers who paid you ≥ $600 in interest during the tax year
          (the IRS reporting threshold). Notes with missing W-9 / TIN show as
          blockers — fix those before you generate.
        </p>
      </div>

      {/* Compliance watch — insurance + tax-escrow disbursements within 60 days. */}
      <ComplianceWatchSection />

      {/* Year picker */}
      <div className="flex items-center gap-3 mb-6">
        <span className="text-sm font-medium">Tax year</span>
        <Select value={String(taxYear)} onValueChange={(v) => setTaxYear(parseInt(v, 10))}>
          <SelectTrigger className="w-32" data-testid="tax-year-selector">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[CURRENT_YEAR - 2, CURRENT_YEAR - 1, CURRENT_YEAR].map((y) => (
              <SelectItem key={y} value={String(y)}>{y}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Status summary */}
      {formsQuery.isLoading && (
        <Card className="mb-6"><div className="p-5"><Skeleton className="h-20 w-full" /></div></Card>
      )}

      {!formsQuery.isLoading && blockerError && (
        <Card className="mb-6 border-acr-warning/30 bg-acr-warning/5">
          <div className="p-5 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-acr-warning shrink-0 mt-0.5" aria-hidden="true" />
            <div>
              <p className="font-semibold">Tax identity blockers — fix before generating</p>
              <p className="text-sm text-muted-foreground mt-1">{blockerError.message}</p>
              {blockerError.noteId && (
                <p className="text-xs text-muted-foreground mt-1.5 font-mono">Note: {blockerError.noteId}</p>
              )}
              <p className="text-xs text-muted-foreground mt-3">
                Add the missing TIN via <span className="font-mono">PATCH /api/notes/{"<id>"}</span>{" "}
                with <span className="font-mono">payerTin</span> +{" "}
                <span className="font-mono">payerTinType</span>, then refresh this
                page. The note detail surface exposes a TIN editor in PR-5.
              </p>
            </div>
          </div>
        </Card>
      )}

      {!formsQuery.isLoading && formsData && eligibleCount === 0 && (
        <Card className="mb-6"><div className="p-5">
          <EmptyState
            icon={FileText}
            headline={`No notes hit the $600 threshold in ${taxYear}`}
            subtitle="Either no interest was recorded for the year or every borrower fell below the IRS reporting threshold. Either way, no 1099-INT batch is required."
            // TODO(cta): informational state — no direct action; the system generates 1099-INT when threshold is met
            cta={{ label: "", _noOp: true }}
          />
        </div></Card>
      )}

      {!formsQuery.isLoading && formsData && eligibleCount > 0 && (
        <Card className="mb-6">
          <div className="p-5">
            <div className="flex items-start justify-between gap-3 mb-4">
              <div>
                <p className="text-xs text-muted-foreground">Eligible recipients</p>
                <p className="text-3xl font-semibold tracking-tight" data-testid="eligible-count">
                  {eligibleCount}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Total interest income {fmtUsd(totalInterest)}
                </p>
              </div>
              <Button
                onClick={() => batchMutation.mutate()}
                disabled={batchMutation.isPending}
                data-testid="generate-batch-button"
              >
                {batchMutation.isPending ? (
                  <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> Generating…</>
                ) : (
                  <><FileText className="w-4 h-4 mr-1.5" /> Generate 1099-INT batch</>
                )}
              </Button>
            </div>
            <Separator className="mb-3" />
            <div className="overflow-x-auto -mx-2">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-muted-foreground">
                    <th className="px-2 py-2 text-left font-medium">Recipient</th>
                    <th className="px-2 py-2 text-left font-medium">Account</th>
                    <th className="px-2 py-2 text-left font-medium">TIN</th>
                    <th className="px-2 py-2 text-right font-medium">Box 1 — Interest</th>
                    <th className="px-2 py-2 text-right font-medium">Box 10 — Market discount</th>
                  </tr>
                </thead>
                <tbody>
                  {forms.map((f) => (
                    <tr key={f.accountNumber} className="border-t border-border/40">
                      <td className="px-2 py-2 font-medium">{f.recipientName}</td>
                      <td className="px-2 py-2 font-mono text-xs">{f.accountNumber}</td>
                      <td className="px-2 py-2 font-mono text-xs">
                        {f.recipientTin ? f.recipientTin.replace(/^(\d{3})(\d{2})/, "•••-••-") : "—"}
                      </td>
                      <td className="px-2 py-2 text-right font-mono">{fmtUsd(f.box1_interestIncome)}</td>
                      <td className="px-2 py-2 text-right font-mono">
                        {f.box10_marketDiscount > 0 ? fmtUsd(f.box10_marketDiscount) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </Card>
      )}

      {/* Investor statements — per-LP income per tax year. Only renders
          when the org has at least one acquired note with ownership splits
          configured (the endpoint returns [] if there are no splits). */}
      <InvestorStatementsSection taxYear={taxYear} />

      {/* Batch result */}
      {batchResult && batchResult.status === "success" && (
        <Card className="border-acr-pos/30 bg-acr-pos/5">
          <div className="p-5">
            <div className="flex items-center gap-2 mb-3">
              <CheckCircle2 className="w-5 h-5 text-acr-pos" aria-hidden="true" />
              <h2 className="text-sm font-semibold">Batch generated — {batchResult.formCount} forms</h2>
            </div>
            <Separator className="mb-3" />
            <div className="space-y-1 text-sm">
              {batchResult.transmittalPdfBase64 && (
                <DownloadLine
                  label="1096 transmittal summary"
                  filename={`1096-transmittal-${taxYear}.pdf`}
                  base64={batchResult.transmittalPdfBase64}
                  mime="application/pdf"
                />
              )}
              {batchResult.fireFile && (
                <DownloadLine
                  label="IRS FIRE file (Pub 1220)"
                  filename={`fire-1099int-${taxYear}.txt`}
                  base64={btoa(batchResult.fireFile)}
                  mime="text/plain"
                />
              )}
              {batchResult.recipientPdfs?.map((r, idx) => (
                <DownloadLine
                  key={idx}
                  label={`${r.recipientName} — ${fmtUsd(r.box1Cents)}`}
                  filename={`1099-INT-${r.recipientName.replace(/[^A-Za-z0-9]+/g, "-")}-${taxYear}.pdf`}
                  base64={r.pdfBase64}
                  mime="application/pdf"
                />
              ))}
            </div>
          </div>
        </Card>
      )}
    </PageShell>
  );
}

interface InvestorStatementPreview {
  investorName: string;
  investorEmail: string | null;
  totalInterestCents: number;
  perNote: Array<{
    noteNumber: string;
    payerName: string;
    noteYearInterestCents: number;
    percentageBps: number;
    investorShareCents: number;
  }>;
}

interface InvestorReconciliationVariance {
  noteId: string;
  noteNumber: string;
  payerName: string;
  notePaymentsInterestCents: number;
  totalLpBps: number;
  expectedLpInterestCents: number;
  actualLpInterestCents: number;
  varianceCents: number;
  reason: string;
}

interface InvestorReconciliation {
  ok: boolean;
  toleranceCents: number;
  variances: InvestorReconciliationVariance[];
  checkedNotes: number;
}

interface InvestorBatchResponse {
  taxYear: number;
  statements: InvestorStatementPreview[];
  totalInvestorInterestCents: number;
  pdfs?: Array<{ investorName: string; pdfBase64: string; totalCents: number }>;
  reconciliation?: InvestorReconciliation | null;
}

function InvestorStatementsSection({ taxYear }: { taxYear: number }) {
  const { toast } = useToast();
  const [pdfs, setPdfs] = useState<InvestorBatchResponse["pdfs"]>([]);
  const [reconciliation, setReconciliation] = useState<InvestorReconciliation | null>(null);

  const previewQuery = useQuery<InvestorBatchResponse>({
    queryKey: ["/api/accounting/investor-income", taxYear],
    queryFn: async () => {
      const res = await fetch(`/api/accounting/investor-income?taxYear=${taxYear}`, {
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Failed" }));
        throw new Error(err.message || `Failed (${res.status})`);
      }
      return res.json();
    },
  });

  // allow-no-invalidation: generated statements render from mutation.data — no cached query reads them
  const generateMutation = useMutation({
    mutationFn: async () => {
      const csrfToken = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/)?.[1] || "";
      const res = await fetch(`/api/accounting/investor-statements?taxYear=${taxYear}`, {
        method: "POST",
        credentials: "include",
        headers: { "x-csrf-token": decodeURIComponent(csrfToken) },
      });
      const json = await res.json().catch(() => ({}));
      // 422 = Rachel's reconciliation gate refused. Surface the variance,
      // but treat this as a structured non-error response so the UI can
      // render the per-note variance table.
      if (res.status === 422 && json?.error === "reconciliation_failed") {
        return { ...json, __refused: true } as InvestorBatchResponse & { __refused: true; message?: string };
      }
      if (!res.ok) {
        throw new Error(json?.message || "Generate failed");
      }
      return json as InvestorBatchResponse;
    },
    onSuccess: (data) => {
      const refused = (data as any).__refused === true;
      setReconciliation(data.reconciliation ?? null);
      if (refused) {
        setPdfs([]);
        toast({
          title: "Statements refused — reconciliation failed",
          description: `${data.reconciliation?.variances.length ?? 0} note(s) don't tie to ledger. PDFs not generated.`,
          variant: "destructive",
        });
        return;
      }
      setPdfs(data.pdfs ?? []);
      toast({ title: "Statements generated", description: `${data.statements.length} per-investor PDFs ready.` });
    },
    onError: (err: any) => {
      toast({ title: "Generate failed", description: err.message, variant: "destructive" });
    },
  });

  const previews = previewQuery.data?.statements ?? [];

  if (previewQuery.isLoading) {
    return <Card className="mb-6"><div className="p-5"><Skeleton className="h-20 w-full" /></div></Card>;
  }

  // Section is conditional: hide entirely when there's no pool ownership.
  if (previews.length === 0) {
    return null;
  }

  return (
    <Card className="mb-6">
      <div className="p-5">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-primary" aria-hidden="true" />
            <div>
              <h2 className="text-sm font-semibold">Investor statements ({taxYear})</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Per-LP share of interest income across pool-owned notes. Form choice
                (1099-INT vs. K-1) is your CPA's call based on pool legal structure.
              </p>
            </div>
          </div>
          <Button
            size="sm"
            onClick={() => generateMutation.mutate()}
            disabled={generateMutation.isPending}
            data-testid="generate-investor-statements"
          >
            {generateMutation.isPending ? (
              <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> Generating…</>
            ) : (
              <><FileText className="w-4 h-4 mr-1.5" /> Generate statements</>
            )}
          </Button>
        </div>
        <Separator className="mb-3" />

        <div className="overflow-x-auto -mx-2">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-muted-foreground">
                <th className="px-2 py-2 text-left font-medium">Investor</th>
                <th className="px-2 py-2 text-left font-medium">Email</th>
                <th className="px-2 py-2 text-right font-medium">Notes</th>
                <th className="px-2 py-2 text-right font-medium">{taxYear} interest share</th>
              </tr>
            </thead>
            <tbody>
              {previews.map((s) => (
                <tr key={`${s.investorName}|${s.investorEmail ?? ""}`} className="border-t border-border/40">
                  <td className="px-2 py-2 font-medium">{s.investorName}</td>
                  <td className="px-2 py-2 text-xs text-muted-foreground">{s.investorEmail || "—"}</td>
                  <td className="px-2 py-2 text-right font-mono text-xs">{s.perNote.length}</td>
                  <td className="px-2 py-2 text-right font-mono">{fmtUsd(s.totalInterestCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Rachel's reconciliation gate — when variances are present we
            refused to render PDFs. Surface per-note divergence so the
            operator can fix splits or post missing payments before retry. */}
        {reconciliation && !reconciliation.ok && reconciliation.variances.length > 0 && (
          <>
            <Separator className="my-4" />
            <div className="rounded-card border border-destructive/30 bg-destructive/5 p-3">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="w-4 h-4 text-destructive" aria-hidden="true" />
                <p className="text-sm font-semibold text-destructive">
                  Reconciliation failed — statements not generated
                </p>
              </div>
              <p className="text-xs text-muted-foreground mb-3">
                Per-LP shares don't tie to the underlying payment ledger on{" "}
                {reconciliation.variances.length} of {reconciliation.checkedNotes} note
                {reconciliation.checkedNotes === 1 ? "" : "s"}. Tolerance is{" "}
                {reconciliation.toleranceCents}¢ per note (rounding headroom). Fix the
                split rows or post the missing payment, then retry.
              </p>
              <div className="overflow-x-auto -mx-1">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-muted-foreground">
                      <th className="px-1 py-1 text-left font-medium">Note</th>
                      <th className="px-1 py-1 text-left font-medium">Borrower</th>
                      <th className="px-1 py-1 text-right font-medium">Note interest</th>
                      <th className="px-1 py-1 text-right font-medium">LP bps</th>
                      <th className="px-1 py-1 text-right font-medium">Expected</th>
                      <th className="px-1 py-1 text-right font-medium">Actual</th>
                      <th className="px-1 py-1 text-right font-medium">Δ</th>
                      <th className="px-1 py-1 text-left font-medium">Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reconciliation.variances.slice(0, 20).map((v) => (
                      <tr key={v.noteId} className="border-t border-border/40">
                        <td className="px-1 py-1 font-mono">{v.noteNumber}</td>
                        <td className="px-1 py-1 truncate max-w-[10rem]" title={v.payerName}>
                          {v.payerName}
                        </td>
                        <td className="px-1 py-1 text-right font-mono">
                          {fmtUsd(v.notePaymentsInterestCents)}
                        </td>
                        <td className="px-1 py-1 text-right font-mono">{v.totalLpBps}</td>
                        <td className="px-1 py-1 text-right font-mono">
                          {fmtUsd(v.expectedLpInterestCents)}
                        </td>
                        <td className="px-1 py-1 text-right font-mono">
                          {fmtUsd(v.actualLpInterestCents)}
                        </td>
                        <td
                          className={`px-1 py-1 text-right font-mono ${v.varianceCents !== 0 ? "text-destructive" : ""}`}
                        >
                          {v.varianceCents > 0 ? "+" : ""}
                          {fmtUsd(v.varianceCents)}
                        </td>
                        <td className="px-1 py-1 text-muted-foreground">{v.reason}</td>
                      </tr>
                    ))}
                    {reconciliation.variances.length > 20 && (
                      <tr>
                        <td colSpan={8} className="px-1 py-1 text-muted-foreground italic">
                          …and {reconciliation.variances.length - 20} more
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {pdfs && pdfs.length > 0 && (
          <>
            <Separator className="my-4" />
            <p className="text-xs font-medium mb-2">Download:</p>
            <div className="space-y-1">
              {pdfs.map((p, idx) => (
                <DownloadLine
                  key={idx}
                  label={`${p.investorName} — ${fmtUsd(p.totalCents)}`}
                  filename={`investor-statement-${p.investorName.replace(/[^A-Za-z0-9]+/g, "-")}-${taxYear}.pdf`}
                  base64={p.pdfBase64}
                  mime="application/pdf"
                />
              ))}
            </div>
          </>
        )}
      </div>
    </Card>
  );
}

function ComplianceWatchSection() {
  const [, navigate] = useLocation();

  const insuranceQuery = useQuery<{ notes: Array<{ id: string; noteNumber: string; payerName: string; insuranceStatus: string; insuranceExpiresAt: string | null }> }>({
    queryKey: ["/api/notes/insurance-watch"],
    queryFn: async () => {
      const res = await fetch("/api/notes/insurance-watch", { credentials: "include" });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      return res.json();
    },
  });

  const escrowQuery = useQuery<{ notes: Array<{ id: string; noteNumber: string; payerName: string; taxDisbursementDueDate: string | null; taxDisbursementAmountCents: number | null; taxAuthorityName: string | null }>; withinDays: number }>({
    queryKey: ["/api/notes/escrow-disbursements"],
    queryFn: async () => {
      const res = await fetch("/api/notes/escrow-disbursements?withinDays=60", { credentials: "include" });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      return res.json();
    },
  });

  const insuranceIssues = insuranceQuery.data?.notes ?? [];
  const escrowDue = escrowQuery.data?.notes ?? [];

  if (insuranceIssues.length === 0 && escrowDue.length === 0) {
    return null;
  }

  return (
    <Card className="mb-6 border-acr-warning/30 bg-acr-warning/5">
      <div className="p-5">
        <div className="flex items-center gap-2 mb-3">
          <AlertTriangle className="w-4 h-4 text-acr-warning" aria-hidden="true" />
          <h2 className="text-sm font-semibold">Compliance watch</h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Insurance */}
          <div>
            <div className="flex items-center gap-1.5 mb-2">
              <Shield className="w-3.5 h-3.5 text-acr-warning" aria-hidden="true" />
              <span className="text-xs font-semibold">
                Insurance — {insuranceIssues.length} note{insuranceIssues.length === 1 ? "" : "s"}
              </span>
            </div>
            {insuranceIssues.length === 0 ? (
              <p className="text-xs text-muted-foreground">All policies current.</p>
            ) : (
              <ul className="space-y-1">
                {insuranceIssues.slice(0, 6).map((n) => (
                  <li key={n.id}>
                    <button
                      onClick={() => navigate(`/notes/${n.id}`)}
                      className="text-left text-xs hover:underline w-full flex items-center justify-between gap-2"
                    >
                      <span className="truncate">{n.payerName} <span className="text-muted-foreground">({n.noteNumber})</span></span>
                      <span className="text-muted-foreground capitalize whitespace-nowrap">{n.insuranceStatus.replace("_", " ")}</span>
                    </button>
                  </li>
                ))}
                {insuranceIssues.length > 6 && (
                  <li className="text-xs text-muted-foreground italic">…and {insuranceIssues.length - 6} more</li>
                )}
              </ul>
            )}
          </div>

          {/* Tax escrow disbursements */}
          <div>
            <div className="flex items-center gap-1.5 mb-2">
              <Landmark className="w-3.5 h-3.5 text-acr-warning" aria-hidden="true" />
              <span className="text-xs font-semibold">
                Tax disbursements due ≤ 60d — {escrowDue.length} note{escrowDue.length === 1 ? "" : "s"}
              </span>
            </div>
            {escrowDue.length === 0 ? (
              <p className="text-xs text-muted-foreground">No upcoming disbursements.</p>
            ) : (
              <ul className="space-y-1">
                {escrowDue.slice(0, 6).map((n) => (
                  <li key={n.id}>
                    <button
                      onClick={() => navigate(`/notes/${n.id}`)}
                      className="text-left text-xs hover:underline w-full flex items-center justify-between gap-2"
                    >
                      <span className="truncate">{n.payerName} <span className="text-muted-foreground">({n.noteNumber})</span></span>
                      <span className="text-muted-foreground whitespace-nowrap">
                        {n.taxDisbursementDueDate} · {n.taxDisbursementAmountCents ? fmtUsd(n.taxDisbursementAmountCents) : "—"}
                      </span>
                    </button>
                  </li>
                ))}
                {escrowDue.length > 6 && (
                  <li className="text-xs text-muted-foreground italic">…and {escrowDue.length - 6} more</li>
                )}
              </ul>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}

function DownloadLine({ label, filename, base64, mime }: { label: string; filename: string; base64: string; mime: string }) {
  const handleClick = () => {
    const byteCharacters = atob(base64);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) byteNumbers[i] = byteCharacters.charCodeAt(i);
    const blob = new Blob([new Uint8Array(byteNumbers)], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-sm">{label}</span>
      <Button variant="ghost" size="sm" onClick={handleClick}>
        <Download className="w-3.5 h-3.5 mr-1" aria-hidden="true" /> Download
      </Button>
    </div>
  );
}
