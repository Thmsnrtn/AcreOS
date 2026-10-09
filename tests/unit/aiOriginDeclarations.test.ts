/**
 * Every metered AI call declares who triggered it, and the declaration is true.
 *
 * The shared monthly AI allowance (founder decision 2026-10-08) counts spend
 * recorded with origin "customer" and nothing else — and every caller declares
 * its own origin (routeAITask defaults to "customer" unless skipQuota). So:
 *
 *   - a call reachable ONLY from background jobs may not claim "customer"
 *     (it would drain an allowance for work the customer never asked for);
 *   - a call reachable ONLY from customer-facing routes may not claim
 *     "background" (it would hand out AI the allowance never sees).
 *
 * A call reached by BOTH must forward its origin from its caller. The literal
 * sites that are reached by both — or by neither root the walker knows, e.g.
 * founder routes — are listed below with their counts; the list may only
 * shrink (fix the occurrence, then delete its line).
 *
 * Population: tests/helpers/aiOriginGraph.ts walks every server/ and shared/
 * file. Floors on units, roots and sites; a per-entrypoint cross-check that
 * the AST found every call a text scan finds; the entrypoint table checked
 * against the definitions; canaries for every shape the walker relies on.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import ts from "typescript";
import { buildOriginGraph, DEFINING_MODULES, METERED_ENTRYPOINTS, type MeteredSite } from "../helpers/aiOriginGraph";
import { stripComments } from "../helpers/stripComments";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";
import { vi } from "vitest";

vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

const ROOT = path.resolve(__dirname, "../..");

/**
 * Literal-origin sites the walker cannot pin to one side (reached by both a
 * route and a job, or by neither). `file#unit#entry#declared` → count.
 * RATCHET: entries may be removed or their counts lowered, never added/raised.
 */
const AMBIGUOUS_LITERAL_BASELINE: Record<string, number> = {
  "server/ai/executive.ts#finalizePaxOutput#meteredChatCompletion#customer": 2,
  "server/ai/executive.ts#scoreAndLearnFromResponse#routeAITask#background": 1,
  "server/ai/executive.ts#compactConversationIfNeeded#meteredChatCompletion#customer": 1,
  "server/ai/paxSupportResolver.ts#defaultCompletionFn#meteredChatCompletion#customer": 1,
  "server/ai/supportAgent.ts#executeSupportTool#meteredChatCompletion#customer": 1,
  "server/services/agent-skills.ts#execute#meteredChatCompletion#customer": 3,
  "server/services/aiOfferService.ts#generateOfferSuggestions#routeAITask#customer": 1,
  "server/services/aiOfferService.ts#generateOfferLetter#routeAITask#customer": 1,
  "server/services/atlasMemory.ts#extractMemoriesFromConversation#meteredChatCompletion#background": 1,
  "server/services/buyerMatchingAI.ts#analyzeBuyerPreferences#meteredChatCompletion#customer": 1,
  "server/services/campaignOptimizer.ts#generateOptimizations#meteredChatCompletion#customer": 1,
  "server/services/complianceGuardian.ts#generateComplianceReport#meteredChatCompletion#customer": 1,
  "server/services/complianceValidator.ts#validateCompliance#routeAITask#background": 1,
  "server/services/directorAgent.ts#reason#routeReasoningTask#customer": 1,
  "server/services/llmJudge.ts#runJudge#routeAITask#customer": 1,
  "server/services/negotiationOrchestrator.ts#runNegotiationAssistant#meteredChatCompletion#customer": 1,
  "server/services/paxLearning.ts#learnFromHumanResolution#meteredChatCompletion#background": 1,
  "server/services/sequenceOptimizer.ts#generateOptimizationSuggestions#meteredChatCompletion#customer": 1,
  "server/services/voiceCallAI.ts#analyzeTranscript#meteredChatCompletion#background": 1,
  "server/services/voiceCallAI.ts#extractActionItems#meteredChatCompletion#background": 1,
  "server/services/voiceCallAI.ts#extractKeyData#meteredChatCompletion#background": 1,
  "server/services/voiceCallAI.ts#generateCoachingInsights#meteredChatCompletion#background": 1,
  "server/services/voiceLearning.ts#analyzeStyle#meteredChatCompletion#customer": 1,
};

const key = (s: MeteredSite) => `${s.file}#${s.unit}#${s.entry}#${s.declared}`;
const where = (s: MeteredSite) => `${s.file}:${s.line} ${s.entry} in ${s.unit} declares ${s.declared}${s.implicit ? " (implicitly)" : ""}`;

function violations(sites: MeteredSite[]) {
  const jobClaimsCustomer = sites.filter((s) => s.declared === "customer" && s.reachedByJob && !s.reachedByCustomer);
  const routeClaimsBackground = sites.filter((s) => s.declared === "background" && s.reachedByCustomer && !s.reachedByJob);
  return { jobClaimsCustomer, routeClaimsBackground };
}

const files = execSync("git ls-files server shared", { cwd: ROOT, encoding: "utf8" })
  .split("\n")
  .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f));
const sources: Record<string, string> = {};
for (const f of files) sources[f] = fs.readFileSync(path.join(ROOT, f), "utf8");
const graph = buildOriginGraph(sources);

describe("population floors (measured 2026-10-09: 13,165 units, 1,918 customer roots, 487 job roots, 161 sites)", () => {
  it("read the tree", () => {
    expect(files.length).toBeGreaterThan(1500);
    expect(graph.units).toBeGreaterThan(12_000);
    expect(graph.customerRoots).toBeGreaterThan(1_800);
    expect(graph.jobRoots).toBeGreaterThan(450);
    expect(graph.edges).toBeGreaterThan(25_000);
    expect(graph.sites.length).toBeGreaterThanOrEqual(150);
  });

  it("per entrypoint, the AST found every call a comment-stripped text scan finds", () => {
    for (const entry of Object.keys(METERED_ENTRYPOINTS)) {
      const re = new RegExp(`(?<![\\w.])${entry}\\s*(<[^>]*>)?\\(`, "g");
      let textCount = 0;
      for (const f of files) {
        if (DEFINING_MODULES.includes(f)) continue;
        textCount += (stripComments(sources[f]).match(re) ?? []).length;
      }
      const astCount = graph.sites.filter((s) => s.entry === entry).length;
      expect(astCount, `${entry}: AST ${astCount} vs text ${textCount}`).toBe(textCount);
    }
  });

  it("the entrypoint table matches the definitions (argument index → meta/config/input)", () => {
    const defs = new Map<string, string[]>();
    for (const m of DEFINING_MODULES) {
      const sf = ts.createSourceFile(m, sources[m], ts.ScriptTarget.Latest, true);
      sf.forEachChild((n) => {
        if (ts.isFunctionDeclaration(n) && n.name && n.modifiers?.some((x) => x.kind === ts.SyntaxKind.ExportKeyword)) {
          defs.set(n.name.text, n.parameters.map((p) => p.name.getText(sf) + ":" + (p.type?.getText(sf) ?? "")));
        }
      });
    }
    for (const [entry, idx] of Object.entries(METERED_ENTRYPOINTS)) {
      const params = defs.get(entry);
      expect(params, `${entry} is not an exported function of the defining modules`).toBeDefined();
      expect(params![idx], `${entry} arg ${idx}`).toMatch(/^(meta|config|input):/);
    }
    // Completeness: every exported function taking a MeteredCallMeta or an
    // AIRouterConfig is a metered entrypoint in the table.
    // selectProviderAndModel* choose a model from a config and make no call.
    const NOT_METERED = new Set(["selectProviderAndModel", "selectProviderAndModelAsync"]);
    const takers = [...defs].filter(([n]) => !NOT_METERED.has(n)).filter(([, ps]) => ps.some((p) => /:\s*(MeteredCallMeta|AIRouterConfig)\b/.test(p))).map(([n]) => n);
    for (const t of takers) expect(Object.keys(METERED_ENTRYPOINTS), `${t} takes metered config but is not gated`).toContain(t);
  });
});

describe("canaries: each shape the walker relies on, with the defect hidden inside", () => {
  const svc = (body: string) => `import { meteredChatCompletion } from "./aiSpendGuard";\nexport async function draft(orgId: number) { ${body} }`;
  const call = (meta: string) => `return meteredChatCompletion(client, {}, ${meta});`;
  const DEF = { "server/services/aiSpendGuard.ts": "export async function meteredChatCompletion(client: any, params: any, meta: MeteredCallMeta) {}" };

  it("a job → service claiming customer is a violation (static import)", () => {
    const g = buildOriginGraph({
      ...DEF,
      "server/services/x.ts": svc(call(`{ taskType: "t", orgId, origin: "customer" }`)),
      "server/jobs/nightly.ts": `import { draft } from "../services/x";\nexport async function run() { await draft(1); }`,
    });
    expect(violations(g.sites).jobClaimsCustomer.map(where)).toHaveLength(1);
  });

  it("…through a dynamic import and an implicit routeAITask default", () => {
    const g = buildOriginGraph({
      "server/services/aiRouter.ts": "export async function routeAITask(task: any, config: AIRouterConfig = {}) {}",
      "server/services/x.ts": `import { routeAITask } from "./aiRouter";\nexport async function draft(orgId: number) { return routeAITask({}, { orgId }); }`,
      "server/services/sched.ts": `export function tick() { withJobLock("x", async () => { const { draft } = await import("./x"); await draft(1); }); }`,
    });
    const v = violations(g.sites).jobClaimsCustomer;
    expect(v).toHaveLength(1);
    expect(v[0].implicit).toBe(true);
  });

  it("a customer route → service claiming background is a violation (wrapped handler, class method)", () => {
    const g = buildOriginGraph({
      ...DEF,
      "server/services/x.ts": `import { meteredChatCompletion } from "./aiSpendGuard";\nexport class X { async draft(orgId: number) { ${call(`{ taskType: "t", orgId, origin: "background" }`)} } }\nexport const xs = new X();`,
      "server/routes-x.ts": `import { xs } from "./services/x";\nexport function r(api: any) { api.post("/api/x", auth, asyncHandler(async (req: any, res: any) => { await xs.draft(1); })); }`,
    });
    expect(violations(g.sites).routeClaimsBackground).toHaveLength(1);
  });

  it("a founder route is not a customer root", () => {
    const g = buildOriginGraph({
      ...DEF,
      "server/services/x.ts": svc(call(`{ taskType: "t", orgId, origin: "background" }`)),
      "server/routes-y.ts": `import { draft } from "./services/x";\nexport function r(api: any) { api.post("/api/founder/x", async (req: any, res: any) => { await draft(1); }); }`,
    });
    expect(g.sites[0].reachedByCustomer).toBe(false);
  });

  it("controls: a forwarded origin and a call with no org are not violations", () => {
    const g = buildOriginGraph({
      ...DEF,
      "server/services/x.ts": `import { meteredChatCompletion } from "./aiSpendGuard";\nexport async function draft(orgId: number, origin: any) { ${call(`{ taskType: "t", orgId, origin }`)} }\nexport async function plat() { ${call(`{ taskType: "t", origin: "customer" }`)} }`,
      "server/jobs/nightly.ts": `import { draft, plat } from "../services/x";\nexport async function run() { await draft(1, "background"); await plat(); }`,
    });
    expect(g.sites.map((s) => s.declared).sort()).toEqual(["forwarded", "n/a"]);
    expect(violations(g.sites).jobClaimsCustomer).toHaveLength(0);
  });

  it("comments are never read as calls", () => {
    const g = buildOriginGraph({
      ...DEF,
      "server/services/x.ts": `// meteredChatCompletion(client, {}, { orgId, origin: "customer" })\nexport const a = 1;`,
    });
    expect(g.sites).toHaveLength(0);
  });
});

describe("the declarations on the real tree", () => {
  const v = violations(graph.sites);

  it("no call reached only by background jobs claims customer", () => {
    expect(v.jobClaimsCustomer.map(where), v.jobClaimsCustomer.map(where).join("\n")).toEqual([]);
  });

  it("no call reached only by customer routes claims background", () => {
    expect(v.routeClaimsBackground.map(where), v.routeClaimsBackground.map(where).join("\n")).toEqual([]);
  });

  it("ambiguous literal sites only shrink (no new ones, no stale baseline)", () => {
    const actual: Record<string, number> = {};
    for (const s of graph.sites) {
      if ((s.declared === "customer" || s.declared === "background") && s.reachedByCustomer === s.reachedByJob) {
        actual[key(s)] = (actual[key(s)] ?? 0) + 1;
      }
    }
    const grown = Object.entries(actual).filter(([k, n]) => n > (AMBIGUOUS_LITERAL_BASELINE[k] ?? 0));
    expect(grown, `new literal-origin sites reached by both roots or neither — forward the caller's origin instead:\n${grown.map(([k, n]) => `${k} ×${n}`).join("\n")}`).toEqual([]);
    const stale = Object.entries(AMBIGUOUS_LITERAL_BASELINE).filter(([k, n]) => (actual[k] ?? 0) < n);
    expect(stale, `fixed — lower or delete these baseline entries:\n${stale.map(([k]) => k).join("\n")}`).toEqual([]);
  });

  it("Pax tools forward the run's origin: a scheduled or inbound-signal run is background", async () => {
    const { aiOriginForTool } = await import("../../server/ai/tools");
    expect(aiOriginForTool("scheduled")).toBe("background");
    expect(aiOriginForTool("inbound_signal")).toBe("background");
    expect(aiOriginForTool("chat")).toBe("customer");
    expect(aiOriginForTool("support")).toBe("customer");
  });
});
