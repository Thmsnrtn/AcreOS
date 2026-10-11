/**
 * Collateral watch reads the tax status where the county-gis provider really
 * puts it. The provider returns the PARCEL as `result.data`; the tax status is
 * on `parcel.data`. Reading `result.data.taxStatus` (the shape W5a shipped
 * with) is always undefined — a watch that says "Watched daily" and can never
 * alert. This drives the REAL provider (only the county query is stubbed) and
 * feeds its output to the job's reader.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/db", () => ({ db: {} }));
vi.mock("../../server/services/parcel", () => ({
  lookupFromCountyGIS: vi.fn(async (apn: string) => ({
    found: true,
    parcel: {
      apn,
      boundary: { type: "Polygon", coordinates: [] },
      centroid: { lat: 35, lng: -85 },
      data: { regridId: "", owner: "SMITH JOHN", ownerAddress: "", taxAmount: "", lastUpdated: "2026-10-01", taxStatus: "DELINQUENT 2025" },
    },
  })),
}));

import { countyGisProvider } from "../../server/services/providers/county-gis-provider";
import { classifyTaxStatus, taxStatusOfCountyGisParcel } from "../../shared/trust/collateralWatch";

describe("collateral watch: the provider's real output reaches the classifier", () => {
  it("a county reporting delinquency is read as delinquent", async () => {
    const result = await countyGisProvider.lookup("parcel_data", { type: "apn", apn: "123-4", state: "TN", county: "Hamilton" } as never);
    const value = taxStatusOfCountyGisParcel(result.data);
    expect(value).toBe("DELINQUENT 2025");
    expect(classifyTaxStatus(value)).toBe("delinquent");
  });
  it("no status on the parcel is null, never a reading", () => {
    expect(taxStatusOfCountyGisParcel({ data: {} })).toBeNull();
    expect(taxStatusOfCountyGisParcel(null)).toBeNull();
  });
});
