/**
 * FounderDecisionsPage — the audit trail of every decision the
 * autonomous executor makes in your absence. Built for Thomas-the-
 * layperson: five buckets, plain-English labels, expandable rows
 * with AI reasoning, one-click reversal for auto-handled items
 * you'd rather not have happened.
 *
 * The single most important page for "can I trust this system to
 * run without me?" — if this page shows a stream of sensible
 * decisions, the autonomy story works. If it shows confusing or
 * scary decisions, the system isn't ready.
 */

import { useMemo, useState } from "react";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertCircle,
  CheckCircle2,
  Shield,
  ShieldAlert,
  Clock,
  User as UserIcon,
  ChevronRight,
  DollarSign,
  AlertTriangle,
  Undo2,
  Send,
  Check,
  X,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { dollars, relative } from "@/lib/format";
import { PrefetchLink } from "@/components/prefetch-link";
import { HelpCircle } from "lucide-react";
import { CopyButton } from "@/components/ui/copy-button";
import { FounderPulseStrip } from "@/components/founder/PulseStrip";

// ───────────── Types ─────────────

interface DecisionRow {
  id: number;
  itemType: string;
  riskLevel: "low" | "medium" | "high" | "critical";
  urgencyScore: number;
  estimatedImpactCents: number | null;
  sophieAnalysis: string;
  sophieConfidenceScore: number | null;
  recommendedAction: string;
  recommendedActionLabel: string;
  status: string;
  resolvedBy: string | null;
  founderOverrideAction: string | null;
  ownerAgentCodename: string | null;
  outcomeScore: number | null;
  actualOutcome: string | null;
  contextBundle: Record<string, unknown> | null;
  createdAt: string;
  resolvedAt: string | null;
}

interface DecisionLogResponse {
  windowDays: number;
  generatedAt: string;
  summary: {
    total: number;
    needsYou: number;
    autoHandled: number;
    guardrailStopped: number;
    youReviewed: number;
    deferred: number;
    autoHandledImpactCents: number;
    avgOutcomeScore: number | null;
  };
  buckets: {
    needsYou: DecisionRow[];
    autoHandled: DecisionRow[];
    guardrailStopped: DecisionRow[];
    youReviewed: DecisionRow[];
    deferred: DecisionRow[];
  };
}

type BucketKey = keyof DecisionLogResponse["buckets"];

// ───────────── Helpers ─────────────

function riskBadgeClass(level: string): string {
  switch (level) {
    case "critical":
      return "bg-acr-neg-soft text-acr-neg dark:bg-acr-neg-soft dark:text-acr-neg";
    case "high":
      return "bg-acr-warn-soft text-acr-warn dark:bg-acr-warn-soft dark:text-acr-warn";
    case "medium":
      return "bg-acr-accent text-acr-accent dark:bg-acr-accent dark:text-acr-accent";
    default:
      return "bg-muted text-muted-foreground";
  }
}

function humanizeItemType(type: string): string {
  return type
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// ───────────── Row component ─────────────

function DecisionRowCard({
  row,
  showReverse,
  onReverse,
  reverseInFlight,
}: {
  row: DecisionRow;
  showReverse: boolean;
  onReverse?: (id: number) => void;
  reverseInFlight: number | null;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div
      className="border rounded-card p-4 hover:bg-muted/30 transition-colors"
      data-testid={`decision-row-${row.id}`}
    >
      {/* flex-wrap: at phone widths the nowrap timestamp column can't fit
          beside the flex-1 title and was clipped by the card edge (mobile
          eyeball pass, 2026-07-08) — wrapping drops it to its own line. */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex-1 text-left"
          aria-expanded={expanded}
        >
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="font-medium text-sm">{humanizeItemType(row.itemType)}</span>
            <Badge className={`text-micro uppercase ${riskBadgeClass(row.riskLevel)}`} variant="outline">
              {row.riskLevel}
            </Badge>
            {row.ownerAgentCodename && (
              <Badge variant="outline" className="text-micro">
                {row.ownerAgentCodename}
              </Badge>
            )}
            {typeof row.outcomeScore === "number" && (
              <Badge
                variant="outline"
                className={`text-micro ${
                  row.outcomeScore >= 1
                    ? "bg-acr-pos-soft text-acr-pos"
                    : row.outcomeScore <= -1
                    ? "bg-acr-neg-soft text-acr-neg"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                outcome {row.outcomeScore > 0 ? `+${row.outcomeScore}` : row.outcomeScore}
              </Badge>
            )}
          </div>
          <p className="text-sm text-foreground mb-1">{row.recommendedActionLabel || row.recommendedAction}</p>
          {/* Preserve newlines from the agent's analysis when expanded — they
              encode structure the agent produced deliberately. Truncate
              without whitespace preservation in the collapsed state. */}
          <p className={expanded ? "text-xs text-muted-foreground whitespace-pre-wrap" : "text-xs text-muted-foreground"}>
            {expanded
              ? row.sophieAnalysis
              : `${row.sophieAnalysis.replace(/\s+/g, " ").slice(0, 180)}${row.sophieAnalysis.length > 180 ? "…" : ""}`}
          </p>
        </button>
        <div className="text-right shrink-0">
          <div className="text-xs font-mono text-muted-foreground whitespace-nowrap flex items-center gap-1 justify-end">
            <Clock className="w-3 h-3" />
            {relative(row.createdAt)}
          </div>
          {row.estimatedImpactCents != null && (
            <div className="text-xs font-mono mt-0.5 flex items-center gap-1 justify-end text-muted-foreground">
              <DollarSign className="w-3 h-3" />
              {dollars(row.estimatedImpactCents)}
            </div>
          )}
          {typeof row.sophieConfidenceScore === "number" && (
            <div className="text-micro text-muted-foreground mt-0.5">
              {row.sophieConfidenceScore}% conf
            </div>
          )}
        </div>
      </div>

      {expanded && (
        <div className="mt-3 pt-3 border-t space-y-2 text-xs">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <span className="text-muted-foreground">Status: </span>
              <span className="font-medium">{row.status}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Resolved by: </span>
              <span className="font-medium">{row.resolvedBy || "—"}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Urgency: </span>
              <span className="font-medium">{row.urgencyScore}/100</span>
            </div>
            <div>
              <span className="text-muted-foreground">Risk: </span>
              <span className="font-medium">{row.riskLevel}</span>
            </div>
          </div>
          {row.founderOverrideAction && (
            <div>
              <span className="text-muted-foreground">You overrode this with: </span>
              <span className="font-medium">{row.founderOverrideAction}</span>
            </div>
          )}
          {row.actualOutcome && (
            <div>
              <span className="text-muted-foreground">Outcome: </span>
              <span>{row.actualOutcome}</span>
            </div>
          )}
          {row.contextBundle && Object.keys(row.contextBundle).length > 0 && (
            <details className="mt-1">
              <summary className="cursor-pointer text-muted-foreground hover:text-foreground flex items-center gap-2">
                Context bundle
                <span onClick={(e) => e.stopPropagation()} className="inline-flex">
                  <CopyButton
                    value={JSON.stringify(row, null, 2)}
                    successMessage="Decision JSON copied"
                    srLabel="Copy decision as JSON"
                    size="sm"
                    className="h-6 w-6"
                  />
                </span>
              </summary>
              <pre className="mt-1 p-2 bg-muted rounded overflow-x-auto text-[10px] leading-relaxed max-h-64">
                {JSON.stringify(row.contextBundle, null, 2)}
              </pre>
            </details>
          )}
          {showReverse && onReverse && row.status !== "rejected" && (
            <div className="flex justify-end pt-1">
              <Button
                size="sm"
                variant="outline"
                className="text-destructive border-destructive/30 hover:bg-destructive/10"
                disabled={reverseInFlight === row.id}
                onClick={() => onReverse(row.id)}
                data-testid={`button-reverse-${row.id}`}
              >
                <Undo2 className="w-3 h-3 mr-1" />
                {reverseInFlight === row.id ? "Recording…" : "I don't like this — don't do it again"}
              </Button>
            </div>
          )}
        </div>
      )}
      {!expanded && (
        <div className="flex justify-end mt-1">
          <span className="text-micro text-muted-foreground inline-flex items-center gap-0.5">
            <ChevronRight className="w-3 h-3" /> Click to expand
          </span>
        </div>
      )}
    </div>
  );
}

// ───────────── Witnessed-send queue (the execution seam) ─────────────
//
// The autopilot drafts customer-facing / money / broadcast actions but NEVER
// sends them — every such hand is frozen into autopilot_pending_actions and
// executes ONLY on a founder tap here (witnessed-send). This is the load-
// bearing trust surface: without it, drafted sends are stranded forever. The
// backend (routes-autopilot.ts) already exposes list/approve/reject; this is
// the missing UI.

interface PendingAction {
  id: number;
  handName: string;
  domain: string | null;
  summary: string | null;
  args: Record<string, unknown>;
  createdAt: string;
  expiresAt: string | null;
}

/** Pull the human-readable body out of a frozen hand's args so the founder
 * reads EXACTLY what will send before approving. Falls back to a JSON view. */
function renderArgs(args: Record<string, unknown>): { fields: { label: string; value: string }[] } {
  const out: { label: string; value: string }[] = [];
  const push = (label: string, v: unknown) => {
    if (v == null || v === "") return;
    out.push({ label, value: typeof v === "string" ? v : JSON.stringify(v) });
  };
  push("To", args.to ?? (typeof args.lead_id === "number" ? `lead #${args.lead_id}` : undefined));
  push("Subject", args.subject);
  // The actual message body, under whichever key the hand uses.
  push("Body", args.html ?? args.message ?? args.body ?? args.text);
  push("Amount", typeof args.amount_cents === "number" ? `$${(args.amount_cents / 100).toFixed(2)}` : undefined);
  push("Charge", args.charge_id);
  push("Action", args.action);
  push("Platform", args.platform);
  // Any remaining keys, so nothing is hidden from the founder.
  const shown = new Set(["to", "lead_id", "subject", "html", "message", "body", "text", "amount_cents", "charge_id", "action", "platform"]);
  for (const [k, v] of Object.entries(args)) {
    if (!shown.has(k)) push(k, v);
  }
  return { fields: out };
}

function PendingActionCard({
  action,
  onApprove,
  onReject,
  inFlight,
}: {
  action: PendingAction;
  onApprove: (id: number) => void;
  onReject: (id: number) => void;
  inFlight: number | null;
}) {
  const { fields } = renderArgs(action.args ?? {});
  const busy = inFlight === action.id;
  return (
    <div className="border rounded-card p-4 bg-card" data-testid={`pending-action-${action.id}`}>
      <div className="flex items-start justify-between gap-3 mb-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className="text-micro uppercase">
            {action.handName.replace(/_/g, " ")}
          </Badge>
          {action.domain && (
            <Badge variant="outline" className="text-micro">
              {action.domain}
            </Badge>
          )}
        </div>
        <div className="text-xs font-mono text-muted-foreground whitespace-nowrap flex items-center gap-1">
          <Clock className="w-3 h-3" />
          {relative(action.createdAt)}
        </div>
      </div>
      {action.summary && <p className="text-sm font-medium mb-2">{action.summary}</p>}
      <div className="space-y-1.5 mb-3">
        {fields.map((f) => (
          <div key={f.label} className="text-xs">
            <span className="text-muted-foreground">{f.label}: </span>
            <span className="whitespace-pre-wrap break-words">{f.value}</span>
          </div>
        ))}
      </div>
      <div className="flex justify-end gap-2">
        <Button
          size="sm"
          variant="outline"
          className="text-destructive border-destructive/30 hover:bg-destructive/10"
          disabled={busy}
          onClick={() => onReject(action.id)}
          aria-label={`Reject ${action.handName}`}
          data-testid={`button-reject-${action.id}`}
        >
          <X className="w-3.5 h-3.5 mr-1" />
          Reject
        </Button>
        <Button
          size="sm"
          disabled={busy}
          onClick={() => onApprove(action.id)}
          aria-label={`Approve and send ${action.handName}`}
          data-testid={`button-approve-${action.id}`}
        >
          <Check className="w-3.5 h-3.5 mr-1" />
          {busy ? "Sending…" : "Approve & send"}
        </Button>
      </div>
    </div>
  );
}

function WitnessedSendQueue() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [inFlight, setInFlight] = useState<number | null>(null);

  const { data, isLoading } = useQuery<{ actions: PendingAction[] }>({
    queryKey: ["/api/founder/autopilot/pending-actions"],
    queryFn: async () => {
      const res = await fetch("/api/founder/autopilot/pending-actions", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load pending actions");
      return res.json();
    },
    refetchInterval: 30_000,
  });

  const decide = useMutation({
    mutationFn: async ({ id, decision }: { id: number; decision: "approve" | "reject" }) => {
      setInFlight(id);
      return apiRequest("POST", `/api/founder/autopilot/pending-actions/${id}/${decision}`, {});
    },
    onSuccess: (_res, vars) => {
      toast({
        title: vars.decision === "approve" ? "Approved & sent" : "Rejected",
        description:
          vars.decision === "approve"
            ? "The autopilot executed this on your witnessed tap."
            : "The autopilot won't send this.",
      });
      qc.invalidateQueries({ queryKey: ["/api/founder/autopilot/pending-actions"] });
    },
    onError: (err: Error) => {
      toast({ title: "Couldn't complete", description: err.message, variant: "destructive" });
    },
    onSettled: () => setInFlight(null),
  });

  const actions = data?.actions ?? [];

  // When empty + loaded, render nothing (keep the page focused on the audit
  // trail). The queue only appears when the autopilot is waiting on the founder.
  if (!isLoading && actions.length === 0) return null;

  return (
    <Card className="border-acr-warn/40">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Send className="w-4 h-4 text-acr-warn" />
          Waiting on you to send ({actions.length})
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          The autopilot drafted these but won't send anything until you approve. Read each one — Approve
          fires the real send; Reject discards it.
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        {isLoading ? (
          Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-28" />)
        ) : (
          actions.map((a) => (
            <PendingActionCard
              key={a.id}
              action={a}
              onApprove={(id) => decide.mutate({ id, decision: "approve" })}
              onReject={(id) => decide.mutate({ id, decision: "reject" })}
              inFlight={inFlight}
            />
          ))
        )}
      </CardContent>
    </Card>
  );
}

// ───────────── Class-C defect ledger (Jarvis 2.3) ─────────────
//
// Suppressed inbox rows (status=suppressed) are Class-C arrivals: something
// escalated that policy says should have been handled silently. The arbiter
// keeps each row verbatim; this section is the ledger that makes the defect
// signal visible without ever surfacing the rows as pending work.

interface DefectItem {
  id: number;
  itemType: string;
  sophieAnalysis: string;
  createdAt: string;
}

interface DefectsResponse {
  items: DefectItem[];
  byType: Record<string, number>;
  total: number;
  windowDays: number;
}

/**
 * Open questions from the agents (asks). The door's doctrine (founder-doors.ts)
 * names asks as part of Decisions — "the witnessed-send queue, asks, appeals,
 * recourse" — but asks previously lived ONLY on the /founder/asks deep page,
 * so a founder checking this door could miss a blocked agent waiting on an
 * answer. Mirrors WitnessedSendQueue: renders only when something is waiting.
 * Answering stays on the asks surface (the answer form is format-dependent).
 */
function OpenAsksSection() {
  const { data } = useQuery<{
    asks: Array<{ id: number; questionSummary: string; askingAgentRole: string; urgency: "urgent" | "normal" | "low"; askedAt: string }>;
    count: number;
  }>({
    queryKey: ["/api/founder/asks?status=open&limit=10"],
    staleTime: 30_000,
  });
  if (!data || data.count === 0) return null;
  return (
    <Card className="border-l-4 border-l-primary" data-testid="decisions-open-asks">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <HelpCircle className="w-4 h-4 text-primary" aria-hidden="true" />
          Questions waiting on you ({data.count})
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {data.asks.slice(0, 5).map((ask) => (
          <div
            key={ask.id}
            className="flex items-center justify-between gap-3 rounded-md border border-border/60 bg-muted/30 px-3 py-2"
            data-testid={`decisions-open-ask-${ask.id}`}
          >
            <div className="min-w-0">
              <p className="text-sm text-foreground truncate">{ask.questionSummary}</p>
              <p className="text-xs text-muted-foreground">
                {ask.askingAgentRole} · {relative(ask.askedAt)}
                {ask.urgency === "urgent" ? " · urgent" : ""}
              </p>
            </div>
            <Button asChild size="sm" variant={ask.urgency === "urgent" ? "default" : "outline"} className="shrink-0">
              <PrefetchLink href={`/founder/asks?id=${ask.id}`} aria-label={`Answer: ${ask.questionSummary}`}>
                Answer
              </PrefetchLink>
            </Button>
          </div>
        ))}
        {data.count > 5 && (
          <PrefetchLink
            href="/founder/asks"
            className="block text-xs text-primary hover:underline"
            data-testid="decisions-open-asks-all"
          >
            All {data.count} open questions →
          </PrefetchLink>
        )}
      </CardContent>
    </Card>
  );
}

function ClassCDefectsSection() {
  const [open, setOpen] = useState(false);
  const { data, isLoading } = useQuery<DefectsResponse>({
    queryKey: ["/api/founder/intelligence/decisions-inbox/defects"],
    queryFn: async () => {
      const res = await fetch("/api/founder/intelligence/decisions-inbox/defects", {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to load Class-C defects");
      return res.json();
    },
  });

  const items = data?.items ?? [];
  const byType = data?.byType ?? {};

  return (
    <Card>
      <CardHeader>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center justify-between w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
          aria-label="Toggle Class-C defects list"
          aria-expanded={open}
          data-testid="class-c-defects-toggle"
        >
          <CardTitle className="text-base flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-muted-foreground" />
            Class-C defects
            <Badge variant="outline" className="text-xs tabular-nums">
              {data?.total ?? 0}
            </Badge>
          </CardTitle>
          <ChevronRight
            className={`w-4 h-4 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`}
            aria-hidden="true"
          />
        </button>
        <p className="text-xs text-muted-foreground">
          A Class-C arrival is a defect signal — something escalated that policy says should have
          been handled silently.
        </p>
      </CardHeader>
      {open && (
        <CardContent className="space-y-2">
          {isLoading ? (
            Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16" />)
          ) : items.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              No Class-C arrivals — the machine is answering its own questions.
            </p>
          ) : (
            <>
              <div className="flex items-center gap-2 flex-wrap">
                {Object.entries(byType).map(([type, count]) => (
                  <Badge key={type} variant="outline" className="text-micro">
                    {humanizeItemType(type)} · {count}
                  </Badge>
                ))}
              </div>
              {items.map((item) => (
                <div key={item.id} className="border rounded-card p-4 hover:bg-muted/30 transition-colors">
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="font-medium text-sm">{humanizeItemType(item.itemType)}</span>
                        <Badge variant="outline" className="text-micro uppercase">
                          suppressed
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {`${item.sophieAnalysis.replace(/\s+/g, " ").slice(0, 180)}${item.sophieAnalysis.length > 180 ? "…" : ""}`}
                      </p>
                    </div>
                    <div className="text-xs font-mono text-muted-foreground whitespace-nowrap flex items-center gap-1 shrink-0">
                      <Clock className="w-3 h-3" />
                      {relative(item.createdAt)}
                    </div>
                  </div>
                </div>
              ))}
            </>
          )}
        </CardContent>
      )}
    </Card>
  );
}

// ───────────── Page ─────────────

const BUCKET_META: Record<
  BucketKey,
  { label: string; icon: React.ComponentType<{ className?: string }>; tone: string; emptyText: string }
> = {
  needsYou: {
    label: "Needs you",
    icon: AlertCircle,
    tone: "text-acr-warn",
    emptyText: "Nothing's waiting on you. The system handled everything.",
  },
  autoHandled: {
    label: "Auto-handled",
    icon: CheckCircle2,
    tone: "text-acr-pos",
    emptyText: "The system hasn't auto-handled anything in this window.",
  },
  guardrailStopped: {
    label: "Guardrail stopped",
    icon: ShieldAlert,
    tone: "text-acr-neg",
    emptyText: "No hard-guardrail rejections — that's a good thing.",
  },
  youReviewed: {
    label: "You reviewed",
    icon: UserIcon,
    tone: "text-acr-accent",
    emptyText: "You haven't manually reviewed any decisions in this window.",
  },
  deferred: {
    label: "Deferred",
    icon: Clock,
    tone: "text-muted-foreground",
    emptyText: "Nothing snoozed for later.",
  },
};

const BUCKET_ORDER: BucketKey[] = [
  "needsYou",
  "autoHandled",
  "guardrailStopped",
  "youReviewed",
  "deferred",
];

export default function FounderDecisionsPage() {
  useDocumentTitle("Founder decisions");
  const [windowDays, setWindowDays] = useState<number>(30);
  const [activeBucket, setActiveBucket] = useState<BucketKey>("needsYou");
  const [reverseInFlight, setReverseInFlight] = useState<number | null>(null);
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data, isLoading } = useQuery<DecisionLogResponse>({
    queryKey: ["/api/founder/intelligence/decision-log", windowDays],
    queryFn: async () => {
      const res = await fetch(`/api/founder/intelligence/decision-log?days=${windowDays}&limit=300`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to load decision log");
      return res.json();
    },
  });

  const reverseMut = useMutation({
    mutationFn: async (id: number) => {
      setReverseInFlight(id);
      await apiRequest("POST", `/api/founder/intelligence/decision-log/${id}/reverse`, {
        reason: "Founder clicked 'I don't like this — don't do it again' on the decisions page",
      });
    },
    onSuccess: () => {
      toast({
        title: "Recorded",
        description:
          "The system noted you'd rather it didn't do this. It'll adjust its approach next time.",
      });
      qc.invalidateQueries({ queryKey: ["/api/founder/intelligence/decision-log"] });
    },
    onError: (err: Error) => {
      toast({
        title: "Couldn't record reversal",
        description: `${err.message} — try again in a moment.`,
        variant: "destructive",
      });
    },
    onSettled: () => setReverseInFlight(null),
  });

  const activeRows = useMemo(() => {
    if (!data) return [];
    return data.buckets[activeBucket] ?? [];
  }, [data, activeBucket]);

  return (
    <PageShell label="Autonomous decisions">
      {/* F1 — ambient liveness on every door (experience-legibility.md) */}
      <div className="mb-4"><FounderPulseStrip /></div>
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Shield className="w-6 h-6 text-primary" />
            Autonomous decisions
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Every decision the system made in your absence, bucketed so you can see what needed
            you, what got handled cleanly, and what a safety rule stopped from happening.
          </p>
        </div>
        <select
          value={windowDays}
          onChange={(e) => setWindowDays(parseInt(e.target.value, 10))}
          className="h-9 px-3 rounded-md border bg-background text-sm"
          data-testid="select-window"
        >
          <option value={7}>Last 7 days</option>
          <option value={14}>Last 14 days</option>
          <option value={30}>Last 30 days</option>
          <option value={60}>Last 60 days</option>
          <option value={90}>Last 90 days</option>
        </select>
      </div>

      {/* Witnessed-send queue — the autopilot's drafted actions awaiting your
          tap. Renders only when something is waiting; it's the load-bearing
          execution seam, so it sits above the audit trail. */}
      <WitnessedSendQueue />

      {/* Open agent questions — same renders-only-when-waiting contract. */}
      <OpenAsksSection />

      {/* Summary strip */}
      {isLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      ) : data ? (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {BUCKET_ORDER.map((key) => {
            const meta = BUCKET_META[key];
            const count = data.summary[key] ?? 0;
            const Icon = meta.icon;
            return (
              <button
                key={key}
                onClick={() => setActiveBucket(key)}
                className={`text-left rounded-card border p-3 transition-all ${
                  activeBucket === key
                    ? "ring-2 ring-primary shadow-sm bg-card"
                    : "hover:border-primary/40 bg-card"
                }`}
                data-testid={`bucket-tab-${key}`}
              >
                <div className={`flex items-center gap-1.5 text-xs ${meta.tone}`}>
                  <Icon className="w-3.5 h-3.5" />
                  <span className="font-medium">{meta.label}</span>
                </div>
                <div className="text-2xl font-bold mt-1">{count}</div>
              </button>
            );
          })}
        </div>
      ) : null}

      {/* Spend exposure + outcome health */}
      {data && (
        <Card>
          <CardContent className="p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-3 text-sm">
            <div className="flex items-center gap-2 text-muted-foreground">
              <DollarSign className="w-4 h-4" />
              <span>
                Auto-handled dollar exposure:{" "}
                <span className="font-semibold text-foreground">
                  {dollars(data.summary.autoHandledImpactCents)}
                </span>
              </span>
            </div>
            <div className="flex items-center gap-2 text-muted-foreground">
              <AlertTriangle className="w-4 h-4" />
              <span>
                Average outcome score (of those graded):{" "}
                <span className="font-semibold text-foreground">
                  {data.summary.avgOutcomeScore != null
                    ? data.summary.avgOutcomeScore.toFixed(1)
                    : "not yet graded"}
                </span>
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Active bucket list */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            {(() => {
              const meta = BUCKET_META[activeBucket];
              const Icon = meta.icon;
              return (
                <>
                  <Icon className={`w-4 h-4 ${meta.tone}`} />
                  {meta.label} ({activeRows.length})
                </>
              );
            })()}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {isLoading ? (
            Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)
          ) : activeRows.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              {BUCKET_META[activeBucket].emptyText}
            </p>
          ) : (
            activeRows.map((row) => (
              <DecisionRowCard
                key={row.id}
                row={row}
                showReverse={activeBucket === "autoHandled"}
                onReverse={(id) => reverseMut.mutate(id)}
                reverseInFlight={reverseInFlight}
              />
            ))
          )}
        </CardContent>
      </Card>

      {/* Class-C defect ledger — collapsed by default beneath the buckets */}
      <ClassCDefectsSection />

      {/* Doctrine completeness (founder-doors.ts): appeals + recourse belong
          to this door too. Quiet footer links — rare paths, not daily ones. */}
      <p className="text-xs text-muted-foreground" data-testid="decisions-door-footer">
        Also part of this door:{" "}
        <PrefetchLink href="/founder/appeals" className="text-primary hover:underline">Appeals</PrefetchLink>
        {" · "}
        <PrefetchLink href="/founder/recourse" className="text-primary hover:underline">Recourse</PrefetchLink>
      </p>
    </div>
    </PageShell>
  );
}
