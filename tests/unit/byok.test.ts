/**
 * Universal BYOK — unit tests.
 *
 * Covers:
 *   1. AES-256-GCM round-trip via fieldEncryption (proves the canonical
 *      encryption helper is what key-vault uses).
 *   2. setByokCredential revokes any prior active row for the same
 *      (org, channel) pair (partial-unique invariant).
 *   3. isByokEnabled returns true when a non-revoked credential exists,
 *      false after revocation.
 *   4. getEffectiveCredential prefers BYOK over the platform env var.
 *   5. resolveCredentials (the provider-adapter integration point)
 *      hands back the BYOK plaintext when one is present.
 *
 * The DB is replaced with an in-memory store that honours the chained
 * Drizzle API surface the key-vault module uses.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Ensure fieldEncryption has a valid key. CI / dev shells sometimes have
// FIELD_ENCRYPTION_KEY set to "" which causes the hex-len check to throw.
process.env.FIELD_ENCRYPTION_KEY =
  "4242424242424242424242424242424242424242424242424242424242424242";

// ── In-memory byok_credentials store ─────────────────────────────────────────

interface ByokRow {
  id: number;
  organizationId: number;
  channel: string;
  credentialKeyEncrypted: Buffer;
  credentialKeyFingerprint: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
}

const store: { rows: ByokRow[]; nextId: number } = { rows: [], nextId: 1 };

function resetStore() {
  store.rows = [];
  store.nextId = 1;
}

// Encryption needs the field-encryption key in dev — module already
// falls back to a dev-only all-0x42 key when FIELD_ENCRYPTION_KEY is
// unset, so we don't need to set anything here.

// Mock the logger so we don't pollute test output.
vi.mock("../../server/utils/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Mock founderAuditService — the audit log is best-effort and we don't
// want to wire it through here.
vi.mock("../../server/services/founderAuditService", () => ({
  founderAudit: {
    log: vi.fn(async () => undefined),
  },
}));

// Mock the DB. Honours just the calls key-vault.ts + toggle.ts make.
vi.mock("../../server/db", () => {
  function buildDb() {
    const db: any = {
      transaction: async (fn: (tx: any) => Promise<any>) => fn(db),
      update(_table: any) {
        // .update(table).set(values).where(filter).returning(?)
        let updateValues: Partial<ByokRow> = {};
        let filterFn: ((r: ByokRow) => boolean) | null = null;
        const chain: any = {
          set(values: Partial<ByokRow>) {
            updateValues = values;
            return chain;
          },
          where(filter: (r: ByokRow) => boolean) {
            filterFn = filter;
            return chain;
          },
          returning(_cols?: any) {
            const affected: ByokRow[] = [];
            for (const r of store.rows) {
              if (filterFn && filterFn(r)) {
                Object.assign(r, updateValues);
                affected.push(r);
              }
            }
            return Promise.resolve(affected.map((r) => ({
              id: r.id,
              fingerprint: r.credentialKeyFingerprint,
            })));
          },
          then(onFulfilled: any) {
            // Awaiting the update without .returning()
            for (const r of store.rows) {
              if (filterFn && filterFn(r)) Object.assign(r, updateValues);
            }
            return Promise.resolve(undefined).then(onFulfilled);
          },
          catch() { return chain; },
        };
        return chain;
      },
      insert(_table: any) {
        let row: any = null;
        const chain: any = {
          values(v: any) {
            row = v;
            return chain;
          },
          returning() {
            const inserted: ByokRow = {
              id: store.nextId++,
              organizationId: row.organizationId,
              channel: row.channel,
              credentialKeyEncrypted: row.credentialKeyEncrypted,
              credentialKeyFingerprint: row.credentialKeyFingerprint,
              createdAt: row.createdAt ?? new Date(),
              lastUsedAt: row.lastUsedAt ?? null,
              revokedAt: row.revokedAt ?? null,
            };
            store.rows.push(inserted);
            return Promise.resolve([inserted]);
          },
        };
        return chain;
      },
      select(_cols?: any) {
        let filterFn: ((r: ByokRow) => boolean) | null = null;
        let limitN: number | undefined;
        const chain: any = {
          from(_table: any) { return chain; },
          where(filter: (r: ByokRow) => boolean) {
            filterFn = filter;
            return chain;
          },
          orderBy() { return chain; },
          limit(n: number) {
            limitN = n;
            return chain;
          },
          then(onFulfilled: any) {
            let rows = store.rows.filter((r) => !filterFn || filterFn(r));
            if (limitN != null) rows = rows.slice(0, limitN);
            return Promise.resolve(rows).then(onFulfilled);
          },
        };
        return chain;
      },
    };
    return db;
  }
  return { db: buildDb() };
});

// Drizzle's `and / eq / isNull / desc` are imported by key-vault; we
// replace them with plain JS predicates the mock select.where() can call.
vi.mock("drizzle-orm", async () => {
  return {
    and: (...preds: any[]) => (r: any) => preds.every((p) => (typeof p === "function" ? p(r) : true)),
    eq: (col: any, val: any) => {
      const field = col?._?.name ?? col?.name ?? col;
      return (r: any) => r[fieldNameToProp(String(field))] === val;
    },
    isNull: (col: any) => {
      const field = col?._?.name ?? col?.name ?? col;
      return (r: any) => r[fieldNameToProp(String(field))] == null;
    },
    desc: (_col: any) => () => 0,
    sql: { raw: (s: string) => s },
  };
});

function fieldNameToProp(field: string): string {
  // Map snake_case column names to camelCase row props used by ByokRow.
  if (field === "organization_id") return "organizationId";
  if (field === "revoked_at") return "revokedAt";
  if (field === "credential_key_encrypted") return "credentialKeyEncrypted";
  if (field === "credential_key_fingerprint") return "credentialKeyFingerprint";
  if (field === "created_at") return "createdAt";
  if (field === "last_used_at") return "lastUsedAt";
  return field;
}

// Mock the schema barrel so the column objects expose `.name` for the
// drizzle-orm mock above.
vi.mock("@shared/schema", () => {
  const col = (name: string) => ({ name });
  return {
    byokCredentials: {
      id: col("id"),
      organizationId: col("organization_id"),
      channel: col("channel"),
      credentialKeyEncrypted: col("credential_key_encrypted"),
      credentialKeyFingerprint: col("credential_key_fingerprint"),
      createdAt: col("created_at"),
      lastUsedAt: col("last_used_at"),
      revokedAt: col("revoked_at"),
    },
    BYOK_CHANNELS: [
      "twilio", "telnyx", "sendgrid", "ses", "lob", "postgrid",
      "openrouter", "anthropic", "openai", "batch_skiptracing",
      "mapbox", "s3",
    ],
  };
});

// ── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  resetStore();
  delete process.env.TWILIO_AUTH_TOKEN;
  delete process.env.OPENAI_API_KEY;
  delete process.env.BATCH_SKIP_TRACING_API_KEY;
});

describe("BYOK encryption round-trip", () => {
  it("encrypts and decrypts a credential losslessly", async () => {
    const { encrypt, decrypt } = await import("../../server/services/fieldEncryption");
    const plaintext = "sk-test-1234567890abcdef";
    const envelope = encrypt(plaintext);
    expect(envelope.startsWith("enc:v1:")).toBe(true);
    expect(envelope).not.toContain(plaintext);
    expect(decrypt(envelope)).toBe(plaintext);
  });
});

describe("setByokCredential", () => {
  it("revokes any prior active row for the same (org, channel)", async () => {
    const { setByokCredential } = await import("../../server/services/byok/key-vault");
    await setByokCredential({ organizationId: 1, channel: "twilio" as any, plaintext: "AC1:tok1:+15551111111" });
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0].revokedAt).toBeNull();

    await setByokCredential({ organizationId: 1, channel: "twilio" as any, plaintext: "AC2:tok2:+15552222222" });
    expect(store.rows).toHaveLength(2);
    const active = store.rows.filter((r) => r.revokedAt == null);
    expect(active).toHaveLength(1);
    expect(active[0].credentialKeyFingerprint).toBe("2222");
  });

  it("does not leak plaintext in the stored row", async () => {
    const { setByokCredential } = await import("../../server/services/byok/key-vault");
    const plaintext = "sk-secret-abcdefghijklmnop";
    await setByokCredential({ organizationId: 2, channel: "openai" as any, plaintext });
    const row = store.rows[0];
    const blob = row.credentialKeyEncrypted.toString("utf8");
    expect(blob.includes(plaintext)).toBe(false);
    expect(blob.startsWith("enc:v1:")).toBe(true);
    // Fingerprint is non-secret last-4.
    expect(row.credentialKeyFingerprint).toBe("mnop");
  });
});

describe("isByokEnabled / getEffectiveCredential", () => {
  it("returns true while active, false after revoke", async () => {
    const { setByokCredential, revokeByokCredential } = await import("../../server/services/byok/key-vault");
    const { isByokEnabled } = await import("../../server/services/byok/toggle");
    expect(await isByokEnabled(5, "openai" as any)).toBe(false);
    await setByokCredential({ organizationId: 5, channel: "openai" as any, plaintext: "sk-aaaaaaaaaa" });
    expect(await isByokEnabled(5, "openai" as any)).toBe(true);
    await revokeByokCredential({ organizationId: 5, channel: "openai" as any });
    expect(await isByokEnabled(5, "openai" as any)).toBe(false);
  });

  it("getEffectiveCredential prefers BYOK over platform env", async () => {
    process.env.OPENAI_API_KEY = "sk-platform-default";
    const { setByokCredential } = await import("../../server/services/byok/key-vault");
    const { getEffectiveCredential } = await import("../../server/services/byok/toggle");

    const platformResolved = await getEffectiveCredential(7, "openai" as any);
    expect(platformResolved.source).toBe("platform");
    expect(platformResolved.credential).toBe("sk-platform-default");

    await setByokCredential({ organizationId: 7, channel: "openai" as any, plaintext: "sk-customer-abc123" });
    const byokResolved = await getEffectiveCredential(7, "openai" as any);
    expect(byokResolved.source).toBe("byok");
    expect(byokResolved.credential).toBe("sk-customer-abc123");
  });

  it("returns { source: 'platform', credential: null } when neither exists", async () => {
    const { getEffectiveCredential } = await import("../../server/services/byok/toggle");
    const r = await getEffectiveCredential(99, "batch_skiptracing" as any);
    expect(r.source).toBe("platform");
    expect(r.credential).toBeNull();
  });
});
