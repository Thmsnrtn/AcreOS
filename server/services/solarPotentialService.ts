/**
 * Solar Leasing Potential Calculator — Epic E
 *
 * Uses NREL National Solar Radiation Database (NSRDB) API (free with key):
 *   - Global Horizontal Irradiance (GHI)
 *   - Annual sun hours, capacity factor
 *
 * Scoring criteria:
 *   - GHI >5.5 kWh/m²/day = "excellent" solar potential
 *   - Zoning: agricultural = favorable for utility solar
 *   - Acreage >40 acres = utility-scale lease viable
 *   - Not in flood zone AE = panel foundation feasible
 *
 * Output: solarLeaseEstimate ($/acre/year), solarViabilityScore (0-100)
 *
 * Inspired by Nite Cap episode featuring Dakota Malone on solar leases
 * as a passive income overlay on raw land.
 */

export interface SolarPotentialInput {
  lat: number;
  lng: number;
  acres: number;
  state: string;
  zoning?: string; // "agricultural", "residential", "commercial", "industrial"
  floodZone?: string; // FEMA flood zone designation
}

export interface SolarPotentialResult {
  solarViabilityScore: number; // 0-100
  solarTier: "excellent" | "good" | "moderate" | "poor" | "unfeasible";
  ghi: number | null; // Global Horizontal Irradiance (kWh/m²/day)
  annualSunHours: number | null;
  capacityFactor: number | null; // 0-1
  solarLeaseEstimatePerAcre: { low: number; high: number }; // $/acre/year
  totalLeaseEstimate: { low: number; high: number }; // $/year for full parcel
  utilitySolarViable: boolean; // acreage >40 + excellent irradiance
  keyFactors: string[];
  warnings: string[];
  dataSource: "NREL NSRDB" | "Estimated" | "Error";
}

const NREL_API_KEY = process.env.NREL_API_KEY || "DEMO_KEY";
const NREL_BASE = "https://developer.nrel.gov/api/solar";

// Solar lease typical ranges $/acre/year by state tier
const SOLAR_LEASE_RATES: Record<string, { low: number; high: number }> = {
  CA: { low: 1200, high: 2500 },
  TX: { low: 800, high: 1800 },
  AZ: { low: 1000, high: 2000 },
  NV: { low: 900, high: 1900 },
  NM: { low: 700, high: 1500 },
  FL: { low: 700, high: 1500 },
  NC: { low: 600, high: 1400 },
  SC: { low: 600, high: 1300 },
  GA: { low: 500, high: 1200 },
  VA: { low: 500, high: 1200 },
  CO: { low: 600, high: 1400 },
  UT: { low: 700, high: 1600 },
  ID: { low: 500, high: 1100 },
  OR: { low: 400, high: 1000 },
  WA: { low: 350, high: 900 },
  DEFAULT: { low: 500, high: 1200 },
};

export async function calculateSolarPotential(
  input: SolarPotentialInput
): Promise<SolarPotentialResult> {
  const { lat, lng, acres, state, zoning, floodZone } = input;
  const keyFactors: string[] = [];
  const warnings: string[] = [];

  let ghi: number | null = null;
  let annualSunHours: number | null = null;
  let capacityFactor: number | null = null;
  let dataSource: SolarPotentialResult["dataSource"] = "Estimated";

  // Fetch NREL NSRDB data
  try {
    const url = `${NREL_BASE}/nsrdb_psm3_download.json?lat=${lat}&lon=${lng}&api_key=${NREL_API_KEY}&wkt=POINT(${lng}+${lat})&names=2022&leap_day=false&interval=60&utc=false&email=data@acreos.io&mailing_list=false`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (resp.ok) {
      const data = await resp.json();
      // NSRDB summary stats
      const outputs = data.outputs || {};
      ghi = outputs.avg_ghi || outputs.ghi || null;
      annualSunHours = ghi ? Math.round(ghi * 365) : null;
      capacityFactor = outputs.capacity_factor || (ghi ? ghi / 24 : null);
      dataSource = "NREL NSRDB";
    }
  } catch {
    // Fall back to estimate based on latitude
    ghi = estimateGHIFromLatitude(lat, state);
    annualSunHours = ghi ? Math.round(ghi * 365) : null;
    capacityFactor = ghi ? ghi / 24 : null;
    dataSource = "Estimated";
  }

  // Score computation
  let score = 30; // base

  // GHI scoring
  if (ghi !== null) {
    if (ghi >= 5.5) {
      score += 35;
      keyFactors.push(`Excellent solar irradiance: ${ghi.toFixed(2)} kWh/m²/day (>5.5 = utility-grade)`);
    } else if (ghi >= 4.5) {
      score += 22;
      keyFactors.push(`Good solar irradiance: ${ghi.toFixed(2)} kWh/m²/day`);
    } else if (ghi >= 3.5) {
      score += 10;
      keyFactors.push(`Moderate solar irradiance: ${ghi.toFixed(2)} kWh/m²/day`);
    } else {
      score -= 10;
      warnings.push(`Low solar irradiance: ${ghi.toFixed(2)} kWh/m²/day — may not justify utility-scale investment`);
    }
  }

  // Acreage scoring
  if (acres >= 100) {
    score += 20;
    keyFactors.push(`Large parcel (${acres} acres) — utility-scale solar viable (typically $${(acres * 1000).toLocaleString()}-$${(acres * 2000).toLocaleString()}/yr lease value)`);
  } else if (acres >= 40) {
    score += 15;
    keyFactors.push(`Adequate size (${acres} acres) for utility-scale solar lease`);
  } else if (acres >= 10) {
    score += 5;
    keyFactors.push(`Community solar scale (${acres} acres) — limited utility-scale options`);
  } else {
    score -= 10;
    warnings.push(`Small parcel (${acres} acres) — utility solar requires >40 acres typically`);
  }

  // Zoning
  const zoneLower = (zoning || "").toLowerCase();
  if (zoneLower.includes("agri") || zoneLower.includes("rural") || zoneLower === "ag") {
    score += 10;
    keyFactors.push("Agricultural zoning favorable for utility solar (compatible use in most states)");
  } else if (zoneLower.includes("commercial") || zoneLower.includes("industrial")) {
    score += 8;
    keyFactors.push("Commercial/industrial zoning compatible with ground-mount solar");
  } else if (zoneLower.includes("residential")) {
    score -= 5;
    warnings.push("Residential zoning may restrict utility solar — verify with county");
  }

  // Flood zone
  const highRiskZones = ["AE", "VE", "A", "AH", "AO"];
  const isHighFloodRisk = highRiskZones.some(z => (floodZone || "").toUpperCase().startsWith(z));
  if (isHighFloodRisk) {
    score -= 15;
    warnings.push(`Flood Zone ${floodZone} — panel foundation engineering required, may reduce developer interest`);
  } else if (floodZone) {
    score += 5;
    keyFactors.push(`Flood Zone ${floodZone} — acceptable for solar panel foundations`);
  }

  score = Math.max(0, Math.min(100, score));

  // Tier classification
  let solarTier: SolarPotentialResult["solarTier"];
  if (score >= 75) solarTier = "excellent";
  else if (score >= 60) solarTier = "good";
  else if (score >= 45) solarTier = "moderate";
  else if (score >= 30) solarTier = "poor";
  else solarTier = "unfeasible";

  // Lease estimate
  const stateRates = SOLAR_LEASE_RATES[state.toUpperCase()] || SOLAR_LEASE_RATES.DEFAULT;
  const ghiMultiplier = ghi ? Math.min(1.5, ghi / 5.0) : 1.0;

  const leasePerAcre = {
    low: Math.round(stateRates.low * ghiMultiplier),
    high: Math.round(stateRates.high * ghiMultiplier),
  };

  const leasableAcres = Math.max(0, acres - 2); // typical setback buffer
  const totalLease = {
    low: Math.round(leasePerAcre.low * leasableAcres),
    high: Math.round(leasePerAcre.high * leasableAcres),
  };

  const utilitySolarViable = acres >= 40 && (ghi === null || ghi >= 4.5);

  return {
    solarViabilityScore: score,
    solarTier,
    ghi,
    annualSunHours,
    capacityFactor,
    solarLeaseEstimatePerAcre: leasePerAcre,
    totalLeaseEstimate: totalLease,
    utilitySolarViable,
    keyFactors,
    warnings,
    dataSource,
  };
}

function estimateGHIFromLatitude(lat: number, state: string): number {
  // Rough GHI estimates by latitude band and state
  const stateBonus: Record<string, number> = {
    AZ: 0.8, NV: 0.7, NM: 0.6, CA: 0.5, TX: 0.4, UT: 0.3, CO: 0.2,
    FL: 0.3, GA: 0.2, SC: 0.2, NC: 0.1, VA: 0.0,
  };
  const bonus = stateBonus[state.toUpperCase()] || 0;
  const latFactor = Math.max(2.5, 7.0 - Math.abs(lat - 20) * 0.08);
  return Math.round((latFactor + bonus) * 100) / 100;
}
