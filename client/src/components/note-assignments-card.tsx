/**
 * Assignment paperwork card for the acquired-note detail page.
 *
 * Lists prior assignments and exposes the "Generate assignment" flow
 * for selling the note to another investor. Uses the existing PDF
 * download pattern (base64 → blob).
 *
 * Linnea: "If AcreOS can produce a state-correct Assignment + Allonge
 * with the original note attached and route it to the title company,
 * I'd pay for that alone." This ships the generic-template version;
 * state-specific recordable forms ride a separate workstream.
 */

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { FileSignature, Download, Plus, AlertCircle } from "lucide-react";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
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
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { formatDate } from "@/lib/format";
import { Verbs } from "@/lib/labels";

interface Assignment {
  id: string;
  noteId: string;
  assigneeName: string;
  assigneeAddress: { line1?: string; city?: string; state?: string; zip?: string } | null;
  state: string | null;
  templateVariant: string;
  salePriceCents: number | null;
  saleDate: string;
  status: "generated" | "signed" | "recorded" | "voided";
  signedAt: string | null;
  recordedAt: string | null;
  recordingNumber: string | null;
  notes: string | null;
  createdAt: string;
}

const STATUS_TONE: Record<Assignment["status"], string> = {
  generated: "bg-muted text-muted-foreground",
  signed: "bg-acr-warning/10 text-acr-warning",
  recorded: "bg-acr-pos/10 text-acr-pos",
  voided: "bg-acr-neg/10 text-acr-neg",
};

function fmtUsd(cents: number | null): string {
  if (cents === null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Math.round(cents / 100));
}

function downloadPdf(pdfBase64: string, filename: string) {
  const byteCharacters = atob(pdfBase64);
  const byteNumbers = new Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i++) byteNumbers[i] = byteCharacters.charCodeAt(i);
  const blob = new Blob([new Uint8Array(byteNumbers)], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function NoteAssignmentsCard({ noteId, noteNumber }: { noteId: string; noteNumber: string }) {
  const [open, setOpen] = useState(false);

  const { data, isLoading } = useQuery<{ assignments: Assignment[] }>({
    queryKey: ["/api/notes", noteId, "assignments"],
    queryFn: async () => {
      const res = await fetch(`/api/notes/${noteId}/assignments`, { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to load assignments (${res.status})`);
      return res.json();
    },
  });

  const assignments = data?.assignments ?? [];

  return (
    <Card className="mb-6">
      <div className="p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <FileSignature className="w-4 h-4 text-primary" aria-hidden="true" />
            <h2 className="text-sm font-semibold">Assignment paperwork</h2>
          </div>
          <Button size="sm" onClick={() => setOpen(true)} data-testid="generate-assignment-button">
            <Plus className="w-3.5 h-3.5 mr-1" aria-hidden="true" />
            Generate assignment
          </Button>
        </div>
        <Separator className="mb-3" />

        {isLoading ? (
          <Skeleton className="h-16" />
        ) : assignments.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No assignments issued. When you sell this note, generate the Allonge +
            Assignment of Mortgage here.
          </p>
        ) : (
          <ul className="space-y-2">
            {assignments.map((a) => (
              <li key={a.id} className="flex items-start justify-between gap-3 py-1">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium truncate">{a.assigneeName}</span>
                    <span className={`inline-block rounded-md px-2 py-0.5 text-xs ${STATUS_TONE[a.status]}`}>
                      {a.status}
                    </span>
                    {a.state && <span className="text-xs text-muted-foreground">{a.state}</span>}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    Sold {formatDate(a.saleDate)} for {fmtUsd(a.salePriceCents)}
                    {a.recordingNumber && ` · Recorded ${a.recordingNumber}`}
                  </div>
                </div>
                <span className="text-xs text-muted-foreground whitespace-nowrap pt-0.5">
                  {formatDate(a.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        )}

        <p className="text-xs text-muted-foreground mt-4 flex items-start gap-1.5">
          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />
          <span>
            Generic template. Carries the legally-correct shape (allonge + assignment
            language) but is NOT automatically county-recordable in every state — verify
            local recording requirements before submitting to the title company.
          </span>
        </p>
      </div>

      <GenerateAssignmentDialog
        open={open}
        onOpenChange={setOpen}
        noteId={noteId}
        noteNumber={noteNumber}
      />
    </Card>
  );
}

function GenerateAssignmentDialog({ open, onOpenChange, noteId, noteNumber }: {
  open: boolean;
  onOpenChange: (b: boolean) => void;
  noteId: string;
  noteNumber: string;
}) {
  const { toast } = useToast();
  const [assigneeName, setAssigneeName] = useState("");
  const [assigneeLine1, setAssigneeLine1] = useState("");
  const [assigneeCity, setAssigneeCity] = useState("");
  const [assigneeState, setAssigneeState] = useState("");
  const [assigneeZip, setAssigneeZip] = useState("");
  const [salePrice, setSalePrice] = useState("");
  const [saleDate, setSaleDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [state, setState] = useState("");

  const reset = () => {
    setAssigneeName(""); setAssigneeLine1(""); setAssigneeCity("");
    setAssigneeState(""); setAssigneeZip(""); setSalePrice("");
    setSaleDate(new Date().toISOString().slice(0, 10)); setState("");
  };

  const generateMutation = useMutation({
    mutationFn: async () => {
      const csrfToken = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/)?.[1] || "";
      const res = await fetch(`/api/notes/${noteId}/assignments`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": decodeURIComponent(csrfToken),
        },
        body: JSON.stringify({
          assigneeName: assigneeName.trim(),
          assigneeAddress: (assigneeLine1 || assigneeCity || assigneeState || assigneeZip)
            ? {
                line1: assigneeLine1.trim() || undefined,
                city: assigneeCity.trim() || undefined,
                state: assigneeState.trim() || undefined,
                zip: assigneeZip.trim() || undefined,
              }
            : undefined,
          state: state.trim() || undefined,
          salePriceCents: salePrice ? Math.round(parseFloat(salePrice.replace(/[$,]/g, "")) * 100) : undefined,
          saleDate,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Generate failed" }));
        throw new Error(err.message || "Generate failed");
      }
      return res.json() as Promise<{ assignment: Assignment; pdfBase64: string }>;
    },
    onSuccess: (data) => {
      toast({ title: "Assignment generated", description: "PDF downloaded." });
      const filename = `assignment-${noteNumber}-${data.assignment.assigneeName.replace(/[^A-Za-z0-9]+/g, "-")}.pdf`;
      downloadPdf(data.pdfBase64, filename);
      queryClient.invalidateQueries({ queryKey: ["/api/notes", noteId, "assignments"] });
      reset();
      onOpenChange(false);
    },
    onError: (err: any) => {
      toast({ title: "Couldn't generate", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Generate assignment paperwork</DialogTitle>
          <DialogDescription>
            Allonge to the Note + Assignment of Mortgage / Deed of Trust for note{" "}
            <span className="font-mono text-xs">{noteNumber}</span>. Two-page combined PDF.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="assignee-name">Assignee (buyer) name *</Label>
            <Input id="assignee-name" value={assigneeName} onChange={(e) => setAssigneeName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="assignee-street">Assignee address</Label>
            <Input id="assignee-street" aria-label="Assignee street address" value={assigneeLine1} onChange={(e) => setAssigneeLine1(e.target.value)} placeholder="Street" />
            <div className="grid grid-cols-3 gap-2">
              <Input aria-label="Assignee city" value={assigneeCity} onChange={(e) => setAssigneeCity(e.target.value)} placeholder="City" />
              <Input aria-label="Assignee state" value={assigneeState} onChange={(e) => setAssigneeState(e.target.value)} placeholder="State" maxLength={2} />
              <Input aria-label="Assignee ZIP code" value={assigneeZip} onChange={(e) => setAssigneeZip(e.target.value)} placeholder="ZIP" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="sale-price">Sale price</Label>
              <Input id="sale-price" inputMode="decimal" placeholder="0.00" value={salePrice} onChange={(e) => setSalePrice(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sale-date">Sale date *</Label>
              <Input id="sale-date" type="date" value={saleDate} onChange={(e) => setSaleDate(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="state-jur">Recording state (informational)</Label>
            <Input id="state-jur" maxLength={2} placeholder="TX, FL, etc." value={state} onChange={(e) => setState(e.target.value.toUpperCase())} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { reset(); onOpenChange(false); }}>{Verbs.CANCEL}</Button>
          <Button
            onClick={() => generateMutation.mutate()}
            disabled={!assigneeName || generateMutation.isPending}
            data-testid="confirm-generate-assignment"
          >
            {generateMutation.isPending ? (
              <>Generating…</>
            ) : (
              <><Download className="w-4 h-4 mr-1.5" /> Generate + download</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
