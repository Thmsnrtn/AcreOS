/**
 * Transparency Report — public accountability surface at /transparency.
 *
 * Quinn (Chief of Alignment) idea #4 + Beatrice (CRO) idea #3. The nightly
 * aggregator produces real `transparency_reports` rows; this page renders the
 * latest PUBLISHED one. It is reachable two ways:
 *   - publicly at /transparency (top-of-funnel trust artifact, no login), and
 *   - from Settings for a logged-in customer.
 * It is NOT a new customer door — it respects the five-door nav model.
 *
 * What it shows for the latest published period: refusals broken out by the
 * customer immutable each refusal cited, appeal outcomes (upheld / reversed),
 * founder-bypass count, constitutional-drift findings, and the honest
 * fairness status (which carries `notMeasurableReason` when we cannot compute
 * a fairness signal — we render that reason rather than imply a clean audit
 * we never ran). Every number is stamped with the immutables.json version and
 * SHA-256 it was computed against, so a regulator can re-derive the window.
 *
 * Reads the public /transparency endpoint via the default query fetcher.
 */
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Link } from "wouter";
import {
  ArrowLeft,
  ScrollText,
  ShieldX,
  Scale,
  KeyRound,
  Activity,
  Users,
} from "lucide-react";
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
import { EmptyState } from "@/components/empty-state";
import { QueryErrorState } from "@/components/query-error-state";
import { AcreosLogo } from "@/components/acreos-logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { SkipToContent } from "@/components/skip-to-content";
import { PublicFooter } from "@/components/public-footer";
import { usePageMeta } from "@/hooks/use-document-title";
import { staggerContainer, staggerItem } from "@/lib/animations";

// ---------------------------------------------------------------------------
// Response shape — mirrors PublishedTransparencyReportShape on the server.
// ---------------------------------------------------------------------------
interface ImmutablesStamp {
  version: string;
  sha256: string | null;
}

interface PublishedReport {
  periodStart: string;
  periodEnd: string;
  publishedAt: string;
  refusalCount: number;
  refusalByImmutable: Record<string, number>;
  appealCount: number;
  appealsUpheldCount: number;
  appealsReversedCount: number;
  founderBypassCount: number;
  demographicBiasFindings: {
    findings: unknown[];
    reviewedAt: string | null;
    notMeasurableReason: string | null;
  };
  driftFindings: Record<string, unknown>;
}

interface TransparencyResponse {
  status: "published" | "no_report_yet";
  report?: PublishedReport;
  immutables: ImmutablesStamp;
  contact?: string;
}

// ---------------------------------------------------------------------------
// Plain-language labels for the customer immutables a refusal can cite. The
// report keys arrive as "customer:N"; we surface a short, readable label so a
// reader never has to cross-reference the constitution to follow the number.
// ---------------------------------------------------------------------------
const IMMUTABLE_LABELS: Record<string, string> = {
  "customer:1": "No fabricated facts or figures",
  "customer:2": "Surface uncertainty, never hide it",
  "customer:3": "No protected-class data collected",
  "customer:4": "Your data stays yours",
  "customer:5": "No dark patterns",
  "customer:6": "Honest pricing, no hidden fees",
  "customer:7": "Always disclose AI use clearly",
  "customer:8": "No regulated advice as fact",
  "customer:9": "Respect a stated decision to stop",
  "customer:10": "Accurate provenance on every datum",
  "customer:11": "No coercive urgency",
  "customer:12": "A tool, never a fiduciary advisor",
};

function immutableLabel(key: string): string {
  return IMMUTABLE_LABELS[key] ?? key;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

// ---------------------------------------------------------------------------
// Drift findings — the jsonb is keyed by detector id; each value carries a
// findingCount and a scope. We render a compact per-detector summary.
// ---------------------------------------------------------------------------
interface DriftDetectorSummary {
  scope?: string;
  findingCount?: number;
  error?: string;
}

function driftEntries(
  drift: Record<string, unknown>,
): Array<{ id: string; summary: DriftDetectorSummary }> {
  return Object.entries(drift).map(([id, value]) => ({
    id,
    summary:
      value && typeof value === "object"
        ? (value as DriftDetectorSummary)
        : {},
  }));
}

// ---------------------------------------------------------------------------
// Layout chrome — public top nav + footer, shared with /security and
// /privacy. Works whether the visitor is logged in or not.
// ---------------------------------------------------------------------------
function TransparencyChrome({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <SkipToContent />
      <nav className="border-b bg-surface-chrome backdrop-blur sticky top-0 z-floating">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link
            href="/"
            className="flex items-center gap-2 hover:opacity-80 transition-opacity min-h-11 py-1"
            aria-label="Back to AcreOS home"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            <AcreosLogo size={30} />
          </Link>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Button asChild variant="outline">
              <Link href="/security" className="min-h-11">
                Security
              </Link>
            </Button>
          </div>
        </div>
      </nav>
      <main
        id="main-content"
        className="max-w-4xl mx-auto px-6 py-12 md:py-16 space-y-10"
      >
        {children}
      </main>
      <PublicFooter />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Header + methodology note — rendered above every state.
// ---------------------------------------------------------------------------
function TransparencyHeader() {
  return (
    <header className="space-y-4">
      <div className="flex items-center gap-3">
        <ScrollText className="h-8 w-8 text-primary" aria-hidden="true" />
        <h1 className="text-3xl md:text-4xl font-bold">Transparency Report</h1>
      </div>
      <p className="text-muted-foreground max-w-2xl leading-relaxed">
        AcreOS holds Pax — the AI surface Land Investors talk to — to a written
        set of customer immutables. This report publishes how those rules play
        out in practice each period: when Pax declined a request and which rule
        it cited, how appeals were resolved, how often a founder override was
        used, and what our drift and fairness checks found.
      </p>
      <div className="rounded-lg border bg-muted/40 p-4 text-sm leading-relaxed text-muted-foreground space-y-2">
        <p>
          <span className="font-medium text-foreground">How to read this.</span>{" "}
          The numbers are aggregated over a rolling window by a nightly job, then
          published as a fixed snapshot — the same window math a regulator could
          re-derive. We publish the period even when the numbers are
          unflattering.
        </p>
        <p>
          Fairness is measured across the axes our data permits. AcreOS does not
          collect protected-class data, so when a fairness signal cannot be
          computed the report says so plainly rather than imply a clean audit it
          never ran.
        </p>
      </div>
    </header>
  );
}

// ---------------------------------------------------------------------------
// Loading skeleton — matches the metric-grid + cards shape.
// ---------------------------------------------------------------------------
function TransparencySkeleton() {
  return (
    <div className="space-y-8" data-testid="transparency-loading">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[0, 1, 2, 3].map((i) => (
          <Card key={i}>
            <CardHeader className="pb-2">
              <Skeleton className="h-4 w-24" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-8 w-16" />
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-48" />
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-2/3" />
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Metric tile.
// ---------------------------------------------------------------------------
function MetricTile({
  icon: Icon,
  label,
  value,
  testId,
}: {
  icon: typeof ShieldX;
  label: string;
  value: number;
  testId: string;
}) {
  return (
    <motion.div variants={staggerItem}>
      <Card data-testid={testId}>
        <CardHeader className="pb-2">
          <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-2">
            <Icon className="h-4 w-4" aria-hidden="true" />
            {label}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-bold tabular-nums">{value}</p>
        </CardContent>
      </Card>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Published report body.
// ---------------------------------------------------------------------------
function PublishedReportView({
  report,
  immutables,
}: {
  report: PublishedReport;
  immutables: ImmutablesStamp;
}) {
  const refusalRows = Object.entries(report.refusalByImmutable).sort(
    (a, b) => b[1] - a[1],
  );
  const drift = driftEntries(report.driftFindings);
  const bias = report.demographicBiasFindings;

  return (
    <motion.div
      variants={staggerContainer}
      initial="hidden"
      animate="visible"
      className="space-y-8"
    >
      {/* Period + stamp */}
      <motion.div variants={staggerItem}>
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <Badge variant="secondary" data-testid="transparency-period">
            {formatDate(report.periodStart)} – {formatDate(report.periodEnd)}
          </Badge>
          <span>Published {formatDate(report.publishedAt)}</span>
        </div>
      </motion.div>

      {/* Headline metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricTile
          icon={ShieldX}
          label="Refusals"
          value={report.refusalCount}
          testId="metric-refusals"
        />
        <MetricTile
          icon={Scale}
          label="Appeals filed"
          value={report.appealCount}
          testId="metric-appeals"
        />
        <MetricTile
          icon={Activity}
          label="Appeals reversed"
          value={report.appealsReversedCount}
          testId="metric-appeals-reversed"
        />
        <MetricTile
          icon={KeyRound}
          label="Founder overrides"
          value={report.founderBypassCount}
          testId="metric-founder-overrides"
        />
      </div>

      {/* Refusals by immutable */}
      <motion.div variants={staggerItem}>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldX className="h-5 w-5 text-primary" aria-hidden="true" />
              Refusals by rule
            </CardTitle>
            <CardDescription>
              Each time Pax declined a request, it cited the customer immutable
              that applied. This is the breakdown for the period.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {refusalRows.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No refusals were recorded in this period.
              </p>
            ) : (
              <ul className="divide-y" data-testid="refusals-by-immutable">
                {refusalRows.map(([key, count]) => (
                  <li
                    key={key}
                    className="flex items-center justify-between gap-4 py-2 text-sm"
                  >
                    <span className="text-foreground">
                      {immutableLabel(key)}
                      <span className="ml-2 font-mono text-xs text-muted-foreground">
                        {key}
                      </span>
                    </span>
                    <span className="font-semibold tabular-nums">{count}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </motion.div>

      {/* Appeals outcomes */}
      <motion.div variants={staggerItem}>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Scale className="h-5 w-5 text-primary" aria-hidden="true" />
              Appeal outcomes
            </CardTitle>
            <CardDescription>
              When Pax declines, a customer can appeal. Each appeal is reviewed
              and the outcome is recorded here.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-3 gap-4 text-sm">
              <div>
                <dt className="text-muted-foreground">Filed</dt>
                <dd className="text-lg font-semibold tabular-nums">
                  {report.appealCount}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Upheld</dt>
                <dd className="text-lg font-semibold tabular-nums">
                  {report.appealsUpheldCount}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Reversed</dt>
                <dd className="text-lg font-semibold tabular-nums">
                  {report.appealsReversedCount}
                </dd>
              </div>
            </dl>
            <p className="mt-3 text-xs text-muted-foreground">
              Upheld means the original refusal stood after review. Reversed
              means the review changed the outcome in the customer's favor.
            </p>
          </CardContent>
        </Card>
      </motion.div>

      {/* Fairness status — honest about measurability */}
      <motion.div variants={staggerItem}>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Users className="h-5 w-5 text-primary" aria-hidden="true" />
              Fairness status
            </CardTitle>
            <CardDescription>
              Measured across the axes our data permits — AcreOS does not collect
              protected-class data.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm leading-relaxed">
            {bias.notMeasurableReason ? (
              <div
                className="rounded-md border bg-muted/40 p-3 text-muted-foreground"
                data-testid="fairness-not-measurable"
              >
                <span className="font-medium text-foreground">
                  Not yet measurable.
                </span>{" "}
                {bias.notMeasurableReason}
              </div>
            ) : bias.findings.length === 0 ? (
              <p className="text-muted-foreground" data-testid="fairness-no-findings">
                The fairness check ran for this period and surfaced no findings
                {bias.reviewedAt
                  ? ` (reviewed ${formatDate(bias.reviewedAt)}).`
                  : "."}
              </p>
            ) : (
              <p className="text-foreground" data-testid="fairness-findings">
                {bias.findings.length} fairness finding
                {bias.findings.length === 1 ? "" : "s"} were recorded for this
                period.
              </p>
            )}
          </CardContent>
        </Card>
      </motion.div>

      {/* Drift findings */}
      <motion.div variants={staggerItem}>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Activity className="h-5 w-5 text-primary" aria-hidden="true" />
              Constitutional-drift checks
            </CardTitle>
            <CardDescription>
              Automated detectors watch for the enforcement gradually loosening.
              Each ran over the period; this is what they found.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {drift.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No drift detectors reported for this period.
              </p>
            ) : (
              <ul className="divide-y" data-testid="drift-findings">
                {drift.map(({ id, summary }) => (
                  <li
                    key={id}
                    className="flex items-center justify-between gap-4 py-2 text-sm"
                  >
                    <span className="font-mono text-xs text-muted-foreground">
                      {id}
                    </span>
                    {summary.error ? (
                      <Badge variant="outline">check unavailable</Badge>
                    ) : (
                      <span className="font-semibold tabular-nums">
                        {summary.findingCount ?? 0} finding
                        {(summary.findingCount ?? 0) === 1 ? "" : "s"}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </motion.div>

      {/* Reproducibility stamp */}
      <motion.div variants={staggerItem}>
        <div
          className="rounded-lg border bg-muted/30 p-4 text-xs text-muted-foreground space-y-1"
          data-testid="immutables-stamp"
        >
          <p className="font-medium text-foreground">Computed against</p>
          <p>
            Constitution version{" "}
            <span className="font-mono">{immutables.version}</span>
            {immutables.sha256 ? (
              <>
                {" · SHA-256 "}
                <span className="font-mono break-all">
                  {immutables.sha256}
                </span>
              </>
            ) : null}
          </p>
          <p>
            The immutables list this period was scored against is pinned by hash
            in our build, so a published period stays re-derivable after any
            later amendment.
          </p>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Page.
// ---------------------------------------------------------------------------
export default function TransparencyPage() {
  usePageMeta(
    "Transparency Report",
    "How AcreOS's AI rules play out in practice — refusals by rule, appeal outcomes, founder overrides, and drift and fairness checks, published each period.",
  );

  const { data, isLoading, isError, error, refetch, isFetching } =
    useQuery<TransparencyResponse>({
      queryKey: ["/transparency"],
    });

  return (
    <TransparencyChrome>
      <TransparencyHeader />

      {isLoading ? (
        <TransparencySkeleton />
      ) : isError ? (
        <QueryErrorState
          error={error as Error}
          onRetry={() => refetch()}
          isRetrying={isFetching}
          title="Couldn't load the transparency report"
          description="The report data didn't load. Try again, or reload the page if this keeps happening."
        />
      ) : data?.status === "published" && data.report ? (
        <PublishedReportView report={data.report} immutables={data.immutables} />
      ) : (
        <EmptyState
          icon={ScrollText}
          headline="No published report yet"
          subtitle="The first transparency period will appear here once it's published. In the meantime, you can read how AcreOS secures and sources data."
          cta={{
            label: "View security posture",
            href: "/security",
            "data-testid": "transparency-empty-cta",
          }}
          secondaryCta={{
            label: "How AcreOS sources data",
            href: "/data-sources",
          }}
        />
      )}
    </TransparencyChrome>
  );
}
