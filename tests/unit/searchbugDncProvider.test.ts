/**
 * Searchbug DNC/litigator scrub adapter (server/services/compliance/searchbugDncProvider.ts)
 * and its behavior at the gate (server/services/compliance/dncScrub.ts).
 *
 * The load-bearing property under test: this adapter NEVER reports "clean" for
 * a number it did not actually get a verdict on. Missing credentials, a non-200,
 * a malformed body, a missing field, a timeout — all of them must surface as
 * `error` (= UNAVAILABLE / not checked), and an unavailable verdict must not
 * open the gate for lead-matched marketing traffic.
 *
 * No network: `fetch` is stubbed. No DB: only pure mapping + pure gate policy.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildSearchbugUrl,
  mapSearchbugResponse,
  searchbugDncProvider,
  SEARCHBUG_DNC_TYPE,
  SEARCHBUG_ENDPOINT,
} from "../../server/services/compliance/searchbugDncProvider";
import {
  evaluateDncGate,
  getConfiguredDncProvider,
  type DncScrubOutcome,
} from "../../server/services/compliance/dncScrub";

const CO_CODE = "SEARCHBUG_CO_CODE";
const API_KEY = "SEARCHBUG_API_KEY";

/** The documented api_dnc2 envelope, with the PHONE record fields overridden. */
function envelope(phone: Record<string, unknown>) {
  return {
    Status: "Success",
    Data: {
      PHONE: { NUMBER: "3077721924", NUMBER2: "(307) 772-1924", CODE: "TLX", ...phone },
      STATS: { DATE: "05/22/2023", DAILY: "2", MONTHLY: "6", RATE: "0.02", BALANCE: "554" },
    },
    Error: null,
  };
}

function stubFetchJson(body: unknown, ok = true, status = 200) {
  const fn = vi.fn(async () => ({
    ok,
    status,
    json: async () => body,
  })) as unknown as typeof fetch;
  vi.stubGlobal("fetch", fn);
  return fn as unknown as ReturnType<typeof vi.fn>;
}

function withCredentials() {
  process.env[CO_CODE] = "34567";
  process.env[API_KEY] = "test-password";
}

/** Run the adapter's verdict through the real gate as MARKETING traffic. */
function gateAsMarketing(outcome: Omit<DncScrubOutcome, "provider" | "fromCache">) {
  return evaluateDncGate(
    { ...outcome, provider: "searchbug" },
    // hasConsent:true is the hostile case — the send has cleared every other
    // TCPA gate, so only the scrub stands between it and the carrier.
    { leadMatched: true, hasConsent: true },
  );
}

beforeEach(() => {
  delete process.env[CO_CODE];
  delete process.env[API_KEY];
  delete process.env.DNC_SCRUB_PROVIDER;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env[CO_CODE];
  delete process.env[API_KEY];
  delete process.env.DNC_SCRUB_PROVIDER;
});

describe("searchbug request construction", () => {
  it("hits the documented endpoint with the documented auth + type params", () => {
    const url = new URL(buildSearchbugUrl("3077721924", { coCode: "34567", pass: "p@ss" }));
    expect(`${url.origin}${url.pathname}`).toBe(SEARCHBUG_ENDPOINT);
    expect(url.searchParams.get("CO_CODE")).toBe("34567");
    expect(url.searchParams.get("PASS")).toBe("p@ss");
    expect(url.searchParams.get("TYPE")).toBe(SEARCHBUG_DNC_TYPE);
    expect(url.searchParams.get("F")).toBe("3077721924");
    expect(url.searchParams.get("FORMAT")).toBe("JSON");
  });

  it("is unconfigured until BOTH the account id and the password are present", () => {
    expect(searchbugDncProvider.isConfigured()).toBe(false);
    process.env[CO_CODE] = "34567";
    expect(searchbugDncProvider.isConfigured()).toBe(false);
    process.env[API_KEY] = "test-password";
    expect(searchbugDncProvider.isConfigured()).toBe(true);
  });
});

describe("(a) a listed number is BLOCKED", () => {
  it("maps TCPA=YES to litigator and blocks even with express consent", async () => {
    withCredentials();
    stubFetchJson(envelope({ DNC: "NO", TCPA: "YES" }));

    const verdict = await searchbugDncProvider.scrub("3077721924");
    expect(verdict.status).toBe("litigator");

    const gate = gateAsMarketing(verdict);
    expect(gate.allowed).toBe(false);
    expect(gate.scrubbed).toBe(true);
    expect(gate.reason).toMatch(/litigator/i);
  });

  it("maps a non-NO DNC code list to dnc_listed and blocks without consent", async () => {
    withCredentials();
    stubFetchJson(envelope({ DNC: "FED,WY", TCPA: "NO" }));

    const verdict = await searchbugDncProvider.scrub("3077721924");
    expect(verdict.status).toBe("dnc_listed");
    // The raw vendor codes survive into the audit trail.
    expect(verdict.listSource).toBe("searchbug-dnc:FED,WY");

    const gate = evaluateDncGate(
      { ...verdict, provider: "searchbug" },
      { leadMatched: true, hasConsent: false },
    );
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toMatch(/DNC-listed/i);
  });

  it("treats the CPL (DNC complainer) code as a DNC listing, not clean", async () => {
    withCredentials();
    stubFetchJson(envelope({ DNC: "CPL", TCPA: "NO" }));
    await expect(searchbugDncProvider.scrub("3077721924")).resolves.toMatchObject({
      status: "dnc_listed",
    });
  });
});

describe("(b) a clean number PASSES", () => {
  it("maps DNC=NO + TCPA=NO to clean and opens the gate", async () => {
    withCredentials();
    const fetchMock = stubFetchJson(envelope({ DNC: "NO", TCPA: "NO" }));

    const verdict = await searchbugDncProvider.scrub("4805551234");
    expect(verdict.status).toBe("clean");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    expect(gateAsMarketing(verdict)).toEqual({ allowed: true, scrubbed: true });
  });

  it("is case-insensitive about the documented yes/no values", () => {
    expect(mapSearchbugResponse(envelope({ DNC: "no", TCPA: "no" })).status).toBe("clean");
    expect(mapSearchbugResponse(envelope({ DNC: "no", TCPA: "yes" })).status).toBe("litigator");
  });
});

describe("(c) a MISSING KEY yields unavailable and does NOT pass the gate", () => {
  it("returns error (not clean) and never calls the API", async () => {
    const fetchMock = stubFetchJson(envelope({ DNC: "NO", TCPA: "NO" }));

    const verdict = await searchbugDncProvider.scrub("4805551234");
    expect(verdict.status).toBe("error");
    expect(verdict.status).not.toBe("clean");
    expect(verdict.reason).toMatch(/not configured|NOT checked/i);
    expect(fetchMock).not.toHaveBeenCalled();

    const gate = gateAsMarketing(verdict);
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toMatch(/fail closed/i);
  });

  it("does NOT let the seam fall back to inert allow-all when searchbug is selected without a key", async () => {
    process.env.DNC_SCRUB_PROVIDER = "searchbug";
    // The dangerous regression this guards: getConfiguredDncProvider() returning
    // null here would make scrubPhone() return null → gate allows everything
    // while an operator believes numbers are being scrubbed.
    const provider = getConfiguredDncProvider();
    expect(provider).not.toBeNull();
    expect(provider!.name).toBe("searchbug");

    const verdict = await provider!.scrub("4805551234");
    expect(verdict.status).toBe("error");
    expect(gateAsMarketing({ ...verdict }).allowed).toBe(false);
  });

  it("still resolves the real adapter once both credentials are present", () => {
    process.env.DNC_SCRUB_PROVIDER = "searchbug";
    withCredentials();
    expect(getConfiguredDncProvider()).toBe(searchbugDncProvider);
  });
});

describe("(d) an API ERROR yields unavailable and does NOT pass the gate", () => {
  const cases: Array<[string, () => void]> = [
    ["non-200 response", () => stubFetchJson({}, false, 500)],
    ["429 rate limit", () => stubFetchJson({}, false, 429)],
    [
      "network failure / timeout",
      () =>
        vi.stubGlobal(
          "fetch",
          vi.fn(async () => {
            throw new Error("The operation was aborted due to timeout");
          }),
        ),
    ],
    [
      "body that is not JSON",
      () =>
        vi.stubGlobal(
          "fetch",
          vi.fn(async () => ({
            ok: true,
            status: 200,
            json: async () => {
              throw new SyntaxError("Unexpected token < in JSON");
            },
          })),
        ),
    ],
    ["vendor Status other than Success", () => stubFetchJson({ Status: "Error", Data: null, Error: "Invalid login" })],
    ["non-null Error field", () => stubFetchJson({ Status: "Success", Data: {}, Error: "Insufficient balance" })],
    ["missing PHONE record", () => stubFetchJson({ Status: "Success", Data: { STATS: {} }, Error: null })],
    ["PHONE record missing the DNC field", () => stubFetchJson(envelope({ TCPA: "NO", DNC: undefined }))],
    ["PHONE record missing the TCPA field", () => stubFetchJson(envelope({ DNC: "NO", TCPA: undefined }))],
    ["empty DNC value (not a documented clean value)", () => stubFetchJson(envelope({ DNC: "", TCPA: "NO" }))],
    ["completely empty body", () => stubFetchJson(null)],
  ];

  for (const [label, arrange] of cases) {
    it(`${label} → error, and the marketing gate stays shut`, async () => {
      withCredentials();
      arrange();

      const verdict = await searchbugDncProvider.scrub("4805551234");
      expect(verdict.status, `${label} must not report clean`).toBe("error");

      const gate = gateAsMarketing(verdict);
      expect(gate.allowed, `${label} must not open the gate`).toBe(false);
      expect(gate.scrubbed).toBe(true);
      expect(gate.reason).toMatch(/fail closed/i);
    });
  }

  it("never produces a clean verdict from any malformed shape", () => {
    const shapes: unknown[] = [
      null,
      undefined,
      "",
      "OK",
      42,
      {},
      { Status: "Success" },
      { Status: "Success", Data: {} },
      { Status: "Success", Data: { PHONE: {} } },
      { Status: "Success", Data: { PHONE: [] } },
      { Status: "Success", Data: { PHONE: { DNC: 0, TCPA: 0 } } },
    ];
    for (const shape of shapes) {
      expect(mapSearchbugResponse(shape).status, JSON.stringify(shape)).toBe("error");
    }
  });
});

describe("multi-record tolerance", () => {
  it("reads the first PHONE record when the vendor returns an array", () => {
    const body = {
      Status: "Success",
      Data: { PHONE: [{ DNC: "FED", TCPA: "NO" }, { DNC: "NO", TCPA: "NO" }] },
      Error: null,
    };
    expect(mapSearchbugResponse(body)).toMatchObject({ status: "dnc_listed" });
  });
});
