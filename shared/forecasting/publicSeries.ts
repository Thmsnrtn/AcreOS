/**
 * The public series the forecasting models read — the vintage recorder's
 * population (W4 stage 0).
 *
 * Every series here is (a) free, (b) public domain at its origin, and (c)
 * fetched through a sanctioned route: an official API with a free key, or an
 * official bulk download directory. Anything whose terms forbid commercial use
 * is NOT here — the Philadelphia Fed state coincident indexes on FRED were the
 * obvious cycle input, and they are third-party copyrighted "for non-commercial
 * educational or personal use" without written permission (FRED legal page,
 * read 2026-10-11), so the cycle model uses BLS payroll employment instead.
 *
 * HOW A VALUE IS KNOWN (`vintage`):
 *   - "alfred":       FRED/ALFRED keep every past release, so the value as
 *                     known on any date can be reconstructed exactly;
 *   - "recorded":     the source keeps only its latest numbers, so the only
 *                     vintage that exists is the one AcreOS records when it
 *                     fetches — which is why the recorder must start now;
 *   - "release-lag":  no past releases are kept AND AcreOS has no recording
 *                     yet, so a backtest treats a value as known from its
 *                     usual release date (stated per series) and says so.
 *
 * Browser-safe (no I/O, no process.env).
 */

/** 50 states + DC, with the census region used for display grouping. */
export const STATES: ReadonlyArray<{ code: string; fips: string; name: string }> = [
  { code: "AL", fips: "01", name: "Alabama" }, { code: "AK", fips: "02", name: "Alaska" },
  { code: "AZ", fips: "04", name: "Arizona" }, { code: "AR", fips: "05", name: "Arkansas" },
  { code: "CA", fips: "06", name: "California" }, { code: "CO", fips: "08", name: "Colorado" },
  { code: "CT", fips: "09", name: "Connecticut" }, { code: "DE", fips: "10", name: "Delaware" },
  { code: "DC", fips: "11", name: "District of Columbia" }, { code: "FL", fips: "12", name: "Florida" },
  { code: "GA", fips: "13", name: "Georgia" }, { code: "HI", fips: "15", name: "Hawaii" },
  { code: "ID", fips: "16", name: "Idaho" }, { code: "IL", fips: "17", name: "Illinois" },
  { code: "IN", fips: "18", name: "Indiana" }, { code: "IA", fips: "19", name: "Iowa" },
  { code: "KS", fips: "20", name: "Kansas" }, { code: "KY", fips: "21", name: "Kentucky" },
  { code: "LA", fips: "22", name: "Louisiana" }, { code: "ME", fips: "23", name: "Maine" },
  { code: "MD", fips: "24", name: "Maryland" }, { code: "MA", fips: "25", name: "Massachusetts" },
  { code: "MI", fips: "26", name: "Michigan" }, { code: "MN", fips: "27", name: "Minnesota" },
  { code: "MS", fips: "28", name: "Mississippi" }, { code: "MO", fips: "29", name: "Missouri" },
  { code: "MT", fips: "30", name: "Montana" }, { code: "NE", fips: "31", name: "Nebraska" },
  { code: "NV", fips: "32", name: "Nevada" }, { code: "NH", fips: "33", name: "New Hampshire" },
  { code: "NJ", fips: "34", name: "New Jersey" }, { code: "NM", fips: "35", name: "New Mexico" },
  { code: "NY", fips: "36", name: "New York" }, { code: "NC", fips: "37", name: "North Carolina" },
  { code: "ND", fips: "38", name: "North Dakota" }, { code: "OH", fips: "39", name: "Ohio" },
  { code: "OK", fips: "40", name: "Oklahoma" }, { code: "OR", fips: "41", name: "Oregon" },
  { code: "PA", fips: "42", name: "Pennsylvania" }, { code: "RI", fips: "44", name: "Rhode Island" },
  { code: "SC", fips: "45", name: "South Carolina" }, { code: "SD", fips: "46", name: "South Dakota" },
  { code: "TN", fips: "47", name: "Tennessee" }, { code: "TX", fips: "48", name: "Texas" },
  { code: "UT", fips: "49", name: "Utah" }, { code: "VT", fips: "50", name: "Vermont" },
  { code: "VA", fips: "51", name: "Virginia" }, { code: "WA", fips: "53", name: "Washington" },
  { code: "WV", fips: "54", name: "West Virginia" }, { code: "WI", fips: "55", name: "Wisconsin" },
  { code: "WY", fips: "56", name: "Wyoming" },
];

export const STATE_CODES: readonly string[] = STATES.map((s) => s.code);

export type SeriesFamilyId =
  | "state_payrolls"
  | "state_unemployment"
  | "state_permits_nsa"
  | "state_ag_land_value";

export interface PublicSeriesFamily {
  id: SeriesFamilyId;
  label: string;
  /** Data-licence register key (server/services/providers/data-licenses.ts). */
  licenseSource: string;
  /** Who publishes it at origin. */
  publisher: string;
  frequency: "monthly" | "annual";
  unit: string;
  /** Series id for a state (the id the vintage table stores). */
  seriesIdFor(state: string): string;
  /** The free key the fetch needs, or null when keyless. */
  keyEnv: "FRED_API_KEY" | "NASS_API_KEY" | null;
  /** How a past value is known — see the header. */
  vintage: "alfred" | "recorded" | "release-lag";
  /** Usual delay from the end of the period to first release, in days. */
  releaseLagDays: number;
  /** The model ids (models.ts) that read it. Empty = recorded for later. */
  usedBy: readonly string[];
  /** The governing terms, as read. */
  terms: string;
}

export const PUBLIC_SERIES: readonly PublicSeriesFamily[] = [
  {
    id: "state_payrolls",
    label: "All employees, total nonfarm (seasonally adjusted, thousands)",
    licenseSource: "FRED/ALFRED (BLS CES)",
    publisher: "U.S. Bureau of Labor Statistics, Current Employment Statistics (State and Area)",
    frequency: "monthly",
    unit: "thousands of jobs",
    seriesIdFor: (st) => `${st}NA`,
    keyEnv: "FRED_API_KEY",
    vintage: "alfred",
    releaseLagDays: 50,
    usedBy: ["cycle_phase_payrolls"],
    terms: "BLS data are public domain; FRED asks that FRED be cited and that automated retrieval use the FRED API (free key), not the website.",
  },
  {
    id: "state_unemployment",
    label: "Unemployment rate (seasonally adjusted, percent)",
    licenseSource: "FRED/ALFRED (BLS LAUS)",
    publisher: "U.S. Bureau of Labor Statistics, Local Area Unemployment Statistics",
    frequency: "monthly",
    unit: "percent",
    seriesIdFor: (st) => `${st}UR`,
    keyEnv: "FRED_API_KEY",
    vintage: "alfred",
    releaseLagDays: 50,
    usedBy: [],
    terms: "BLS data are public domain; retrieved through the FRED API (free key).",
  },
  {
    id: "state_permits_nsa",
    label: "New private housing units authorized by building permits (not seasonally adjusted)",
    licenseSource: "US Census BPS",
    publisher: "U.S. Census Bureau, Building Permits Survey",
    frequency: "monthly",
    unit: "housing units",
    seriesIdFor: (st) => `BPS:${st}:UNITS_NSA`,
    keyEnv: null,
    vintage: "recorded",
    releaseLagDays: 35,
    usedBy: ["seasonal_prior_permits"],
    terms: "Census Bureau data are public domain (17 U.S.C. §105); the monthly state files are an official download directory.",
  },
  {
    id: "state_ag_land_value",
    label: "Agricultural land incl. buildings, average value ($/acre), annual survey",
    licenseSource: "USDA NASS",
    publisher: "USDA National Agricultural Statistics Service, Land Values Survey",
    frequency: "annual",
    unit: "USD per acre",
    seriesIdFor: (st) => `NASS:${st}:AG_LAND_VALUE`,
    keyEnv: "NASS_API_KEY",
    vintage: "release-lag",
    // The Land Values summary is released in early August for the same year.
    releaseLagDays: -150,
    usedBy: ["ag_land_value_growth"],
    terms: "USDA NASS data are public domain; Quick Stats API needs a free key, bulk files are an official download.",
  },
];

export function seriesFamily(id: SeriesFamilyId): PublicSeriesFamily {
  const f = PUBLIC_SERIES.find((s) => s.id === id);
  if (!f) throw new Error(`unknown series family ${id}`);
  return f;
}

/** Which family a stored series id belongs to, or null. */
export function familyOfSeriesId(seriesId: string): PublicSeriesFamily | null {
  for (const f of PUBLIC_SERIES) {
    for (const st of STATE_CODES) if (f.seriesIdFor(st) === seriesId) return f;
  }
  return null;
}

/** The state a stored series id is for, or null. */
export function stateOfSeriesId(seriesId: string): string | null {
  for (const f of PUBLIC_SERIES) {
    for (const st of STATE_CODES) if (f.seriesIdFor(st) === seriesId) return st;
  }
  return null;
}
