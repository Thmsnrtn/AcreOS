import { describe, it, expect } from "vitest";
import { z } from "zod";

// ─── Phone Number Formatting ─────────────────────────────
// Mirrors the formatPhoneNumber helper in leads.tsx
const formatPhoneNumber = (phone: string): string => {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  if (digits.length === 11 && digits.startsWith("1")) {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  return phone;
};

describe("formatPhoneNumber", () => {
  it("formats 10-digit numbers", () => {
    expect(formatPhoneNumber("5551234567")).toBe("(555) 123-4567");
  });

  it("formats 11-digit numbers starting with 1", () => {
    expect(formatPhoneNumber("15551234567")).toBe("(555) 123-4567");
  });

  it("strips non-digit characters before formatting", () => {
    expect(formatPhoneNumber("(555) 123-4567")).toBe("(555) 123-4567");
    expect(formatPhoneNumber("555-123-4567")).toBe("(555) 123-4567");
    expect(formatPhoneNumber("555.123.4567")).toBe("(555) 123-4567");
  });

  it("returns original for invalid lengths", () => {
    expect(formatPhoneNumber("12345")).toBe("12345");
    expect(formatPhoneNumber("123456789012")).toBe("123456789012");
  });

  it("handles empty string", () => {
    expect(formatPhoneNumber("")).toBe("");
  });
});

// ─── Lead Form Schema Validation ─────────────────────────
// Mirrors the schema in leads.tsx
const leadFormSchema = z.object({
  firstName: z.string().min(1, "First name is required").max(100, "First name is too long"),
  lastName: z.string().min(1, "Last name is required").max(100, "Last name is too long"),
  email: z
    .string()
    .optional()
    .refine(
      (val) => !val || /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(val),
      { message: "Please enter a valid email address (e.g., name@example.com)" }
    ),
  phone: z
    .string()
    .optional()
    .transform((val) => (val ? formatPhoneNumber(val) : val))
    .refine(
      (val) => {
        if (!val) return true;
        const digits = val.replace(/\D/g, "");
        return digits.length === 10 || (digits.length === 11 && digits.startsWith("1"));
      },
      { message: "Please enter a valid 10-digit US phone number" }
    ),
  status: z.string().min(1, "Status is required"),
});

describe("leadFormSchema", () => {
  it("accepts valid lead data", () => {
    const result = leadFormSchema.safeParse({
      firstName: "John",
      lastName: "Doe",
      email: "john@example.com",
      phone: "5551234567",
      status: "new",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.phone).toBe("(555) 123-4567");
    }
  });

  it("accepts lead without optional fields", () => {
    const result = leadFormSchema.safeParse({
      firstName: "Jane",
      lastName: "Smith",
      status: "contacting",
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty first name", () => {
    const result = leadFormSchema.safeParse({
      firstName: "",
      lastName: "Doe",
      status: "new",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty last name", () => {
    const result = leadFormSchema.safeParse({
      firstName: "John",
      lastName: "",
      status: "new",
    });
    expect(result.success).toBe(false);
  });

  it("rejects first name over 100 chars", () => {
    const result = leadFormSchema.safeParse({
      firstName: "A".repeat(101),
      lastName: "Doe",
      status: "new",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid email format", () => {
    const result = leadFormSchema.safeParse({
      firstName: "John",
      lastName: "Doe",
      email: "not-valid",
      status: "new",
    });
    expect(result.success).toBe(false);
  });

  it("accepts empty email (optional)", () => {
    const result = leadFormSchema.safeParse({
      firstName: "John",
      lastName: "Doe",
      email: "",
      status: "new",
    });
    // Empty string passes because refine checks !val first
    expect(result.success).toBe(true);
  });

  it("rejects invalid phone number length", () => {
    const result = leadFormSchema.safeParse({
      firstName: "John",
      lastName: "Doe",
      phone: "12345",
      status: "new",
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing status", () => {
    const result = leadFormSchema.safeParse({
      firstName: "John",
      lastName: "Doe",
      status: "",
    });
    expect(result.success).toBe(false);
  });
});

// ─── Currency Formatting ─────────────────────────────────
// Mirrors the formatCurrency in listings.tsx
const formatCurrency = (value: string | number | null | undefined) => {
  if (!value) return "$0";
  const num = typeof value === "string" ? parseFloat(value) : value;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(num);
};

describe("formatCurrency", () => {
  it("formats positive numbers", () => {
    expect(formatCurrency(10000)).toBe("$10,000");
    expect(formatCurrency(1500000)).toBe("$1,500,000");
  });

  it("formats string values", () => {
    expect(formatCurrency("25000")).toBe("$25,000");
  });

  it("returns $0 for null/undefined", () => {
    expect(formatCurrency(null)).toBe("$0");
    expect(formatCurrency(undefined)).toBe("$0");
  });

  it("returns $0 for zero", () => {
    expect(formatCurrency(0)).toBe("$0");
  });

  it("formats small amounts without decimals", () => {
    expect(formatCurrency(99)).toBe("$99");
  });
});

// ─── Lead Score Normalization ─────────────────────────────
// Mirrors normalizeRawScore in leads.tsx
function normalizeRawScore(rawScore: number): number {
  return Math.round((rawScore + 400) / 8);
}

describe("normalizeRawScore", () => {
  it("normalizes 0 raw score to 50", () => {
    expect(normalizeRawScore(0)).toBe(50);
  });

  it("normalizes -400 to 0", () => {
    expect(normalizeRawScore(-400)).toBe(0);
  });

  it("normalizes 400 to 100", () => {
    expect(normalizeRawScore(400)).toBe(100);
  });

  it("handles intermediate values", () => {
    expect(normalizeRawScore(200)).toBe(75);
    expect(normalizeRawScore(-200)).toBe(25);
  });
});

// ─── Rate Limit Config Constants ─────────────────────────
describe("RATE_LIMIT_CONFIGS", () => {
  let RATE_LIMIT_CONFIGS: any;

  beforeAll(async () => {
    const mod = await import("../../server/middleware/rateLimit");
    RATE_LIMIT_CONFIGS = mod.RATE_LIMIT_CONFIGS;
  });

  it("defines sensible defaults", () => {
    expect(RATE_LIMIT_CONFIGS.default.maxRequests).toBeGreaterThanOrEqual(50);
    expect(RATE_LIMIT_CONFIGS.auth.maxRequests).toBeLessThanOrEqual(20);
  });

  it("auth limit is stricter than default", () => {
    expect(RATE_LIMIT_CONFIGS.auth.maxRequests).toBeLessThan(RATE_LIMIT_CONFIGS.default.maxRequests);
  });

  it("all configs have positive windowMs", () => {
    for (const config of Object.values(RATE_LIMIT_CONFIGS) as any[]) {
      expect(config.windowMs).toBeGreaterThan(0);
      expect(config.maxRequests).toBeGreaterThan(0);
    }
  });
});
