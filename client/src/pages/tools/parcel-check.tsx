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
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, Search, MapPin, Loader2 } from "lucide-react";
import { usePageMeta } from "@/hooks/use-document-title";
import { OpenGraph } from "@/components/seo/OpenGraph";
import { Skeleton } from "@/components/ui/skeleton";
import { DataProvenanceChip } from "@/components/data-provenance-chip";
import { SPRINGS, useReducedMotionPreference, respectReducedMotion } from "@/lib/motion-tokens";
import { emitMarketingTouch } from "@/lib/marketing-touch";
import { getAnonymousId } from "@/lib/marketing-touch";
import { listLearnRoutes } from "@/pages/learn/registry";
import { EmbedToolCard } from "@/components/tools/EmbedToolCard";
import { useParcelStream } from "@/components/parcels/use-parcel-stream";
import {
  streamMeter,
  type ParcelStreamCategory,
  type StreamedSource,
  type TileState,
} from "@/components/parcels/parcel-stream-reducer";

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
// The per-source shape now lives in the stream reducer (StreamedSource), shared
// between the streamed and batch paths so a tile is identical either way.

type Category = ParcelStreamCategory;
type CategoryResult = StreamedSource;

// Display metadata per category — title + the human summary renderer. Each
// renderer reads only fields the broker actually returns and degrades to null
// (the empty state) when the headline field is missing.
// `querying` is the named source the tile announces WHILE it resolves — the
// whole point of the bet: the customer watches "Querying FEMA NFHL…" become a
// real value, source by named source.
const CATEGORY_META: Record<
  Category,
  { label: string; blurb: string; querying: string }
> = {
  flood_zone: { label: "FEMA flood zone", blurb: "National Flood Hazard Layer", querying: "FEMA NFHL" },
  soil: { label: "USDA soil", blurb: "SSURGO survey", querying: "USDA SSURGO" },
  elevation: { label: "USGS elevation", blurb: "3DEP / National Map", querying: "USGS 3DEP" },
  wetlands: { label: "USFWS wetlands", blurb: "National Wetlands Inventory", querying: "USFWS NWI" },
  demographics: { label: "Census context", blurb: "ACS 5-Year tract", querying: "U.S. Census" },
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

/**
 * StreamingTile — one source tile across the streaming lifecycle. While
 * `querying` it shows "Querying FEMA NFHL…" with a soft spinner; when its
 * source lands it cross-fades to the real value (or honest "no data") + the
 * provenance chip on SPRINGS.smooth. The arrival haptic is fired by the stream
 * hook, not here, so a re-render never double-buzzes.
 */
function StreamingTile({ tile }: { tile: TileState }) {
  const meta = CATEGORY_META[tile.category];
  const reduced = useReducedMotionPreference();
  const isResolved = tile.status !== "querying" && tile.result != null;

  return (
    <motion.div
      layout
      className="rounded-lg border border-border bg-card p-4"
      data-testid={`parcel-check-tile-${tile.category}`}
      data-status={tile.status}
    >
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">{meta.label}</h3>
        <span className="text-micro text-muted-foreground">{meta.blurb}</span>
      </div>

      <AnimatePresence mode="wait" initial={false}>
        {!isResolved ? (
          <motion.p
            key="querying"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={respectReducedMotion(SPRINGS.smooth, reduced)}
            className="mt-2 flex items-center gap-2 text-sm text-muted-foreground"
            aria-live="polite"
          >
            <Loader2
              className={reduced ? "h-3.5 w-3.5" : "h-3.5 w-3.5 animate-spin"}
              aria-hidden="true"
            />
            Querying {meta.querying}…
          </motion.p>
        ) : (
          <motion.div
            key="resolved"
            initial={reduced ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={respectReducedMotion(SPRINGS.smooth, reduced)}
          >
            {(() => {
              const summary = tile.result ? summarize(tile.result) : null;
              return summary ? (
                <>
                  <p className="mt-2 text-lg font-medium text-foreground leading-tight">
                    {summary.headline}
                  </p>
                  {summary.detail && (
                    <p className="mt-0.5 text-sm text-muted-foreground">{summary.detail}</p>
                  )}
                </>
              ) : (
                // Honest empty state — source still named so the absence is attributable.
                <p className="mt-2 text-sm text-muted-foreground italic">
                  No data at this point.{" "}
                  {tile.result?.source
                    ? `${tile.result.source} returned no record here.`
                    : "Source unavailable for this location."}
                </p>
              );
            })()}
            <div className="mt-3">
              {/* whenUnknown="hide": the honest empty state above already
                  names the absence ("Source unavailable for this location."). */}
              <DataProvenanceChip
                source={tile.result?.source ?? null}
                sourceAsOf={tile.result?.sourceAsOf ?? null}
                confidence={tile.result?.confidence ?? null}
                classification={tile.result?.classification ?? "unknown"}
                whenUnknown="hide"
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

/**
 * ResultsSkeleton — the pending result area between submit and the first SSE
 * `meta` event (the `connecting` phase, before any tile exists). Shaped like
 * the real result block: the "Showing data for…" header row, then one
 * tile-shaped placeholder per federal source — label/blurb line, headline,
 * provenance chip. Once tiles stream in, StreamingTile's own per-source
 * "Querying…" state takes over.
 */
function ResultsSkeleton() {
  const categories = Object.keys(CATEGORY_META) as Category[];
  return (
    <div
      role="status"
      aria-busy="true"
      className="mt-6 space-y-6"
      data-testid="parcel-check-results-skeleton"
    >
      <span className="sr-only">Looking up parcel data…</span>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Skeleton announce={false} className="h-5 w-64 max-w-full" />
        <Skeleton announce={false} className="h-4 w-32" />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {categories.map((category) => (
          <div
            key={category}
            className="rounded-lg border border-border bg-card p-4"
            data-testid={`parcel-check-skeleton-tile-${category}`}
          >
            <div className="flex items-baseline justify-between gap-2">
              <Skeleton announce={false} className="h-4 w-28" />
              <Skeleton announce={false} className="h-3 w-24" />
            </div>
            <Skeleton announce={false} className="mt-3 h-6 w-32" />
            <Skeleton announce={false} className="mt-1.5 h-4 w-40 max-w-full" />
            <Skeleton announce={false} className="mt-3 h-5 w-36 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * The parcel-check surface. Rendered two ways:
 *   - default: the full /tools/parcel-check marketing page (nav, hero, CTAs).
 *   - `embed`: the iframe-friendly /tools/parcel-check/embed surface — no
 *     header/hero/signup CTAs, a fixed-width frame on an explicit background,
 *     and a "Powered by AcreOS · check your parcel" backlink. The honesty +
 *     provenance footnote ALWAYS renders, so a host site can't strip the
 *     "screening tool, not a survey" disclaimer from the embedded check.
 */
function ParcelCheckSurface({ embed = false }: { embed?: boolean }) {
  usePageMeta(TITLE, DESCRIPTION);
  const [address, setAddress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { state: stream, start: startStream } = useParcelStream();
  const meter = streamMeter(stream);
  const reduced = useReducedMotionPreference();
  // The whole pull is "active" from connecting through the last tile landing.
  const loading =
    stream.phase === "connecting" || stream.phase === "streaming";
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

  // Emit the resolved funnel touch exactly once, when the stream completes.
  const resolvedEmittedRef = useRef(false);
  useEffect(() => {
    if (stream.phase === "done" && !resolvedEmittedRef.current) {
      resolvedEmittedRef.current = true;
      emitMarketingTouch({
        surface: "tools:parcel-check",
        eventType: "funnel_step",
        payload: { step: "lookup_resolved", successCount: stream.resolvedCount },
      });
    }
  }, [stream.phase, stream.resolvedCount]);

  function runCheck(e: React.FormEvent) {
    e.preventDefault();
    const q = address.trim();
    if (q.length < 3) {
      setError("Enter a full street address.");
      return;
    }
    setError(null);
    resolvedEmittedRef.current = false;
    emitMarketingTouch({
      surface: "tools:parcel-check",
      eventType: "funnel_step",
      payload: { step: "lookup_submitted" },
    });
    // Open the SSE stream — each source flips its tile in as it lands. The hook
    // falls back to the batch endpoint if EventSource is unsupported.
    startStream({ address: q, sid: sidRef.current });
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

      {!embed && (
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
      )}

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

        {(error || stream.phase === "error") && (
          <p className="mt-4 text-sm text-destructive" role="alert">
            {error ?? stream.message ?? "Something went wrong running that check. Try again in a moment."}
          </p>
        )}

        {/* Unresolved (address not found / APN needs coords / rate-limited) —
            honest message, streamed terminally. */}
        {stream.phase === "unresolved" && (
          <div className="mt-6 rounded-lg border border-border bg-muted/40 p-5">
            <p className="text-sm text-foreground">{stream.message}</p>
          </div>
        )}

        {/* Pending lookup, pre-stream: between submit and the first `meta`
            event there are no tiles yet — render a parcel-card-shaped skeleton
            so the result area never sits blank while a visitor waits. */}
        {loading && stream.tiles.length === 0 && <ResultsSkeleton />}

        {/* The streaming pull. Tiles appear the moment `meta` lands and flip
            from "Querying FEMA NFHL…" to their value source-by-named-source.
            The meter counts federal sources arriving in real time. */}
        {(loading || stream.phase === "done") && stream.tiles.length > 0 && (
          <div className="mt-6 space-y-6">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm text-muted-foreground">
                {stream.matchedAddress ? (
                  <>
                    Showing data for{" "}
                    <span className="font-medium text-foreground">{stream.matchedAddress}</span>
                  </>
                ) : stream.coordinates ? (
                  <>
                    Showing data for {stream.coordinates.lat.toFixed(4)},{" "}
                    {stream.coordinates.lng.toFixed(4)}
                  </>
                ) : null}
              </p>
              {/* Running "N federal sources · 1.2s" meter. */}
              <p
                className="flex items-center gap-1.5 text-micro text-muted-foreground tabular-nums"
                aria-live="polite"
                data-testid="parcel-check-meter"
              >
                {!meter.complete && (
                  <Loader2
                    className={reduced ? "h-3 w-3" : "h-3 w-3 animate-spin"}
                    aria-hidden="true"
                  />
                )}
                {meter.arrived} {meter.total != null ? `of ${meter.total} ` : ""}
                federal source{meter.arrived === 1 ? "" : "s"}
                {stream.lookupTimeMs != null && (
                  <> · {(stream.lookupTimeMs / 1000).toFixed(1)}s</>
                )}
              </p>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {stream.tiles.map((tile) => (
                <StreamingTile key={tile.category} tile={tile} />
              ))}
            </div>

            {/* Tail-of-pull state — revealed once the full pull settles.
                Gated on whether ANY federal source actually returned data:
                  - resolvedCount > 0 → show the conversion CTA (real proof).
                  - resolvedCount === 0 → ALL sources came back empty/unreachable.
                    Pushing "sign up" on a wholly-failed lookup advertises failure
                    (an anti-proof), so we show an honest degraded banner instead. */}
            <AnimatePresence>
              {stream.phase === "done" && stream.resolvedCount > 0 && (
                <motion.div
                  initial={reduced ? false : { opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={respectReducedMotion(SPRINGS.smooth, reduced)}
                  className="rounded-lg border border-border bg-muted/30 p-6 text-center"
                >
                  <h2 className="text-lg font-semibold text-foreground">
                    Want this on every parcel in your buy-box?
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    AcreOS runs these checks automatically on every lead that matches
                    your criteria — flood, soil, elevation, wetlands, and more — from
                    free government data. Sign up and point it at your county.
                  </p>
                  {embed ? (
                    // Inside an iframe a wouter <Link> would navigate the host's
                    // embed; use a real external anchor opening AcreOS in a new tab.
                    <a
                      href="https://acreos.io/auth?mode=register&utm_source=embed&utm_medium=iframe&utm_campaign=parcel_check_embed_cta"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-4 inline-flex items-center justify-center rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    >
                      Sign up free
                    </a>
                  ) : (
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
                  )}
                </motion.div>
              )}
              {stream.phase === "done" && stream.resolvedCount === 0 && (
                <motion.div
                  initial={reduced ? false : { opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={respectReducedMotion(SPRINGS.smooth, reduced)}
                  className="rounded-lg border border-border bg-muted/40 p-6 text-center"
                  role="status"
                >
                  <h2 className="text-lg font-semibold text-foreground">
                    No federal data came back for this parcel
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    We couldn&apos;t reach the federal data sources for this location
                    right now, or none had a record here. Try another address — most
                    U.S. parcels return flood, soil, elevation, and tract data.
                  </p>
                </motion.div>
              )}
            </AnimatePresence>
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

        {/* Embed mode: the "Powered by AcreOS · check your parcel" backlink the
            flywheel runs on (external, new tab — a wouter Link would route the
            iframe internally). Main route: internal calculator + learn
            cross-links for SEO juice. */}
        {embed ? (
          <p className="mt-8 text-center text-xs text-muted-foreground">
            Powered by{" "}
            <a
              href="https://acreos.io/tools/parcel-check?utm_source=embed&utm_medium=iframe&utm_campaign=parcel_check_embed"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium underline underline-offset-2 hover:text-foreground"
            >
              AcreOS
            </a>{" "}
            · check your parcel
          </p>
        ) : (
          <>
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
            <EmbedToolCard embedPath="/tools/parcel-check/embed" title="Parcel Check" height={640} />
          </>
        )}
      </section>
    </main>
  );
}

/** /tools/parcel-check — the full public marketing surface. */
export default function ParcelCheckPage() {
  return <ParcelCheckSurface />;
}

/**
 * /tools/parcel-check/embed — iframe-friendly Parcel Check. No nav/footer, the
 * honesty + provenance disclaimer travels inside, "Powered by AcreOS · check
 * your parcel" backlink. Iframe-ability is scoped to this exact path by
 * server/middleware/security.ts.
 */
export function ParcelCheckEmbedPage() {
  return <ParcelCheckSurface embed />;
}
