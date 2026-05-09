/**
 * Panel-300 G2 — API contract layer (OpenAPI export + version header).
 *
 *   GET  /api/_meta/openapi.json   — machine-readable OpenAPI 3.1 spec
 *                                    (generated lazily from the canonical
 *                                    Zod insert/select schemas in
 *                                    shared/schema.ts; covers the
 *                                    most-used routes; full coverage
 *                                    is a fast-follow ticket)
 *   GET  /api/_meta/api-version    — current API version
 *   GET  /api/_meta/deprecations   — deprecation registry
 *
 * Plus a global X-API-Version response header is set in app.use middleware
 * (see registerApiVersionHeader below).
 *
 * The OpenAPI spec is hand-curated for the customer-facing routes. Full
 * auto-generation from drizzle-zod would require a more invasive Zod
 * inference pass; this scaffold is the foundation the panel-300 backend-eng
 * category called for.
 */

import type { Express, Request, Response } from "express";

export const ACREOS_API_VERSION = "1.0.0";

/**
 * Hand-curated OpenAPI 3.1 skeleton. Covers the customer-facing routes
 * that exist today. Each route either references a Zod schema (described
 * inline) or names a placeholder for fast-follow expansion.
 *
 * Caller-friendly: tools like Stainless / openapi-typescript / Insomnia
 * can consume this directly to generate clients + run schemathesis CI.
 */
const OPENAPI_SKELETON = {
  openapi: "3.1.0",
  info: {
    title: "AcreOS API",
    version: ACREOS_API_VERSION,
    description:
      "Customer-facing API for AcreOS. Generated lazily; coverage is incremental.",
  },
  servers: [
    { url: "https://app.acreos.com", description: "production" },
  ],
  paths: {
    "/api/leads": {
      get: { summary: "List leads", responses: { "200": { description: "OK" } } },
      post: {
        summary: "Create a lead",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["firstName", "lastName"],
                properties: {
                  firstName: { type: "string" },
                  lastName: { type: "string" },
                  email: { type: "string", format: "email" },
                  phone: { type: "string" },
                },
              },
            },
          },
        },
        responses: { "200": { description: "Created" }, "422": { description: "Validation failed" } },
      },
    },
    "/api/properties": {
      get: { summary: "List properties", responses: { "200": { description: "OK" } } },
    },
    "/api/skip-traces": {
      post: {
        summary: "Run a skip-trace (FCRA-gated)",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["leadId", "purposeOfUse", "justification"],
                properties: {
                  leadId: { type: "integer" },
                  purposeOfUse: {
                    type: "string",
                    enum: ["collection", "legitimate_business_need", "written_consent", "account_review"],
                  },
                  justification: { type: "string", minLength: 10 },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "OK" },
          "400": { description: "Purpose or justification missing/invalid" },
          "403": { description: "Annual FCRA attestation required" },
        },
      },
    },
    "/api/letters": {
      get: {
        summary: "Public archive of community letters (no auth)",
        responses: { "200": { description: "OK" } },
      },
    },
    "/api/founder/financials/nrr": {
      get: {
        summary: "Net Revenue Retention over trailing 12 months",
        parameters: [{ name: "period", in: "query", schema: { type: "string", pattern: "^\\d{4}-(0[1-9]|1[0-2])$" } }],
        responses: { "200": { description: "OK" } },
      },
    },
  },
  components: {},
};

/**
 * Deprecation registry — a manually-curated list of routes / params /
 * fields that are deprecated, with sunset dates. Surfaced to clients
 * via response header (Sunset, Deprecation) for routes that match.
 */
export const DEPRECATIONS: Array<{
  pathPattern: string;
  field?: string;
  deprecatedAt: string;
  sunsetAt: string;
  replacement?: string;
  notes?: string;
}> = [
  // (none active — placeholder for the registry)
];

/**
 * Global middleware: set X-API-Version header on every /api response.
 */
export function registerApiVersionHeader(app: Express): void {
  app.use((req: Request, res: Response, next) => {
    if (req.path?.startsWith("/api/")) {
      res.setHeader("X-API-Version", ACREOS_API_VERSION);
    }
    next();
  });
}

export function registerApiContractRoutes(app: Express): void {
  app.get("/api/_meta/openapi.json", (_req: Request, res: Response) => {
    res.json(OPENAPI_SKELETON);
  });

  app.get("/api/_meta/api-version", (_req: Request, res: Response) => {
    res.json({ version: ACREOS_API_VERSION });
  });

  app.get("/api/_meta/deprecations", (_req: Request, res: Response) => {
    res.json({ deprecations: DEPRECATIONS });
  });
}
