/**
 * Pax pause — the executeTool chokepoint gate (server/ai/tools.ts), and the
 * SEMANTIC pause-safe allowlist gate over both dispatch switches.
 *
 * The finding this closes: /settings/pax wrote pax.pausedUntil but NO executor
 * read it — "Pause all Pax automation" paused nothing. Since 2026-09-02 the
 * chokepoint reads the pause through the ONE reader of the org's Pax controls
 * (server/services/paxControls.getPaxControls, spec §4.2 — stance + switches +
 * pause in one call, failing CLOSED). This suite proves the switch is real:
 *
 *   1. While the org is paused, a SIDE-EFFECTING tool call (anything not on
 *      PAUSE_SAFE_TOOLS) is refused with the GLOSSARY line — a humanised
 *      local time, never an ISO string — and executes NOTHING.
 *   2. Read-only tools still run while paused, and the controls are not even
 *      consulted for them (looks and drafts are never gated).
 *   3. An unpaused org's side-effecting call succeeds as before.
 *   4. trustedApproval (a human explicitly tapping Approve) bypasses the gate
 *      — a human acting is not Pax automation — and reads no controls.
 *   5. A failed controls read FAILS CLOSED: refused with "could not verify",
 *      and NO ask row is minted (a failed read is not a stance).
 *   6. An unapproved send while paused is still frozen as an ask — asks keep
 *      accumulating while paused.
 *
 * `pauseSafeToolsAreSafe` (spec §7) is the SEMANTIC half: membership on the
 * allowlist is not the property — "no allowlisted case body performs a
 * storage/db mutation" is. Every allowlisted case body in BOTH switches is
 * parsed and scanned for record writes; `draft_offer` (which advances a deal
 * to offer_sent and writes a paxMemory row) is the mutation that must turn
 * this red if it is ever put back. Bookkeeping writes that are not the
 * customer's records (conversation memory; the support system's own ticket
 * rows) are registered per member with the exact tables they may touch.
 *
 * Mock scaffold mirrors tests/unit/paxWitnessedSend.test.ts so the module
 * graph stays light (no DB, no SES).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { stripCommentsPreservingLines } from "../../scripts/lib/strip-comments.mjs";

const {
  getPaxControls,
  checkSendRateLimit,
  checkTcpaBeforeSend,
  recordAutonomousSend,
  sendEmail,
  isConfigured,
  proposePendingAction,
  getLead,
  updateLead,
  createLead,
  logActivity,
} = vi.hoisted(() => ({
  getPaxControls: vi.fn(async (): Promise<PaxControlsState> => ({
    stance: "ask_before_sending" as const,
    leadScoring: true,
    borrowerReminders: true,
    inboxDrafts: true,
    paused: false,
    pausedUntil: null as Date | null,
    pausedBy: null as { userId: string; name: string } | null,
    checkFailed: false,
    timezone: "America/Chicago",
  })),
  checkSendRateLimit: vi.fn(async () => ({ allowed: true })),
  checkTcpaBeforeSend: vi.fn(async () => ({ allowed: true })),
  recordAutonomousSend: vi.fn(async () => undefined),
  sendEmail: vi.fn(async () => ({ success: true, messageId: "msg_pause_1" })),
  isConfigured: vi.fn(async () => true),
  proposePendingAction: vi.fn(async (input: any) => ({
    id: 9002,
    organizationId: input.organizationId,
    toolName: input.toolName,
    args: input.args,
    contentHash: "test-hash",
    status: "pending",
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    createdByUserId: input.createdByUserId ?? null,
  })),
  getLead: vi.fn(async () => ({
    id: 42,
    email: "lead@example.com",
    phone: "+16175550142",
    firstName: "Test",
    lastName: "Lead",
    status: "new",
    tcpaConsent: true,
    doNotContact: false,
  })),
  updateLead: vi.fn(async () => ({ id: 42, status: "qualified" })),
  createLead: vi.fn(async (input: any) => ({ id: 43, ...input })),
  logActivity: vi.fn(async () => undefined),
}));

// The gate under test — the ONE reader, with a controllable state. The
// refusal formatter stays REAL so the glossary line is what is asserted.
vi.mock("../../server/services/paxControls", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/services/paxControls")>();
  return { ...actual, getPaxControls };
});
vi.mock("../../server/db", () => ({ db: {} }));
vi.mock("../../server/websocket", () => ({ wsServer: { broadcastToOrg: vi.fn() } }));

vi.mock("../../server/services/autonomyGuardrails", () => ({
  checkSendRateLimit,
  checkTcpaBeforeSend,
  recordAutonomousSend,
}));
vi.mock("../../server/services/approvalKernel", () => ({
  APPROVAL_REQUIRED_TOOLS: new Set([
    "send_email",
    "send_sms",
    "send_gmail",
    "send_slack_message",
    "create_stripe_payment_link",
  ]),
  proposePendingAction,
  pendingActionArtifact: (row: any) => ({
    pendingApproval: true,
    requiresApproval: true,
    pendingActionId: row.id,
    toolName: row.toolName,
    args: row.args,
  }),
}));
vi.mock("../../server/services/emailService", () => ({
  emailService: { sendEmail, isConfigured },
}));
vi.mock("../../server/storage", () => ({
  storage: { getLead, updateLead, createLead, logActivity },
  db: {},
}));
vi.mock("../../server/services/tcpaCompliance", () => ({
  checkTcpaConsentFromLead: vi.fn(() => ({ canEmail: true, canSms: true })),
  isWithinQuietHours: vi.fn(() => ({ blocked: false })),
  isWithinQuietHoursForLead: vi.fn(() => ({ blocked: false })),
}));
vi.mock("../../server/services/aiContextAggregator", () => ({
  getSystemContext: vi.fn(),
  formatContextForAI: vi.fn(),
  invalidateContextCache: vi.fn(),
}));
vi.mock("../../server/services/parcel", () => ({ lookupParcelByAPN: vi.fn() }));
vi.mock("../../server/services/aiOfferService", () => ({
  generateOfferSuggestions: vi.fn(),
  generateOfferLetter: vi.fn(),
}));
vi.mock("../../server/services/smsService", () => ({
  smsService: {},
  sendOrgSMS: vi.fn(),
}));
vi.mock("../../server/services/comps", () => ({ getComparableProperties: vi.fn() }));
vi.mock("../../server/services/data-source-broker", () => ({ DataSourceBroker: class {} }));
vi.mock("../../server/services/propertyEnrichment", () => ({ propertyEnrichmentService: {} }));
vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../server/ai/validators", () => ({
  validateAtlasOutput: vi.fn(),
  AtlasOutputType: {},
}));

import { executeTool, PAUSE_SAFE_TOOLS, toolDefinitions } from "../../server/ai/tools";
import { formatPaxTime, PAX_CONTROLS_LABEL } from "../../shared/pax-glossary";
import type { PaxControlsState } from "../../server/services/paxControls";

const org = { id: 7, name: "Test Org" } as any;
const PAUSED_UNTIL = new Date(Date.now() + 24 * 60 * 60 * 1000);
const TZ = "America/Chicago";

const state = (over: Partial<PaxControlsState> = {}): PaxControlsState => ({
  stance: "ask_before_sending" as const,
  leadScoring: true,
  borrowerReminders: true,
  inboxDrafts: true,
  paused: false,
  pausedUntil: null as Date | null,
  pausedBy: null as { userId: string; name: string } | null,
  checkFailed: false,
  timezone: TZ,
  ...over,
});

function setPaused() {
  getPaxControls.mockResolvedValue(
    state({ paused: true, pausedUntil: PAUSED_UNTIL, pausedBy: { userId: "u-maria", name: "Maria" } }),
  );
}

function setUnpaused() {
  getPaxControls.mockResolvedValue(state());
}

beforeEach(() => {
  vi.clearAllMocks();
  setUnpaused();
  isConfigured.mockResolvedValue(true);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("paused org — side-effecting tool calls are refused, honestly", () => {
  it("refuses update_lead_status with the glossary line (local time, holder, route); nothing executes", async () => {
    setPaused();
    const result = await executeTool("update_lead_status", { lead_id: 42, status: "qualified" }, org);

    expect(result.success).toBe(false);
    expect(result.error).toContain(`Pax is paused until ${formatPaxTime(PAUSED_UNTIL, TZ)}`);
    expect(result.error).toContain("paused by Maria");
    expect(result.error).toContain(PAX_CONTROLS_LABEL);
    // Never an ISO string to a customer.
    expect(result.error).not.toContain(PAUSED_UNTIL.toISOString());
    expect(updateLead).not.toHaveBeenCalled();
    expect(logActivity).not.toHaveBeenCalled();
    expect(proposePendingAction).not.toHaveBeenCalled();
  });

  it("refuses create_lead too — record writes are acting, not drafting", async () => {
    setPaused();
    const result = await executeTool("create_lead", { first_name: "New", last_name: "Lead" }, org);
    expect(result.success).toBe(false);
    expect(result.error).toContain("Pax is paused until");
    expect(createLead).not.toHaveBeenCalled();
  });

  it("still allows READ-ONLY tools while paused, and never consults the controls for them", async () => {
    setPaused();
    const result = await executeTool("get_lead_details", { lead_id: 42 }, org);
    expect(result.success).toBe(true);
    expect((result.data as any)?.id).toBe(42);
    // Looks and drafts are never gated, never counted.
    expect(getPaxControls).not.toHaveBeenCalled();
  });

  it("FAILS CLOSED when the controls read failed — 'could not verify', and NO ask row", async () => {
    getPaxControls.mockResolvedValue(
      state({ stance: "ask_before_everything", paused: true, pausedUntil: null, checkFailed: true }),
    );
    const result = await executeTool("update_lead_status", { lead_id: 42, status: "qualified" }, org);
    expect(result.success).toBe(false);
    expect(result.error).toContain("could not verify");
    expect(result.error).toContain("wasn't done");
    expect(updateLead).not.toHaveBeenCalled();
    // A failed read is not a stance: nothing is minted under it, not even a send.
    expect(proposePendingAction).not.toHaveBeenCalled();
    const send = await executeTool("send_email", { lead_id: 42, subject: "s", message: "m" }, org);
    expect(send.success).toBe(false);
    expect(send.error).toContain("could not verify");
    expect(proposePendingAction).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("an unapproved send while paused is frozen as an ask (kernel), never sent", async () => {
    setPaused();
    const result = await executeTool("send_email", { lead_id: 42, subject: "s", message: "m" }, org);
    expect(result.success).toBe(true);
    expect((result.data as any)?.pendingApproval).toBe(true);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("trustedApproval bypasses the pause gate — a human tapping Approve is the human acting", async () => {
    setPaused();
    const result = await executeTool(
      "send_email",
      { lead_id: 42, subject: "s", message: "m" },
      org,
      { trustedApproval: true, origin: "approval_replay" },
    );
    expect(result.success).toBe(true);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    // The controls were never consulted on the human-approved path.
    expect(getPaxControls).not.toHaveBeenCalled();
  });
});

describe("unpaused org — side-effecting tool calls run as before", () => {
  it("update_lead_status executes when not paused, and the gate DID read the org's controls", async () => {
    setUnpaused();
    const result = await executeTool("update_lead_status", { lead_id: 42, status: "qualified" }, org);
    expect(result.success).toBe(true);
    expect(updateLead).toHaveBeenCalledTimes(1);
    // ONE read per invocation, org-scoped — this is what makes the switch real.
    expect(getPaxControls).toHaveBeenCalledTimes(1);
    expect(getPaxControls).toHaveBeenCalledWith(7);
  });

  it("an expired pause behaves exactly like no pause (implicit expiry)", async () => {
    // getPaxPauseState already reports paused:false for past timestamps —
    // the aggregator passes that through; simulate its contract.
    getPaxControls.mockResolvedValue(state({ paused: false, pausedUntil: null }));
    const result = await executeTool("create_lead", { first_name: "A", last_name: "B" }, org);
    expect(result.success).toBe(true);
    expect(createLead).toHaveBeenCalledTimes(1);
  });
});

/** Tools that must never be pause-safe. Named so two cases can share it. */
const NOT_PAUSE_SAFE = [
  "send_email",
  "send_sms",
  "send_gmail",
  "send_slack_message",
  "create_stripe_payment_link",
  "create_calendar_event",
  "trigger_zapier",
  "trigger_make",
  "create_lead",
  "update_lead_status",
  "create_property",
  "update_property",
  "create_properties_batch",
  "create_deal",
  "update_deal",
  "create_task",
  "update_task",
  "complete_task",
  "schedule_followup",
  "schedule_follow_up",
  "generate_offer_letter", // upserts a pipeline deal — a record write
  "draft_offer", // advances a negotiating deal to offer_sent + writes paxMemory (2026-09-02)
] as const;

describe("PAUSE_SAFE_TOOLS allowlist hygiene", () => {
  it("every allowlisted name is a real tool (no typos silently allowing nothing)", () => {
    const known = new Set(Object.keys(toolDefinitions));
    for (const name of PAUSE_SAFE_TOOLS) {
      expect(known.has(name), `PAUSE_SAFE_TOOLS entry "${name}" must exist in toolDefinitions`).toBe(true);
    }
  });

  it("every name in the not-pause-safe list is a real tool", () => {
    // The mirror of the hygiene test above, added 2026-08-19 when
    // `schedule_background_job` was DELETED (it reported `status: "queued"` and
    // queued nothing) and left a ghost entry in the list below. The assertion
    // there is `PAUSE_SAFE_TOOLS.has(name) === false`, which a name that no
    // longer exists satisfies trivially — so the list would have kept reading
    // as "these tools exist and are correctly not pause-safe" while one of
    // them did not exist at all.
    const known = new Set(Object.keys(toolDefinitions));
    for (const name of NOT_PAUSE_SAFE) {
      expect(known.has(name), `"${name}" is in the not-pause-safe list but is not a tool`).toBe(true);
    }
  });

  it("sends, external triggers, and record writes are NOT pause-safe", () => {
    for (const name of NOT_PAUSE_SAFE) {
      expect(PAUSE_SAFE_TOOLS.has(name), `"${name}" must NOT be pause-safe`).toBe(false);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// pauseSafeToolsAreSafe — the SEMANTIC gate (spec §7).
//
// Membership on an allowlist is not the property. The property is: no
// allowlisted case body performs a storage/db mutation. Both switches are
// read from source; every allowlisted top-level label must parse to a case
// body (per-member vacuity), and the predicates must be shown live against a
// known write before any absence below is believed.
// ─────────────────────────────────────────────────────────────────────────────

const ROOT = path.resolve(__dirname, "../..");
const source = (rel: string) =>
  stripCommentsPreservingLines(fs.readFileSync(path.join(ROOT, rel), "utf8"));

/** `case "name": { … }` bodies of a dispatch switch (6-space top-level labels). */
function caseBodies(src: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /\n {6}case "([a-z_0-9]+)": \{\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    let depth = 1;
    let i = m.index + m[0].length;
    while (i < src.length && depth > 0) {
      if (src[i] === "{") depth += 1;
      else if (src[i] === "}") depth -= 1;
      i += 1;
    }
    out.set(m[1], src.slice(m.index + m[0].length, i));
  }
  return out;
}

/** The allowlist literal, read from source (supportAgent.ts must not be imported here). */
function allowlistLiteral(src: string, name: string): string[] {
  const m = src.match(new RegExp(`export const ${name}: ReadonlySet<string> = new Set\\(\\[([\\s\\S]*?)\\]\\);`));
  expect(m, `${name} literal not found`).toBeTruthy();
  return [...m![1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]);
}

/** A write through the storage layer: any storage method that is not a read. */
const STORAGE_WRITE = /\bstorage\.(?!(?:get|list|find|search|count|has|is|lookup)[A-Z])[a-zA-Z]+\s*\(/g;
/** A write through drizzle, by any of the handles the switches use. */
const DB_WRITE = /\b(?:db|dbInstance|_db|tx)\s*\.\s*(?:insert|update|delete|execute|transaction)\s*\(/g;
/** The table a drizzle write targets: `.insert(paxMemory)`. */
const DB_WRITE_TABLE = /\.(?:insert|update|delete)\s*\(\s*([A-Za-z_]+)\s*\)/g;

interface BookkeepingExemption {
  /** The ONLY tables this member may write. */
  tables: string[];
  reason: string;
}

/**
 * Allowlisted members that write rows which are NOT the customer's records.
 * Each names the exact tables it may touch; a write to any other table, or
 * any storage-layer write at all, fails. Adding a name here is a claim that
 * the rows are conversation memory or the support system's own bookkeeping.
 */
const BOOKKEEPING: Record<string, Record<string, BookkeepingExemption>> = {
  "server/ai/tools.ts": {
    remember_fact: {
      tables: ["paxMemory"],
      reason: "Conversation-scoped memory, not a record of the customer's business.",
    },
  },
  "server/ai/supportAgent.ts": {
    escalate_to_human: {
      tables: ["supportTickets", "supportTicketMessages", "paxMemory"],
      reason: "Reaching a person must work while paused; writes the ticket, never the customer's records.",
    },
    log_resolution: {
      tables: ["supportResolutionHistory", "paxMemory"],
      reason: "The support system's own record of how a conversation resolved.",
    },
    log_resolution_variant: {
      tables: ["supportResolutionHistory", "paxMemory"],
      reason: "Same as log_resolution — a resolution-history row.",
    },
    record_customer_feedback: {
      tables: ["supportTickets", "paxMemory"],
      reason: "Feedback on the ticket itself.",
    },
    save_user_memory: {
      tables: ["paxMemory"],
      reason: "Conversation memory.",
    },
  },
};

const SWITCHES = [
  {
    file: "server/ai/tools.ts",
    allowlist: "PAUSE_SAFE_TOOLS",
    floor: 50,
    /** A known write, to prove the predicates are live on this file. */
    knownWrite: "update_lead_status",
  },
  {
    file: "server/ai/supportAgent.ts",
    allowlist: "PAUSE_SAFE_SUPPORT_TOOLS",
    floor: 60,
    knownWrite: "resolve_alert",
  },
] as const;

describe.each(SWITCHES)("pauseSafeToolsAreSafe: $file", ({ file, allowlist, floor, knownWrite }) => {
  const src = source(file);
  const bodies = caseBodies(src);
  const allowed = allowlistLiteral(src, allowlist);
  const exempt = BOOKKEEPING[file] ?? {};

  it("vacuity: the switch parses, the allowlist parses, and the write predicates are live", () => {
    expect(bodies.size, `only ${bodies.size} cases parsed out of ${file}`).toBeGreaterThan(floor);
    expect(allowed.length, `${allowlist} parsed to ${allowed.length} names`).toBeGreaterThan(20);
    const body = bodies.get(knownWrite);
    expect(body, `${knownWrite} is not a case in ${file} — repin the known write`).toBeDefined();
    // The predicates must catch a real write on THIS file, or every absence
    // below is decoration.
    const live = STORAGE_WRITE.test(body!) || DB_WRITE.test(body!) || /await import\(/.test(body!);
    STORAGE_WRITE.lastIndex = 0;
    DB_WRITE.lastIndex = 0;
    expect(live, `the write predicates do not see ${knownWrite}'s write`).toBe(true);
    // And the tools.ts predicate specifically sees storage AND drizzle writes.
    if (file === "server/ai/tools.ts") {
      expect(STORAGE_WRITE.test(bodies.get("update_lead_status")!)).toBe(true);
      STORAGE_WRITE.lastIndex = 0;
      expect(DB_WRITE.test(bodies.get("remember_fact")!)).toBe(true);
      DB_WRITE.lastIndex = 0;
    }
  });

  it("every allowlisted name is a case label (top-level) or a sub-switch label (nested)", () => {
    for (const name of allowed) {
      const topLevel = bodies.has(name);
      const nested = new RegExp(`case "${name}":`).test(src);
      expect(topLevel || nested, `${allowlist} entry "${name}" is not a case label in ${file}`).toBe(true);
    }
  });

  it("every exempted name is an allowlisted top-level case", () => {
    for (const name of Object.keys(exempt)) {
      expect(allowed.includes(name), `exempt "${name}" is not on ${allowlist}`).toBe(true);
      expect(bodies.has(name), `exempt "${name}" is not a case in ${file}`).toBe(true);
    }
  });

  it("no allowlisted case body performs a storage/db mutation (bookkeeping only where registered)", () => {
    const offenders: string[] = [];
    for (const name of allowed) {
      const body = bodies.get(name);
      if (!body) continue; // nested sub-switch label — no body of its own
      const storageWrites = [...body.matchAll(STORAGE_WRITE)].map((m) => m[0]);
      const dbWrites = [...body.matchAll(DB_WRITE)].map((m) => m[0]);
      const rule = exempt[name];
      if (!rule) {
        if (storageWrites.length || dbWrites.length) {
          offenders.push(`${name}: ${[...storageWrites, ...dbWrites].join(", ")}`);
        }
        continue;
      }
      // Registered bookkeeping: no storage-layer writes at all, and every
      // drizzle write targets a table the registration names.
      if (storageWrites.length) offenders.push(`${name}: storage write ${storageWrites.join(", ")} (bookkeeping may not use the storage layer)`);
      const tables = [...body.matchAll(DB_WRITE_TABLE)].map((m) => m[1]);
      for (const t of tables) {
        if (!rule.tables.includes(t)) offenders.push(`${name}: writes ${t}, registered only for ${rule.tables.join("/")}`);
      }
    }
    expect(
      offenders,
      `${file}: these ${allowlist} members mutate records. Pause-safe means "runs while paused ` +
        "because it changes nothing of the customer's" + '" — move each off the allowlist, or register ' +
        "it under BOOKKEEPING with the exact tables it may write and why.",
    ).toEqual([]);
  });
});

describe("pauseSafeToolsAreSafe is falsifiable", () => {
  it("FIRES on draft_offer if it is put back on PAUSE_SAFE_TOOLS", () => {
    const src = source("server/ai/tools.ts");
    const bodies = caseBodies(src);
    const body = bodies.get("draft_offer");
    expect(body, "draft_offer is not a case — re-anchor this probe").toBeDefined();
    // The body writes a deal and a memory row — exactly what the gate reads.
    expect(STORAGE_WRITE.test(body!)).toBe(true);
    STORAGE_WRITE.lastIndex = 0;
    expect(DB_WRITE.test(body!)).toBe(true);
    DB_WRITE.lastIndex = 0;
    // And it is not on the allowlist today.
    expect(PAUSE_SAFE_TOOLS.has("draft_offer")).toBe(false);
    expect(allowlistLiteral(src, "PAUSE_SAFE_TOOLS")).not.toContain("draft_offer");
  });
});
