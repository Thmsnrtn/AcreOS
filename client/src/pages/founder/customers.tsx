/**
 * /founder/customers — the third of the five founder doors (Phase 5 of the
 * Solene migration).
 *
 * Rewritten 2026-06-04 from the original Wave 3 distribution table into the
 * 5-door aesthetic: lean funnel + recent signups + Phase 0 banner for the
 * Rafe-era customer-health surface. The qualitative narrative still lives in
 * customers.md at the repo root; this page is the one-screen scannable
 * companion.
 *
 * Data source (unchanged from the previous version):
 *   GET /api/founder/customers → {
 *     asOf, paidOrgCount, trialOrgCount, churnedLast30d,
 *     topUtmSources, recentSignups,
 *   }
 *
 * The deeper customer-health surface (per-org churn risk, expansion signal,
 * Pax interaction quality) ships with Rafe in Phase 2 — this page surfaces
 * a banner pointing there.
 *
 * Krieger-bar A11y discipline mirrors today.tsx / team.tsx / money.tsx /
 * build.tsx — design tokens only, aria-busy on loading, aria-live on async
 * sections, ≥44×44 touch targets.
 */

import React from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Users,
  TrendingUp,
  Heart,
  Sparkles,
  ArrowRight,
  Info,
  AlertTriangle,
  Compass,
  Scale,
  LifeBuoy,
} from "lucide-react";

import { PageShell } from "@/components/page-shell";
import { formatRelative } from "@/lib/format";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/empty-state";
import { QueryErrorState } from "@/components/query-error-state";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { PrefetchLink as Link } from "@/components/prefetch-link";
import { Button } from "@/components/ui/button";

// ─── API contract — unchanged from the previous customers page ──────────

interface UtmSourceRow {
  source: string;
  count: number;
}

interface RecentSignupRow {
  orgName: string;
  persona: string;
  createdAt: string;
  utmSource: string | null;
  city: string | null;
  state: string | null;
}

interface CustomersResponse {
  asOf: string;
  paidOrgCount: number;
  trialOrgCount: number;
  churnedLast30d: number;
  topUtmSources: UtmSourceRow[];
  recentSignups: RecentSignupRow[];
}

// ─── Helpers ────────────────────────────────────────────────────────────

function fmtRegion(city: string | null, state: string | null): string {
  const parts = [city, state].filter((v): v is string => !!v && v.length > 0);
  return parts.length > 0 ? parts.join(", ") : "—";
}

// ─── Phase 0 banner ──────────────────────────────────────────────────────

function RafePhase0Banner() {
  return (
    <Card
      className="border-primary/30 bg-primary/5"
      data-testid="customers-rafe-banner"
    >
      <CardContent className="p-4 md:p-5">
        <div className="flex items-start gap-3">
          <div className="rounded-card bg-primary/10 p-2 shrink-0">
            <Info className="h-5 w-5 text-primary" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-foreground">
              Rafe (CCO) activates in Phase 2
            </h2>
            <p className="mt-1 text-sm text-muted-foreground leading-relaxed">
              Churn predictions, expansion-signal scoring, and per-org customer
              health land when Rafe comes online (Phase 2: $1k MRR sustained
              30 days). Until then, this surface is the funnel + signups, with
              the customer-health workbench reachable for spot checks.
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Funnel strip ───────────────────────────────────────────────────────

function FunnelTile({
  label,
  value,
  icon: Icon,
  tone,
  testId,
}: {
  label: string;
  value: number;
  icon: React.ComponentType<{ className?: string }>;
  tone: "ok" | "brand" | "warn";
  testId: string;
}) {
  const iconTone =
    tone === "warn"
      ? "text-acr-warn"
      : tone === "ok"
        ? "text-acr-ok"
        : "text-acr-brand";
  return (
    <Card data-testid={testId}>
      <CardContent className="p-3 md:p-4">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">
            {label}
          </span>
          <Icon className={`h-4 w-4 ${iconTone}`} aria-hidden="true" />
        </div>
        <div
          className="text-2xl font-semibold tabular-nums text-foreground"
          data-testid={`${testId}-value`}
        >
          {value.toLocaleString()}
        </div>
      </CardContent>
    </Card>
  );
}

function FunnelStrip({
  data,
  isLoading,
}: {
  data: CustomersResponse | null;
  isLoading: boolean;
}) {
  if (isLoading || !data) {
    return (
      <div className="grid gap-3 md:gap-4 grid-cols-1 sm:grid-cols-3" aria-busy>
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="p-3 md:p-4 space-y-2">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-8 w-16" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }
  return (
    <div className="grid gap-3 md:gap-4 grid-cols-1 sm:grid-cols-3">
      <FunnelTile
        label="Paying orgs"
        value={data.paidOrgCount}
        icon={Users}
        tone="ok"
        testId="customers-funnel-paid"
      />
      <FunnelTile
        label="New (14d, not paying)"
        value={data.trialOrgCount}
        icon={Compass}
        tone="brand"
        testId="customers-funnel-trial"
      />
      <FunnelTile
        label="Churned (last 30d)"
        value={data.churnedLast30d}
        icon={AlertTriangle}
        tone="warn"
        testId="customers-funnel-churn"
      />
    </div>
  );
}

// ─── Recent signups ─────────────────────────────────────────────────────

function RecentSignupsSection({
  data,
  isLoading,
}: {
  data: CustomersResponse | null;
  isLoading: boolean;
}) {
  const signups = (data?.recentSignups ?? []).slice(0, 5);

  return (
    <Card aria-busy={isLoading} data-testid="customers-recent-section">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Users className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          Most-recent signups
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {isLoading ? (
          <div className="space-y-2" aria-label="Loading signups">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : signups.length === 0 ? (
          <EmptyState
            icon={Users}
            headline="No signups yet"
            subtitle="The first organization to sign up will appear here."
            // TODO(cta): signups arrive via the landing-page flow — no founder action here
            cta={{ label: "", _noOp: true }}
            actionIcon={null}
            testId="customers-recent-empty"
          />
        ) : (
          <ul className="space-y-2" aria-live="polite">
            {signups.map((row, idx) => (
              <li
                key={`${row.orgName}-${row.createdAt}-${idx}`}
                className="flex items-start gap-3 rounded-md border border-border bg-card p-3"
              >
                {/* A null/"unknown" persona is rendered neutrally — never
                    dressed up as a confirmed persona. */}
                <Badge
                  variant="outline"
                  className={`text-xs shrink-0 ${
                    row.persona === "unknown"
                      ? "text-muted-foreground italic"
                      : "capitalize"
                  }`}
                >
                  {row.persona === "unknown"
                    ? "unknown"
                    : row.persona.replace(/_/g, " ")}
                </Badge>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-foreground truncate">
                    {row.orgName}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {fmtRegion(row.city, row.state)} ·{" "}
                    {row.utmSource ? `via ${row.utmSource}` : "direct"} ·{" "}
                    {formatRelative(row.createdAt)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Top UTM sources (compact) ───────────────────────────────────────────

function TopUtmSection({
  data,
  isLoading,
}: {
  data: CustomersResponse | null;
  isLoading: boolean;
}) {
  const sources = (data?.topUtmSources ?? []).slice(0, 5);

  return (
    <Card aria-busy={isLoading} data-testid="customers-utm-section">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <TrendingUp
            className="h-4 w-4 text-muted-foreground"
            aria-hidden="true"
          />
          Where they came from
          <span className="text-xs font-normal text-muted-foreground">
            (last 90d)
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {isLoading ? (
          <div className="space-y-2" aria-label="Loading UTM sources">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : sources.length === 0 ? (
          <EmptyState
            icon={TrendingUp}
            headline="No UTM data yet"
            subtitle="Tag campaign URLs with utm_source so this page can tell you what's working."
            cta={{
              label: "Manage campaigns",
              href: "/founder/growth/campaigns",
              "data-testid": "customers-utm-cta",
            }}
            actionIcon={null}
            testId="customers-utm-empty"
          />
        ) : (
          <ul className="space-y-1.5" aria-live="polite">
            {sources.map((row) => (
              <li
                key={row.source}
                className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 hover:bg-muted/40 transition-colors"
              >
                <span className="text-sm text-foreground truncate">
                  {row.source}
                </span>
                <Badge variant="secondary" className="text-xs tabular-nums shrink-0">
                  {row.count.toLocaleString()}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────

export default function FounderCustomersPage() {
  useDocumentTitle("Customers · Founder");

  const { data, isLoading, error, refetch } = useQuery<CustomersResponse>({
    queryKey: ["/api/founder/customers"],
    queryFn: async () => {
      const r = await fetch("/api/founder/customers", {
        credentials: "include",
      });
      if (!r.ok) throw new Error(`Failed to load customers (${r.status})`);
      return r.json();
    },
    staleTime: 60_000,
  });

  return (
    <PageShell maxWidth="5xl" label="Founder customers">
      <div className="space-y-4 md:space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-foreground">
            Customers
          </h1>
          <p className="text-sm text-muted-foreground">
            Funnel, recent signups, and acquisition sources. Deeper health
            scoring lands with Rafe in Phase 2.
          </p>
        </header>

        {error ? (
          <QueryErrorState
            error={error as Error}
            onRetry={() => refetch()}
            title="Couldn't load customers"
            description="The customer snapshot didn't come back. Try again."
            testId="founder-customers-error"
          />
        ) : null}

        <RafePhase0Banner />

        <FunnelStrip data={data ?? null} isLoading={isLoading} />

        <div className="grid gap-4 md:gap-6 md:grid-cols-2">
          <RecentSignupsSection data={data ?? null} isLoading={isLoading} />
          <TopUtmSection data={data ?? null} isLoading={isLoading} />
        </div>

        {/* Deep-dive shortcut — customer-health workbench is already shipped. */}
        <Card
          className="border-acr-warn/30 bg-acr-warn/5"
          data-testid="customers-health-shortcut"
        >
          <CardContent className="p-4 md:p-5 flex items-start gap-3">
            <div className="rounded-card bg-acr-warn/10 p-2 shrink-0">
              <Heart className="h-5 w-5 text-acr-warn" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-semibold text-foreground">
                Spot-check customer health
              </h2>
              <p className="mt-1 text-sm text-muted-foreground leading-relaxed">
                The interim health workbench is up — useful for a one-off
                review until Rafe's automated scoring lands.
              </p>
              <Button asChild className="mt-3" size="sm" variant="outline">
                <Link
                  href="/founder/customers/health"
                  aria-label="Open customer health workbench"
                  data-testid="link-customers-health"
                >
                  Open health workbench
                  <ArrowRight className="ml-1 h-3 w-3" aria-hidden="true" />
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Door → live deep-data surfaces. The funnel above is the scannable
            top; per-org health, the recourse heartbeat, and the customer
            appeals queue each have their own founder route with live data. */}
        <Card data-testid="customers-deeper-links">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Go deeper</CardTitle>
          </CardHeader>
          <CardContent className="pt-0 grid gap-3 sm:grid-cols-3">
            <Button
              asChild
              variant="outline"
              className="h-auto justify-start py-3"
            >
              <Link
                href="/founder/customers/health"
                aria-label="Open the customer health workbench"
                data-testid="link-customers-deep-health"
              >
                <Heart
                  className="mr-2 h-4 w-4 text-muted-foreground shrink-0"
                  aria-hidden="true"
                />
                <span className="min-w-0 text-left">
                  <span className="block text-sm font-medium text-foreground">
                    Health workbench
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    Per-org churn risk + signal.
                  </span>
                </span>
              </Link>
            </Button>
            <Button
              asChild
              variant="outline"
              className="h-auto justify-start py-3"
            >
              <Link
                href="/founder/recourse"
                aria-label="Open the customer recourse surface"
                data-testid="link-customers-deep-recourse"
              >
                <LifeBuoy
                  className="mr-2 h-4 w-4 text-muted-foreground shrink-0"
                  aria-hidden="true"
                />
                <span className="min-w-0 text-left">
                  <span className="block text-sm font-medium text-foreground">
                    Recourse
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    Customer-recourse heartbeat.
                  </span>
                </span>
              </Link>
            </Button>
            <Button
              asChild
              variant="outline"
              className="h-auto justify-start py-3"
            >
              <Link
                href="/founder/appeals"
                aria-label="Open the customer appeals queue"
                data-testid="link-customers-deep-appeals"
              >
                <Scale
                  className="mr-2 h-4 w-4 text-muted-foreground shrink-0"
                  aria-hidden="true"
                />
                <span className="min-w-0 text-left">
                  <span className="block text-sm font-medium text-foreground">
                    Appeals
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    Customer appeals queue.
                  </span>
                </span>
              </Link>
            </Button>
          </CardContent>
        </Card>

        <div className="pt-2 text-center">
          <Link
            href="/founder/solene-chat"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            data-testid="link-ask-solene-customers"
          >
            <Sparkles className="h-3 w-3" aria-hidden="true" />
            Ask Solene about customers
            <ArrowRight className="h-3 w-3" aria-hidden="true" />
          </Link>
        </div>
      </div>
    </PageShell>
  );
}
