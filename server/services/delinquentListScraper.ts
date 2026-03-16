/**
 * County Tax Delinquent Auto-Scraper — Epic H
 *
 * Automates fetching of publicly available delinquent tax lists from counties
 * that publish them via Socrata APIs (no key required).
 *
 * Supported counties:
 *   - Philadelphia, PA (Socrata)
 *   - King County, WA (Socrata)
 *   - Norfolk, VA (Socrata)
 *   - Milwaukee, WI (Socrata)
 *
 * Output format matches the existing NormalizedDelinquentRecord format
 * used by taxDelinquentPipeline.ts.
 */

export interface NormalizedDelinquentRecord {
  ownerName: string;
  propertyAddress: string;
  parcelId: string | null;
  delinquentAmount: number;
  taxYear: number | null;
  mailingAddress: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  county: string;
  countyState: string;
  dataSourceUrl: string;
  scrapedAt: string;
}

export interface AutoScrapeSource {
  county: string;
  state: string;
  socrataUrl: string;
  fieldMap: {
    ownerName: string;
    propertyAddress: string;
    parcelId?: string;
    delinquentAmount: string;
    taxYear?: string;
    mailingAddress?: string;
    city?: string;
    state?: string;
    zip?: string;
  };
  description: string;
}

export interface AutoScrapeResult {
  county: string;
  state: string;
  recordCount: number;
  records: NormalizedDelinquentRecord[];
  scrapedAt: string;
  success: boolean;
  error?: string;
}

// Registry of supported auto-scrape sources
export const AUTO_SCRAPE_SOURCES: AutoScrapeSource[] = [
  {
    county: "Philadelphia",
    state: "PA",
    socrataUrl: "https://data.phila.gov/resource/s6vy-dxh9.json?$limit=1000&$where=total_due>0",
    fieldMap: {
      ownerName: "owner_name",
      propertyAddress: "address",
      parcelId: "parcel_number",
      delinquentAmount: "total_due",
      taxYear: "tax_period",
      mailingAddress: "mailing_address",
      city: "mailing_city",
      state: "mailing_state",
      zip: "mailing_zip",
    },
    description: "Philadelphia, PA — City of Philadelphia Delinquent Real Estate Tax List (Socrata)",
  },
  {
    county: "King",
    state: "WA",
    socrataUrl: "https://data.kingcounty.gov/resource/xayd-hgqm.json?$limit=1000",
    fieldMap: {
      ownerName: "taxpayer_name",
      propertyAddress: "prop_address",
      parcelId: "parcel_number",
      delinquentAmount: "delinquent_amount",
      taxYear: "tax_year",
      mailingAddress: "mailing_address",
      city: "mailing_city",
      state: "mailing_state",
      zip: "mailing_zip",
    },
    description: "King County, WA — Property Tax Delinquency (Socrata)",
  },
  {
    county: "Norfolk",
    state: "VA",
    socrataUrl: "https://data.norfolk.gov/resource/delinquent-taxes.json?$limit=1000",
    fieldMap: {
      ownerName: "owner",
      propertyAddress: "situs_address",
      parcelId: "parcel_id",
      delinquentAmount: "total_delinquent",
      mailingAddress: "owner_address",
      city: "owner_city",
      state: "owner_state",
      zip: "owner_zip",
    },
    description: "Norfolk, VA — Real Estate Delinquent Taxes (Socrata)",
  },
  {
    county: "Milwaukee",
    state: "WI",
    socrataUrl: "https://data.milwaukee.gov/resource/delinquent-property-taxes.json?$limit=1000",
    fieldMap: {
      ownerName: "owner_name",
      propertyAddress: "property_address",
      parcelId: "tax_key",
      delinquentAmount: "total_owed",
      taxYear: "year",
      mailingAddress: "mailing_address",
      city: "mailing_city",
      state: "mailing_state",
      zip: "mailing_zip",
    },
    description: "Milwaukee, WI — Delinquent Property Taxes (Socrata)",
  },
];

export function findAutoScrapeSource(county: string, state: string): AutoScrapeSource | null {
  const normalizedCounty = county.trim().toLowerCase().replace(/\s*county\s*$/i, "");
  const normalizedState = state.trim().toUpperCase();
  return AUTO_SCRAPE_SOURCES.find(s =>
    s.county.toLowerCase() === normalizedCounty &&
    s.state.toUpperCase() === normalizedState
  ) || null;
}

export async function scrapeCountyDelinquentList(
  source: AutoScrapeSource
): Promise<AutoScrapeResult> {
  const scrapedAt = new Date().toISOString();

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    const resp = await fetch(source.socrataUrl, {
      headers: {
        "Accept": "application/json",
        "X-App-Token": process.env.SOCRATA_APP_TOKEN || "", // optional but improves rate limits
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!resp.ok) {
      throw new Error(`Socrata API returned ${resp.status}: ${resp.statusText}`);
    }

    const rawData: Record<string, any>[] = await resp.json();

    const records: NormalizedDelinquentRecord[] = rawData
      .map(row => normalizeRecord(row, source))
      .filter(r => r.ownerName && r.delinquentAmount > 0);

    return {
      county: source.county,
      state: source.state,
      recordCount: records.length,
      records,
      scrapedAt,
      success: true,
    };
  } catch (err: any) {
    return {
      county: source.county,
      state: source.state,
      recordCount: 0,
      records: [],
      scrapedAt,
      success: false,
      error: err.message || "Scrape failed",
    };
  }
}

function normalizeRecord(
  row: Record<string, any>,
  source: AutoScrapeSource
): NormalizedDelinquentRecord {
  const fm = source.fieldMap;
  const delinquentAmount = parseFloat(String(row[fm.delinquentAmount] || "0").replace(/[$,]/g, "")) || 0;
  const taxYear = fm.taxYear && row[fm.taxYear]
    ? parseInt(String(row[fm.taxYear]).substring(0, 4)) || null
    : null;

  return {
    ownerName: String(row[fm.ownerName] || "").trim(),
    propertyAddress: String(row[fm.propertyAddress] || "").trim(),
    parcelId: fm.parcelId ? String(row[fm.parcelId] || "").trim() || null : null,
    delinquentAmount,
    taxYear,
    mailingAddress: fm.mailingAddress ? String(row[fm.mailingAddress] || "").trim() || null : null,
    city: fm.city ? String(row[fm.city] || "").trim() || null : null,
    state: fm.state ? String(row[fm.state] || "").trim() || null : source.state,
    zip: fm.zip ? String(row[fm.zip] || "").trim() || null : null,
    county: source.county,
    countyState: `${source.county}, ${source.state}`,
    dataSourceUrl: source.socrataUrl,
    scrapedAt: new Date().toISOString(),
  };
}

/**
 * Auto-scrape all supported counties in parallel.
 * Run weekly via scheduled job.
 */
export async function scrapeAllSupportedCounties(): Promise<AutoScrapeResult[]> {
  const results = await Promise.allSettled(
    AUTO_SCRAPE_SOURCES.map(source => scrapeCountyDelinquentList(source))
  );
  return results.map(r => r.status === "fulfilled" ? r.value : {
    county: "Unknown", state: "", recordCount: 0, records: [], scrapedAt: new Date().toISOString(),
    success: false, error: "Promise rejected",
  });
}
