/**
 * Server-rendered HTML for the public land pages (W3 acquisition engine):
 * the parcel report body ("Carfax for land") and the county guides.
 *
 * Why server-rendered: search engines take months to index, and a crawler
 * that does not run the SPA must still read the facts. The page routes put
 * this HTML inside the SPA shell's #root; createRoot replaces it when the app
 * mounts, so people get the live page and crawlers get the same words.
 *
 * Pure string assembly from data that already passed the accuracy gate
 * (PublicLandFacts / CountyGuide). Every interpolated value is escaped. No
 * number is computed here that the data did not carry.
 */
import type { PublicLandFacts } from "./publicParcelReport";
import type { CountyGuide } from "./publicCountyGuide";

export function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const SIGNUP_PATH = "/auth?mode=register&utm_source=land-report&utm_medium=internal&utm_campaign=carfax_for_land";

function sourceLine(sources: Array<{ name: string; url: string; retrievedOn: string; sourceAsOf?: string | null }>): string {
  if (!sources.length) return "";
  return sources
    .map((s) => {
      const asOf = s.sourceAsOf ? `, edition ${esc(s.sourceAsOf)}` : "";
      return `<a href="${esc(s.url)}" rel="nofollow noopener">${esc(s.name)}</a> (retrieved ${esc(s.retrievedOn)}${asOf})`;
    })
    .join("; ");
}

/** The land-facts article for a parcel AcreOS keeps. */
export function renderLandFactsHtml(land: PublicLandFacts): string {
  const rows = land.rows
    .map((r) => {
      if (r.status === "shown") {
        const acc = r.accuracy
          ? `<p class="text-xs text-muted-foreground">Accuracy check: ${esc(r.accuracy.agreed)} of ${esc(r.accuracy.sampleSize)} hand-checked parcels agreed (${esc(r.accuracy.verifiedOn ?? "")}).</p>`
          : "";
        return `<li class="rounded-lg border border-border bg-card p-4" data-fact="${esc(r.key)}">
  <h3 class="text-sm font-semibold">${esc(r.label)}</h3>
  <p class="mt-1 text-base">${esc(r.text)}</p>
  <p class="mt-1 text-xs text-muted-foreground">Confidence: ${esc(r.confidence ?? "")}. Source: ${sourceLine(r.sources)}.</p>
  ${r.method ? `<p class="text-xs text-muted-foreground">How: ${esc(r.method)}</p>` : ""}
  ${acc}
</li>`;
      }
      return `<li class="rounded-lg border border-dashed border-border p-4" data-fact="${esc(r.key)}">
  <h3 class="text-sm font-semibold">${esc(r.label)}</h3>
  <p class="mt-1 text-base">Not available</p>
  <p class="mt-1 text-xs text-muted-foreground">${esc(r.reason ?? "")}</p>
</li>`;
    })
    .join("\n");

  const truths = land.truths
    .map(
      (t) =>
        `<li data-truth="${esc(t.key)}"><strong>${esc(t.severity === "warning" ? "Warning" : t.severity === "caution" ? "Caution" : "Note")}:</strong> ${esc(t.message)}${
          t.link ? ` <a href="${esc(t.link.url)}" rel="nofollow noopener">${esc(t.link.label)}</a>` : ""
        } <span class="text-xs text-muted-foreground">(confidence ${esc(t.confidence)})</span></li>`,
    )
    .join("\n");

  const taxSale = land.taxSaleSources.length
    ? `<section><h2 class="text-lg font-semibold">Tax-sale and delinquency pages for ${esc(land.countyLabel)} County</h2><ul>${land.taxSaleSources
        .map(
          (t) =>
            `<li><a href="${esc(t.url)}" rel="nofollow noopener">${esc(t.office)}</a> — ${esc(t.pageSays)} (checked ${esc(t.checkedOn)}${t.reachable ? "" : "; refused an automated request"})</li>`,
        )
        .join("")}</ul><p class="text-xs text-muted-foreground">AcreOS lists where the county publishes; it does not copy sale dates, which move.</p></section>`
    : "";

  const deeded = land.deededAcres !== null ? `, deed says ${esc(land.deededAcres)} acres` : "";
  return `<article class="mx-auto max-w-4xl px-4 py-8 space-y-6" data-ssr="land-report">
<header>
  <p class="text-xs uppercase tracking-wide text-muted-foreground">Land report · AcreOS</p>
  <h1 class="text-2xl font-bold">Parcel ${esc(land.apn)}, ${esc(land.countyLabel)} County, ${esc(land.state)}</h1>
  <p class="text-sm text-muted-foreground">Mapped area ${esc(land.gisAcres.toFixed(2))} acres${deeded}. Parcel record: ${esc(land.source.name)}${
    land.source.retrievedOn ? `, retrieved ${esc(land.source.retrievedOn)}` : ""
  }.</p>
</header>
<section>
  <h2 class="text-lg font-semibold">Verified land facts</h2>
  <p class="text-sm text-muted-foreground">Only facts that passed AcreOS's accuracy check on hand-checked parcels are shown, each with its source, date and confidence. Anything else says "Not available" — it is never estimated.</p>
  <ul class="mt-3 grid gap-3">${rows}</ul>
</section>
<section>
  <h2 class="text-lg font-semibold">What this data cannot tell you</h2>
  <ul class="list-disc pl-5 space-y-1">${truths}</ul>
</section>
${taxSale}
<section>
  <p>County data coverage: ${esc(land.countyCoverageLabel ?? "not yet assessed")}.</p>
  <p><a href="${esc(SIGNUP_PATH)}">Work this parcel in AcreOS — sign up</a> · <a href="/tools/landlocked">Is a parcel landlocked? Check one free</a></p>
  <p class="text-xs text-muted-foreground">Informational only, not a survey, title search or legal opinion. GIS parcel lines are drawn for tax maps; only a survey settles a boundary.</p>
</section>
</article>`;
}

/** schema.org JSON-LD for a land report: the Place and only its shown facts. */
export function landFactsJsonLd(land: PublicLandFacts, url: string): Record<string, unknown> {
  const shown = land.rows.filter((r) => r.status === "shown");
  return {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: `Parcel ${land.apn}, ${land.countyLabel} County, ${land.state} — land report`,
    url,
    isAccessibleForFree: true,
    mainEntity: {
      "@type": "Place",
      name: `Parcel ${land.apn}, ${land.countyLabel} County, ${land.state}`,
      identifier: land.parcelKey,
      address: { "@type": "PostalAddress", addressRegion: land.state, addressCountry: "US" },
      containedInPlace: { "@type": "AdministrativeArea", name: `${land.countyLabel} County, ${land.state}` },
      ...(land.centroid ? { geo: { "@type": "GeoCoordinates", latitude: land.centroid.lat, longitude: land.centroid.lng } } : {}),
      additionalProperty: shown.map((r) => ({
        "@type": "PropertyValue",
        name: r.label,
        value: r.text,
        ...(r.sources[0] ? { measurementTechnique: r.method ?? undefined, url: r.sources[0].url } : {}),
      })),
    },
  };
}

/** The county guide article. Every number comes from the CountyGuide data. */
export function renderCountyGuideHtml(g: CountyGuide): string {
  const access = g.roadAccess
    ? `<p><strong>${esc(g.roadAccess.publicRoadPct)}%</strong> of the ${esc(g.roadAccess.computed.toLocaleString("en-US"))} kept parcels with a computed access fact touch a public road; ${esc(
        g.roadAccess.noRoad.toLocaleString("en-US"),
      )} touch no road at all on the map. <span class="text-xs text-muted-foreground">${esc(g.roadAccess.basis)}</span></p>`
    : `<p>Share with road access: not available — ${esc(g.roadAccessRefusal ?? "")}</p>`;
  const taxSale = g.taxSaleSources.length
    ? `<ul>${g.taxSaleSources
        .map(
          (t) =>
            `<li><a href="${esc(t.url)}" rel="nofollow noopener">${esc(t.office)}</a> — ${esc(t.pageSays)} (checked ${esc(t.checkedOn)}${t.reachable ? "" : "; refused an automated request"})</li>`,
        )
        .join("")}</ul>`
    : `<p>No tax-sale or delinquency page is in AcreOS's registry for this county yet.</p>`;
  const sample = g.parcelLinks
    .map((p) => `<li><a href="${esc(p.path)}">Parcel ${esc(p.apn)}</a></li>`)
    .join("");
  return `<article class="mx-auto max-w-4xl px-4 py-8 space-y-6" data-ssr="county-guide">
<header>
  <p class="text-xs uppercase tracking-wide text-muted-foreground">County guide · AcreOS</p>
  <h1 class="text-2xl font-bold">${esc(g.countyLabel)} County, ${esc(g.state)}: land parcels, road access and tax sales</h1>
  <p class="text-sm text-muted-foreground">Built only from parcels AcreOS keeps and the sources named on this page. Parcel record: ${esc(g.sourceNames.join(", "))}; retrieved ${esc(g.retrievedFrom)}${
    g.retrievedTo !== g.retrievedFrom ? ` to ${esc(g.retrievedTo)}` : ""
  }.</p>
</header>
<section>
  <h2 class="text-lg font-semibold">Parcels</h2>
  <p><strong>${esc(g.parcelCount.toLocaleString("en-US"))}</strong> parcels kept by AcreOS in ${esc(g.countyLabel)} County.</p>
  ${access}
</section>
<section>
  <h2 class="text-lg font-semibold">Tax-sale calendar and delinquency lists</h2>
  ${taxSale}
  <p class="text-xs text-muted-foreground">Sale dates move; read them on the county's own page.</p>
</section>
<section>
  <h2 class="text-lg font-semibold">Data coverage</h2>
  <p>${esc(g.coverageLabel ?? "Coverage not yet assessed")}.</p>
</section>
${sample ? `<section><h2 class="text-lg font-semibold">Parcel reports in ${esc(g.countyLabel)} County</h2><ul>${sample}</ul></section>` : ""}
<section>
  <p><a href="${esc(SIGNUP_PATH.replace("carfax_for_land", "county_guide"))}">Search ${esc(g.countyLabel)} County in AcreOS — sign up</a> · <a href="/tools/landlocked">Check whether a parcel is landlocked</a></p>
  <p class="text-xs text-muted-foreground">GIS parcel lines are drawn for tax maps, not surveyed. A road on the map is not proof of legal access; easements are unknown until the deed is read.</p>
</section>
</article>`;
}

/** schema.org JSON-LD for a county guide. */
export function countyGuideJsonLd(g: CountyGuide, url: string): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "Dataset",
    name: `${g.countyLabel} County, ${g.state} land parcels — AcreOS county guide`,
    description: `Parcel count${g.roadAccess ? ", share with public-road access" : ""}, tax-sale source links and data coverage for ${g.countyLabel} County, ${g.state}, from parcels AcreOS keeps.`,
    url,
    isAccessibleForFree: true,
    spatialCoverage: { "@type": "AdministrativeArea", name: `${g.countyLabel} County, ${g.state}` },
    temporalCoverage: g.retrievedFrom === g.retrievedTo ? g.retrievedFrom : `${g.retrievedFrom}/${g.retrievedTo}`,
    variableMeasured: [
      { "@type": "PropertyValue", name: "Parcels kept", value: g.parcelCount },
      ...(g.roadAccess ? [{ "@type": "PropertyValue", name: "Share touching a public road (%)", value: g.roadAccess.publicRoadPct }] : []),
    ],
    creator: { "@type": "Organization", name: "AcreOS", url: "https://acreos.io" },
  };
}
