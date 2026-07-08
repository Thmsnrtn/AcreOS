/**
 * Tests for Data-API key hardening (roadmap W1.6).
 *
 * Coverage:
 *  - generateApiKey: CSPRNG-length keys, unique across calls, hash+last4 shape
 *  - verifyApiKey: hash-at-rest match; unknown key refused; legacy plaintext
 *    row verifies once and UPGRADES in place (hash written, plaintext nulled);
 *    db error → refuse, never throw
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

interface KeyRow {
  id: number;
  provider: string;
  apiKey: string | null;
  keyHash: string | null;
  keyLast4: string | null;
  isActive: boolean;
}
let ROWS: KeyRow[] = [];
let dbThrows = false;
const UPDATES: Array<{ id: number; patch: any }> = [];

// The service queries with and(eq(col, value), eq(isActive, true)) — probe
// the eq values so the mock can match hash-lookups vs plaintext-lookups.
vi.mock("drizzle-orm", async () => {
  const actual = await vi.importActual<typeof import("drizzle-orm")>("drizzle-orm");
  return {
    ...actual,
    eq: (_c: any, v: any) => ({ __eq: v }),
    and: (...parts: any[]) => ({ __vals: parts.map((p) => p?.__eq) }),
  };
});

vi.mock("../db", () => ({
  db: {
    select: (_p?: unknown) => ({
      from: (_t: unknown) => ({
        where: (w: any) => {
          if (dbThrows) throw new Error("db down");
          const [needle] = (w?.__vals ?? []) as [string | undefined];
          const row = ROWS.find(
            (r) => r.isActive && (r.keyHash === needle || r.apiKey === needle),
          );
          const p = Promise.resolve(row ? [{ id: row.id, provider: row.provider }] : []);
          return Object.assign(p, { limit: () => p });
        },
      }),
    }),
    update: (_t: unknown) => ({
      set: (patch: any) => ({
        where: (w: any) => {
          const id = (w as any)?.__eq;
          UPDATES.push({ id, patch });
          const row = ROWS.find((r) => r.id === id);
          if (row) {
            row.keyHash = patch.keyHash ?? row.keyHash;
            row.keyLast4 = patch.keyLast4 ?? row.keyLast4;
            if ("apiKey" in patch) row.apiKey = patch.apiKey;
          }
          return Promise.resolve();
        },
      }),
    }),
  },
}));

import { generateApiKey, hashApiKey, verifyApiKey } from "./dataApiKeys";

beforeEach(() => {
  ROWS = [];
  dbThrows = false;
  UPDATES.length = 0;
  vi.clearAllMocks();
});

describe("generateApiKey", () => {
  it("mints high-entropy, unique, prefixed keys with matching hash + last4", () => {
    const a = generateApiKey();
    const b = generateApiKey();
    expect(a.plaintext.startsWith("ak_")).toBe(true);
    expect(a.plaintext.length).toBeGreaterThanOrEqual(40); // 32 random bytes base64url + prefix
    expect(a.plaintext).not.toBe(b.plaintext);
    expect(a.hash).toBe(hashApiKey(a.plaintext));
    expect(a.last4).toBe(a.plaintext.slice(-4));
  });
});

describe("verifyApiKey", () => {
  it("matches a hash-at-rest key", async () => {
    const k = generateApiKey();
    ROWS = [{ id: 1, provider: "partner_x", apiKey: null, keyHash: k.hash, keyLast4: k.last4, isActive: true }];
    expect(await verifyApiKey(k.plaintext)).toEqual({ id: 1, provider: "partner_x" });
  });

  it("refuses an unknown key and trivially short input", async () => {
    ROWS = [{ id: 1, provider: "p", apiKey: null, keyHash: hashApiKey("ak_real"), keyLast4: "real", isActive: true }];
    expect(await verifyApiKey("ak_wrong_key_entirely")).toBeNull();
    expect(await verifyApiKey("")).toBeNull();
    expect(await verifyApiKey("short")).toBeNull();
  });

  it("verifies a LEGACY plaintext row once and upgrades it in place", async () => {
    ROWS = [{ id: 7, provider: "legacy_partner", apiKey: "ak_legacyplaintext1234", keyHash: null, keyLast4: null, isActive: true }];
    const r = await verifyApiKey("ak_legacyplaintext1234");
    expect(r).toEqual({ id: 7, provider: "legacy_partner" });
    // Upgraded: hash written, plaintext nulled.
    expect(UPDATES).toHaveLength(1);
    expect(ROWS[0].keyHash).toBe(hashApiKey("ak_legacyplaintext1234"));
    expect(ROWS[0].apiKey).toBeNull();
    expect(ROWS[0].keyLast4).toBe("1234");
    // Second auth now rides the hash path (no further updates).
    const r2 = await verifyApiKey("ak_legacyplaintext1234");
    expect(r2).toEqual({ id: 7, provider: "legacy_partner" });
    expect(UPDATES).toHaveLength(1);
  });

  it("refuses (never throws) when the db is unreadable", async () => {
    dbThrows = true;
    expect(await verifyApiKey("ak_whatever_key_this_is")).toBeNull();
  });
});
