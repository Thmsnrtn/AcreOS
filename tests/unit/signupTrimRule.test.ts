/**
 * Signup trim (W1.4) — the shared rule, client/server flag parity, the
 * population of business-type writers, and the picker source shape.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { stripComments } from "../helpers/stripComments";
import {
  SIGNUP_OPEN_BUSINESS_TYPES,
  SIGNUP_TRIM_FLAG_KEY,
  decideSignupBusinessType,
  signupTrimFlagVerdict,
} from "@shared/business-types/signupTrim";
import { BUSINESS_TYPES } from "@shared/models/persona-mapping";
import { resolveFlagEnabled, type FeatureFlagsResponse } from "../../client/src/hooks/use-feature-flags";

const SIGNUP_WAITLIST_BUSINESS_TYPES = BUSINESS_TYPES.filter((t) => !SIGNUP_OPEN_BUSINESS_TYPES.includes(t));
const read = (f: string) => stripComments(readFileSync(resolve(__dirname, "../..", f), "utf8"));
const base = { flagOn: true, requested: "developer", stored: null, orgOnboarded: false, isFounder: false };

describe("the rule", () => {
  it("opens exactly land_flipper, hybrid, note_investor and waitlists the other twelve", () => {
    expect([...SIGNUP_OPEN_BUSINESS_TYPES].sort()).toEqual(["hybrid", "land_flipper", "note_investor"]);
    expect(SIGNUP_WAITLIST_BUSINESS_TYPES).toHaveLength(12);
    expect(SIGNUP_OPEN_BUSINESS_TYPES.length + SIGNUP_WAITLIST_BUSINESS_TYPES.length).toBe(BUSINESS_TYPES.length);
  });
  it("refuses only a new signup asking for a closed type it does not already have", () => {
    expect(decideSignupBusinessType(base).allowed).toBe(false);
    expect(decideSignupBusinessType({ ...base, flagOn: false }).allowed).toBe(true);
    expect(decideSignupBusinessType({ ...base, isFounder: true }).allowed).toBe(true);
    expect(decideSignupBusinessType({ ...base, orgOnboarded: true }).allowed).toBe(true);
    expect(decideSignupBusinessType({ ...base, stored: "developer" }).allowed).toBe(true);
    expect(decideSignupBusinessType({ ...base, requested: "hybrid" }).allowed).toBe(true);
    expect(decideSignupBusinessType({ ...base, requested: undefined }).allowed).toBe(true);
    expect(decideSignupBusinessType({ ...base, requested: "not_a_type" }).allowed).toBe(true);
  });
});

describe("client and server read the flag the same way", () => {
  // /api/config/features builds enabledKeys (state on), disabledKeys (state off)
  // and controlledKeys (every row). The endpoint source is pinned below.
  const respond = (state: string | null): FeatureFlagsResponse => ({
    enabledKeys: state === "on" ? [SIGNUP_TRIM_FLAG_KEY] : [],
    enabledRoutes: [],
    disabledKeys: state === "off" ? [SIGNUP_TRIM_FLAG_KEY] : [],
    disabledRoutes: [],
    controlledKeys: state === null ? [] : [SIGNUP_TRIM_FLAG_KEY],
    controlledRoutes: [],
  });
  it.each([null, "on", "off", "founder-only", "beta", "tier:pro"])("state %s", (state) => {
    expect(resolveFlagEnabled(respond(state), SIGNUP_TRIM_FLAG_KEY)).toBe(signupTrimFlagVerdict(state));
  });
  it("the endpoint still builds those three lists the same way", () => {
    const src = read("server/routes.ts");
    expect(src).toMatch(/enabledKeys = flags\.filter\(\(f\) => f\.state === "on"\)/);
    expect(src).toMatch(/disabledKeys = flags\.filter\(\(f\) => f\.state === "off"\)/);
    expect(src).toMatch(/controlledKeys = flags\.map\(\(f\) => f\.key\)/);
  });
  it("the flag row is seeded ON by migrate.mjs", () => {
    const mjs = read("scripts/migrate.mjs");
    expect(mjs).toMatch(/'onboarding\.signup_trim'[^`]*true, 'on'/);
  });
});

describe("every business-type writer asks the trim", () => {
  const units = () => {
    const out: Array<{ key: string; body: string }> = [];
    const onb = read("server/routes-onboarding.ts");
    const regs = [...onb.matchAll(/router\.(post|put|patch|delete)\(\s*"([^"]+)"/g)];
    regs.forEach((m, i) => out.push({ key: `${m[1].toUpperCase()} /api/onboarding${m[2]}`, body: onb.slice(m.index ?? 0, regs[i + 1]?.index ?? onb.length) }));
    const org = read("server/routes-organization.ts");
    for (const m of org.matchAll(/api\.(post|put|patch|delete)\(\s*"(\/api\/(?:onboarding[^"]*|organization))"/g)) {
      const start = m.index ?? 0;
      const next = org.slice(start + 10).search(/\n\s*api\.(get|post|put|patch|delete)\(/);
      out.push({ key: `${m[1].toUpperCase()} ${m[2]}`, body: org.slice(start, next < 0 ? org.length : start + 10 + next) });
    }
    const persona = read("server/routes-persona.ts").match(/router\.put\(\s*"\/"[\s\S]*/);
    if (persona) out.push({ key: "PUT /api/me/persona", body: persona[0] });
    return out;
  };
  const WRITERS = [
    "POST /api/onboarding/complete",
    "PATCH /api/onboarding/progress",
    "PUT /api/onboarding/step",
    "POST /api/onboarding/complete-step",
    "POST /api/onboarding/provision",
    "PUT /api/me/persona",
    "PATCH /api/organization",
  ];
  it("each of the seven writers calls refuseClosedSignupType", () => {
    const all = new Map(units().map((u) => [u.key, u.body]));
    for (const w of WRITERS) {
      expect(all.has(w), `${w} no longer found — the scan went blind`).toBe(true);
      expect(all.get(w), w).toMatch(/refuseClosedSignupType\(/);
    }
  });
  it("any route that asks mayChangeOrganizationType is on the list", () => {
    const asking = units().filter((u) => /mayChangeOrganizationType\(/.test(u.body)).map((u) => u.key);
    expect(asking.length).toBeGreaterThanOrEqual(6);
    expect(asking.filter((k) => !WRITERS.includes(k))).toEqual([]);
  });
});

describe("the picker", () => {
  const src = read("client/src/pages/onboarding-v2.tsx");
  it("reads the flag through the shared key and falls back to the full picker only when it is off", () => {
    expect(src).toMatch(/isFlagEnabled\(SIGNUP_TRIM_FLAG_KEY\)/);
    expect(src).toMatch(/signupTrimOn \? \(\s*<SignupWaitlist choices=\{SECONDARY_CHOICES\}/);
    expect(src).toContain("details-show-all-investor-types");
  });
});
