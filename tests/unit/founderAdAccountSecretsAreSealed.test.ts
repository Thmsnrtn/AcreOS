/**
 * DEFECT-0054 — credentials at rest.
 *
 * Two surfaces kept secrets in plain text:
 *   - founder_ad_accounts.access_token / app_secret (AcreOS's own Meta and
 *     TikTok ad credentials), read by five call sites, and the app secret was
 *     returned to the browser unmasked;
 *   - system_api_keys.api_key, written by the founder "System API keys" form.
 *     Nothing read it for an outbound call, and the Data-API verifier accepted
 *     any plain-text row, so each pasted vendor secret was a partner bearer key.
 *
 * Behaviour: sealing round-trips, legacy plain text still opens, and the
 * repo's one write path stores envelopes. Population: every full-row read of
 * founder_ad_accounts opens its secrets, every write of either table is on a
 * sealed or null path, and every ad-account response masks both secrets.
 */
process.env.FIELD_ENCRYPTION_KEY = "ab".repeat(32);

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join, relative } from "node:path";
import { stripComments } from "../helpers/stripComments";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";

const inserted: Array<Record<string, unknown>> = [];
const updated: Array<Record<string, unknown>> = [];
vi.mock("../../server/db", () => ({
  db: {
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        inserted.push(v);
        return { returning: async () => [{ id: 1, ...v }] };
      },
    }),
    update: () => ({
      set: (v: Record<string, unknown>) => {
        updated.push(v);
        return { where: () => ({ returning: async () => [{ id: 1, ...v }] }) };
      },
    }),
  },
}));

import {
  sealAdAccountSecret,
  openFounderAdAccount,
  maskAdAccountSecret,
} from "../../server/services/founderAdAccountSecrets";

const open = (accessToken: string, appSecret: string | null = null) =>
  openFounderAdAccount({ accessToken, appSecret });
import { isAnyEncryptedEnvelope } from "../../server/services/fieldEncryption";
import { growthConfigRepo } from "../../server/storage/growthConfigRepo";

vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

const ROOT = resolve(__dirname, "../..");

describe("DEFECT-0054 behaviour — ad-account secrets are sealed at rest", () => {
  beforeEach(() => {
    inserted.length = 0;
    updated.length = 0;
  });

  it("seal produces an envelope and open returns the secret", () => {
    const sealed = sealAdAccountSecret("EAAB-live-token-1234");
    expect(isAnyEncryptedEnvelope(sealed)).toBe(true);
    expect(sealed).not.toContain("EAAB");
    expect(open(sealed).accessToken).toBe("EAAB-live-token-1234");
    expect(sealAdAccountSecret(sealed)).toBe(sealed);
  });

  it("a legacy plain-text row still opens unchanged", () => {
    expect(open("EAAB-legacy-plain").accessToken).toBe("EAAB-legacy-plain");
    expect(open("EAAB-legacy-plain", null).appSecret).toBeNull();
  });

  it("upsertFounderAdAccount stores envelopes and returns usable secrets", async () => {
    const self = { getFounderAdAccount: async () => undefined };
    const row = await growthConfigRepo.upsertFounderAdAccount.call(self as never, {
      platform: "meta",
      adAccountId: "act_1",
      accessToken: "EAAB-new-token-9876",
      appSecret: "app-secret-5555",
      isActive: true,
    } as never);
    expect(inserted).toHaveLength(1);
    expect(isAnyEncryptedEnvelope(inserted[0].accessToken)).toBe(true);
    expect(isAnyEncryptedEnvelope(inserted[0].appSecret)).toBe(true);
    expect(JSON.stringify(inserted[0])).not.toMatch(/EAAB-new-token|app-secret-5555/);
    expect(row.accessToken).toBe("EAAB-new-token-9876");
    expect(row.appSecret).toBe("app-secret-5555");
  });

  it("the update path seals too", async () => {
    const self = { getFounderAdAccount: async () => ({ id: 1 }) };
    await growthConfigRepo.upsertFounderAdAccount.call(self as never, {
      platform: "meta",
      adAccountId: "act_1",
      accessToken: "EAAB-rotated-4321",
      appSecret: null,
      isActive: true,
    } as never);
    expect(updated).toHaveLength(1);
    expect(isAnyEncryptedEnvelope(updated[0].accessToken)).toBe(true);
    expect(updated[0].appSecret).toBeNull();
  });

  it("a save that omits appSecret leaves the stored one alone (the form never sends it)", async () => {
    const self = { getFounderAdAccount: async () => ({ id: 1 }) };
    await growthConfigRepo.upsertFounderAdAccount.call(self as never, {
      platform: "meta",
      adAccountId: "act_1",
      accessToken: "EAAB-rotated-4321",
      isActive: true,
    } as never);
    expect(updated).toHaveLength(1);
    expect("appSecret" in updated[0]).toBe(false);
  });

  it("masking never shows more than the last four characters", () => {
    expect(maskAdAccountSecret("app-secret-5555")).toBe("••••••••5555");
    expect(maskAdAccountSecret(null)).toBeNull();
  });
});

function serverFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "node_modules") continue;
      serverFiles(p, out);
    } else if (/\.ts$/.test(name) && !/\.test\.ts$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

const SOURCES = serverFiles(resolve(ROOT, "server")).map((p) => ({
  file: relative(ROOT, p),
  src: stripComments(readFileSync(p, "utf8")),
}));

describe("DEFECT-0054 population — every read and write of the two tables", () => {
  it("every full-row read of founder_ad_accounts opens its secrets", () => {
    const readers = SOURCES.filter((s) => /\.select\(\s*\)\s*\.from\(\s*founderAdAccounts\s*\)/.test(s.src));
    // Vacuity: the repo, the performance ingest job, Meta and TikTok.
    expect(readers.map((r) => r.file).sort()).toEqual(
      expect.arrayContaining([
        "server/integrations/metaAdsVideo.ts",
        "server/integrations/tiktokAds.ts",
        "server/jobs/cmoPerformanceIngest.ts",
        "server/storage/growthConfigRepo.ts",
      ]),
    );
    const unopened = readers.filter((r) => !/openFounderAdAccount\(/.test(r.src)).map((r) => r.file);
    expect(unopened).toEqual([]);
  });

  it("founder_ad_accounts is written only by the repo, and the repo seals", () => {
    const writers = SOURCES.filter((s) => /\.(insert|update)\(\s*founderAdAccounts\s*\)/.test(s.src)).map((s) => s.file);
    expect(writers).toEqual(["server/storage/growthConfigRepo.ts"]);
    const repo = SOURCES.find((s) => s.file === "server/storage/growthConfigRepo.ts")!.src;
    expect(repo).toMatch(/accessToken:\s*sealAdAccountSecret\(/);
    expect(repo).toMatch(/appSecret:\s*sealAdAccountSecret\(/);
  });

  it("every ad-account response omits both secrets and serves only a masked last-4", () => {
    // Was: "masks both secrets" under their own keys. The row keys are now
    // projected out (omitSecretColumns, the secret-column registry), so the
    // response guard has nothing to remove; the masked values ride under
    // their own *Masked keys.
    const admin = SOURCES.find((s) => s.file === "server/routes-admin.ts")!.src;
    const responses = [...admin.matchAll(/res\.json\(\{[^;]*\baccount\b[^;]*;/g)].map((m) => m[0]);
    expect(responses.length).toBeGreaterThanOrEqual(2);
    for (const s of responses) {
      expect(s).toMatch(/\.\.\.omitSecretColumns\(\s*founderAdAccounts\s*,\s*account\s*\)/);
      expect(s).not.toMatch(/\.\.\.account\b/);
      expect(s).not.toMatch(/\b(accessToken|appSecret):/);
      expect(s).toMatch(/accessTokenMasked:\s*maskAdAccountSecret\(/);
      expect(s).toMatch(/appSecretMasked:\s*maskAdAccountSecret\(/);
    }
  });

  it("no writer puts a non-null api_key into system_api_keys", () => {
    const offenders: string[] = [];
    let writes = 0;
    for (const s of SOURCES) {
      for (const m of s.src.matchAll(/\.(insert|update)\(\s*systemApiKeys\s*\)([\s\S]*?)(?:\.where\(|\.returning\(|;)/g)) {
        writes++;
        const body = m[2];
        // Any apiKey property other than an explicit null is a plain-text write.
        const apiKeyProps = [...body.matchAll(/\bapiKey\b\s*(:\s*([^,}\n]+))?/g)];
        for (const p of apiKeyProps) {
          if (!p[1] || p[2].trim() !== "null") offenders.push(`${s.file}: ${p[0].trim()}`);
        }
      }
    }
    expect(writes).toBeGreaterThanOrEqual(3);
    expect(offenders).toEqual([]);
  });
});
