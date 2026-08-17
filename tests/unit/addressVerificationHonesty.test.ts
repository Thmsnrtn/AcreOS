/**
 * addressVerification honesty — the service may only claim `deliverable`
 * when USPS actually answered. The no-provider fallback and the USPS
 * error path previously returned `deliverable: true` for addresses that
 * were never checked; refuse-not-fabricate requires those results to be
 * marked unverified with deliverability "unknown".
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { verifyAddress } from "../../server/services/addressVerification";

const INPUT = {
  address1: "1600 Pennsylvania Ave NW",
  city: "Washington",
  state: "DC",
  zip: "20500",
};

const USPS_OK_XML = `<?xml version="1.0"?><AddressValidateResponse><Address ID="0"><Address2>1600 PENNSYLVANIA AVE NW</Address2><City>WASHINGTON</City><State>DC</State><Zip5>20500</Zip5><Zip4>0005</Zip4></Address></AddressValidateResponse>`;

const USPS_NOT_FOUND_XML = `<?xml version="1.0"?><AddressValidateResponse><Address ID="0"><Error><Description>Address Not Found.</Description></Error></Address></AddressValidateResponse>`;

function stubFetch(impl: (typeof fetch)) {
  vi.stubGlobal("fetch", impl);
}

describe("addressVerification honesty", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("no-provider fallback is marked unverified with deliverability unknown", async () => {
    vi.stubEnv("USPS_USER_ID", "");

    const result = await verifyAddress(INPUT);

    expect(result.verified).toBe(false);
    expect(result.deliverable).toBe("unknown");
    expect(result.verificationSkipped).toBe("usps_not_configured");
    // Normalization still happens — only the deliverability claim is withheld
    expect(result.address1).toBe(INPUT.address1.toUpperCase());
  });

  it("a successful USPS parse is marked verified and deliverable", async () => {
    vi.stubEnv("USPS_USER_ID", "TESTUSER");
    stubFetch(vi.fn(async () => new Response(USPS_OK_XML, { status: 200 })) as unknown as typeof fetch);

    const result = await verifyAddress(INPUT);

    expect(result.verified).toBe(true);
    expect(result.deliverable).toBe(true);
    expect(result.verificationSkipped).toBeUndefined();
    expect(result.address1).toBe("1600 PENNSYLVANIA AVE NW");
    expect(result.zip).toBe("20500");
    expect(result.zip4).toBe("0005");
  });

  it("USPS 'not found' is a verified negative, not an unknown", async () => {
    vi.stubEnv("USPS_USER_ID", "TESTUSER");
    stubFetch(vi.fn(async () => new Response(USPS_NOT_FOUND_XML, { status: 200 })) as unknown as typeof fetch);

    const result = await verifyAddress(INPUT);

    expect(result.verified).toBe(true);
    expect(result.deliverable).toBe(false);
    expect(result.verificationSkipped).toBeUndefined();
  });

  it("USPS failure is marked unverified with deliverability unknown, never deliverable:true", async () => {
    vi.stubEnv("USPS_USER_ID", "TESTUSER");
    stubFetch(vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch);

    const result = await verifyAddress(INPUT);

    expect(result.verified).toBe(false);
    expect(result.deliverable).toBe("unknown");
    expect(result.verificationSkipped).toBe("usps_unavailable");
  });

  it("USPS non-2xx is marked unverified with deliverability unknown", async () => {
    vi.stubEnv("USPS_USER_ID", "TESTUSER");
    stubFetch(vi.fn(async () => new Response("Server Error", { status: 500 })) as unknown as typeof fetch);

    const result = await verifyAddress(INPUT);

    expect(result.verified).toBe(false);
    expect(result.deliverable).toBe("unknown");
    expect(result.verificationSkipped).toBe("usps_unavailable");
  });
});
