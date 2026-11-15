/**
 * Daily limits (PX-3, register P-1) — the gate: boundaries, the pure decision,
 * the receipt for a denial, and that BOTH dispatch switches really call it.
 *
 * BOUNDARIES (one rule, stated once and tested per cap):
 *   asks / browse   deny when used >= cap BEFORE the action → the cap-th action
 *                   is the last one allowed.
 *   credits / batch deny when used + this call > cap → landing EXACTLY on the
 *                   cap is allowed. A batch is refused WHOLE.
 *
 * The counting queries are behind the `seams` argument, so the decision is
 * exercised with stubbed counts and (for credits) a NON-ZERO stubbed price —
 * Pax direct sends cost 0 credits today (sendPricing), which is a fact about
 * pricing, not a reason the credit gate may go untested.
 *
 * Probes that must turn this red: change `used >= cap` to `used > cap` (the
 * asks / browse boundary tests fail); delete the stage-"ask" credit plan (the
 * credit tests fail); remove the checkPaxLimit call from either switch (the
 * wiring tests fail).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "../helpers/stripComments";

const H = vi.hoisted(() => ({
  recordPaxEffect: vi.fn(async (_e: Record<string, unknown>) => ({ written: true })),
  price: { credits: 5 },
}));

vi.mock("../../server/services/paxReceipts", () => ({ recordPaxEffect: H.recordPaxEffect }));
vi.mock("../../server/services/sendPricing", () => ({
  // A non-zero stand-in: real prices are 0 for Pax direct sends today.
  paxSendCost: (toolName: string, _args: Record<string, unknown>) =>
    ["send_sms", "send_email", "send_gmail"].includes(toolName)
      ? { recipients: 1, credits: H.price.credits, dollars: "$0.05", line: "stub" }
      : null,
}));

import {
  checkPaxLimit,
  paxLimitRefusalMessage,
  recordPaxLimitDenied,
  type PaxLimitKind,
  type PaxUsageSeams,
} from "../../server/services/paxLimits";
import { PAX_LIMIT_COPY } from "../../shared/pax-glossary";
import { defaultPaxLimits, type PaxLimits } from "../../shared/pax-controls";

const ROOT = path.resolve(__dirname, "../..");
const NOW = new Date("2026-11-12T15:00:00Z");

/** Seams that answer fixed counts and remember what they were asked. */
function seams(used: Partial<Record<PaxLimitKind, number>>) {
  const asked: Array<{ kind: PaxLimitKind; orgId: number; since: Date }> = [];
  const mk = (kind: PaxLimitKind) => async (orgId: number, since: Date) => {
    asked.push({ kind, orgId, since });
    return used[kind] ?? 0;
  };
  const s: PaxUsageSeams = {
    asksSince: mk("asks"),
    browseSince: mk("browse"),
    batchRowsSince: mk("batchRows"),
    creditsSince: mk("credits"),
  };
  return { s, asked };
}

const limits = (over: Partial<PaxLimits>): PaxLimits => ({ ...defaultPaxLimits(), ...over });

async function check(
  over: Partial<PaxLimits>,
  used: Partial<Record<PaxLimitKind, number>>,
  call: { toolName: string; args?: Record<string, unknown>; stage: "ask" | "run" },
) {
  const { s, asked } = seams(used);
  const verdict = await checkPaxLimit({
    orgId: 7,
    limits: limits(over),
    toolName: call.toolName,
    args: call.args ?? {},
    stage: call.stage,
    timezone: "America/Chicago",
    now: NOW,
    seams: s,
  });
  return { verdict, asked };
}

beforeEach(() => {
  H.recordPaxEffect.mockClear();
  H.price.credits = 5;
});

describe("asks — deny when used >= cap (the cap-th ask is the last allowed)", () => {
  const ask = (used: number, cap: number) =>
    check({ asksPerDay: cap }, { asks: used }, { toolName: "update_lead_status", stage: "ask" });

  it("allows below the cap, including the ask that lands exactly on it", async () => {
    expect((await ask(0, 3)).verdict).toEqual({ allowed: true });
    expect((await ask(2, 3)).verdict).toEqual({ allowed: true });
  });
  it("denies at the cap and over it, naming the cap and the count", async () => {
    for (const used of [3, 4, 50]) {
      const { verdict } = await ask(used, 3);
      expect(verdict).toMatchObject({ allowed: false, kind: "asks", cap: 3, used });
    }
  });
  it("a cap of 0 denies the first ask", async () => {
    expect((await ask(0, 0)).verdict).toMatchObject({ allowed: false, kind: "asks", cap: 0, used: 0 });
  });
  it("applies to any tool that reaches the ask gate, on either switch", async () => {
    for (const toolName of ["update_lead_status", "send_sms", "create_properties_batch", "apply_billing_fix", "fix_common_issue"]) {
      const { verdict } = await check({ asksPerDay: 1 }, { asks: 1 }, { toolName, stage: "ask" });
      expect(verdict, toolName).toMatchObject({ allowed: false, kind: "asks" });
    }
  });
});

describe("credits — deny when spent + this quote > cap (landing on the cap is allowed)", () => {
  const send = (spent: number, cap: number) =>
    check({ creditSpendPerDay: cap }, { credits: spent }, { toolName: "send_sms", args: { to: "+15555550100" }, stage: "ask" });

  it("allows an ask that exactly reaches the cap, and anything below", async () => {
    expect((await send(0, 10)).verdict).toEqual({ allowed: true });
    expect((await send(5, 10)).verdict).toEqual({ allowed: true }); // 5 + 5 == 10
  });
  it("denies the ask that would go past the cap, using the quote", async () => {
    expect((await send(6, 10)).verdict).toMatchObject({ allowed: false, kind: "credits", cap: 10, used: 6 });
    H.price.credits = 11;
    expect((await send(0, 10)).verdict, "a quote above the cap is denied on an empty day").toMatchObject({
      allowed: false,
      kind: "credits",
    });
  });
  it("a priced send is judged against the credit cap only for tools sendPricing prices", async () => {
    const { verdict, asked } = await check(
      { creditSpendPerDay: 0 },
      { credits: 999 },
      { toolName: "update_lead_status", stage: "ask" },
    );
    expect(verdict).toEqual({ allowed: true });
    expect(asked, "an unpriced tool must not read the spend").toEqual([]);
  });
  it("a zero price (today's real price for Pax direct sends) never trips a cap the day has not exceeded", async () => {
    H.price.credits = 0;
    expect((await send(0, 0)).verdict).toEqual({ allowed: true });
  });
  it("checks the asks cap first, then credits, and reports the one that trips", async () => {
    const both = { asksPerDay: 5, creditSpendPerDay: 10 };
    const call = { toolName: "send_sms", args: { to: "+15555550100" }, stage: "ask" as const };
    expect((await check(both, { asks: 5, credits: 10 }, call)).verdict).toMatchObject({ kind: "asks" });
    expect((await check(both, { asks: 1, credits: 10 }, call)).verdict).toMatchObject({ kind: "credits" });
  });
});

describe("browse — deny when used >= cap", () => {
  const browse = (used: number, cap: number) =>
    check({ browseCallsPerDay: cap }, { browse: used }, { toolName: "browse_web", args: { url: "https://example.com" }, stage: "run" });

  it("allows below the cap, including the cap-th visit", async () => {
    expect((await browse(0, 2)).verdict).toEqual({ allowed: true });
    expect((await browse(1, 2)).verdict).toEqual({ allowed: true });
  });
  it("denies at and over the cap", async () => {
    for (const used of [2, 3]) {
      expect((await browse(used, 2)).verdict).toMatchObject({ allowed: false, kind: "browse", cap: 2, used });
    }
  });
});

describe("batch rows — deny when used + rows in this call > cap; refused whole", () => {
  const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ apn: `A${i}`, county: "X", state: "AZ" }));
  const batch = (used: number, n: number, cap: number, stage: "ask" | "run" = "run") =>
    check({ batchRowsPerDay: cap }, { batchRows: used }, { toolName: "create_properties_batch", args: { properties: rows(n) }, stage });

  it("allows a batch that lands exactly on the cap", async () => {
    expect((await batch(5, 5, 10)).verdict).toEqual({ allowed: true });
    expect((await batch(0, 10, 10)).verdict).toEqual({ allowed: true });
  });
  it("denies a batch that would go one row past the cap — whole, never truncated", async () => {
    const { verdict } = await batch(6, 5, 10);
    expect(verdict).toMatchObject({ allowed: false, kind: "batchRows", cap: 10, used: 6 });
    // There is no 'allowed N rows' shape: the verdict carries no partial count.
    expect(Object.keys(verdict).sort()).toEqual(["allowed", "cap", "kind", "message", "used"]);
  });
  it("a batch parked for a tap is judged at the ask too, so the cap holds for orgs whose rail asks", async () => {
    expect((await batch(8, 5, 10, "ask")).verdict).toMatchObject({ allowed: false, kind: "batchRows" });
    expect((await batch(5, 5, 10, "ask")).verdict).toEqual({ allowed: true });
  });
  it("an empty or missing properties list counts zero rows", async () => {
    const r = await check({ batchRowsPerDay: 0 }, { batchRows: 0 }, { toolName: "create_properties_batch", args: {}, stage: "run" });
    expect(r.verdict).toEqual({ allowed: true });
  });
});

describe("tools no cap names are never gated; null caps cost no query", () => {
  const ALL_ZERO = limits({ asksPerDay: 0, creditSpendPerDay: 0, browseCallsPerDay: 0, batchRowsPerDay: 0 });

  it("at the run stage every tool but browse_web and create_properties_batch is allowed, reading nothing", async () => {
    for (const toolName of ["update_lead_status", "create_lead", "send_sms", "send_email", "get_leads", "apply_billing_fix", "unlock_stuck_jobs", "no_such_tool"]) {
      const { s, asked } = seams({ asks: 99, credits: 99, browse: 99, batchRows: 99 });
      const v = await checkPaxLimit({ orgId: 7, limits: ALL_ZERO, toolName, args: {}, stage: "run", timezone: "America/Chicago", now: NOW, seams: s });
      expect(v, toolName).toEqual({ allowed: true });
      expect(asked, `${toolName} read a counter`).toEqual([]);
    }
  });

  it("no limits at all (today) reads nothing and allows everything, at both stages", async () => {
    for (const stage of ["ask", "run"] as const) {
      for (const toolName of ["browse_web", "create_properties_batch", "send_sms", "update_lead_status"]) {
        const { s, asked } = seams({ asks: 99, credits: 99, browse: 99, batchRows: 99 });
        const v = await checkPaxLimit({
          orgId: 7,
          limits: defaultPaxLimits(),
          toolName,
          args: { properties: [{}, {}] },
          stage,
          timezone: "America/Chicago",
          now: NOW,
          seams: s,
        });
        expect(v, `${stage}/${toolName}`).toEqual({ allowed: true });
        expect(asked).toEqual([]);
      }
    }
  });

  it("a state with no limits object at all (a hand-built pre-PX-3 mock) is allowed, not a crash", async () => {
    const v = await checkPaxLimit({
      orgId: 7,
      limits: undefined as unknown as PaxLimits,
      toolName: "send_sms",
      args: {},
      stage: "ask",
      timezone: "America/Chicago",
      now: NOW,
      seams: seams({}).s,
    });
    expect(v).toEqual({ allowed: true });
  });
});

describe("'today' is the org's local day, org-scoped", () => {
  it("counters are asked from the org's local midnight, for that org only", async () => {
    // 15:00Z on 2026-11-12 is 09:00 CST (UTC-6): local midnight is 06:00Z that day.
    const { asked } = await check({ asksPerDay: 5 }, { asks: 0 }, { toolName: "update_lead_status", stage: "ask" });
    expect(asked).toHaveLength(1);
    expect(asked[0].orgId).toBe(7);
    expect(asked[0].since.toISOString()).toBe("2026-11-12T06:00:00.000Z");
  });

  it("just after UTC midnight it is still the previous local day", async () => {
    const { s, asked } = seams({});
    await checkPaxLimit({
      orgId: 7,
      limits: limits({ asksPerDay: 5 }),
      toolName: "update_lead_status",
      args: {},
      stage: "ask",
      timezone: "America/Chicago",
      now: new Date("2026-11-12T03:30:00Z"),
      seams: s,
    });
    expect(asked[0].since.toISOString()).toBe("2026-11-11T06:00:00.000Z");
  });
});

describe("the refusal and the receipt", () => {
  it("the verdict's words are the glossary's, through the builder, one per kind", () => {
    const kinds: PaxLimitKind[] = ["asks", "credits", "browse", "batchRows"];
    for (const k of kinds) expect(paxLimitRefusalMessage(k)).toBe(PAX_LIMIT_COPY.refusals[k]);
    expect(new Set(kinds.map(paxLimitRefusalMessage)).size).toBe(4);
  });

  it("a denial carries the builder's message", async () => {
    const { verdict } = await check({ asksPerDay: 1 }, { asks: 1 }, { toolName: "create_lead", stage: "ask" });
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) expect(verdict.message).toBe(paxLimitRefusalMessage("asks"));
  });

  it("recordPaxLimitDenied writes one pax_limit_denied receipt on the organization, naming the limit", async () => {
    const { verdict } = await check({ browseCallsPerDay: 2 }, { browse: 2 }, { toolName: "browse_web", stage: "run" });
    if (verdict.allowed) throw new Error("expected a denial");
    await recordPaxLimitDenied({ orgId: 7, toolName: "browse_web", verdict, origin: "chat", stance: "ask_before_sending", userId: "u-1" });
    expect(H.recordPaxEffect).toHaveBeenCalledTimes(1);
    const e = H.recordPaxEffect.mock.calls[0][0];
    expect(e).toMatchObject({
      orgId: 7,
      actor: "pax",
      origin: "chat",
      tool: "browse_web",
      action: "pax_limit_denied",
      entityType: "organization",
      entityId: 7,
      stance: "ask_before_sending",
      witnessed: false,
      userId: "u-1",
      after: { limit: "browse", cap: 2, used: 2 },
      description: PAX_LIMIT_COPY.deniedLine.browse,
    });
  });

  it("a receipt that cannot be written never changes the outcome (best-effort)", async () => {
    H.recordPaxEffect.mockRejectedValueOnce(new Error("db down"));
    await expect(
      recordPaxLimitDenied({
        orgId: 7,
        toolName: "create_lead",
        verdict: { allowed: false, kind: "asks", cap: 1, used: 1, message: paxLimitRefusalMessage("asks") },
        origin: "chat",
        stance: null,
      }),
    ).resolves.toBeUndefined();
  });

  it("a counter that cannot be read is an error, never a pass", async () => {
    await expect(
      checkPaxLimit({
        orgId: 7,
        limits: limits({ asksPerDay: 1 }),
        toolName: "create_lead",
        args: {},
        stage: "ask",
        timezone: "America/Chicago",
        now: NOW,
        seams: { asksSince: async () => { throw new Error("db down"); } },
      }),
    ).rejects.toThrow("db down");
  });
});

describe("wiring: both dispatch switches call the gate, in the right place", () => {
  const src = (rel: string) => stripComments(fs.readFileSync(path.join(ROOT, rel), "utf8"));
  const tools = src("server/ai/tools.ts");
  const support = src("server/ai/supportAgent.ts");

  it("both switches narrow the controls to the caller BEFORE the rail decision, and judge limits on the narrowed state", () => {
    for (const [name, s, fn] of [["tools.ts", tools, "export async function executeTool("], ["supportAgent.ts", support, "export async function executeSupportTool("]] as const) {
      const f = s.indexOf(fn);
      const effective = s.indexOf("effectiveControlsForMember(orgControls, options?.userId)", f);
      const decide = s.indexOf("decidePaxCall(controls, toolName)", f);
      expect(effective, `${name}: no effective-controls narrowing`).toBeGreaterThan(f);
      expect(decide, `${name}: rail decision missing`).toBeGreaterThan(effective);
      expect(s.indexOf("limits: controls.limits", f), `${name}: limits not judged on the narrowed controls`).toBeGreaterThan(effective);
    }
  });

  it("the ask check sits immediately before proposePendingAction on both switches, and refuses with the builder", () => {
    for (const [name, s, fn] of [["tools.ts", tools, "export async function executeTool("], ["supportAgent.ts", support, "export async function executeSupportTool("]] as const) {
      const f = s.indexOf(fn);
      const gate = s.indexOf('stage: "ask"', f);
      const propose = s.indexOf("await proposePendingAction(", f);
      expect(gate, `${name}: no ask-stage limit check`).toBeGreaterThan(f);
      expect(propose, `${name}: no proposePendingAction`).toBeGreaterThan(gate);
      expect(propose - gate, `${name}: the check is not adjacent to the park`).toBeLessThan(1200);
      const refusal = s.slice(gate, propose);
      expect(refusal).toContain("recordPaxLimitDenied(");
      expect(refusal).toContain("error: paxLimitRefusalMessage(askLimit.kind)");
    }
  });

  it("browse: the check runs before the browser is touched; batch: before the web fence reserves rows and before any create", () => {
    const f = tools.indexOf("export async function executeTool(");
    const browseCase = tools.indexOf('case "browse_web": {', f);
    const browseGate = tools.indexOf("checkPaxLimit(", browseCase);
    const browseCall = tools.indexOf("await browseWeb(url", browseCase);
    expect(browseGate).toBeGreaterThan(browseCase);
    expect(browseGate).toBeLessThan(browseCall);

    const batchCase = tools.indexOf('case "create_properties_batch": {', f);
    const batchGate = tools.indexOf("checkPaxLimit(", batchCase);
    const fence = tools.indexOf("checkWebSourcedRows(org.id, options?.turnId, propertiesToCreate.length)", batchCase);
    const create = tools.indexOf("storage.createProperty(", batchCase);
    expect(batchGate).toBeGreaterThan(batchCase);
    expect(batchGate, "a limit-denied call must not have consumed the web fence").toBeLessThan(fence);
    expect(batchGate).toBeLessThan(create);
  });

  it("the batch outcome carries the created count the receipt records (what the batch-rows cap counts)", () => {
    const f = tools.indexOf('case "create_properties_batch": {');
    const end = tools.indexOf('case "generate_offer": {', f);
    expect(tools.slice(f, end)).toContain("after: { rowsCreated: successCount }");
    const limitsSrc = stripComments(fs.readFileSync(path.join(ROOT, "server/services/paxLimits.ts"), "utf8"));
    expect(limitsSrc).toContain("'rowsCreated'");
    expect(limitsSrc).toContain("eq(activityLog.action, \"create_properties_batch\")");
  });
});
