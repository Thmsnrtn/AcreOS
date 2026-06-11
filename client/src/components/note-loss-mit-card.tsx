/**
 * Loss-mit case-file card for the acquired-note detail page.
 *
 * Linnea bonus #7: "When a borrower goes 60+ days late, I have a sequence:
 * outreach call, demand letter, loss-mit options (forbearance, modification,
 * deed-in-lieu, short sale, foreclosure)."
 *
 * Visible always; renders an "Open case" CTA when no case exists, and the
 * full case file when one does.
 */

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Gavel, Plus, ShieldCheck } from "lucide-react";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { formatDate, formatDateTime } from "@/lib/format";

type LossMitStatus =
  | "open"
  | "closed_cured"
  | "closed_modified"
  | "closed_dil"
  | "closed_short_sale"
  | "closed_foreclosed"
  | "closed_charged_off";

type ActionType =
  | "outreach_call"
  | "outreach_email"
  | "outreach_letter"
  | "demand_letter_sent"
  | "scra_checked"
  | "borrower_response_received"
  | "modification_offered"
  | "modification_accepted"
  | "forbearance_started"
  | "short_sale_listed"
  | "dil_offered"
  | "dil_signed"
  | "foreclosure_filed"
  | "bpo_refresh_ordered"
  | "note";

interface LossMitCase {
  id: string;
  noteId: string;
  status: LossMitStatus;
  state: string | null;
  daysPastDueAtOpen: number | null;
  scraCheckedAt: string | null;
  scraActiveDuty: boolean | null;
  openedAt: string;
  closedAt: string | null;
  summary: string | null;
}

interface LossMitAction {
  id: string;
  caseId: string;
  actionType: ActionType;
  performedAt: string;
  notes: string | null;
  performedByUserId: string | null;
  createdAt: string;
}

const ACTION_LABELS: Record<ActionType, string> = {
  outreach_call: "Outreach call",
  outreach_email: "Outreach email",
  outreach_letter: "Outreach letter",
  demand_letter_sent: "Demand letter sent",
  scra_checked: "SCRA check",
  borrower_response_received: "Borrower response",
  modification_offered: "Modification offered",
  modification_accepted: "Modification accepted",
  forbearance_started: "Forbearance started",
  short_sale_listed: "Short sale listed",
  dil_offered: "Deed-in-lieu offered",
  dil_signed: "Deed-in-lieu signed",
  foreclosure_filed: "Foreclosure filed",
  bpo_refresh_ordered: "BPO refresh ordered",
  note: "Note",
};

const STATUS_LABELS: Record<LossMitStatus, string> = {
  open: "Open",
  closed_cured: "Closed — cured",
  closed_modified: "Closed — modified",
  closed_dil: "Closed — deed-in-lieu",
  closed_short_sale: "Closed — short sale",
  closed_foreclosed: "Closed — foreclosed",
  closed_charged_off: "Closed — charged off",
};

export function NoteLossMitCard({ noteId, currentNoteStatus }: { noteId: string; currentNoteStatus: string }) {
  const [openDialog, setOpenDialog] = useState(false);
  const [actionDialogOpen, setActionDialogOpen] = useState(false);

  const caseQuery = useQuery<{ case: LossMitCase | null }>({
    queryKey: ["/api/notes", noteId, "loss-mit-case"],
    queryFn: async () => {
      const res = await fetch(`/api/notes/${noteId}/loss-mit-case`, { credentials: "include" });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      return res.json();
    },
  });

  const c = caseQuery.data?.case ?? null;

  const actionsQuery = useQuery<{ actions: LossMitAction[] }>({
    queryKey: ["/api/loss-mit-cases", c?.id, "actions"],
    queryFn: async () => {
      const res = await fetch(`/api/loss-mit-cases/${c!.id}/actions`, { credentials: "include" });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      return res.json();
    },
    enabled: !!c?.id,
  });

  const actions = actionsQuery.data?.actions ?? [];

  // Soft prompt: if the note status is late/default and there's no open
  // case, surface a stronger CTA. Linnea: 30% of time on the bottom 10%.
  const isDelinquent = currentNoteStatus === "late" || currentNoteStatus === "default";

  return (
    <Card className={`mb-6 ${isDelinquent && !c ? "border-acr-warning/30 bg-acr-warning/5" : ""}`}>
      <div className="p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Gavel className="w-4 h-4 text-primary" aria-hidden="true" />
            <h2 className="text-sm font-semibold">Loss-mit case file</h2>
          </div>
          {!c && (
            <Button size="sm" onClick={() => setOpenDialog(true)} data-testid="open-loss-mit-button">
              <Plus className="w-3.5 h-3.5 mr-1" aria-hidden="true" />
              Open case
            </Button>
          )}
          {c && (
            <Button size="sm" variant="outline" onClick={() => setActionDialogOpen(true)} data-testid="log-action-button">
              <Plus className="w-3.5 h-3.5 mr-1" aria-hidden="true" />
              Log action
            </Button>
          )}
        </div>

        {caseQuery.isLoading ? (
          <Skeleton className="h-12" />
        ) : !c ? (
          isDelinquent ? (
            <p className="text-sm">
              This note is <span className="font-semibold">{currentNoteStatus}</span>. Open a
              loss-mit case to track the workflow — outreach, demand letter, SCRA check,
              modification vs. foreclosure decision.
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              No open case. When a borrower goes 60+ days late, open a loss-mit case to
              capture outreach attempts, demand letters, SCRA checks, and the
              modification-vs-foreclosure decision trail.
            </p>
          )
        ) : (
          <>
            <Separator className="mb-3" />
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4 text-sm">
              <div>
                <div className="text-xs text-muted-foreground">Status</div>
                <div className="font-medium mt-0.5">{STATUS_LABELS[c.status]}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Opened</div>
                <div className="font-medium mt-0.5">{formatDate(c.openedAt)}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">DPD at open</div>
                <div className="font-medium mt-0.5">{c.daysPastDueAtOpen ?? "—"}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">SCRA</div>
                <div className="font-medium mt-0.5 flex items-center gap-1">
                  {c.scraCheckedAt ? (
                    c.scraActiveDuty ? (
                      <span className="text-acr-warning">Active duty — protected</span>
                    ) : (
                      <span className="flex items-center gap-1"><ShieldCheck className="w-3.5 h-3.5 text-acr-pos" aria-hidden="true" /> Cleared</span>
                    )
                  ) : (
                    <span className="text-acr-warning">Required</span>
                  )}
                </div>
              </div>
            </div>

            {c.summary && (
              <p className="text-sm text-muted-foreground mb-4">{c.summary}</p>
            )}

            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold">Action log</span>
              {c.status === "open" && (
                <CloseCaseButton caseId={c.id} noteId={noteId} />
              )}
            </div>
            {actions.length === 0 ? (
              <p className="text-xs text-muted-foreground">No actions logged yet.</p>
            ) : (
              <ul className="space-y-2">
                {actions.map((a) => (
                  <li key={a.id} className="flex items-start gap-3 text-xs">
                    <div className="rounded-full w-2 h-2 bg-primary shrink-0 mt-1.5" />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium">{ACTION_LABELS[a.actionType]}</div>
                      {a.notes && <div className="text-muted-foreground mt-0.5 whitespace-pre-wrap">{a.notes}</div>}
                    </div>
                    <span className="text-muted-foreground whitespace-nowrap">{formatDateTime(a.performedAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      <OpenCaseDialog open={openDialog} onOpenChange={setOpenDialog} noteId={noteId} />
      {c && <LogActionDialog open={actionDialogOpen} onOpenChange={setActionDialogOpen} caseId={c.id} noteId={noteId} />}
    </Card>
  );
}

function OpenCaseDialog({ open, onOpenChange, noteId }: {
  open: boolean;
  onOpenChange: (b: boolean) => void;
  noteId: string;
}) {
  const { toast } = useToast();
  const [state, setState] = useState("");
  const [dpd, setDpd] = useState("");
  const [summary, setSummary] = useState("");

  const submit = useMutation({
    mutationFn: async () => {
      const csrfToken = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/)?.[1] || "";
      const res = await fetch(`/api/notes/${noteId}/loss-mit-case`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": decodeURIComponent(csrfToken),
        },
        body: JSON.stringify({
          state: state.trim() || undefined,
          daysPastDueAtOpen: dpd ? parseInt(dpd, 10) : undefined,
          summary: summary.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Failed" }));
        throw new Error(err.message || "Failed");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Case opened" });
      queryClient.invalidateQueries({ queryKey: ["/api/notes", noteId, "loss-mit-case"] });
      onOpenChange(false);
      setState(""); setDpd(""); setSummary("");
    },
    onError: (err: any) => toast({ title: "Couldn't open", description: err.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Open loss-mit case</DialogTitle>
          <DialogDescription>
            Captures the starting state. Track outreach, demand letters, SCRA, and
            modification/foreclosure decisions in the action log.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="lm-state">State</Label>
              <Input id="lm-state" maxLength={2} value={state} onChange={(e) => setState(e.target.value.toUpperCase())} placeholder="TX" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lm-dpd">Days past due</Label>
              <Input id="lm-dpd" inputMode="numeric" value={dpd} onChange={(e) => setDpd(e.target.value)} placeholder="62" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="lm-summary">Summary</Label>
            <Textarea id="lm-summary" value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="What happened, when did borrower stop paying, any contact context…" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => submit.mutate()} disabled={submit.isPending}>
            {submit.isPending ? "Opening…" : "Open case"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LogActionDialog({ open, onOpenChange, caseId, noteId }: {
  open: boolean;
  onOpenChange: (b: boolean) => void;
  caseId: string;
  noteId: string;
}) {
  const { toast } = useToast();
  const [actionType, setActionType] = useState<ActionType>("outreach_call");
  const [notes, setNotes] = useState("");

  const submit = useMutation({
    mutationFn: async () => {
      const csrfToken = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/)?.[1] || "";
      const res = await fetch(`/api/loss-mit-cases/${caseId}/actions`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": decodeURIComponent(csrfToken),
        },
        body: JSON.stringify({ actionType, notes: notes.trim() || undefined }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Failed" }));
        throw new Error(err.message || "Failed");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Logged" });
      queryClient.invalidateQueries({ queryKey: ["/api/loss-mit-cases", caseId, "actions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notes", noteId, "loss-mit-case"] });
      onOpenChange(false);
      setNotes("");
      setActionType("outreach_call");
    },
    onError: (err: any) => toast({ title: "Couldn't log", description: err.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Log action</DialogTitle>
          <DialogDescription>
            One action per row. SCRA check auto-updates the case-level scraCheckedAt.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="action-type">Action</Label>
            <Select value={actionType} onValueChange={(v) => setActionType(v as ActionType)}>
              <SelectTrigger id="action-type"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.keys(ACTION_LABELS) as ActionType[]).map((t) => (
                  <SelectItem key={t} value={t}>{ACTION_LABELS[t]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="action-notes">Notes</Label>
            <Textarea
              id="action-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={
                actionType === "scra_checked"
                  ? "Include 'active duty' if the borrower is SCRA-protected — auto-updates case."
                  : "What happened, who said what, dates…"
              }
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => submit.mutate()} disabled={submit.isPending}>
            {submit.isPending ? "Logging…" : "Log action"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CloseCaseButton({ caseId, noteId }: { caseId: string; noteId: string }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<LossMitStatus>("closed_cured");

  const submit = useMutation({
    mutationFn: async () => {
      const csrfToken = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/)?.[1] || "";
      const res = await fetch(`/api/loss-mit-cases/${caseId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json", "x-csrf-token": decodeURIComponent(csrfToken) },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error("Close failed");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Case closed" });
      queryClient.invalidateQueries({ queryKey: ["/api/notes", noteId, "loss-mit-case"] });
      setOpen(false);
    },
    onError: (err: any) => toast({ title: "Couldn't close", description: err.message, variant: "destructive" }),
  });

  return (
    <>
      <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setOpen(true)}>
        Close case
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Close case — pick outcome</DialogTitle>
            <DialogDescription>How did this resolve?</DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <Select value={status} onValueChange={(v) => setStatus(v as LossMitStatus)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="closed_cured">Cured — borrower brought current</SelectItem>
                <SelectItem value="closed_modified">Modified — note terms changed</SelectItem>
                <SelectItem value="closed_dil">Deed-in-lieu accepted</SelectItem>
                <SelectItem value="closed_short_sale">Short sale closed</SelectItem>
                <SelectItem value="closed_foreclosed">Foreclosure completed</SelectItem>
                <SelectItem value="closed_charged_off">Charged off</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => submit.mutate()} disabled={submit.isPending}>
              {submit.isPending ? "Closing…" : "Close"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
