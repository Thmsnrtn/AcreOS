/**
 * P9-2c — SendGrid vault consolidation (credential consolidation, SendGrid
 * portion; stacked on P9-2b / PR #840).
 *
 * Pins:
 *  1. Backfill parity + idempotency: a legacy sendgrid apiKey lands in the
 *     vault byte-identical (through the injected deps), an existing vault
 *     row is never overwritten, a dry run writes nothing, disabled / keyless
 *     rows are skipped, and a second run copies zero. Only apiKey is
 *     vaulted — the legacy bag's fromEmail/fromName are proven unread for
 *     sendgrid (Step-0), so there is nothing else to copy.
 *  2. Write freeze (source population): both legacy write routes route a
 *     sendgrid save through setByokCredential, the flipped readers resolve
 *     sendgrid through resolveProviderCredential, a sendgrid disconnect
 *     revokes the vault row, and the whitelabel domain flows no longer read
 *     the legacy sendgrid row directly.
 *
 * Fixture keys are obviously fake. No real credential value appears here.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { backfillSendGridCredentials, type SendGridBackfillDeps, type SendGridLegacyRow } from "../../server/services/providers/sendgridBackfill";

const FAKE_KEY = "test_fake-sendgrid-key-for-tests-only-0001";
const FAKE_VAULT_KEY = "test_fake-vault-key-already-present-0002";

function fakeDeps(rows: SendGridLegacyRow[], vault: Map<number, string>) {
  const setCalls: Array<{ org: number; key: string }> = [];
  const deps: SendGridBackfillDeps = {
    listLegacySendGridRows: async () => rows,
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

const enabledRow = (org: number, key: string | null): SendGridLegacyRow => ({
  organizationId: org,
  isEnabled: true,
  credentials: key ? { apiKey: key } : {},
});

describe("sendgrid backfill (Stage 2, SendGrid portion)", () => {
  it("copies a legacy key into the vault byte-identical (parity)", async () => {
    const vault = new Map<number, string>();
    const { deps, setCalls } = fakeDeps([enabledRow(11, FAKE_KEY)], vault);
    const r = await backfillSendGridCredentials(deps, { write: true });
    expect(setCalls).toEqual([{ org: 11, key: FAKE_KEY }]);
    expect(vault.get(11)).toBe(FAKE_KEY);
    expect(r).toMatchObject({ scanned: 1, withLegacyKey: 1, copied: 1, alreadyInVault: 0 });
  });

  it("never overwrites an existing vault credential", async () => {
    const vault = new Map<number, string>([[11, FAKE_VAULT_KEY]]);
    const { deps, setCalls } = fakeDeps([enabledRow(11, FAKE_KEY)], vault);
    const r = await backfillSendGridCredentials(deps, { write: true });
    expect(setCalls).toEqual([]);
    expect(vault.get(11)).toBe(FAKE_VAULT_KEY);
    expect(r.alreadyInVault).toBe(1);
    expect(r.copied).toBe(0);
  });

  it("dry run writes nothing but counts wouldCopy", async () => {
    const vault = new Map<number, string>();
    const { deps, setCalls } = fakeDeps([enabledRow(11, FAKE_KEY)], vault);
    const r = await backfillSendGridCredentials(deps, { write: false });
    expect(setCalls).toEqual([]);
    expect(r.wouldCopy).toBe(1);
    expect(r.copied).toBe(0);
  });

  it("is idempotent: a second write run copies zero", async () => {
    const vault = new Map<number, string>();
    const { deps, setCalls } = fakeDeps([enabledRow(11, FAKE_KEY), enabledRow(12, FAKE_KEY)], vault);
    await backfillSendGridCredentials(deps, { write: true });
    expect(setCalls).toHaveLength(2);
    const r2 = await backfillSendGridCredentials(deps, { write: true });
    expect(setCalls).toHaveLength(2);
    expect(r2.copied).toBe(0);
    expect(r2.alreadyInVault).toBe(2);
  });

  it("skips disabled rows and rows with no key", async () => {
    const vault = new Map<number, string>();
    const rows: SendGridLegacyRow[] = [
      { organizationId: 11, isEnabled: false, credentials: { apiKey: FAKE_KEY } },
      enabledRow(12, null),
    ];
    const { deps, setCalls } = fakeDeps(rows, vault);
    const r = await backfillSendGridCredentials(deps, { write: true });
    expect(setCalls).toEqual([]);
    expect(r).toMatchObject({ scanned: 2, skippedDisabled: 1, skippedNoKey: 1, copied: 0 });
  });
});

describe("sendgrid write freeze + reader flip (source population)", () => {
  const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");

  it("save-api-key writes a sendgrid key through the vault (combined freeze branch)", () => {
    const src = read("server/routes-misc.ts");
    const sgBranch = src.indexOf("P9-2c: sendgrid is frozen the same way");
    const legacyWrite = src.indexOf("upsertOrganizationIntegration", sgBranch);
    expect(sgBranch).toBeGreaterThan(-1);
    expect(src.slice(sgBranch, legacyWrite)).toContain("setByokCredential");
    expect(src.slice(sgBranch, legacyWrite)).toContain('"sendgrid"');
  });

  it("POST /api/integrations/:provider writes a sendgrid key through the vault, legacy write only in the else branch", () => {
    const src = read("server/routes-integrations.ts");
    const sgBranch = src.indexOf("P9-2c: sendgrid is frozen the same way");
    expect(sgBranch).toBeGreaterThan(-1);
    // Window is 900, not the regrid/lob pins' 600: the sendgrid branch is
    // the third else-if in this chain, after the regrid and lob branches.
    const segment = src.slice(sgBranch, sgBranch + 900);
    expect(segment).toContain("setByokCredential");
    expect(segment).toContain("'sendgrid'");
    const legacyAfter = src.indexOf("upsertOrganizationIntegration", sgBranch);
    expect(src.slice(sgBranch, legacyAfter)).not.toContain("upsertOrganizationIntegration");
  });

  it("the flipped readers resolve sendgrid through the vault-first resolver", () => {
    const integrations = read("server/routes-integrations.ts");
    expect(integrations).toContain("legacyProvider: 'sendgrid'");
    expect(integrations).toContain("channel: 'sendgrid'");
    const misc = read("server/routes-misc.ts");
    const statusBranch = misc.indexOf("P9-2c: sendgrid status resolves vault-first");
    expect(statusBranch).toBeGreaterThan(-1);
    expect(misc.slice(statusBranch, statusBranch + 700)).toContain("resolveProviderCredential");
  });

  it("a sendgrid disconnect revokes the vault row", () => {
    const src = read("server/routes-integrations.ts");
    const sgDelete = src.indexOf("P9-2c: same for a sendgrid disconnect");
    expect(sgDelete).toBeGreaterThan(-1);
    const segment = src.slice(sgDelete, sgDelete + 400);
    expect(segment).toContain("revokeByokCredential");
    expect(segment).toContain("channel: 'sendgrid'");
  });

  it("the whitelabel domain flows resolve the key vault-first — no direct legacy sendgrid read remains", () => {
    const src = read("server/routes-integrations.ts");
    expect(src).not.toContain("getOrganizationIntegration(org.id, 'sendgrid')");
    expect(src).not.toContain('getOrganizationIntegration(org.id, "sendgrid")');
    // All three whitelabel flows (create / validate / delete) go through the
    // resolver: list + 3 whitelabel = 4 literal sendgrid resolver legs.
    const legs = src.match(/legacyProvider: 'sendgrid'/g) ?? [];
    expect(legs.length).toBe(4);
  });
});
