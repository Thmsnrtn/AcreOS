/**
 * /leads/dedupe — surface every cluster of likely-duplicate leads so
 * the operator can merge them in bulk.
 *
 * The server-side scanner groups leads by normalized phone, email, and
 * (first+last+address) tuple. Each cluster renders as a card with:
 *   - What matched (phone number / email / name+address)
 *   - Every member lead with its status, source, last contact
 *   - Per-member "Keep this one" button — fires storage.mergeLeads
 *     with the selected id as primary and collapses the others onto it
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
import { Users, Phone, Mail, MapPin, GitMerge, Loader2, CheckCircle2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { relative, plural } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { useDocumentTitle } from "@/hooks/use-document-title";
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

export default function LeadsDedupePage() {
  useDocumentTitle("Lead dedupe");
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data, isLoading, isError, refetch } = useQuery<{ clusters: LeadCluster[] }>({
    queryKey: ["/api/leads/duplicate-clusters"],
    staleTime: 60_000,
  });

  const merge = useMutation({
    mutationFn: async (args: { primaryId: number; duplicateId: number }) => {
      const res = await apiRequest("POST", "/api/leads/merge", args);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/leads/duplicate-clusters"] });
      qc.invalidateQueries({ queryKey: ["/api/leads"] });
      toast({ title: "Leads merged" });
    },
    onError: (err: Error) => {
      toast({ title: "Merge failed", description: err.message, variant: "destructive" });
    },
  });

  const clusters = data?.clusters ?? [];
  const totalDuplicates = clusters.reduce((s, c) => s + (c.leads.length - 1), 0);

  return (
    <PageShell label="Lead Dedupe">
      <div className="space-y-6 max-w-5xl mx-auto">
        <PageHeader
          title="Lead dedupe"
          icon={<GitMerge className="h-5 w-5 text-muted-foreground" />}
          description="Same owner hits multiple tax-delinquent lists. Skip-trace comes back twice. Direct-mail lists catch the same person with slightly different spelling. Fix it here — pick the lead you want to keep in each cluster and collapse the rest onto it. Status, notes, and activity merge automatically."
          actions={
            <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isLoading}>
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
          <Card>
            <CardContent className="p-6 space-y-3">
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
            </CardContent>
          </Card>
        ) : isError ? (
          <Card>
            <CardContent className="p-6 text-sm text-red-600">
              Could not scan for duplicates.
            </CardContent>
          </Card>
        ) : clusters.length === 0 ? (
          <EmptyState
            icon={CheckCircle2}
            title="No duplicates found"
            description="Your lead list is clean — no matching phone, email, or name+address clusters detected."
          />
        ) : (
          <div className="space-y-4">
            {clusters.map((cluster, idx) => (
              <ClusterCard
                key={`${cluster.matchType}-${idx}`}
                cluster={cluster}
                onKeep={(primaryId, duplicateIds) => {
                  // Merge each duplicate in sequence. The server already
                  // folds status / notes / activity onto the primary.
                  for (const duplicateId of duplicateIds) {
                    merge.mutate({ primaryId, duplicateId });
                  }
                }}
                disabled={merge.isPending}
              />
            ))}
          </div>
        )}
      </div>
    </PageShell>
  );
}

function ClusterCard({
  cluster,
  onKeep,
  disabled,
}: {
  cluster: LeadCluster;
  onKeep: (primaryId: number, duplicateIds: number[]) => void;
  disabled: boolean;
}) {
  const [selectedId, setSelectedId] = useState<number | null>(cluster.leads[0]?.id ?? null);
  const Icon = MATCH_ICONS[cluster.matchType];

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Icon className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">{MATCH_LABELS[cluster.matchType]}</span>
          <Badge variant="outline" className="text-[10px] font-mono">
            {cluster.matchValue}
          </Badge>
          <Badge variant="secondary" className="text-xs ml-auto">
            {plural(cluster.leads.length, "lead")}
          </Badge>
        </div>

        <div className="space-y-2">
          {cluster.leads.map((lead) => {
            const isSelected = selectedId === lead.id;
            return (
              <div
                key={lead.id}
                className={
                  "flex items-start gap-3 rounded-md border p-3 transition-colors " +
                  (isSelected
                    ? "border-emerald-500/40 bg-emerald-500/5"
                    : "border-muted hover:bg-muted/30 cursor-pointer")
                }
                onClick={() => setSelectedId(lead.id)}
              >
                <input
                  type="radio"
                  className="mt-1"
                  checked={isSelected}
                  onChange={() => setSelectedId(lead.id)}
                  aria-label={`Keep ${lead.firstName ?? ""} ${lead.lastName ?? ""}`}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">
                    {lead.firstName || "—"} {lead.lastName || ""}{" "}
                    <Badge variant="outline" className="ml-1 text-[10px] uppercase">
                      {lead.status}
                    </Badge>
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">
                    {[lead.phone, lead.email, lead.address].filter(Boolean).join(" · ")}
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {lead.source ? `${lead.source} · ` : ""}
                    {lead.lastContactedAt
                      ? `last contact ${relative(lead.lastContactedAt)}`
                      : "never contacted"}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex items-center justify-between pt-1">
          <p className="text-[11px] text-muted-foreground">
            Selected lead keeps everything; others are archived and their data folds in.
          </p>
          <Button
            size="sm"
            onClick={() => {
              if (!selectedId) return;
              const duplicateIds = cluster.leads.map((l) => l.id).filter((id) => id !== selectedId);
              onKeep(selectedId, duplicateIds);
            }}
            disabled={disabled || !selectedId}
          >
            {disabled ? (
              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
            ) : (
              <GitMerge className="h-3 w-3 mr-1" />
            )}
            Keep selected, merge rest
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
