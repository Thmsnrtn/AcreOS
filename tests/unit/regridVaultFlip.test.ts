/**
 * P9-2a — Regrid vault-first flip (credential consolidation, Regrid portion).
 *
 * Pins:
 *  1. Backfill parity + idempotency: a legacy regrid key lands in the vault
 *     byte-identical (through the injected deps), an existing vault row is
 *     never overwritten, a dry run writes nothing, disabled / keyless rows
 *     are skipped, and a second run copies zero.
 *  2. Write freeze (source population): both legacy write routes route a
 *     regrid save through setByokCredential, and the flipped readers resolve
 *     regrid through resolveProviderCredential — no route reads or writes a
 *     regrid credential via organizationIntegrations directly.
 *
 * Fixture keys are obviously fake. No real credential value appears here.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { backfillRegridCredentials, type RegridBackfillDeps, type RegridLegacyRow } from "../../server/services/providers/regridBackfill";

const FAKE_KEY = "fake-regrid-key-for-tests-only-0001";
const FAKE_VAULT_KEY = "fake-vault-key-already-present-0002";

function fakeDeps(rows: RegridLegacyRow[], vault: Map<number, string>) {
  const setCalls: Array<{ org: number; key: string }> = [];
  const deps: RegridBackfillDeps = {
    listLegacyRegridRows: async () => rows,
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

const enabledRow = (org: number, key: string | null): RegridLegacyRow => ({
  organizationId: org,
  isEnabled: true,
  credentials: key ? { apiKey: key } : {},
});

describe("regrid backfill (Stage 2, Regrid portion)", () => {
  it("copies a legacy key into the vault byte-identical (parity)", async () => {
    const vault = new Map<number, string>();
    const { deps, setCalls } = fakeDeps([enabledRow(11, FAKE_KEY)], vault);
    const r = await backfillRegridCredentials(deps, { write: true });
    expect(setCalls).toEqual([{ org: 11, key: FAKE_KEY }]);
    expect(vault.get(11)).toBe(FAKE_KEY);
    expect(r).toMatchObject({ scanned: 1, withLegacyKey: 1, copied: 1, alreadyInVault: 0 });
  });

  it("never overwrites an existing vault credential", async () => {
    const vault = new Map<number, string>([[11, FAKE_VAULT_KEY]]);
    const { deps, setCalls } = fakeDeps([enabledRow(11, FAKE_KEY)], vault);
    const r = await backfillRegridCredentials(deps, { write: true });
    expect(setCalls).toEqual([]);
    expect(vault.get(11)).toBe(FAKE_VAULT_KEY);
    expect(r.alreadyInVault).toBe(1);
    expect(r.copied).toBe(0);
  });

  it("dry run writes nothing but counts wouldCopy", async () => {
    const vault = new Map<number, string>();
    const { deps, setCalls } = fakeDeps([enabledRow(11, FAKE_KEY)], vault);
    const r = await backfillRegridCredentials(deps, { write: false });
    expect(setCalls).toEqual([]);
    expect(r.wouldCopy).toBe(1);
    expect(r.copied).toBe(0);
  });

  it("is idempotent: a second write run copies zero", async () => {
    const vault = new Map<number, string>();
    const { deps, setCalls } = fakeDeps([enabledRow(11, FAKE_KEY), enabledRow(12, FAKE_KEY)], vault);
    await backfillRegridCredentials(deps, { write: true });
    expect(setCalls).toHaveLength(2);
    const r2 = await backfillRegridCredentials(deps, { write: true });
    expect(setCalls).toHaveLength(2);
    expect(r2.copied).toBe(0);
    expect(r2.alreadyInVault).toBe(2);
  });

  it("skips disabled rows and rows with no key", async () => {
    const vault = new Map<number, string>();
    const rows: RegridLegacyRow[] = [
      { organizationId: 11, isEnabled: false, credentials: { apiKey: FAKE_KEY } },
      enabledRow(12, null),
    ];
    const { deps, setCalls } = fakeDeps(rows, vault);
    const r = await backfillRegridCredentials(deps, { write: true });
    expect(setCalls).toEqual([]);
    expect(r).toMatchObject({ scanned: 2, skippedDisabled: 1, skippedNoKey: 1, copied: 0 });
  });
});

describe("regrid write freeze + reader flip (source population)", () => {
  const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");

  it("routes-properties charge probes resolve via the vault-first resolver, never the legacy store directly", () => {
    const src = read("server/routes-properties.ts");
    expect(src).not.toContain("getOrganizationIntegration(org.id, 'regrid')");
    expect(src).not.toContain('getOrganizationIntegration(org.id, "regrid")');
    const probes = src.match(/resolveProviderCredential\(org\.id/g) ?? [];
    expect(probes.length).toBe(2);
  });

  it("save-api-key writes a regrid key through the vault", () => {
    const src = read("server/routes-misc.ts");
    const regridBranch = src.indexOf("P9-2a write freeze");
    const legacyWrite = src.indexOf("upsertOrganizationIntegration", regridBranch);
    expect(regridBranch).toBeGreaterThan(-1);
    expect(src.slice(regridBranch, legacyWrite)).toContain("setByokCredential");
  });

  it("POST /api/integrations/:provider writes a regrid key through the vault, legacy write only in the else branch", () => {
    const src = read("server/routes-integrations.ts");
    const regridBranch = src.indexOf("P9-2a write freeze");
    expect(regridBranch).toBeGreaterThan(-1);
    const segment = src.slice(regridBranch, regridBranch + 600);
    expect(segment).toContain("setByokCredential");
    expect(segment).toContain("regrid");
    const legacyAfter = src.indexOf("upsertOrganizationIntegration", regridBranch);
    expect(src.slice(regridBranch, legacyAfter)).not.toContain("upsertOrganizationIntegration");
  });

  it("no server route reads a regrid credential straight from organizationIntegrations outside the resolver", () => {
    for (const rel of ["server/routes-properties.ts", "server/routes-misc.ts", "server/routes-integrations.ts"]) {
      const src = read(rel);
      expect(src).not.toMatch(/getOrganizationIntegration\([^)]*'regrid'\)/);
    }
  });
});
