/**
 * /founder/command — the founder "Command" cockpit.
 *
 * ONE page that answers "is the company green right now?" by aggregating
 * every domain's continuous-audit findings into per-domain status tiles.
 * This is the synthesis surface six domains independently asked for — not
 * six dashboards, the one.
 *
 *   1. Company-status banner — green / amber / red, worst open severity.
 *   2. A grid of per-domain tiles (Finance / Compliance / Alignment / AI /
 *      Reliability / Future / Product / CS / Growth). Tap → domain detail
 *      (bottom-sheet on mobile, dialog on desktop) with each finding's
 *      detail + citedReason + acknowledge/resolve.
 *   3. Skeleton matching the grid; rewarding "everything's green" EmptyState;
 *      QueryErrorState with retry.
 *
 * Contract (parallel substrate agent owns the server route):
 *   GET  /api/founder/audit-findings
 *   POST /api/founder/audit-findings/:id/acknowledge
 *   POST /api/founder/audit-findings/:id/resolve
 *
 * Consumed DEFENSIVELY: we derive our own per-domain rollup from `findings`
 * (server `rollup` is treated as advisory), tolerate unknown domains, and
 * render loading/empty gracefully if the route isn't deployed yet.
 */

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { ShieldCheck, RefreshCw } from "lucide-react";

import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AnimatedCounter } from "@/components/ui/animated-counter";
import { EmptyState } from "@/components/empty-state";
import { QueryErrorState } from "@/components/query-error-state";
import { staggerContainer } from "@/lib/animations";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

import {
  type AuditFinding,
  type AuditFindingsResponse,
  type DomainSummary,
  type FindingStatus,
  summarizeAllDomains,
  companyStatus,
  totalsBySeverity,
  totalActiveFindings,
} from "@/components/founder/command/logic";
import { StatusBanner } from "@/components/founder/command/StatusBanner";
import { DomainTile } from "@/components/founder/command/DomainTile";
import { DomainDetailContainer } from "@/components/founder/command/DomainDetailContainer";

const FINDINGS_KEY = ["/api/founder/audit-findings"] as const;

// ─── Skeleton matching the tile grid ─────────────────────────────────────────

function CommandSkeleton() {
  return (
    <div className="space-y-6" data-testid="command-skeleton">
      <Skeleton className="h-28 w-full rounded-2xl" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 9 }).map((_, i) => (
          <Skeleton key={i} className="h-28 w-full rounded-2xl" />
        ))}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────

export default function FounderCommandPage() {
  useDocumentTitle("Command · Founder");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [selectedDomain, setSelectedDomain] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<{
    id: string;
    kind: "acknowledge" | "resolve";
  } | null>(null);

  const { data, isLoading, error, refetch, isFetching, dataUpdatedAt } =
    useQuery<AuditFindingsResponse>({
      queryKey: FINDINGS_KEY,
      queryFn: async () => {
        const res = await fetch("/api/founder/audit-findings", {
          credentials: "include",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as Partial<AuditFindingsResponse>;
        // Defensive: tolerate a bare array or a missing findings key.
        const findings = Array.isArray(json)
          ? json
          : Array.isArray(json?.findings)
            ? json.findings
            : [];
        return { findings, rollup: json?.rollup };
      },
      staleTime: 60 * 1000,
      refetchInterval: 5 * 60 * 1000,
    });

  const summaries: DomainSummary[] = useMemo(
    () => summarizeAllDomains(data?.findings ?? []),
    [data?.findings],
  );

  const status = useMemo(() => companyStatus(summaries), [summaries]);
  const { critical, warn } = useMemo(
    () => totalsBySeverity(summaries),
    [summaries],
  );
  const totalOpen = useMemo(
    () => totalActiveFindings(summaries),
    [summaries],
  );

  const selectedSummary =
    summaries.find((s) => s.domain === selectedDomain) ?? null;

  const asOfLabel =
    data && dataUpdatedAt
      ? new Date(dataUpdatedAt).toLocaleTimeString(undefined, {
          hour: "numeric",
          minute: "2-digit",
        })
      : undefined;

  // Optimistic acknowledge/resolve: the finding's new status is reflected in
  // the cache the instant the founder taps, so the tile grid re-rollups and
  // the detail row updates without waiting on the round-trip. On error we
  // restore the pre-mutation snapshot and toast; onSettled re-syncs with the
  // server's resolution ledger. `acknowledge` keeps the finding active (it
  // drops out of "open" but still counts toward status); `resolve` clears it.
  const actionMutation = useMutation<
    { id: string; kind: "acknowledge" | "resolve" },
    unknown,
    { id: string; kind: "acknowledge" | "resolve" },
    { previous?: AuditFindingsResponse }
  >({
    mutationFn: async (vars) => {
      await apiRequest(
        "POST",
        `/api/founder/audit-findings/${vars.id}/${vars.kind}`,
      );
      return vars;
    },
    onMutate: async (vars) => {
      setPendingAction(vars);
      await queryClient.cancelQueries({ queryKey: FINDINGS_KEY });
      const previous =
        queryClient.getQueryData<AuditFindingsResponse>(FINDINGS_KEY);
      if (previous) {
        const nextStatus: FindingStatus =
          vars.kind === "resolve" ? "resolved" : "acknowledged";
        queryClient.setQueryData<AuditFindingsResponse>(FINDINGS_KEY, {
          ...previous,
          findings: previous.findings.map((f: AuditFinding) =>
            f.id === vars.id ? { ...f, status: nextStatus } : f,
          ),
        });
      }
      return { previous };
    },
    onSuccess: (vars) => {
      toast({
        title:
          vars.kind === "resolve" ? "Finding resolved" : "Finding acknowledged",
      });
    },
    onError: (err: unknown, vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(FINDINGS_KEY, context.previous);
      }
      toast({
        title: `Couldn't ${vars.kind} finding`,
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    },
    onSettled: () => {
      setPendingAction(null);
      void queryClient.invalidateQueries({ queryKey: FINDINGS_KEY });
    },
  });

  const handleAcknowledge = (id: string) =>
    actionMutation.mutate({ id, kind: "acknowledge" });
  const handleResolve = (id: string) =>
    actionMutation.mutate({ id, kind: "resolve" });

  const allGreen = !isLoading && !error && totalOpen === 0;

  return (
    <PageShell maxWidth="5xl" label="Founder command">
      <div className="space-y-5 md:space-y-6">
        <header className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-foreground">
              Command
            </h1>
            <p className="text-sm text-muted-foreground">
              Every domain's continuous audit, in one glance. Is the company
              green right now?
            </p>
            {!isLoading && !error && totalOpen > 0 ? (
              <p className="text-sm text-muted-foreground">
                <AnimatedCounter
                  value={totalOpen}
                  className="font-semibold text-foreground"
                />{" "}
                open finding{totalOpen === 1 ? "" : "s"} need
                {totalOpen === 1 ? "s" : ""} a look.
              </p>
            ) : null}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="shrink-0"
            aria-label="Refresh findings"
            disabled={isFetching}
            onClick={() => void refetch()}
          >
            <RefreshCw
              className={
                isFetching ? "h-4 w-4 animate-spin" : "h-4 w-4"
              }
              aria-hidden="true"
            />
          </Button>
        </header>

        {isLoading ? <CommandSkeleton /> : null}

        {error ? (
          <QueryErrorState
            error={error as Error}
            onRetry={() => void refetch()}
            isRetrying={isFetching}
            title="Couldn't load the audit findings"
            description="The /api/founder/audit-findings endpoint didn't respond. If it isn't deployed yet, this surface will populate the moment it is."
          />
        ) : null}

        {!isLoading && !error ? (
          <>
            <StatusBanner
              status={status}
              criticalCount={critical}
              warnCount={warn}
              asOfLabel={asOfLabel}
            />

            {allGreen ? (
              <EmptyState
                icon={ShieldCheck}
                tone="celebratory"
                headline="Everything's green — no open findings"
                subtitle="All nine domains' continuous audits are clear. Nothing needs you right now. The team keeps watching; you'll see a tile turn amber or red here the moment something does."
                // TODO(cta): synthesis surface — findings are system-generated; the rewarding action is "nothing to do".
                cta={{ label: "", _noOp: true }}
              />
            ) : (
              <motion.div
                variants={staggerContainer}
                initial="hidden"
                animate="visible"
                className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
              >
                {summaries.map((summary) => (
                  <DomainTile
                    key={summary.domain}
                    summary={summary}
                    onSelect={setSelectedDomain}
                  />
                ))}
              </motion.div>
            )}
          </>
        ) : null}
      </div>

      <DomainDetailContainer
        summary={selectedSummary}
        open={selectedDomain !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedDomain(null);
        }}
        onAcknowledge={handleAcknowledge}
        onResolve={handleResolve}
        pendingAction={pendingAction}
      />
    </PageShell>
  );
}
