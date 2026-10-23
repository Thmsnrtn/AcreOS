/**
 * Standing founder decision 2026-10-20 #1: no cold texting without WRITTEN
 * consent.
 *
 * The prospecting gate used to accept any recorded TCPA consent — a verbal
 * yes or an operator's unevidenced "manual" tick licensed a cold text. These
 * drive the real gate (storage mocked) and the real predicate, so loosening
 * either back to "any consent" goes red.
 *
 * ADOPTION (independent audit, 2026-10-20). The gate alone is not the rule:
 * every reader that decides "this lead can be texted" must give the gate's
 * answer, or Pax promises a text the gate then refuses. The audit found
 * checkTcpaConsentFromLead (so canSendViaChannel and Pax's reachability),
 * countContactableLeadsForPax, CommunicationsService's channel picker, the
 * autonomy guardrail and the autopilot send_sms hand all reading the bare
 * grant. "readers agree with the gate" drives each row-level reader over
 * every consent source and requires its verdict to equal tcpaGateForSms's.
 * The SQL count is proven on its rendered query in
 * paxAccountReadsAreOrgPinned.test.ts, the send_sms hand in
 * autopilotCommHands.test.ts.
 *
 * POPULATION: every non-test server file is PARSED (never scanned — a parse
 * never visits a comment) and every function that names `tcpaConsent` /
 * `tcpa_consent` is enrolled in READERS with its exact count and a role. A
 * new reader — or a new read inside a known one — fails until classified, and
 * an "sms" reader must call the canonical predicate.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import ts from "typescript";
import { listServerSources, parseSource, rel, enclosingFunctionName } from "../helpers/serverPopulation";

const leadRow: Record<string, unknown> = {};
vi.mock("../../server/storage", () => ({
  storage: { getLead: vi.fn(async () => ({ ...leadRow })) },
}));
vi.mock("../../server/db", () => {
  const chain: any = {
    select: () => chain,
    from: () => chain,
    where: () => chain,
    limit: () => Promise.resolve([{ ...leadRow }]),
  };
  return { db: chain };
});
vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../server/services/smsService", () => ({ smsService: { isConfigured: () => true } }));
vi.mock("../../server/services/emailService", () => ({ emailService: {} }));
vi.mock("../../server/services/lobService", () => ({ lobService: {}, LobErrorType: {} }));
vi.mock("../../server/services/compliance/contactFrequency", () => ({
  frequencyGateForLead: vi.fn(),
  describeFrequencySkip: vi.fn(),
}));
vi.mock("../../server/services/actions/outwardAction", () => ({ classifyExisting: vi.fn(), requestHash: vi.fn() }));

const { tcpaGateForSms, hasWrittenSmsConsent, WRITTEN_SMS_CONSENT_SOURCES, checkTcpaConsentFromLead, canSendViaChannel } =
  await import("../../server/services/tcpaCompliance");
const { leadReachabilityForPax } = await import("../../server/services/paxLeadReachability");
const { CommunicationsService } = await import("../../server/services/communications");
const { checkTcpaBeforeSend } = await import("../../server/services/autonomyGuardrails");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-20T17:00:00Z")); // midday in UTC
  for (const k of Object.keys(leadRow)) delete leadRow[k];
  Object.assign(leadRow, { id: 1, organizationId: 7, tcpaConsent: true, doNotContact: false, optOutDate: null, timezone: "UTC", status: "new" });
});
afterEach(() => vi.useRealTimers());

const NOT_WRITTEN = ["verbal", "manual", "admin_manual", "manual_restoration", "imported", null] as const;
const WRITTEN = ["website", "written", "sms_double_optin", "phone_ivr"] as const;

describe("cold texts need written consent", () => {
  for (const source of NOT_WRITTEN) {
    it(`consent source ${String(source)} does NOT license a cold text`, async () => {
      leadRow.consentSource = source;
      const v = await tcpaGateForSms(1, 7, "+15125550111");
      expect(v.allowed).toBe(false);
      expect(v.reason).toMatch(/written consent/);
    });
  }

  for (const source of WRITTEN) {
    it(`consent source ${source} (written / E-SIGN) does`, async () => {
      leadRow.consentSource = source;
      expect((await tcpaGateForSms(1, 7, "+15125550111")).allowed).toBe(true);
    });
  }

  it("written-source consent that was revoked does not", async () => {
    Object.assign(leadRow, { consentSource: "website", doNotContact: true });
    expect((await tcpaGateForSms(1, 7, "+15125550111")).allowed).toBe(false);
  });

  it("the predicate requires both the grant and a written source", () => {
    expect(hasWrittenSmsConsent({ tcpaConsent: false, consentSource: "website" })).toBe(false);
    expect(hasWrittenSmsConsent({ tcpaConsent: true, consentSource: "verbal" })).toBe(false);
    expect(hasWrittenSmsConsent({ tcpaConsent: true, consentSource: "written" })).toBe(true);
    expect([...WRITTEN_SMS_CONSENT_SOURCES].sort()).toEqual(["phone_ivr", "sms_double_optin", "website", "written"]);
  });
});

describe("readers agree with the gate", () => {
  const cases: Array<{ tcpaConsent: boolean | null; consentSource: string | null }> = [
    ...[...NOT_WRITTEN, ...WRITTEN].map((consentSource) => ({ tcpaConsent: true, consentSource })),
    { tcpaConsent: false, consentSource: "website" },
    { tcpaConsent: null, consentSource: "written" },
  ];
  const comms = new CommunicationsService();

  for (const c of cases) {
    it(`tcpaConsent=${c.tcpaConsent} source=${String(c.consentSource)}: every SMS reader gives the gate's verdict`, async () => {
      Object.assign(leadRow, c);
      const gate = (await tcpaGateForSms(1, 7, "+15125550111")).allowed;
      const lead = {
        ...c,
        doNotContact: false,
        optOutDate: null,
        phone: "+15125550111",
        email: null,
        address: null,
        city: null,
        state: null,
        zip: null,
      };
      const readers = {
        checkTcpaConsentFromLead: checkTcpaConsentFromLead(lead).canSms,
        canSendViaChannel: canSendViaChannel(lead, "sms").allowed,
        leadReachabilityForPax: leadReachabilityForPax(lead).canText.usable,
        determinePreferredChannel: comms.determinePreferredChannel(lead) === "sms",
        checkTcpaBeforeSend: (await checkTcpaBeforeSend(7, 1, "sms")).allowed,
      };
      for (const [name, verdict] of Object.entries(readers)) {
        expect(verdict, `${name} disagrees with tcpaGateForSms`).toBe(gate);
      }
    });
  }

  it("the suite is not vacuous: the gate says yes on some rows and no on others", async () => {
    const verdicts = new Set<boolean>();
    for (const c of cases) {
      Object.assign(leadRow, c);
      verdicts.add((await tcpaGateForSms(1, 7, "+15125550111")).allowed);
    }
    expect([...verdicts].sort()).toEqual([false, true]);
  });

  it("calls are NOT narrowed: a verbal TCPA grant still licenses a call", async () => {
    Object.assign(leadRow, { consentSource: "verbal" });
    const lead = { tcpaConsent: true, consentSource: "verbal", doNotContact: false, optOutDate: null };
    expect(checkTcpaConsentFromLead(lead).canCall).toBe(true);
    expect(canSendViaChannel(lead, "phone").allowed).toBe(true);
    expect((await checkTcpaBeforeSend(7, 1, "phone")).allowed).toBe(true);
    // ...and email never needed SMS consent (decision #2)
    expect(canSendViaChannel({ ...lead, tcpaConsent: false }, "email").allowed).toBe(true);
  });

  it("the refusal says why, in words a customer can act on", () => {
    const r = canSendViaChannel({ tcpaConsent: true, consentSource: "verbal", doNotContact: false, optOutDate: null }, "sms");
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/written consent/);
  });
});

// ── Population: every function in server/ that names the TCPA grant ──────────

type Role =
  /** IS the predicate */
  | "predicate"
  /** decides whether a lead can be TEXTED — must call a canonical reader */
  | "sms"
  /** writes, stamps, serializes, selects, or decides calls/email only */
  | "other";

/**
 * `file::enclosingFunction` → exact count of `tcpaConsent` / `tcpa_consent`
 * names in it, and its role. Raising a count means a new read: classify it.
 */
const READERS: Record<string, { n: number; role: Role; why: string }> = {
  // ─ the canonical predicate ─
  "server/services/leadContactability.ts::hasWrittenSmsConsent": { n: 1, role: "predicate", why: "THE row predicate" },
  "server/services/leadContactability.ts::writtenSmsConsentSql": { n: 1, role: "predicate", why: "THE predicate in SQL, same constant" },
  "server/services/leadContactability.ts::<module>": { n: 1, role: "other", why: "WrittenConsentFlags type" },
  // ─ readers that decide SMS reachability: each must call the predicate (or a reader built on it) ─
  "server/services/tcpaCompliance.ts::checkTcpaConsentFromLead": { n: 1, role: "sms", why: "canSms = hasWrittenSmsConsent; canCall on the bare grant" },
  "server/services/communications.ts::determinePreferredChannel": { n: 1, role: "sms", why: "channel picker (parameter type)" },
  "server/services/autonomyGuardrails.ts::checkTcpaBeforeSend": { n: 3, role: "sms", why: "select + call gate; sms via hasWrittenSmsConsent" },
  "server/services/autopilot/hands/send-sms.ts::handler": { n: 2, role: "sms", why: "select; decides via hasWrittenSmsConsent" },
  "server/ai/tools.ts::executeTool": { n: 6, role: "sms", why: "send_sms/send_email build ConsentFlags for checkTcpaConsentFromLead; get_leads displays the raw flag beside reachability" },
  // ─ not SMS reachability ─
  "server/services/tcpaCompliance.ts::<module>": { n: 1, role: "other", why: "ConsentFlags type" },
  "server/services/tcpaCompliance.ts::applyOptKeywordToLead": { n: 2, role: "other", why: "STOP / START writes" },
  "server/services/paxLeadReachability.ts::<module>": { n: 1, role: "other", why: "ReachabilityLead type (decides via canSendViaChannel)" },
  "server/services/paxProductFacts.ts::sequenceFacts": { n: 2, role: "other", why: "fixtures handed to canSendViaChannel" },
  "server/services/smsService.ts::handleIncomingSMS": { n: 1, role: "other", why: "STOP write" },
  "server/services/consentStamp.ts::<module>": { n: 1, role: "other", why: "type" },
  "server/services/consentStamp.ts::stampConsentForInsert": { n: 2, role: "other", why: "write stamp" },
  "server/services/consentStamp.ts::stampConsentForUpdate": { n: 4, role: "other", why: "write stamp" },
  "server/services/consentStamp.ts::stripConsentForImport": { n: 2, role: "other", why: "import strip" },
  "server/services/leadEvents.ts::<module>": { n: 1, role: "other", why: "field list" },
  "server/ai/paxSourceExtraction.ts::looksLikeLead": { n: 1, role: "other", why: "shape detection" },
  "server/api-v1/leads.ts::<module>": { n: 1, role: "other", why: "input schema" },
  "server/api-v1/leads.ts::mapCreateInput": { n: 2, role: "other", why: "write" },
  "server/api-v1/leads.ts::mapUpdateInput": { n: 3, role: "other", why: "write" },
  "server/api-v1/serializers.ts::<module>": { n: 1, role: "other", why: "output type" },
  "server/api-v1/serializers.ts::serializeLead": { n: 2, role: "other", why: "serialize" },
  "server/routes-import-export.ts::<module>": { n: 1, role: "other", why: "consent PATCH schema" },
  "server/routes-import-export.ts::registerImportExportRoutes": { n: 11, role: "other", why: "consent PATCH write + audit; TCPA stats counts GRANTS (not textable leads)" },
  "server/routes-leads.ts::bulkConsentRefusal": { n: 1, role: "other", why: "write refusal" },
  "server/routes-leads.ts::registerLeadRoutes": { n: 2, role: "other", why: "consent event on create" },
  "server/storage.ts::<module>": { n: 1, role: "other", why: "type" },
  "server/storage/auditRepo.ts::getLeadsWithoutConsent": { n: 2, role: "other", why: "lists leads with NO grant (compliance page)" },
  "server/storage/auditRepo.ts::updateLeadConsent": { n: 6, role: "other", why: "write" },
};

/** Readers built on hasWrittenSmsConsent — an "sms" function must call one. */
const CANONICAL = new Set(["hasWrittenSmsConsent", "writtenSmsConsentSql", "checkTcpaConsentFromLead", "canSendViaChannel", "checkTcpaConsent", "tcpaGateForSms"]);

function readersInServer(): { found: Map<string, number>; calls: Map<string, Set<string>>; files: number } {
  const found = new Map<string, number>();
  const calls = new Map<string, Set<string>>();
  const files = listServerSources();
  for (const f of files) {
    const text = fs.readFileSync(f, "utf8");
    if (!/tcpaConsent|tcpa_consent|hasWrittenSmsConsent/.test(text)) continue;
    const sf = parseSource(f, text);
    const visit = (n: ts.Node) => {
      let hit = 0;
      if (ts.isIdentifier(n) && /^(tcpaConsent|tcpa_consent)$/.test(n.text)) hit = 1;
      else if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && /^(tcpaConsent|tcpa_consent)$/.test(n.text)) hit = 1;
      else if (ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) hit = (n.text.match(/\btcpa_consent\b/g) || []).length;
      const key = `${rel(f)}::${enclosingFunctionName(n)}`;
      if (hit) found.set(key, (found.get(key) ?? 0) + hit);
      if (ts.isCallExpression(n)) {
        const callee = ts.isIdentifier(n.expression) ? n.expression.text : ts.isPropertyAccessExpression(n.expression) ? n.expression.name.text : "";
        if (CANONICAL.has(callee)) {
          if (!calls.has(key)) calls.set(key, new Set());
          calls.get(key)!.add(callee);
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return { found, calls, files: files.length };
}

describe("population: every server reader of the TCPA grant is classified", () => {
  const { found, calls, files } = readersInServer();

  it("reads the whole server tree (floor)", () => {
    expect(files).toBeGreaterThan(1200);
    expect(found.size).toBeGreaterThanOrEqual(30);
  });

  it("every function that names the grant is enrolled, at its exact count", () => {
    const unexpected = [...found].filter(([k, n]) => (READERS[k]?.n ?? -1) !== n);
    expect(
      unexpected.map(([k, n]) => `${k} names tcpaConsent ${n}x (register: ${READERS[k]?.n ?? "absent"}) — classify the new read`),
    ).toEqual([]);
  });

  it("no enrolled reader is stale (vacuity per member)", () => {
    const stale = Object.entries(READERS).filter(([k, r]) => (r.n > 0 ? found.get(k) !== r.n : !calls.has(k)));
    expect(stale.map(([k]) => k)).toEqual([]);
  });

  it("every SMS-reachability reader decides through the canonical predicate", () => {
    const bare = Object.entries(READERS)
      .filter(([, r]) => r.role === "sms")
      .filter(([k]) => !calls.has(k));
    expect(bare.map(([k]) => `${k} decides SMS reachability without ${[...CANONICAL].join("/")}`)).toEqual([]);
  });
});
