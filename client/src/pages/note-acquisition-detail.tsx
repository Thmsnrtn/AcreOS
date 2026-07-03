/**
 * /notes/pipeline/:id — single-acquisition detail with stage controls,
 * diligence checklist, and "promote to book" flow.
 */

import { useState } from "react";
import { useRoute, Link, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { ArrowLeft, FileText, AlertCircle, ChevronRight, CheckCircle2, Circle } from "lucide-react";

import { PageShell } from "@/components/page-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/empty-state";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import type { NoteAcquisitionStage } from "@/pages/notes-pipeline";
import { formatDate } from "@/lib/format";

interface ChecklistItem {
  done?: boolean;
  note?: string;
}

interface Acquisition {
  id: string;
  organizationId: number;
  payerName: string;
  propertyAddress: { line1?: string; city?: string; state?: string; zip?: string } | null;
  sourcedFrom: string | null;
  proposedFaceValueCents: number | null;
  proposedAcquisitionPriceCents: number | null;
  bpoValueCents: number | null;
  bpoOrderedAt: string | null;
  bpoReceivedAt: string | null;
  interestRateBps: number | null;
  termMonths: number | null;
  diligenceChecklist: Record<string, ChecklistItem> | null;
  stage: NoteAcquisitionStage;
  internalNotes: string | null;
  promotedToNoteId: string | null;
  createdAt: string;
  updatedAt: string;
}

const STAGE_OPTIONS: Array<{ value: NoteAcquisitionStage; label: string }> = [
  { value: "sourcing", label: "Sourcing" },
  { value: "bpo_ordered", label: "BPO ordered" },
  { value: "bpo_received", label: "BPO received" },
  { value: "diligence", label: "Diligence" },
  { value: "offer_made", label: "Offer made" },
  { value: "accepted", label: "Accepted" },
  { value: "escrow", label: "Escrow" },
  { value: "funded", label: "Funded — ready to promote" },
  { value: "passed", label: "Passed (archive)" },
];

const CHECKLIST_ITEMS: Array<{ key: string; label: string }> = [
  { key: "noteCopy", label: "Note copy received" },
  { key: "mortgageOrDot", label: "Mortgage / Deed of Trust received" },
  { key: "paymentHistory", label: "Payment history reviewed" },
  { key: "titleCommitment", label: "Title commitment pulled" },
  { key: "priorAssignments", label: "Prior assignments confirmed" },
  { key: "borrowerVerified", label: "Borrower verified (locate / W-9)" },
  { key: "lienPosition", label: "Lien position confirmed" },
];

function fmtUsd(cents: number | null | undefined): string {
  if (!cents) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Math.round(cents / 100));
}

export default function NoteAcquisitionDetailPage() {
  const [, params] = useRoute<{ id: string }>("/notes/pipeline/:id");
  const id = params?.id ?? null;
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [promoteOpen, setPromoteOpen] = useState(false);

  useDocumentTitle("Acquisition — AcreOS");

  const { data, isLoading, isError } = useQuery<{ acquisition: Acquisition }>({
    queryKey: ["/api/note-acquisitions", id],
    queryFn: async () => {
      const res = await fetch(`/api/note-acquisitions/${id}`, { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to load (${res.status})`);
      return res.json();
    },
    enabled: !!id,
  });

  const patchMutation = useMutation({
    mutationFn: async (patch: Partial<Acquisition>) => {
      const csrfToken = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/)?.[1] || "";
      const res = await fetch(`/api/note-acquisitions/${id}`, {
        method: "PATCH",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": decodeURIComponent(csrfToken),
        },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Save failed" }));
        throw new Error(err.message || "Save failed");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/note-acquisitions", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/note-acquisitions"] });
    },
    onError: (err: any) => {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    },
  });

  if (!id) {
    return (
      <PageShell>
        <BackButton />
        <EmptyState
          icon={FileText}
          headline="Acquisition not found"
          subtitle="The URL is missing a valid ID."
          cta={{
            label: "Back to pipeline",
            onClick: () => { window.location.href = "/notes/pipeline"; },
            "data-testid": "note-acq-back-to-pipeline",
          }}
          actionIcon={null}
        />
      </PageShell>
    );
  }

  if (isLoading) {
    return (
      <PageShell>
        <BackButton />
        <div className="space-y-4" aria-busy="true">
          <Skeleton className="h-12 w-72" />
          <Skeleton className="h-40" />
          <Skeleton className="h-60" />
        </div>
      </PageShell>
    );
  }

  if (isError || !data?.acquisition) {
    return (
      <PageShell>
        <BackButton />
        <EmptyState
          icon={AlertCircle}
          headline="Acquisition not found"
          subtitle="It may have been deleted or you don't have access."
          cta={{
            label: "Back to pipeline",
            onClick: () => { window.location.href = "/notes/pipeline"; },
            "data-testid": "note-acq-not-found-back",
          }}
          actionIcon={null}
        />
      </PageShell>
    );
  }

  const acq = data.acquisition;
  const checklist = acq.diligenceChecklist ?? {};

  const toggleChecklistItem = (key: string) => {
    const item = checklist[key] ?? {};
    const next = { ...checklist, [key]: { ...item, done: !item.done } };
    patchMutation.mutate({ diligenceChecklist: next as any });
  };

  return (
    <PageShell>
      <BackButton />

      <div className="flex items-start justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{acq.payerName}</h1>
          {acq.propertyAddress?.line1 && (
            <p className="text-sm text-muted-foreground mt-1">
              {acq.propertyAddress.line1}
              {acq.propertyAddress.city && `, ${acq.propertyAddress.city}`}
              {acq.propertyAddress.state && `, ${acq.propertyAddress.state}`}
            </p>
          )}
          {acq.sourcedFrom && (
            <p className="text-xs text-muted-foreground mt-0.5">Sourced from {acq.sourcedFrom}</p>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Select
            value={acq.stage}
            onValueChange={(v) => patchMutation.mutate({ stage: v as NoteAcquisitionStage })}
          >
            <SelectTrigger className="w-48" aria-label="Stage" data-testid="acquisition-stage-select">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STAGE_OPTIONS.map((s) => (
                <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {acq.promotedToNoteId && (
        <Card className="mb-6 border-acr-pos/30 bg-acr-pos/5">
          <div className="p-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-acr-pos" aria-hidden="true" />
              <span className="text-sm font-medium">
                Promoted to your servicing book.
              </span>
            </div>
            <Button variant="outline" size="sm" onClick={() => navigate(`/notes/${acq.promotedToNoteId}`)}>
              Open note <ChevronRight className="w-3.5 h-3.5 ml-1" aria-hidden="true" />
            </Button>
          </div>
        </Card>
      )}

      {/* Top stat row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <NumberField
          label="Face value (UPB)"
          cents={acq.proposedFaceValueCents}
          onSave={(cents) => patchMutation.mutate({ proposedFaceValueCents: cents } as any)}
          disabled={!!acq.promotedToNoteId}
        />
        <NumberField
          label="Proposed price"
          cents={acq.proposedAcquisitionPriceCents}
          onSave={(cents) => patchMutation.mutate({ proposedAcquisitionPriceCents: cents } as any)}
          disabled={!!acq.promotedToNoteId}
        />
        <NumberField
          label="BPO value"
          cents={acq.bpoValueCents}
          onSave={(cents) => patchMutation.mutate({ bpoValueCents: cents } as any)}
          disabled={!!acq.promotedToNoteId}
          hint={acq.bpoReceivedAt ? `Received ${formatDate(acq.bpoReceivedAt)}` : undefined}
        />
      </div>

      {/* Diligence checklist */}
      <Card className="mb-6">
        <div className="p-5">
          <h2 className="text-sm font-semibold mb-3">Diligence checklist</h2>
          <Separator className="mb-3" />
          <ul className="space-y-2">
            {CHECKLIST_ITEMS.map((item) => {
              const c = checklist[item.key] ?? {};
              return (
                <li key={item.key}>
                  <button
                    onClick={() => toggleChecklistItem(item.key)}
                    disabled={!!acq.promotedToNoteId}
                    className="w-full flex items-center gap-3 p-2 rounded-md hover:bg-accent/50 transition-colors text-left disabled:opacity-60"
                    data-testid={`checklist-${item.key}`}
                  >
                    {c.done ? (
                      <CheckCircle2 className="w-5 h-5 text-acr-pos shrink-0" aria-hidden="true" />
                    ) : (
                      <Circle className="w-5 h-5 text-muted-foreground shrink-0" aria-hidden="true" />
                    )}
                    <span className={`text-sm ${c.done ? "text-muted-foreground line-through" : ""}`}>
                      {item.label}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </Card>

      {/* Internal notes */}
      <NotesField
        value={acq.internalNotes ?? ""}
        onSave={(v) => patchMutation.mutate({ internalNotes: v } as any)}
        disabled={!!acq.promotedToNoteId}
      />

      {/* Promote to book — gated to 'funded' stage */}
      {acq.stage === "funded" && !acq.promotedToNoteId && (
        <Card className="border-acr-pos/30 bg-acr-pos/5">
          <div className="p-5 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold">Ready to promote</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Wire complete, assignment recorded — move this note onto your servicing book.
              </p>
            </div>
            <Button onClick={() => setPromoteOpen(true)} data-testid="promote-button">
              Promote to book
            </Button>
          </div>
        </Card>
      )}

      <PromoteDialog
        open={promoteOpen}
        onOpenChange={setPromoteOpen}
        acquisition={acq}
        onPromoted={(noteId) => {
          queryClient.invalidateQueries({ queryKey: ["/api/note-acquisitions", id] });
          queryClient.invalidateQueries({ queryKey: ["/api/notes"] });
          navigate(`/notes/${noteId}`);
        }}
      />
    </PageShell>
  );
}

function BackButton() {
  return (
    <Link href="/notes/pipeline">
      <Button variant="ghost" size="sm" className="mb-3 -ml-2">
        <ArrowLeft className="w-4 h-4 mr-1.5" aria-hidden="true" />
        Back to pipeline
      </Button>
    </Link>
  );
}

function NumberField({ label, cents, onSave, disabled, hint }: {
  label: string;
  cents: number | null;
  onSave: (cents: number) => void;
  disabled?: boolean;
  hint?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(cents ? String(cents / 100) : "");

  const commit = () => {
    const parsed = parseFloat(value.replace(/[$,\s]/g, ""));
    if (isFinite(parsed)) onSave(Math.round(parsed * 100));
    setEditing(false);
  };

  return (
    <Card className="p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      {editing ? (
        <Input
          autoFocus
          inputMode="decimal"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === "Enter") commit(); else if (e.key === "Escape") setEditing(false); }}
          className="text-2xl font-semibold mt-1 h-10"
        />
      ) : (
        <button
          onClick={() => !disabled && setEditing(true)}
          disabled={disabled}
          className="text-2xl font-semibold tracking-tight mt-1 text-left w-full hover:bg-accent/30 rounded px-1 -mx-1 disabled:hover:bg-transparent"
        >
          {fmtUsd(cents)}
        </button>
      )}
      {hint && <div className="text-xs text-muted-foreground mt-1">{hint}</div>}
    </Card>
  );
}

function NotesField({ value, onSave, disabled }: { value: string; onSave: (v: string) => void; disabled?: boolean }) {
  const [local, setLocal] = useState(value);
  return (
    <Card className="mb-6">
      <div className="p-5">
        <Label htmlFor="acq-notes" className="text-sm font-semibold">Internal notes</Label>
        <Textarea
          id="acq-notes"
          value={local}
          onChange={(e) => setLocal(e.target.value)}
          onBlur={() => { if (local !== value) onSave(local); }}
          disabled={disabled}
          placeholder="Offer rationale, seller comments, contingencies…"
          className="mt-2 min-h-[80px]"
        />
      </div>
    </Card>
  );
}

function PromoteDialog({ open, onOpenChange, acquisition, onPromoted }: {
  open: boolean;
  onOpenChange: (b: boolean) => void;
  acquisition: Acquisition;
  onPromoted: (noteId: string) => void;
}) {
  const { toast } = useToast();
  const [noteNumber, setNoteNumber] = useState("");
  const [originalPrincipal, setOriginalPrincipal] = useState(
    acquisition.proposedFaceValueCents ? String(acquisition.proposedFaceValueCents / 100) : "",
  );
  const [acquisitionPrice, setAcquisitionPrice] = useState(
    acquisition.proposedAcquisitionPriceCents ? String(acquisition.proposedAcquisitionPriceCents / 100) : "",
  );
  const [currentBalance, setCurrentBalance] = useState(originalPrincipal);
  const [interestRate, setInterestRate] = useState(
    acquisition.interestRateBps ? String(acquisition.interestRateBps / 100) : "",
  );
  const [termMonths, setTermMonths] = useState(
    acquisition.termMonths ? String(acquisition.termMonths) : "360",
  );
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentDueDay, setPaymentDueDay] = useState("1");
  const [originationDate, setOriginationDate] = useState("");
  const [maturityDate, setMaturityDate] = useState("");
  const [acquisitionDate, setAcquisitionDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [originalLender, setOriginalLender] = useState(acquisition.sourcedFrom ?? "");

  // allow-no-invalidation: onSuccess hands off via onPromoted(noteId) — the parent navigates and refreshes
  const promoteMutation = useMutation({
    mutationFn: async () => {
      const csrfToken = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/)?.[1] || "";
      const res = await fetch(`/api/note-acquisitions/${acquisition.id}/promote`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": decodeURIComponent(csrfToken),
        },
        body: JSON.stringify({
          noteNumber: noteNumber.trim(),
          originalPrincipalCents: Math.round(parseFloat(originalPrincipal) * 100),
          acquisitionPriceCents: Math.round(parseFloat(acquisitionPrice) * 100),
          currentBalanceCents: Math.round(parseFloat(currentBalance) * 100),
          interestRateBps: Math.round(parseFloat(interestRate) * 100),
          termMonths: parseInt(termMonths, 10),
          paymentAmountCents: Math.round(parseFloat(paymentAmount || "0") * 100),
          paymentDueDay: parseInt(paymentDueDay, 10),
          originationDate,
          maturityDate,
          acquisitionDate,
          payerAddress: acquisition.propertyAddress ?? undefined,
          originalLender: originalLender.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Promote failed" }));
        throw new Error(err.message || "Promote failed");
      }
      return res.json() as Promise<{ note: { id: string } }>;
    },
    onSuccess: (result) => {
      toast({ title: "Promoted", description: `${acquisition.payerName} is on your servicing book.` });
      onOpenChange(false);
      onPromoted(result.note.id);
    },
    onError: (err: any) => {
      toast({ title: "Couldn't promote", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Promote to servicing book</DialogTitle>
          <DialogDescription>
            Confirm the final terms. This creates a row in your acquired notes and
            archives the pipeline entry.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="note-number">Note number *</Label>
            <Input id="note-number" value={noteNumber} onChange={(e) => setNoteNumber(e.target.value)} placeholder="HEND-2026-001" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field id="orig-prin" label="Original face *" value={originalPrincipal} onChange={setOriginalPrincipal} />
            <Field id="acq-price" label="Acquisition price *" value={acquisitionPrice} onChange={setAcquisitionPrice} />
            <Field id="cur-bal" label="Current balance *" value={currentBalance} onChange={setCurrentBalance} />
            <Field id="int-rate" label="Interest rate %" value={interestRate} onChange={setInterestRate} />
            <Field id="term" label="Term (months) *" value={termMonths} onChange={setTermMonths} />
            <Field id="pmt-amt" label="Monthly payment" value={paymentAmount} onChange={setPaymentAmount} />
            <Field id="due-day" label="Due day (1-31)" value={paymentDueDay} onChange={setPaymentDueDay} />
            <Field id="lender" label="Original lender" value={originalLender} onChange={setOriginalLender} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <DateField id="orig-date" label="Origination *" value={originationDate} onChange={setOriginationDate} />
            <DateField id="mat-date" label="Maturity *" value={maturityDate} onChange={setMaturityDate} />
            <DateField id="acq-date" label="Acquired *" value={acquisitionDate} onChange={setAcquisitionDate} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={() => promoteMutation.mutate()}
            disabled={!noteNumber || !originalPrincipal || !acquisitionPrice || !currentBalance || !termMonths || !originationDate || !maturityDate || !acquisitionDate || promoteMutation.isPending}
          >
            {promoteMutation.isPending ? "Promoting…" : "Promote to book"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (s: string) => void }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs">{label}</Label>
      <Input id={id} inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} className="h-9" />
    </div>
  );
}

function DateField({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (s: string) => void }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs">{label}</Label>
      <Input id={id} type="date" value={value} onChange={(e) => onChange(e.target.value)} className="h-9" />
    </div>
  );
}
