/**
 * The county the EDDM map opens on: the org's first ACTIVE target county,
 * else its first target county, else Hidalgo, TX (the dev seed's county).
 * Pure, so the rule is testable without the map.
 */
export interface TargetCountyLite {
  name: string;
  state: string;
  status?: string | null;
}

export function eddmDefaultCounty(counties: readonly TargetCountyLite[] | null | undefined): { state: string; county: string } {
  const list = counties ?? [];
  const pick = list.find((c) => c.status === "active") ?? list[0];
  if (!pick) return { state: "TX", county: "Hidalgo" };
  return { state: pick.state.trim().toUpperCase(), county: pick.name.replace(/\s+county$/i, "").trim() };
}
