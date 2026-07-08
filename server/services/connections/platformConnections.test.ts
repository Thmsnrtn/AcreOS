/**
 * Tests for Platform Connections (native connect-an-account infra).
 *
 * Coverage:
 *  - catalog integrity: unique keys/env vars, every field named sanely,
 *    OAuth providers declare the flow
 *  - vault: set encrypts secrets (never stores plaintext), fingerprints as
 *    …last4, revokes the prior active row; plain fields stay greppable;
 *    unknown provider/field refused
 *  - resolution: DB beats env; env fallback when no row; fail-soft to env on
 *    db errors; cache busts on writes
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../founderAuditService", () => ({
  founderAudit: { log: vi.fn(async () => undefined) },
}));

// Reversible stand-in for AES-GCM so tests can assert "not plaintext at rest".
vi.mock("../fieldEncryption", () => ({
  encrypt: (v: string) => `enc:v1:${Buffer.from(v, "utf8").toString("base64")}`,
  decrypt: (v: string) => Buffer.from(v.replace(/^enc:v1:/, ""), "base64").toString("utf8"),
}));

interface Row {
  id: number;
  provider: string;
  field: string;
  secretEncrypted: Buffer | null;
  valuePlain: string | null;
  fingerprint: string | null;
  revokedAt: Date | null;
}
const ROWS: Row[] = [];
let nextId = 1;
let dbThrows = false;

function activeRow(provider: string, field: string): Row | undefined {
  return ROWS.find((r) => r.provider === provider && r.field === field && r.revokedAt === null);
}

vi.mock("../../db", () => {
  function makeTx() {
    return {
      update: (_t: unknown) => ({
        set: (patch: any) => ({
          where: (_w: any) => {
            // The service's only update is revoke-active; emulate via the
            // captured provider/field of the LAST set call — instead track
            // through pendingRevoke below.
            for (const r of ROWS) {
              if (pendingRevoke && r.provider === pendingRevoke.provider && r.field === pendingRevoke.field && r.revokedAt === null) {
                r.revokedAt = patch.revokedAt ?? new Date();
              }
              if (pendingRevoke?.field === "*" && r.provider === pendingRevoke.provider && r.revokedAt === null) {
                r.revokedAt = patch.revokedAt ?? new Date();
              }
            }
            return Object.assign(Promise.resolve(), {
              returning: () => Promise.resolve(ROWS.filter((r) => r.revokedAt !== null).map((r) => ({ id: r.id }))),
            });
          },
        }),
      }),
      insert: (_t: unknown) => ({
        values: (v: any) => {
          ROWS.push({
            id: nextId++,
            provider: v.provider,
            field: v.field,
            secretEncrypted: v.secretEncrypted ?? null,
            valuePlain: v.valuePlain ?? null,
            fingerprint: v.fingerprint ?? null,
            revokedAt: null,
          });
          return Promise.resolve();
        },
      }),
    };
  }
  const db = {
    transaction: async (fn: any) => fn(makeTx()),
    update: (t: unknown) => makeTx().update(t),
    insert: (t: unknown) => makeTx().insert(t),
    select: (_p?: unknown) => ({
      from: (_t: unknown) => ({
        where: (w: any) => {
          if (dbThrows) throw new Error("db down");
          const target = (w as any)?.__target as { provider: string; field: string } | undefined;
          const row = target ? activeRow(target.provider, target.field) : undefined;
          const result = Promise.resolve(row ? [row] : []);
          return Object.assign(result, { limit: () => result });
        },
      }),
    }),
  };
  return { db };
});

// Route drizzle's and/eq/isNull through a probe so the select mock can see
// which (provider, field) is being queried.
let pendingRevoke: { provider: string; field: string } | null = null;
vi.mock("drizzle-orm", async () => {
  const actual = await vi.importActual<typeof import("drizzle-orm")>("drizzle-orm");
  return {
    ...actual,
    eq: (_c: any, v: any) => ({ __eq: v }),
    isNull: () => ({ __isNull: true }),
    and: (...parts: any[]) => {
      const vals = parts.filter((p) => p && "__eq" in p).map((p) => p.__eq);
      const target = vals.length >= 2 ? { provider: vals[0], field: vals[1] } : vals.length === 1 ? { provider: vals[0], field: "*" } : undefined;
      if (target) pendingRevoke = target as { provider: string; field: string };
      return { __target: target };
    },
  };
});

import {
  CONNECTION_PROVIDERS,
  setConnectionField,
  disconnectProvider,
  resolveConnection,
  bustResolveCache,
} from "./platformConnections";

beforeEach(() => {
  ROWS.length = 0;
  nextId = 1;
  dbThrows = false;
  pendingRevoke = null;
  bustResolveCache();
  delete process.env.GITHUB_TOKEN;
  delete process.env.GITHUB_REPOSITORY;
  vi.clearAllMocks();
});

describe("catalog integrity", () => {
  it("provider keys and env vars are unique", () => {
    const keys = CONNECTION_PROVIDERS.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
    const envs = CONNECTION_PROVIDERS.flatMap((p) => p.fields.map((f) => f.envVar));
    expect(new Set(envs).size).toBe(envs.length);
  });

  it("every provider says what it powers, in a full sentence", () => {
    for (const p of CONNECTION_PROVIDERS) {
      expect(p.powers.length, `${p.key}.powers`).toBeGreaterThan(20);
      expect(p.fields.length, `${p.key}.fields`).toBeGreaterThan(0);
    }
  });

  it("ad providers are prewired as OAuth", () => {
    expect(CONNECTION_PROVIDERS.find((p) => p.key === "meta_ads")?.oauth?.kind).toBe("oauth2");
    expect(CONNECTION_PROVIDERS.find((p) => p.key === "google_ads")?.oauth?.kind).toBe("oauth2");
  });
});

describe("vault", () => {
  it("secret fields are stored encrypted with a …last4 fingerprint — never plaintext", async () => {
    const { fingerprint } = await setConnectionField("github", "token", "ghp_supersecret1234", "tom");
    expect(fingerprint).toBe("…1234");
    const row = ROWS[0];
    expect(row.valuePlain).toBeNull();
    const stored = row.secretEncrypted!.toString("utf8");
    expect(stored).not.toContain("ghp_supersecret1234");
    expect(stored.startsWith("enc:v1:")).toBe(true);
  });

  it("plain fields stay greppable (no ciphertext, no fingerprint)", async () => {
    await setConnectionField("github", "repository", "tom/acreos", "tom");
    const row = ROWS[0];
    expect(row.valuePlain).toBe("tom/acreos");
    expect(row.secretEncrypted).toBeNull();
    expect(row.fingerprint).toBeNull();
  });

  it("setting again revokes the prior active row (one active per field)", async () => {
    await setConnectionField("github", "token", "ghp_first0000", "tom");
    await setConnectionField("github", "token", "ghp_second999", "tom");
    const active = ROWS.filter((r) => r.revokedAt === null);
    expect(active).toHaveLength(1);
    expect(active[0].fingerprint).toBe("…d999");
  });

  it("refuses unknown providers and fields", async () => {
    await expect(setConnectionField("nope", "token", "x", "tom")).rejects.toThrow(/unknown provider/);
    await expect(setConnectionField("github", "nope", "x", "tom")).rejects.toThrow(/unknown field/);
  });

  it("disconnect revokes every active field for the provider", async () => {
    await setConnectionField("github", "token", "ghp_first0000", "tom");
    await setConnectionField("github", "repository", "tom/acreos", "tom");
    await disconnectProvider("github", "tom");
    expect(ROWS.every((r) => r.revokedAt !== null)).toBe(true);
  });
});

describe("resolution", () => {
  it("a DB value beats the env var", async () => {
    process.env.GITHUB_TOKEN = "env-token";
    await setConnectionField("github", "token", "ghp_dbtoken9999", "tom");
    const r = await resolveConnection("github", "token");
    expect(r.source).toBe("db");
    expect(r.value).toBe("ghp_dbtoken9999");
  });

  it("falls back to env when no row exists", async () => {
    process.env.GITHUB_TOKEN = "env-token";
    const r = await resolveConnection("github", "token");
    expect(r.source).toBe("env");
    expect(r.value).toBe("env-token");
  });

  it("reports missing when neither exists", async () => {
    const r = await resolveConnection("github", "token");
    expect(r.source).toBe("missing");
    expect(r.value).toBeNull();
  });

  it("FAIL-SOFT: a db error degrades to env, never throws", async () => {
    process.env.GITHUB_TOKEN = "env-token";
    dbThrows = true;
    const r = await resolveConnection("github", "token");
    expect(r.source).toBe("env");
    expect(r.value).toBe("env-token");
  });

  it("writes bust the cache so a new value is live immediately", async () => {
    process.env.GITHUB_TOKEN = "env-token";
    expect((await resolveConnection("github", "token")).source).toBe("env");
    await setConnectionField("github", "token", "ghp_fresh5678", "tom");
    expect((await resolveConnection("github", "token")).value).toBe("ghp_fresh5678");
  });
});
