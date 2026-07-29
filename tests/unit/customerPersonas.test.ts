import { describe, it, expect } from "vitest";
import {
  CUSTOMER_PERSONAS,
  DOOR_ROUTES,
  type Device,
} from "../../tests/personas/customer-personas";
import { BUSINESS_TYPE_IDS, BUSINESS_TYPES } from "../../shared/business-types";
import {
  derivePersona,
  BUSINESS_TYPE_TO_INVESTOR_TYPE,
} from "../../shared/models/persona-mapping";
import {
  resolveTestUserId,
  personaCookieValue,
  personaTestUserId,
  E2E_TEST_USER_ID,
  E2E_FOUNDER_USER_ID,
  E2E_FOUNDER_COOKIE,
} from "../../server/auth/testAuth";

const VALID_DEVICES: Device[] = [
  "iphone-14", "iphone-se", "pixel-5", "galaxy-s9", "tiny-phone",
  "ipad-portrait", "ipad-landscape", "ipad-pro",
  "desktop-chrome", "desktop-1280", "desktop-ultrawide", "short-wide",
];

describe("customer persona catalog", () => {
  it("has exactly 30 personas with unique slugs", () => {
    expect(CUSTOMER_PERSONAS).toHaveLength(30);
    const slugs = CUSTOMER_PERSONAS.map((p) => p.slug);
    expect(new Set(slugs).size).toBe(30);
  });

  it("uses only kebab-case slugs (safe for the e2e-persona cookie)", () => {
    for (const p of CUSTOMER_PERSONAS) {
      expect(p.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  it("covers every one of the 15 canonical business types", () => {
    const covered = new Set(CUSTOMER_PERSONAS.map((p) => p.businessType));
    for (const bt of BUSINESS_TYPE_IDS) {
      expect(covered.has(bt)).toBe(true);
    }
  });

  it("covers all three note roles + the hybrid 'both' fork", () => {
    const roles = new Set(
      CUSTOMER_PERSONAS.filter((p) => p.noteRole).map((p) => p.noteRole),
    );
    expect(roles).toEqual(new Set(["invest", "originate", "service"]));
    expect(CUSTOMER_PERSONAS.some((p) => p.investorType === "both")).toBe(true);
  });

  it("spans every experience level and the full device matrix", () => {
    const exp = new Set(CUSTOMER_PERSONAS.map((p) => p.experience));
    expect(exp).toEqual(
      new Set(["brand_new", "returning_beginner", "intermediate", "power_user", "skeptic"]),
    );
    const devices = new Set(CUSTOMER_PERSONAS.map((p) => p.device));
    for (const d of VALID_DEVICES) expect(devices.has(d)).toBe(true);
  });

  it("derives persona + investorType consistently with the product (no drift)", () => {
    for (const p of CUSTOMER_PERSONAS) {
      expect(p.investorType).toBe(BUSINESS_TYPE_TO_INVESTOR_TYPE[p.businessType]);
      expect(p.persona).toBe(
        derivePersona(p.businessType, p.investorType, p.noteRole ?? "invest"),
      );
    }
  });

  it("never lists a module as both visible and hidden for the same persona", () => {
    for (const p of CUSTOMER_PERSONAS) {
      const visible = new Set(p.expect.modulesVisible);
      for (const hidden of p.expect.modulesHidden) {
        expect(visible.has(hidden)).toBe(false);
      }
    }
  });

  // 2026-07-29 (ruling #11 waves V1/V2): "Lena — buy-and-hold rentals
  // (waitlist)" sat stale in this catalog after the registry promoted
  // buy_and_hold to beta. Pin the display-name maturity tags to the
  // registry so a maturity flip forces the catalog row to update too.
  it("display-name maturity tags never contradict the registry", () => {
    for (const p of CUSTOMER_PERSONAS) {
      const maturity = BUSINESS_TYPES[p.businessType].maturity;
      if (p.displayName.includes("(waitlist)")) {
        expect(maturity, `${p.slug} is labeled (waitlist) but registry says ${maturity}`).toBe("roadmap");
      }
      if (p.displayName.includes("(beta)")) {
        expect(maturity, `${p.slug} is labeled (beta) but registry says ${maturity}`).toBe("beta");
      }
    }
  });

  it("only references real door routes in vocab expectations", () => {
    const doors = new Set(Object.keys(DOOR_ROUTES));
    for (const p of CUSTOMER_PERSONAS) {
      for (const door of Object.keys(p.expect.vocab)) {
        expect(doors.has(door)).toBe(true);
      }
    }
  });
});

describe("per-persona test-auth isolation (server bypass)", () => {
  it("resolves a distinct, sanitized user id per persona slug", () => {
    const ids = new Set<string>();
    for (const p of CUSTOMER_PERSONAS) {
      const cookie = `__session=${personaCookieValue(p.slug)}`;
      const id = resolveTestUserId(cookie);
      expect(id).toBe(personaTestUserId(p.slug));
      expect(id).toMatch(/^e2e_persona_[a-z0-9_]+$/);
      ids.add(id);
    }
    // 30 distinct slugs → 30 distinct orgs.
    expect(ids.size).toBe(30);
  });

  it("still honors the founder + default identities", () => {
    expect(resolveTestUserId(`__session=${E2E_FOUNDER_COOKIE}`)).toBe(E2E_FOUNDER_USER_ID);
    expect(resolveTestUserId("__session=e2e")).toBe(E2E_TEST_USER_ID);
    expect(resolveTestUserId(undefined)).toBe(E2E_TEST_USER_ID);
  });

  it("sanitizes a hostile persona cookie to a safe id (no injection)", () => {
    expect(resolveTestUserId("__session=e2e-persona-../../etc/passwd")).toBe("e2e_persona_etc_passwd");
    expect(resolveTestUserId("__session=e2e-persona-")).toBe(E2E_TEST_USER_ID);
  });
});
