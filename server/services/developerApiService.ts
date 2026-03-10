// @ts-nocheck
/**
 * Public Developer API & Ecosystem (EPIC 8)
 *
 * AcreOS becomes the connectivity layer for land investing software:
 *   - The way Stripe is for payments in commerce
 *   - The way Twilio is for communications
 *   - The way Plaid is for financial data
 *
 * Land investing is a fragmented ecosystem. AcreOS becomes the infrastructure.
 *
 * Revenue model:
 *   - Free: 1,000 API calls/day (generous to attract builders)
 *   - Pro: 50,000 calls/day ($99/month)
 *   - Business: 500,000 calls/day ($499/month)
 *   - Enterprise: Unlimited + SLA ($1,999+/month)
 *   - Data Licensing: Market data API ($10k–$100k/year for funds/REITs)
 */

import { createHash, createHmac, randomBytes } from "crypto";
import { db } from "../db";
import { organizationIntegrations, organizations } from "@shared/schema";
import { eq, and } from "drizzle-orm";

// ---------------------------------------------------------------------------
// API Key Management
// ---------------------------------------------------------------------------

export interface ApiKey {
  keyId: string; // Public identifier (shown to user)
  keyHash: string; // SHA256 hash of the actual key (stored in DB)
  organizationId: number;
  name: string;
  scopes: ApiScope[];
  rateLimit: ApiRateLimit;
  isActive: boolean;
  createdAt: Date;
  lastUsedAt?: Date;
  expiresAt?: Date;
}

export type ApiScope =
  | "properties:read"
  | "properties:write"
  | "leads:read"
  | "leads:write"
  | "deals:read"
  | "deals:write"
  | "market:read"
  | "valuations:read"
  | "campaigns:read"
  | "campaigns:write"
  | "webhooks:read"
  | "webhooks:write"
  | "analytics:read";

export interface ApiRateLimit {
  requestsPerDay: number;
  requestsPerMinute: number;
  concurrentRequests: number;
}

const RATE_LIMITS: Record<string, ApiRateLimit> = {
  free: { requestsPerDay: 1000, requestsPerMinute: 10, concurrentRequests: 2 },
  starter: { requestsPerDay: 10000, requestsPerMinute: 30, concurrentRequests: 5 },
  pro: { requestsPerDay: 50000, requestsPerMinute: 100, concurrentRequests: 10 },
  scale: { requestsPerDay: 500000, requestsPerMinute: 500, concurrentRequests: 25 },
};

export function generateApiKey(): { publicKeyId: string; secretKey: string; keyHash: string } {
  const keyId = `acr_${randomBytes(8).toString("hex")}`;
  const secret = randomBytes(32).toString("hex");
  const secretKey = `${keyId}_${secret}`;
  const keyHash = createHash("sha256").update(secretKey).digest("hex");
  return { publicKeyId: keyId, secretKey, keyHash };
}

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

// ---------------------------------------------------------------------------
// Webhook Event Types (expanded for EPIC 8)
// ---------------------------------------------------------------------------

export type ExtendedWebhookEventType =
  // Lead events
  | "lead.created"
  | "lead.updated"
  | "lead.status_changed"
  | "lead.score_changed"
  | "lead.skip_traced"
  | "lead.offer_generated"

  // Deal events
  | "deal.created"
  | "deal.stage_changed"
  | "deal.offer_sent"
  | "deal.offer_accepted"
  | "deal.offer_rejected"
  | "deal.under_contract"
  | "deal.closed"
  | "deal.fell_through"

  // Market events
  | "market.county_alert"
  | "market.opportunity_score_changed"
  | "market.lead_indicator_detected"

  // Campaign events
  | "campaign.response"
  | "campaign.completed"
  | "sequence.touch_sent"
  | "sequence.reply_received"

  // Financial events
  | "payment.received"
  | "payment.overdue"
  | "payment.failed"
  | "note.delinquent"
  | "exchange_1031.deadline_approaching"
  | "exchange_1031.identification_due"

  // Portfolio events
  | "portfolio.property_added"
  | "portfolio.valuation_updated"

  // System events
  | "deal_hunter.hot_deal_found"
  | "autonomous_machine.morning_briefing_sent"
  | "county_assessor.ingest_completed";

export interface WebhookDelivery {
  id: string;
  eventType: ExtendedWebhookEventType;
  organizationId: number;
  endpointUrl: string;
  payload: Record<string, any>;
  signature: string;
  status: "pending" | "delivered" | "failed" | "retrying";
  attempt: number;
  responseCode?: number;
  responseBody?: string;
  deliveredAt?: Date;
  nextRetryAt?: Date;
}

export function buildWebhookPayload(
  eventType: ExtendedWebhookEventType,
  organizationId: number,
  data: Record<string, any>
): { payload: Record<string, any>; rawJson: string } {
  const payload = {
    id: `evt_${randomBytes(8).toString("hex")}`,
    type: eventType,
    created: Math.floor(Date.now() / 1000),
    livemode: process.env.NODE_ENV === "production",
    organization_id: organizationId,
    api_version: "2024-01",
    data: {
      object: data,
    },
    // AcreOS-specific metadata
    acreos: {
      platform: "acreos",
      version: process.env.npm_package_version || "1.0.0",
    },
  };
  const rawJson = JSON.stringify(payload, null, 2);
  return { payload, rawJson };
}

export function signWebhookPayload(rawJson: string, secret: string): string {
  const timestamp = Math.floor(Date.now() / 1000);
  const signedPayload = `${timestamp}.${rawJson}`;
  const signature = createHmac("sha256", secret).update(signedPayload).digest("hex");
  return `t=${timestamp},v1=${signature}`;
}

// ---------------------------------------------------------------------------
// Embeddable Widgets
//
// Third-party sites can embed AcreOS intelligence with a single script tag:
// <script src="https://app.acreos.com/embed.js" data-widget="deal-analyzer" data-key="pub_xxx"></script>
// ---------------------------------------------------------------------------

export interface EmbeddableWidget {
  widgetType: "deal_analyzer" | "market_heatmap" | "property_valuation" | "county_score";
  publicApiKey: string;
  config: Record<string, any>;
}

export function generateWidgetEmbedCode(widget: EmbeddableWidget): string {
  const appUrl = process.env.APP_URL || "https://app.acreos.com";
  const config = JSON.stringify(widget.config).replace(/'/g, "\\'");

  return `<!-- AcreOS ${widget.widgetType.replace("_", " ")} Widget -->
<div id="acreos-widget-${widget.widgetType}"></div>
<script>
  (function() {
    var script = document.createElement('script');
    script.src = '${appUrl}/embed/widget.js';
    script.setAttribute('data-widget', '${widget.widgetType}');
    script.setAttribute('data-key', '${widget.publicApiKey}');
    script.setAttribute('data-config', '${config}');
    script.setAttribute('data-container', 'acreos-widget-${widget.widgetType}');
    document.head.appendChild(script);
  })();
</script>
<!-- End AcreOS Widget -->`;
}

// ---------------------------------------------------------------------------
// OpenAPI Spec (v1)
// Enables Swagger/Redoc documentation generation
// ---------------------------------------------------------------------------

export const ACREOS_OPENAPI_SPEC = {
  openapi: "3.0.3",
  info: {
    title: "AcreOS Public API",
    version: "1.0.0",
    description: `
# AcreOS Land Investing Platform API

The AcreOS API gives developers programmatic access to the most powerful land investing intelligence platform.

## Authentication
All API requests require an API key in the Authorization header:
\`Authorization: Bearer acr_your_api_key\`

## Rate Limits
- Free: 1,000 requests/day
- Pro: 50,000 requests/day
- Enterprise: Unlimited

## Webhooks
Subscribe to real-time events via webhooks. All events are signed with HMAC-SHA256.
See the Webhooks section for the full event type list.
    `.trim(),
    contact: {
      name: "AcreOS Developer Support",
      url: "https://docs.acreos.com",
      email: "api@acreos.com",
    },
    license: { name: "Commercial", url: "https://acreos.com/terms" },
  },
  servers: [
    { url: "https://api.acreos.com/v1", description: "Production" },
    { url: "https://api-staging.acreos.com/v1", description: "Staging" },
  ],
  security: [{ BearerAuth: [] }],
  components: {
    securitySchemes: {
      BearerAuth: { type: "http", scheme: "bearer", description: "AcreOS API key" },
    },
    schemas: {
      Property: {
        type: "object",
        properties: {
          id: { type: "integer" },
          apn: { type: "string", description: "Assessor Parcel Number" },
          county: { type: "string" },
          state: { type: "string", maxLength: 2 },
          sizeAcres: { type: "number" },
          zoning: { type: "string" },
          assessedValue: { type: "number" },
          estimatedValue: { type: "number", description: "AcreOS AVM estimate" },
          hasRoadAccess: { type: "boolean" },
          hasUtilities: { type: "boolean" },
          floodZone: { type: "string" },
          latitude: { type: "number" },
          longitude: { type: "number" },
          createdAt: { type: "string", format: "date-time" },
        },
      },
      Lead: {
        type: "object",
        properties: {
          id: { type: "integer" },
          ownerName: { type: "string" },
          county: { type: "string" },
          state: { type: "string" },
          apn: { type: "string" },
          score: { type: "integer", minimum: 0, maximum: 100, description: "Seller motivation score" },
          status: { type: "string", enum: ["active", "contacted", "negotiating", "dead"] },
          taxDelinquent: { type: "boolean" },
          isOutOfState: { type: "boolean" },
          assessedValue: { type: "string" },
          source: { type: "string" },
          createdAt: { type: "string", format: "date-time" },
        },
      },
      Deal: {
        type: "object",
        properties: {
          id: { type: "integer" },
          title: { type: "string" },
          status: { type: "string", enum: ["prospect", "analyzing", "offer_sent", "under_contract", "closed", "dead"] },
          purchasePrice: { type: "string" },
          listPrice: { type: "string" },
          expectedCloseDate: { type: "string", format: "date" },
          closedDate: { type: "string", format: "date" },
          propertyId: { type: "integer" },
        },
      },
      CountyMarketData: {
        type: "object",
        properties: {
          state: { type: "string" },
          county: { type: "string" },
          avgPricePerAcre: { type: "number" },
          medianSalePrice: { type: "number" },
          salesVolume90Days: { type: "integer" },
          avgDaysOnMarket: { type: "integer" },
          opportunityScore: { type: "integer", minimum: 0, maximum: 100 },
          cyclePosition: { type: "string", enum: ["accumulation", "markup", "distribution", "markdown"] },
          lastUpdated: { type: "string", format: "date-time" },
        },
      },
      ValuationResult: {
        type: "object",
        properties: {
          estimatedValue: { type: "number" },
          confidenceScore: { type: "number", minimum: 0, maximum: 100 },
          valueRange: {
            type: "object",
            properties: {
              low: { type: "number" },
              high: { type: "number" },
            },
          },
          comparables: {
            type: "array",
            items: {
              type: "object",
              properties: {
                saleDate: { type: "string" },
                salePrice: { type: "number" },
                acreage: { type: "number" },
                distanceMiles: { type: "number" },
              },
            },
          },
          methodology: { type: "string" },
        },
      },
    },
  },
  paths: {
    "/properties": {
      get: {
        summary: "Search properties",
        operationId: "searchProperties",
        tags: ["Properties"],
        parameters: [
          { name: "state", in: "query", schema: { type: "string" }, description: "2-letter state code" },
          { name: "county", in: "query", schema: { type: "string" } },
          { name: "min_acres", in: "query", schema: { type: "number" } },
          { name: "max_acres", in: "query", schema: { type: "number" } },
          { name: "min_price", in: "query", schema: { type: "number" } },
          { name: "max_price", in: "query", schema: { type: "number" } },
          { name: "zoning", in: "query", schema: { type: "string" } },
          { name: "page", in: "query", schema: { type: "integer", default: 1 } },
          { name: "per_page", in: "query", schema: { type: "integer", default: 20, maximum: 100 } },
        ],
        responses: {
          "200": {
            description: "List of properties",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    data: { type: "array", items: { "$ref": "#/components/schemas/Property" } },
                    total: { type: "integer" },
                    page: { type: "integer" },
                    per_page: { type: "integer" },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/properties/{id}/valuation": {
      get: {
        summary: "Get property valuation",
        operationId: "getPropertyValuation",
        tags: ["Properties", "Valuations"],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
        responses: {
          "200": {
            description: "Valuation result",
            content: {
              "application/json": {
                schema: { "$ref": "#/components/schemas/ValuationResult" },
              },
            },
          },
        },
      },
    },
    "/market/{state}/{county}": {
      get: {
        summary: "Get county market data",
        operationId: "getCountyMarketData",
        tags: ["Market Intelligence"],
        parameters: [
          { name: "state", in: "path", required: true, schema: { type: "string" }, example: "TX" },
          { name: "county", in: "path", required: true, schema: { type: "string" }, example: "Travis" },
        ],
        responses: {
          "200": {
            description: "County market data",
            content: {
              "application/json": {
                schema: { "$ref": "#/components/schemas/CountyMarketData" },
              },
            },
          },
        },
      },
    },
    "/leads": {
      get: {
        summary: "List leads",
        operationId: "listLeads",
        tags: ["Leads"],
        parameters: [
          { name: "status", in: "query", schema: { type: "string" } },
          { name: "min_score", in: "query", schema: { type: "integer" } },
          { name: "state", in: "query", schema: { type: "string" } },
          { name: "county", in: "query", schema: { type: "string" } },
          { name: "page", in: "query", schema: { type: "integer", default: 1 } },
          { name: "per_page", in: "query", schema: { type: "integer", default: 20, maximum: 100 } },
        ],
        responses: {
          "200": {
            description: "List of leads",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    data: { type: "array", items: { "$ref": "#/components/schemas/Lead" } },
                    total: { type: "integer" },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/deals": {
      get: {
        summary: "List deals",
        operationId: "listDeals",
        tags: ["Deals"],
        responses: {
          "200": {
            description: "List of deals",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    data: { type: "array", items: { "$ref": "#/components/schemas/Deal" } },
                    total: { type: "integer" },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/webhooks": {
      get: {
        summary: "List webhook endpoints",
        operationId: "listWebhooks",
        tags: ["Webhooks"],
        responses: { "200": { description: "List of webhook configurations" } },
      },
      post: {
        summary: "Create webhook endpoint",
        operationId: "createWebhook",
        tags: ["Webhooks"],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["url", "events"],
                properties: {
                  url: { type: "string", format: "uri" },
                  events: { type: "array", items: { type: "string" } },
                  description: { type: "string" },
                },
              },
            },
          },
        },
        responses: {
          "201": { description: "Webhook created" },
        },
      },
    },
  },
  tags: [
    { name: "Properties", description: "Land parcel data and valuations" },
    { name: "Leads", description: "Motivated seller leads management" },
    { name: "Deals", description: "Deal pipeline management" },
    { name: "Market Intelligence", description: "County market data and opportunity scores" },
    { name: "Valuations", description: "AI-powered land valuations" },
    { name: "Webhooks", description: "Real-time event notifications" },
  ],
};

export default {
  generateApiKey,
  hashApiKey,
  buildWebhookPayload,
  signWebhookPayload,
  generateWidgetEmbedCode,
  ACREOS_OPENAPI_SPEC,
};
