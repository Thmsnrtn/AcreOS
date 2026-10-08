/**
 * The market twin is seeded, sourced, and honest about what it assumes — and
 * the product meets the twin's generated sellers correctly.
 */
import { describe, expect, it } from "vitest";
import { buildWorld, worldDigest } from "./world";
import { PARAMS, assumptions } from "./parameters";
import { REPLY_RATE, REPLY_MIX, MAIL_CALLBACK_RATE } from "../campaign/market/parameters";
import { Rng } from "./rng";
import { allOptOutWordings, isHeldOut, smsReply, smsDelivery, mailOutcome } from "./responses";
import { providerRulesFor } from "./providers";
import { churnsToday, targetCustomers, ticketFromFriction } from "./customers";
import { detectOptKeyword } from "../../../server/services/tcpaCompliance";

describe("twin: seeded and deterministic", () => {
  it("same seed, same world; different seed, different world", () => {
    expect(worldDigest(buildWorld(7, { parcels: 500 }))).toBe(worldDigest(buildWorld(7, { parcels: 500 })));
    expect(worldDigest(buildWorld(7, { parcels: 500 }))).not.toBe(worldDigest(buildWorld(8, { parcels: 500 })));
  });
  it("a reply stream is a pure function of its seed", () => {
    const w = buildWorld(3, { parcels: 200 });
    const run = () => { const r = new Rng(99); return w.owners.map((o) => smsReply(r, o)?.text ?? "-").join("|"); };
    expect(run()).toBe(run());
  });
});

describe("twin: every parameter has a source", () => {
  it("each parameter is market, public or a labelled assumption", () => {
    for (const [k, p] of Object.entries(PARAMS)) {
      expect(["market", "public", "assumption"], k).toContain(p.source.kind);
      expect(p.source.ref.length, k).toBeGreaterThan(0);
      if (p.source.kind === "assumption") expect((p.source.note ?? "").length, `${k} needs its reasoning`).toBeGreaterThan(10);
    }
    expect(assumptions().length).toBeGreaterThan(0);
  });
  it("market parameters ARE market/'s values (one source, read not copied)", () => {
    expect(PARAMS.smsReplyRate.value).toBe(REPLY_RATE);
    expect(PARAMS.mailCallbackRate.value).toBe(MAIL_CALLBACK_RATE);
    expect(PARAMS.smsReplyShareStop.value).toBe(REPLY_MIX.find((r) => r[0] === "stop")![1]);
  });
});

describe("twin → product: generated seller replies meet the real opt-out detector", () => {
  const all = allOptOutWordings();
  const held = all.filter(isHeldOut);
  it("the generator is combinatorial and has a held-out split", () => {
    expect(all.length).toBeGreaterThanOrEqual(1000);
    expect(held.length).toBeGreaterThan(all.length * 0.2);
    expect(held.length).toBeLessThan(all.length * 0.4);
  });
  it("every generated revocation — working and held-out — is detected as an opt-out", () => {
    const missed = all.filter((t) => detectOptKeyword(t) !== "opt_out");
    expect(missed).toEqual([]);
  });
  it("every reply the twin marks as revoking consent is read as an opt-out; others are not", () => {
    const w = buildWorld(11, { parcels: 3000 });
    const r = new Rng(5);
    let revoking = 0, plain = 0;
    const misses: string[] = [], falsePos: string[] = [];
    for (const o of w.owners) {
      const rep = smsReply(r, o);
      if (!rep) continue;
      const read = detectOptKeyword(rep.text) === "opt_out";
      if (rep.revokesConsent) { revoking++; if (!read) misses.push(rep.text); }
      else { plain++; if (read) falsePos.push(rep.text); }
    }
    expect(revoking).toBeGreaterThan(50);
    expect(plain).toBeGreaterThan(50);
    expect(misses).toEqual([]);
    expect(falsePos).toEqual([]);
  });
});

describe("twin: provider failure modes", () => {
  it("landlines answer 30006, unregistered senders 30034, bad addresses are refused", () => {
    const w = buildWorld(4, { parcels: 1500 });
    const rules = providerRulesFor(w);
    const landline = w.owners.find((o) => o.phoneKind === "landline")!;
    expect(rules.smsCodes[landline.phone!]).toBe(30006);
    expect(Object.values(rules.smsCodes)).toContain(30007);
    expect(rules.lobReject.length).toBeGreaterThan(0);
    const r = new Rng(1);
    const mobile = w.owners.find((o) => o.phoneKind === "mobile")!;
    expect(smsDelivery(r, mobile, false)).toEqual({ delivered: false, code: 30034, reason: "unregistered 10DLC" });
    const bad = w.owners.find((o) => o.mailUndeliverable)!;
    expect(mailOutcome(new Rng(2), bad).delivered).toBe(false);
  });
});

describe("twin: customers", () => {
  it("the cohort grows 3 → 25 → 100", () => {
    expect(targetCustomers(30)).toBe(3);
    expect(targetCustomers(180)).toBe(25);
    expect(targetCustomers(365)).toBe(100);
  });
  it("friction raises churn; value lowers it", () => {
    const rate = (lived: { unresolvedTickets: number; valueEvents: number }) => {
      const r = new Rng(1);
      let n = 0;
      for (let i = 0; i < 20000; i++) if (churnsToday(r, "land_flipper", lived)) n++;
      return n;
    };
    expect(rate({ unresolvedTickets: 3, valueEvents: 0 })).toBeGreaterThan(rate({ unresolvedTickets: 0, valueEvents: 0 }));
    expect(rate({ unresolvedTickets: 0, valueEvents: 3 })).toBeLessThan(rate({ unresolvedTickets: 0, valueEvents: 0 }));
  });
  it("tickets come only from friction classes the market rubric defines", () => {
    const t = ticketFromFriction(new Rng(3), "org-1", 4, "manual_request", "POST /api/subscription/cancel → 200");
    expect(t === null || t.friction === "manual_request").toBe(true);
  });
});
