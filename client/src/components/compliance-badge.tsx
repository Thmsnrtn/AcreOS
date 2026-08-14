import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CheckCircle, AlertTriangle, XCircle, HelpCircle } from "lucide-react";
import { nullOn404 } from "@/lib/fetch-honesty";

/**
 * `unknown` is a state, not an absence.
 *
 * The badge used to resolve `checks.length > 0 ? deriveStatus(checks) :
 * "compliant"`, and a FAILED FETCH produced an empty `checks` array — so a read
 * that never happened rendered a green **Compliant** badge, with
 * `aria-label="Compliance status: Compliant"`, on a compliance surface. The
 * popover underneath said "No checks performed yet" at the same time, so the two
 * halves of the component disagreed about whether anything had been checked.
 *
 * That is the canonical laws' rule exactly: unknown is a valid state and must
 * stay distinguishable from a favourable one. It cannot be represented by
 * reusing "compliant".
 */
type ComplianceStatus = "compliant" | "review_needed" | "non_compliant" | "unknown";

interface ComplianceCheck {
  name: string;
  status: "pass" | "warn" | "fail";
  detail: string;
}

interface ComplianceBadgeProps {
  entityType: "note" | "campaign";
  entityId?: number;
  checks?: ComplianceCheck[];
  status?: ComplianceStatus;
}

function statusIcon(status: ComplianceStatus) {
  switch (status) {
    case "compliant":
      return <CheckCircle className="w-4 h-4 text-acr-pos" />;
    case "review_needed":
      return <AlertTriangle className="w-4 h-4 text-acr-warn" />;
    case "non_compliant":
      return <XCircle className="w-4 h-4 text-acr-neg" />;
    case "unknown":
      return <HelpCircle className="w-4 h-4 text-muted-foreground" />;
  }
}

function statusLabel(status: ComplianceStatus): string {
  switch (status) {
    case "compliant": return "Compliant";
    case "review_needed": return "Review needed";
    case "non_compliant": return "Non-compliant";
    case "unknown": return "Not checked";
  }
}

function checkIcon(status: "pass" | "warn" | "fail") {
  switch (status) {
    case "pass": return <CheckCircle className="w-3 h-3 text-acr-pos" />;
    case "warn": return <AlertTriangle className="w-3 h-3 text-acr-warn" />;
    case "fail": return <XCircle className="w-3 h-3 text-acr-neg" />;
  }
}

function deriveStatus(checks: ComplianceCheck[]): ComplianceStatus {
  if (checks.some(c => c.status === "fail")) return "non_compliant";
  if (checks.some(c => c.status === "warn")) return "review_needed";
  return "compliant";
}

export function ComplianceBadge({ entityType, entityId, checks: propChecks, status: propStatus }: ComplianceBadgeProps) {
  const skipFetch = !!propChecks || !entityId;

  const { data, isError, isLoading } = useQuery({
    queryKey: ["compliance", entityType, entityId],
    queryFn: async () => {
      // `nullOn404`: a 404 means this entity has no compliance record, which is
      // a real answer. Anything else throws, so `isError` is true and the badge
      // can say "Not checked" instead of inheriting the favourable default.
      const res = await fetch(`/api/compliance/${entityType}/${entityId}/check`, { credentials: "include" });
      return nullOn404<{ checks?: ComplianceCheck[] }>(res);
    },
    enabled: !skipFetch,
    staleTime: 30 * 1000, // real-time-ish for creation flows
  });

  const checks: ComplianceCheck[] = propChecks || data?.checks || [];

  // The default is "unknown", NOT "compliant". Reached whenever nothing has been
  // checked — because the fetch failed, because it is still in flight, or
  // because the entity genuinely has no record — and every one of those is a
  // state in which this component does not know. A caller that passes `status`
  // or `checks` directly still wins, which is the only case where a positive
  // verdict is actually held.
  const unresolved = !propChecks && !propStatus && (isError || isLoading || !data);
  const status: ComplianceStatus =
    propStatus ?? (unresolved ? "unknown" : checks.length > 0 ? deriveStatus(checks) : "compliant");

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className="inline-flex items-center gap-1 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-primary rounded px-1.5 py-0.5"
          aria-label={`Compliance status: ${statusLabel(status)}`}
        >
          {statusIcon(status)}
          <span className="hidden sm:inline">{statusLabel(status)}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-3 min-w-[240px]" align="end">
        <p className="text-xs font-semibold mb-2">Compliance Checks</p>
        {checks.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {status === "unknown"
              ? "Compliance status could not be read. This is not a pass."
              : "No checks performed yet."}
          </p>
        ) : (
          <div className="space-y-1.5">
            {checks.map((check, i) => (
              <div key={i} className="flex items-start gap-2">
                {checkIcon(check.status)}
                <div>
                  <p className="text-xs font-medium">{check.name}</p>
                  <p className="text-micro text-muted-foreground">{check.detail}</p>
                </div>
              </div>
            ))}
          </div>
        )}
        {status === "non_compliant" && (
          <p className="text-micro text-acr-neg dark:text-acr-neg mt-2">
            This {entityType} cannot be created until compliance issues are resolved.
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}
