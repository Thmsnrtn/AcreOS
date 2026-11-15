/**
 * E2 slice 1 leg 2 — the sectioned morning brief's composer, and the package
 * sweeps over every surface this leg adds (package 2026-11-03 §Tests 2, 7).
 *
 * The composer is pure: these pin which sentences are true for which counts.
 * The realdb twin (morningBriefSections.realdb.test.ts) proves the route
 * feeds it real rows and keeps the archive org-scoped.
 *
 * The sweeps read the leg's whole POPULATION — the composer, the client card,
 * and the brief span of server/routes-today.ts (located by its markers, with
 * a length floor so a moved marker cannot empty the span silently) — and
 * assert:
 *   - no send transport and no approval-kernel WRITE is reachable from them
 *     (the brief prepares nothing and sends nothing; it only READS the
 *     kernel's live asks);
 *   - no model identifier appears in their code (D15: the actor is Pax).
 * Each sweep has a canary proving its predicate still bites.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { stripComments } from "../helpers/stripComments";

vi.mock("../../server/db", () => ({ db: {} }));

const { composeBriefSections, localBriefDate, parseTzOffset } = await import(
  "../../server/services/morningBriefSections"
);
const { APPROVAL_REQUIRED_TOOLS } = await import("../../server/services/approvalKernel");

const NOW = new Date("2026-11-03T13:00:00.000Z");
const PARKABLE = [...new Set([...APPROVAL_REQUIRED_TOOLS, "send_borrower_reminder"])];
const ZERO = {
  asOf: NOW,
  paymentsPosted24h: 0,
  leadsCreated24h: 0,
  dealsUpdated24h: 0,
  lateNotes: 0,
  notePaymentsDue7d: 0,
  openAlerts: 0,
  leadsUncontacted14d: 0,
  pendingAsksByTool: {},
};

describe("composeBriefSections — sections from real counts", () => {
  it("puts each count in its section, named for what it counts", () => {
    const s = composeBriefSections({
      ...ZERO,
      paymentsPosted24h: 2,
      leadsCreated24h: 1,
      dealsUpdated24h: 3,
      lateNotes: 4,
      notePaymentsDue7d: 5,
      openAlerts: 6,
      leadsUncontacted14d: 7,
      pendingAsksByTool: { send_email: 2, send_borrower_reminder: 1 },
    });
    expect(s.changed.map((i) => i.text)).toEqual([
      "2 payments posted in the last 24 hours",
      "1 new lead in the last 24 hours",
      "3 deals created or updated in the last 24 hours",
    ]);
    expect(s.needsYou.map((i) => i.text)).toEqual([
      "4 notes late or delinquent",
      "5 note payments due in the next 7 days",
      "6 open alerts",
      "7 leads not contacted in 14+ days",
    ]);
    expect(s.prepared.map((i) => i.text)).toEqual([
      "1 borrower payment reminder prepared, waiting for your tap",
      "2 emails prepared, waiting for your tap",
    ]);
    expect(s.empty).toBe(false);
  });

  it("carries provenance on every item — a section item without source + as-of is a bug", () => {
    const s = composeBriefSections({
      ...ZERO,
      paymentsPosted24h: 1,
      lateNotes: 1,
      pendingAsksByTool: { send_sms: 1 },
    });
    const all = [...s.changed, ...s.needsYou, ...s.prepared];
    expect(all.length).toBe(3);
    for (const item of all) {
      expect(item.source).toMatch(/^[a-z_]+$/);
      expect(item.asOf).toBe(NOW.toISOString());
      expect(item.count).toBeGreaterThan(0);
      expect(item.href.startsWith("/")).toBe(true);
    }
  });

  it("omits zeros — a zero is not news and is never padded", () => {
    const s = composeBriefSections({ ...ZERO, lateNotes: 2, pendingAsksByTool: { send_email: 0 } });
    expect(s.changed).toEqual([]);
    expect(s.prepared).toEqual([]);
    expect(s.needsYou.map((i) => i.id)).toEqual(["notes-late"]);
  });

  it("says an all-empty brief is empty, with nothing in it", () => {
    const s = composeBriefSections(ZERO);
    expect(s).toMatchObject({ changed: [], needsYou: [], prepared: [], unreadable: [], empty: true });
  });

  it("never reads a failed query as empty — the section is reported unreadable", () => {
    const s = composeBriefSections({ ...ZERO, unreadable: ["prepared", "changed"] });
    expect(s.unreadable).toEqual(["changed", "prepared"]);
    expect(s.empty).toBe(false);
  });

  it("reports an unknown parked tool generically rather than dropping it", () => {
    const s = composeBriefSections({ ...ZERO, pendingAsksByTool: { some_future_tool: 3 } });
    expect(s.prepared).toHaveLength(1);
    expect(s.prepared[0].text).toBe("3 prepared actions waiting for your tap");
  });

  it("names every tool that can park as an ask (approval kernel + borrower ladder)", () => {
    expect(PARKABLE.length).toBeGreaterThanOrEqual(9); // vacuity floor on the population
    const s = composeBriefSections({ ...ZERO, pendingAsksByTool: Object.fromEntries(PARKABLE.map((t) => [t, 2])) });
    expect(s.prepared).toHaveLength(PARKABLE.length);
    for (const item of s.prepared) {
      // The generic fallback is for a tool nobody named; every parkable tool is named.
      expect(item.text).not.toBe("2 prepared actions waiting for your tap");
      expect(item.text).toMatch(/^2 .+ prepared, waiting for your tap$/);
    }
  });

  it("never uses words for a measurement it does not take", () => {
    const s = composeBriefSections({
      ...ZERO,
      paymentsPosted24h: 9,
      leadsCreated24h: 9,
      dealsUpdated24h: 9,
      lateNotes: 9,
      notePaymentsDue7d: 9,
      openAlerts: 9,
      leadsUncontacted14d: 9,
      pendingAsksByTool: Object.fromEntries(PARKABLE.map((t) => [t, 9])),
    });
    const text = [...s.changed, ...s.needsYou, ...s.prepared].map((i) => i.text).join("\n");
    expect(text).not.toMatch(/wrote back|overnight|saved|handled|\bsent\b|cleared|received|replied/i);
  });
});

describe("localBriefDate / parseTzOffset", () => {
  it("keys the day by the viewer's local calendar date", () => {
    // 02:30 UTC on the 4th is still the 3rd in New York (offset +300) and
    // already the 4th in Tokyo (offset -540).
    const t = new Date("2026-11-04T02:30:00.000Z");
    expect(localBriefDate(t, 300)).toBe("2026-11-03");
    expect(localBriefDate(t, -540)).toBe("2026-11-04");
    expect(localBriefDate(t, 0)).toBe("2026-11-04");
  });

  it("accepts only real offsets — absent or impossible values are refused, not guessed", () => {
    expect(parseTzOffset("300")).toBe(300);
    expect(parseTzOffset("-840")).toBe(-840);
    expect(parseTzOffset("720")).toBe(720);
    for (const bad of [undefined, null, "", "abc", "1e12", "30.5", "721", "-841", "NaN"]) {
      expect(parseTzOffset(bad)).toBeNull();
    }
  });
});

// ── Sweeps over the leg's population ──────────────────────────────────────

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

function routeSpan(): string {
  const src = read("server/routes-today.ts");
  const start = src.indexOf("// ── The sectioned morning brief (E2 slice 1 leg 2)");
  const end = src.indexOf("// ── PATCH /api/today/queue/:id");
  if (start < 0 || end < 0 || end <= start) return "";
  // The GET handler's call into the builder lives above the span; include it.
  const call = src.indexOf("const briefCard = await buildBriefCard(");
  const callSpan = call >= 0 ? src.slice(call, src.indexOf("});", call) + 3) : "";
  return src.slice(start, end) + "\n" + callSpan;
}

const POPULATION: Array<{ label: string; text: () => string; floor: number }> = [
  { label: "server/services/morningBriefSections.ts", text: () => read("server/services/morningBriefSections.ts"), floor: 2_000 },
  { label: "client/src/components/today/MorningBrief.tsx", text: () => read("client/src/components/today/MorningBrief.tsx"), floor: 4_000 },
  { label: "server/routes-today.ts (brief span)", text: routeSpan, floor: 3_500 },
  { label: "server/routes-today-briefs.ts", text: () => read("server/routes-today-briefs.ts"), floor: 3_000 },
];

/** A send transport, or a kernel/ask WRITE — anything that acts on the world. */
const ACTS_ON_THE_WORLD =
  /\b(emailService|smsService|sendEmail|sendSms|sendGmail|sendSlackMessage|twilio|sendgrid|postmark|resend|lob|postgrid|executeTool|executeSupportTool|executeApprovedAsk|proposePendingAction|approvePendingAction|revisePendingAction|rejectPendingAction|sweepExpiredPendingActions|sweepStaleApprovalClaims|sendManualReminder|dispatchReminder)\b/i;

/** A direct write to the kernel's own tables — the brief may only READ them. */
const KERNEL_TABLE_WRITE = /\.(insert|update|delete)\(\s*(pendingActions|paxSends)\b/;

/** A model identifier (D15 — the actor is Pax; the model is never named). */
const MODEL_ID =
  /\b(gpt-?\d|o\d-|claude|anthropic|openai|deepseek|llama|gemini|mistral|qwen|openrouter|sonnet|opus|haiku|grok)\b/i;

describe("sweeps — the brief acts on nothing and names no model", () => {
  for (const member of POPULATION) {
    it(`${member.label}: was read (vacuity floor)`, () => {
      expect(member.text().length).toBeGreaterThan(member.floor);
    });
    it(`${member.label}: no send transport or kernel write`, () => {
      const code = stripComments(member.text());
      expect(code.match(ACTS_ON_THE_WORLD)?.[0] ?? null).toBeNull();
      expect(code.match(KERNEL_TABLE_WRITE)?.[0] ?? null).toBeNull();
    });
    it(`${member.label}: no model identifier`, () => {
      const code = stripComments(member.text());
      expect(code.match(MODEL_ID)?.[0] ?? null).toBeNull();
    });
  }

  it("canary: the predicates bite on the shapes they forbid", () => {
    expect(stripComments(`await emailService.send({ to });`)).toMatch(ACTS_ON_THE_WORLD);
    expect(stripComments(`await approvePendingAction({ id });`)).toMatch(ACTS_ON_THE_WORLD);
    expect(stripComments(`await db.update(pendingActions).set({ status: "approved" });`)).toMatch(KERNEL_TABLE_WRITE);
    expect(stripComments(`await db.insert( paxSends ).values(row);`)).toMatch(KERNEL_TABLE_WRITE);
    expect(stripComments(`await db.select().from(pendingActions);`)).not.toMatch(KERNEL_TABLE_WRITE);
    expect(stripComments(`const label = "deepseek-chat";`)).toMatch(MODEL_ID);
    // and a comment naming them is the record, not the defect
    expect(stripComments(`// emailService was never imported here (deepseek)\nconst x = 1;`)).not.toMatch(ACTS_ON_THE_WORLD);
  });
});
