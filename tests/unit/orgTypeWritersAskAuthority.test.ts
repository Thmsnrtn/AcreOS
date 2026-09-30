/**
 * DEFECT-0237, audit of 224a5c0 — what the ORGANIZATION is (business type,
 * note role, investor type, name) moves only for its owner or an owner/admin
 * member. The rule was installed on `PUT /api/me/persona` alone while four
 * onboarding writers (/complete, /progress, /step, /complete-step, /provision)
 * let any member rewrite it.
 *
 * The population is every write route under /api/onboarding plus the persona
 * route, enumerated from the source: each must ask `mayChangeOrganizationType`
 * or be listed below with the reason it cannot write an org-level key. A new
 * onboarding write route that does neither is the thing that fails.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { stripComments } from "../helpers/stripComments";

const read = (f: string) => stripComments(readFileSync(resolve(__dirname, "../..", f), "utf8"));

/** Routes that accept no org-level key — each checked by hand, with why. */
const NO_ORG_LEVEL_KEYS: Record<string, string> = {
  "POST /api/onboarding/skip": "writes only skipped/skippedAt and marks complete",
  "POST /api/onboarding/step-entered": "telemetry only",
  "POST /api/onboarding/path-selected": "telemetry only",
  "POST /api/onboarding/tips": "reads tips; writes nothing",
  "POST /api/onboarding/reset": "resetOnboarding preserves businessType/noteRole (routes-onboarding.test.ts)",
  "POST /api/onboarding/sample-data": "seeds from the stored type; takes no body",
};

function units(): Array<{ key: string; body: string }> {
  const out: Array<{ key: string; body: string }> = [];
  const onboarding = read("server/routes-onboarding.ts");
  const regs = [...onboarding.matchAll(/router\.(post|put|patch|delete)\(\s*"([^"]+)"/g)];
  regs.forEach((m, i) => {
    const end = regs[i + 1]?.index ?? onboarding.length;
    out.push({ key: `${m[1].toUpperCase()} /api/onboarding${m[2]}`, body: onboarding.slice(m.index ?? 0, end) });
  });
  const org = read("server/routes-organization.ts");
  const orgRegs = [...org.matchAll(/api\.(post|put|patch|delete)\(\s*"(\/api\/onboarding[^"]*)"/g)];
  orgRegs.forEach((m) => {
    const start = m.index ?? 0;
    const next = org.slice(start + 10).search(/\n\s*api\.(get|post|put|patch|delete)\(/);
    out.push({ key: `${m[1].toUpperCase()} ${m[2]}`, body: org.slice(start, next < 0 ? org.length : start + 10 + next) });
  });
  const persona = read("server/routes-persona.ts");
  const p = persona.match(/router\.put\(\s*"\/"[\s\S]*/);
  if (p) out.push({ key: "PUT /api/me/persona", body: p[0] });
  return out;
}

describe("every writer of what the organization is asks who may change it", () => {
  it("each onboarding/persona write route asks mayChangeOrganizationType, or is listed with its reason", () => {
    const all = units().filter((u) => !u.key.startsWith("DELETE"));
    // Vacuity: /complete, /skip, /step-entered, /path-selected, /progress,
    // /step, /complete-step, /provision, /tips, /reset, /sample-data, persona.
    expect(all.length).toBeGreaterThanOrEqual(12);
    const unasked = all
      .filter((u) => !(u.key in NO_ORG_LEVEL_KEYS))
      .filter((u) => !/mayChangeOrganizationType\(/.test(u.body))
      .map((u) => u.key);
    expect(unasked, unasked.join("\n")).toEqual([]);
  });

  it("the exemption list names only routes that exist, and none that asks anyway", () => {
    const keys = new Map(units().map((u) => [u.key, u.body]));
    for (const k of Object.keys(NO_ORG_LEVEL_KEYS)) {
      expect(keys.has(k), `${k} no longer exists — drop it from the list`).toBe(true);
      expect(keys.get(k)).not.toMatch(/businessType|investorType|noteRole|orgName/);
    }
  });
});
