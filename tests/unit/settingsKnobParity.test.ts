/**
 * P12-1a knob parity: the 10 KNOBS keys seeded into the settings registry
 * resolve to the same effective value through BOTH services.
 *
 *   founderSettings.getSetting(key)  → string | null (KNOBS contract)
 *   settings.getSetting(key, typedDefault) at global scope → typed value
 *
 * DOCUMENTED COERCION (the comparison rule for every case below):
 * founderSettings speaks strings end-to-end; the registry speaks typed
 * JSON. Parity means: for a number knob, Number(founderString) === the
 * registry's number; for a boolean knob, (founderString === "true") ===
 * the registry's boolean. No other comparison is claimed.
 *
 * Cases per key (per the P12-1a ruling):
 *   (a) neither DB nor env set — founder side: no founder_settings row,
 *       so its string default; registry side: the seeded global row
 *       (seedSetting run first, as at boot), so its typed default.
 *   (b) env set — ONLY for the 2 env-fallback keys
 *       (FINANCIAL_HARD_CAP_CENTS, FINANCIAL_APPROVAL_TTL_HOURS): the
 *       founder side has no DB row, so env wins over default; the
 *       registry side's global row is still the untouched seed
 *       (value === defaultValue, lastChangedBy null), which by the
 *       registry's opt-in env-fallback semantics does not shadow env —
 *       env wins over default on both sides.
 *   (c) DB row set on both sides — the registry row is overwritten with
 *       a founder-set value (lastChangedBy set, as setSetting writes);
 *       the founder row carries the same logical value as a string.
 *       Both sides return that value. (Env is unset in this case.)
 *
 * The DB is an in-memory fake keyed by table name; `where` clauses are
 * ignored because each case stages at most one row per table, for the
 * single key under test. Both services' 30s caches are cleared between
 * cases (cache behaviour itself is unchanged by P12-1a).
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

import { KNOBS, getSetting as founderGetSetting, clearSettingsCache } from "../../server/services/founderSettings";
import {
  getSetting as registryGetSetting,
  seedSetting,
  setSetting as registrySetSetting,
  SettingsValidationError,
  _resetSettingsCache,
} from "../../server/services/settings";
import { SETTINGS_CATALOG } from "../../server/services/settingsSeeder";

const P12_1A_KEYS = [
  "FINANCIAL_HARD_CAP_CENTS",
  "FINANCIAL_APPROVAL_TTL_HOURS",
  "AUTO_EXECUTE_THRESHOLD",
  "MAX_FINANCIAL_IMPACT_CENTS",
  "OUTREACH_STOPLOSS_MONTHLY_CENTS",
  "OUTCOME_GRADE_WINDOW_DAYS",
  "ACTION_PREVIEW_WINDOW_SECONDS",
  "atlas.kill_switch",
  "atlas.bridge_enabled",
  "ai.daily_budget_cents",
];

const ENV_KEYS = ["FINANCIAL_HARD_CAP_CENTS", "FINANCIAL_APPROVAL_TTL_HOURS"];
const ENV_VARS = [...ENV_KEYS];

function coerceCompare(founderRaw: string | null, registryVal: unknown, valueType: string) {
  expect(founderRaw, "founder side returned null for a KNOBS key").not.toBeNull();
  if (valueType === "number") {
    expect(Number(founderRaw)).toBe(registryVal);
  } else if (valueType === "boolean") {
    expect(founderRaw === "true").toBe(registryVal);
  } else {
    expect(founderRaw).toBe(registryVal);
  }
}

/** A value inside the knob's range, distinct from its default. */
function distinctValue(knob: (typeof KNOBS)[number], salt: number): number | boolean {
  if (knob.valueType === "boolean") return true; // both boolean knobs default "false"
  const max = knob.max ?? Number(knob.defaultValue) + 100;
  const candidate = max - salt;
  expect(candidate).not.toBe(Number(knob.defaultValue));
  if (knob.min != null) expect(candidate).toBeGreaterThanOrEqual(knob.min);
  return candidate;
}

describe("P12-1a catalog wiring", () => {
  it("the seeder catalog carries exactly the 10 keys, typed, with KNOBS ranges", () => {
    const entries = SETTINGS_CATALOG.filter((e) => P12_1A_KEYS.includes(e.key));
    expect(entries.map((e) => e.key).sort()).toEqual([...P12_1A_KEYS].sort());
    for (const entry of entries) {
      const knob = KNOBS.find((k) => k.key === entry.key)!;
      expect(knob, `${entry.key} is not a KNOBS key`).toBeTruthy();
      // Typed default equals the KNOBS string default under the coercion.
      if (knob.valueType === "number") expect(entry.defaultValue).toBe(Number(knob.defaultValue));
      else if (knob.valueType === "boolean") expect(entry.defaultValue).toBe(knob.defaultValue === "true");
      const range = entry.validRange as { type?: string; min?: number; max?: number };
      expect(range.type).toBe(knob.valueType);
      if (knob.min != null) expect(range.min).toBe(knob.min);
      if (knob.max != null) expect(range.max).toBe(knob.max);
      expect(entry.category).toBe(knob.category);
    }
  });

  it("only the 2 env-fallback KNOBS carry envFallback in the catalog", () => {
    for (const entry of SETTINGS_CATALOG.filter((e) => P12_1A_KEYS.includes(e.key))) {
      if (ENV_KEYS.includes(entry.key)) expect(entry.envFallback).toBe(entry.key);
      else expect(entry.envFallback).toBeUndefined();
    }
  });
});

describe("P12-1a knob parity (registry vs founderSettings)", () => {
  beforeEach(() => {
    H.platform.length = 0;
    H.founder.length = 0;
    H.sink.length = 0;
    _resetSettingsCache();
    clearSettingsCache();
    for (const v of ENV_VARS) delete process.env[v];
  });

  afterEach(() => {
    for (const v of ENV_VARS) delete process.env[v];
  });

  for (const key of P12_1A_KEYS) {
    it(`${key}: default, env (if any), and DB-set cases agree`, async () => {
      const knob = KNOBS.find((k) => k.key === key)!;
      const entry = SETTINGS_CATALOG.find((e) => e.key === key)!;

      // Boot state: the seeder materializes the registry row.
      await seedSetting(entry);
      _resetSettingsCache();
      clearSettingsCache();

      // (a) neither DB (founder side) nor env set → typed default parity.
      const founderDefault = await founderGetSetting(key);
      const registryDefault = await registryGetSetting(key, entry.defaultValue);
      coerceCompare(founderDefault, registryDefault, knob.valueType);
      expect(registryDefault).toBe(entry.defaultValue);

      // (b) env set — env-fallback keys only.
      if (ENV_KEYS.includes(key)) {
        const envVal = distinctValue(knob, 2);
        process.env[key] = String(envVal);
        _resetSettingsCache();
        clearSettingsCache();
        const founderEnv = await founderGetSetting(key);
        const registryEnv = await registryGetSetting(key, entry.defaultValue);
        coerceCompare(founderEnv, registryEnv, knob.valueType);
        expect(registryEnv).toBe(envVal);
        delete process.env[key];
      }

      // (c) DB row set on both sides with the same logical value.
      const dbVal = distinctValue(knob, 1);
      const platformRow = H.platform.find((r) => r.key === key);
      expect(platformRow, "seeded registry row missing").toBeTruthy();
      platformRow.value = dbVal;
      platformRow.lastChangedBy = "founder-test"; // as registry setSetting writes
      H.founder.push({ key, value: String(dbVal), valueType: knob.valueType });
      _resetSettingsCache();
      clearSettingsCache();
      const founderDb = await founderGetSetting(key);
      const registryDb = await registryGetSetting(key, entry.defaultValue);
      coerceCompare(founderDb, registryDb, knob.valueType);
      expect(registryDb).toBe(dbVal);
    });
  }
});

describe("P12-1a settings.ts validation extensions", () => {
  beforeEach(() => {
    H.platform.length = 0;
    H.founder.length = 0;
    H.sink.length = 0;
    _resetSettingsCache();
    clearSettingsCache();
  });

  it("boolean-typed keys reject non-boolean writes and accept booleans", async () => {
    const entry = SETTINGS_CATALOG.find((e) => e.key === "atlas.kill_switch")!;
    await seedSetting(entry);
    await expect(
      registrySetSetting({ key: "atlas.kill_switch", value: "true", founderId: "test" }),
    ).rejects.toBeInstanceOf(SettingsValidationError);
    await expect(
      registrySetSetting({ key: "atlas.kill_switch", value: 1, founderId: "test" }),
    ).rejects.toBeInstanceOf(SettingsValidationError);
    const row = await registrySetSetting({ key: "atlas.kill_switch", value: true, founderId: "test" });
    expect(row.value).toBe(true);
  });

  it("existing number min/max validation is unchanged", async () => {
    const entry = SETTINGS_CATALOG.find((e) => e.key === "AUTO_EXECUTE_THRESHOLD")!;
    await seedSetting(entry);
    await expect(
      registrySetSetting({ key: "AUTO_EXECUTE_THRESHOLD", value: 100, founderId: "test" }),
    ).rejects.toBeInstanceOf(SettingsValidationError);
    const row = await registrySetSetting({ key: "AUTO_EXECUTE_THRESHOLD", value: 80, founderId: "test" });
    expect(row.value).toBe(80);
  });
});
