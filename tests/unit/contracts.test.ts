// ============================================================================
// tests/unit/contracts.test.ts — API contract layer (T3-3E Phase 3).
// ----------------------------------------------------------------------------
// Asserts the shared/contracts/ zod schemas behave as the SINGLE source of
// truth they're meant to be: a valid POST /api/leads request parses, an
// invalid one fails, and the response schemas accept a representative valid
// payload. Mock data only — no DB, no network.
// ============================================================================

import { describe, it, expect } from "vitest";
import {
  createLeadContract,
  leadCreateRequestSchema,
  leadResponseSchema,
  listPropertiesContract,
  propertyListResponseSchema,
} from "@shared/contracts";

describe("contracts: POST /api/leads request", () => {
  it("parses a valid minimal lead request", () => {
    const parsed = leadCreateRequestSchema.safeParse({
      firstName: "Dana",
      lastName: "Reyes",
      type: "seller",
      status: "new",
    });
    expect(parsed.success).toBe(true);
  });

  it("passes transport-only extras through (latitude/consentText)", () => {
    // The handler reads these for enrichment + the TCPA evidence chain; the
    // schema must NOT strip them (passthrough()).
    const parsed = leadCreateRequestSchema.safeParse({
      firstName: "Dana",
      lastName: "Reyes",
      latitude: "34.05",
      longitude: "-118.24",
      consentText: "I agree to be contacted",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect((parsed.data as Record<string, unknown>).latitude).toBe("34.05");
      expect((parsed.data as Record<string, unknown>).consentText).toBe(
        "I agree to be contacted",
      );
    }
  });

  it("rejects an invalid lead request (missing required lastName)", () => {
    const parsed = leadCreateRequestSchema.safeParse({
      firstName: "Dana",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects an invalid lead request (malformed email)", () => {
    // shared/schema.ts tightens email to z.string().email() — a bad value
    // must fail at the contract boundary rather than reach the DB.
    const parsed = leadCreateRequestSchema.safeParse({
      firstName: "Dana",
      lastName: "Reyes",
      email: "not-an-email",
    });
    expect(parsed.success).toBe(false);
  });
});

describe("contracts: POST /api/leads response", () => {
  it("accepts a representative valid created-lead payload", () => {
    const parsed = leadResponseSchema.safeParse({
      id: 42,
      organizationId: 7,
      type: "seller",
      firstName: "Dana",
      lastName: "Reyes",
      email: null,
      phone: "555-0100",
      status: "new",
      // additive DB columns must NOT break validation (passthrough)
      score: 80,
      nurturingStage: "hot",
      createdAt: "2026-06-11T00:00:00.000Z",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects a payload missing the load-bearing id", () => {
    const parsed = leadResponseSchema.safeParse({
      firstName: "Dana",
      lastName: "Reyes",
    });
    expect(parsed.success).toBe(false);
  });
});

describe("contracts: GET /api/properties response", () => {
  it("accepts a representative valid paginated envelope", () => {
    const parsed = propertyListResponseSchema.safeParse({
      data: [
        {
          id: 1,
          organizationId: 7,
          apn: "123-456-789",
          county: "Cochise",
          state: "AZ",
          sizeAcres: "5.0",
          status: "prospect",
          // additive columns ride through
          marketValue: "12000",
          latitude: "31.5",
        },
      ],
      total: 1,
      page: 1,
      pageSize: 25,
      totalPages: 1,
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects an envelope whose data items lack required apn/county/state", () => {
    const parsed = propertyListResponseSchema.safeParse({
      data: [{ id: 1 }],
      total: 1,
      page: 1,
      pageSize: 25,
      totalPages: 1,
    });
    expect(parsed.success).toBe(false);
  });
});

describe("contracts: contract objects are well-formed", () => {
  it("exposes method/path/schemas matching the OpenAPI skeleton routes", () => {
    expect(createLeadContract.method).toBe("POST");
    expect(createLeadContract.path).toBe("/api/leads");
    expect(createLeadContract.requestSchema).toBe(leadCreateRequestSchema);
    expect(createLeadContract.responseSchema).toBe(leadResponseSchema);

    expect(listPropertiesContract.method).toBe("GET");
    expect(listPropertiesContract.path).toBe("/api/properties");
    expect(listPropertiesContract.requestSchema).toBeNull();
    expect(listPropertiesContract.responseSchema).toBe(
      propertyListResponseSchema,
    );
  });
});
