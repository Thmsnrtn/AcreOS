/**
 * The support agent serves team rows as the roster serves them.
 *
 * `query_user_data` with entity "team_members" reads `team_members` rows and
 * hands them to a model that is talking to one member of the organization.
 * GET /api/team serves that member the roster view (`toTeamMemberView`):
 * six columns, and teammates' email addresses only for owner, admin and
 * member. This drives the real `executeSupportTool` switch — the database and
 * the team-member lookup are faked, the role resolution is the real one — and
 * asserts what the tool returns, per caller role and per query shape.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const ORG_ID = 7;

const H = vi.hoisted(() => {
  const roster = [
    { id: 1, organizationId: 7, userId: "u-owner", email: "owner@example.com", displayName: "Olive", role: "owner", permissions: ["*"], viewOnlyAssignedLeads: false, isActive: true, invitedAt: new Date(0), joinedAt: new Date(0) },
    { id: 2, organizationId: 7, userId: "u-member", email: "member@example.com", displayName: "Mo", role: "member", permissions: [], viewOnlyAssignedLeads: false, isActive: true, invitedAt: new Date(0), joinedAt: new Date(0) },
    { id: 3, organizationId: 7, userId: "u-va", email: "va@example.com", displayName: "Val", role: "va", permissions: [], viewOnlyAssignedLeads: true, isActive: true, invitedAt: new Date(0), joinedAt: new Date(0) },
    { id: 4, organizationId: 7, userId: "u-viewer", email: "viewer@example.com", displayName: "Vic", role: "viewer", permissions: [], viewOnlyAssignedLeads: false, isActive: true, invitedAt: new Date(0), joinedAt: new Date(0) },
  ];
  const selectQueue: unknown[][] = [];
  const chain = (result: () => unknown) => {
    const proxy: any = new Proxy(function () {} as unknown as object, {
      get(_t, prop) {
        if (prop === "then") {
          return (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(result()).then(res, rej);
        }
        return () => proxy;
      },
    });
    return proxy;
  };
  return {
    roster,
    selectQueue,
    db: {
      select: () => chain(() => selectQueue.shift() ?? []),
      insert: () => chain(() => []),
      update: () => chain(() => []),
    },
  };
});

vi.mock("../../server/db", () => ({ db: H.db }));
vi.mock("../../server/storage", () => ({
  storage: {
    logActivity: vi.fn(),
    getTeamMember: vi.fn(async (_orgId: number, userId: string) => H.roster.find((m) => m.userId === userId)),
  },
  db: {},
}));
vi.mock("../../server/services/paxControls", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/services/paxControls")>();
  return { ...actual, getPaxControls: vi.fn(async () => { throw new Error("query_user_data is read-only; the controls are not read"); }) };
});
vi.mock("../../server/services/paxReceipts", () => ({ recordPaxEffect: vi.fn(async () => ({ written: true })) }));
vi.mock("../../server/websocket", () => ({ wsServer: { broadcastToOrg: vi.fn() } }));
vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("openai", () => ({ default: class {} }));
vi.mock("stripe", () => ({ default: class {} }));
vi.mock("../../server/stripeClient", () => ({ subscriptionPeriodIso: vi.fn(), STRIPE_API_VERSION: "2024-06-20" }));
vi.mock("../../server/services/decisionsInbox", () => ({ decisionsInboxService: {} }));
vi.mock("../../server/services/data-source-broker.js", () => ({ dataSourceBroker: {} }));
vi.mock("../../server/services/propertyEnrichment.js", () => ({ propertyEnrichmentService: {} }));
vi.mock("../../server/services/complianceValidator", () => ({ validateCompliance: vi.fn() }));
vi.mock("../../server/services/aiSpendGuard", () => ({ assertAiSpendAllowed: vi.fn(), recordExternalAiSpend: vi.fn(), meteredChatCompletion: (c: any, p: any, _m: unknown, o?: unknown) => c.chat.completions.create(p, o) }));

const { executeSupportTool } = await import("../../server/ai/supportAgent");

const org = { id: ORG_ID, name: "Test Org", ownerId: "u-owner" } as any;

/**
 * The roster keys, written out here independently of shared/accountViews.ts:
 * what the roster surfaces read (settings role editor, lead assignment, team
 * chat). Nothing else on the row — permissions, the assigned-leads flag,
 * invitation dates, the tenant key — is served.
 */
const ROSTER_KEYS = ["displayName", "email", "id", "isActive", "role", "userId"];

async function query(queryType: string, filters: Record<string, unknown>, options: Record<string, unknown>) {
  H.selectQueue.push(H.roster.map((r) => ({ ...r })));
  const result = await executeSupportTool("query_user_data", { entity: "team_members", query_type: queryType, filters }, org, undefined, {
    origin: "support",
    ...options,
  } as any);
  expect(result.success, JSON.stringify(result)).toBe(true);
  return result.data.results as Array<Record<string, unknown>>;
}

function emailsOf(rows: Array<Record<string, unknown>>): Record<string, unknown> {
  return Object.fromEntries(rows.map((r) => [r.userId as string, r.email]));
}

beforeEach(() => {
  H.selectQueue.length = 0;
});

const DETAILED_SHAPES: Array<[string, Record<string, unknown>]> = [
  ["recent", { include_details: true }],
  ["by_id", { id: 2 }],
  ["by_status", { status: "active", include_details: true }],
];

describe("query_user_data team_members: the roster view, for the caller's role", () => {
  it.each(DETAILED_SHAPES)("%s: every row carries exactly the roster keys", async (shape, filters) => {
    const rows = await query(shape, filters, { userId: "u-owner" });
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(Object.keys(row).sort()).toEqual(ROSTER_KEYS);
  });

  it.each(DETAILED_SHAPES)("%s: a VA sees its own address and no teammate's", async (shape, filters) => {
    const rows = await query(shape, filters, { userId: "u-va" });
    const emails = emailsOf(rows);
    expect(emails["u-va"]).toBe("va@example.com");
    for (const [userId, email] of Object.entries(emails)) if (userId !== "u-va") expect(email, userId).toBeNull();
  });

  it("a viewer sees no teammate's address", async () => {
    const emails = emailsOf(await query("recent", { include_details: true }, { userId: "u-viewer" }));
    expect(emails["u-owner"]).toBeNull();
    expect(emails["u-member"]).toBeNull();
    expect(emails["u-viewer"]).toBe("viewer@example.com");
  });

  it("owner and member see teammates' addresses, as the roster shows them", async () => {
    for (const userId of ["u-owner", "u-member"]) {
      const emails = emailsOf(await query("recent", { include_details: true }, { userId }));
      expect(emails["u-va"], userId).toBe("va@example.com");
      expect(emails["u-owner"], userId).toBe("owner@example.com");
    }
  });

  it("an owner's ticket resolved at a VA's request is answered at the VA's view", async () => {
    const emails = emailsOf(await query("recent", { include_details: true }, { userId: "u-owner", alsoRequireUserId: "u-va" }));
    expect(emails["u-member"]).toBeNull();
  });

  it("an unidentified caller gets the least-privileged view", async () => {
    const emails = emailsOf(await query("recent", { include_details: true }, {}));
    expect(Object.values(emails).every((e) => e === null)).toBe(true);
  });

  it("the brief listing carries no address at all", async () => {
    const rows = await query("recent", {}, { userId: "u-va" });
    for (const row of rows) expect(row).not.toHaveProperty("email");
  });
});
