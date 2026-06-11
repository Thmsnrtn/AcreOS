/**
 * "How AcreOS sources data" — customer-facing data-disclosure surface.
 *
 * Quinn (Chief of Alignment) item #5. Transparent sourcing is the differentiator
 * the paid black boxes cannot match: every number in AcreOS has a named source,
 * a license, and a freshness story, and this page is where we say so plainly.
 *
 * Reachable from Settings and linkable from each datum's "i" affordance via the
 * route /data-sources (and #<source> / #legend anchors). It reads the public
 * /api/trust/data-sources endpoint, which derives the list from the same license
 * register the cache guard trusts — so this page never drifts from reality.
 */
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { PageShell } from "@/components/page-shell";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { QueryErrorState } from "@/components/query-error-state";
import { staggerContainer, staggerItem } from "@/lib/animations";
import { useDocumentTitle } from "@/hooks/use-document-title";
import {
  Database,
  ExternalLink,
  ArrowLeft,
  CheckCircle2,
  Calculator,
  CircleDashed,
  Sparkles,
} from "lucide-react";
import { Link } from "wouter";
import { formatDate } from "@/lib/format";

type Classification = "authoritative" | "estimate" | "modeled" | "unknown";

interface DataSource {
  source: string;
  authoritativeFor: string;
  cadence: string;
  license: string;
  licenseLabel: string;
  redistributable: string;
  redistributableLabel: string;
  attributionText?: string;
  termsUrl?: string;
  lastReviewed: string;
  kind: "open" | "paid";
}

interface ClassificationLegendItem {
  id: Classification;
  label: string;
  meaning: string;
}

interface AttributionLine {
  source: string;
  text: string;
}

interface DataSourcesResponse {
  sources: DataSource[];
  classifications: ClassificationLegendItem[];
  attributions: AttributionLine[];
  lastUpdated: string;
}

const LEGEND_ICON: Record<Classification, typeof CheckCircle2> = {
  authoritative: CheckCircle2,
  estimate: Calculator,
  modeled: Sparkles,
  unknown: CircleDashed,
};

/** Slug a source name into a stable anchor id for the per-datum "i" deep-link. */
function sourceAnchor(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

export default function DataSourcesPage() {
  useDocumentTitle("How AcreOS sources data");

  const { data, isLoading, isError, error, refetch, isFetching } =
    useQuery<DataSourcesResponse>({
      queryKey: ["/api/trust/data-sources"],
    });

  return (
    <PageShell label="How AcreOS sources data">
      <div className="mb-6">
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="mb-4 -ml-2 text-muted-foreground"
        >
          <Link href="/settings">
            <ArrowLeft className="w-4 h-4 mr-1" aria-hidden="true" />
            Back to settings
          </Link>
        </Button>
        <div className="flex items-start gap-3">
          <span
            className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary shrink-0"
            aria-hidden="true"
          >
            <Database className="w-5 h-5" />
          </span>
          <div>
            <h1 className="text-hero">How AcreOS sources data</h1>
            <p className="text-muted-foreground mt-1 max-w-2xl">
              Every number in AcreOS carries a named source, a license, and a
              freshness story. County and federal records are systems of record —
              the same files a paid aggregator resells. When a value is an
              estimate or a model score, AcreOS labels it that way, and when a
              value has not been pulled yet, you see a blank, never a guess.
            </p>
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-4" data-testid="data-sources-loading">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : isError ? (
        <QueryErrorState
          error={error as Error}
          onRetry={() => refetch()}
          isRetrying={isFetching}
          title="Couldn't load the data-sources list"
          description="AcreOS couldn't reach the sourcing register. Try again — your data is unaffected."
          testId="data-sources-error"
        />
      ) : data ? (
        <div className="space-y-8">
          {/* ── Legend: what each label on a number means ─────────────── */}
          <section id="legend" aria-labelledby="legend-heading">
            <Card>
              <CardHeader>
                <CardTitle id="legend-heading">What the labels mean</CardTitle>
                <CardDescription>
                  Every value in AcreOS is one of these. The label travels with
                  the number wherever it appears.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <motion.dl
                  variants={staggerContainer}
                  initial="hidden"
                  animate="visible"
                  className="grid gap-4 sm:grid-cols-2"
                >
                  {data.classifications.map((item) => {
                    const Icon = LEGEND_ICON[item.id];
                    return (
                      <motion.div
                        key={item.id}
                        variants={staggerItem}
                        className="rounded-lg border bg-card p-4"
                        data-testid={`legend-${item.id}`}
                      >
                        <dt className="flex items-center gap-2 font-semibold">
                          <Icon
                            className="w-4 h-4 text-primary shrink-0"
                            aria-hidden="true"
                          />
                          {item.label}
                        </dt>
                        <dd className="text-sm text-muted-foreground mt-1">
                          {item.meaning}
                        </dd>
                      </motion.div>
                    );
                  })}
                </motion.dl>
              </CardContent>
            </Card>
          </section>

          {/* ── Sources: open data first, then paid ───────────────────── */}
          <section aria-labelledby="sources-heading">
            <h2 id="sources-heading" className="text-section-h2 mb-1">
              The sources
            </h2>
            <p className="text-muted-foreground text-sm mb-4">
              Open public records first — these are free, authoritative, and
              shareable. Paid sources fill coverage gaps and are only used when
              you ask for them.
            </p>
            <motion.div
              variants={staggerContainer}
              initial="hidden"
              animate="visible"
              className="space-y-4"
            >
              {data.sources.map((s) => (
                <motion.div key={s.source} variants={staggerItem}>
                  <Card id={sourceAnchor(s.source)} className="scroll-mt-24">
                    <CardHeader className="pb-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <CardTitle className="text-base">{s.source}</CardTitle>
                        <Badge
                          variant={s.kind === "open" ? "secondary" : "outline"}
                        >
                          {s.kind === "open" ? "Open data" : "Paid source"}
                        </Badge>
                      </div>
                      <CardDescription>{s.authoritativeFor}</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 text-sm">
                        <div>
                          <dt className="text-muted-foreground">
                            How often it updates
                          </dt>
                          <dd className="mt-0.5">{s.cadence}</dd>
                        </div>
                        <div>
                          <dt className="text-muted-foreground">License</dt>
                          <dd className="mt-0.5">{s.licenseLabel}</dd>
                        </div>
                        <div>
                          <dt className="text-muted-foreground">Use and sharing</dt>
                          <dd className="mt-0.5">{s.redistributableLabel}</dd>
                        </div>
                        <div>
                          <dt className="text-muted-foreground">Terms reviewed</dt>
                          <dd className="mt-0.5">{s.lastReviewed}</dd>
                        </div>
                        {s.attributionText ? (
                          <div className="sm:col-span-2">
                            <dt className="text-muted-foreground">Attribution</dt>
                            <dd className="mt-0.5">{s.attributionText}</dd>
                          </div>
                        ) : null}
                      </dl>
                      {s.termsUrl ? (
                        <Button
                          asChild
                          variant="ghost"
                          size="sm"
                          className="mt-3 -ml-2"
                        >
                          <a
                            href={s.termsUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            View source terms
                            <ExternalLink
                              className="w-3.5 h-3.5 ml-1.5"
                              aria-hidden="true"
                            />
                          </a>
                        </Button>
                      ) : null}
                    </CardContent>
                  </Card>
                </motion.div>
              ))}
            </motion.div>
          </section>

          {/* ── Required attributions (OSM ODbL + others) ─────────────── */}
          {data.attributions.length > 0 ? (
            <section aria-labelledby="attribution-heading">
              <Card>
                <CardHeader>
                  <CardTitle id="attribution-heading">Attributions</CardTitle>
                  <CardDescription>
                    Some sources require credit wherever their data appears. We
                    carry these lines throughout the product and list them here.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-1.5 text-sm">
                    {data.attributions.map((a) => (
                      <li
                        key={a.source}
                        className="text-muted-foreground"
                        data-testid={`attribution-${sourceAnchor(a.source)}`}
                      >
                        {a.text}
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            </section>
          ) : null}

          <p className="text-xs text-muted-foreground">
            Last updated {formatDate(data.lastUpdated)}.
          </p>
        </div>
      ) : null}
    </PageShell>
  );
}
