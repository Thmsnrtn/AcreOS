/**
 * Sources AcreOS must never fetch — enforced on the URL, for every outbound
 * request the server or worker makes.
 *
 * Founder decision 2026-10-11 (docs/company/founder-decisions-2026-10-11.md,
 * from the founder's picker): stop using the Tennessee "Property Boundaries
 * Public Use" feature service now. Its item description says "This service is
 * not intended for commercial use", and AcreOS is a commercial product. TN
 * parcels come from the Comptroller's per-county download (terms allow
 * commercial use) once loaded, or from an org's OWN Regrid key — never from
 * this service, live or stored.
 *
 * WHY THE URL AND NOT A ROW. The service reached production through a seeded
 * statewide county_gis_endpoints row; it could equally return through a county
 * row (discovery-on-miss finds it by searching ArcGIS for "parcel"), a
 * registry entry, a script, or a copied URL. So the rule is a predicate on the
 * URL itself, checked by fetchGeo AND by the process-wide fetch guard
 * (server/outboundGuard.ts) that both entrypoints install before anything else
 * loads. tests/unit/tnPublicServiceNeverFetched.test.ts holds the population:
 * every outbound HTTP primitive in server/ and scripts/.
 */

export interface BlockedOutboundSource {
  /** Data-licence register key (data-licenses.ts). */
  licenseSource: string;
  decidedOn: string;
  decision: string;
  /** Lower-cased substrings; a URL matching ANY of them is refused. */
  markers: string[];
}

const BLOCKED_OUTBOUND_SOURCES: readonly BlockedOutboundSource[] = [
  {
    licenseSource: "TN Property Boundaries Public Use service",
    decidedOn: "2026-10-11",
    decision: "Founder: stop using the TN statewide non-commercial parcel service on every path.",
    markers: [
      // The service, by name — whatever host or org mirrors it.
      "/tennessee_property_boundaries_public_use/",
      // Its ArcGIS Online item and the TNMap open-data map built on it.
      "e356f1a241844d6f9025f2fa4e977df3",
      "53ee269639334ad8b70bfea77bde7333",
    ],
  },
];

function normalize(url: string): string {
  let s = String(url).trim();
  try {
    s = decodeURIComponent(s);
  } catch {
    /* keep the raw string */
  }
  // Collapse repeated slashes so "//" padding cannot split a marker.
  return `${s.toLowerCase().replace(/\\/g, "/").replace(/\/{2,}/g, "/")}/`;
}

/** The blocked source a URL belongs to, or null. */
export function blockedOutboundSource(url: string | URL): BlockedOutboundSource | null {
  const n = normalize(typeof url === "string" ? url : url.href);
  return BLOCKED_OUTBOUND_SOURCES.find((b) => b.markers.some((m) => n.includes(m))) ?? null;
}

class BlockedOutboundSourceError extends Error {
  constructor(public readonly source: BlockedOutboundSource) {
    super(`Refused: ${source.licenseSource} is not used by AcreOS (${source.decision} ${source.decidedOn}).`);
    this.name = "BlockedOutboundSourceError";
  }
}

/** Throws BlockedOutboundSourceError when the URL is a blocked source. */
export function assertOutboundAllowed(url: string | URL): void {
  const b = blockedOutboundSource(url);
  if (b) throw new BlockedOutboundSourceError(b);
}
