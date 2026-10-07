/**
 * Solene senses what matters, and what matters reaches the founder.
 *
 *  - escalated Pax tickets count toward the support backlog, and the ask names them;
 *  - legal / compliance intake (TCPA, cease-and-desist, data deletion, litigation)
 *    becomes ONE urgent founder ask, from EVERY support intake path;
 *  - activation stalls are sensed and ranked with their measured count;
 *  - the heartbeat reads the table the tick actually writes;
 *  - every approval-card summary carries amount, recipient and recurrence.
 */
import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "../helpers/stripComments";

vi.mock("../../server/db", () => ({ db: {} }));

import {
  escalateLegalIntake,
  LEGAL_ASK_SUMMARY_PREFIX,
  type LegalIntakeDeps,
} from "../../server/services/supportLegalIntake";
import { rankMoves, sensesFromPulse } from "../../server/services/autopilot/decide";
import { heartbeatFrom, readLoopLastSuccess } from "../../server/services/autopilot/loopHeartbeat";

// loopHeartbeat.ts: 30-min tick cadence; withJobLock samples success rows hourly.
const LOOP_CADENCE_MS = 30 * 60 * 1000;
const SUCCESS_SAMPLE_MS = 60 * 60 * 1000;
import { summarizePendingHand } from "../../server/services/autopilot/pendingHandSummary";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => stripComments(fs.readFileSync(path.join(ROOT, rel), "utf8"));

const pulse = { mrr: 1000, trials: 9, complianceOpenCount: 0, envelopeStatus: "green" as const, dispatchesFlaggedLast24h: 0 };

// ── Legal / compliance intake ────────────────────────────────────────────────

// The classifier, observed through the public entry point (a no-op ask dep).
const kindOf = async (text: string) =>
  (
    await escalateLegalIntake(
      { table: "support_cases", recordId: 1, organizationId: 1, subject: text },
      { askFounder: async () => ({ askId: 1, deduped: false }), markTicketUrgent: async () => undefined },
    )
  ).kind ?? null;

describe("legal intake classifier", () => {
  it.each([
    ["You keep texting me. This is a TCPA violation.", "tcpa"],
    ["Put me on your do not call list", "tcpa"],
    ["Please treat this letter as a formal cease and desist", "cease_and_desist"],
    ["Delete my data and close my account", "data_deletion"],
    ["Under the CCPA I request access to my records", "data_deletion"],
    ["My attorney will be in touch", "litigation"],
  ])("%s → %s", async (text, kind) => {
    expect(await kindOf(text)).toBe(kind);
  });

  it("ordinary support text is not legal", async () => {
    for (const t of ["How do I import parcels?", "My map won't load", "Billing question about my invoice", "Can I delete a lead?"]) {
      expect(await kindOf(t)).toBeNull();
    }
  });
});

describe("escalateLegalIntake — one urgent founder ask", () => {
  function deps() {
    const asks = new Map<string, number>();
    const urgent: number[] = [];
    const d: LegalIntakeDeps = {
      // Mirrors askFounder's open-ask dedupe on (role, summary, body).
      askFounder: vi.fn(async (input) => {
        const k = `${input.questionSummary}|${input.questionBody}`;
        const existing = asks.get(k);
        if (existing) return { askId: existing, deduped: true };
        asks.set(k, asks.size + 1);
        return { askId: asks.size, deduped: false };
      }),
      markTicketUrgent: vi.fn(async (id) => {
        urgent.push(id);
      }),
    };
    return { d, asks, urgent };
  }

  it("a legal ticket opens an urgent founder ask naming the ticket, and marks it urgent", async () => {
    const { d, asks, urgent } = deps();
    const out = await escalateLegalIntake(
      { table: "support_tickets", recordId: 31, organizationId: 5, subject: "Cease and desist", description: "…" },
      d,
    );
    expect(out.escalated).toBe(true);
    const call = vi.mocked(d.askFounder).mock.calls[0][0];
    expect(call.urgency).toBe("urgent");
    expect(call.questionSummary.startsWith(LEGAL_ASK_SUMMARY_PREFIX)).toBe(true);
    expect(call.questionSummary).toContain("#31");
    expect(urgent).toEqual([31]);
    expect(asks.size).toBe(1);
  });

  it("sent once — a repeat for the same ticket dedupes onto the same ask", async () => {
    const { d, asks } = deps();
    const input = { table: "support_tickets" as const, recordId: 32, organizationId: 5, subject: "TCPA complaint", description: "" };
    const a = await escalateLegalIntake(input, d);
    const b = await escalateLegalIntake(input, d);
    expect(a.askId).toBe(b.askId);
    expect(asks.size).toBe(1);
  });

  it("a non-legal ticket asks nothing", async () => {
    const { d } = deps();
    expect((await escalateLegalIntake({ table: "support_cases", recordId: 1, organizationId: 1, subject: "Map help" }, d)).escalated).toBe(false);
    expect(d.askFounder).not.toHaveBeenCalled();
  });
});

describe("POPULATION: every support intake that stores customer text runs the legal classifier", () => {
  // Every place a support ticket/case row is created. Adding an intake path
  // without adding it here fails the census below.
  const INTAKE_SITES: Array<{ file: string; creates: RegExp; classified: boolean; why?: string }> = [
    { file: "server/ai/supportAgent.ts", creates: /insert\(supportTickets\)/, classified: true },
    { file: "server/services/supportBrain.ts", creates: /storage\.createSupportCase\(/, classified: true },
    { file: "server/services/paxLearning.ts", creates: /insert\(supportTickets\)/, classified: false, why: "system-authored self-healing escalation; no customer text" },
    { file: "server/routes-support-tickets.ts", creates: /insert\(supportTickets\)/, classified: false, why: "in-app bug reporter; structured repro fields, not correspondence" },
  ];

  it("the census matches the code", () => {
    const serverFiles: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
        const rel = path.join(dir, e.name);
        if (e.isDirectory()) walk(rel);
        else if (/\.ts$/.test(e.name) && !/\.test\.ts$/.test(e.name)) serverFiles.push(rel);
      }
    };
    walk("server");
    const creators = serverFiles.filter((f) => {
      const src = read(f);
      return /insert\(supportTickets\)/.test(src) || /\.createSupportCase\(/.test(src);
    });
    // storage layer: the repo method itself is the primitive, not an intake.
    const intakes = creators.filter((f) => !/^server\/storage(\.ts|\/)/.test(f));
    expect(intakes.sort()).toEqual(INTAKE_SITES.map((s) => s.file).sort());
  });

  it.each(INTAKE_SITES.filter((s) => s.classified))("$file creates AND classifies", ({ file, creates }) => {
    const src = read(file);
    expect(creates.test(src), `${file} no longer creates a support row — census is stale`).toBe(true);
    expect(src).toMatch(/escalateLegalIntake\(\{/);
  });
});

// ── Support backlog names the ticket; activation is ranked on its count ──────

describe("decide — escalated tickets and activation reach the ranking", () => {
  it("clear_support_backlog ranks on escalated tickets and names them", () => {
    const s = sensesFromPulse(pulse, { supportBacklog: 2, escalatedTicketIds: [41, 57] });
    const m = rankMoves(s).find((x) => x.kind === "clear_support_backlog");
    expect(m).toBeDefined();
    expect(m!.rationale).toContain("#41");
    expect(m!.rationale).toContain("#57");
  });

  it("unblock_activation ranks when activation is stalled, citing the measured count (not the trial total)", () => {
    const s = sensesFromPulse(pulse, { activationStalled: true, activationStalledCount: 3 });
    const m = rankMoves(s).find((x) => x.kind === "unblock_activation");
    expect(m).toBeDefined();
    expect(m!.rationale).toContain("3 signup(s)");
    expect(m!.rationale).not.toContain("9 trial");
  });

  it("the loop supplies activation + escalated tickets to the senses it ranks", () => {
    const src = read("server/services/solene/continuousLoop.ts");
    const call = src.slice(src.indexOf("const senses = sensesFromPulse("), src.indexOf("let moves = rankMoves(senses)"));
    expect(call.length).toBeGreaterThan(0);
    expect(call).toMatch(/activationStalled\b/);
    expect(call).toMatch(/activationStalledCount\b/);
    expect(call).toMatch(/escalatedTicketIds:\s*backlog\.escalatedTicketIds/);
    expect(src).toMatch(/await getStalledActivationCount\(\)/);
    expect(src).toMatch(/await getSupportBacklog\(\)/);
    // The compliance sense counts open data-subject requests too.
    const comp = src.slice(src.indexOf("async function safeLoadComplianceFindings"));
    expect(comp.slice(0, 1500)).toMatch(/getOpenDsarCount\(\)/);
  });
});

// ── Heartbeat ────────────────────────────────────────────────────────────────

describe("heartbeat reads the table the tick writes", () => {
  function fakeDb(health: Date | null, runs: Date | null) {
    let call = 0;
    return {
      select: () => ({
        from: () => ({
          where: async () => [{ at: call++ === 0 ? health : runs }],
        }),
      }),
    } as unknown as Parameters<typeof readLoopLastSuccess>[0];
  }

  it("a tick recorded only in job_health_logs (withJobLock) is a heartbeat", async () => {
    const t = new Date("2026-10-07T10:00:00Z");
    expect(await readLoopLastSuccess(fakeDb(t, null))).toEqual(t);
  });

  it("takes the latest of the two tables; null when neither has one", async () => {
    const a = new Date("2026-10-07T10:00:00Z");
    const b = new Date("2026-10-07T11:00:00Z");
    expect(await readLoopLastSuccess(fakeDb(a, b))).toEqual(b);
    expect(await readLoopLastSuccess(fakeDb(null, null))).toBeNull();
  });

  it("stale allows for withJobLock's hourly success sampling", () => {
    const last = new Date("2026-10-07T10:00:00Z");
    const ok = last.getTime() + 2 * LOOP_CADENCE_MS + SUCCESS_SAMPLE_MS - 1000;
    expect(heartbeatFrom(last, ok).stale).toBe(false);
    expect(heartbeatFrom(last, ok + 2000).stale).toBe(true);
    expect(heartbeatFrom(null, ok).lastCycleAt).toBeNull();
  });

  it("the route reads through loopHeartbeat, not job_runs alone", () => {
    const src = read("server/routes-autopilot.ts");
    const block = src.slice(src.indexOf('"/api/founder/autopilot/live"'), src.indexOf("supportThresholdLine"));
    expect(block).toMatch(/readLoopLastSuccess\(db\)/);
    expect(block).not.toMatch(/from\(jobRuns\)/);
  });
});

// ── Approval-card summaries ──────────────────────────────────────────────────

describe("approval cards show amount, recipient and recurrence", () => {
  it("the two cards the audit found", () => {
    const ad = summarizePendingHand("run_ad_campaign", { platform: "meta", daily_budget_cents: 2500, audience: "TX landowners" });
    expect(ad).toContain("$25.00/day");
    expect(ad).toContain("recurring daily until stopped");
    expect(ad).toContain("meta");
    const refund = summarizePendingHand("apply_refund", { charge_id: "ch_123", amount_cents: 1999 });
    expect(refund).toContain("$19.99");
    expect(refund).toContain("ch_123");
    expect(refund).toContain("one-time");
  });

  it("POPULATION: every registered hand's summary names a recipient, its recurrence, and — if it moves money — the amount", async () => {
    const dir = path.join(ROOT, "server/services/autopilot/hands");
    const NOT_HANDS = new Set(["index.ts", "registry.ts", "types.ts", "counterpartyMatch.ts"]);
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && !NOT_HANDS.has(f));
    for (const f of files) await import(path.join(dir, f));
    const { listHandSpecs } = await import("../../server/services/autopilot/hands/registry");
    const specs = listHandSpecs();
    expect(specs.length, "every hand file registered a hand").toBe(files.length);

    for (const spec of specs) {
      const schema = spec.schema.input_schema as { properties: Record<string, { type?: string; enum?: string[] }>; required?: string[] };
      const input: Record<string, unknown> = {};
      for (const k of schema.required ?? []) {
        const p = schema.properties[k] ?? {};
        input[k] = p.enum ? p.enum[0]
          : p.type === "number" ? 1234
          : p.type === "object" ? { name: "Jane Doe", address_line1: "1 Main", city: "Austin", state: "TX", zip: "78701" }
          : `x-${k}`;
      }
      // The context the executor resolves: a hand whose request carries no
      // amount gets it from the record it acts on (dunning event).
      const ctx = { movesMoney: spec.movesMoney, amountCents: input.amount_cents ?? input.daily_budget_cents ? undefined : 4999 };
      const line = summarizePendingHand(spec.name, input, ctx);
      expect(line, `${spec.name}: no recipient`).not.toContain("no recipient given");
      expect(line, `${spec.name}: no recurrence`).toMatch(/one-time|recurring/);
      if (spec.movesMoney) {
        expect(line, `${spec.name}: moves money but shows no amount`).toMatch(/\$\d/);
        // And with nothing resolved it says so, never "no money moves".
        expect(summarizePendingHand(spec.name, { ...input, amount_cents: undefined, daily_budget_cents: undefined }, { movesMoney: true }))
          .not.toContain("no money moves");
      }
    }
  });
});
