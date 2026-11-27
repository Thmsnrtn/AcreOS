/**
 * P12-1b reader-switch parity: the service-level readers that used to
 * resolve through founderSettings now resolve through settings.ts's
 * string adapter (getStringSetting / getNumberSetting), and the adapter
 * preserves every caller's observable behaviour:
 *
 *   founderSettings.getSetting(key)        → string | null
 *   settings.getStringSetting(key)         → string | null  (same strings)
 *   founderSettings.getNumberSetting(k, f) → number
 *   settings.getNumberSetting(k, f)        → number         (same numbers)
 *
 * Cases, in the settingsKnobParity style:
 *   KNOBS keys — (a) default (seeded registry row, no founder row, no
 *   env), (b) env (env-fallback keys only), (c) DB-set on both sides.
 *   Non-KNOBS keys — founderSettings had no default for these (no row →
 *   null → the caller's own default path). Parity therefore means: the
 *   adapter's value, run through the caller's exact consumption
 *   (JSON.parse / numeric fallback), equals the caller's old effective
 *   default when unset, and the founder-set value when set.
 *   Dynamic family — `ai.budget.${category}_share_pct`, seeded in
 *   P12-1b from DEFAULT_SHARES: unset → the share default; DB-set → set
 *   value.
 *
 * The DB is the same in-memory fake as settingsKnobParity.test.ts.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const H = vi.hoisted(() => ({
  platform: [] as any[],
  founder: [] as any[],
  sink: [] as any[],
}));

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../server/db", () => {
  const rowsFor = (table: any): any[] => {
    const name = table?.[Symbol.for("drizzle:Name")] ?? "";
    if (name === "platform_settings") return H.platform;
    if (name === "founder_settings") return H.founder;
    return H.sink;
  };
  const selectChain = (getRows: () => any[]): any => {
    const c: any = {
      from: (table: any) => selectChain(() => rowsFor(table)),
      where: () => c,
      limit: () => c,
      then: (res: any, rej: any) =>
        Promise.resolve()
          .then(() => getRows())
          .then(res, rej),
    };
    return c;
  };
  return {
    db: {
      select: () => selectChain(() => []),
      insert: (table: any) => ({
        values: (v: any) => {
          const doInsert = () => {
            const rows = rowsFor(table);
            const idx = rows.findIndex((r) => r.key !== undefined && r.key === v.key);
            if (idx >= 0) rows[idx] = { ...rows[idx], ...v };
            else rows.push({ id: rows.length + 1, ...v });
            return [rows[idx >= 0 ? idx : rows.length - 1]];
          };
          const c: any = {
            onConflictDoUpdate: () => {
              doInsert();
              return Promise.resolve();
            },
            returning: () => Promise.resolve(doInsert()),
            then: (res: any, rej: any) =>
              Promise.resolve()
                .then(() => {
                  doInsert();
                })
                .then(res, rej),
          };
          return c;
        },
      }),
      update: (table: any) => ({
        set: (v: any) => ({
          where: () => ({
            returning: () => {
              const rows = rowsFor(table);
              for (const r of rows) Object.assign(r, v);
              return Promise.resolve(rows);
            },
          }),
        }),
      }),
    },
  };
});

import {
  getSetting as founderGetSetting,
  getNumberSetting as founderGetNumberSetting,
  clearSettingsCache,
} from "../../server/services/founderSettings";
import {
  getStringSetting,
  getNumberSetting,
  seedSetting,
  _resetSettingsCache,
} from "../../server/services/settings";
import { SETTINGS_CATALOG } from "../../server/services/settingsSeeder";
import { DEFAULT_SHARES } from "../../server/services/intelligence/budget";
import { DEFAULT_ALLOCATION_POLICY } from "@shared/billing/allocation-policy";

async function seed(key: string) {
  const entry = SETTINGS_CATALOG.find((e) => e.key === key);
  expect(entry, `${key} is not in SETTINGS_CATALOG`).toBeTruthy();
  await seedSetting(entry!);
  _resetSettingsCache();
  clearSettingsCache();
}

function setPlatformValue(key: string, value: unknown) {
  const row = H.platform.find((r) => r.key === key);
  expect(row, `seeded registry row missing for ${key}`).toBeTruthy();
  row.value = value;
  row.lastChangedBy = "founder-test";
  _resetSettingsCache();
  clearSettingsCache();
}

describe("P12-1b string adapter parity (KNOBS keys)", () => {
  beforeEach(() => {
    H.platform.length = 0;
    H.founder.length = 0;
    H.sink.length = 0;
    _resetSettingsCache();
    clearSettingsCache();
    delete process.env.FINANCIAL_HARD_CAP_CENTS;
  });

  afterEach(() => {
    delete process.env.FINANCIAL_HARD_CAP_CENTS;
  });

  it("number knob: default, env, and DB-set agree with founderSettings", async () => {
    const key = "FINANCIAL_HARD_CAP_CENTS";
    await seed(key);

    // (a) default
    expect(await getStringSetting(key)).toBe(await founderGetSetting(key));
    expect(await getStringSetting(key)).toBe("2500000");
    expect(await getNumberSetting(key, 1)).toBe(await founderGetNumberSetting(key, 1));

    // (b) env set — untouched seed row must not shadow it on either side
    process.env.FINANCIAL_HARD_CAP_CENTS = "4200000";
    _resetSettingsCache();
    clearSettingsCache();
    expect(await getStringSetting(key)).toBe("4200000");
    expect(await getStringSetting(key)).toBe(await founderGetSetting(key));
    delete process.env.FINANCIAL_HARD_CAP_CENTS;

    // (c) DB-set on both sides
    setPlatformValue(key, 3300000);
    H.founder.push({ key, value: "3300000", valueType: "number" });
    clearSettingsCache();
    expect(await getStringSetting(key)).toBe(await founderGetSetting(key));
    expect(await getNumberSetting(key, 1)).toBe(3300000);
  });

  it("boolean knob: 'true'/'false' strings survive the typed registry", async () => {
    const key = "atlas.kill_switch";
    await seed(key);
    expect(await getStringSetting(key)).toBe("false");
    expect(await getStringSetting(key)).toBe(await founderGetSetting(key));
    setPlatformValue(key, true);
    H.founder.push({ key, value: "true", valueType: "boolean" });
    clearSettingsCache();
    expect(await getStringSetting(key)).toBe("true");
    expect(await getStringSetting(key)).toBe(await founderGetSetting(key));
  });

  it("archival.enabled: the literal 'true' comparison in archival.ts holds", async () => {
    const key = "archival.enabled";
    await seed(key);
    expect(await getStringSetting(key)).toBe("false");
    setPlatformValue(key, true);
    expect(await getStringSetting(key)).toBe("true");
  });

  it("archival.horizon_days: number parity at the seeded default", async () => {
    const key = "archival.horizon_days";
    await seed(key);
    expect(await getNumberSetting(key, 90)).toBe(await founderGetNumberSetting(key, 90));
    expect(await getNumberSetting(key, 90)).toBe(90);
  });

  it("absent key: adapter returns null / the caller's fallback, like founderSettings", async () => {
    expect(await getStringSetting("never.seeded.key")).toBeNull();
    expect(await getNumberSetting("never.seeded.key", 7)).toBe(7);
  });
});

describe("P12-1b non-KNOBS keys (founder null → caller default, now seeded)", () => {
  beforeEach(() => {
    H.platform.length = 0;
    H.founder.length = 0;
    H.sink.length = 0;
    _resetSettingsCache();
    clearSettingsCache();
  });

  it("allocation.policy: object default JSON-round-trips to DEFAULT_ALLOCATION_POLICY", async () => {
    await seed("allocation.policy");
    const raw = await getStringSetting("allocation.policy");
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!)).toEqual(DEFAULT_ALLOCATION_POLICY);
    // A founder-set policy round-trips too.
    const custom = { ...DEFAULT_ALLOCATION_POLICY, opex_available: 0.5, tax_reserve: 0.3 };
    setPlatformValue("allocation.policy", custom);
    expect(JSON.parse((await getStringSetting("allocation.policy"))!)).toEqual(custom);
  });

  it("mail.providers.enabled: default is the caller's old DEFAULT_ENABLED ([\"lob\"])", async () => {
    await seed("mail.providers.enabled");
    expect(JSON.parse((await getStringSetting("mail.providers.enabled"))!)).toEqual(["lob"]);
  });

  it("comms.providers.enabled: seeded in P12-1b with the old effective default ([\"twilio\"])", async () => {
    await seed("comms.providers.enabled");
    expect(JSON.parse((await getStringSetting("comms.providers.enabled"))!)).toEqual(["twilio"]);
  });

  it("comms.pool.auto_release_days: seeded default equals the old caller fallback (60)", async () => {
    await seed("comms.pool.auto_release_days");
    expect(await getNumberSetting("comms.pool.auto_release_days", 60)).toBe(60);
    setPlatformValue("comms.pool.auto_release_days", 14);
    expect(await getNumberSetting("comms.pool.auto_release_days", 60)).toBe(14);
  });
});

describe("P12-1b dynamic family ai.budget.${category}_share_pct (seeded, switched)", () => {
  beforeEach(() => {
    H.platform.length = 0;
    H.founder.length = 0;
    H.sink.length = 0;
    _resetSettingsCache();
    clearSettingsCache();
  });

  it("every BudgetCategory share is in the catalog with its DEFAULT_SHARES default", () => {
    for (const [category, share] of Object.entries(DEFAULT_SHARES)) {
      const entry = SETTINGS_CATALOG.find((e) => e.key === `ai.budget.${category}_share_pct`);
      expect(entry, `ai.budget.${category}_share_pct not seeded`).toBeTruthy();
      expect(entry!.defaultValue).toBe(share);
    }
  });

  it("unset share resolves to DEFAULT_SHARES; DB-set share wins", async () => {
    const key = "ai.budget.executor_share_pct";
    await seed(key);
    expect(await getNumberSetting(key, DEFAULT_SHARES.executor)).toBe(DEFAULT_SHARES.executor);
    setPlatformValue(key, 45);
    expect(await getNumberSetting(key, DEFAULT_SHARES.executor)).toBe(45);
  });
});
