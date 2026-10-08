/**
 * Pax states, per lead, which channels can actually reach it — computed by the
 * send paths' own predicates, not re-implemented.
 *
 * THE DEFECT. An oracle pass had Pax advise "use mail or email first" for a
 * lead with only a phone number and no consent, and call such leads
 * "contactable". `get_leads` carried raw email/phone/consent fields and left
 * the model to reason about reachability itself.
 *
 *  - EQUIVALENCE: for every combination of consent, do-not-contact, phone,
 *    email and address completeness, each channel's verdict equals
 *    `canSendViaChannel(...).allowed && <a contact point exists>`.
 *  - ADOPTION: the reachability module imports `canSendViaChannel` and
 *    `hasCompleteMailingAddress` from tcpaCompliance (no copy of the rule), and
 *    the direct-mail send path asks the same address predicate.
 *  - THE SHAPE: a phone-only, no-consent lead is reachable by NO channel
 *    except mail, which it also lacks — so Pax cannot advise any.
 *
 * Mutations recorded (reverted after each red run):
 *   - leadReachabilityForPax ignoring the consent gate (`verdict` returning
 *     usable whenever a contact point exists): the phone-only and the
 *     equivalence tests go red.
 *   - communications.ts restoring the inline `!lead.address || !lead.city ...`
 *     check: the adoption test goes red.
 */
import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { stripCommentsPreservingLines } from "../../scripts/lib/strip-comments.mjs";

vi.mock("../../server/storage", () => ({ storage: {}, db: {} }));
vi.mock("../../server/db", () => ({ db: {} }));
vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { leadReachabilityForPax, summarizeReachabilityForPax } from "../../server/services/paxLeadReachability";
import { canSendViaChannel, hasCompleteMailingAddress } from "../../server/services/tcpaCompliance";

const ROOT = path.resolve(__dirname, "../..");
const code = (rel: string) => stripCommentsPreservingLines(fs.readFileSync(path.join(ROOT, rel), "utf8")) as string;

const FULL_ADDR = { address: "1 Ranch Rd", city: "Bisbee", state: "AZ", zip: "85603" };
const NO_ADDR = { address: null, city: null, state: null, zip: null };

function lead(o: Partial<Record<string, unknown>>): any {
  return { tcpaConsent: false, doNotContact: false, phone: null, email: null, ...NO_ADDR, ...o };
}

describe("equivalence with the send predicate", () => {
  const bools = [true, false];
  const cases = bools.flatMap((tcpaConsent) =>
    bools.flatMap((doNotContact) =>
      bools.flatMap((phone) => bools.flatMap((email) => bools.map((addr) => ({ tcpaConsent, doNotContact, phone, email, addr })))),
    ),
  );

  it("covers all 32 combinations", () => expect(cases).toHaveLength(32));

  it.each(cases)("%j", ({ tcpaConsent, doNotContact, phone, email, addr }) => {
    const l = lead({
      tcpaConsent,
      doNotContact,
      phone: phone ? "+15205550100" : null,
      email: email ? "a@b.co" : null,
      ...(addr ? FULL_ADDR : NO_ADDR),
    });
    const r = leadReachabilityForPax(l);
    expect(r.canText.usable).toBe(canSendViaChannel(l, "sms").allowed && phone);
    expect(r.canCall.usable).toBe(canSendViaChannel(l, "phone").allowed && phone);
    expect(r.canEmail.usable).toBe(canSendViaChannel(l, "email").allowed && email);
    expect(r.canMail.usable).toBe(canSendViaChannel(l, "direct_mail").allowed && hasCompleteMailingAddress(l));
    expect(r.usableNow.length === 0).toBe(!(r.canText.usable || r.canCall.usable || r.canEmail.usable || r.canMail.usable));
  });
});

describe("the shapes the oracle run got wrong", () => {
  it("a phone-only lead with no consent is reachable by nothing, and says why per channel", () => {
    const r = leadReachabilityForPax(lead({ phone: "+15205550100" }));
    expect(r.usableNow).toEqual([]);
    expect(r.canText.why).toMatch(/consent/i);
    expect(r.canMail.why).toMatch(/address/i);
    expect(r.canEmail.why).toMatch(/consent|email/i);
    expect(r.summary).toMatch(/not reachable by any channel/i);
  });

  it("consent plus a phone makes text and call usable, and not mail or email", () => {
    const r = leadReachabilityForPax(lead({ phone: "+15205550100", tcpaConsent: true }));
    expect(r.usableNow).toEqual(["text", "call"]);
    expect(r.canEmail.why).toMatch(/email/i);
  });

  it("a complete address makes mail usable without consent; do-not-contact blocks it", () => {
    expect(leadReachabilityForPax(lead(FULL_ADDR)).usableNow).toEqual(["mail"]);
    expect(leadReachabilityForPax(lead({ ...FULL_ADDR, doNotContact: true, tcpaConsent: true, phone: "1", email: "a@b.co" })).usableNow).toEqual([]);
  });

  it("an incomplete address is not mailable", () => {
    expect(leadReachabilityForPax(lead({ ...FULL_ADDR, zip: "" })).canMail.usable).toBe(false);
  });

  it("the summary counts channels over a list", () => {
    const rows = [
      leadReachabilityForPax(lead({ phone: "1" })),
      leadReachabilityForPax(lead({ phone: "1", tcpaConsent: true })),
      leadReachabilityForPax(lead(FULL_ADDR)),
    ];
    expect(summarizeReachabilityForPax(rows)).toEqual({
      leads: 3,
      canText: 1,
      canCall: 1,
      canEmail: 0,
      canMail: 1,
      reachableByNoChannel: 1,
    });
  });
});

describe("adoption: one predicate, no copy", () => {
  it("the reachability module imports the send predicates and holds no consent rule of its own", () => {
    const src = code("server/services/paxLeadReachability.ts");
    expect(src).toMatch(/import \{ canSendViaChannel, hasCompleteMailingAddress \} from "\.\/tcpaCompliance";/);
    expect(src).not.toMatch(/\.tcpaConsent|\.doNotContact/);
  });

  it("the direct-mail send path asks the same address predicate", () => {
    const src = code("server/services/communications.ts");
    expect(src).toMatch(/if \(!hasCompleteMailingAddress\(lead\)\)/);
    expect(src).not.toMatch(/!lead\.address \|\| !lead\.city/);
  });

  it("get_leads and get_lead_details return the reachability the module computes", () => {
    const src = code("server/ai/tools.ts");
    expect(src).toMatch(/reachability: leadReachabilityForPax\(l\)/);
    expect(src).toMatch(/reachability: leadReachabilityForPax\(lead\)/);
    expect(src).toMatch(/reachabilitySummary: summarizeReachabilityForPax\(/);
  });
});
