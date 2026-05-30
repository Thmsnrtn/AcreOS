/**
 * /offers/batches — read-only list view of bulk-offer batches.
 *
 * The backend (server/services/offerBatchService.ts +
 * routes-analytics.ts POST /api/offers/batch) can generate batches of
 * offers against pricing matrices and lead lists. Until this commit
 * there was no UI to see or manage them. This page closes that loop:
 *
 *   - Lists every batch for the org with counts + status
 *   - Shows offers-generated / offers-sent / offers-accepted progress
 *   - Empty state points at the API for now (bulk-create dialog is a
 *     separate pass — pricing matrix + parcel-list picker need product
 *     input before they ship)
 *
 * Roadmap top-20 #5 (bulk offer generation) — makes the existing
 * backend capability usable.
 */
import { useQuery } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { Layers, Send, CheckCircle2, Clock } from "lucide-react";
import { relative, plural, dollarsCompact } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { StatusDot } from "@/components/ui/status-dot";
import { useDocumentTitle } from "@/hooks/use-document-title";

interface OfferBatch {
  id: number;
  name: string;
  status: string;
  totalOffers: number | null;
  offersGenerated: number | null;
  offersSent: number | null;
  offersAccepted: number | null;
  metadata?: { config?: { targetMargin?: number; minOfferAmount?: number; maxOfferAmount?: number } };
  generatedAt: string | null;
  sentAt: string | null;
  createdAt: string;
}

const STATUS_TONE: Record<string, "green" | "amber" | "blue" | "gray" | "red"> = {
  draft: "gray",
  pending: "amber",
  generating: "blue",
  ready: "blue",
  sent: "green",
  archived: "gray",
  failed: "red",
};

export default function OfferBatchesPage() {
  useDocumentTitle("Offer batches");
  const { data = [], isLoading, isError } = useQuery<OfferBatch[]>({
    queryKey: ["/api/offer-batches"],
    staleTime: 30_000,
  });

  return (
    <PageShell label="Offer Batches">
      <div className="space-y-6 max-w-5xl mx-auto">
        <PageHeader
          title="Offer batches"
          icon={<Layers className="h-5 w-5 text-muted-foreground" />}
          description="Bulk-generate purchase offers against a pricing matrix and a lead list. Each batch computes per-parcel offer amounts, optionally with seller-financing terms, and produces a stack of draft offer records ready to send."
        />

        {isLoading ? (
          <Card>
            <CardContent className="p-6 space-y-3">
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
            </CardContent>
          </Card>
        ) : isError ? (
          <Card>
            <CardContent className="p-6 text-sm text-acr-neg" role="alert">
              Couldn't load batches. Your existing batches are unchanged — reload the page to try again.
            </CardContent>
          </Card>
        ) : data.length === 0 ? (
          <EmptyState
            icon={Layers}
            title="No batches mailed"
            description="POST a pricing matrix + parcel list to /api/offers/batch — Pax generates an offer per parcel, hands the merge to the print vendor, and tracks reply windows per recipient. A guided dialog is on the roadmap."
          />
        ) : (
          <ul className="space-y-3" aria-label="Offer batches">
            {data.map((b) => {
              const tone = STATUS_TONE[b.status] ?? "gray";
              const total = b.totalOffers ?? 0;
              const generated = b.offersGenerated ?? 0;
              const sent = b.offersSent ?? 0;
              const accepted = b.offersAccepted ?? 0;
              const cfg = b.metadata?.config;
              return (
                <li key={b.id}>
                  <Card>
                    <CardContent className="p-4 space-y-2">
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <StatusDot tone={tone} label={<span className="capitalize">{b.status}</span>} />
                            <span className="text-xs text-muted-foreground tabular-nums">
                              Created {relative(b.createdAt)}
                            </span>
                            {b.sentAt && (
                              <Badge variant="outline" className="text-xs">
                                <Send className="h-3 w-3 mr-1" aria-hidden="true" />
                                <span className="tabular-nums">Sent {relative(b.sentAt)}</span>
                              </Badge>
                            )}
                          </div>
                          <p className="text-sm font-medium text-foreground mt-1.5 truncate">{b.name}</p>
                          {cfg && (
                            <p className="text-caption text-muted-foreground">
                              {cfg.targetMargin != null && (
                                <>Target <span className="tabular-nums">{Math.round(cfg.targetMargin * 100)}%</span> of ARV · </>
                              )}
                              {cfg.minOfferAmount != null && cfg.maxOfferAmount != null && (
                                <span className="tabular-nums">
                                  {dollarsCompact(cfg.minOfferAmount * 100)} – {dollarsCompact(cfg.maxOfferAmount * 100)}
                                </span>
                              )}
                            </p>
                          )}
                        </div>
                        <dl className="grid grid-cols-4 gap-2 text-center min-w-[240px]">
                          <Metric label="Total" value={plural(total, "offer")} compact />
                          <Metric label="Generated" value={generated} icon={Clock} />
                          <Metric label="Sent" value={sent} icon={Send} />
                          <Metric label="Accepted" value={accepted} icon={CheckCircle2} success={accepted > 0} />
                        </dl>
                      </div>
                    </CardContent>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </PageShell>
  );
}

function Metric({
  label,
  value,
  icon: Icon,
  success,
  compact,
}: {
  label: string;
  value: React.ReactNode;
  icon?: any;
  success?: boolean;
  compact?: boolean;
}) {
  return (
    <div>
      <dd className={`text-xs font-semibold flex items-center justify-center gap-1 tabular-nums ${success ? "text-acr-pos dark:text-acr-pos" : "text-foreground"}`}>
        {Icon ? <Icon className="h-3 w-3" aria-hidden="true" /> : null}
        {value}
      </dd>
      <dt className="text-micro uppercase tracking-wide text-muted-foreground">{label}</dt>
      {compact && null}
    </div>
  );
}
