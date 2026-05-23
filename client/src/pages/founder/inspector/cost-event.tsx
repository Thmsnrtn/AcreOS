/**
 * /founder/inspector/cost-event/:id — per-ledger-row provenance.
 *
 * For any financial_ledger debit, this page resolves the underlying
 * provider event (mail piece, SMS, AI call, Stripe invoice), shows the
 * router's alternatives so the founder can second-guess the routing
 * choice, and lists related events from the same campaign/sequence.
 */

import { useQuery } from "@tanstack/react-query";
import { Link, useRoute } from "wouter";
import { ArrowLeft, ArrowRight, Building2, Layers } from "lucide-react";

import { PageShell } from "@/components/page-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Sparkles } from "lucide-react";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { discussWithAtlas } from "@/lib/atlas-discuss";

interface CostEventResponse {
  event: {
    id: number;
    organizationId: number | null;
    bucket: string;
    category: string;
    amountCents: number;
    costCents: number;
    feature: string | null;
    provider: string | null;
    externalEventId: string | null;
    invoiceId: number | null;
    campaignId: number | null;
    postedAt: string;
    postedBy: string;
    notes: string | null;
  };
  origin: Record<string, unknown> | null;
  sourceTable: string;
  alternatives: Array<{
    provider: string;
    perEventCents: number;
    deltaVsThisCents: number;
  }>;
  related: Array<{
    id: number;
    amountCents: number;
    feature: string | null;
    provider: string | null;
    postedAt: string;
  }>;
  routerDecision: unknown | null;
}

export default function CostEventInspector() {
  const [, params] = useRoute<{ id: string }>("/founder/inspector/cost-event/:id");
  const id = params?.id ?? "";
  useDocumentTitle(`Cost event ${id} — Inspector`);

  const { data, isLoading, error } = useQuery<CostEventResponse>({
    queryKey: [`/api/founder/inspector/cost-event/${id}`],
    enabled: !!id,
  });

  if (isLoading) {
    return (
      <PageShell label="Cost event">
        <Skeleton className="h-64 w-full" />
      </PageShell>
    );
  }
  if (error || !data) {
    return (
      <PageShell label="Cost event">
        <p className="text-sm text-destructive">
          Failed to load: {error instanceof Error ? error.message : "unknown error"}
        </p>
      </PageShell>
    );
  }

  const { event, origin, alternatives, related, sourceTable } = data;

  return (
    <PageShell label="Cost event">
      <div className="space-y-6">
        <header className="space-y-1">
          <Link href="/founder" className="text-xs text-muted-foreground inline-flex items-center gap-1 hover:underline">
            <ArrowLeft className="w-3 h-3" aria-hidden /> Back to Now
          </Link>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
            Cost event #{event.id}
          </h1>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge variant="outline">{event.provider ?? "no-provider"}</Badge>
            <Badge variant="outline">{event.feature ?? "no-feature"}</Badge>
            <Badge variant="secondary">{event.bucket}</Badge>
            <span className="text-muted-foreground">
              {new Date(event.postedAt).toLocaleString()} · posted by {event.postedBy}
            </span>
          </div>
        </header>

        {/* Breadcrumbs */}
        <BreadcrumbStrip event={event} sourceTable={sourceTable} />

        {/* Cost figure */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
            <CardTitle className="text-sm">Charge</CardTitle>
            {/* Phase D — Atlas Dock entry. Pre-fills a question about
                this exact cost event so the founder doesn't have to
                re-state the id. */}
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs gap-1.5"
              data-testid="discuss-cost-event"
              onClick={() =>
                discussWithAtlas({
                  message: `Tell me about this cost event (id ${id}). Why did it route this way and what would have been cheaper?`,
                  artifactType: "cost_event",
                  artifactId: id,
                })
              }
            >
              <Sparkles className="w-3 h-3" aria-hidden="true" />
              Discuss with Atlas
            </Button>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-baseline gap-3">
              <span className="text-3xl font-bold tabular-nums">{fmtUsd(event.costCents)}</span>
              <span className="text-sm text-muted-foreground">
                {event.feature ?? "uncategorized"} via {event.provider ?? "no-provider"}
              </span>
            </div>
            {event.notes && (
              <p className="text-xs italic text-muted-foreground mt-2">"{event.notes}"</p>
            )}
            <dl className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-2 text-xs">
              <Field label="Bucket" value={event.bucket} />
              <Field label="Category" value={event.category} />
              <Field label="External ID" value={event.externalEventId ?? "—"} />
              <Field label="Invoice ID" value={event.invoiceId !== null ? String(event.invoiceId) : "—"} />
              <Field label="Campaign ID" value={event.campaignId !== null ? String(event.campaignId) : "—"} />
              <Field label="Org" value={event.organizationId !== null ? `#${event.organizationId}` : "—"} />
            </dl>
            {event.organizationId !== null && (
              <Link
                href={`/founder/inspector/org/${event.organizationId}`}
                className="text-xs underline text-primary inline-flex items-center gap-1 mt-2"
              >
                <Building2 className="w-3 h-3" aria-hidden /> See org cost tab →
              </Link>
            )}
          </CardContent>
        </Card>

        {/* Origin */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Original action — {sourceTable}</CardTitle>
          </CardHeader>
          <CardContent>
            {origin === null ? (
              <p className="text-xs italic text-muted-foreground">
                Source row not resolvable. The provider event id wasn't found in the expected table —
                this can happen for older ledger entries posted before the provider integration
                stored its event ids consistently.
              </p>
            ) : (
              <dl className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                {Object.entries(origin).map(([k, v]) => (
                  <Field key={k} label={k} value={String(v ?? "—")} />
                ))}
              </dl>
            )}
          </CardContent>
        </Card>

        {/* Alternatives */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Alternatives — what could have been cheaper?</CardTitle>
          </CardHeader>
          <CardContent>
            {alternatives.length === 0 ? (
              <p className="text-xs italic text-muted-foreground">
                No alternative quotes recorded for this provider family.
              </p>
            ) : (
              <div className="space-y-1">
                {alternatives.map((a) => (
                  <div
                    key={a.provider}
                    className="flex flex-wrap items-center gap-2 text-xs border-b border-border/40 py-1.5"
                  >
                    <Badge
                      variant={a.provider === event.provider ? "default" : "outline"}
                      className="font-mono"
                    >
                      {a.provider}
                    </Badge>
                    <span className="tabular-nums">{fmtCents(a.perEventCents)}/event</span>
                    {a.provider !== event.provider && (
                      <span
                        className={
                          a.deltaVsThisCents < 0
                            ? "text-emerald-600 dark:text-emerald-400"
                            : "text-destructive"
                        }
                      >
                        Δ {fmtCents(a.deltaVsThisCents)}
                      </span>
                    )}
                    {a.provider !== event.provider && (
                      <Link
                        href={`/founder/inspector/provider/${a.provider}`}
                        className="ml-auto underline text-primary inline-flex items-center gap-1"
                      >
                        Audit {a.provider} <ArrowRight className="w-3 h-3" aria-hidden />
                      </Link>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Related events */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <Layers className="w-4 h-4" aria-hidden /> Related events
              {event.campaignId !== null && (
                <span className="text-xs text-muted-foreground font-normal">
                  (campaign #{event.campaignId})
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {related.length === 0 ? (
              <p className="text-xs italic text-muted-foreground">
                No other events from this campaign/sequence.
              </p>
            ) : (
              <div className="space-y-1">
                {related.map((r) => (
                  <div
                    key={r.id}
                    className="flex flex-wrap items-center gap-2 text-xs border-b border-border/40 py-1.5"
                  >
                    <span className="font-mono text-muted-foreground w-36 shrink-0">
                      {new Date(r.postedAt).toLocaleString()}
                    </span>
                    <Badge variant="outline">{r.provider ?? "—"}</Badge>
                    <Badge variant="outline">{r.feature ?? "—"}</Badge>
                    <span className="tabular-nums">{fmtUsd(r.amountCents)}</span>
                    <Link
                      href={`/founder/inspector/cost-event/${r.id}`}
                      className="ml-auto underline text-primary"
                    >
                      Open →
                    </Link>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </PageShell>
  );
}

function BreadcrumbStrip({
  event,
  sourceTable,
}: {
  event: CostEventResponse["event"];
  sourceTable: string;
}) {
  const crumbs: string[] = [];
  crumbs.push("financial_ledger");
  crumbs.push(`${event.provider ?? "?"}:${event.externalEventId ?? "?"}`);
  crumbs.push(sourceTable);
  if (event.campaignId !== null) crumbs.push(`campaign:${event.campaignId}`);
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs font-mono text-muted-foreground">
      {crumbs.map((c, i) => (
        <span key={i} className="inline-flex items-center gap-2">
          <span className="bg-muted/40 px-2 py-0.5 rounded">{c}</span>
          {i < crumbs.length - 1 && <ArrowRight className="w-3 h-3" aria-hidden />}
        </span>
      ))}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-mono text-foreground break-words">{value}</dd>
    </div>
  );
}

function fmtUsd(cents: number): string {
  const dollars = cents / 100;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: Math.abs(dollars) < 1 ? 4 : 2,
  }).format(dollars);
}

function fmtCents(cents: number): string {
  if (Math.abs(cents) < 1) return `${cents.toFixed(2)}¢`;
  return fmtUsd(cents);
}
