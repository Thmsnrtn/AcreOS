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

import { useEffect, useMemo, useState } from "react";
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
import {
  AGENT_FRIENDLY_NAMES,
  AGENT_ROLES,
  naturalConfidence,
  naturalRisk,
  naturalUrgency,
} from "@/lib/trust-language";
import { dollars, relative } from "@/lib/format";
import { PrefetchLink } from "@/components/prefetch-link";
import { HelpCircle } from "lucide-react";
import { CopyButton } from "@/components/ui/copy-button";
import { FounderPulseStrip } from "@/components/founder/PulseStrip";
// The "If you do nothing" contract — one verified-true sentence per decision
// class (shared/decisions/doNothing.ts, same module the server exports via
// decisionsInbox.ts, so the rendered sentence can never drift from the code's
// actual do-nothing behavior). Founder-trust audit 2026-07-28: every
// needs-you card must say what ignoring it costs — no ambient guilt.
import { doNothingContract } from "@shared/decisions/doNothing";
// The founder's one required door must be able to RESOLVE what it lists. These
// two dialogs lost their only mount when the standalone /founder/asks page was
// deleted, and nothing has mounted them since — see OpenAsksSection below.
import { AnswerAskDialog } from "@/components/founder/asks/answer-ask-dialog";
import { SupersedeAskDialog } from "@/components/founder/asks/supersede-ask-dialog";
import type { FounderAsk } from "@/components/founder/asks/ask-shared";

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
      return "bg-acr-neg-soft text-acr-neg-soft-ink dark:bg-acr-neg-soft dark:text-acr-neg-soft-ink";
    case "high":
      return "bg-acr-warn-soft text-acr-warn-soft-ink dark:bg-acr-warn-soft dark:text-acr-warn-soft-ink";
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

/** Friendly agent label — never the raw codename token. Prefers the short
 * role ("Customer Success"), falls back to the long friendly name, and as a
 * last resort strips underscores + title-cases so "sophie_csm" can never
 * leak onto the trust surface. */
function agentDisplayLabel(codename: string): string {
  return (
    AGENT_ROLES[codename] ??
    AGENT_FRIENDLY_NAMES[codename] ??
    codename
      .split("_")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ")
  );
}

/** Plain words for autonomy level tokens — same vocabulary as LEVEL_LABEL on
 * the Controls page (autopilot-control.tsx), so the promotion story reads
 * identically on both doors. */
const LEVEL_WORDS: Record<string, string> = {
  observe: "Watching only",
  draft: "Drafts — you approve",
  execute_gated: "Acts — safety-checked",
  autonomous_gated: "Independent — safety-checked",
};

function levelWords(level: string | undefined): string {
  if (!level) return "its current level";
  return LEVEL_WORDS[level] ?? level.replace(/_/g, " ");
}

// Jarvis 2.3 — phone-answerable card options live in contextBundle.options.
// Same shape SwipeDecisionCard reads; implemented inline here because this
// page is the mounted surface (the swipe card is not).
interface DecisionCardOption {
  key: string;
  label: string;
}

function readOptions(bundle: Record<string, unknown> | null): DecisionCardOption[] {
  const raw = (bundle as { options?: unknown } | null)?.options;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (o: unknown): o is DecisionCardOption =>
      !!o && typeof (o as DecisionCardOption).key === "string" && typeof (o as DecisionCardOption).label === "string",
  );
}

interface ShadowPromotionEvidence {
  domain?: string;
  fromLevel?: string;
  toLevel?: string;
  agreement?: { matched?: number; total?: number; pendingPairs?: number };
}

function readShadowPromotion(bundle: Record<string, unknown> | null): ShadowPromotionEvidence | null {
  const sp = (bundle as { shadowPromotion?: unknown } | null)?.shadowPromotion;
  if (!sp || typeof sp !== "object") return null;
  return sp as ShadowPromotionEvidence;
}

// ───────────── Row component ─────────────

function DecisionRowCard({
  row,
  showReverse,
  onReverse,
  reverseInFlight,
  answerable = false,
  onAnswer,
  answerInFlight = null,
  highlighted = false,
}: {
  row: DecisionRow;
  showReverse: boolean;
  onReverse?: (id: number) => void;
  reverseInFlight: number | null;
  /** Needs-you bucket: render the card's option buttons inline so the row
   * is actually answerable (the swipe surface is unmounted dead code). */
  answerable?: boolean;
  onAnswer?: (id: number, optionKey: string) => void;
  answerInFlight?: number | null;
  highlighted?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  // Two-tap arming for the promotion grant button — first tap arms, second
  // tap confirms. Widening the machine's authority must never be a mis-tap.
  const [armedOption, setArmedOption] = useState<string | null>(null);
  const options = answerable ? readOptions(row.contextBundle) : [];
  const shadowPromotion = readShadowPromotion(row.contextBundle);
  const isPromotionCard = row.itemType === "shadow_promotion_request";
  const answering = answerInFlight === row.id;

  const optionLabel = (opt: DecisionCardOption): string => {
    if (isPromotionCard && opt.key === "grant" && shadowPromotion) {
      const domain = shadowPromotion.domain
        ? shadowPromotion.domain.charAt(0).toUpperCase() + shadowPromotion.domain.slice(1)
        : "This domain";
      return `Grant — ${domain} moves from ${levelWords(shadowPromotion.fromLevel)} to ${levelWords(shadowPromotion.toLevel)}`;
    }
    return opt.label;
  };

  const handleOptionTap = (opt: DecisionCardOption) => {
    if (!onAnswer) return;
    // Grant on a promotion card requires a second confirming tap; every
    // other option (hold / deny / check-in answers) stays one-tap.
    if (isPromotionCard && opt.key === "grant" && armedOption !== opt.key) {
      setArmedOption(opt.key);
      return;
    }
    setArmedOption(null);
    onAnswer(row.id, opt.key);
  };

  return (
    <div
      className={`border rounded-card p-4 hover:bg-muted/30 transition-colors ${
        highlighted ? "ring-2 ring-primary" : ""
      }`}
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
            {/* Severity wording is plain but never softened — "Urgent" keeps
                the red styling keyed on the raw risk level. */}
            <Badge className={`text-micro uppercase ${riskBadgeClass(row.riskLevel)}`} variant="outline">
              {naturalRisk(row.riskLevel)}
            </Badge>
            {row.ownerAgentCodename && (
              <Badge variant="outline" className="text-micro">
                {agentDisplayLabel(row.ownerAgentCodename)}
              </Badge>
            )}
            {typeof row.outcomeScore === "number" && (
              <Badge
                variant="outline"
                className={`text-micro ${
                  row.outcomeScore >= 1
                    ? "bg-acr-pos-soft text-acr-pos-soft-ink"
                    : row.outcomeScore <= -1
                    ? "bg-acr-neg-soft text-acr-neg-soft-ink"
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
              {naturalConfidence(row.sophieConfidenceScore)}
            </div>
          )}
        </div>
      </div>

      {/* Needs-you rows carry answerable options (contextBundle.options) —
          render them inline, phone-sized, one tap each. Every tap posts the
          EXPLICIT chosen option key; nothing relies on a server default. */}
      {answerable && onAnswer && options.length > 0 && (
        <div className="flex flex-col gap-2 mt-3" data-testid={`decision-options-${row.id}`}>
          {options.map((opt) => {
            const armed = armedOption === opt.key;
            return (
              <Button
                key={opt.key}
                type="button"
                variant={opt.key === "grant" || opt.key === "approve_recommended" ? "default" : "outline"}
                className="w-full min-h-11 justify-center whitespace-normal"
                disabled={answering}
                aria-busy={answering}
                onClick={() => handleOptionTap(opt)}
                data-testid={`decision-option-${row.id}-${opt.key}`}
              >
                {answering
                  ? "Recording…"
                  : armed
                  ? "Tap again to confirm"
                  : optionLabel(opt)}
              </Button>
            );
          })}
          {armedOption !== null && (
            <p className="text-micro text-muted-foreground text-center">
              This widens the system's authority — tap the button again to confirm, or tap another option to cancel.
            </p>
          )}
        </div>
      )}

      {/* The do-nothing contract — only on needs-you cards (the bucket that
          generates ambient guilt). Muted, one sentence, verified-true: what
          actually happens if the founder never answers this card. */}
      {answerable && (
        <p
          className="text-micro text-muted-foreground mt-3"
          data-testid={`decision-do-nothing-${row.id}`}
        >
          {doNothingContract(row.itemType)}
        </p>
      )}

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
              <span className="font-medium">{naturalUrgency(row.urgencyScore)}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Risk: </span>
              <span className="font-medium">{naturalRisk(row.riskLevel)}</span>
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
                Technical details
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
              {shadowPromotion && (
                <p
                  className="mt-1 text-xs text-foreground"
                  data-testid={`promotion-plain-summary-${row.id}`}
                >
                  It's asking to go from {levelWords(shadowPromotion.fromLevel)} to{" "}
                  {levelWords(shadowPromotion.toLevel)}.
                  {typeof shadowPromotion.agreement?.total === "number" && (
                    <>
                      {" "}On the {shadowPromotion.agreement.total} decisions where you could compare,
                      you agreed {shadowPromotion.agreement.matched ?? 0} times
                      {(shadowPromotion.agreement.pendingPairs ?? 0) > 0
                        ? `; ${shadowPromotion.agreement.pendingPairs} are still unresolved`
                        : ""}
                      .
                    </>
                  )}
                </p>
              )}
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
      {/* Verified truth (pendingHands.ts): unanswered drafts never send and
          expire after 24h — say so on every frozen card. */}
      <p
        className="text-micro text-muted-foreground mt-2"
        data-testid={`pending-action-do-nothing-${action.id}`}
      >
        {doNothingContract("witnessed_send")}
      </p>
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
 * recourse". Mirrors WitnessedSendQueue: renders only when something is waiting.
 *
 * THE ASK LANE, WHICH COULD NOT ANSWER AN ASK.
 *
 * The master directive names Decisions as "the only routine place the founder is
 * required to interact". This section listed the questions agents were waiting
 * on and offered no way to answer one. Four things were wrong at once:
 *
 *  1. `AnswerAskDialog` and `SupersedeAskDialog` had ZERO importers. They lost
 *     their only mount when the standalone /founder/asks page was deleted for
 *     duplicating this door, and nothing picked them up. The only surviving
 *     reference was a prose record in route-redirects.ts DESCRIBING the
 *     orphaning — which is also why a careless grep reports them as imported.
 *  2. The per-row "Answer" button linked to `/founder/asks?id=N`, and App.tsx
 *     redirects `/founder/asks` back to `/founder/decisions`. The founder is
 *     already here; the button navigated to the page it was on.
 *  3. `?id=` carried an ASK id (home.tsx sends `brief.decision.askId`) into a
 *     handler that matches DECISION-LOG ids. Two tables' primary keys, one
 *     query param, so the Letter's headline CTA highlighted the wrong row or
 *     none at all.
 *  4. The backend was live the whole time — POST /api/founder/asks/:id/answer
 *     and /supersede both exist. Only the UI was missing.
 *
 * Asks now open in a dialog here, and carry their own `?ask=` param so an ask id
 * can never be read as a decision-log id again.
 */
function OpenAsksSection() {
  const { data } = useQuery<{
    asks: Array<{ id: number; questionSummary: string; askingAgentRole: string; urgency: "urgent" | "normal" | "low"; askedAt: string }>;
    count: number;
  }>({
    queryKey: ["/api/founder/asks?status=open&limit=10"],
    staleTime: 30_000,
  });

  const queryClient = useQueryClient();

  // The list carries a summary; the dialogs need the whole ask (body, options,
  // answer format), so the full record is fetched when one is opened. `?ask=`
  // is read once, on mount — a deep link from the Letter lands with the row
  // already open.
  const [openAskId, setOpenAskId] = useState<number | null>(() => {
    const raw = new URLSearchParams(window.location.search).get("ask");
    const n = raw ? parseInt(raw, 10) : NaN;
    return Number.isFinite(n) && n > 0 ? n : null;
  });
  const [superseding, setSuperseding] = useState(false);
  const { data: askDetail, isError: askFailed } = useQuery<{ ask: FounderAsk }>({
    queryKey: [`/api/founder/asks/${openAskId}`],
    enabled: openAskId != null,
  });
  const openAsk = askDetail?.ask ?? null;
  // Both dialogs render null until the full ask arrives, so between the click
  // and the response the button would otherwise do nothing visible — the exact
  // dead-press this section was rebuilt to remove.
  const pendingAskId = openAskId != null && !openAsk && !askFailed ? openAskId : null;

  const closeAsk = () => {
    setOpenAskId(null);
    setSuperseding(false);
    // Drop ?ask= so the dismissed dialog cannot reopen on a re-mount or a
    // shared/bookmarked URL that outlives the question.
    const url = new URL(window.location.href);
    if (url.searchParams.has("ask")) {
      url.searchParams.delete("ask");
      window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    }
  };
  const afterSubmit = () => {
    closeAsk();
    void queryClient.invalidateQueries({
      queryKey: ["/api/founder/asks?status=open&limit=10"],
    });
  };

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
            <div className="flex shrink-0 items-center gap-1">
              <Button
                size="sm"
                variant={ask.urgency === "urgent" ? "default" : "outline"}
                aria-label={`Answer: ${ask.questionSummary}`}
                data-testid={`decisions-answer-ask-${ask.id}`}
                disabled={pendingAskId === ask.id}
                onClick={() => {
                  setSuperseding(false);
                  setOpenAskId(ask.id);
                }}
              >
                {pendingAskId === ask.id && !superseding ? "Opening…" : "Answer"}
              </Button>
              {/* The second real outcome: the question stopped mattering. Without
                  it the only way to clear a stale ask is to wait for its timeout,
                  which closes it to the safe side and leaves the agent blocked. */}
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8 text-muted-foreground"
                aria-label={`No longer relevant: ${ask.questionSummary}`}
                data-testid={`decisions-supersede-ask-${ask.id}`}
                disabled={pendingAskId === ask.id}
                onClick={() => {
                  setSuperseding(true);
                  setOpenAskId(ask.id);
                }}
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          </div>
        ))}
        {data.count > 5 && (
          // Was a link to /founder/asks, which redirects to this page — it read
          // as "there is more elsewhere" and went nowhere. State the count
          // instead; the five most urgent are the ones shown.
          <p className="text-xs text-muted-foreground" data-testid="decisions-open-asks-all">
            {data.count - 5} more open {data.count - 5 === 1 ? "question" : "questions"} — answer these first.
          </p>
        )}
        {/* Verified truth (founderCollab.ts): agents never act on an
            unanswered ask; timeouts close it to the safe side. */}
        <p
          className="text-micro text-muted-foreground"
          data-testid="decisions-open-asks-do-nothing"
        >
          {doNothingContract("founder_ask")}
        </p>

        {/* The mounts whose absence made this whole section decorative. Both are
            null-safe on `ask`, so they render nothing until the detail query
            lands — the row click is instant and the dialog opens when the full
            ask arrives. */}
        {askFailed && openAskId != null && (
          <p className="text-xs text-destructive" role="alert" data-testid="decisions-ask-load-failed">
            Could not load question #{openAskId}. Refresh and try again — the ask is
            still open and the agent is still waiting.
          </p>
        )}
        <AnswerAskDialog
          ask={superseding ? null : openAsk}
          onClose={closeAsk}
          onSubmitted={afterSubmit}
        />
        <SupersedeAskDialog
          ask={superseding ? openAsk : null}
          onClose={closeAsk}
          onSubmitted={afterSubmit}
        />
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

  // Answer a needs-you card by tapping one of its options. Posts to the
  // decisions-inbox approve route with the EXPLICIT chosen option key — the
  // server resolves the key against contextBundle.options and fails closed
  // on anything unknown, and an explicit key means we never lean on a
  // server-side default action.
  const [answerInFlight, setAnswerInFlight] = useState<number | null>(null);
  const answerMut = useMutation({
    mutationFn: async ({ id, optionKey }: { id: number; optionKey: string }) => {
      setAnswerInFlight(id);
      await apiRequest("POST", `/api/founder/intelligence/decisions-inbox/${id}/approve`, {
        chosenOption: optionKey,
      });
    },
    onSuccess: () => {
      toast({
        title: "Answered",
        description: "Your decision was recorded and applied.",
      });
      qc.invalidateQueries({ queryKey: ["/api/founder/intelligence/decision-log"] });
      qc.invalidateQueries({ queryKey: ["/api/founder/intelligence/decisions-inbox"] });
      qc.invalidateQueries({ queryKey: ["/api/founder/intelligence/morning-briefing"] });
    },
    onError: (err: Error) => {
      toast({
        title: "Couldn't record your answer",
        description: `${err.message} — try again in a moment.`,
        variant: "destructive",
      });
    },
    onSettled: () => setAnswerInFlight(null),
  });

  // ?id=N deep link — switch to the bucket holding that row, then scroll to
  // and highlight it. Read once; applied once after the log loads.
  //
  // `id` is a DECISION-LOG row id and nothing else. Asks are a different table
  // with its own key space and use `?ask=` (see OpenAsksSection) — the Letter
  // used to send an ask id here, where it either matched an unrelated decision
  // or silently matched nothing.
  const deepLinkId = useMemo(() => {
    const raw = new URLSearchParams(window.location.search).get("id");
    const n = raw ? parseInt(raw, 10) : NaN;
    return Number.isFinite(n) ? n : null;
  }, []);
  const [deepLinkApplied, setDeepLinkApplied] = useState(false);
  useEffect(() => {
    if (deepLinkApplied || deepLinkId == null || !data) return;
    for (const key of BUCKET_ORDER) {
      if ((data.buckets[key] ?? []).some((r) => r.id === deepLinkId)) {
        setActiveBucket(key);
        break;
      }
    }
    setDeepLinkApplied(true);
    requestAnimationFrame(() => {
      document
        .querySelector(`[data-testid="decision-row-${deepLinkId}"]`)
        ?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  }, [data, deepLinkId, deepLinkApplied]);

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
                answerable={activeBucket === "needsYou"}
                onAnswer={(id, optionKey) => answerMut.mutate({ id, optionKey })}
                answerInFlight={answerInFlight}
                highlighted={row.id === deepLinkId}
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
