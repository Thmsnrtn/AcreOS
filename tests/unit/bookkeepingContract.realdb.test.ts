/**
 * The server's ACTUAL annual-report response parses with the shared contract
 * the bookkeeping page consumes — and carries DOLLARS, converted once.
 *
 * Seeds a note with three completed payments whose interest sums to an exact
 * cents figure ($100.10 + $200.20 + $934.26 = $1,234.56), runs the real route
 * handler over the real service and database, and checks the payload against
 * `annualInterestReportResponseSchema` and against the exact dollar values. A
 * payload still in cents (123456) or divided twice (12.3456) fails here.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { useRealDb, realDbAvailable } from "../helpers/realDb";

useRealDb("bookkeepingContract.realdb.test.ts");

vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const tag = `bkc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const ids = { org: 0, lead: 0, note: 0 };
const YEAR = 2025;

describe.runIf(realDbAvailable)("bookkeeping annual report contract (real database)", () => {
  vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

  beforeAll(async () => {
    const { db } = await import("../../server/db");
    const { organizations, leads, notes, payments } = await import("@shared/schema");
    const [org] = await db.insert(organizations).values({ name: tag, slug: tag, ownerId: `${tag}-o` } as any).returning();
    ids.org = org.id;
    const [lead] = await db
      .insert(leads)
      .values({
        organizationId: org.id,
        firstName: "Ada",
        lastName: "Lovelace",
        email: `${tag}@example.com`,
        // PII the 1099 path reads server-side and no client renders.
        address: "12 Analytical Way",
        city: "Austin",
        state: "TX",
        zip: "78701",
        taxId: "v1:test-ciphertext-not-a-real-tin",
        taxIdType: "SSN",
      } as any)
      .returning();
    ids.lead = lead.id;
    const [note] = await db
      .insert(notes)
      .values({
        organizationId: org.id,
        borrowerId: lead.id,
        originalPrincipal: "50000.00",
        currentBalance: "40000.00",
        interestRate: "9.5",
        termMonths: 120,
        monthlyPayment: "650.00",
        startDate: new Date("2024-01-01T00:00:00Z"),
        firstPaymentDate: new Date("2024-02-01T00:00:00Z"),
        // Not "active": an active note must carry an ATR determination
        // (notes_atr_origination_gate), which is not what this test is about.
        status: "paid_off",
      } as any)
      .returning();
    ids.note = note.id;
    const pay = (month: number, interest: string, principal: string, lateFee: string) => ({
      organizationId: org.id,
      noteId: note.id,
      amount: (Number(interest) + Number(principal) + Number(lateFee)).toFixed(2),
      interestAmount: interest,
      principalAmount: principal,
      lateFeeAmount: lateFee,
      paymentDate: new Date(Date.UTC(YEAR, month, 15)),
      dueDate: new Date(Date.UTC(YEAR, month, 1)),
      status: "completed",
    });
    await db.insert(payments).values([
      pay(2, "100.10", "3000.00", "0"),
      pay(5, "200.20", "3000.00", "25.50"),
      pay(8, "934.26", "4000.00", "0"),
    ] as any);
  });

  afterAll(async () => {
    if (!ids.org) return;
    const { db } = await import("../../server/db");
    const { sql } = await import("drizzle-orm");
    await db.execute(sql`DELETE FROM payments WHERE organization_id = ${ids.org}`);
    await db.execute(sql`DELETE FROM notes WHERE organization_id = ${ids.org}`);
    await db.execute(sql`DELETE FROM leads WHERE organization_id = ${ids.org}`);
    await db.execute(sql`DELETE FROM organizations WHERE id = ${ids.org}`);
  });

  it("the route's payload parses with the contract and holds exact dollars", async () => {
    const annualInterestReportResponseSchema = (await import("@shared/contracts")).annualInterestReportContract.responseSchema;
    const router = (await import("../../server/routes-bookkeeping")).default as any;
    const layer = router.stack.find((l: any) => l.route?.path === "/annual-report" && l.route.methods.get);
    expect(layer, "GET /annual-report is not on the bookkeeping router").toBeDefined();
    const handle = layer.route.stack[layer.route.stack.length - 1].handle;

    const out: any = { statusCode: 200, body: undefined };
    out.status = (c: number) => ((out.statusCode = c), out);
    out.json = (b: unknown) => ((out.body = b), out);
    await handle({ organization: { id: ids.org }, query: { year: String(YEAR) } }, out);

    expect(out.statusCode).toBe(200);
    const parsed = annualInterestReportResponseSchema.safeParse(out.body);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    expect(out.body).toMatchObject({
      taxYear: YEAR,
      totalInterestIncome: 1234.56,
      totalPrincipalReceived: 10000,
      totalLateFeesCollected: 25.5,
      notesWith1099Required: 1,
    });
    expect(out.body.notes).toHaveLength(1);
    expect(out.body.notes[0]).toEqual({
      noteId: ids.note,
      borrowerName: "Ada Lovelace",
      interestCollected: 1234.56,
      principalCollected: 10000,
      requires1099: true,
    });
  });

  it("carries no tax-ID, ciphertext, email or address — though the report it is built from does", async () => {
    // VACUITY: the server-side report really holds the PII (the 1099 path reads it).
    const { generateAnnualInterestReport } = await import("../../server/services/bookkeeping");
    const source = await generateAnnualInterestReport(ids.org, YEAR);
    expect(source.notes[0].borrowerTaxIdCiphertext).toBe("v1:test-ciphertext-not-a-real-tin");
    expect(source.notes[0].borrowerAddress?.street).toBe("12 Analytical Way");

    const router = (await import("../../server/routes-bookkeeping")).default as any;
    const layer = router.stack.find((l: any) => l.route?.path === "/annual-report" && l.route.methods.get);
    const handle = layer.route.stack[layer.route.stack.length - 1].handle;
    const out: any = { statusCode: 200, body: undefined };
    out.status = (c: number) => ((out.statusCode = c), out);
    out.json = (b: unknown) => ((out.body = b), out);
    await handle({ organization: { id: ids.org }, query: { year: String(YEAR) } }, out);

    const keys: string[] = [];
    const walk = (v: unknown) => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) (keys.push(k), walk(x));
    };
    walk(out.body);
    expect(keys.length).toBeGreaterThan(5);
    // camelCase-aware: `tin` as a word (tin, recipientTin, tinType), not the
    // letters inside "totalInterestIncome".
    const PII_KEY = (k: string) => /^tin/i.test(k) || /Tin(?![a-z])/.test(k) || /tax_?id|ciphertext|address|email/i.test(k);
    expect(PII_KEY("recipientTin") && PII_KEY("borrowerTaxIdCiphertext") && PII_KEY("tin") && !PII_KEY("totalInterestIncome")).toBe(true);
    expect(keys.filter(PII_KEY)).toEqual([]);
    // And no VALUE leaked under an innocent key.
    const text = JSON.stringify(out.body);
    expect(text).not.toContain("v1:test-ciphertext");
    expect(text).not.toContain("Analytical Way");
    expect(text).not.toContain(`${tag}@example.com`);
  });
});
