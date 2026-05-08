/**
 * /quiet-title — org-level quiet-title workflow dashboard (TD-6).
 *
 * Lists cases with status, deed-recordation date, and current deadline
 * exposure (days until next pending step is due). Clicking a row opens
 * the case detail with the 10-step checklist.
 *
 * Marcus: "AcreOS could be the first platform to actually run that
 * workflow. […] each with a deadline driven off the deed-recordation
 * date, each with a generated document template, each with an audit
 * trail when a step is completed and by which attorney."
 *
 * This PR ships the workflow scaffolding (case + 10-step checklist
 * with deadline math). State-specific notice TEMPLATES (the actual
 * PDFs) ride a separate workstream — each state needs counsel-reviewed
 * forms.
 */

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute, Link, useLocation } from "wouter";
import {
  ArrowLeft,
  Gavel,
  CheckCircle2,
  Circle,
  ShieldAlert,
  Plus,
  Calendar,
  ExternalLink,
} from "lucide-react";

import { PageShell } from "@/components/page-shell";
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
import { EmptyState } from "@/components/empty-state";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";

type Status =
  | "open"
  | "notice_phase"
  | "publication_phase"
  | "petition_phase"
  | "hearing_pending"
  | "judgment_pending"
  | "completed"
  | "abandoned";

type StepKey =
  | "notice_to_lienholders"
  | "notice_to_heirs"
  | "notice_publication"
  | "statutory_waiting_period"
  | "petition_drafted"
  | "petition_filed"
  | "hearing_scheduled"
  | "hearing_held"
  | "judgment_entered"
  | "judgment_recorded";

interface Case {
  id: string;
  certificateId: string;
  state: string;
  county: string;
  apn: string;
  status: Status;
  deedRecordationDate: string | null;
  attorneyName: string | null;
  attorneyContact: string | null;
  petitionFiledAt: string | null;
  courtCaseNumber: string | null;
  hearingScheduledAt: string | null;
  judgmentEnteredAt: string | null;
  judgmentRecordedAt: string | null;
  summary: string | null;
}

interface Step {
  id: string;
  caseId: string;
  stepKey: StepKey;
  requiredByDate: string | null;
  completedAt: string | null;
  completedByUserId: string | null;
  documentS3Key: string | null;
  notes: string | null;
}

interface DetailResponse {
  case: Case;
  steps: Step[];
  stateRule: {
    citation: string | null;
    attorneyReviewedAt: string | null;
    noticeRequirements: string | null;
    quietTitleProcedure: string | null;
  } | null;
}

const STATUS_LABELS: Record<Status, string> = {
  open: "Open",
  notice_phase: "Notice phase",
  publication_phase: "Publication waiting",
  petition_phase: "Petition phase",
  hearing_pending: "Hearing pending",
  judgment_pending: "Judgment pending",
  completed: "Completed",
  abandoned: "Abandoned",
};

const STEP_LABELS: Record<StepKey, string> = {
  notice_to_lienholders: "Notice to lienholders",
  notice_to_heirs: "Notice to heirs / interested parties",
  notice_publication: "Publication of notice",
  statutory_waiting_period: "Statutory waiting period",
  petition_drafted: "Petition drafted",
  petition_filed: "Petition filed",
  hearing_scheduled: "Hearing scheduled",
  hearing_held: "Hearing held",
  judgment_entered: "Judgment entered",
  judgment_recorded: "Judgment recorded",
};

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function daysFromToday(iso: string | null): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return Math.ceil((d.getTime() - Date.now()) / 86_400_000);
}

export default function QuietTitlePage() {
  const [matchDetail, params] = useRoute<{ id: string }>("/quiet-title/:id");
  if (matchDetail && params?.id) return <QuietTitleDetail caseId={params.id} />;
  return <QuietTitleIndex />;
}

function QuietTitleIndex() {
  useDocumentTitle("Quiet-title cases — AcreOS");
  const [, navigate] = useLocation();
  const [openDialog, setOpenDialog] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const { data, isLoading } = useQuery<{ cases: Case[] }>({
    queryKey: ["/api/quiet-title/cases", statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
      const res = await fetch(`/api/quiet-title/cases?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      return res.json();
    },
  });

  const cases = data?.cases ?? [];

  return (
    <PageShell label="Quiet-title cases">
      <div className="flex items-start justify-between mb-6 gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Gavel className="w-6 h-6 text-primary" aria-hidden="true" />
            Quiet-title cases
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Per-deed legal workflow with 10-step checklist driven off the
            deed-recordation date. Each step has a required-by deadline; mark
            them complete and attach paperwork as you go.
          </p>
        </div>
        <Button onClick={() => setOpenDialog(true)} data-testid="open-case-button">
          <Plus className="w-4 h-4 mr-1.5" aria-hidden="true" />
          Open case
        </Button>
      </div>

      <div className="flex items-center gap-3 mb-4">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {Object.entries(STATUS_LABELS).map(([k, l]) => (
              <SelectItem key={k} value={k}>{l}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <Card><div className="p-5"><Skeleton className="h-32" /></div></Card>
      ) : cases.length === 0 ? (
        <EmptyState
          icon={Gavel}
          title="No quiet-title cases"
          description="When you take a tax deed, open a case here to track the 10-step legal workflow with statutory deadlines."
          actionLabel="Open case"
          actionIcon={Plus}
          onAction={() => setOpenDialog(true)}
        />
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-muted-foreground bg-muted/30">
                  <th className="px-3 py-2.5 text-left font-medium">Parcel</th>
                  <th className="px-3 py-2.5 text-left font-medium">Status</th>
                  <th className="px-3 py-2.5 text-left font-medium">Deed recorded</th>
                  <th className="px-3 py-2.5 text-left font-medium">Attorney</th>
                  <th className="px-3 py-2.5 text-left font-medium">Court case</th>
                </tr>
              </thead>
              <tbody>
                {cases.map((c) => (
                  <tr
                    key={c.id}
                    className="border-t border-border/40 hover:bg-accent/30 cursor-pointer"
                    onClick={() => navigate(`/quiet-title/${c.id}`)}
                  >
                    <td className="px-3 py-2.5">
                      <div className="font-medium">{c.state} · {c.county}</div>
                      <div className="text-xs text-muted-foreground font-mono">{c.apn}</div>
                    </td>
                    <td className="px-3 py-2.5 text-xs">{STATUS_LABELS[c.status]}</td>
                    <td className="px-3 py-2.5 text-xs">{fmtDate(c.deedRecordationDate)}</td>
                    <td className="px-3 py-2.5 text-xs">{c.attorneyName ?? "—"}</td>
                    <td className="px-3 py-2.5 text-xs font-mono">{c.courtCaseNumber ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <OpenCaseDialog open={openDialog} onOpenChange={setOpenDialog} />
    </PageShell>
  );
}

function QuietTitleDetail({ caseId }: { caseId: string }) {
  useDocumentTitle("Quiet-title case — AcreOS");

  const { data, isLoading } = useQuery<DetailResponse>({
    queryKey: ["/api/quiet-title/cases", caseId],
    queryFn: async () => {
      const res = await fetch(`/api/quiet-title/cases/${caseId}`, { credentials: "include" });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      return res.json();
    },
  });

  if (isLoading) {
    return (
      <PageShell>
        <Skeleton className="h-12 w-72 mb-4" />
        <Skeleton className="h-64" />
      </PageShell>
    );
  }
  if (!data) {
    return <PageShell><Card><div className="p-6">Case not found.</div></Card></PageShell>;
  }

  const { case: c, steps, stateRule } = data;

  return (
    <PageShell>
      <Link href="/quiet-title">
        <Button variant="ghost" size="sm" className="mb-3 -ml-2">
          <ArrowLeft className="w-4 h-4 mr-1.5" aria-hidden="true" /> Back
        </Button>
      </Link>

      <div className="flex items-start justify-between mb-6 gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {c.state} · {c.county} <span className="font-mono text-base">{c.apn}</span>
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            Deed recorded {fmtDate(c.deedRecordationDate)} · Status: {STATUS_LABELS[c.status]}
          </p>
        </div>
        {c.courtCaseNumber && (
          <span className="font-mono text-xs px-2 py-1 rounded-md bg-muted">{c.courtCaseNumber}</span>
        )}
      </div>

      {stateRule && !stateRule.attorneyReviewedAt && (
        <Card className="mb-5 border-acr-warning/30 bg-acr-warning/5">
          <div className="p-4 flex items-start gap-3">
            <ShieldAlert className="w-5 h-5 text-acr-warning shrink-0 mt-0.5" aria-hidden="true" />
            <div>
              <p className="text-sm font-semibold">Per-state rule preliminary.</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Step deadlines below are author-researched starting points, not
                attorney-reviewed. Confirm with your {c.state} attorney before
                relying on any specific date.
                {stateRule.citation && <> Cite: <span className="italic">{stateRule.citation}</span>.</>}
              </p>
            </div>
          </div>
        </Card>
      )}

      <Card>
        <div className="p-5">
          <h2 className="text-sm font-semibold mb-3">Workflow checklist</h2>
          <Separator className="mb-3" />
          <ul className="space-y-2">
            {steps.map((s) => (
              <StepRow key={s.id} step={s} />
            ))}
          </ul>
        </div>
      </Card>

      {stateRule?.noticeRequirements && (
        <Card className="mt-5">
          <div className="p-5">
            <h2 className="text-sm font-semibold mb-2">Notice requirements</h2>
            <Separator className="mb-3" />
            <p className="text-sm whitespace-pre-wrap">{stateRule.noticeRequirements}</p>
            <p className="text-xs text-muted-foreground mt-3">
              Per-state notice template PDFs ship in a follow-up — each state
              needs counsel-reviewed forms.
            </p>
          </div>
        </Card>
      )}
    </PageShell>
  );
}

function StepRow({ step }: { step: Step }) {
  const { toast } = useToast();
  const isDone = !!step.completedAt;
  const days = step.requiredByDate ? daysFromToday(step.requiredByDate) : null;

  const toggle = useMutation({
    mutationFn: async () => {
      const csrfToken = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/)?.[1] || "";
      const res = await fetch(`/api/quiet-title/steps/${step.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": decodeURIComponent(csrfToken),
        },
        body: JSON.stringify({ completed: !isDone }),
      });
      if (!res.ok) throw new Error("Save failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/quiet-title/cases", step.caseId] });
    },
    onError: (err: any) => toast({ title: "Couldn't update", description: err.message, variant: "destructive" }),
  });

  return (
    <li className="flex items-start gap-3">
      <button
        onClick={() => toggle.mutate()}
        disabled={toggle.isPending}
        className="shrink-0 mt-0.5"
        aria-label={isDone ? "Mark incomplete" : "Mark complete"}
      >
        {isDone ? (
          <CheckCircle2 className="w-5 h-5 text-acr-pos" aria-hidden="true" />
        ) : (
          <Circle className="w-5 h-5 text-muted-foreground" aria-hidden="true" />
        )}
      </button>
      <div className="flex-1 min-w-0">
        <div className={`text-sm ${isDone ? "text-muted-foreground line-through" : "font-medium"}`}>
          {STEP_LABELS[step.stepKey]}
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
          <span className="flex items-center gap-1">
            <Calendar className="w-3 h-3" aria-hidden="true" />
            Required by {fmtDate(step.requiredByDate)}
          </span>
          {!isDone && days !== null && (
            <span className={days < 0 ? "text-acr-neg font-semibold" : days <= 7 ? "text-acr-warning" : ""}>
              {days < 0 ? `${Math.abs(days)} days overdue` : days <= 90 ? `${days} days left` : ""}
            </span>
          )}
          {isDone && step.completedAt && (
            <span>· Completed {fmtDate(step.completedAt)}</span>
          )}
          {step.documentS3Key && (
            <span className="flex items-center gap-1">
              <ExternalLink className="w-3 h-3" aria-hidden="true" /> Document attached
            </span>
          )}
        </div>
        {step.notes && <p className="text-xs text-muted-foreground italic mt-1">{step.notes}</p>}
      </div>
    </li>
  );
}

function OpenCaseDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (b: boolean) => void }) {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [certificateId, setCertificateId] = useState("");
  const [deedDate, setDeedDate] = useState("");
  const [attorneyName, setAttorneyName] = useState("");
  const [summary, setSummary] = useState("");

  const submit = useMutation({
    mutationFn: async () => {
      const csrfToken = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/)?.[1] || "";
      const res = await fetch("/api/quiet-title/cases", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": decodeURIComponent(csrfToken),
        },
        body: JSON.stringify({
          certificateId,
          deedRecordationDate: deedDate,
          attorneyName: attorneyName.trim() || undefined,
          summary: summary.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || "Failed");
      }
      return res.json() as Promise<{ case: Case }>;
    },
    onSuccess: ({ case: c }) => {
      toast({ title: "Case opened", description: "10-step checklist seeded with deadline math." });
      queryClient.invalidateQueries({ queryKey: ["/api/quiet-title/cases"] });
      onOpenChange(false);
      navigate(`/quiet-title/${c.id}`);
      setCertificateId("");
      setDeedDate("");
      setAttorneyName("");
      setSummary("");
    },
    onError: (err: any) => toast({ title: "Couldn't open", description: err.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Open quiet-title case</DialogTitle>
          <DialogDescription>
            Pick the certificate this case is for. Deadlines for the 10-step
            checklist auto-compute off the deed recordation date.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1">
            <Label htmlFor="qt-cert" className="text-xs">Certificate ID *</Label>
            <Input
              id="qt-cert"
              className="font-mono text-xs"
              placeholder="UUID of the tax certificate"
              value={certificateId}
              onChange={(e) => setCertificateId(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">Find it on /redemption-clock — copy the row's id.</p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="qt-deed" className="text-xs">Deed recordation date *</Label>
            <Input id="qt-deed" type="date" value={deedDate} onChange={(e) => setDeedDate(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="qt-attorney" className="text-xs">Attorney name</Label>
            <Input id="qt-attorney" value={attorneyName} onChange={(e) => setAttorneyName(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="qt-summary" className="text-xs">Summary</Label>
            <Textarea id="qt-summary" value={summary} onChange={(e) => setSummary(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => submit.mutate()} disabled={!certificateId || !deedDate || submit.isPending}>
            {submit.isPending ? "Opening…" : "Open case"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
