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
 * NOTE the platform fallback itself is deliberately KEPT — the founder
 * explicitly deferred the "kill the platform fallback" question. Only the
 * ORDER (and its single ownership) is pinned here.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
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
  },
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
  },
  usageMeteringService: {
    calculateCost: async () => 0,
    recordUsage: async () => undefined,
  },
}));

import { sendLetter, sendPostcard } from "../../server/services/mailProvider";

const TO = { name: "Lee Owner", addressLine1: "2 Dirt Rd", city: "Llano", state: "TX", zip: "78643" };
const FROM = { name: "Test Land Co", addressLine1: "1 Main St", city: "Austin", state: "TX", zip: "78701" };
const LETTER = { to: TO, from: FROM, file: "https://example.com/letter.pdf" };
const POSTCARD = { to: TO, from: FROM, front: "<h1>front</h1>", back: "<h1>back</h1>" };

beforeEach(() => {
  state.byokKey = null;
  state.legacyRow = null;
  state.platformKey = { apiKey: "test_platform_key", isTestKey: true };
  state.probes = [];
  state.lobCreateCalls = [];
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
    expect(state.probes).toEqual(["byok-vault"]);
  });

  it("legacy organization_integrations row is SECOND — used only when the vault is empty", async () => {
    state.legacyRow = { isEnabled: true, credentials: { apiKey: "test_row_key" } };

    const result = await sendLetter({ ...LETTER, organizationId: 42 });

    expect(result.success).toBe(true);
    expect(state.lobCreateCalls[0].apiKey).toBe("test_row_key");
    expect(result.isTestMode).toBe(true);
    expect(state.probes).toEqual(["byok-vault", "legacy-row"]);
  });

  it("platform key is LAST — the full order is vault → legacy row → platform", async () => {
    const result = await sendLetter({ ...LETTER, organizationId: 42 });

    expect(result.success).toBe(true);
    expect(state.lobCreateCalls[0].apiKey).toBe("test_platform_key");
    expect(result.isTestMode).toBe(true);
    expect(state.probes).toEqual(["byok-vault", "legacy-row", "platform"]);
  });

  it("sendPostcard delegates through the same authority — a vault org's postcards ship on its own account", async () => {
    state.byokKey = "live_vault_key";

    const result = await sendPostcard({ ...POSTCARD, organizationId: 42 });

    expect(result.success).toBe(true);
    expect(state.lobCreateCalls[0]).toMatchObject({ kind: "postcard", apiKey: "live_vault_key" });
    expect(state.probes).toEqual(["byok-vault"]);
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
    expect(result.error).toBe("mail provider not configured");
    expect(state.lobCreateCalls).toHaveLength(0);
  });
});

// ─── No second resolution order can exist ────────────────────────────────────

const ROOT = path.resolve(__dirname, "../..");

/** Line-based comment stripping. See integrationCredentialShape for why. */
function stripComments(src: string): string {
  const out: string[] = [];
  let inBlock = false;
  for (const line of src.split("\n")) {
    let s = line;
    if (inBlock) {
      const end = s.indexOf("*/");
      if (end === -1) { out.push(""); continue; }
      s = s.slice(end + 2);
      inBlock = false;
    }
    const open = s.indexOf("/*");
    if (open > -1) {
      const close = s.indexOf("*/", open + 2);
      if (close > -1) s = s.slice(0, open) + s.slice(close + 2);
      else if (/^\s*\{?\s*\/\*/.test(s)) { s = s.slice(0, open); inBlock = true; }
    }
    out.push(s.replace(/(^|[^:])\/\/.*$/, "$1"));
  }
  if (inBlock) throw new Error("stripComments ran away — assertions would be meaningless.");
  return out.join("\n");
}

describe("mailProvider carries no independent Lob credential resolution (source scan)", () => {
  const src = stripComments(
    fs.readFileSync(path.join(ROOT, "server/services/mailProvider.ts"), "utf8"),
  );

  it("delegates to directMailService.getLobClient at all (vacuity guard)", () => {
    // If the delegation disappeared, every "does not" assertion below could
    // pass on a file that resolves credentials some brand-new third way.
    expect(src).toMatch(/from\s+['"]\.\/directMailService['"]/);
    expect(src).toContain("getLobClient");
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

  it("the authority itself still resolves vault → legacy row → platform", () => {
    const dms = stripComments(
      fs.readFileSync(path.join(ROOT, "server/services/directMailService.ts"), "utf8"),
    );
    const start = dms.indexOf("export async function getLobClient");
    const end = dms.indexOf("function getPlatformLobClient");
    expect(start, "getLobClient not found — renamed?").toBeGreaterThan(-1);
    expect(end, "getPlatformLobClient not found — renamed?").toBeGreaterThan(start);
    const body = dms.slice(start, end);
    const vault = body.indexOf("getByokCredential");
    const legacy = body.indexOf("getOrganizationIntegration");
    const platform = body.indexOf("resolvePlatformLobKey");
    expect(vault, "vault tier missing from getLobClient").toBeGreaterThan(-1);
    expect(legacy, "legacy-row tier missing from getLobClient").toBeGreaterThan(vault);
    expect(platform, "platform tier missing from getLobClient").toBeGreaterThan(legacy);
  });
});
