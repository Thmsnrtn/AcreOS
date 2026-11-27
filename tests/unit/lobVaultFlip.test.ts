/**
 * P9-2b — Lob vault consolidation (credential consolidation, Lob portion).
 *
 * Pins:
 *  1. Backfill parity + idempotency: a legacy lob key lands in the vault
 *     byte-identical (through the injected deps), an existing vault row is
 *     never overwritten, a dry run writes nothing, disabled / keyless rows
 *     are skipped, and a second run copies zero.
 *  2. Legacy-leg removal: directMailService.getOwnLobClient resolves the
 *     org's own key from the BYOK vault ONLY — no organization_integrations
 *     read remains in its body.
 *  3. Write freeze (source population): both legacy write routes route a
 *     lob save through setByokCredential, the flipped readers resolve lob
 *     through resolveProviderCredential, and a lob disconnect revokes the
 *     vault row.
 *
 * Fixture keys are obviously fake. No real credential value appears here.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { backfillLobCredentials, type LobBackfillDeps, type LobLegacyRow } from "../../server/services/providers/lobBackfill";
import { stripComments } from "../helpers/stripComments";

const FAKE_KEY = "test_fake-lob-key-for-tests-only-0001";
const FAKE_VAULT_KEY = "test_fake-vault-key-already-present-0002";

function fakeDeps(rows: LobLegacyRow[], vault: Map<number, string>) {
  const setCalls: Array<{ org: number; key: string }> = [];
  const deps: LobBackfillDeps = {
    listLegacyLobRows: async () => rows,
    readLegacyApiKey: (row) => {
      const c = row.credentials as { apiKey?: string } | null;
      return c?.apiKey ?? null;
    },
    getVaultCredential: async (org) => vault.get(org) ?? null,
    setVaultCredential: async (org, key) => {
      setCalls.push({ org, key });
      vault.set(org, key);
    },
  };
  return { deps, setCalls };
}

const enabledRow = (org: number, key: string | null): LobLegacyRow => ({
  organizationId: org,
  isEnabled: true,
  credentials: key ? { apiKey: key } : {},
});

describe("lob backfill (Stage 2, Lob portion)", () => {
  it("copies a legacy key into the vault byte-identical (parity)", async () => {
    const vault = new Map<number, string>();
    const { deps, setCalls } = fakeDeps([enabledRow(11, FAKE_KEY)], vault);
    const r = await backfillLobCredentials(deps, { write: true });
    expect(setCalls).toEqual([{ org: 11, key: FAKE_KEY }]);
    expect(vault.get(11)).toBe(FAKE_KEY);
    expect(r).toMatchObject({ scanned: 1, withLegacyKey: 1, copied: 1, alreadyInVault: 0 });
  });

  it("never overwrites an existing vault credential", async () => {
    const vault = new Map<number, string>([[11, FAKE_VAULT_KEY]]);
    const { deps, setCalls } = fakeDeps([enabledRow(11, FAKE_KEY)], vault);
    const r = await backfillLobCredentials(deps, { write: true });
    expect(setCalls).toEqual([]);
    expect(vault.get(11)).toBe(FAKE_VAULT_KEY);
    expect(r.alreadyInVault).toBe(1);
    expect(r.copied).toBe(0);
  });

  it("dry run writes nothing but counts wouldCopy", async () => {
    const vault = new Map<number, string>();
    const { deps, setCalls } = fakeDeps([enabledRow(11, FAKE_KEY)], vault);
    const r = await backfillLobCredentials(deps, { write: false });
    expect(setCalls).toEqual([]);
    expect(r.wouldCopy).toBe(1);
    expect(r.copied).toBe(0);
  });

  it("is idempotent: a second write run copies zero", async () => {
    const vault = new Map<number, string>();
    const { deps, setCalls } = fakeDeps([enabledRow(11, FAKE_KEY), enabledRow(12, FAKE_KEY)], vault);
    await backfillLobCredentials(deps, { write: true });
    expect(setCalls).toHaveLength(2);
    const r2 = await backfillLobCredentials(deps, { write: true });
    expect(setCalls).toHaveLength(2);
    expect(r2.copied).toBe(0);
    expect(r2.alreadyInVault).toBe(2);
  });

  it("skips disabled rows and rows with no key", async () => {
    const vault = new Map<number, string>();
    const rows: LobLegacyRow[] = [
      { organizationId: 11, isEnabled: false, credentials: { apiKey: FAKE_KEY } },
      enabledRow(12, null),
    ];
    const { deps, setCalls } = fakeDeps(rows, vault);
    const r = await backfillLobCredentials(deps, { write: true });
    expect(setCalls).toEqual([]);
    expect(r).toMatchObject({ scanned: 2, skippedDisabled: 1, skippedNoKey: 1, copied: 0 });
  });
});

describe("lob legacy-leg removal + write freeze + reader flip (source population)", () => {
  const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");

  it("getOwnLobClient resolves from the vault only — no legacy leg remains", () => {
    const src = stripComments(read("server/services/directMailService.ts"));
    const start = src.indexOf("export async function getOwnLobClient");
    const end = src.indexOf("export async function getLobClientForLane");
    expect(start, "getOwnLobClient not found — renamed?").toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const body = src.slice(start, end);
    expect(body).toContain("getByokCredential");
    expect(body).not.toContain("getOrganizationIntegration");
    expect(body).not.toContain("readIntegrationCredentials");
    expect(body).not.toContain("resolvePlatformLobKey");
  });

  it("save-api-key writes a lob key through the vault", () => {
    const src = read("server/routes-misc.ts");
    const lobBranch = src.indexOf("P9-2b: lob is frozen the same way");
    const legacyWrite = src.indexOf("upsertOrganizationIntegration", lobBranch);
    expect(lobBranch).toBeGreaterThan(-1);
    expect(src.slice(lobBranch, legacyWrite)).toContain("setByokCredential");
  });

  it("POST /api/integrations/:provider writes a lob key through the vault, legacy write only in the else branch", () => {
    const src = read("server/routes-integrations.ts");
    const lobBranch = src.indexOf("P9-2b: lob is frozen the same way");
    expect(lobBranch).toBeGreaterThan(-1);
    const segment = src.slice(lobBranch, lobBranch + 600);
    expect(segment).toContain("setByokCredential");
    expect(segment).toContain("'lob'");
    const legacyAfter = src.indexOf("upsertOrganizationIntegration", lobBranch);
    expect(src.slice(lobBranch, legacyAfter)).not.toContain("upsertOrganizationIntegration");
  });

  it("the flipped readers resolve lob through the vault-first resolver", () => {
    const integrations = read("server/routes-integrations.ts");
    expect(integrations).toContain("legacyProvider: 'lob'");
    expect(integrations).toContain("channel: 'lob'");
    const misc = read("server/routes-misc.ts");
    const statusBranch = misc.indexOf("P9-2b: lob status resolves vault-first");
    expect(statusBranch).toBeGreaterThan(-1);
    expect(misc.slice(statusBranch, statusBranch + 700)).toContain("resolveProviderCredential");
  });

  it("a lob disconnect revokes the vault row", () => {
    const src = read("server/routes-integrations.ts");
    const lobDelete = src.indexOf("P9-2b: same for a lob disconnect");
    expect(lobDelete).toBeGreaterThan(-1);
    const segment = src.slice(lobDelete, lobDelete + 400);
    expect(segment).toContain("revokeByokCredential");
    expect(segment).toContain("channel: 'lob'");
  });
});
