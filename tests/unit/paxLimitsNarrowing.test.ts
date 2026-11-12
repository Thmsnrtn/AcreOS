/**
 * Per-member narrowing (PX-3, register P-1): a member's own override may only
 * make Pax MORE careful for that member's calls — never less.
 *
 * WHAT IS PROVED (per member of each population, not by sampling):
 *   - narrowRails: for EVERY record domain and EVERY ordered pair of levels the
 *     effective level is the weaker of (org, override); other domains are
 *     untouched; an absent override is the org rails, unchanged.
 *   - sends never go above ask: an override naming act_and_report-shaped
 *     values (hand-edited jsonb that reaches the resolver) is clamped, and so
 *     is an org value above ask.
 *   - narrowLimits: min semantics for every key and every null/number pairing —
 *     null only when both are null; a member value higher than the org's has NO
 *     effect; a member can never raise a cap or remove one the org set.
 *   - effectiveControlsForMember: a null / undefined / unknown userId returns
 *     the controls unchanged; a known one narrows rails AND limits; it keeps
 *     every other field (a PaxControlsState keeps its pause); a prototype key
 *     is not a member.
 *
 * Probe that must turn this red: in narrowLimits replace Math.min with Math.max
 * (a member then widens), or in narrowRails replace weakerRailLevel(a, b) with
 * the override alone.
 */

import { describe, expect, it } from "vitest";
import {
  PAX_LIMIT_KEYS,
  PAX_RAIL_LEVELS,
  PAX_RECORD_DOMAINS,
  PAX_SENDS_RAIL_LEVELS,
  defaultPaxLimits,
  defaultPaxRails,
  effectiveControlsForMember,
  narrowLimits,
  narrowRails,
  weakerRailLevel,
  PAX_CONTROLS_DEFAULTS,
  type PaxControls,
  type PaxLimits,
  type PaxMemberOverride,
  type PaxRailLevel,
  type PaxRails,
  type PaxSendsRailLevel,
} from "../../shared/pax-controls";

const rank = (l: PaxRailLevel) => PAX_RAIL_LEVELS.indexOf(l);

function railsWith(domain: (typeof PAX_RECORD_DOMAINS)[number], level: PaxRailLevel): PaxRails {
  const r = defaultPaxRails();
  r.records[domain] = level;
  return r;
}

describe("the populations are real (vacuity)", () => {
  it("six record domains, four levels, three sends levels, four limit keys", () => {
    expect(PAX_RECORD_DOMAINS).toHaveLength(6);
    expect(PAX_RAIL_LEVELS).toHaveLength(4);
    expect(PAX_SENDS_RAIL_LEVELS).toHaveLength(3);
    expect(PAX_LIMIT_KEYS).toHaveLength(4);
  });
  it("the default limits are all null (no cap = today) and a fresh object each call", () => {
    const a = defaultPaxLimits();
    expect(Object.values(a)).toEqual([null, null, null, null]);
    a.asksPerDay = 3;
    expect(defaultPaxLimits().asksPerDay).toBeNull();
    expect(PAX_CONTROLS_DEFAULTS.limits).toEqual(defaultPaxLimits());
    expect(PAX_CONTROLS_DEFAULTS.members).toEqual({});
  });
});

describe("narrowRails — the weaker of org and member, per domain", () => {
  it("every domain × every ordered pair of levels", () => {
    let checked = 0;
    for (const domain of PAX_RECORD_DOMAINS) {
      for (const orgLevel of PAX_RAIL_LEVELS) {
        for (const memberLevel of PAX_RAIL_LEVELS) {
          const org = railsWith(domain, orgLevel);
          const override: PaxMemberOverride = { rails: { records: { [domain]: memberLevel } } };
          const out = narrowRails(org, override);
          const expected = rank(orgLevel) <= rank(memberLevel) ? orgLevel : memberLevel;
          expect(out.records[domain], `${domain}: org ${orgLevel} × member ${memberLevel}`).toBe(expected);
          expect(out.records[domain]).toBe(weakerRailLevel(orgLevel, memberLevel));
          // Never stronger than either input.
          expect(rank(out.records[domain])).toBeLessThanOrEqual(rank(orgLevel));
          expect(rank(out.records[domain])).toBeLessThanOrEqual(rank(memberLevel));
          // No other domain moves.
          for (const other of PAX_RECORD_DOMAINS) {
            if (other !== domain) expect(out.records[other]).toBe(org.records[other]);
          }
          expect(out.sends).toBe(org.sends);
          checked++;
        }
      }
    }
    expect(checked).toBe(PAX_RECORD_DOMAINS.length * PAX_RAIL_LEVELS.length * PAX_RAIL_LEVELS.length);
  });

  it("sends: the weaker of the two, for every ordered pair of sends levels", () => {
    for (const orgLevel of PAX_SENDS_RAIL_LEVELS) {
      for (const memberLevel of PAX_SENDS_RAIL_LEVELS) {
        const org = { ...defaultPaxRails(), sends: orgLevel };
        const out = narrowRails(org, { rails: { sends: memberLevel } });
        expect(out.sends, `sends: org ${orgLevel} × member ${memberLevel}`).toBe(
          weakerRailLevel(orgLevel, memberLevel) as PaxSendsRailLevel,
        );
      }
    }
  });

  it("sends never go above ask, even when hand-edited values reach the resolver", () => {
    // Types forbid act_and_report on sends; stored jsonb is not typed. Cast on purpose.
    const hostileOrg = { ...defaultPaxRails(), sends: "act_and_report" as unknown as PaxSendsRailLevel };
    expect(narrowRails(hostileOrg).sends).toBe("ask");
    expect(narrowRails(hostileOrg, { rails: {} }).sends).toBe("ask");
    const hostileMember: PaxMemberOverride = { rails: { sends: "act_and_report" as unknown as PaxSendsRailLevel } };
    expect(narrowRails(defaultPaxRails(), hostileMember).sends).toBe("ask");
    expect(narrowRails(hostileOrg, hostileMember).sends).toBe("ask");
  });

  it("an absent or empty override returns the org rails, unchanged (and never the same object)", () => {
    const org = railsWith("deals", "draft");
    for (const o of [undefined, {}, { rails: {} }, { rails: { records: {} } }, { limits: { asksPerDay: 1 } }] as Array<PaxMemberOverride | undefined>) {
      const out = narrowRails(org, o);
      expect(out).toEqual(org);
      expect(out.records).not.toBe(org.records);
    }
  });

  it("a widening override has no effect: every level above the org's reads as the org's", () => {
    for (const domain of PAX_RECORD_DOMAINS) {
      const org = railsWith(domain, "ask");
      const out = narrowRails(org, { rails: { records: { [domain]: "act_and_report" } } });
      expect(out.records[domain]).toBe("ask");
    }
  });
});

describe("narrowLimits — the smaller cap wins, null only when both are null", () => {
  const VALUES: Array<number | null> = [null, 0, 1, 5, 100];

  it("every key × every (org, member) pairing", () => {
    for (const key of PAX_LIMIT_KEYS) {
      for (const o of VALUES) {
        for (const m of VALUES) {
          const org: PaxLimits = { ...defaultPaxLimits(), [key]: o };
          const out = narrowLimits(org, { limits: { [key]: m } });
          const expected = o === null ? m : m === null ? o : Math.min(o, m);
          expect(out[key], `${key}: org ${o} × member ${m}`).toBe(expected);
          // Null only when both are null.
          expect(out[key] === null).toBe(o === null && m === null);
          // Never looser than the org's cap.
          if (o !== null) expect(out[key]).toBeLessThanOrEqual(o);
          // Other keys unmoved.
          for (const other of PAX_LIMIT_KEYS) if (other !== key) expect(out[other]).toBe(org[other]);
        }
      }
    }
  });

  it("a member value higher than the org's has NO effect; a member can never remove an org cap", () => {
    const org = { ...defaultPaxLimits(), asksPerDay: 10, browseCallsPerDay: 3 };
    const out = narrowLimits(org, { limits: { asksPerDay: 1000, browseCallsPerDay: null } });
    expect(out).toEqual(org);
  });

  it("an absent override, and an override naming no limits, return the org limits unchanged", () => {
    const org = { ...defaultPaxLimits(), batchRowsPerDay: 20 };
    expect(narrowLimits(org)).toEqual(org);
    expect(narrowLimits(org, { rails: {} })).toEqual(org);
    expect(narrowLimits(org, { limits: {} })).toEqual(org);
    expect(narrowLimits(org)).not.toBe(org);
  });
});

describe("effectiveControlsForMember", () => {
  const base = (members: PaxControls["members"]): PaxControls & { paused: boolean; timezone: string } => ({
    ...PAX_CONTROLS_DEFAULTS,
    rails: railsWith("leads", "act_and_report"),
    limits: { ...defaultPaxLimits(), asksPerDay: 10 },
    members,
    paused: true,
    timezone: "America/Chicago",
  });
  const MARIA: PaxMemberOverride = { rails: { records: { leads: "ask" }, sends: "draft" }, limits: { asksPerDay: 2, browseCallsPerDay: 7 } };

  it("a null / undefined / empty / unknown userId returns the controls unchanged", () => {
    const c = base({ "u-1": MARIA });
    for (const id of [null, undefined, "", "u-2"]) {
      expect(effectiveControlsForMember(c, id), `userId ${JSON.stringify(id)}`).toBe(c);
    }
  });

  it("a known member's rails AND limits are narrowed; nothing else changes, pause included", () => {
    const c = base({ "u-1": MARIA });
    const e = effectiveControlsForMember(c, "u-1");
    expect(e.rails.records.leads).toBe("ask");
    expect(e.rails.sends).toBe("draft");
    expect(e.limits).toEqual({ asksPerDay: 2, creditSpendPerDay: null, browseCallsPerDay: 7, batchRowsPerDay: null });
    expect(e.paused).toBe(true);
    expect(e.timezone).toBe("America/Chicago");
    expect(e.stance).toBe(c.stance);
    expect(e.members).toBe(c.members);
    // The input is not mutated.
    expect(c.rails.records.leads).toBe("act_and_report");
    expect(c.limits.asksPerDay).toBe(10);
  });

  it("another member's override never applies to this caller", () => {
    const c = base({ "u-1": MARIA });
    expect(effectiveControlsForMember(c, "u-2").rails).toEqual(c.rails);
  });

  it("a widening override provably has no effect through the whole composition", () => {
    const wide: PaxMemberOverride = { rails: { records: { leads: "act_and_report" } }, limits: { asksPerDay: 999 } };
    const c = { ...base({ "u-1": wide }), rails: railsWith("leads", "draft") };
    const e = effectiveControlsForMember(c, "u-1");
    expect(e.rails).toEqual(c.rails);
    expect(e.limits).toEqual(c.limits);
  });

  it("an inherited key (constructor, __proto__, toString) is not a member", () => {
    const c = base({});
    for (const id of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
      expect(effectiveControlsForMember(c, id)).toBe(c);
    }
  });

  it("a hand-built state from before PX-3 (no members / limits) reads as no overrides", () => {
    const legacy = { ...PAX_CONTROLS_DEFAULTS } as Partial<PaxControls> & PaxControls;
    delete (legacy as Partial<PaxControls>).members;
    delete (legacy as Partial<PaxControls>).limits;
    expect(effectiveControlsForMember(legacy, "u-1")).toBe(legacy);
  });
});
