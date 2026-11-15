/**
 * Delinquency ladder — V-Notes-2 Leg 1, on the acquired-note detail page.
 * EVIDENCE AND RECORD ONLY: it shows the stages the aging sweep recorded (each
 * with its input snapshot), the stage the note's stored aging gives now, and —
 * as a separate operator act — default review. It contacts no one, drafts
 * nothing for the borrower and starts no clock. The escalation bundle is
 * assembled on request for the operator, from recorded facts.
 */
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ListOrdered } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { QueryErrorState } from "@/components/query-error-state";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { dollars, formatDate, formatDateTime } from "@/lib/format";
import { Verbs } from "@/lib/labels";
import { useToast } from "@/hooks/use-toast";
import type { EscalationBundle, LadderView } from "@shared/notes/delinquencyLadderView";

const MUTED = "text-xs text-muted-foreground";
const human = (x: string): string => x.replace(/_/g, " ");

function SnapshotDetails({ snapshot }: { snapshot: Record<string, unknown> }) {
  const s = snapshot as { daysDelinquent?: number; paidThroughDate?: string | null; nextPaymentDate?: string | null; agingRun?: { asOf?: string } };
  return (
    <dl className="mt-1 grid grid-cols-2 gap-x-4 text-xs text-muted-foreground">
      <dt>Days past due</dt><dd>{s.daysDelinquent ?? "—"}</dd>
      <dt>Paid through</dt><dd>{s.paidThroughDate ? formatDate(s.paidThroughDate) : "not on record"}</dd>
      <dt>Next payment due (derived)</dt><dd>{s.nextPaymentDate ? formatDate(s.nextPaymentDate) : "—"}</dd>
      <dt>Aging run</dt><dd>{s.agingRun?.asOf ? formatDateTime(s.agingRun.asOf) : "—"}</dd>
    </dl>
  );
}

function Bundle({ noteId }: { noteId: string }) {
  const q = useQuery<EscalationBundle | { status: "not_escalated"; reason: string }>({ queryKey: [`/api/notes/${noteId}/delinquency-ladder/bundle`] });
  if (q.isLoading) return <Skeleton className="h-40 w-full" />;
  if (q.isError || !q.data) return <QueryErrorState error={q.error as Error} title="Escalation bundle" onRetry={() => void q.refetch()} />;
  if ("status" in q.data) return <p className="text-sm text-muted-foreground">{q.data.reason}</p>;
  const b = q.data;
  const ep = b.extendAndPretend;
  const docs = b.documents as { complete?: boolean; gaps?: string[] } | null;
  return (
    <div className="space-y-3 rounded-md border p-3 text-sm">
      <p className={MUTED}>Assembled {formatDateTime(b.assembledAt)} from recorded facts, for you. Not a borrower-facing document.</p>
      {docs && (
        <section>
          <h4 className="font-medium">Documents</h4>
          <p className={docs.complete ? "text-xs text-muted-foreground" : "text-xs"}>{docs.complete ? "The critical document set is complete." : `Incomplete: ${(docs.gaps ?? []).join("; ")}`}</p>
        </section>
      )}
      <section>
        <h4 className="font-medium">Payment pattern (recorded payments)</h4>
        {ep.status === "not_determinable" ? (
          <p className={MUTED}>{ep.reason}</p>
        ) : (
          <p className="text-xs">
            {ep.status === "pattern" ? "Pattern: payments covered interest without reducing principal." : "No interest-only pattern."} {ep.paymentsInWindow} payments from {formatDate(ep.window.from)} to {formatDate(ep.window.to)}; interest received {dollars(ep.interestReceivedCents)}; principal change {dollars(ep.principalDeltaCents)}.
          </p>
        )}
      </section>
      <section>
        <h4 className="font-medium">Payment history</h4>
        {b.paymentHistory.payments.length === 0 ? (
          <p className={MUTED}>No payments recorded on this note.</p>
        ) : (
          <table className="w-full text-xs tabular-nums">
            <caption className="sr-only">Recorded payments</caption>
            <thead><tr className="text-left text-muted-foreground"><th scope="col">Date</th><th scope="col">Type</th><th scope="col">Principal</th><th scope="col">Interest</th><th scope="col">Unapplied</th></tr></thead>
            <tbody>
              {b.paymentHistory.payments.slice(-12).map((p, i) => (
                <tr key={i}><td>{formatDate(p.paymentDate)}</td><td>{human(p.paymentType)}</td><td>{dollars(p.principalCents)}</td><td>{dollars(p.interestCents)}</td><td>{dollars(p.unappliedCents)}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <section>
        <h4 className="font-medium">Scope facts on record</h4>
        <ul className="text-xs">
          <li>Consumer purpose: {b.scope.isConsumerPurpose ? "yes" : "no"} · Dwelling collateral: {b.scope.collateralIsDwelling ? "yes" : "no"}</li>
          <li>RESPA §1024.39 day-36 flag: {b.scope.respaEarlyIntervention ? `attached ${formatDate(b.scope.respaEarlyIntervention.firedAt)}` : "not attached"}</li>
          <li>SCRA check: {b.scope.scra ? (b.scope.scra.checkedAt ? `checked ${formatDate(b.scope.scra.checkedAt)}${b.scope.scra.activeDuty ? " — active duty" : ""}` : "not recorded on the case") : "no loss-mit case"}</li>
        </ul>
      </section>
      <section>
        <h4 className="font-medium">Loss-mit case</h4>
        <p className="text-xs">{b.lossMitCase ? `${human(b.lossMitCase.status)} — opened ${formatDate(b.lossMitCase.openedAt)}` : "No case opened. Opening one is your call, on the loss-mit card."}</p>
      </section>
    </div>
  );
}

export function NoteDelinquencyLadderPanel({ noteId }: { noteId: string }) {
  const { toast } = useToast();
  const [showBundle, setShowBundle] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [note, setNote] = useState("");
  const q = useQuery<LadderView>({ queryKey: [`/api/notes/${noteId}/delinquency-ladder`] });
  const record = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/notes/${noteId}/delinquency-ladder/default-review`, { note: note.trim() || null })).json(),
    onSuccess: () => {
      setConfirming(false);
      void queryClient.invalidateQueries({ queryKey: [`/api/notes/${noteId}/delinquency-ladder`] });
    },
    onError: (e: unknown) => toast({ title: "Default review was not recorded", description: e instanceof Error ? e.message : undefined, variant: "destructive" }),
  });

  if (q.isLoading) return <Skeleton className="h-28 w-full" />;
  if (q.isError || !q.data) return <QueryErrorState error={q.error as Error} title="Delinquency ladder" onRetry={() => void q.refetch()} />;
  const v = q.data;

  return (
    <Card className="space-y-3 p-4" data-testid="note-delinquency-ladder">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold"><ListOrdered className="h-4 w-4" aria-hidden="true" /> Delinquency ladder</h2>
          <p className={MUTED}>What the aging record shows, stage by stage. A record only — nothing here contacts the borrower.</p>
        </div>
        {v.current ? <Badge variant="outline">{v.current.label}</Badge> : null}
      </div>

      {!v.current && <p className="text-sm" data-testid="ladder-not-determinable">{v.reason}</p>}
      {v.disagreement && (
        <p className="rounded-md border border-dashed p-2 text-xs" role="note">
          Last recorded stage: {human(v.disagreement.recordedStage)}; the stored aging now gives {human(v.disagreement.currentStage)}. {v.disagreement.note}
        </p>
      )}

      {v.recorded.length === 0 ? (
        <p className={MUTED}>No stage has been recorded: this note has not left current since the ladder began recording.</p>
      ) : (
        <ol className="space-y-2" aria-label="Recorded stage entries">
          {v.recorded.map((r) => (
            <li key={r.id} className="rounded-md border p-2">
              <details>
                <summary className="cursor-pointer text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  {formatDate(r.eventDate)} — entered {r.label}{r.priorStage ? ` (from ${human(r.priorStage)})` : ""}
                </summary>
                <SnapshotDetails snapshot={r.snapshot} />
              </details>
            </li>
          ))}
        </ol>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t pt-3">
        {v.defaultReview ? (
          <p className="text-sm">
            Default review recorded {formatDateTime(v.defaultReview.recordedAt)}{v.defaultReview.operatorNote ? ` — “${v.defaultReview.operatorNote}”` : ""}.
          </p>
        ) : (
          v.current && (
            <Button size="sm" variant="outline" onClick={() => setConfirming(true)}>Record default review</Button>
          )
        )}
        {v.escalates && (
          <Button size="sm" variant="ghost" aria-expanded={showBundle} onClick={() => setShowBundle((s) => !s)}>
            {showBundle ? "Hide escalation bundle" : "Assemble escalation bundle"}
          </Button>
        )}
      </div>
      {showBundle && <Bundle noteId={noteId} />}

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record default review</DialogTitle>
            <DialogDescription>
              Records, under your name and today's date, that you placed this note in default review. It is recorded once and kept. It is not a declaration of default and sends nothing.
            </DialogDescription>
          </DialogHeader>
          <div>
            <Label htmlFor="default-review-note">Note (optional)</Label>
            <Textarea id="default-review-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirming(false)}>{Verbs.CANCEL}</Button>
            <Button onClick={() => record.mutate()} disabled={record.isPending}>{record.isPending ? "Recording…" : "Record default review"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
