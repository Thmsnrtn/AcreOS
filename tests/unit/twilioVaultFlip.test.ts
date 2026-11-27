/**
 * P9-2d — Twilio credential consolidation (credential consolidation,
 * Twilio portion; stacked on P9-2c / PR #842).
 *
 * Pins:
 *  1. Backfill: a complete legacy tuple lands in the vault byte-identical
 *     as "<accountSid>:<authToken>:<fromPhoneNumber>", an existing vault
 *     row is never overwritten, a dry run writes nothing, disabled rows
 *     are skipped, and a second run copies zero. Twilio gates: a row
 *     missing ANY field is skippedIncomplete (never migrated), and a row
 *     with ":" inside any field is skippedUnmigratable (never migrated)
 *     — the tuple must round-trip through split(":") with exactly 3
 *     non-empty parts.
 *  2. Write freeze (source population): both generic POST routes REJECT
 *     a twilio write with the explicit pointer to the SMS settings /
 *     BYOK hub (coordinator ruling, Option A — neither route receives
 *     enough to form the tuple); saveTwilioCredentials vaults the
 *     verified tuple via setByokCredential; a twilio disconnect revokes
 *     the vault row.
 *  3. Read flips (source population): the comms adapter is vault-only,
 *     the inbound signature middleware has no legacy leg, the SMS
 *     configuration check is vault-first, and the generic surfaces
 *     resolve twilio through the vault-first resolver / tuple helper.
 *
 * Fixture credentials are obviously fake. No real value appears here.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { backfillTwilioCredentials, type TwilioBackfillDeps, type TwilioLegacyRow } from "../../server/services/providers/twilioBackfill";

const SID = "AC_fake-sid-for-tests-only-0001";
const TOKEN = "fake-auth-token-for-tests-only-0002";
const PHONE = "+15555550100";
const TUPLE = `${SID}:${TOKEN}:${PHONE}`;
const FAKE_VAULT_TUPLE = "AC_vault:fake-vault-token-0003:+15555550199";

function fakeDeps(rows: TwilioLegacyRow[], vault: Map<number, string>) {
  const setCalls: Array<{ org: number; plaintext: string }> = [];
  const deps: TwilioBackfillDeps = {
    listLegacyTwilioRows: async () => rows,
    readLegacyTuple: (row) => {
      const c = row.credentials as { accountSid?: string; authToken?: string; fromPhoneNumber?: string } | null;
      return c ?? null;
    },
    getVaultCredential: async (org) => vault.get(org) ?? null,
    setVaultCredential: async (org, plaintext) => {
      setCalls.push({ org, plaintext });
      vault.set(org, plaintext);
    },
  };
  return { deps, setCalls };
}

const enabledRow = (org: number, creds: Record<string, string> | null): TwilioLegacyRow => ({
  organizationId: org,
  isEnabled: true,
  credentials: creds,
});
const completeRow = (org: number): TwilioLegacyRow =>
  enabledRow(org, { accountSid: SID, authToken: TOKEN, fromPhoneNumber: PHONE });

describe("twilio backfill (Stage 2, Twilio portion)", () => {
  it("copies a complete legacy tuple into the vault byte-identical (parity)", async () => {
    const vault = new Map<number, string>();
    const { deps, setCalls } = fakeDeps([completeRow(11)], vault);
    const r = await backfillTwilioCredentials(deps, { write: true });
    expect(setCalls).toEqual([{ org: 11, plaintext: TUPLE }]);
    expect(vault.get(11)).toBe(TUPLE);
    expect(r).toMatchObject({ scanned: 1, withLegacyTuple: 1, copied: 1, alreadyInVault: 0 });
  });

  it("never overwrites an existing vault credential", async () => {
    const vault = new Map<number, string>([[11, FAKE_VAULT_TUPLE]]);
    const { deps, setCalls } = fakeDeps([completeRow(11)], vault);
    const r = await backfillTwilioCredentials(deps, { write: true });
    expect(setCalls).toEqual([]);
    expect(vault.get(11)).toBe(FAKE_VAULT_TUPLE);
    expect(r.alreadyInVault).toBe(1);
    expect(r.copied).toBe(0);
  });

  it("dry run writes nothing but counts wouldCopy", async () => {
    const vault = new Map<number, string>();
    const { deps, setCalls } = fakeDeps([completeRow(11)], vault);
    const r = await backfillTwilioCredentials(deps, { write: false });
    expect(setCalls).toEqual([]);
    expect(r.wouldCopy).toBe(1);
    expect(r.copied).toBe(0);
  });

  it("is idempotent: a second write run copies zero", async () => {
    const vault = new Map<number, string>();
    const { deps, setCalls } = fakeDeps([completeRow(11), completeRow(12)], vault);
    await backfillTwilioCredentials(deps, { write: true });
    expect(setCalls).toHaveLength(2);
    const r2 = await backfillTwilioCredentials(deps, { write: true });
    expect(setCalls).toHaveLength(2);
    expect(r2.copied).toBe(0);
    expect(r2.alreadyInVault).toBe(2);
  });

  it("skips disabled rows", async () => {
    const vault = new Map<number, string>();
    const rows: TwilioLegacyRow[] = [
      { organizationId: 11, isEnabled: false, credentials: { accountSid: SID, authToken: TOKEN, fromPhoneNumber: PHONE } },
    ];
    const { deps, setCalls } = fakeDeps(rows, vault);
    const r = await backfillTwilioCredentials(deps, { write: true });
    expect(setCalls).toEqual([]);
    expect(r).toMatchObject({ scanned: 1, skippedDisabled: 1, copied: 0 });
  });

  it("GATE: a row missing any tuple field is skippedIncomplete, never migrated", async () => {
    const vault = new Map<number, string>();
    const rows: TwilioLegacyRow[] = [
      enabledRow(11, { accountSid: SID, authToken: TOKEN }), // no phone
      enabledRow(12, { authToken: TOKEN, fromPhoneNumber: PHONE }), // no SID
      enabledRow(13, { accountSid: SID, fromPhoneNumber: PHONE }), // no token
      enabledRow(14, null), // nothing at all
      enabledRow(15, { accountSid: SID, authToken: "", fromPhoneNumber: PHONE }), // empty token
    ];
    const { deps, setCalls } = fakeDeps(rows, vault);
    const r = await backfillTwilioCredentials(deps, { write: true });
    expect(setCalls).toEqual([]);
    expect(r).toMatchObject({ scanned: 5, skippedIncomplete: 5, copied: 0, withLegacyTuple: 0 });
  });

  it("GATE: a row with ':' inside any field is skippedUnmigratable, never migrated", async () => {
    const vault = new Map<number, string>();
    const rows: TwilioLegacyRow[] = [
      enabledRow(11, { accountSid: "AC:bad", authToken: TOKEN, fromPhoneNumber: PHONE }),
      enabledRow(12, { accountSid: SID, authToken: "tok:en", fromPhoneNumber: PHONE }),
      enabledRow(13, { accountSid: SID, authToken: TOKEN, fromPhoneNumber: "+1:5555550100" }),
    ];
    const { deps, setCalls } = fakeDeps(rows, vault);
    const r = await backfillTwilioCredentials(deps, { write: true });
    expect(setCalls).toEqual([]);
    expect(r).toMatchObject({ scanned: 3, skippedUnmigratable: 3, copied: 0, withLegacyTuple: 0 });
  });
});

describe("twilio write freeze + reader flip (source population)", () => {
  const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");

  it("POST /api/integrations/:provider REJECTS a twilio write with the pointer to the tuple surfaces", () => {
    const src = read("server/routes-integrations.ts");
    const at = src.indexOf("P9-2d (coordinator ruling, Option A)");
    expect(at).toBeGreaterThan(-1);
    const segment = src.slice(at, at + 1200);
    expect(segment).toContain("provider === 'twilio'");
    expect(segment).toContain("Errors.badRequest");
    expect(segment).toContain("/api/sms/config");
    // The rejection precedes the generic legacy write in this handler.
    expect(at).toBeLessThan(src.indexOf("upsertOrganizationIntegration"));
  });

  it("POST /api/settings/save-api-key REJECTS a twilio save with the pointer to the tuple surfaces", () => {
    const src = read("server/routes-misc.ts");
    const at = src.indexOf("P9-2d (ruling, Option A)");
    expect(at).toBeGreaterThan(-1);
    const segment = src.slice(at, at + 800);
    expect(segment).toContain('service === "twilio"');
    expect(segment).toContain("Errors.badRequest");
    expect(segment).toContain("/api/sms/config");
  });

  it("saveTwilioCredentials vaults the verified tuple via setByokCredential and never seals into the legacy bag", () => {
    const src = read("server/services/smsService.ts");
    const at = src.indexOf("export async function saveTwilioCredentials");
    expect(at).toBeGreaterThan(-1);
    const segment = src.slice(at);
    expect(segment).toContain("setByokCredential");
    expect(segment).toContain("`${accountSid}:${authToken}:${fromPhoneNumber}`");
    expect(segment).not.toContain("sealIntegrationCredentials");
  });

  it("checkTwilioConfiguration is vault-first (tuple presence/parse), with the platform fallback kept", () => {
    const src = read("server/services/smsService.ts");
    const at = src.indexOf("export async function checkTwilioConfiguration");
    const segment = src.slice(at, src.indexOf("export async function saveTwilioCredentials"));
    expect(segment).toContain("getByokCredential");
    expect(segment).toContain('channel: "twilio"');
    expect(segment).toContain("twilioProvider.isConfigured()");
    expect(segment).not.toContain("organizationIntegrations");
  });

  it("the comms adapter is vault-only: no legacy organizationIntegrations leg remains", () => {
    const src = read("server/services/comms/providers/twilio.ts");
    expect(src).not.toContain("organizationIntegrations");
    expect(src).toContain('channel: "twilio"');
    // The platform env fallback is untouched.
    expect(src).toContain("platformCredentials()");
  });

  it("the inbound signature middleware has no legacy leg: owner resolution is vault + number-ownership only", () => {
    const src = read("server/middleware/twilioSignature.ts");
    expect(src).not.toContain("organizationIntegrations");
    expect(src).not.toContain("readIntegrationCredentials");
    expect(src).toContain("byokCredentials");
    expect(src).toContain("provisionedPhoneNumbers");
    expect(src).toContain("trackingNumberAssignments");
  });

  it("the generic surfaces resolve twilio vault-first and a twilio disconnect revokes the vault row", () => {
    const integrations = read("server/routes-integrations.ts");
    expect(integrations).toContain("legacyProvider: 'twilio'");
    expect(integrations).toContain("legacyField: 'authToken'");
    expect(integrations).toContain("resolveTwilioTuple");
    const del = integrations.indexOf("P9-2d: same for a twilio disconnect");
    expect(del).toBeGreaterThan(-1);
    expect(integrations.slice(del, del + 400)).toContain("revokeByokCredential");
    expect(integrations.slice(del, del + 400)).toContain("channel: 'twilio'");
    const misc = read("server/routes-misc.ts");
    const status = misc.indexOf("P9-2d: twilio status resolves vault-first");
    expect(status).toBeGreaterThan(-1);
    expect(misc.slice(status, status + 1500)).toContain("resolveProviderCredential");
  });
});
