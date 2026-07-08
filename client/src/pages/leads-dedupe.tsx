/**
 * /leads/dedupe — surface every cluster of likely-duplicate leads so
 * the operator can merge them in bulk.
 *
 * The server-side scanner groups leads by normalized phone, email, and
 * (first+last+address) tuple. Each cluster renders as a card with:
 *   - What matched (phone number / email / name+address)
 *   - Every member lead with its status, source, last contact
 *   - A radio-group selection for the record to keep
 *   - A confirm-then-merge button that folds the rest onto the primary
 *
 * Roadmap #146 (lead dedupe across sources) / #209 (contact
 * consolidation). Principle 1: data quality matters more to land
 * investors than anyone — same owner hits multiple tax-delinquent
 * lists, skip-trace comes back twice, direct-mail dedup hits a
 * "different spelling, same person."
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { QueryErrorState } from "@/components/query-error-state";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Users, Phone, Mail, MapPin, GitMerge, Loader2, CheckCircle2, RefreshCw } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { relative, plural } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { cn } from "@/lib/utils";
import type { Lead } from "@shared/schema";

interface LeadCluster {
  matchType: "phone" | "email" | "name_address";
  matchValue: string;
  leads: Lead[];
}

const MATCH_ICONS = {
  phone: Phone,
  email: Mail,
  name_address: MapPin,
} as const;

const MATCH_LABELS = {
  phone: "Same phone number",
  email: "Same email",
  name_address: "Same name + address",
} as const;

interface PendingMerge {
  cluster: LeadCluster;
  primaryId: number;
  duplicateIds: number[];
}

export default function LeadsDedupePage() {
  useDocumentTitle("Lead dedupe");
  const { toast } = useToast();
  const qc = useQueryClient();
  const [pending, setPending] = useState<PendingMerge | null>(null);
  const [isMerging, setIsMerging] = useState(false);

  const { data, isLoading, error, refetch, isFetching } = useQuery<{ clusters: LeadCluster[] }>({
    queryKey: ["/api/leads/duplicate-clusters"],
    staleTime: 60_000,
  });

  const runMerge = async () => {
    if (!pending) return;
    setIsMerging(true);
    let merged = 0;
    try {
      for (const duplicateId of pending.duplicateIds) {
        const res = await apiRequest("POST", "/api/leads/merge", {
          primaryId: pending.primaryId,
          duplicateId,
        });
        if (!res.ok) {
          throw new Error(`Merge failed on lead ${duplicateId}`);
        }
        merged += 1;
      }
      toast({
        title: merged === 1 ? "Lead merged" : `${merged} leads merged`,
        description: "The kept record now holds all status, notes, and activity.",
      });
      setPending(null);
    } catch (err) {
      toast({
        title: merged > 0 ? "Merge partially failed" : "Merge failed",
        description:
          merged > 0
            ? `Merged ${merged} of ${pending.duplicateIds.length}. ${(err as Error).message}`
            : (err as Error).message,
        variant: "destructive",
      });
    } finally {
      setIsMerging(false);
      qc.invalidateQueries({ queryKey: ["/api/leads/duplicate-clusters"] });
      qc.invalidateQueries({ queryKey: ["/api/leads"] });
    }
  };

  const clusters = data?.clusters ?? [];
  const totalDuplicates = clusters.reduce((s, c) => s + (c.leads.length - 1), 0);

  const pendingPrimary =
    pending?.cluster.leads.find((l) => l.id === pending.primaryId) ?? null;
  const pendingPrimaryName = pendingPrimary
    ? `${pendingPrimary.firstName ?? ""} ${pendingPrimary.lastName ?? ""}`.trim() || "the selected lead"
    : "the selected lead";

  return (
    <PageShell label="Lead Dedupe">
      <div className="space-y-6 max-w-5xl mx-auto">
        <PageHeader
          title="Lead dedupe"
          icon={<GitMerge className="h-5 w-5 text-muted-foreground" aria-hidden="true" />}
          description="Same owner, multiple lists. Pick the record you want to keep in each cluster — the others archive and their status, notes, and activity fold in."
          actions={
            <Button
              size="sm"
              variant="outline"
              onClick={() => refetch()}
              disabled={isFetching}
              aria-label="Rescan for duplicates"
            >
              <RefreshCw className={cn("h-3.5 w-3.5 mr-1.5", isFetching && "animate-spin")} aria-hidden="true" />
              Rescan
            </Button>
          }
        >
          {!isLoading && clusters.length > 0 && (
            <p className="text-sm text-muted-foreground">
              {plural(clusters.length, "cluster")} found · {plural(totalDuplicates, "duplicate")}{" "}
              ready to merge.
            </p>
          )}
        </PageHeader>

        {isLoading ? (
          <div className="space-y-4" aria-busy="true" aria-label="Scanning for duplicate leads">
            <Skeleton className="h-40 w-full rounded-card" />
            <Skeleton className="h-40 w-full rounded-card" />
          </div>
        ) : error ? (
          <QueryErrorState
            error={error as Error}
            onRetry={() => refetch()}
            isRetrying={isFetching}
            title="Couldn't scan for duplicates"
            description="The dedupe scanner didn't respond. Your leads are safe — retry when ready."
          />
        ) : clusters.length === 0 ? (
          <EmptyState
            icon={CheckCircle2}
            headline="No duplicates found"
            subtitle="Your lead list is clean — no matching phone, email, or name+address clusters detected."
            tone="celebratory"
            // TODO(cta): "clean" state is celebratory — no action needed; tone signals success
            cta={{ label: "", _noOp: true }}
          />
        ) : (
          <div className="space-y-4">
            {clusters.map((cluster, idx) => (
              <ClusterCard
                key={`${cluster.matchType}-${idx}`}
                cluster={cluster}
                onRequestMerge={(primaryId, duplicateIds) => {
                  setPending({ cluster, primaryId, duplicateIds });
                }}
                disabled={isMerging}
              />
            ))}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open && !isMerging) setPending(null);
        }}
        title={`Keep ${pendingPrimaryName}?`}
        description={
          pending
            ? `The other ${plural(pending.duplicateIds.length, "lead")} in this cluster will be archived, and their status, notes, and activity will fold onto ${pendingPrimaryName}. This can't be undone from the UI.`
            : ""
        }
        confirmLabel={
          pending && pending.duplicateIds.length === 1
            ? "Merge 1 lead"
            : `Merge ${pending?.duplicateIds.length ?? 0} leads`
        }
        cancelLabel="Cancel"
        variant="destructive"
        isLoading={isMerging}
        onConfirm={runMerge}
      />
    </PageShell>
  );
}

function ClusterCard({
  cluster,
  onRequestMerge,
  disabled,
}: {
  cluster: LeadCluster;
  onRequestMerge: (primaryId: number, duplicateIds: number[]) => void;
  disabled: boolean;
}) {
  const [selectedId, setSelectedId] = useState<number | null>(cluster.leads[0]?.id ?? null);
  const Icon = MATCH_ICONS[cluster.matchType];
  const groupLabel = `${MATCH_LABELS[cluster.matchType]}: ${cluster.matchValue}`;

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Icon className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden="true" />
          <span className="text-sm font-medium">{MATCH_LABELS[cluster.matchType]}</span>
          <Badge variant="outline" className="text-xs font-mono break-all">
            {cluster.matchValue}
          </Badge>
          <Badge variant="secondary" className="text-xs ml-auto shrink-0">
            {plural(cluster.leads.length, "lead")}
          </Badge>
        </div>

        <div
          className="space-y-2"
          role="radiogroup"
          aria-label={groupLabel}
        >
          {(Array.isArray(cluster.leads) ? cluster.leads : []).map((lead) => {
            const isSelected = selectedId === lead.id;
            const fullName = `${lead.firstName ?? ""} ${lead.lastName ?? ""}`.trim() || "Unnamed lead";
            return (
              <div
                key={lead.id}
                role="radio"
                aria-checked={isSelected}
                tabIndex={isSelected ? 0 : -1}
                onClick={() => setSelectedId(lead.id)}
                onKeyDown={(e) => {
                  if (e.key === " " || e.key === "Enter") {
                    e.preventDefault();
                    setSelectedId(lead.id);
                  }
                }}
                className={cn(
                  "flex items-start gap-3 rounded-md border p-3 transition-colors cursor-pointer",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                  isSelected
                    ? "border-primary/60 bg-primary/5"
                    : "border-muted hover:bg-muted/30"
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2",
                    isSelected ? "border-primary" : "border-muted-foreground/40"
                  )}
                >
                  {isSelected && <span className="h-2.5 w-2.5 rounded-full bg-primary" />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground flex items-center gap-1.5 flex-wrap">
                    <span>{fullName}</span>
                    <Badge variant="outline" className="text-xs uppercase">
                      {lead.status}
                    </Badge>
                    {lead.source && (
                      <Badge variant="secondary" className="text-xs">
                        {lead.source}
                      </Badge>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">
                    {[lead.phone, lead.email, lead.address].filter(Boolean).join(" · ") || "No contact details"}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {lead.lastContactedAt
                      ? `Last contact ${relative(lead.lastContactedAt)}`
                      : "Never contacted"}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex flex-col gap-2 pt-1 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground">
            <Users className="inline h-3 w-3 mr-1 -mt-0.5" aria-hidden="true" />
            Selected lead keeps everything; the rest archive and fold in.
          </p>
          <Button
            size="sm"
            className="min-h-11 pointer-fine:sm:min-h-9 shrink-0"
            onClick={() => {
              if (!selectedId) return;
              const duplicateIds = (Array.isArray(cluster.leads) ? cluster.leads : []).map((l) => l.id).filter((id) => id !== selectedId);
              if (duplicateIds.length === 0) return;
              onRequestMerge(selectedId, duplicateIds);
            }}
            disabled={disabled || !selectedId}
          >
            {disabled ? (
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" aria-hidden="true" />
            ) : (
              <GitMerge className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
            )}
            Review merge
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
