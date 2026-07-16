/**
 * resolveProviderCredential — Stage 1 of the credential-vault consolidation.
 *
 * Pins the read contract that lets a provider honor BOTH stores safely:
 * canonical vault first, legacy organizationIntegrations second, vault wins
 * when both hold a key, and the whole thing fails SOFT to null (a provider
 * keeps its own env fallback — it must never throw out of a key read).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const getByokCredential = vi.fn();
vi.mock("../../server/services/byok/key-vault", () => ({
  getByokCredential: (args: unknown) => getByokCredential(args),
}));

const getOrganizationIntegration = vi.fn();
vi.mock("../../server/storage", () => ({
  storage: {
    getOrganizationIntegration: (org: number, provider: string) =>
      getOrganizationIntegration(org, provider),
  },
}));

const decryptJsonCredentials = vi.fn();
vi.mock("../../server/services/fieldEncryption", () => ({
  decryptJsonCredentials: (enc: string, org: number) => decryptJsonCredentials(enc, org),
}));

vi.mock("../../server/utils/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { resolveProviderCredential } from "../../server/services/providers/resolveProviderCredential";

const OPTS = { channel: "regrid" as const, legacyProvider: "regrid", legacyField: "apiKey" };

beforeEach(() => {
  getByokCredential.mockReset();
  getOrganizationIntegration.mockReset();
  decryptJsonCredentials.mockReset();
});

describe("resolveProviderCredential", () => {
  it("returns the vault secret when present — legacy is never consulted", async () => {
    getByokCredential.mockResolvedValue("vault-key");
    expect(await resolveProviderCredential(1, OPTS)).toBe("vault-key");
    expect(getOrganizationIntegration).not.toHaveBeenCalled();
  });

  it("falls back to the legacy field when the vault is empty", async () => {
    getByokCredential.mockResolvedValue(null);
    getOrganizationIntegration.mockResolvedValue({ isEnabled: true, credentials: { encrypted: "blob" } });
    decryptJsonCredentials.mockReturnValue({ apiKey: "legacy-key" });
    expect(await resolveProviderCredential(1, OPTS)).toBe("legacy-key");
    expect(decryptJsonCredentials).toHaveBeenCalledWith("blob", 1);
  });

  it("vault wins even when legacy also has a key", async () => {
    getByokCredential.mockResolvedValue("vault-key");
    getOrganizationIntegration.mockResolvedValue({ isEnabled: true, credentials: { encrypted: "blob" } });
    decryptJsonCredentials.mockReturnValue({ apiKey: "legacy-key" });
    expect(await resolveProviderCredential(1, OPTS)).toBe("vault-key");
  });

  it("returns null when the legacy integration is disabled", async () => {
    getByokCredential.mockResolvedValue(null);
    getOrganizationIntegration.mockResolvedValue({ isEnabled: false, credentials: { encrypted: "blob" } });
    expect(await resolveProviderCredential(1, OPTS)).toBeNull();
    expect(decryptJsonCredentials).not.toHaveBeenCalled();
  });

  it("returns null when neither store has the credential", async () => {
    getByokCredential.mockResolvedValue(null);
    getOrganizationIntegration.mockResolvedValue(undefined);
    expect(await resolveProviderCredential(1, OPTS)).toBeNull();
  });

  it("returns null when the decrypted blob lacks the requested field", async () => {
    getByokCredential.mockResolvedValue(null);
    getOrganizationIntegration.mockResolvedValue({ isEnabled: true, credentials: { encrypted: "blob" } });
    decryptJsonCredentials.mockReturnValue({ somethingElse: "x" });
    expect(await resolveProviderCredential(1, OPTS)).toBeNull();
  });

  it("falls through to legacy when the vault read throws (fail-soft)", async () => {
    getByokCredential.mockRejectedValue(new Error("vault down"));
    getOrganizationIntegration.mockResolvedValue({ isEnabled: true, credentials: { encrypted: "blob" } });
    decryptJsonCredentials.mockReturnValue({ apiKey: "legacy-key" });
    expect(await resolveProviderCredential(1, OPTS)).toBe("legacy-key");
  });

  it("returns null and never throws when both reads fail", async () => {
    getByokCredential.mockRejectedValue(new Error("vault down"));
    getOrganizationIntegration.mockRejectedValue(new Error("db down"));
    await expect(resolveProviderCredential(1, OPTS)).resolves.toBeNull();
  });
});
