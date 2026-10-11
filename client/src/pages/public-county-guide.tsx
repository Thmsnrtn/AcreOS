/**
 * /land/:state/:county — public county guide (W3 acquisition engine).
 *
 * Every number on this page comes from the server's CountyGuide, which is
 * built only from parcels AcreOS keeps and the registries named on the page.
 * A county with no kept parcels has no guide: the server answers 404 and this
 * page says so. The server also renders the same guide into the HTML for
 * crawlers (server/services/publicLandPages.ts).
 */
import { Link, useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, MapPin } from "lucide-react";
import { usePageMeta } from "@/hooks/use-document-title";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { QueryErrorState } from "@/components/query-error-state";
import type { TaxSaleSource } from "@shared/landData/taxSaleSources";

// Mirrors server/services/publicCountyGuide.ts CountyGuide.
interface CountyGuideDto {
  state: string;
  countySlug: string;
  countyLabel: string;
  parcelCount: number;
  sourceNames: string[];
  retrievedFrom: string;
  retrievedTo: string;
  roadAccess: { computed: number; publicRoad: number; nonAccessOnly: number; noRoad: number; publicRoadPct: number; basis: string } | null;
  roadAccessRefusal: string | null;
  taxSaleSources: TaxSaleSource[];
  coverageLabel: string | null;
  parcelLinks: Array<{ apn: string; path: string }>;
}

const SIGNUP = "/auth?mode=register&utm_source=county-guide&utm_medium=internal&utm_campaign=county_guide";

async function fetchGuide(state: string, county: string): Promise<CountyGuideDto | null> {
  const res = await fetch(`/api/public/land/county-guide/${encodeURIComponent(state)}/${encodeURIComponent(county)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`County guide request failed (${res.status})`);
  return ((await res.json()) as { guide: CountyGuideDto }).guide;
}

export default function PublicCountyGuidePage() {
  const params = useParams<{ state: string; county: string }>();
  const state = params.state ?? "";
  const county = params.county ?? "";
  const query = useQuery({
    queryKey: ["public-county-guide", state, county],
    queryFn: () => fetchGuide(state, county),
    enabled: state.length === 2 && county.length > 0,
    staleTime: 10 * 60 * 1000,
    retry: 1,
  });
  const g = query.data ?? null;
  usePageMeta(
    g ? `${g.countyLabel} County, ${g.state} land: parcels, road access, tax sales` : "County land guide",
    g
      ? `${g.parcelCount.toLocaleString("en-US")} parcels kept by AcreOS in ${g.countyLabel} County, ${g.state}, with road-access share, tax-sale links and coverage.`
      : "County guides built from parcels AcreOS keeps.",
  );

  return (
    <main className="min-h-screen bg-background pb-24 lg:pb-0">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-4 sm:px-6">
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            AcreOS
          </Link>
          <Link
            href={SIGNUP}
            className="rounded text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            Sign up
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-4xl space-y-8 px-4 py-8 sm:px-6 sm:py-12">
        {query.isLoading && (
          <div className="space-y-4" data-testid="county-guide-loading">
            <Skeleton className="h-8 w-2/3" />
            <Skeleton className="h-24 w-full rounded-lg" />
            <Skeleton className="h-24 w-full rounded-lg" />
          </div>
        )}
        {query.isError && (
          <QueryErrorState
            error={query.error instanceof Error ? query.error : null}
            onRetry={() => query.refetch()}
            isRetrying={query.isFetching}
            testId="county-guide-error"
          />
        )}
        {query.isSuccess && !g && (
          <EmptyState
            icon={MapPin}
            headline="No guide for this county yet"
            subtitle="A county gets a guide only once AcreOS has loaded its parcels. Nothing here is estimated."
            cta={{ label: "Check a parcel for road access", href: "/tools/landlocked", "data-testid": "county-guide-empty-cta" }}
            actionIcon={null}
            testId="county-guide-empty"
          />
        )}
        {g && (
          <article className="space-y-8" data-testid="county-guide">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">County guide</p>
              <h1 className="mt-1 text-2xl font-bold text-foreground sm:text-3xl">
                {g.countyLabel} County, {g.state}: land parcels, road access and tax sales
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Built only from parcels AcreOS keeps and the sources named here. Parcel record: {g.sourceNames.join(", ")};
                retrieved {g.retrievedFrom}
                {g.retrievedTo !== g.retrievedFrom ? ` to ${g.retrievedTo}` : ""}.
              </p>
            </div>

            <section className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-lg border border-border bg-card p-4" data-testid="county-guide-parcels">
                <h2 className="text-sm font-semibold text-foreground">Parcels kept</h2>
                <p className="mt-2 text-3xl font-bold tabular-nums text-foreground">{g.parcelCount.toLocaleString("en-US")}</p>
              </div>
              <div className="rounded-lg border border-border bg-card p-4" data-testid="county-guide-access">
                <h2 className="text-sm font-semibold text-foreground">Touching a public road</h2>
                {g.roadAccess ? (
                  <>
                    <p className="mt-2 text-3xl font-bold tabular-nums text-foreground">{g.roadAccess.publicRoadPct}%</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {g.roadAccess.noRoad.toLocaleString("en-US")} touch no road on the map. {g.roadAccess.basis}
                    </p>
                  </>
                ) : (
                  <p className="mt-2 text-sm text-muted-foreground">Not available — {g.roadAccessRefusal}</p>
                )}
              </div>
            </section>

            <section aria-labelledby="cg-taxsale">
              <h2 id="cg-taxsale" className="text-lg font-semibold text-foreground">
                Tax-sale calendar and delinquency lists
              </h2>
              {g.taxSaleSources.length ? (
                <ul className="mt-3 space-y-2 text-sm">
                  {g.taxSaleSources.map((t) => (
                    <li key={t.url}>
                      <a href={t.url} target="_blank" rel="nofollow noopener noreferrer" className="text-primary underline">
                        {t.office}
                      </a>{" "}
                      <span className="text-muted-foreground">
                        — {t.pageSays} (checked {t.checkedOn}
                        {t.reachable ? "" : "; refused an automated request"})
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">
                  No tax-sale or delinquency page is in AcreOS's registry for this county yet.
                </p>
              )}
              <p className="mt-2 text-xs text-muted-foreground">Sale dates move; read them on the county's own page.</p>
            </section>

            <section aria-labelledby="cg-coverage">
              <h2 id="cg-coverage" className="text-lg font-semibold text-foreground">
                Data coverage
              </h2>
              <p className="mt-2 text-sm text-foreground">{g.coverageLabel ?? "Coverage not yet assessed"}.</p>
            </section>

            {g.parcelLinks.length > 0 && (
              <section aria-labelledby="cg-parcels">
                <h2 id="cg-parcels" className="text-lg font-semibold text-foreground">
                  Parcel reports in {g.countyLabel} County
                </h2>
                <ul className="mt-3 grid gap-1 text-sm sm:grid-cols-3">
                  {g.parcelLinks.map((p) => (
                    <li key={p.path}>
                      <Link href={p.path} className="text-primary underline">
                        Parcel {p.apn}
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section className="rounded-lg border border-border bg-muted/30 p-5">
              <p className="text-sm text-foreground">
                GIS parcel lines are drawn for tax maps, not surveyed. A road on the map is not proof of legal access;
                easements are unknown until the deed is read.
              </p>
              <div className="mt-3 flex flex-wrap gap-4 text-sm">
                <Link href={SIGNUP} className="font-medium text-primary underline">
                  Search {g.countyLabel} County in AcreOS — sign up
                </Link>
                <Link href="/tools/landlocked" className="text-primary underline">
                  Check whether a parcel is landlocked
                </Link>
              </div>
            </section>
          </article>
        )}
      </div>
    </main>
  );
}
