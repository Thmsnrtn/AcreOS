import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the database modules before importing the injector
vi.mock("../../server/storage", () => ({
  storage: {},
}));

vi.mock("../../server/db", () => {
  const mockSelect = vi.fn();
  const mockFrom = vi.fn();
  const mockWhere = vi.fn();
  const mockOrderBy = vi.fn();
  const mockLimit = vi.fn();

  // Chain builder: db.select().from().where().orderBy().limit() → results
  const createChain = (results: any[] = []) => {
    mockLimit.mockResolvedValue(results);
    mockOrderBy.mockReturnValue({ limit: mockLimit });
    mockWhere.mockReturnValue({ orderBy: mockOrderBy, limit: mockLimit });
    mockFrom.mockReturnValue({ where: mockWhere, orderBy: mockOrderBy, limit: mockLimit });
    mockSelect.mockReturnValue({ from: mockFrom });
    return { select: mockSelect, from: mockFrom, where: mockWhere, orderBy: mockOrderBy, limit: mockLimit };
  };

  const chain = createChain();
  return {
    db: {
      select: chain.select,
    },
    __mockChain: chain,
    __createChain: createChain,
  };
});

describe("Atlas Context Injector", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("builds context block with org business data", async () => {
    const { db } = await import("../../server/db");
    const mockSelect = vi.mocked(db.select);

    // Set up mock to return different data for each call
    let callCount = 0;
    mockSelect.mockImplementation(() => {
      callCount++;
      const mockChain = {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue(
                callCount === 1
                  ? [
                      // Active deals
                      {
                        id: 1,
                        stage: "negotiating",
                        amount: "50000",
                        updatedAt: new Date(),
                        propertyId: 1,
                      },
                      {
                        id: 2,
                        stage: "offer_sent",
                        amount: "75000",
                        updatedAt: new Date(),
                        propertyId: 2,
                      },
                    ]
                  : callCount === 2
                  ? [
                      // Follow-up leads
                      { id: 1, firstName: "John", lastName: "Doe", lastContactedAt: null },
                    ]
                  : callCount === 3
                  ? [
                      // Expiring offers
                      { id: 1, title: "Corner lot deal", offerSentAt: new Date() },
                    ]
                  : callCount === 4
                  ? [
                      // Notes receivable
                      {
                        id: 1,
                        borrowerName: "Jane Smith",
                        currentBalance: "50000",
                        monthlyPayment: "500",
                        nextPaymentDate: new Date(),
                      },
                      {
                        id: 2,
                        borrowerName: "Bob Jones",
                        currentBalance: "75000",
                        monthlyPayment: "800",
                        nextPaymentDate: new Date(),
                      },
                      {
                        id: 3,
                        borrowerName: "Alice Brown",
                        currentBalance: "25000",
                        monthlyPayment: "300",
                        nextPaymentDate: new Date(),
                      },
                    ]
                  : []
              ),
            }),
            limit: vi.fn().mockResolvedValue([]),
          }),
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
          limit: vi.fn().mockResolvedValue([]),
        }),
      };
      return mockChain as any;
    });

    const { buildAtlasContextBlock } = await import(
      "../../server/services/atlasContextInjector"
    );

    const result = await buildAtlasContextBlock(1, "user-1");

    expect(result).toBeDefined();
    expect(result.orgId).toBe(1);
    expect(result.text).toBeDefined();
    expect(typeof result.text).toBe("string");
    expect(result.generatedAt).toBeInstanceOf(Date);
  });

  it("returns a valid context block even with empty data", async () => {
    const { db } = await import("../../server/db");
    vi.mocked(db.select).mockImplementation(() => {
      const mockChain = {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([]),
            }),
            limit: vi.fn().mockResolvedValue([]),
          }),
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
          limit: vi.fn().mockResolvedValue([]),
        }),
      };
      return mockChain as any;
    });

    const { buildAtlasContextBlock } = await import(
      "../../server/services/atlasContextInjector"
    );

    const result = await buildAtlasContextBlock(999);

    expect(result).toBeDefined();
    expect(result.orgId).toBe(999);
    expect(typeof result.text).toBe("string");
  });

  it("handles database errors gracefully", async () => {
    const { db } = await import("../../server/db");
    vi.mocked(db.select).mockImplementation(() => {
      throw new Error("Database connection failed");
    });

    const { buildAtlasContextBlock } = await import(
      "../../server/services/atlasContextInjector"
    );

    // Should not throw — context injection should be non-fatal
    const result = await buildAtlasContextBlock(1);
    expect(result).toBeDefined();
    expect(result.orgId).toBe(1);
  });
});
