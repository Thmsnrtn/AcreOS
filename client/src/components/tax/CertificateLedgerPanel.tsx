/**
 * The certificate / deed ledger for one position — V-Tax-1 T3b. Under the
 * redemption clock. Lien amount, rate, deadline and what it rests on,
 * subsequent taxes paid, interest (encoded states only), the notices the
 * operator recorded, and the foreclosure-filing deadline — each with its basis.
 *
 * A notice here is a RECORD of one the operator sent outside AcreOS; AcreOS
 * sends nothing. Whether subsequent taxes are reimbursed is the county
 * procedure's rule, shown with its source, never added in by AcreOS.
 */
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryErrorState } from "@/components/query-error-state";
import { useToast } from "@/hooks/use-toast";
import { ApiError, apiRequest, queryClient } from "@/lib/queryClient";
import { formatDate } from "@/lib/format";
import type { CertificateLedger } from "@shared/tax/ledger";

const usd = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
type Kind = "subsequent_tax_paid" | "redemption_notice_recorded" | "foreclosure_filing_deadline";
const KIND_LABEL: Record<Kind, string> = {
  subsequent_tax_paid: "A subsequent tax you paid",
  redemption_notice_recorded: "A redemption notice you sent",
  foreclosure_filing_deadline: "The foreclosure-filing deadline",
};

export function CertificateLedgerPanel({ certificateId }: { certificateId: string }) {
  const key = `/api/tax-certificates/${certificateId}/ledger`;
  const q = useQuery<{ ledger: CertificateLedger }>({ queryKey: [key] });
  if (q.isLoading) return <Skeleton className="h-32" aria-label="Loading the position record" />;
  if (q.isError || !q.data?.ledger) return <QueryErrorState error={q.error} onRetry={() => void q.refetch()} isRetrying={q.isFetching} title="The position record could not be loaded" />;
  const l = q.data.ledger;
  return (
    <section className="space-y-2 text-sm" aria-label="Position record" data-testid={`certificate-ledger-${certificateId}`}>
      <h3 className="flex items-center gap-2 font-semibold"><BookOpen className="h-4 w-4" aria-hidden="true" />Position record</h3>
      <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-[max-content_1fr]">
        <dt className="text-muted-foreground">Lien amount</dt><dd><span className="tabular-nums">{usd(l.lienAmount.amountCents)}</span> <span className="text-xs text-muted-foreground">— {l.lienAmount.basis}</span></dd>
        <dt className="text-muted-foreground">Rate</dt><dd>{l.rate.text}</dd>
        <dt className="text-muted-foreground">Redemption deadline</dt><dd>{formatDate(l.redemptionDeadline.date)} <span className="text-xs text-muted-foreground">— {l.redemptionDeadline.basis}</span></dd>
        <dt className="text-muted-foreground">Interest accrued</dt>
        <dd data-testid="ledger-interest">{l.interest.status === "computed" ? l.interest.text : <span className="text-muted-foreground">not computed — {l.interest.why}</span>}</dd>
        <dt className="text-muted-foreground">Subsequent taxes paid</dt>
        <dd data-testid="ledger-subsequent-taxes">
          {l.subsequentTaxes.payments.length === 0 ? (
            <span className="text-muted-foreground">none recorded</span>
          ) : (
            <>
              <span className="tabular-nums">{usd(l.subsequentTaxes.totalCents)}</span>
              <ul className="text-xs text-muted-foreground">
                {l.subsequentTaxes.payments.map((p, i) => <li key={i}>{formatDate(p.paidOn)}{p.taxYear ? ` · ${p.taxYear} taxes` : ""} · <span className="tabular-nums">{usd(p.amountCents)}</span> — {p.source}</li>)}
              </ul>
            </>
          )}
          <p className="text-xs text-muted-foreground">Reimbursement: {l.subsequentTaxes.reimbursement.status === "stated" ? l.subsequentTaxes.reimbursement.text : l.subsequentTaxes.reimbursement.why}</p>
        </dd>
        <dt className="text-muted-foreground">Notices you sent</dt>
        <dd data-testid="ledger-notices">
          {l.notices.length === 0 ? <span className="text-muted-foreground">none recorded</span> : (
            <ul className="text-xs">{l.notices.map((n, i) => <li key={i}>{formatDate(n.sentOn)} · {n.method}{n.note ? ` · ${n.note}` : ""} — {n.source}</li>)}</ul>
          )}
        </dd>
        <dt className="text-muted-foreground">Foreclosure-filing deadline</dt>
        <dd data-testid="ledger-foreclosure">{l.foreclosureFilingDeadline.status === "stated" ? <>{formatDate(l.foreclosureFilingDeadline.date)} <span className="text-xs text-muted-foreground">— {l.foreclosureFilingDeadline.basis}</span></> : <span className="text-muted-foreground">{l.foreclosureFilingDeadline.why}</span>}</dd>
      </dl>
      <LedgerEntryForm certificateId={certificateId} queryKey={key} />
    </section>
  );
}

function LedgerEntryForm({ certificateId, queryKey }: { certificateId: string; queryKey: string }) {
  const { toast } = useToast();
  const [kind, setKind] = useState<Kind>("subsequent_tax_paid");
  const [date, setDate] = useState("");
  const [amount, setAmount] = useState("");
  const [taxYear, setTaxYear] = useState("");
  const [method, setMethod] = useState("");
  const [note, setNote] = useState("");
  const [source, setSource] = useState("");

  const record = useMutation({
    mutationFn: async () => {
      const body =
        kind === "subsequent_tax_paid"
          ? { kind, paidOn: date, amountCents: Math.round(Number(amount) * 100), taxYear: taxYear.trim() || null, source: source.trim() }
          : kind === "redemption_notice_recorded"
            ? { kind, sentOn: date, method: method.trim(), note: note.trim() || null, source: source.trim() }
            : { kind, date, source: source.trim() };
      return apiRequest("POST", `/api/tax-certificates/${certificateId}/ledger`, body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [queryKey] });
      toast({ title: "Recorded on the position record" });
      setDate("");
      setAmount("");
      setTaxYear("");
      setMethod("");
      setNote("");
      setSource("");
    },
    onError: (err) => toast({ title: "Not recorded", description: err instanceof ApiError ? (err.body?.message ?? err.message) : String(err), variant: "destructive" }),
  });

  const id = `ledger-${certificateId}`;
  return (
    <div className="space-y-2 rounded-md border p-3 text-xs" data-testid="ledger-entry-form">
      <div className="space-y-1 sm:w-1/2">
        <Label htmlFor={`${id}-kind`} className="text-xs">Record</Label>
        <select id={`${id}-kind`} className="h-8 w-full rounded-md border bg-background px-2" value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
          {(Object.keys(KIND_LABEL) as Kind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
        </select>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <div className="space-y-1"><Label htmlFor={`${id}-date`} className="text-xs">{kind === "subsequent_tax_paid" ? "Paid on" : kind === "redemption_notice_recorded" ? "Sent on" : "Deadline"}</Label><Input id={`${id}-date`} type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-8" /></div>
        {kind === "subsequent_tax_paid" && (
          <>
            <div className="space-y-1"><Label htmlFor={`${id}-amount`} className="text-xs">Amount $</Label><Input id={`${id}-amount`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="h-8" /></div>
            <div className="space-y-1"><Label htmlFor={`${id}-year`} className="text-xs">Tax year</Label><Input id={`${id}-year`} inputMode="numeric" value={taxYear} onChange={(e) => setTaxYear(e.target.value)} className="h-8" /></div>
          </>
        )}
        {kind === "redemption_notice_recorded" && (
          <>
            <div className="space-y-1"><Label htmlFor={`${id}-method`} className="text-xs">How you sent it</Label><Input id={`${id}-method`} placeholder="Certified mail" value={method} onChange={(e) => setMethod(e.target.value)} className="h-8" /></div>
            <div className="space-y-1"><Label htmlFor={`${id}-note`} className="text-xs">Note</Label><Input id={`${id}-note`} value={note} onChange={(e) => setNote(e.target.value)} className="h-8" /></div>
          </>
        )}
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${id}-source`} className="text-xs">{kind === "foreclosure_filing_deadline" ? "Where the deadline comes from (procedure, statute, county record)" : "Receipt or record"}</Label>
        <Input id={`${id}-source`} value={source} onChange={(e) => setSource(e.target.value)} className="h-8" />
      </div>
      <div className="flex justify-end">
        <Button size="sm" onClick={() => record.mutate()} disabled={record.isPending || !date || !source.trim()} data-testid="button-record-ledger">{record.isPending ? "Recording…" : "Record"}</Button>
      </div>
    </div>
  );
}
