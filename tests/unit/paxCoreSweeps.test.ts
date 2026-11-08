/**
 * E2 slice 1 — Pax core sweeps (package 2026-11-03 §Tests 7, plus the
 * prepare-only and "never writes memory silently" invariants).
 *
 * POPULATION: every file this slice's legs 1/3/4/5 add — the service, the
 * router, the shared registry, the schema module, the packet pane and the
 * settings component — each with a vacuity floor so a moved or emptied file
 * cannot pass silently. Over that population:
 *
 *   - no send transport, no tool execution, no approval-kernel call and no
 *     direct write to the kernel's tables (pending_actions / pax_sends):
 *     prepare-only adds NO execution or send path;
 *   - no model identifier (D15: the actor is Pax);
 *
 * and, on the chat path:
 *
 *   - the remember_fact case in server/ai/tools.ts prepares through
 *     proposeMemoryFromChat and writes NO table itself (Pax never writes
 *     memory silently) — and no other case in either dispatch switch writes
 *     pax_business_memory (the only writers are the user's routes and the
 *     approval of a proposal, both in paxCore.ts).
 *
 * Every predicate has a canary that proves it still bites.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { stripComments, REPO_SWEEP_TIMEOUT_MS } from "../helpers/stripComments";

// The last case walks every production file under server/.
vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

const POPULATION: Array<{ file: string; floor: number }> = [
  { file: "server/services/paxCore.ts", floor: 12_000 },
  { file: "server/routes-pax-core.ts", floor: 6_000 },
  { file: "shared/pax-core.ts", floor: 4_000 },
  { file: "shared/schema/pax-core.ts", floor: 4_000 },
  { file: "client/src/components/pax/packet-pane.tsx", floor: 5_000 },
  { file: "client/src/components/pax/pax-core-settings.tsx", floor: 12_000 },
];

const ACTS_ON_THE_WORLD =
  /\b(emailService|smsService|sendEmail|sendSms|sendGmail|sendSlackMessage|sendOrgSMS|twilio|sendgrid|postmark|resend|lob|postgrid|executeTool|executeSupportTool|executeApprovedAsk|proposePendingAction|approvePendingAction|revisePendingAction|rejectPendingAction|sweepExpiredPendingActions|sweepStaleApprovalClaims|sendManualReminder|dispatchReminder|routeAITask)\b/i;
const KERNEL_TABLE_WRITE = /\.(insert|update|delete)\(\s*(pendingActions|paxSends)\b/;
const MODEL_ID =
  // No trailing \b: "gpt-4o" has none between the 4 and the o (a canary caught it).
  /\b(gpt-?\d[\w.-]*|o\d-[\w-]+|claude|anthropic|openai|deepseek|llama|gemini|mistral|qwen|openrouter|sonnet|opus|haiku|grok)/i;

describe("Pax core population — prepare-only adds no execution path and names no model", () => {
  for (const { file, floor } of POPULATION) {
    const code = () => stripComments(read(file));
    it(`${file}: read (vacuity floor)`, () => {
      expect(read(file).length).toBeGreaterThan(floor);
    });
    it(`${file}: no send transport, tool execution, model call or kernel call`, () => {
      expect(code().match(ACTS_ON_THE_WORLD)?.[0] ?? null).toBeNull();
    });
    it(`${file}: no direct write to the kernel's tables`, () => {
      expect(code().match(KERNEL_TABLE_WRITE)?.[0] ?? null).toBeNull();
    });
    it(`${file}: no model identifier`, () => {
      expect(code().match(MODEL_ID)?.[0] ?? null).toBeNull();
    });
  }

  it("canaries: each predicate bites", () => {
    expect(stripComments(`await proposePendingAction({ toolName: "send_email" });`)).toMatch(ACTS_ON_THE_WORLD);
    expect(stripComments(`await executeTool("send_sms", args, org);`)).toMatch(ACTS_ON_THE_WORLD);
    expect(stripComments(`await routeAITask(task, { orgId });`)).toMatch(ACTS_ON_THE_WORLD);
    expect(stripComments(`await tx.insert(pendingActions).values(row);`)).toMatch(KERNEL_TABLE_WRITE);
    expect(stripComments(`const m = "gpt-4o";`)).toMatch(MODEL_ID);
    // A comment naming them is the record, not the defect.
    expect(stripComments(`// approvalKernel.proposePendingAction would freeze it\nconst x = 1;`)).not.toMatch(ACTS_ON_THE_WORLD);
  });
});

// ── The chat path never writes memory silently ─────────────────────────────

/** The source of one `case "<name>": {` block, up to the next case label. */
function caseBody(src: string, name: string): string {
  const start = src.indexOf(`case "${name}": {`);
  if (start < 0) return "";
  const next = src.slice(start + 1).search(/\n\s{6}case "[a-z_]+":/);
  return next < 0 ? src.slice(start) : src.slice(start, start + 1 + next);
}

const DB_WRITE = /\b(?:db|dbInstance|_db|tx)\s*\.\s*(?:insert|update|delete|execute|transaction)\s*\(/;
const BUSINESS_MEMORY_WRITE = /\.(insert|update|delete)\(\s*(paxBusinessMemory|bm)\b/;

describe("remember_fact suggests; it never writes memory itself", () => {
  const tools = stripComments(read("server/ai/tools.ts"));
  const body = caseBody(tools, "remember_fact");

  it("the case parses (vacuity)", () => {
    expect(body.length).toBeGreaterThan(600);
    expect(body).toContain('case "remember_fact": {');
  });

  it("prepares through the choke point and writes no table in its own body", () => {
    expect(body).toContain("proposeMemoryFromChat(");
    expect(body.match(DB_WRITE)?.[0] ?? null).toBeNull();
    expect(body).not.toMatch(/paxMemory/);
  });

  it("canary: the old silent write would be caught", () => {
    const old = `case "remember_fact": {\n        await db.insert(paxMemory).values({ organizationId: org.id });\n        return { success: true };\n      }`;
    expect(old).toMatch(DB_WRITE);
  });

  it("no dispatch case in either switch writes the business memory", () => {
    for (const file of ["server/ai/tools.ts", "server/ai/supportAgent.ts"]) {
      const src = stripComments(read(file));
      expect(src.length, `${file} read`).toBeGreaterThan(50_000);
      expect(src.match(BUSINESS_MEMORY_WRITE)?.[0] ?? null, `${file} writes pax_business_memory`).toBeNull();
    }
    expect(`await db.insert(paxBusinessMemory).values(x)`).toMatch(BUSINESS_MEMORY_WRITE);
  });

  it("the only production writers of pax_business_memory live in paxCore.ts", () => {
    const writers: string[] = [];
    let scanned = 0;
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) {
          if (name !== "node_modules") walk(full);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(name) || /\.test\.tsx?$/.test(name)) continue;
        scanned++;
        if (/\.(insert|update|delete)\(\s*paxBusinessMemory\b/.test(stripComments(readFileSync(full, "utf8")))) {
          writers.push(path.relative(ROOT, full));
        }
      }
    };
    walk(path.join(ROOT, "server"));
    expect(scanned).toBeGreaterThan(200);
    expect(writers).toEqual(["server/services/paxCore.ts"]);
  });
});
