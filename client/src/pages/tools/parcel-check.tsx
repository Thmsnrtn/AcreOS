/**
 * /tools/parcel-check — public, no-auth parcel due-diligence widget.
 *
 * The visible proof of the data moat (docs/internal/roadmap/_lenses/soren.md §1).
 * A stranger pastes an address → sees FEMA flood zone, USDA SSURGO soil, USGS
 * elevation, USFWS wetlands, and Census tract context, each with a provenance
 * chip naming the source. It demonstrates the "premium government data, free"
 * promise instead of asserting it, and ends in the most natural CTA there is:
 * "want this on every parcel in your buy-box? sign up."
 *
 * Mirrors the /tools/calculator chrome (lightweight nav + JSON-LD
 * SoftwareApplication price:0). Reads the public /api/public/parcel-check
 * endpoint, which is hard-capped to free providers and rate-limited by session.
 *
 * Honesty contract: partial / empty / not-found states are first-class. A
 * dataset that returns nothing renders "No data at this point" with its source
 * still named — we never fabricate a value to make the page look complete.
 */
import { useState, useRef, useEffect, useMemo } from "react";
import { Link } from "wouter";
import { ArrowLeft, Search, MapPin } from "lucide-react";
import { usePageMeta } from "@/hooks/use-document-title";
import { OpenGraph } from "@/components/seo/OpenGraph";
import { DataProvenanceChip, type DataClassification } from "@/components/data-provenance-chip";
import { Skeleton } from "@/components/ui/skeleton";
import { emitMarketingTouch } from "@/lib/marketing-touch";
import { getAnonymousId } from "@/lib/marketing-touch";
import { listLearnRoutes } from "@/pages/learn/registry";

const TITLE = "Free Parcel Check";
const DESCRIPTION =
  "Run free due diligence on any U.S. parcel. FEMA flood zone, USDA soil, USGS elevation, USFWS wetlands, and Census context — from government data, no signup.";

// schema.org SoftwareApplication payload. price:0 flags the tool as free for
// "free [thing] check" search intent — the same SEO win the calculator earns.
const JSON_LD = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "AcreOS Free Parcel Check",
  description: DESCRIPTION,
  applicationCategory: "BusinessApplication",
  operatingSystem: "Any (web)",
  url: "https://acreos.io/tools/parcel-check",
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "USD",
  },
  publisher: {
    "@type": "Organization",
    name: "AcreOS",
    url: "https://acreos.io",
  },
} as const;

// ─── Response shapes (mirror server/routes-public-parcel-check.ts) ──────────

type Category = "flood_zone" | "soil" | "elevation" | "wetlands" | "demographics";

interface CategoryResult {
  category: Category;
  available: boolean;
  data: Record<string, unknown> | null;
  source: string | null;
  sourceAsOf: string | null;
  classification: DataClassification;
  confidence: number | null;
  fromCache: boolean;
}

interface ResolvedResponse {
  resolved: true;
  coordinates: { lat: number; lng: number };
  matchedAddress: string | null;
  results: CategoryResult[];
  meta: { lookupTimeMs: number; successCount: number; failureCount: number };
}

interface UnresolvedResponse {
  resolved: false;
  reason: string;
  message: string;
  results: [];
}

type ParcelCheckResponse = ResolvedResponse | UnresolvedResponse;

// Display metadata per category — title + the human summary renderer. Each
// renderer reads only fields the broker actually returns and degrades to null
// (the empty state) when the headline field is missing.
const CATEGORY_META: Record<
  Category,
  { label: string; blurb: string }
> = {
  flood_zone: { label: "FEMA flood zone", blurb: "National Flood Hazard Layer" },
  soil: { label: "USDA soil", blurb: "SSURGO survey" },
  elevation: { label: "USGS elevation", blurb: "3DEP / National Map" },
  wetlands: { label: "USFWS wetlands", blurb: "National Wetlands Inventory" },
  demographics: { label: "Census context", blurb: "ACS 5-Year tract" },
};

function summarize(r: CategoryResult): { headline: string; detail: string | null } | null {
  const d = r.data;
  if (!r.available || !d) return null;
  switch (r.category) {
    case "flood_zone": {
      const zone = typeof d.zone === "string" ? d.zone : null;
      const risk = typeof d.riskLevel === "string" ? d.riskLevel : null;
      if (!zone) return null;
      return { headline: zone, detail: risk ? `${risk[0].toUpperCase()}${risk.slice(1)} risk` : null };
    }
    case "soil": {
      const soil = typeof d.soilType === "string" ? d.soilType : null;
      const cap = typeof d.capabilityClass === "string" ? d.capabilityClass : null;
      const drainage = typeof d.drainage === "string" ? d.drainage : null;
      if (!soil || soil === "Unknown") return null;
      const bits = [cap ? `Capability class ${cap}` : null, drainage && drainage !== "Unknown" ? `${drainage} drainage` : null].filter(Boolean);
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
    case "demographics": {
      const pop = typeof d.population === "number" ? d.population : null;
      const income = typeof d.medianHouseholdIncome === "number" ? d.medianHouseholdIncome : null;
      if (pop === null && income === null) return null;
      const bits = [
        pop !== null ? `${pop.toLocaleString()} people in tract` : null,
        income !== null ? `$${income.toLocaleString()} median income` : null,
      ].filter(Boolean);
      return { headline: bits[0] as string, detail: (bits[1] as string) ?? null };
    }
    default:
      return null;
  }
}

function ResultCard({ r }: { r: CategoryResult }) {
  const meta = CATEGORY_META[r.category];
  const summary = summarize(r);
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">{meta.label}</h3>
        <span className="text-micro text-muted-foreground">{meta.blurb}</span>
      </div>
      {summary ? (
        <>
          <p className="mt-2 text-lg font-medium text-foreground leading-tight">{summary.headline}</p>
          {summary.detail && (
            <p className="mt-0.5 text-sm text-muted-foreground">{summary.detail}</p>
          )}
        </>
      ) : (
        // Honest empty state — source still named so the absence is attributable.
        <p className="mt-2 text-sm text-muted-foreground italic">
          No data at this point.{" "}
          {r.source ? `${r.source} returned no record here.` : "Source unavailable for this location."}
        </p>
      )}
      <div className="mt-3">
        <DataProvenanceChip
          source={r.source}
          sourceAsOf={r.sourceAsOf}
          confidence={r.confidence}
          classification={r.classification}
        />
      </div>
    </div>
  );
}

export default function ParcelCheckPage() {
  usePageMeta(TITLE, DESCRIPTION);
  const [address, setAddress] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ParcelCheckResponse | null>(null);
  // Stable session id for rate-limit keying (NOT a credential). Reuses the
  // 1st-party anonymous id so the limit follows the visitor, not the NAT IP.
  const sidRef = useRef<string>(getAnonymousId());

  // First authored learn page from the registry — keeps the cross-link valid
  // (there is no /learn hub route). Falls back to null if none are authored.
  const learnLink = useMemo(() => {
    const routes = listLearnRoutes();
    const first = routes[0];
    if (!first) return null;
    return {
      href: `/learn/${first.vertical}/${first.state}`,
      label: "Land investing guides",
    };
  }, []);

  // Page-view touch — top of this surface's funnel (soren.md §7).
  useEffect(() => {
    emitMarketingTouch({ surface: "tools:parcel-check", eventType: "page_view" });
  }, []);

  async function runCheck(e: React.FormEvent) {
    e.preventDefault();
    const q = address.trim();
    if (q.length < 3) {
      setError("Enter a full street address.");
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    emitMarketingTouch({
      surface: "tools:parcel-check",
      eventType: "funnel_step",
      payload: { step: "lookup_submitted" },
    });
    try {
      const params = new URLSearchParams({ address: q, sid: sidRef.current });
      const res = await fetch(`/api/public/parcel-check?${params.toString()}`, {
        headers: { Accept: "application/json" },
      });
      if (res.status === 429) {
        setError("You've run a lot of checks in a short window. Give it a minute and try again.");
        return;
      }
      if (!res.ok) {
        setError("Something went wrong running that check. Try again in a moment.");
        return;
      }
      const data = (await res.json()) as ParcelCheckResponse;
      setResult(data);
      if (data.resolved) {
        emitMarketingTouch({
          surface: "tools:parcel-check",
          eventType: "funnel_step",
          payload: { step: "lookup_resolved", successCount: data.meta.successCount },
        });
      }
    } catch {
      setError("Could not reach the data service. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-background pb-24 lg:pb-0">
      <OpenGraph
        url="https://acreos.io/tools/parcel-check"
        title={`${TITLE} — AcreOS`}
        description={DESCRIPTION}
      />
      <script
        type="application/ld+json"
        // The JSON is a literal constant defined above — safe to stringify.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }}
      />

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
            href="/auth?mode=register&utm_source=parcel-check&utm_medium=internal&utm_campaign=parcel_check_header"
            className="text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded"
          >
            Sign up
          </Link>
        </div>
      </header>

      <section className="border-b border-border bg-muted/30">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-8 sm:py-12">
          <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
            Free tool
          </p>
          <h1 className="mt-2 text-3xl sm:text-4xl font-bold leading-tight">Free Parcel Check</h1>
          <p className="mt-3 max-w-2xl text-base sm:text-lg text-muted-foreground">
            Paste any U.S. address. AcreOS pulls flood zone, soil, elevation,
            wetlands, and tract context from government data — the same checks it
            runs on every parcel in a customer&apos;s buy-box. No signup, no card.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 sm:px-6 py-8">
        <form onSubmit={runCheck} className="flex flex-col gap-3 sm:flex-row">
          <label htmlFor="parcel-address" className="sr-only">
            Property address
          </label>
          <div className="relative flex-1">
            <MapPin
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <input
              id="parcel-address"
              type="text"
              inputMode="text"
              autoComplete="street-address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="123 County Road 4, Cochise County, AZ"
              className="w-full rounded-md border border-input bg-background py-2.5 pl-9 pr-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-60"
          >
            <Search className="h-4 w-4" aria-hidden="true" />
            {loading ? "Checking…" : "Run free check"}
          </button>
        </form>

        {error && (
          <p className="mt-4 text-sm text-destructive" role="alert">
            {error}
          </p>
        )}

        {/* Loading skeletons matching the result-card shape (CLAUDE.md). */}
        {loading && (
          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-hidden="true">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="rounded-lg border border-border bg-card p-4">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="mt-3 h-6 w-40" />
                <Skeleton className="mt-2 h-3 w-24" />
                <Skeleton className="mt-4 h-3 w-28" />
              </div>
            ))}
          </div>
        )}

        {/* Unresolved (address not found / APN needs coords) — honest message. */}
        {result && !result.resolved && (
          <div className="mt-6 rounded-lg border border-border bg-muted/40 p-5">
            <p className="text-sm text-foreground">{result.message}</p>
          </div>
        )}

        {/* Resolved results. */}
        {result && result.resolved && (
          <div className="mt-6 space-y-6">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm text-muted-foreground">
                {result.matchedAddress ? (
                  <>
                    Showing data for{" "}
                    <span className="font-medium text-foreground">{result.matchedAddress}</span>
                  </>
                ) : (
                  <>
                    Showing data for {result.coordinates.lat.toFixed(4)},{" "}
                    {result.coordinates.lng.toFixed(4)}
                  </>
                )}
              </p>
              <p className="text-micro text-muted-foreground">
                {result.meta.successCount} of {result.results.length} sources returned data
              </p>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {result.results.map((r) => (
                <ResultCard key={r.category} r={r} />
              ))}
            </div>

            {/* Signup CTA — the natural next step after seeing it work. */}
            <div className="rounded-lg border border-border bg-muted/30 p-6 text-center">
              <h2 className="text-lg font-semibold text-foreground">
                Want this on every parcel in your buy-box?
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                AcreOS runs these checks automatically on every lead that matches
                your criteria — flood, soil, elevation, wetlands, and more — from
                free government data. Sign up and point it at your county.
              </p>
              <Link
                href="/auth?mode=register&utm_source=parcel-check&utm_medium=internal&utm_campaign=parcel_check_result_cta"
                onClick={() =>
                  emitMarketingTouch({
                    surface: "tools:parcel-check",
                    eventType: "cta_click",
                    payload: { ctaId: "result_signup" },
                  })
                }
                className="mt-4 inline-flex items-center justify-center rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                Sign up free
              </Link>
            </div>
          </div>
        )}

        {/* Honesty + provenance footnote. */}
        <p className="mt-8 max-w-3xl text-micro text-muted-foreground">
          Data comes from public government sources: FEMA National Flood Hazard
          Layer, USDA NRCS SSURGO, USGS 3DEP, the USFWS National Wetlands
          Inventory, and the U.S. Census Bureau. Coverage varies by location and
          dataset; absence of a record is not a guarantee of absence on the
          ground. This is a screening tool, not a substitute for a survey,
          elevation certificate, or wetlands delineation.
        </p>

        {/* Internal linking — calculator + learn cross-links (SEO juice).
            The learn target is resolved from the registry so it always points
            at a real, authored page (no /learn hub route exists). */}
        <nav aria-label="Related free tools" className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <Link href="/tools/calculator" className="text-primary hover:underline">
            Land Deal Calculator
          </Link>
          {learnLink && (
            <Link href={learnLink.href} className="text-primary hover:underline">
              {learnLink.label}
            </Link>
          )}
        </nav>
      </section>
    </main>
  );
}
