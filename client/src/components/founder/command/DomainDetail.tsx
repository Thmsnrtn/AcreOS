/**
 * DomainDetail — the expanded findings list for one domain.
 *
 * Renders each active finding with title + detail + citedReason + severity
 * chip + acknowledge/resolve actions. Shared body used by both the mobile
 * bottom-sheet and the desktop dialog (DomainDetailContainer).
 *
 * Mutations call POST /api/founder/audit-findings/:id/{acknowledge,resolve}
 * via apiRequest and optimistically refetch the findings query.
 */

import { Check, CircleCheck, Quote, Clock } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import {
  type AuditFinding,
  type DomainSummary,
  SEVERITY_LABEL,
  severityChipClasses,
} from "./logic";

function relTime(iso: string): string {
  try {
    const d = new Date(iso).getTime();
    const diff = Date.now() - d;
    const h = Math.floor(diff / 3_600_000);
    if (h < 1) return "just now";
    if (h < 24) return `${h}h ago`;
    const days = Math.floor(h / 24);
    if (days < 30) return `${days}d ago`;
    return new Date(iso).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

interface FindingCardProps {
  finding: AuditFinding;
  onAcknowledge: (id: string) => void;
  onResolve: (id: string) => void;
  pendingAction: { id: string; kind: "acknowledge" | "resolve" } | null;
}

function FindingCard({
  finding,
  onAcknowledge,
  onResolve,
  pendingAction,
}: FindingCardProps) {
  const chip = severityChipClasses(finding.severity);
  const acknowledged = finding.status === "acknowledged";
  const ackPending =
    pendingAction?.id === finding.id && pendingAction.kind === "acknowledge";
  const resolvePending =
    pendingAction?.id === finding.id && pendingAction.kind === "resolve";
  const anyPending = ackPending || resolvePending;

  return (
    <li className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <h4 className="text-sm font-semibold text-foreground">{finding.title}</h4>
        <span
          className={cn(
            "shrink-0 rounded-full px-2 py-0.5 text-xs font-medium",
            chip.text,
            chip.surface,
          )}
        >
          {SEVERITY_LABEL[finding.severity]}
        </span>
      </div>

      {finding.detail ? (
        <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">
          {finding.detail}
        </p>
      ) : null}

      {finding.citedReason ? (
        <div className="mt-3 flex items-start gap-2 rounded-lg bg-muted/60 px-3 py-2">
          <Quote
            className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
          <p className="text-xs text-muted-foreground italic leading-relaxed">
            {finding.citedReason}
          </p>
        </div>
      ) : null}

      <div className="mt-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Clock className="h-3 w-3" aria-hidden="true" />
          <span>{finding.detector}</span>
          <span aria-hidden="true">·</span>
          <span>{relTime(finding.lastSeenAt)}</span>
          {acknowledged ? (
            <span className="ml-1 inline-flex items-center gap-1 text-acr-warn">
              <Check className="h-3 w-3" aria-hidden="true" />
              acknowledged
            </span>
          ) : null}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {!acknowledged ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="min-h-[36px]"
            disabled={anyPending}
            onClick={() => onAcknowledge(finding.id)}
            data-testid={`finding-acknowledge-${finding.id}`}
          >
            <Check className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            {ackPending ? "Acknowledging…" : "Acknowledge"}
          </Button>
        ) : null}
        <Button
          type="button"
          size="sm"
          className="min-h-[36px]"
          disabled={anyPending}
          onClick={() => onResolve(finding.id)}
          data-testid={`finding-resolve-${finding.id}`}
        >
          <CircleCheck className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
          {resolvePending ? "Resolving…" : "Resolve"}
        </Button>
      </div>
    </li>
  );
}

interface DomainDetailProps {
  summary: DomainSummary;
  onAcknowledge: (id: string) => void;
  onResolve: (id: string) => void;
  pendingAction: { id: string; kind: "acknowledge" | "resolve" } | null;
}

export function DomainDetail({
  summary,
  onAcknowledge,
  onResolve,
  pendingAction,
}: DomainDetailProps) {
  if (summary.activeFindings.length === 0) {
    return (
      <div className="py-6">
        <EmptyState
          icon={CircleCheck}
          tone="celebratory"
          headline={`${summary.meta.label} is all clear`}
          subtitle="No open findings from this domain's continuous audit."
          // TODO(cta): read-only synthesis view — findings are system-generated, no user create action.
          cta={{ label: "", _noOp: true }}
        />
      </div>
    );
  }

  return (
    <ul
      className="space-y-3"
      role="list"
      aria-label={`${summary.meta.label} findings`}
    >
      {summary.activeFindings.map((f) => (
        <FindingCard
          key={f.id}
          finding={f}
          onAcknowledge={onAcknowledge}
          onResolve={onResolve}
          pendingAction={pendingAction}
        />
      ))}
    </ul>
  );
}
