/**
 * /notes/pipeline — pre-book acquisition pipeline for note investors.
 *
 * Linnea: "I see /pipeline and /leads — these are parcel-deal pipelines.
 * I need a *note acquisition* pipeline parallel to it, with different
 * stages and different deal cards." This is that.
 *
 * Stages: sourcing → bpo_ordered → bpo_received → diligence → offer_made
 *         → accepted → escrow → funded → on_book (terminal)
 *         + 'passed' (archive)
 *
 * Render is a stage-grouped list (kanban-style columns on wide screens,
 * stacked sections on narrow). Each row links to /notes/pipeline/:id
 * for full diligence checklist.
 */

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Plus, FileText, ChevronRight } from "lucide-react";

import { PageShell } from "@/components/page-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Verbs } from "@/lib/labels";

interface Acquisition {
  id: string;
  organizationId: number;
  payerName: string;
  propertyAddress: { line1?: string; city?: string; state?: string; zip?: string } | null;
  sourcedFrom: string | null;
  proposedFaceValueCents: number | null;
  proposedAcquisitionPriceCents: number | null;
  bpoValueCents: number | null;
  interestRateBps: number | null;
  termMonths: number | null;
  stage: NoteAcquisitionStage;
  internalNotes: string | null;
  promotedToNoteId: string | null;
  createdAt: string;
  updatedAt: string;
}

export type NoteAcquisitionStage =
  | "sourcing"
  | "bpo_ordered"
  | "bpo_received"
  | "diligence"
  | "offer_made"
  | "accepted"
  | "escrow"
  | "funded"
  | "on_book"
  | "passed";

const STAGE_DEFS: Array<{ stage: NoteAcquisitionStage; label: string; tone: string }> = [
  { stage: "sourcing", label: "Sourcing", tone: "bg-muted text-muted-foreground" },
  { stage: "bpo_ordered", label: "BPO ordered", tone: "bg-acr-warning/10 text-acr-warning" },
  { stage: "bpo_received", label: "BPO received", tone: "bg-acr-warning/10 text-acr-warning" },
  { stage: "diligence", label: "Diligence", tone: "bg-acr-brand/10 text-acr-brand" },
  { stage: "offer_made", label: "Offer made", tone: "bg-primary/10 text-primary" },
  { stage: "accepted", label: "Accepted", tone: "bg-primary/10 text-primary" },
  { stage: "escrow", label: "Escrow", tone: "bg-primary/10 text-primary" },
  { stage: "funded", label: "Funded", tone: "bg-acr-pos/10 text-acr-pos" },
  { stage: "on_book", label: "On book", tone: "bg-acr-pos/10 text-acr-pos" },
  { stage: "passed", label: "Passed", tone: "bg-muted text-muted-foreground" },
];

function fmtUsd(cents: number | null | undefined): string {
  if (!cents) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Math.round(cents / 100));
}

export default function NotesPipelinePage() {
  useDocumentTitle("Note acquisition pipeline — AcreOS");
  const [, navigate] = useLocation();
  const [newDialogOpen, setNewDialogOpen] = useState(false);

  const { data, isLoading } = useQuery<{ acquisitions: Acquisition[] }>({
    queryKey: ["/api/note-acquisitions"],
    queryFn: async () => {
      const res = await fetch("/api/note-acquisitions", { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to load (${res.status})`);
      return res.json();
    },
  });

  const acquisitions = data?.acquisitions ?? [];
  const byStage = new Map<NoteAcquisitionStage, Acquisition[]>();
  for (const def of STAGE_DEFS) byStage.set(def.stage, []);
  for (const a of acquisitions) {
    const list = byStage.get(a.stage) ?? [];
    list.push(a);
    byStage.set(a.stage, list);
  }

  // Hide terminal stages (on_book + passed) when empty to reduce clutter.
  const VISIBLE_STAGES = STAGE_DEFS.filter(
    (d) =>
      !((d.stage === "on_book" || d.stage === "passed") && (byStage.get(d.stage)?.length ?? 0) === 0),
  );

  return (
    <PageShell label="Note acquisition pipeline">
      <div className="flex items-start justify-between mb-6 gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Note acquisition pipeline</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Diligence stages for notes you're considering buying. Sourcing → BPO →
            diligence → offer → escrow → funded → on book. Once funded, a row promotes
            to your servicing book at <span className="font-mono text-xs">/notes</span>.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button onClick={() => setNewDialogOpen(true)} data-testid="new-acquisition-button">
            <Plus className="w-4 h-4 mr-1" aria-hidden="true" />
            New
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-40" />)}
        </div>
      ) : acquisitions.length === 0 ? (
        <EmptyState
          icon={FileText}
          headline="No acquisitions in flight"
          subtitle="When you're considering buying a note, start a row here. Track BPO, title, payment-history, and lien-position checks as you go."
          cta={{
            label: "Start an acquisition",
            onClick: () => setNewDialogOpen(true),
            "data-testid": "notes-pipeline-start-acq",
          }}
          actionIcon={null}
        />
      ) : (
        <div className="space-y-4">
          {VISIBLE_STAGES.map((def) => {
            const items = byStage.get(def.stage) ?? [];
            return (
              <div key={def.stage}>
                <div className="flex items-center gap-2 mb-2">
                  <span
                    role="heading"
                    aria-level={2}
                    className={`inline-block rounded-md px-2 py-0.5 text-xs font-medium ${def.tone}`}
                  >
                    {def.label}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {items.length}
                    <span className="sr-only"> acquisitions in this stage</span>
                  </span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {items.length === 0 ? (
                    <p className="text-xs text-muted-foreground italic">None</p>
                  ) : items.map((a) => (
                    <button
                      key={a.id}
                      onClick={() => navigate(`/notes/pipeline/${a.id}`)}
                      className="text-left bg-card hover:bg-accent/50 border border-border rounded-card p-3 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      data-testid={`acquisition-row-${a.id}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="font-medium text-sm truncate">{a.payerName}</div>
                        <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" aria-hidden="true" />
                      </div>
                      {a.propertyAddress?.line1 && (
                        <div className="text-xs text-muted-foreground truncate mt-0.5">
                          {a.propertyAddress.line1}
                          {a.propertyAddress.city && `, ${a.propertyAddress.city}`}
                        </div>
                      )}
                      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs mt-3">
                        <KV label="Face" value={fmtUsd(a.proposedFaceValueCents)} />
                        <KV label="Price" value={fmtUsd(a.proposedAcquisitionPriceCents)} />
                        {a.bpoValueCents !== null && <KV label="BPO" value={fmtUsd(a.bpoValueCents)} />}
                        {a.sourcedFrom && <KV label="From" value={a.sourcedFrom} />}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <NewAcquisitionDialog open={newDialogOpen} onOpenChange={setNewDialogOpen} />
    </PageShell>
  );
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-micro uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="font-mono">{value}</div>
    </div>
  );
}

function NewAcquisitionDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (b: boolean) => void }) {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [payerName, setPayerName] = useState("");
  const [sourcedFrom, setSourcedFrom] = useState("");
  const [propertyLine1, setPropertyLine1] = useState("");
  const [propertyCity, setPropertyCity] = useState("");
  const [propertyState, setPropertyState] = useState("");
  const [proposedFace, setProposedFace] = useState("");
  const [proposedPrice, setProposedPrice] = useState("");

  const reset = () => {
    setPayerName("");
    setSourcedFrom("");
    setPropertyLine1("");
    setPropertyCity("");
    setPropertyState("");
    setProposedFace("");
    setProposedPrice("");
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      const csrfToken = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/)?.[1] || "";
      const res = await fetch("/api/note-acquisitions", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": decodeURIComponent(csrfToken),
        },
        body: JSON.stringify({
          payerName: payerName.trim(),
          sourcedFrom: sourcedFrom.trim() || undefined,
          propertyAddress: (propertyLine1 || propertyCity || propertyState)
            ? {
                line1: propertyLine1.trim() || undefined,
                city: propertyCity.trim() || undefined,
                state: propertyState.trim() || undefined,
              }
            : undefined,
          proposedFaceValueCents: proposedFace
            ? Math.round(parseFloat(proposedFace.replace(/[$,]/g, "")) * 100)
            : undefined,
          proposedAcquisitionPriceCents: proposedPrice
            ? Math.round(parseFloat(proposedPrice.replace(/[$,]/g, "")) * 100)
            : undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Failed" }));
        throw new Error(err.message || "Failed");
      }
      return res.json() as Promise<{ acquisition: Acquisition }>;
    },
    onSuccess: ({ acquisition }) => {
      toast({ title: "Acquisition started", description: `${payerName} added at sourcing.` });
      queryClient.invalidateQueries({ queryKey: ["/api/note-acquisitions"] });
      reset();
      onOpenChange(false);
      navigate(`/notes/pipeline/${acquisition.id}`);
    },
    onError: (err: any) => {
      toast({ title: "Couldn't create", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New acquisition</DialogTitle>
          <DialogDescription>
            Start tracking diligence on a note you might buy. You can fill in BPO,
            interest rate, and other fields later as the deal progresses.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="payer">Borrower / payer name *</Label>
            <Input id="payer" value={payerName} onChange={(e) => setPayerName(e.target.value)} placeholder="Henderson, J." />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sourced">Sourced from</Label>
            <Input id="sourced" value={sourcedFrom} onChange={(e) => setSourcedFrom(e.target.value)} placeholder="Note broker / individual / tape" />
          </div>
          <div className="space-y-1.5" role="group" aria-labelledby="property-address-label">
            <Label id="property-address-label" htmlFor="property-street">Property address</Label>
            <Input id="property-street" aria-label="Street" value={propertyLine1} onChange={(e) => setPropertyLine1(e.target.value)} placeholder="Street" />
            <div className="grid grid-cols-2 gap-2">
              <Input aria-label="City" value={propertyCity} onChange={(e) => setPropertyCity(e.target.value)} placeholder="City" />
              <Input aria-label="State" value={propertyState} onChange={(e) => setPropertyState(e.target.value)} placeholder="State" maxLength={2} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="face">Face value (UPB)</Label>
              <Input id="face" inputMode="decimal" placeholder="0.00" value={proposedFace} onChange={(e) => setProposedFace(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="price">Proposed price</Label>
              <Input id="price" inputMode="decimal" placeholder="0.00" value={proposedPrice} onChange={(e) => setProposedPrice(e.target.value)} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { reset(); onOpenChange(false); }}>{Verbs.CANCEL}</Button>
          <Button onClick={() => createMutation.mutate()} disabled={!payerName.trim() || createMutation.isPending}>
            {createMutation.isPending ? "Creating…" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
