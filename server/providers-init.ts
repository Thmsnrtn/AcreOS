/**
 * Register all data providers on server boot.
 * Import this from server/index.ts to initialize the provider registry.
 */
import { providerRegistry } from "./services/providers/provider-registry";
import { openDataProvider } from "./services/providers/open-data-provider";
import { countyGisProvider } from "./services/providers/county-gis-provider";
import { regridProvider } from "./services/providers/regrid-provider";
import { attomProvider } from "./services/providers/attom-provider";
import { batchdataProvider } from "./services/providers/batchdata-provider";
import { logger } from "./utils/logger";

export function initializeProviders(): void {
  logger.info("Initializing data providers", { source: "providers-init" });

  // County GIS — free tier, priority 5 (tried FIRST for parcel/owner data).
  // Rosy River B10: this is the mechanical Regrid demotion. For
  // parcel_data + owner_info, county_gis runs before Regrid by virtue
  // of being a free-tier provider (registry sorts free → starter → pro
  // before applying priority).
  for (const category of countyGisProvider.categories) {
    providerRegistry.register(category, countyGisProvider, 5);
  }

  // Open Data — free tier, priority 10 (environmental categories only;
  // doesn't compete with county_gis or Regrid on parcel_data).
  for (const category of openDataProvider.categories) {
    providerRegistry.register(category, openDataProvider, 10);
  }

  // Regrid — starter tier (paid, 3–8¢ per lookup). Now demoted to
  // fallback for parcel_data + owner_info; only fires when county_gis
  // returns no match or errors.
  for (const category of regridProvider.categories) {
    providerRegistry.register(category, regridProvider, 30);
  }

  // ATTOM — pro tier (most expensive).
  for (const category of attomProvider.categories) {
    providerRegistry.register(category, attomProvider, 50);
  }

  // BatchData — starter tier, 3–15¢ per lookup. Cherry-picked from the
  // production-polish branch where it had been sitting as an
  // implemented-but-unwired provider. Slots between Regrid (priority 30)
  // and ATTOM (priority 50) for property_details / skip_trace /
  // owner_info. Only fires when BATCHDATA_API_KEY is set, so adding to
  // the registry is safe even before the operator provisions credentials.
  for (const category of batchdataProvider.categories) {
    providerRegistry.register(category, batchdataProvider, 40);
  }

  logger.info("Data providers initialized", { source: "providers-init" });
}
