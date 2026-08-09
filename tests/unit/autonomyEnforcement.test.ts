/**
 * P-1 — "Make autonomy enforcement-true" exit test (master handoff Part 2
 * §7.2 · Wave 0 item 0.4, 2026-08-09).
 *
 * The customer autonomy matrix (Observe/Draft/Execute/Autonomous × per-action
 * × $ thresholds × time guardrails) used to be a stored preference. It is now
 * policy: `resolveActionPolicy` (server/services/resolveActionPolicy.ts) is
 * consulted at the SINGLE chokepoint where pending_actions are written
 * (approvalKernel.proposePendingAction) and its verdict + rule are stamped on
 * every frozen row. This suite pins the load-bearing invariants:
 *
 *   1. Level 0 (Observe) ⇒ ZERO auto, for every action type, even when a
 *      per-action override claims level 3 — level 0 is a hard ceiling.
 *   2. An org with NO stored settings resolves to require_approval (today's
 *      witnessed behavior) — enforcement-true never TURNS ON autonomy.
 *   3. An auto grant over the configured $ ceiling — or money-bearing with no
 *      ceiling at all — downgrades to require_approval.
 *   4. Outside allowed hours (timeGuards pause window, org timezone)
 *      downgrades to require_approval.
 *   5. `forbid` (explicit dailyActionLimit=0) refuses at the chokepoint and
 *      writes NOTHING.
 *   6. The kernel stamps decision + reason on the written action, and even a
 *      full auto_with_receipt grant still lands FROZEN — no execution lane
 *      consumes the grant yet (Wave 6.5 adds the consent-artifact gate).
 *   7. Derived structural pins: approvalKernel.ts stays the only
 *      insert(pendingActions) site in server/; `trustedApproval: true` is
 *      set only by the human-tap endpoints; the resolver's kernel-tool map
 *      cannot drift from APPROVAL_REQUIRED_TOOLS.
 *
 * DB mock: same discipline as approvalKernel.test.ts / paxPauseState.test.ts —
 * pending_actions served through a PgDialect-rendered eq matcher; the
 * resolver's three snapshot reads (organizations timezone, owner prefs,
 * active-member prefs) served from fixtures routed by table name.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

// ── In-memory tables + resolver fixtures ────────────────────────────────────

const mem = vi.hoisted(() => ({
  pendingActions: [] as any[],
  nextId: 1,
  orgTimezone: null as string | null,
  ownerPrefs: [] as Array<{ prefs: unknown }>,
  memberPrefs: [] as Array<{ prefs: unknown }>,
  usersCall: 0,
  dbFail: null as Error | null,
}));

vi.mock("../../server/db", async () => {
  const { PgDialect } = await import("drizzle-orm/pg-core");
  const { getTableName } = await import("drizzle-orm");

  const COLUMN_TO_PROP: Record<string, string> = {
    id: "id",
    organization_id: "organizationId",
    tool_name: "toolName",
    content_hash: "contentHash",
    status: "status",
  };

  const pendingMatcher = (expr: unknown) => {
    const dialect = new PgDialect();
    const { sql, params } = dialect.sqlToQuery(expr as any);
    const conds: Array<{ prop: string; value: unknown }> = [];
    const re = /"([a-z_]+)" = \$(\d+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(sql)) !== null) {
      const prop = COLUMN_TO_PROP[m[1]];
      if (!prop) throw new Error(`autonomyEnforcement mock: unmapped column ${m[1]}`);
      conds.push({ prop, value: params[Number(m[2]) - 1] });
    }
    return (row: any) => conds.every((c) => row[c.prop] === c.value);
  };

  const resultFor = (tableName: string, whereExpr: unknown): Promise<any[]> => {
    if (mem.dbFail && (tableName === "organizations" || tableName === "users")) {
      return Promise.reject(mem.dbFail);
    }
    if (tableName === "organizations") {
      return Promise.resolve([{ timezone: mem.orgTimezone }]);
    }
    if (tableName === "users") {
      // The resolver always reads owner rows then active-member rows.
      const owner = mem.usersCall % 2 === 0;
      mem.usersCall += 1;
      return Promise.resolve((owner ? mem.ownerPrefs : mem.memberPrefs).map((r) => ({ ...r })));
    }
    if (tableName === "pending_actions") {
      const pred = pendingMatcher(whereExpr);
      return Promise.resolve(mem.pendingActions.filter(pred).map((r) => ({ ...r })));
    }
    throw new Error(`autonomyEnforcement mock: unexpected table ${tableName}`);
  };

  const db = {
    select: (_shape?: unknown) => {
      let tableName = "";
      let whereExpr: unknown;
      const chain: any = {
        from(t: any) {
          tableName = getTableName(t);
          return chain;
        },
        innerJoin() {
          return chain;
        },
        where(e: unknown) {
          whereExpr = e;
          return chain;
        },
        limit: (n: number) => resultFor(tableName, whereExpr).then((rows) => rows.slice(0, n)),
        then: (onF: (rows: unknown) => unknown, onR?: (err: unknown) => unknown) =>
          resultFor(tableName, whereExpr).then(onF, onR),
      };
      return chain;
    },
    insert: (table: any) => ({
      values: (vals: any) => {
        const name = getTableName(table);
        if (name !== "pending_actions") {
          throw new Error(`autonomyEnforcement mock: unexpected insert into ${name}`);
        }
        const insertOne = () => {
          const row = { createdAt: new Date(), policy: null, ...vals, id: mem.nextId++ };
          mem.pendingActions.push(row);
          return [{ ...row }];
        };
        let inserted: any[] | null = null;
        const run = () => (inserted ??= insertOne());
        return Object.assign(Promise.resolve().then(run), { returning: async () => run() });
      },
    }),
  };
  return { db };
});

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import type { AutonomyPreferences } from "@shared/models/auth";
import {
  ActionPolicyForbiddenError,
  KERNEL_ACTION_MATRIX_IDS,
  MATRIX_ACTION_IDS,
  extractActionAmountCents,
  resolveActionPolicy,
  resolvePolicyFromSnapshot,
  type OrgAutonomySnapshot,
} from "../../server/services/resolveActionPolicy";
import { APPROVAL_REQUIRED_TOOLS, proposePendingAction } from "../../server/services/approvalKernel";

const ORG = 7;
const KERNEL_ACTION_TYPES: string[] = Object.keys(KERNEL_ACTION_MATRIX_IDS);

const ALL_ACTION_TYPES: string[] = [
  ...KERNEL_ACTION_TYPES,
  ...Object.values(MATRIX_ACTION_IDS).flat(),
];

function snap(
  userPrefs: Array<AutonomyPreferences | null>,
  timezone: string | null = null,
): OrgAutonomySnapshot {
  return { organizationId: ORG, timezone, userPrefs };
}

function resolve(
  userPrefs: Array<AutonomyPreferences | null>,
  input: { agent?: "atlas" | "pax" | "sophie"; actionType: string; amountCents?: number | null; when?: Date },
  timezone: string | null = null,
) {
  return resolvePolicyFromSnapshot(snap(userPrefs, timezone), { organizationId: ORG, ...input });
}

beforeEach(() => {
  mem.pendingActions = [];
  mem.nextId = 1;
  mem.orgTimezone = null;
  mem.ownerPrefs = [];
  mem.memberPrefs = [];
  mem.usersCall = 0;
  mem.dbFail = null;
});

// ── 1. Level 0 (Observe): zero auto actions possible ────────────────────────

describe("level 0 Observe — a hard ceiling; zero auto, ever", () => {
  it("never resolves auto_with_receipt for ANY action type at level 0", () => {
    for (const actionType of ALL_ACTION_TYPES) {
      for (const agent of ["atlas", "pax", "sophie"] as const) {
        const verdict = resolve([{ [agent]: { level: 0 } }], { agent, actionType });
        expect(verdict.decision).toBe("suggest");
      }
    }
  });

  it("a per-action override claiming level 3 cannot raise level 0 (level-0 wins)", () => {
    for (const actionType of ALL_ACTION_TYPES) {
      const prefs: AutonomyPreferences[] = [
        {
          pax: {
            level: 0,
            // The override claims full autonomy under every key the resolver
            // could consult for this action — none of them may win.
            perAction: { [actionType]: 3, replies: 3, outreach: 3 },
            thresholdsCents: { [actionType]: 10_000_000 },
          },
        },
      ];
      const verdict = resolve(prefs, { agent: "pax", actionType, amountCents: 100 });
      expect(verdict.decision).toBe("suggest");
      expect(verdict.decision).not.toBe("auto_with_receipt");
    }
  });

  it("one level-0 human caps the whole org even when another grants level 3", () => {
    const verdict = resolve(
      [{ pax: { level: 3 } }, { pax: { level: 0 } }],
      { agent: "pax", actionType: "send_email" },
    );
    expect(verdict.decision).toBe("suggest");
  });
});

// ── 2. No-settings org: require_approval, never auto ────────────────────────

describe("no stored settings — today's witnessed default, never auto", () => {
  it.each([[[]], [[null]], [[{}]]])("prefs %j resolve to require_approval", (userPrefs) => {
    for (const actionType of KERNEL_ACTION_TYPES) {
      const verdict = resolve(userPrefs as Array<AutonomyPreferences | null>, {
        agent: "pax",
        actionType,
      });
      expect(verdict.decision).toBe("require_approval");
      expect(verdict.reason).toContain("witnessed approval");
    }
  });

  it("a user with prefs for a DIFFERENT agent expresses no intent for this one", () => {
    const verdict = resolve([{ atlas: { level: 3 } }], { agent: "pax", actionType: "send_email" });
    expect(verdict.decision).toBe("require_approval");
  });
});

// ── 3. $ thresholds ─────────────────────────────────────────────────────────

describe("$ thresholds — over the ceiling (or no ceiling) downgrades auto", () => {
  const granted: AutonomyPreferences[] = [
    { pax: { level: 3, thresholdsCents: { mailerSend: 50_000 } } },
  ];

  it("amount over the ceiling downgrades to require_approval", () => {
    const verdict = resolve(granted, { agent: "pax", actionType: "mailerSend", amountCents: 60_000 });
    expect(verdict.decision).toBe("require_approval");
    expect(verdict.reason).toContain("exceeds");
  });

  it("amount within the ceiling keeps the auto grant", () => {
    const verdict = resolve(granted, { agent: "pax", actionType: "mailerSend", amountCents: 40_000 });
    expect(verdict.decision).toBe("auto_with_receipt");
  });

  it("money-bearing with NO configured ceiling never goes auto, even at level 3", () => {
    const verdict = resolve([{ pax: { level: 3 } }], {
      agent: "pax",
      actionType: "create_stripe_payment_link",
      amountCents: 100,
    });
    expect(verdict.decision).toBe("require_approval");
    expect(verdict.reason).toContain("no configured $ ceiling");
  });

  it("the LOWEST ceiling across org users binds (most restrictive human)", () => {
    const verdict = resolve(
      [
        { pax: { level: 3, thresholdsCents: { mailerSend: 50_000 } } },
        { pax: { level: 3, thresholdsCents: { mailerSend: 10_000 } } },
      ],
      { agent: "pax", actionType: "mailerSend", amountCents: 20_000 },
    );
    expect(verdict.decision).toBe("require_approval");
  });
});

// ── 4. Time guardrails ──────────────────────────────────────────────────────

describe("time guardrails — outside allowed hours downgrades auto", () => {
  const granted: AutonomyPreferences[] = [
    { pax: { level: 3 }, timeGuards: { pauseStartHour: 19, pauseEndHour: 8 } },
  ];
  // Fixed instants; timezone null ⇒ evaluated in UTC.
  const at = (hourUtc: number) => new Date(Date.UTC(2026, 7, 5, hourUtc, 30, 0));

  it("inside the pause window (evening) downgrades to require_approval", () => {
    const verdict = resolve(granted, { agent: "pax", actionType: "send_email", when: at(22) });
    expect(verdict.decision).toBe("require_approval");
    expect(verdict.reason).toContain("pause window");
  });

  it("the window wraps midnight (03:00 is still paused for 19→8)", () => {
    const verdict = resolve(granted, { agent: "pax", actionType: "send_email", when: at(3) });
    expect(verdict.decision).toBe("require_approval");
  });

  it("inside allowed hours the grant survives", () => {
    const verdict = resolve(granted, { agent: "pax", actionType: "send_email", when: at(12) });
    expect(verdict.decision).toBe("auto_with_receipt");
  });

  it("evaluates in the ORG's IANA timezone when set", () => {
    // Discriminating instant: 2026-08-05T12:00Z is 07:00 in America/Chicago
    // (UTC-5 in August). 07:00 is INSIDE the wrapped 19→8 window; a naive
    // UTC evaluation (hour 12) would wrongly allow it.
    const verdict = resolve(granted, {
      agent: "pax",
      actionType: "send_email",
      when: new Date(Date.UTC(2026, 7, 5, 12, 0, 0)),
    }, "America/Chicago");
    expect(verdict.decision).toBe("require_approval");
  });

  it("an active pausedUntil for the agent downgrades auto (ask, don't act)", () => {
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const verdict = resolve(
      [{ pax: { level: 3, pausedUntil: future } }],
      { agent: "pax", actionType: "send_email" },
    );
    expect(verdict.decision).toBe("require_approval");
    expect(verdict.reason).toContain("paused until");
  });

  it("an EXPIRED pausedUntil does not restrict (expiry is implicit)", () => {
    const past = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const verdict = resolve(
      [{ pax: { level: 3, pausedUntil: past } }],
      { agent: "pax", actionType: "send_email" },
    );
    expect(verdict.decision).toBe("auto_with_receipt");
  });
});

// ── Levels 1/2 map to draft / threshold-gated execute ───────────────────────

describe("level mapping", () => {
  it("level 1 resolves to draft", () => {
    const verdict = resolve([{ pax: { level: 1 } }], { agent: "pax", actionType: "send_email" });
    expect(verdict.decision).toBe("draft");
  });

  it("level 2 with no amount resolves to auto_with_receipt (Execute)", () => {
    const verdict = resolve([{ pax: { level: 2 } }], { agent: "pax", actionType: "send_email" });
    expect(verdict.decision).toBe("auto_with_receipt");
  });

  it("the most restrictive human wins across levels (3 vs 1 ⇒ draft)", () => {
    const verdict = resolve(
      [{ pax: { level: 3 } }, { pax: { level: 1 } }],
      { agent: "pax", actionType: "send_email" },
    );
    expect(verdict.decision).toBe("draft");
  });

  it("a user with NO stored prefs neither grants nor restricts", () => {
    const verdict = resolve([{ pax: { level: 3 } }, null], { agent: "pax", actionType: "send_email" });
    expect(verdict.decision).toBe("auto_with_receipt");
  });
});

// ── 5. forbid ───────────────────────────────────────────────────────────────

describe("forbid — explicit dailyActionLimit=0 disables agent actions", () => {
  it("resolves forbid for every agent and action type", () => {
    for (const actionType of ALL_ACTION_TYPES) {
      const verdict = resolve(
        [{ pax: { level: 3 }, timeGuards: { dailyActionLimit: 0 } }],
        { agent: "pax", actionType },
      );
      expect(verdict.decision).toBe("forbid");
      expect(verdict.reason).toContain("dailyActionLimit");
    }
  });

  it("a POSITIVE dailyActionLimit does not forbid (count-based capping is deferred, stated not faked)", () => {
    const verdict = resolve(
      [{ pax: { level: 3 }, timeGuards: { dailyActionLimit: 200 } }],
      { agent: "pax", actionType: "send_email" },
    );
    expect(verdict.decision).toBe("auto_with_receipt");
  });
});

// ── Fail-closed wrapper ─────────────────────────────────────────────────────

describe("resolveActionPolicy — a failed policy read FAILS CLOSED to witnessed", () => {
  it("db error ⇒ require_approval + checkFailed (never auto, never forbid)", async () => {
    mem.dbFail = new Error("connection refused");
    const verdict = await resolveActionPolicy({ organizationId: ORG, actionType: "send_email" });
    expect(verdict.decision).toBe("require_approval");
    expect(verdict.checkFailed).toBe(true);
    expect(verdict.reason).toContain("failing closed");
  });
});

// ── 6. Kernel integration — the chokepoint consults, stamps, refuses ────────

describe("the chokepoint — proposePendingAction consults the REAL resolver", () => {
  it("no-settings org: freezes with a require_approval stamp (today's behavior, unchanged)", async () => {
    const row = await proposePendingAction({
      organizationId: ORG,
      toolName: "send_email",
      args: { lead_id: 42, subject: "Hi", message: "Hello" },
    });
    expect(mem.pendingActions).toHaveLength(1);
    expect(row.status).toBe("pending");
    expect(row.policy?.decision).toBe("require_approval");
    expect(row.policy?.reason).toContain("witnessed approval");
    expect(row.policy?.agent).toBe("pax");
    expect(typeof row.policy?.resolvedAt).toBe("string");
  });

  it("level-0 org with a forced-auto override: STILL lands frozen, stamped suggest", async () => {
    mem.ownerPrefs = [
      { prefs: { pax: { level: 0, perAction: { send_email: 3, replies: 3, outreach: 3 } } } },
    ];
    const row = await proposePendingAction({
      organizationId: ORG,
      toolName: "send_email",
      args: { lead_id: 42, subject: "Hi", message: "Hello" },
    });
    // Frozen, not executed: the ONLY executors are the human-tap endpoints
    // (pinned below), so a level-0 org can never see an auto action.
    expect(row.status).toBe("pending");
    expect(row.policy?.decision).toBe("suggest");
    expect(row.policy?.decision).not.toBe("auto_with_receipt");
  });

  it("a full auto grant STILL lands frozen — enforcement-true turns nothing on", async () => {
    mem.ownerPrefs = [{ prefs: { pax: { level: 3 } } }];
    const row = await proposePendingAction({
      organizationId: ORG,
      toolName: "send_email",
      args: { lead_id: 42, subject: "Hi", message: "Hello" },
    });
    // The stamp records the grant; no execution lane consumes it yet (the
    // Wave 6.5 consent-artifact gate lands before any auto lane does).
    expect(row.policy?.decision).toBe("auto_with_receipt");
    expect(row.status).toBe("pending");
  });

  it("forbid refuses at the chokepoint and writes NOTHING", async () => {
    mem.ownerPrefs = [{ prefs: { timeGuards: { dailyActionLimit: 0 } } }];
    await expect(
      proposePendingAction({
        organizationId: ORG,
        toolName: "send_email",
        args: { lead_id: 42, subject: "Hi", message: "Hello" },
      }),
    ).rejects.toBeInstanceOf(ActionPolicyForbiddenError);
    expect(mem.pendingActions).toHaveLength(0);
  });

  it("threshold enforcement reaches the kernel through the frozen args (stripe amount)", async () => {
    mem.ownerPrefs = [
      { prefs: { pax: { level: 3, thresholdsCents: { create_stripe_payment_link: 50_000 } } } },
    ];
    const row = await proposePendingAction({
      organizationId: ORG,
      toolName: "create_stripe_payment_link",
      args: { amount: 600, description: "Earnest money" }, // $600 = 60,000c > $500 ceiling
    });
    expect(row.policy?.decision).toBe("require_approval");
    expect(row.policy?.reason).toContain("exceeds");
    expect(row.status).toBe("pending");
  });
});

// ── extractActionAmountCents ────────────────────────────────────────────────

describe("extractActionAmountCents — refuses to invent a size", () => {
  it("reads the stripe payment-link amount (dollars → cents)", () => {
    expect(extractActionAmountCents("create_stripe_payment_link", { amount: 600 })).toBe(60_000);
    expect(extractActionAmountCents("create_stripe_payment_link", { amount: 0.5 })).toBe(50);
  });
  it("returns null for tools without a monetary arg (never guesses)", () => {
    expect(extractActionAmountCents("send_email", { subject: "hi" })).toBeNull();
    expect(extractActionAmountCents("create_stripe_payment_link", {})).toBeNull();
    expect(extractActionAmountCents("create_stripe_payment_link", { amount: -5 })).toBeNull();
  });
});

// ── 7. Derived structural pins ──────────────────────────────────────────────

const ROOT = path.resolve(__dirname, "../..");

function walk(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = path.join(dir, entry);
    const st = fs.statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/** Source lines with line/block comments removed (roughly, line-wise). */
function codeLines(src: string): string[] {
  return src.split("\n").filter((line) => {
    const t = line.trim();
    return !(t.startsWith("//") || t.startsWith("*") || t.startsWith("/*"));
  });
}

describe("derived pins — the chokepoint cannot silently fork", () => {
  const serverFiles = walk(path.join(ROOT, "server"));

  it("approvalKernel.ts is the ONLY insert(pendingActions) site in server/", () => {
    const offenders = serverFiles.filter((f) =>
      /\.insert\(pendingActions\)/.test(fs.readFileSync(f, "utf8")),
    );
    expect(offenders.map((f) => path.relative(ROOT, f))).toEqual([
      "server/services/approvalKernel.ts",
    ]);
  });

  it("trustedApproval: true is set ONLY by the human-tap endpoints (no auto-execution lane exists)", () => {
    // The only way a kernel tool executes is executeTool with the
    // server-side trustedApproval option. Pinning its call sites to the two
    // human-tap approve endpoints IS the "nothing executes without a human"
    // invariant. A future auto_with_receipt execution lane (Wave 6.5+, with
    // consent artifacts) must update this pin DELIBERATELY.
    const offenders = serverFiles.filter((f) =>
      codeLines(fs.readFileSync(f, "utf8")).some((l) => /trustedApproval:\s*true/.test(l)),
    );
    expect(offenders.map((f) => path.relative(ROOT, f)).sort()).toEqual([
      "server/routes-pax-insights.ts",
    ]);
  });

  it("the kernel gate consults the policy and surfaces forbid refusals (source-level)", () => {
    const src = fs.readFileSync(path.join(ROOT, "server/ai/tools.ts"), "utf8");
    const gate = src.indexOf("kernelApprovalRequiredTools.has(toolName) && !trustedApproval");
    const propose = src.indexOf("proposePendingAction(", gate);
    const forbidCatch = src.indexOf("ActionPolicyForbiddenError", gate);
    expect(gate).toBeGreaterThan(-1);
    expect(propose).toBeGreaterThan(gate);
    expect(forbidCatch).toBeGreaterThan(gate);
  });

  it("the resolver's kernel-tool map cannot drift from APPROVAL_REQUIRED_TOOLS", () => {
    expect(new Set(KERNEL_ACTION_TYPES)).toEqual(new Set(APPROVAL_REQUIRED_TOOLS));
    // Every kernel tool has an (possibly empty) explicit matrix mapping —
    // absence would silently skip override/threshold lookup keys.
    for (const tool of APPROVAL_REQUIRED_TOOLS) {
      expect(KERNEL_ACTION_MATRIX_IDS[tool]).toBeDefined();
    }
  });

  it("proposePendingAction resolves policy BEFORE the dedupe/insert (source-level)", () => {
    const src = fs.readFileSync(
      path.join(ROOT, "server/services/approvalKernel.ts"),
      "utf8",
    );
    const fnStart = src.indexOf("export async function proposePendingAction");
    const resolveCall = src.indexOf("resolveActionPolicy(", fnStart);
    const insert = src.indexOf(".insert(pendingActions)", fnStart);
    expect(fnStart).toBeGreaterThan(-1);
    expect(resolveCall).toBeGreaterThan(fnStart);
    expect(insert).toBeGreaterThan(resolveCall);
  });
});
