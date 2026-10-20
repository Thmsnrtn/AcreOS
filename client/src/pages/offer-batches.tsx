/**
 * /offers/batches — read-only list of offer batches.
 *
 * Batch PROCESSING does not exist yet: POST /api/offers/batch used to write a
 * batch, enqueue a "process-offer-batch" job that no handler ever picked up,
 * and leave the batch "processing" forever — while this page promised that
 * Pax hands the merge to the print vendor and tracks reply windows. Creation
 * is now refused at the API (offerBatchService OFFER_BATCH_PROCESSOR_REGISTERED)
 * and this page says plainly what exists: a list of batches created earlier,
 * none of which were processed.
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
          description="Batches of purchase offers priced against a pricing matrix. Creating new batches is not available yet: nothing processes a batch after it is created — no letters are generated, nothing is sent, and replies are not tracked."
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
            headline="No offer batches"
            subtitle="Offer batches can't be created yet. Batch processing isn't built, so new batches are refused rather than left waiting on work that never runs."
            // TODO(cta): read-only list — batch creation is refused until batch processing exists
            cta={{ label: "", _noOp: true }}
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
                          {b.status === "processing" && (
                            <p className="text-caption text-muted-foreground" data-testid={`batch-not-processed-${b.id}`}>
                              Never processed — batch processing isn't built, so nothing from this batch was sent.
                            </p>
                          )}
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
