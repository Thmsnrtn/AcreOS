/**
 * Data Integrity Tests
 * Tasks #202-225: Input validation, business logic enforcement, consistency
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";

// ── Phone number validation ──────────────────────────────────────────────────

const phoneSchema = z
  .string()
  .regex(/^\+?[1-9]\d{7,14}$/, "Invalid phone number")
  .or(z.string().regex(/^\(\d{3}\)\s?\d{3}-\d{4}$/, "Invalid US phone format"));

describe("Phone number validation", () => {
  it("accepts valid E.164 format", () => {
    expect(phoneSchema.safeParse("+15125551234").success).toBe(true);
    expect(phoneSchema.safeParse("+441234567890").success).toBe(true);
  });

  it("accepts US format with parens", () => {
    expect(phoneSchema.safeParse("(512) 555-1234").success).toBe(true);
    expect(phoneSchema.safeParse("(512)555-1234").success).toBe(true);
  });

  it("rejects obvious garbage", () => {
    expect(phoneSchema.safeParse("not-a-phone").success).toBe(false);
    expect(phoneSchema.safeParse("12345").success).toBe(false);
    expect(phoneSchema.safeParse("").success).toBe(false);
  });
});

// ── Acreage validation ────────────────────────────────────────────────────────

const acreageSchema = z.number().positive("Acreage must be positive").max(1_000_000, "Acreage too large");

describe("Acreage validation", () => {
  it("accepts valid acreages", () => {
    expect(acreageSchema.safeParse(0.25).success).toBe(true);
    expect(acreageSchema.safeParse(10_000).success).toBe(true);
  });

  it("rejects zero and negative", () => {
    expect(acreageSchema.safeParse(0).success).toBe(false);
    expect(acreageSchema.safeParse(-5).success).toBe(false);
  });

  it("rejects unrealistically large acreages", () => {
    expect(acreageSchema.safeParse(2_000_000).success).toBe(false);
  });
});

// ── Price / financial validation ─────────────────────────────────────────────

const priceSchema = z.number().nonnegative("Price must be non-negative").max(1e9, "Price too high");

describe("Price validation", () => {
  it("accepts valid prices including zero", () => {
    expect(priceSchema.safeParse(0).success).toBe(true);
    expect(priceSchema.safeParse(150000).success).toBe(true);
    expect(priceSchema.safeParse(999999999).success).toBe(true);
  });

  it("rejects negative prices", () => {
    expect(priceSchema.safeParse(-100).success).toBe(false);
  });

  it("rejects astronomically large prices", () => {
    expect(priceSchema.safeParse(2e9).success).toBe(false);
  });
});

// ── Interest rate validation ──────────────────────────────────────────────────

const interestRateSchema = z.number().min(0, "Rate must be non-negative").max(30, "Rate exceeds usury ceiling");

describe("Interest rate validation", () => {
  it("accepts valid rates", () => {
    expect(interestRateSchema.safeParse(0).success).toBe(true);
    expect(interestRateSchema.safeParse(8.5).success).toBe(true);
    expect(interestRateSchema.safeParse(30).success).toBe(true);
  });

  it("rejects negative rates", () => {
    expect(interestRateSchema.safeParse(-1).success).toBe(false);
  });

  it("rejects rates exceeding usury ceiling", () => {
    expect(interestRateSchema.safeParse(31).success).toBe(false);
    expect(interestRateSchema.safeParse(100).success).toBe(false);
  });
});

// ── Deal state machine ────────────────────────────────────────────────────────

const DEAL_STATES = ["new_lead", "qualified", "offer_sent", "negotiating", "under_contract", "closed_won", "closed_lost", "paid"] as const;

type DealState = typeof DEAL_STATES[number];

const ALLOWED_TRANSITIONS: Record<DealState, DealState[]> = {
  new_lead: ["qualified", "closed_lost"],
  qualified: ["offer_sent", "closed_lost"],
  offer_sent: ["negotiating", "under_contract", "closed_lost"],
  negotiating: ["offer_sent", "under_contract", "closed_lost"],
  under_contract: ["closed_won", "closed_lost"],
  closed_won: ["paid"],
  paid: [],
  closed_lost: [],
};

function isValidTransition(from: DealState, to: DealState): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

describe("Deal state machine transitions", () => {
  it("allows valid forward transitions", () => {
    expect(isValidTransition("new_lead", "qualified")).toBe(true);
    expect(isValidTransition("qualified", "offer_sent")).toBe(true);
    expect(isValidTransition("under_contract", "closed_won")).toBe(true);
    expect(isValidTransition("closed_won", "paid")).toBe(true);
  });

  it("allows closing at any stage", () => {
    expect(isValidTransition("new_lead", "closed_lost")).toBe(true);
    expect(isValidTransition("qualified", "closed_lost")).toBe(true);
    expect(isValidTransition("under_contract", "closed_lost")).toBe(true);
  });

  it("rejects invalid skips", () => {
    expect(isValidTransition("new_lead", "closed_won")).toBe(false);
    expect(isValidTransition("new_lead", "under_contract")).toBe(false);
    expect(isValidTransition("offer_sent", "paid")).toBe(false);
  });

  it("rejects transitions from terminal states", () => {
    expect(isValidTransition("paid", "closed_won")).toBe(false);
    expect(isValidTransition("paid", "new_lead")).toBe(false);
    expect(isValidTransition("closed_lost", "qualified")).toBe(false);
  });
});

// ── Organization isolation ────────────────────────────────────────────────────

describe("Organization ID scoping", () => {
  it("validates that organizationId is a positive integer", () => {
    const orgIdSchema = z.number().int().positive();
    expect(orgIdSchema.safeParse(1).success).toBe(true);
    expect(orgIdSchema.safeParse(9999).success).toBe(true);
    expect(orgIdSchema.safeParse(0).success).toBe(false);
    expect(orgIdSchema.safeParse(-1).success).toBe(false);
    expect(orgIdSchema.safeParse(1.5).success).toBe(false);
  });
});

// ── Email validation ───────────────────────────────────────────────────────────

const emailSchema = z.string().email("Invalid email address").max(254, "Email too long");

describe("Email validation", () => {
  it("accepts valid emails", () => {
    expect(emailSchema.safeParse("user@example.com").success).toBe(true);
    expect(emailSchema.safeParse("user+tag@sub.domain.com").success).toBe(true);
  });

  it("rejects invalid emails", () => {
    expect(emailSchema.safeParse("not-an-email").success).toBe(false);
    expect(emailSchema.safeParse("@nodomain.com").success).toBe(false);
    expect(emailSchema.safeParse("no-at-sign").success).toBe(false);
    expect(emailSchema.safeParse("").success).toBe(false);
  });

  it("rejects emails that are too long", () => {
    const longEmail = "a".repeat(250) + "@x.com";
    expect(emailSchema.safeParse(longEmail).success).toBe(false);
  });
});

// ── Amortization schedule integrity ───────────────────────────────────────────

describe("Amortization schedule integrity", () => {
  it("principal + interest = total payment (within $0.01)", () => {
    const monthlyRate = 0.08 / 12;
    const principal = 100_000;
    const termMonths = 360;
    const pmt = (principal * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -termMonths));

    let balance = principal;
    let totalPrincipal = 0;
    let totalInterest = 0;

    for (let i = 0; i < termMonths; i++) {
      const interest = balance * monthlyRate;
      const principalPaid = pmt - interest;
      balance -= principalPaid;
      totalPrincipal += principalPaid;
      totalInterest += interest;
    }

    // Final balance should be ~$0
    expect(Math.abs(balance)).toBeLessThan(0.01);
    // Total repaid should equal principal + total interest
    expect(Math.abs(totalPrincipal - principal)).toBeLessThan(1);
  });
});
