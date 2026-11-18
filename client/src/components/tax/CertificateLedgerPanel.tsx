/**
 * The certificate / deed ledger for one position — V-Tax-1 T3b. Under the
 * redemption clock. Lien amount, rate, deadline and what it rests on,
 * subsequent taxes paid, interest (encoded states only), the notices the
 * operator recorded, and the foreclosure-filing deadline — each with its basis.
 *
 * A notice recorded here by hand is a RECORD of one the operator sent
 * outside AcreOS. A notice can also be sent in-product through the
 * Settlement & Documents Rail (the control below the position record):
 * those entries are written from the mail provider's receipt and carry
 * its id. Whether subsequent taxes are reimbursed is the county
 * procedure's rule, shown with its source, never added in by AcreOS.
 */
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { BookOpen, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryErrorState } from "@/components/query-error-state";
import { useToast } from "@/hooks/use-toast";
import { ApiError, apiRequest, queryClient } from "@/lib/queryClient";
import { formatDate } from "@/lib/format";
import type { CertificateLedger } from "@shared/tax/ledger";
import {
  REDEMPTION_NOTICE_DRAFT_TEXT,
  REDEMPTION_NOTICE_FAILURE_TEXT,
  redemptionNoticeReceiptText,
  redemptionNoticeRefusalText,
  type RedemptionNoticeDelivery,
} from "./redemptionNoticeCopy";

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
            <ul className="text-xs">{l.notices.map((n, i) => <li key={i}>{formatDate(n.sentOn)} · {n.method}{n.note ? ` · ${n.note}` : ""} — {n.source}{n.viaRail ? <> · sent through AcreOS{n.providerId ? <> · provider id {n.providerId}</> : null}</> : null}</li>)}</ul>
          )}
        </dd>
        <dt className="text-muted-foreground">Foreclosure-filing deadline</dt>
        <dd data-testid="ledger-foreclosure">{l.foreclosureFilingDeadline.status === "stated" ? <>{formatDate(l.foreclosureFilingDeadline.date)} <span className="text-xs text-muted-foreground">— {l.foreclosureFilingDeadline.basis}</span></> : <span className="text-muted-foreground">{l.foreclosureFilingDeadline.why}</span>}</dd>
      </dl>
      <RedemptionNoticeControl certificateId={certificateId} queryKey={key} />
      <LedgerEntryForm certificateId={certificateId} queryKey={key} />
    </section>
  );
}

type NoticeOutcome =
  | { kind: "sent"; text: string; expectedDeliveryDate: string | null }
  | { kind: "draft" }
  | { kind: "refused"; text: string }
  | { kind: "failed" };

type NoticeLane = "certified_mail" | "mail" | "download";
const LANE_LABEL: Record<NoticeLane, string> = {
  certified_mail: "Certified mail",
  mail: "Mail",
  download: "Download a draft (you mail it yourself)",
};

/**
 * Send the statutory redemption notice through the rail (T-P1 / T-DEF-3).
 * The endpoint is fail-closed: a 422 names its reason and nothing was
 * sent; a mail lane answers only with the provider's receipt; download
 * returns a draft and records nothing. The outcome line below renders
 * exactly which of those happened — a refusal or a failure never reads
 * as a send.
 */
function RedemptionNoticeControl({ certificateId, queryKey }: { certificateId: string; queryKey: string }) {
  const [lane, setLane] = useState<NoticeLane>("certified_mail");
  const [amount, setAmount] = useState("");
  const [amountSource, setAmountSource] = useState("");
  const [outcome, setOutcome] = useState<NoticeOutcome | null>(null);
  const amountPaired = (amount.trim() === "") === (amountSource.trim() === "");

  const send = useMutation({
    mutationFn: async (): Promise<NoticeOutcome> => {
      const body: Record<string, unknown> = { delivery: lane };
      if (amount.trim() !== "") {
        body.redemptionAmountCents = Math.round(Number(amount) * 100);
        body.redemptionAmountSource = amountSource.trim();
      }
      const res = await apiRequest("POST", `/api/tax-certificates/${certificateId}/redemption-notice`, body);
      if (lane === "download") {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `redemption-notice-${certificateId}.pdf`;
        a.click();
        URL.revokeObjectURL(url);
        return { kind: "draft" };
      }
      const data = (await res.json()) as { delivery: RedemptionNoticeDelivery };
      return { kind: "sent", text: redemptionNoticeReceiptText(data.delivery), expectedDeliveryDate: data.delivery.expectedDeliveryDate };
    },
    onSuccess: (o) => {
      setOutcome(o);
      if (o.kind === "sent") queryClient.invalidateQueries({ queryKey: [queryKey] });
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 422) {
        const details = err.body?.details as { reason?: unknown } | undefined;
        setOutcome({ kind: "refused", text: redemptionNoticeRefusalText(details?.reason, err.body?.message) });
      } else if (err instanceof ApiError && err.status === 400 && err.body?.message) {
        // A delivery-lane refusal (e.g. no verified sender identity): the
        // server's message is written for the operator — show it as-is.
        setOutcome({ kind: "refused", text: `Not sent — ${err.body.message}` });
      } else {
        setOutcome({ kind: "failed" });
      }
    },
  });

  const id = `notice-${certificateId}`;
  return (
    <div className="space-y-2 rounded-md border p-3 text-xs" data-testid="redemption-notice-control">
      <h4 className="flex items-center gap-2 text-sm font-semibold"><Send className="h-4 w-4" aria-hidden="true" />Send redemption notice</h4>
      <p className="text-muted-foreground">Drafted from this certificate and the county procedure on record. If the county's requirements are not recorded, the amount cannot be determined, or the owner's address is incomplete, AcreOS refuses and nothing is sent.</p>
      <div className="grid gap-2 sm:grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor={`${id}-delivery`} className="text-xs">Delivery</Label>
          <select id={`${id}-delivery`} data-testid="notice-delivery" className="h-8 w-full rounded-md border bg-background px-2" value={lane} onChange={(e) => setLane(e.target.value as NoticeLane)}>
            {(Object.keys(LANE_LABEL) as NoticeLane[]).map((k) => <option key={k} value={k}>{LANE_LABEL[k]}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${id}-amount`} className="text-xs">Redemption amount from the county $ (only if AcreOS cannot compute it)</Label>
          <Input id={`${id}-amount`} data-testid="notice-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="h-8" />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${id}-amount-source`} className="text-xs">Where that amount comes from</Label>
          <Input id={`${id}-amount-source`} data-testid="notice-amount-source" value={amountSource} onChange={(e) => setAmountSource(e.target.value)} className="h-8" />
        </div>
      </div>
      {!amountPaired && <p className="text-muted-foreground">Give both the amount and where it comes from, or leave both blank.</p>}
      <div className="flex justify-end">
        <Button size="sm" onClick={() => send.mutate()} disabled={send.isPending || !amountPaired} data-testid="button-send-notice">{send.isPending ? "Working…" : lane === "download" ? "Download draft" : "Send redemption notice"}</Button>
      </div>
      {outcome?.kind === "sent" && (
        <p data-testid="notice-outcome" role="status">{outcome.text}{outcome.expectedDeliveryDate ? ` Expected delivery: ${formatDate(outcome.expectedDeliveryDate)}.` : ""}</p>
      )}
      {outcome?.kind === "draft" && <p data-testid="notice-outcome" role="status">{REDEMPTION_NOTICE_DRAFT_TEXT}</p>}
      {outcome?.kind === "refused" && <p data-testid="notice-outcome" role="alert" className="text-destructive">{outcome.text}</p>}
      {outcome?.kind === "failed" && <p data-testid="notice-outcome" role="alert" className="text-destructive">{REDEMPTION_NOTICE_FAILURE_TEXT}</p>}
    </div>
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
