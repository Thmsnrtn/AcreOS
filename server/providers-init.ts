/**
 * Register all data providers on server boot.
 * Import this from server/index.ts to initialize the provider registry.
 */
import { providerRegistry } from "./services/providers/provider-registry";
import { openDataProvider } from "./services/providers/open-data-provider";
import { regridProvider } from "./services/providers/regrid-provider";
import { attomProvider } from "./services/providers/attom-provider";
import { batchdataProvider } from "./services/providers/batchdata-provider";
import type { DataCategory } from "./services/providers/types";
import { logger } from "./utils/logger";

export function initializeProviders(): void {
  logger.info("Initializing data providers", { source: "providers-init" });

  // Open Data — free tier, lowest priority (tried first)
  for (const category of openDataProvider.categories) {
    providerRegistry.register(category, openDataProvider, 10);
  }

  // Regrid — starter tier
  for (const category of regridProvider.categories) {
    providerRegistry.register(category, regridProvider, 30);
  }

  // ATTOM — pro tier
  for (const category of attomProvider.categories) {
    providerRegistry.register(category, attomProvider, 50);
  }

  // BatchData — starter/pro tier
  for (const category of batchdataProvider.categories) {
    providerRegistry.register(category, batchdataProvider, 40);
  }

  logger.info("Data providers initialized", { source: "providers-init" });
}
