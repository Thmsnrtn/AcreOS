/**
 * /p/:state/:county/:apn — public, no-auth parcel report permalink.
 *
 * Tier 3A (elevation blueprint): a saved, shareable report built from
 * free/government data only — county records plus FEMA flood, USDA soil,
 * USGS elevation, and USFWS wetlands — topped with the honest PARTIAL Land
 * Credit Score. The partial framing IS the product: dimensions that need
 * data only available inside AcreOS render LOCKED with the missing
 * sub-factors named, never a guessed value.
 *
 * The server pre-injects real head meta (title/og/canonical/OG image) for
 * crawlers; this component renders the same facts for humans and upserts
 * client-side meta for SPA navigation. Generation happens through the
 * JSON API below (rate-limited + daily-capped); the permalink row is the
 * cache, so a popular report is one DB read.
 */
import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Check, Landmark, Lock, MapPin, Share2 } from "lucide-react";
import { usePageMeta } from "@/hooks/use-document-title";
import { OpenGraph } from "@/components/seo/OpenGraph";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { QueryErrorState } from "@/components/query-error-state";
import { DataProvenanceChip } from "@/components/data-provenance-chip";
import { emitMarketingTouch, getAnonymousId } from "@/lib/marketing-touch";
import { capturePendingParcel } from "@/lib/acquisition-utm";
import { trackEvent } from "@/lib/analytics";
import type { PublicLcs, PublicReportFacts } from "@shared/schema";
import { formatDate } from "@/lib/format";

// ─── API shapes (mirror server/routes-public-parcel-report.ts) ──────────────

interface ReportDto {
  id: number;
  state: string;
  countySlug: string;
  countyLabel: string;
  apn: string;
  facts: PublicReportFacts;
  lcs: PublicLcs;
  viewCount: number;
  createdAt: string | null;
  refreshedAt: string | null;
}

type ReportResponse =
  | { found: true; generated: boolean; path: string; report: ReportDto }
  | { found: false; reason: "no_free_source" | "daily_capacity"; message: string };

async function fetchReport(
  state: string,
  county: string,
  apn: string,
  sid: string,
): Promise<ReportResponse> {
  const res = await fetch(
    `/api/public/parcel-report/${encodeURIComponent(state)}/${encodeURIComponent(
      county,
    )}/${encodeURIComponent(apn)}?sid=${encodeURIComponent(sid)}`,
  );
  if (res.status === 429) {
    // Daily capacity / rate limit — render as an honest state, not a crash.
    let message =
      "Requests are coming in faster than this free surface allows. Wait a moment and reload.";
    try {
      const body = await res.json();
      const detailMsg = body?.details?.message;
      if (typeof detailMsg === "string") message = detailMsg;
    } catch {
      /* keep default */
    }
    return { found: false, reason: "daily_capacity", message };
  }
  if (!res.ok) {
    throw new Error(`Report request failed (${res.status})`);
  }
  return (await res.json()) as ReportResponse;
}

// ─── Fact tile metadata (same vocabulary as /tools/parcel-check) ────────────

const CATEGORY_META: Record<string, { label: string; blurb: string }> = {
  flood_zone: { label: "FEMA flood zone", blurb: "National Flood Hazard Layer" },
  soil: { label: "USDA soil", blurb: "SSURGO survey" },
  elevation: { label: "USGS elevation", blurb: "3DEP / National Map" },
  wetlands: { label: "USFWS wetlands", blurb: "National Wetlands Inventory" },
};

function summarizeCategory(
  category: string,
  data: unknown,
): { headline: string; detail: string | null } | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  switch (category) {
    case "flood_zone": {
      const zone = typeof d.zone === "string" ? d.zone : null;
      const risk = typeof d.riskLevel === "string" ? d.riskLevel : null;
      if (!zone) return null;
      return {
        headline: zone,
        detail: risk ? `${risk[0].toUpperCase()}${risk.slice(1)} risk` : null,
      };
    }
    case "soil": {
      const soil = typeof d.soilType === "string" ? d.soilType : null;
      const cap = typeof d.capabilityClass === "string" ? d.capabilityClass : null;
      const drainage = typeof d.drainage === "string" ? d.drainage : null;
      if (!soil || soil === "Unknown") return null;
      const bits = [
        cap ? `Capability class ${cap}` : null,
        drainage && drainage !== "Unknown" ? `${drainage} drainage` : null,
      ].filter(Boolean);
      return { headline: soil, detail: bits.length ? bits.join(" · ") : null };
    }
    case "elevation": {
      const ft = typeof d.elevationFeet === "number" ? d.elevationFeet : null;
      if (ft === null) return null;
      const datum = typeof d.datum === "string" ? d.datum : null;
      return { headline: `${ft.toLocaleString()} ft`, detail: datum ? `Datum ${datum}` : null };
    }
    case "wetlands": {
      const has = typeof d.hasWetlands === "boolean" ? d.hasWetlands : null;
      if (has === null) return null;
      const cls = typeof d.classification === "string" ? d.classification : null;
      return {
        headline: has ? "Wetlands present" : "No mapped wetlands",
        detail: has && cls ? cls : null,
      };
    }
    default:
      return null;
  }
}

const ASSESSOR_LABELS: Record<string, string> = {
  owner: "Owner of record",
  taxAmount: "Annual property tax",
  assessedValue: "Assessed value",
  marketValue: "Market value",
  taxStatus: "Tax status",
  lastSalePrice: "Last sale price",
  lastSaleDate: "Last sale date",
};

function formatAssessorValue(field: string, value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (["taxAmount", "assessedValue", "marketValue", "lastSalePrice"].includes(field)) {
      return `$${value.toLocaleString()}`;
    }
    return value.toLocaleString();
  }
  return String(value);
}

// ─── Score presentation ──────────────────────────────────────────────────────

function ScoreHero({ report, onShare, shared }: {
  report: ReportDto;
  onShare: () => void;
  shared: boolean;
}) {
  const lcs = report.lcs;
  return (
    <div className="rounded-lg border border-border bg-card p-6" data-testid="report-score-hero">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
            Partial Land Credit Score
          </p>
          {lcs.partialScore != null ? (
            <p className="mt-2 flex items-baseline gap-3">
              <span className="text-5xl font-bold text-foreground tabular-nums">
                {lcs.partialScore}
              </span>
              <span className="text-2xl font-semibold text-primary">{lcs.partialGrade}</span>
              <span className="text-sm text-muted-foreground">on the 300–850 scale</span>
            </p>
          ) : (
            <p className="mt-2 text-2xl font-semibold text-muted-foreground">
              Not yet scorable from free data
            </p>
          )}
          <p className="mt-3 max-w-xl text-sm text-muted-foreground">
            Scored from {lcs.scoredDimensions} of {lcs.totalDimensions} dimensions —
            government-data dimensions only. The full Land Credit Score runs inside
            AcreOS, where paid county and market data fills the locked dimensions.
          </p>
        </div>
        <button
          type="button"
          onClick={onShare}
          aria-label="Share this parcel report"
          className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          data-testid="report-share-button"
        >
          {shared ? (
            <>
              <Check className="h-4 w-4" aria-hidden="true" />
              Link copied
            </>
          ) : (
            <>
              <Share2 className="h-4 w-4" aria-hidden="true" />
              Share
            </>
          )}
        </button>
      </div>
    </div>
  );
}

function DimensionRow({ dim }: { dim: PublicLcs["dimensions"][number] }) {
  if (dim.status === "scored" && dim.score != null) {
    return (
      <div
        className="rounded-lg border border-border bg-card p-4"
        data-testid={`report-dimension-${dim.key}`}
      >
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold text-foreground">{dim.label}</h3>
          <span className="text-sm font-medium text-foreground tabular-nums">
            {dim.score}/100
          </span>
        </div>
        <div
          className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted"
          role="img"
          aria-label={`${dim.label} scored ${dim.score} out of 100`}
        >
          <div
            className="h-full rounded-full bg-primary"
            style={{ width: `${Math.max(2, Math.min(100, dim.score))}%` }}
          />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Weight {dim.weight}% · from {dim.sources.length ? dim.sources.join(", ") : "government data"}
          {dim.missing.length > 0 && (
            <> · partial — {dim.missing.join(", ")} need data inside AcreOS</>
          )}
        </p>
      </div>
    );
  }
  return (
    <div
      className="rounded-lg border border-dashed border-border bg-muted/30 p-4"
      data-testid={`report-dimension-${dim.key}`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground">
          <Lock className="h-3.5 w-3.5" aria-hidden="true" />
          {dim.label}
        </h3>
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Locked
        </span>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Weight {dim.weight}% · needs {dim.missing.join(", ")} — data sources available
        inside AcreOS. No value is shown because none was measured.
      </p>
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function PublicParcelReportPage() {
  const params = useParams<{ state: string; county: string; apn: string }>();
  const state = params.state ?? "";
  const county = params.county ?? "";
  const apn = params.apn ?? "";
  const sidRef = useRef<string>(getAnonymousId());
  const [shared, setShared] = useState(false);

  const query = useQuery({
    queryKey: ["public-parcel-report", state, county, apn],
    queryFn: () => fetchReport(state, county, apn, sidRef.current),
    enabled: state.length === 2 && county.length > 0 && apn.length > 0,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  const data = query.data;
  const report = data?.found ? data.report : null;

  const title = report
    ? `${report.countyLabel} County, ${report.state} parcel ${report.apn} — public report`
    : "Public parcel report";
  const description = report
    ? `Government-data report for APN ${report.apn} in ${report.countyLabel} County, ${report.state}: county records, FEMA flood zone, USDA soil, and wetlands, with a partial Land Credit Score.`
    : "Saved parcel reports built from government data, with a partial Land Credit Score.";
  usePageMeta(title, description);

  // Acquisition wiring: page view touch + the parcel rides the first-touch
  // snapshot through signup (T2C ?ref= pattern). Server-side view truth is
  // recorded by the API (view_count); these client events are supplemental.
  useEffect(() => {
    emitMarketingTouch({
      surface: "public:parcel-report",
      eventType: "page_view",
      payload: { state, county },
    });
  }, [state, county]);

  useEffect(() => {
    if (report) {
      capturePendingParcel(report.state, report.countySlug, report.apn);
      trackEvent("public_parcel_report_viewed", {
        state: report.state,
        county: report.countySlug,
        scoredDimensions: report.lcs.scoredDimensions,
      });
    }
  }, [report]);

  async function handleShare() {
    if (!report) return;
    const url = window.location.origin + window.location.pathname;
    const shareTitle = `${report.countyLabel} County, ${report.state} — parcel ${report.apn}`;
    emitMarketingTouch({
      surface: "public:parcel-report",
      eventType: "funnel_step",
      payload: { step: "report_shared", state: report.state, county: report.countySlug },
    });
    trackEvent("public_parcel_report_shared", {
      state: report.state,
      county: report.countySlug,
    });
    // navigator.share on iOS Safari / Android; clipboard fallback on desktop.
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: shareTitle, url });
        return;
      } catch {
        /* user cancelled or share failed — fall through to clipboard */
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setShared(true);
      window.setTimeout(() => setShared(false), 2500);
    } catch {
      /* clipboard unavailable — the URL bar still has the permalink */
    }
  }

  const signupHref =
    "/auth?mode=register&utm_source=parcel-report&utm_medium=internal&utm_campaign=public_parcel_report";

  return (
    <main className="min-h-screen bg-background pb-24 lg:pb-0">
      {report && (
        <OpenGraph
          url={`https://acreos.io/p/${report.state.toLowerCase()}/${report.countySlug}/${encodeURIComponent(report.apn)}`}
          title={`${title} — AcreOS`}
          description={description}
          image={`https://acreos.io/p/${report.state.toLowerCase()}/${report.countySlug}/${encodeURIComponent(report.apn)}/og.png`}
        />
      )}

      <header className="border-b border-border">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 sm:px-6 py-4">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            AcreOS
          </Link>
          <Link
            href={signupHref}
            className="text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded"
          >
            Sign up
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 sm:px-6 py-8 sm:py-12">
        {query.isLoading && (
          <div className="space-y-6" data-testid="report-loading">
            <Skeleton className="h-8 w-2/3 max-w-md" />
            <Skeleton className="h-44 w-full rounded-lg" />
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-28 rounded-lg" />
              ))}
            </div>
          </div>
        )}

        {query.isError && (
          <QueryErrorState
            error={query.error instanceof Error ? query.error : null}
            onRetry={() => query.refetch()}
            isRetrying={query.isFetching}
            testId="report-error"
          />
        )}

        {data && !data.found && (
          <EmptyState
            icon={MapPin}
            headline={
              data.reason === "daily_capacity"
                ? "New reports are at capacity right now"
                : "No free data covers this parcel yet"
            }
            subtitle={data.message}
            cta={{
              label: "Check a parcel by address instead",
              href: "/tools/parcel-check",
              "data-testid": "report-empty-cta",
            }}
            actionIcon={null}
            testId="report-empty"
          />
        )}

        {report && (
          <div className="space-y-8">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
                Public parcel report
              </p>
              <h1 className="mt-1 text-2xl sm:text-3xl font-bold text-foreground">
                {report.countyLabel} County, {report.state}
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                APN {report.apn}
                {report.facts.parcel.acres != null && (
                  <> · {report.facts.parcel.acres.toLocaleString()} acres (county GIS)</>
                )}
              </p>
            </div>

            <ScoreHero report={report} onShare={handleShare} shared={shared} />

            <section aria-labelledby="report-dimensions-heading">
              <h2
                id="report-dimensions-heading"
                className="text-lg font-semibold text-foreground"
              >
                Score dimensions
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Each dimension shows where its data came from. Locked dimensions carry
                no value — the inputs aren't in free government data.
              </p>
              <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {report.lcs.dimensions.map((dim) => (
                  <DimensionRow key={dim.key} dim={dim} />
                ))}
              </div>
            </section>

            <section aria-labelledby="report-facts-heading">
              <h2 id="report-facts-heading" className="text-lg font-semibold text-foreground">
                Government data on record
              </h2>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                {report.facts.categories.map((cat) => {
                  const meta = CATEGORY_META[cat.category] ?? {
                    label: cat.category,
                    blurb: cat.source ?? "",
                  };
                  const summary = cat.available
                    ? summarizeCategory(cat.category, cat.data)
                    : null;
                  return (
                    <div
                      key={cat.category}
                      className="rounded-lg border border-border bg-card p-4"
                      data-testid={`report-fact-${cat.category}`}
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <h3 className="text-sm font-semibold text-foreground">{meta.label}</h3>
                        <span className="text-micro text-muted-foreground">{meta.blurb}</span>
                      </div>
                      {summary ? (
                        <>
                          <p className="mt-2 text-lg font-medium text-foreground leading-tight">
                            {summary.headline}
                          </p>
                          {summary.detail && (
                            <p className="mt-0.5 text-sm text-muted-foreground">
                              {summary.detail}
                            </p>
                          )}
                        </>
                      ) : (
                        <p className="mt-2 text-sm text-muted-foreground italic">
                          No data at this point.{" "}
                          {cat.source
                            ? `${cat.source} returned no record here.`
                            : "Source unavailable for this location."}
                        </p>
                      )}
                      <div className="mt-3">
                        <DataProvenanceChip
                          source={cat.source}
                          sourceAsOf={cat.sourceAsOf}
                          confidence={null}
                          classification={cat.classification}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            <section aria-labelledby="report-county-heading">
              <h2
                id="report-county-heading"
                className="flex items-center gap-2 text-lg font-semibold text-foreground"
              >
                <Landmark className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                County records
              </h2>
              {report.facts.parcel.assessorData ? (
                <dl className="mt-4 grid gap-x-8 gap-y-3 sm:grid-cols-2">
                  {Object.entries(report.facts.parcel.assessorData).map(([field, value]) => (
                    <div key={field} className="flex items-baseline justify-between gap-4 border-b border-border/60 pb-2">
                      <dt className="text-sm text-muted-foreground">
                        {ASSESSOR_LABELS[field] ?? field}
                      </dt>
                      <dd className="text-sm font-medium text-foreground text-right">
                        {formatAssessorValue(field, value)}
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
                  {report.facts.parcel.countyAttributes === "not-redistributable"
                    ? "This county's data terms don't allow republishing assessor attributes on a public page. Inside AcreOS, the same attributes load live from the county source."
                    : "County assessor attributes weren't available for this parcel."}
                </p>
              )}
              {report.facts.parcel.attribution && (
                <p className="mt-3 text-xs text-muted-foreground">
                  County data: {report.facts.parcel.attribution}
                </p>
              )}
            </section>

            <section className="rounded-lg border border-border bg-muted/30 p-6">
              <h2 className="text-lg font-semibold text-foreground">
                Run the full Land Credit Score
              </h2>
              <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
                AcreOS scores all {report.lcs.totalDimensions} dimensions — location,
                legal, financial, and market data join the government layers above —
                across every parcel in a buy-box. Built for Land Investors.
              </p>
              <Link
                href={signupHref}
                className="mt-4 inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                data-testid="report-signup-cta"
              >
                Start free
              </Link>
            </section>

            <p className="text-xs text-muted-foreground">
              Screening report from public government data — not a survey, appraisal,
              or title search. Sources and retrieval dates are shown on each tile.
              {report.refreshedAt && (
                <> Report data refreshed {formatDate(report.refreshedAt)}.</>
              )}
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
