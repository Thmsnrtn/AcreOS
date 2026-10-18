/**
 * One Lob credential resolver, BYOK-first (founder-approved consolidation,
 * 2026-08-16).
 *
 * THE DEFECT THIS PINS AGAINST: two live sendLetter paths disagreed on WHOSE
 * Lob account pays. `directMailService.getLobClient` resolved BYOK-first
 * (byok_credentials vault → legacy organization_integrations row → platform
 * key), while `mailProvider.getOrgMailCredentials` queried ONLY the legacy
 * organization_integrations row and fell straight to the platform default. An
 * org whose Lob key lived in the BYOK vault — the documented Universal-BYOK
 * path — therefore sent letters through mailProvider (the autopilot
 * send_letter hand) on ACREOS'S OWN Lob account, against the founder's
 * BYO-rails ruling (2026-07-29).
 *
 * The fix is not "mailProvider also checks the vault" — a THIRD copy of the
 * order is how the second one happened. mailProvider now obtains its client
 * THROUGH directMailService.getLobClient, the single authority. So this file
 * pins two things:
 *
 *   1. The resolution order itself, behaviorally, through the surface that
 *      was broken (mailProvider.sendLetter/sendPostcard): vault first, then
 *      the legacy row, then the platform key — and that earlier tiers
 *      short-circuit the later ones.
 *   2. That mailProvider contains NO independent credential resolution
 *      (source scan, comments stripped): no organization_integrations query,
 *      no vault read, no db import. The defect was a SECOND resolution order
 *      existing at all, so the pin is that one cannot exist.
 *
 * UPDATED 2026-10-17 (founder decision, docs/company/founder-decisions-2026-10-17.md):
 * the deferred "platform fallback" is superseded. The authority now splits in
 * two — `getOwnLobClient` (vault → legacy row, never the platform key) and
 * `getLobClientForLane` (the platform key only for a HOUSE lane, which
 * mail/mailLane.ts grants only under the org's verified sender identity and
 * charges in credits). The order pinned here is therefore
 * vault → legacy row → house lane.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { makePdf } from "../helpers/pdfFixture";
import { houseMail } from "../helpers/fakeHouseMailDb";
// W5a: the owner opt-out list is empty for this test (the guard is proven elsewhere).
vi.mock("../../server/services/trust/ownerSuppression", async () => (await import("../helpers/ownerSuppressionAllowAll")).ownerSuppressionAllowAll);
import fs from "node:fs";
import path from "node:path";

const state = {
  byokKey: null as string | null,
  legacyRow: null as { isEnabled: boolean; credentials: { apiKey?: string } } | null,
  platformKey: { apiKey: "test_platform_key", isTestKey: true } as
    | { apiKey: string; isTestKey: boolean }
    | null,
  /** Which credential tiers were consulted, in order. */
  probes: [] as string[],
  lobCreateCalls: [] as Array<{ kind: string; apiKey: string; params: unknown }>,
  identity: { id: 1, organizationId: 42, name: "Main", companyName: "Test Land Co", addressLine1: "1 Main St", city: "Austin", state: "TX", zipCode: "78701", status: "verified", isActive: true } as Record<string, unknown> | null,
  poolDebits: [] as string[],
};

vi.mock("lob", () => ({
  default: class MockLob {
    apiKey: string;
    letters = {
      create: async (params: unknown) => {
        state.lobCreateCalls.push({ kind: "letter", apiKey: this.apiKey, params });
        return { id: "ltr_1", url: "https://lob.test/ltr_1", expected_delivery_date: "2026-08-20" };
      },
    };
    postcards = {
      create: async (params: unknown) => {
        state.lobCreateCalls.push({ kind: "postcard", apiKey: this.apiKey, params });
        return { id: "psc_1", url: "https://lob.test/psc_1", expected_delivery_date: "2026-08-20" };
      },
    };
    constructor(opts: { apiKey: string }) {
      this.apiKey = opts.apiKey;
    }
  },
}));

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../server/services/byok/key-vault", () => ({
  getByokCredential: async () => {
    state.probes.push("byok-vault");
    return state.byokKey;
  },
}));

vi.mock("../../server/storage", () => ({
  storage: {
    getOrganizationIntegration: async () => {
      state.probes.push("legacy-row");
      return state.legacyRow;
    },
    getOrganization: async () => ({ id: 42, settings: {} }),
    getDefaultMailSenderIdentity: async () => state.identity ?? undefined,
  },
}));

vi.mock("../../server/services/creditCost", () => ({ creditCost: async () => 120 }));
// House mail (founder decisions 2026-10-17) is pre-paid from PURCHASED
// credits (mail/mailLane.ts chargeHouseMail), whose SQL is faked here
// (tests/helpers/fakeHouseMailDb); a poolDebit would be a defect and is recorded.
vi.mock("../../server/db", async () => (await import("../helpers/fakeHouseMailDb")).fakeHouseMailDbModule);
vi.mock("../../server/services/settings", () => ({ getSetting: async (_k: string, fallback: unknown) => fallback }));
vi.mock("../../server/services/creditPool", () => ({
  poolDebit: async (a: { action: string }) => {
    state.poolDebits.push(a.action);
    return { allowed: true, debitedCents: 120, remaining: 1, poolMonthly: 1, ledgerRowId: 1, overPool: false };
  },
  refundPoolDebit: async () => undefined,
}));

// integrationCredentials runs for real (it decides plaintext-vs-envelope);
// only the crypto beneath it is mocked. Rows in this file use the plaintext
// shape, which never reaches decrypt.
vi.mock("../../server/services/fieldEncryption", () => ({
  decryptJsonCredentials: () => ({}),
  encryptJsonCredentials: () => "enc:v1:mock",
}));

vi.mock("../../server/services/mail/liveSendInterlock", () => ({
  resolvePlatformLobKey: () => {
    state.probes.push("platform");
    if (!state.platformKey) throw new Error("Lob test key not configured.");
    return state.platformKey;
  },
  isLiveSendArmed: () => false,
}));

// Static imports of directMailService that the client-resolution path never
// touches, mocked so the module loads without a database.
vi.mock("../../server/services/credits", () => ({
  creditService: {
    hasEnoughCredits: async () => true,
    getBalance: async () => 0,
    afterDebitCommitted: () => undefined,
  },
  usageMeteringService: {
    calculateCost: async () => 0,
    recordUsage: async () => undefined,
  },
}));

import { sendLetter, sendPostcard } from "../../server/services/mailProvider";
import { stripComments } from "../helpers/stripComments";

const TO = { name: "Lee Owner", addressLine1: "2 Dirt Rd", city: "Llano", state: "TX", zip: "78643" };
const FROM = { name: "Test Land Co", addressLine1: "1 Main St", city: "Austin", state: "TX", zip: "78701" };
// A house letter must be CONFIRMED one page (founder decision 2026-10-18):
// a one-page PDF on an https URL, served by the fetch stub below.
const LETTER = { to: TO, from: FROM, file: "https://files.example.com/letter.pdf" };
const POSTCARD = { to: TO, from: FROM, front: "<h1>front</h1>", back: "<h1>back</h1>" };

beforeEach(() => {
  vi.stubGlobal("fetch", async (url: string) =>
    /\.pdf$/.test(String(url))
      ? new Response(new Uint8Array(await makePdf(1)), { status: 200, headers: { "content-type": "application/pdf" } })
      : new Response("nope", { status: 404 }),
  );
  state.byokKey = null;
  state.legacyRow = null;
  state.platformKey = { apiKey: "test_platform_key", isTestKey: true };
  state.probes = [];
  state.lobCreateCalls = [];
  state.poolDebits = [];
  houseMail.reset();
  state.identity = { id: 1, organizationId: 42, name: "Main", companyName: "Test Land Co", addressLine1: "1 Main St", city: "Austin", state: "TX", zipCode: "78701", status: "verified", isActive: true };
  delete process.env.MAIL_MOCK;
  delete process.env.LOB_API_KEY;
});

describe("mailProvider resolves Lob credentials through the single authority, vault-first", () => {
  it("BYOK vault wins over BOTH the legacy row and the platform key — the org's own account pays", async () => {
    state.byokKey = "live_vault_key";
    state.legacyRow = { isEnabled: true, credentials: { apiKey: "test_row_key" } };

    const result = await sendLetter({ ...LETTER, organizationId: 42 });

    expect(result.success).toBe(true);
    expect(state.lobCreateCalls[0].apiKey).toBe("live_vault_key");
    // A live customer key is honestly live — the interlock governs only the
    // platform key, never an org's own.
    expect(result.isTestMode).toBe(false);
    // Vault answered; the later tiers must not even be consulted.
    expect(state.probes.length).toBeGreaterThan(0);
    expect(state.probes.every((p) => p === "byok-vault")).toBe(true);
    expect(state.poolDebits).toEqual([]);
  });

  it("legacy organization_integrations row is SECOND — used only when the vault is empty", async () => {
    state.legacyRow = { isEnabled: true, credentials: { apiKey: "test_row_key" } };

    const result = await sendLetter({ ...LETTER, organizationId: 42 });

    expect(result.success).toBe(true);
    expect(state.lobCreateCalls[0].apiKey).toBe("test_row_key");
    expect(result.isTestMode).toBe(true);
    expect(state.probes).not.toContain("platform");
    expect(state.probes.slice(0, 2)).toEqual(["byok-vault", "legacy-row"]);
    expect(state.poolDebits).toEqual([]);
  });

  it("platform key is LAST and only as house mail — vault → legacy row → house lane (credits)", async () => {
    const result = await sendLetter({ ...LETTER, organizationId: 42 });

    expect(result.success).toBe(true);
    expect(state.lobCreateCalls[0].apiKey).toBe("test_platform_key");
    expect(result.isTestMode).toBe(true);
    expect(state.probes.slice(0, 2)).toEqual(["byok-vault", "legacy-row"]);
    expect(state.probes.indexOf("platform")).toBeGreaterThan(state.probes.lastIndexOf("legacy-row"));
    expect(state.poolDebits).toEqual([]); // never the monthly pool
    expect(houseMail.charges.map((c) => c.credits)).toEqual([120]); // pre-paid from purchased credits
  });

  it("no own key and no verified identity: refused — the platform key is never a silent fallback", async () => {
    state.identity = { ...state.identity, status: "draft" };
    const result = await sendLetter({ ...LETTER, organizationId: 42 });

    expect(result.success).toBe(false);
    expect(state.lobCreateCalls).toHaveLength(0);
    expect(state.probes).not.toContain("platform");
    expect(state.poolDebits).toEqual([]);
  });

  it("sendPostcard delegates through the same authority — a vault org's postcards ship on its own account", async () => {
    state.byokKey = "live_vault_key";

    const result = await sendPostcard({ ...POSTCARD, organizationId: 42 });

    expect(result.success).toBe(true);
    expect(state.lobCreateCalls[0]).toMatchObject({ kind: "postcard", apiKey: "live_vault_key" });
    expect(state.probes.every((p) => p === "byok-vault")).toBe(true);
  });

  it("no organizationId: platform default path unchanged, and the vault is never consulted", async () => {
    const result = await sendLetter({ ...LETTER });

    expect(result.success).toBe(true);
    expect(state.lobCreateCalls[0].apiKey).toBe("test_platform_key");
    expect(state.probes).toEqual(["platform"]);
  });

  it("nothing configured anywhere: still refuses rather than fabricating a send", async () => {
    state.platformKey = null;

    const result = await sendLetter({ ...LETTER, organizationId: 42 });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not available/);
    expect(state.lobCreateCalls).toHaveLength(0);
    expect(state.poolDebits).toEqual([]);

    // Org-less system mail with no platform key at all still refuses plainly.
    const system = await sendLetter({ ...LETTER });
    expect(system.success).toBe(false);
    expect(system.error).toBe("mail provider not configured");
  });
});

// ─── No second resolution order can exist ────────────────────────────────────

const ROOT = path.resolve(__dirname, "../..");

describe("mailProvider carries no independent Lob credential resolution (source scan)", () => {
  const src = stripComments(
    fs.readFileSync(path.join(ROOT, "server/services/mailProvider.ts"), "utf8"),
  );

  it("delegates to directMailService.getLobClient at all (vacuity guard)", () => {
    // If the delegation disappeared, every "does not" assertion below could
    // pass on a file that resolves credentials some brand-new third way.
    expect(src).toMatch(/from\s+['"]\.\/directMailService['"]/);
    expect(src).toContain("getLobClientForLane(");
  });

  it("never queries organization_integrations itself", () => {
    expect(
      /organization_?integrations/i.test(src),
      "mailProvider.ts references organization_integrations again — org-row " +
        "credential reads belong to directMailService.getLobClient, the single " +
        "authority. A second resolution order is the exact defect this pins shut.",
    ).toBe(false);
    expect(src).not.toContain("readIntegrationCredentials");
  });

  it("never reads the BYOK vault itself", () => {
    // Vault-reading here would be resolution-order copy number three.
    expect(src).not.toContain("getByokCredential");
    expect(src).not.toContain("byok/key-vault");
  });

  it("never imports the database", () => {
    expect(src).not.toMatch(/from\s+["']\.\.\/db["']/);
    expect(src).not.toMatch(/\bdb\s*\.\s*select\b/);
  });

  it("the authority resolves the org's own key vault → legacy row, and never the platform key", () => {
    const dms = stripComments(
      fs.readFileSync(path.join(ROOT, "server/services/directMailService.ts"), "utf8"),
    );
    const start = dms.indexOf("export async function getOwnLobClient");
    const end = dms.indexOf("export async function getLobClientForLane");
    expect(start, "getOwnLobClient not found — renamed?").toBeGreaterThan(-1);
    expect(end, "getLobClientForLane not found — renamed?").toBeGreaterThan(start);
    const body = dms.slice(start, end);
    const vault = body.indexOf("getByokCredential");
    const legacy = body.indexOf("getOrganizationIntegration");
    expect(vault, "vault tier missing from getOwnLobClient").toBeGreaterThan(-1);
    expect(legacy, "legacy-row tier missing from getOwnLobClient").toBeGreaterThan(vault);
    expect(body, "getOwnLobClient must never fall back to AcreOS's key").not.toContain("resolvePlatformLobKey");
    const lane = dms.slice(end, dms.indexOf("function getPlatformLobClient"));
    expect(lane).toContain("resolvePlatformLobKey");
  });
});
