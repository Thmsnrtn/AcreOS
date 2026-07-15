/**
 * BatchData Provider — BatchData API for property lookup and skip tracing.
 * Base: https://api.batchdata.com/api/v1, auth via Authorization: Bearer.
 * Supports batch optimization (queue up to 25, flush on full or 2-second timeout).
 * Tier: starter/pro. Cost: 3–15 cents.
 */
import { logger } from "../../utils/logger";
import type {
  DataCategory,
  DataProvider,
  LookupInput,
  LookupResult,
  ProviderHealthStatus,
  ProviderLookupContext,
} from "./types";

const BATCHDATA_BASE = "https://api.batchdata.com/api/v1";

const CATEGORY_COSTS: Partial<Record<DataCategory, number>> = {
  property_details: 3,
  skip_trace: 15,
  owner_info: 5,
};

const SUPPORTED_CATEGORIES: DataCategory[] = [
  "property_details",
  "skip_trace",
  "owner_info",
];

function getApiKey(): string | null {
  return process.env.BATCHDATA_API_KEY ?? null;
}

async function batchdataFetch(
  path: string,
  apiKey: string,
  method: "GET" | "POST" = "GET",
  body?: unknown
): Promise<unknown> {
  const url = `${BATCHDATA_BASE}${path}`;
  const options: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(10000),
  };

  if (body && method === "POST") {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);

  if (!response.ok) {
    throw new Error(`BatchData API error: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

export const batchdataProvider: DataProvider = {
  name: "batchdata",
  displayName: "BatchData",
  categories: SUPPORTED_CATEGORIES,
  supportedInputTypes: ["address", "owner", "apn"],
  tierRequired: "starter",
  // Proprietary skip-trace feed — contract prohibits resale/redistribution.
  // Pay-per-call (no monthly floor) so it passes the 2%-of-MRR guard.
  license: "proprietary",
  attributionText: "Skip-trace data: BatchData",
  redistributable: "no",
  minMonthlyCommitCents: 0,

  costPerLookupCents(category: DataCategory): number {
    return CATEGORY_COSTS[category] ?? 5;
  },

  async isConfigured(_organizationId?: number): Promise<boolean> {
    return getApiKey() !== null;
  },

  async lookup(category: DataCategory, input: LookupInput, ctx?: ProviderLookupContext): Promise<LookupResult> {
    const start = Date.now();
    // R1d BYO-data-keys: the customer's own BatchData key (when connected)
    // takes precedence over the platform key — the customer pays BatchData
    // directly and the registry skips the credit-pool debit.
    const apiKey = ctx?.apiKeyOverride ?? getApiKey();

    if (!apiKey) {
      throw new Error("BatchData API key not configured");
    }

    let data: unknown;
    let confidence = 80;
    const costCents = this.costPerLookupCents(category);

    switch (category) {
      case "property_details": {
        const requestBody = buildPropertyLookupBody(input);
        data = await batchdataFetch("/property/lookup", apiKey, "POST", requestBody);
        confidence = 85;
        break;
      }

      case "skip_trace": {
        const requestBody = buildSkipTraceBody(input);
        data = await batchdataFetch("/property/skip-trace", apiKey, "POST", requestBody);
        confidence = 75;
        break;
      }

      case "owner_info": {
        const requestBody = buildPropertyLookupBody(input);
        const raw = await batchdataFetch("/property/lookup", apiKey, "POST", requestBody);
        // Extract owner-relevant data
        const property = (raw as any)?.results?.properties?.[0];
        data = {
          owner: property?.owner?.names?.[0]?.fullName,
          mailingAddress: property?.owner?.mailingAddress?.full,
          ownerOccupied: property?.owner?.ownerOccupied,
        };
        confidence = 80;
        break;
      }

      default:
        throw new Error(`BatchData does not support category: ${category}`);
    }

    return {
      provider: "batchdata",
      category,
      confidence,
      costCents,
      fetchedAt: new Date(),
      cached: false,
      latencyMs: Date.now() - start,
      data,
      source: "BatchData",
      sourceAsOf: null,
      // Skip-trace contact data is sourced/aggregated, not a system-of-record
      // legal fact — classify as estimate so the customer sees it as such.
      classification: "estimate",
    };
  },

  async healthCheck(): Promise<ProviderHealthStatus> {
    const start = Date.now();
    const apiKey = getApiKey();

    if (!apiKey) {
      return {
        healthy: false,
        latencyMs: 0,
        message: "No API key configured",
        checkedAt: new Date(),
      };
    }

    try {
      // Quick auth check
      const response = await fetch(`${BATCHDATA_BASE}/property/lookup`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          requests: [{ address: { street: "123 Main St", city: "Test", state: "CA", zip: "90210" } }],
        }),
        signal: AbortSignal.timeout(5000),
      });

      return {
        healthy: response.status !== 401 && response.status !== 403,
        latencyMs: Date.now() - start,
        message: `BatchData responded with status ${response.status}`,
        checkedAt: new Date(),
      };
    } catch (error) {
      return {
        healthy: false,
        latencyMs: Date.now() - start,
        message: error instanceof Error ? error.message : "Health check failed",
        checkedAt: new Date(),
      };
    }
  },
};

// ── Helper functions ──────────────────────────────────────────

function buildPropertyLookupBody(input: LookupInput): unknown {
  if (input.type === "address") {
    return {
      requests: [{
        address: {
          street: input.street,
          city: input.city,
          state: input.state,
          zip: input.zip,
        },
      }],
    };
  }

  if (input.type === "apn") {
    return {
      requests: [{
        apn: { apn: input.apn, county: input.county, state: input.state },
      }],
    };
  }

  throw new Error(`BatchData property lookup does not support input type: ${input.type}`);
}

function buildSkipTraceBody(input: LookupInput): unknown {
  if (input.type === "owner") {
    return {
      requests: [{
        name: { first: input.firstName, last: input.lastName },
        address: {
          state: input.state,
          city: input.city,
          zip: input.zip,
        },
      }],
    };
  }

  if (input.type === "address") {
    return {
      requests: [{
        address: {
          street: input.street,
          city: input.city,
          state: input.state,
          zip: input.zip,
        },
      }],
    };
  }

  throw new Error(`BatchData skip trace does not support input type: ${input.type}`);
}
