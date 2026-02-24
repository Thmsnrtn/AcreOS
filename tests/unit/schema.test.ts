import { describe, it, expect } from "vitest";
import { z } from "zod";

/**
 * Tests for auth validation schemas.
 * These mirror the schemas defined in server/auth/routes.ts
 * (which are not exported, so we re-define them here for unit testing).
 */

const registerSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
});

const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
});

// ─── Registration Schema ─────────────────────────────────
describe("registerSchema", () => {
  it("accepts valid registration data", () => {
    const result = registerSchema.safeParse({
      email: "user@example.com",
      password: "securepass123",
      firstName: "John",
      lastName: "Doe",
    });
    expect(result.success).toBe(true);
  });

  it("accepts registration without optional fields", () => {
    const result = registerSchema.safeParse({
      email: "user@example.com",
      password: "securepass123",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid email", () => {
    const result = registerSchema.safeParse({
      email: "not-an-email",
      password: "securepass123",
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toBe("Invalid email address");
  });

  it("rejects short password", () => {
    const result = registerSchema.safeParse({
      email: "user@example.com",
      password: "short",
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toContain("at least 8 characters");
  });

  it("rejects empty email", () => {
    const result = registerSchema.safeParse({
      email: "",
      password: "securepass123",
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing fields", () => {
    const result = registerSchema.safeParse({});
    expect(result.success).toBe(false);
    expect(result.error?.issues.length).toBeGreaterThanOrEqual(2);
  });
});

// ─── Login Schema ────────────────────────────────────────
describe("loginSchema", () => {
  it("accepts valid login data", () => {
    const result = loginSchema.safeParse({
      email: "user@example.com",
      password: "securepass123",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid email", () => {
    const result = loginSchema.safeParse({
      email: "nope",
      password: "pass",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty password", () => {
    const result = loginSchema.safeParse({
      email: "user@example.com",
      password: "",
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toContain("Password is required");
  });

  it("rejects missing body entirely", () => {
    const result = loginSchema.safeParse(undefined);
    expect(result.success).toBe(false);
  });
});

// ─── Subscription Tier Constants ─────────────────────────
describe("subscription tier validation", () => {
  const validTiers = ["free", "starter", "pro", "scale", "enterprise"];
  const tierSchema = z.enum(["free", "starter", "pro", "scale", "enterprise"]);

  it("accepts all valid tier values", () => {
    for (const tier of validTiers) {
      expect(tierSchema.safeParse(tier).success).toBe(true);
    }
  });

  it("rejects invalid tier values", () => {
    expect(tierSchema.safeParse("premium").success).toBe(false);
    expect(tierSchema.safeParse("").success).toBe(false);
    expect(tierSchema.safeParse(null).success).toBe(false);
  });
});

// ─── Credit Balance Validation ───────────────────────────
describe("credit balance validation", () => {
  const creditSchema = z.coerce.number().min(0, "Credits cannot be negative");

  it("accepts positive numeric strings (matches DB numeric type)", () => {
    expect(creditSchema.safeParse("2500").success).toBe(true);
    expect(creditSchema.parse("2500")).toBe(2500);
  });

  it("accepts zero", () => {
    expect(creditSchema.safeParse("0").success).toBe(true);
  });

  it("rejects negative values", () => {
    expect(creditSchema.safeParse("-100").success).toBe(false);
  });
});
