/**
 * Natural-language opt-outs are opt-outs; a bare YES does not re-subscribe.
 *
 * `detectOptKeyword` matched only a message that WAS a keyword, so "please
 * stop texting me" — a revocation by any reasonable reading of the FCC's 2024
 * rule — was stored as an ordinary reply and the lead stayed textable. And
 * "yes" sat in the START set, so a seller who had sent STOP and later answered
 * "yes" to anything was silently re-consented.
 *
 * The table below is the decision record for the ambiguous cases; the
 * reasoning lives beside the patterns in server/services/tcpaCompliance.ts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../server/services/consentEvents", () => ({
  recordConsentRevoked: vi.fn(async () => undefined),
  recordConsentGranted: vi.fn(async () => undefined),
}));

const H = vi.hoisted(() => ({
  leads: [] as Array<{ id: number; phone: string; doNotContact: boolean }>,
  patches: [] as Array<Record<string, unknown>>,
  audit: [] as Array<{ entityId: number; action: string }>,
}));

vi.mock("../../server/db", () => ({
  db: {
    update: () => ({
      set: (patch: Record<string, unknown>) => ({
        where: async () => {
          H.patches.push(patch);
        },
      }),
    }),
    insert: () => ({
      values: async (v: { entityId: number; action: string }) => {
        H.audit.push({ entityId: v.entityId, action: v.action });
      },
    }),
  },
}));
vi.mock("../../server/storage", () => ({
  storage: {
    findLeadsByPhoneLast10: vi.fn(async () => H.leads),
    getLead: vi.fn(async () => undefined),
  },
}));

import { detectOptKeyword, processOptKeyword } from "../../server/services/tcpaCompliance";

const OPT_OUTS = [
  "please stop texting me",
  "Please STOP texting me!!",
  "stop messaging me",
  "Stop contacting me about my land",
  "quit calling me",
  "Remove me from your list",
  "remove my number please",
  "Take me off your list.",
  "take my number off",
  "unsubscribe",
  "How do I unsubscribe from these?",
  "Do not contact me again",
  "DO NOT TEXT THIS NUMBER",
  "don't text me",
  "Dont text me anymore",
  "don’t contact me",
  "never text me again",
  "Leave me alone",
  "leave me alone already!",
  "wrong number",
  "Wrong number, I don't own any land",
  "You have the wrong person",
  "no more texts",
  "opt me out",
  "I want to opt out",
  "Stop. I'm not selling.",
  "STOP please",
  "Stop it",
  "End.",
  "put me on your do not call list",
  "Lose my number",
  "I revoke consent",
  // Ambiguous, decided as OPT-OUT (prefer the false positive):
  "Don't call me after 5", // limiting contact is a partial revocation
  // Found by the market twin's generated replies (tests/simulation/twin,
  // 2026-10-07) — wordings no one had tuned the detector against:
  "Cease all contact",
  "Please cease all communication immediately",
  // Identity denials: the same reasoning as "wrong number" — whoever this is
  // never consented.
  "Not me, wrong #",
  "This isn't John",
  "Never heard of Maria",
  "John passed away last year",
  "I don't own any land",
  "new number, who is this",
];

const NOT_OPT_OUTS = [
  "stop by Friday?",
  "Please stop by tomorrow",
  "can't stop thinking about selling",
  "I'll stop at the property on my way",
  "Yes I want to sell the land, call me",
  "What's your offer?",
  "Can you text me the details?",
  "The road ends at the creek",
  "Send me the contract",
  "Who is this?",
  "This isn't a good time, call me next week",
  "I don't own the mineral rights, just the surface",
  // Ambiguous, decided as NOT an opt-out (a price/terms answer far more often
  // than a revocation; the operator sees it in the inbox):
  "Not interested",
  "not interested at that price",
  "no thanks",
  "No",
];

describe("natural-language opt-out detection", () => {
  it.each(OPT_OUTS)("%j is an opt-out", (msg) => {
    expect(detectOptKeyword(msg)).toBe("opt_out");
  });

  it.each(NOT_OPT_OUTS)("%j is NOT an opt-out", (msg) => {
    expect(detectOptKeyword(msg)).not.toBe("opt_out");
  });
});

beforeEach(() => {
  H.leads.length = 0;
  H.patches.length = 0;
  H.audit.length = 0;
});

describe("processOptKeyword applies a natural-language opt-out to every channel", () => {
  it("'please stop texting me' sets doNotContact and revokes consent", async () => {
    H.leads.push({ id: 11, phone: "5125550142", doNotContact: false });
    const r = await processOptKeyword(5, "+15125550142", "please stop texting me", "SM_nl");
    expect(r).toEqual({ action: "opt_out", leadId: 11 });
    expect(H.patches).toHaveLength(1);
    expect(H.patches[0]).toMatchObject({ doNotContact: true, tcpaConsent: false });
    expect(String(H.patches[0].optOutReason)).toContain("opt-out language");
    expect(H.audit).toEqual([{ entityId: 11, action: "tcpa_opt_out" }]);
  });
});

describe("a bare YES after STOP does not re-subscribe", () => {
  it("YES from an opted-out lead changes no consent and is recorded", async () => {
    H.leads.push({ id: 12, phone: "5125550142", doNotContact: true });
    const r = await processOptKeyword(5, "+15125550142", "Yes", "SM_yes");
    expect(r.action).toBe("carrier_opt_in");
    // No write to the lead — still do-not-contact, still no consent.
    expect(H.patches).toEqual([]);
    expect(H.audit).toEqual([{ entityId: 12, action: "tcpa_carrier_opt_in_not_applied" }]);
  });

  it("YES from a lead who never opted out records nothing — it is just an answer", async () => {
    H.leads.push({ id: 13, phone: "5125550142", doNotContact: false });
    const r = await processOptKeyword(5, "+15125550142", "yes", "SM_yes2");
    expect(r.action).toBe("carrier_opt_in");
    expect(H.patches).toEqual([]);
    expect(H.audit).toEqual([]);
  });

  it("START still re-subscribes", async () => {
    H.leads.push({ id: 14, phone: "5125550142", doNotContact: true });
    const r = await processOptKeyword(5, "+15125550142", "START", "SM_start");
    expect(r.action).toBe("opt_in");
    expect(H.patches[0]).toMatchObject({ doNotContact: false, tcpaConsent: true });
  });
});
