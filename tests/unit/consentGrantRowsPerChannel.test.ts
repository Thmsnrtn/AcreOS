/**
 * Consent grants are recorded one `lead_consent_events` row PER CHANNEL, and
 * only for the channels the grant actually covers (founder decision
 * 2026-10-29: "record per-channel grant rows at lead-create").
 *
 * The lead-create route used to write ONE row claiming sms + email + phone +
 * direct_mail for a payload whose only consent evidence is `tcpaConsent` —
 * consent to be texted or called. An auditor reading the table saw email and
 * direct-mail grants that were never captured. The same bundled row was
 * written by the consent PATCH and the SMS opt-in keyword.
 *
 * This file needs no database:
 *   1. the writer turns one grant into single-channel rows;
 *   2. the channel set for a `tcpaConsent` grant IS `requiresTcpaConsent`;
 *   3. the POPULATION: every grant writer in server/ is enumerated, and none
 *      may name email or direct_mail or write the table directly;
 *   4. the one send gate that reads this table (AI-voice calls) gives the same
 *      verdict for the old bundled row and the new per-channel rows.
 * The real database cases are in consentGrantRowsPerChannel.realdb.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { stripComments } from "../helpers/stripComments";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";

const inserted: unknown[] = [];
vi.mock("../../server/db", () => ({
  db: {
    insert: () => ({
      values: async (v: unknown) => {
        inserted.push(v);
      },
    }),
  },
}));
vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { recordConsentGranted, TCPA_CONSENT_CHANNELS, type ConsentChannel } from "../../server/services/consentEvents";
import { requiresTcpaConsent } from "../../server/services/tcpaCompliance";
import { hasWrittenArtificialVoiceConsent, type ConsentEventRow } from "../../server/services/comms/aiVoiceConsent";

// Walks server/; the sweep budget, not the 30s default.
vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

const ALL: ConsentChannel[] = ["sms", "email", "phone", "direct_mail"];
const base = {
  organizationId: 7,
  leadId: 11,
  source: "written" as const,
  consentText: "I agree to be called and texted.",
  checkboxChecked: true,
  ipAddress: "203.0.113.5",
  userAgent: "ua",
  pageUrl: "https://example.test/form",
  recordedBy: "u1",
  metadata: { route: "POST /api/leads" },
};

beforeEach(() => {
  inserted.length = 0;
});

describe("the writer records one row per granted channel", () => {
  it("a two-channel grant is ONE insert of two single-channel rows sharing every other field", async () => {
    await recordConsentGranted({ ...base, channels: ["sms", "phone"] });
    expect(inserted).toHaveLength(1); // one statement: the rows share created_at and land together
    const rows = inserted[0] as Array<Record<string, unknown>>;
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.map((r) => r.channels)).toEqual([["sms"], ["phone"]]);
    const { channels: _a, ...first } = rows[0];
    const { channels: _b, ...second } = rows[1];
    expect(second).toEqual(first);
    expect(first).toMatchObject({ eventType: "granted", source: "written", leadId: 11, organizationId: 7, consentText: base.consentText });
  });

  it("no row ever names more than one channel, whatever the caller passes", async () => {
    for (let mask = 1; mask < 16; mask++) {
      const channels = ALL.filter((_, i) => mask & (1 << i));
      inserted.length = 0;
      await recordConsentGranted({ ...base, channels: [...channels, ...channels] });
      const rows = inserted[0] as Array<Record<string, unknown>>;
      expect(rows.map((r) => r.channels)).toEqual(channels.map((c) => [c]));
    }
  });

  it("a grant of no channel writes nothing", async () => {
    await recordConsentGranted({ ...base, channels: [] });
    expect(inserted).toHaveLength(0);
  });
});

describe("a tcpaConsent grant covers exactly the channels TCPA consent governs", () => {
  it("TCPA_CONSENT_CHANNELS equals the channels requiresTcpaConsent says need it", () => {
    expect([...TCPA_CONSENT_CHANNELS].sort()).toEqual(ALL.filter((c) => requiresTcpaConsent(c)).sort());
    expect(TCPA_CONSENT_CHANNELS).not.toContain("email");
    expect(TCPA_CONSENT_CHANNELS).not.toContain("direct_mail");
  });
});

// ── The population: every writer of a consent GRANT in server/ ─────────────
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|mts)$/.test(name)) out.push(p);
  }
  return out;
}
const SERVER_FILES = walk("server").map((f) => ({ f, src: stripComments(readFileSync(f, "utf8")) }));

/** Each `recordConsentGranted({ … })` argument object, by balanced braces. */
function grantCalls(src: string): string[] {
  const out: string[] = [];
  let at = 0;
  for (;;) {
    const i = src.indexOf("recordConsentGranted({", at);
    if (i < 0) return out;
    let depth = 0;
    let j = src.indexOf("{", i);
    const start = j;
    for (; j < src.length; j++) {
      if (src[j] === "{") depth++;
      else if (src[j] === "}" && --depth === 0) break;
    }
    // A call whose argument we cannot close is COUNTED (as its raw tail), never skipped.
    out.push(src.slice(start, j < src.length ? j + 1 : src.length));
    at = i + 1;
  }
}

/**
 * Every grant writer, by file. Adding a writer without adding it here fails,
 * so a new bundled writer cannot appear outside this gate's population.
 */
const GRANT_WRITERS: Record<string, number> = {
  "server/routes-leads.ts": 1, // POST /api/leads
  "server/routes-import-export.ts": 1, // PATCH /api/leads/:id/consent
  "server/services/tcpaCompliance.ts": 1, // inbound SMS opt-in keyword
};

describe("every grant writer records per-channel TCPA grants", () => {
  const found = SERVER_FILES.map(({ f, src }) => ({ f, calls: grantCalls(src) })).filter((x) => x.calls.length > 0);

  it("the enumerated writers are exactly the call sites in server/", () => {
    const actual = Object.fromEntries(found.map((x) => [x.f.replace(/\\/g, "/"), x.calls.length]));
    expect(actual).toEqual(GRANT_WRITERS);
  });

  for (const file of Object.keys(GRANT_WRITERS)) {
    it(`${file}: grants TCPA_CONSENT_CHANNELS and names no email / direct_mail grant`, () => {
      const calls = found.find((x) => x.f.replace(/\\/g, "/") === file)?.calls ?? [];
      expect(calls.length, "vacuity: the writer must be read").toBeGreaterThan(0);
      for (const call of calls) {
        expect(call).toMatch(/channels:\s*TCPA_CONSENT_CHANNELS\b/);
        expect(call).not.toMatch(/["']email["']|["']direct_mail["']/);
      }
    });
  }

  it("nothing in server/ writes lead_consent_events except the recorder", () => {
    const direct = SERVER_FILES.filter(
      ({ f, src }) =>
        !f.replace(/\\/g, "/").endsWith("server/services/consentEvents.ts") &&
        (/\.insert\(\s*leadConsentEvents\b/.test(src) || /insert\s+into\s+lead_consent_events/i.test(src)),
    ).map((x) => x.f);
    expect(direct).toEqual([]);
    expect(SERVER_FILES.length, "vacuity: server/ was read").toBeGreaterThan(200);
  });
});

// ── The AI-voice call gate reads this table: its verdict must not move ─────
describe("the AI-voice gate gives the same verdict for bundled and per-channel grants", () => {
  const at = (m: number) => new Date(Date.UTC(2026, 10, 3, 12, m));
  const AI_TEXT = "I agree AcreOS may call me using an artificial or AI-generated voice.";
  const grant = (channels: string[], m: number, over: Partial<ConsentEventRow> = {}): ConsentEventRow => ({
    eventType: "granted",
    channels,
    source: "written",
    consentText: AI_TEXT,
    metadata: null,
    createdAt: at(m),
    ...over,
  });
  const revoke = (m: number): ConsentEventRow => ({ eventType: "revoked", channels: ALL, source: "inbound_stop", consentText: null, metadata: null, createdAt: at(m) });
  /** What the new writer stores for one grant: one row per TCPA channel, newest-first order of the gate's query (id desc). */
  const split = (g: ConsentEventRow): ConsentEventRow[] => [...TCPA_CONSENT_CHANNELS].reverse().map((c) => ({ ...g, channels: [c] }));

  const cases: Array<[string, ConsentEventRow[]]> = [
    ["written AI-voice grant", [grant(ALL, 1)]],
    ["non-written grant", [grant(ALL, 1, { source: "admin_manual" })]],
    ["written grant without AI-voice language", [grant(ALL, 1, { consentText: "ok to call" })]],
    ["grant then STOP", [revoke(2), grant(ALL, 1)]],
    ["STOP then re-grant", [grant(ALL, 3), revoke(2), grant(ALL, 1)]],
    ["written AI grant, then a later SMS keyword opt-in", [grant(ALL, 2, { source: "sms_double_optin", consentText: "START" }), grant(ALL, 1)]],
  ];
  for (const [name, bundled] of cases) {
    it(name, () => {
      const perChannel = bundled.flatMap((e) => (e.eventType === "granted" ? split(e) : [e]));
      expect(hasWrittenArtificialVoiceConsent(perChannel)).toEqual(hasWrittenArtificialVoiceConsent(bundled));
    });
  }
});
