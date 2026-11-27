/**
 * P9-2e — SES vault consolidation (credential consolidation, SES portion;
 * stacked on P9-2d / PR #846).
 *
 * Pins:
 *  1. The packing convention (sesCredential): the legacy `aws_ses` bag is
 *     packed as a JSON string in the vault channel `ses`; the parser
 *     requires BOTH secret-bearing fields, and the POST-route builder
 *     follows the route's historical {apiKey, ...settings} merge shape.
 *  2. Backfill gates, behavioural: a complete legacy bag lands in the
 *     vault as JSON that parses back to the exact bag (parity), an
 *     existing vault row is never overwritten, a dry run writes nothing,
 *     disabled rows are skipped, a bag missing a secret field is
 *     skippedIncomplete (NOT migrated), an oversized bag is
 *     skippedUnmigratable, and a second run copies zero.
 *  3. Write freeze + read flips (source population): POST
 *     /api/integrations/:provider accepts aws_ses vault-only; save-api-key
 *     rejects aws_ses with the pointer const; emailService and
 *     financeAgent read the vault bag first; the list/get/status surfaces
 *     resolve aws_ses vault-first; a disconnect revokes channel 'ses'.
 *
 * Fixture keys are obviously fake. No real credential value appears here.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  parseSesVaultCredential,
  buildSesVaultPlaintext,
  SES_VAULT_PLAINTEXT_MAX,
} from "../../server/services/providers/sesCredential";
import {
  backfillSesCredentials,
  type SesBackfillDeps,
  type SesLegacyRow,
} from "../../server/services/providers/sesBackfill";
import type { SesCredentialBag } from "../../server/services/providers/sesCredential";

const FAKE_BAG: SesCredentialBag = {
  accessKeyId: "AKIAFAKE000000000001",
  secretAccessKey: "fake-secret-access-key-for-tests-only-0001",
  region: "us-west-2",
  fromEmail: "deals@example.org",
  fromName: "Example Org",
};
const FAKE_VAULT_BAG: SesCredentialBag = {
  accessKeyId: "AKIAFAKE000000000002",
  secretAccessKey: "fake-vault-secret-already-present-0002",
};

describe("ses packing convention (aws_ses provider <-> ses channel)", () => {
  it("parses a complete JSON bag, config fields included", () => {
    expect(parseSesVaultCredential(JSON.stringify(FAKE_BAG))).toEqual(FAKE_BAG);
  });

  it("parses a minimal bag (secrets only)", () => {
    const minimal = { accessKeyId: FAKE_BAG.accessKeyId, secretAccessKey: FAKE_BAG.secretAccessKey };
    expect(parseSesVaultCredential(JSON.stringify(minimal))).toEqual(minimal);
  });

  it("rejects non-JSON, non-object, and partial bags", () => {
    expect(parseSesVaultCredential(null)).toBeNull();
    expect(parseSesVaultCredential("not-json")).toBeNull();
    expect(parseSesVaultCredential(JSON.stringify("a-string"))).toBeNull();
    expect(parseSesVaultCredential(JSON.stringify({ accessKeyId: "x" }))).toBeNull();
    expect(parseSesVaultCredential(JSON.stringify({ secretAccessKey: "y" }))).toBeNull();
    expect(parseSesVaultCredential(JSON.stringify({ accessKeyId: "", secretAccessKey: "y" }))).toBeNull();
  });

  it("builds the vault plaintext from the historical {apiKey, ...settings} shape", () => {
    const plaintext = buildSesVaultPlaintext(FAKE_BAG.accessKeyId, {
      secretAccessKey: FAKE_BAG.secretAccessKey,
      region: FAKE_BAG.region,
      fromEmail: FAKE_BAG.fromEmail,
      fromName: FAKE_BAG.fromName,
    });
    expect(parseSesVaultCredential(plaintext)).toEqual(FAKE_BAG);
  });

  it("settings.accessKeyId wins over apiKey, mirroring the historical spread order", () => {
    const plaintext = buildSesVaultPlaintext("AKIAIGNORED00000000", {
      accessKeyId: FAKE_BAG.accessKeyId,
      secretAccessKey: FAKE_BAG.secretAccessKey,
    });
    expect(parseSesVaultCredential(plaintext)?.accessKeyId).toBe(FAKE_BAG.accessKeyId);
  });

  it("refuses to build a partial bag", () => {
    expect(buildSesVaultPlaintext(FAKE_BAG.accessKeyId, {})).toBeNull();
    expect(buildSesVaultPlaintext(undefined, { secretAccessKey: "s" })).toBeNull();
    expect(buildSesVaultPlaintext(undefined, undefined)).toBeNull();
  });
});

function fakeDeps(rows: SesLegacyRow[], vault: Map<number, string>) {
  const setCalls: Array<{ org: number; plaintext: string }> = [];
  const deps: SesBackfillDeps = {
    listLegacySesRows: async () => rows,
    readLegacySesBag: (row) => {
      const c = row.credentials as Partial<SesCredentialBag> | null;
      if (!c?.accessKeyId || !c?.secretAccessKey) return null;
      return {
        accessKeyId: c.accessKeyId,
        secretAccessKey: c.secretAccessKey,
        ...(c.region ? { region: c.region } : {}),
        ...(c.fromEmail ? { fromEmail: c.fromEmail } : {}),
        ...(c.fromName ? { fromName: c.fromName } : {}),
      };
    },
    getVaultCredential: async (org) => vault.get(org) ?? null,
    setVaultCredential: async (org, plaintext) => {
      setCalls.push({ org, plaintext });
      vault.set(org, plaintext);
    },
  };
  return { deps, setCalls };
}

const enabledRow = (org: number, bag: Partial<SesCredentialBag> | null): SesLegacyRow => ({
  organizationId: org,
  isEnabled: true,
  credentials: bag ?? {},
});

describe("ses backfill (Stage 2, SES portion)", () => {
  it("copies a complete legacy bag into the vault as parseable JSON (parity)", async () => {
    const vault = new Map<number, string>();
    const { deps, setCalls } = fakeDeps([enabledRow(11, FAKE_BAG)], vault);
    const r = await backfillSesCredentials(deps, { write: true });
    expect(setCalls.length).toBe(1);
    expect(parseSesVaultCredential(setCalls[0].plaintext)).toEqual(FAKE_BAG);
    expect(parseSesVaultCredential(vault.get(11))).toEqual(FAKE_BAG);
    expect(r).toMatchObject({ scanned: 1, withLegacyKey: 1, copied: 1, alreadyInVault: 0 });
  });

  it("never overwrites an existing vault credential", async () => {
    const vault = new Map<number, string>([[11, JSON.stringify(FAKE_VAULT_BAG)]]);
    const { deps, setCalls } = fakeDeps([enabledRow(11, FAKE_BAG)], vault);
    const r = await backfillSesCredentials(deps, { write: true });
    expect(setCalls).toEqual([]);
    expect(parseSesVaultCredential(vault.get(11))).toEqual(FAKE_VAULT_BAG);
    expect(r.alreadyInVault).toBe(1);
    expect(r.copied).toBe(0);
  });

  it("dry run writes nothing but counts wouldCopy", async () => {
    const vault = new Map<number, string>();
    const { deps, setCalls } = fakeDeps([enabledRow(11, FAKE_BAG)], vault);
    const r = await backfillSesCredentials(deps, { write: false });
    expect(setCalls).toEqual([]);
    expect(r.wouldCopy).toBe(1);
    expect(r.copied).toBe(0);
  });

  it("is idempotent: a second write run copies zero", async () => {
    const vault = new Map<number, string>();
    const { deps } = fakeDeps([enabledRow(11, FAKE_BAG)], vault);
    await backfillSesCredentials(deps, { write: true });
    const r2 = await backfillSesCredentials(deps, { write: true });
    expect(r2.copied).toBe(0);
    expect(r2.alreadyInVault).toBe(1);
  });

  it("skips incomplete bags (missing either secret field) without migrating them", async () => {
    const vault = new Map<number, string>();
    const rows = [
      enabledRow(11, { accessKeyId: FAKE_BAG.accessKeyId }),
      enabledRow(12, { secretAccessKey: FAKE_BAG.secretAccessKey }),
      enabledRow(13, null),
    ];
    const { deps, setCalls } = fakeDeps(rows, vault);
    const r = await backfillSesCredentials(deps, { write: true });
    expect(setCalls).toEqual([]);
    expect(r).toMatchObject({ scanned: 3, skippedIncomplete: 3, copied: 0, withLegacyKey: 0 });
  });

  it("skips oversized bags as unmigratable", async () => {
    const vault = new Map<number, string>();
    const big: SesCredentialBag = {
      accessKeyId: FAKE_BAG.accessKeyId,
      secretAccessKey: "s".repeat(SES_VAULT_PLAINTEXT_MAX),
    };
    const { deps, setCalls } = fakeDeps([enabledRow(11, big)], vault);
    const r = await backfillSesCredentials(deps, { write: true });
    expect(setCalls).toEqual([]);
    expect(r).toMatchObject({ scanned: 1, skippedUnmigratable: 1, copied: 0 });
  });

  it("skips disabled rows", async () => {
    const vault = new Map<number, string>();
    const rows: SesLegacyRow[] = [{ organizationId: 11, isEnabled: false, credentials: FAKE_BAG }];
    const { deps, setCalls } = fakeDeps(rows, vault);
    const r = await backfillSesCredentials(deps, { write: true });
    expect(setCalls).toEqual([]);
    expect(r).toMatchObject({ scanned: 1, skippedDisabled: 1, copied: 0 });
  });
});

describe("ses write freeze + read flips (source population)", () => {
  const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");

  it("POST /api/integrations/:provider accepts aws_ses and vaults the JSON bag in channel 'ses'", () => {
    const src = read("server/routes-integrations.ts");
    expect(src).toContain("'aws_ses'");
    const branch = src.indexOf("P9-2e: aws_ses is frozen the same way");
    expect(branch).toBeGreaterThan(-1);
    const segment = src.slice(branch, branch + 1400);
    expect(segment).toContain("buildSesVaultPlaintext");
    expect(segment).toContain("setByokCredential");
    expect(segment).toContain("channel: 'ses'");
  });

  it("save-api-key rejects aws_ses with the pointer const (no shape invented)", () => {
    const src = read("server/routes-misc.ts");
    expect(src).toContain('if (service === "aws_ses") return Errors.badRequest(res, SES_POINTER);');
    expect(src).toContain("POST /api/integrations/aws_ses");
  });

  it("emailService.getOrgCredentials reads the vault bag before the legacy row", () => {
    const src = read("server/services/emailService.ts");
    const fn = src.indexOf("async function getOrgCredentials");
    expect(fn).toBeGreaterThan(-1);
    const segment = src.slice(fn, fn + 2600);
    expect(segment).toContain("readSesVaultBag");
    expect(segment.indexOf("readSesVaultBag")).toBeLessThan(
      segment.indexOf("getOrganizationIntegration"),
    );
    // The legacy leg is preserved as the fallback (Stage 4 retires it).
    expect(segment).toContain("getOrganizationIntegration(orgId, 'aws_ses')");
  });

  it("financeAgent's identity probe counts a valid vault bag as connected", () => {
    const src = read("server/services/financeAgent.ts");
    const fn = src.indexOf("hasConnectedSendingIdentity");
    expect(fn).toBeGreaterThan(-1);
    const segment = src.slice(fn, fn + 2600);
    expect(segment).toContain("readSesVaultBag");
    expect(segment).toContain("!!vaultSes");
  });

  it("the list/get/status surfaces resolve aws_ses vault-first", () => {
    const integrations = read("server/routes-integrations.ts");
    expect(integrations).toContain("sesAccessKeyId");
    expect(integrations).toContain("provider === 'aws_ses'");
    const misc = read("server/routes-misc.ts");
    const statusBranch = misc.indexOf('service === "aws_ses"');
    expect(statusBranch).toBeGreaterThan(-1);
    expect(misc.slice(statusBranch, statusBranch + 500)).toContain("readSesVaultBag");
    expect(misc).toContain('"aws_ses"');
  });

  it("an aws_ses disconnect revokes the vault 'ses' row", () => {
    const src = read("server/routes-integrations.ts");
    const del = src.indexOf("P9-2e: same for an aws_ses disconnect");
    expect(del).toBeGreaterThan(-1);
    const segment = src.slice(del, del + 400);
    expect(segment).toContain("revokeByokCredential");
    expect(segment).toContain("channel: 'ses'");
  });
});
