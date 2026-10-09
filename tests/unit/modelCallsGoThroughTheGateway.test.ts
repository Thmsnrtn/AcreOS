/**
 * Every production model call goes through the ONE metered gateway.
 *
 * The gateway is two functions in two files, one path:
 *   - server/services/aiRouter.ts      routeAITask — message-in/text-out tasks
 *                                      (task-tier model choice, response cache,
 *                                      quality cascade, ceiling, telemetry);
 *   - server/services/aiSpendGuard.ts  meteredChatCompletion /
 *                                      meteredAnthropicMessage — raw, tool-calling
 *                                      calls (ceiling before, telemetry after,
 *                                      Anthropic prompt cache), request untouched.
 *
 * A direct provider call anywhere else spends platform money that the cost
 * ceilings cannot see and cannot stop: they SUM ai_telemetry_events, and only
 * the gateway writes it. Audit slice 16 (F-16-1/-2) found exactly that — the
 * /api/va agent and two Pax tools billing gpt-4o invisibly — and proposed this
 * ratchet. 2026-10 cost efficiency took the count from 94 to 14; the remainder is
 * the per-file BASELINE below, which may only SHRINK.
 *
 * POPULATION (law 3). Every non-test .ts file under server/, parsed with the
 * TypeScript compiler — a parse never reads a comment or a string as a call,
 * and the docs in this repo describe forbidden calls constantly. Shapes:
 *   S1  x.chat.completions.create(...)          (any receiver, incl. calls, `!`)
 *   S2  x.messages.create(...)                  (Anthropic SDK)
 *   S3  x.embeddings.create / x.responses.create / x.images.generate /
 *       x.audio.transcriptions.create / x.audio.speech.create
 *   S4  a REFERENCE, not only a call: `.bind`, an alias, a callback value
 *   S5  element access: x.chat.completions["create"]
 *   S6  destructuring: const { create } = x.chat.completions
 *   S7  raw HTTP: a string literal naming a provider model endpoint
 *       (/v1/chat/completions, /v1/messages, /v1/embeddings, /v1/responses,
 *       /v1/audio/…, /v1/images/…)
 * Each shape has a canary below; the floors assert the walker read the tree
 * and that the gateway files themselves are seen (per-member vacuity).
 */
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";
import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import ts from "typescript";
import { listServerSources, parseSource, rel, unwrap } from "../helpers/serverPopulation";

// Walks every server source file; the budget is declared, not inherited.
vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

/** The gateway itself — the only files allowed to touch a provider SDK. */
const GATEWAY_FILES = ["server/services/aiRouter.ts", "server/services/aiSpendGuard.ts"];

/**
 * Direct model calls that remain outside the gateway, per file. MAY ONLY
 * SHRINK: converting a site lowers its number here in the same commit.
 * Why each remains (none is unmetered by accident — each is listed in
 * docs/company/cost-efficiency-2026-10.md):
 */
const BASELINE: Record<string, number> = {
  // Pax main turn: non-stream (402-retry helper) + stream + stream retry +
  // simulated-thinking stream. Already ceiling-gated (enforcePaxCostCeilings)
  // and self-metered (recordPaxTelemetry); streams cannot use the wrapper.
  "server/ai/executive.ts": 5,
  // Founder Solene chat — streaming calls (founder-side): the Anthropic SDK
  // stream and the OpenRouter SSE fetch. turnRunner gates them on the
  // platform ceiling; per-token telemetry is a follow-up.
  "server/services/solene/chat/anthropicClient.ts": 1,
  "server/services/solene/chat/openRouterClient.ts": 1,
  // Embeddings (≈$0.02/M tokens) — no price row yet; priced at the dearest
  // rate they would distort the ceilings. Next: add the rate, then meter.
  "server/services/embeddingClient.ts": 2,
  "server/services/dealPatternCloning.ts": 1,
  // Whisper transcription (OpenAI direct; OpenRouter does not proxy audio).
  "server/services/voiceCallAI.ts": 1,
  "server/routes-ai.ts": 1,
  "server/routes-field-scout.ts": 1,
  // DALL·E image generation (founder ad creative).
  "server/services/adCreativeService.ts": 1,
};

interface Hit {
  file: string;
  shape: string;
  line: number;
}

const SDK_SUFFIXES: Array<{ path: string[]; method: string; shape: string }> = [
  { path: ["chat", "completions"], method: "create", shape: "S1" },
  { path: ["messages"], method: "create", shape: "S2" },
  { path: ["embeddings"], method: "create", shape: "S3" },
  { path: ["responses"], method: "create", shape: "S3" },
  { path: ["images"], method: "generate", shape: "S3" },
  { path: ["images"], method: "edit", shape: "S3" },
  { path: ["transcriptions"], method: "create", shape: "S3" },
  { path: ["speech"], method: "create", shape: "S3" },
  // Other spending methods on the same namespaces (audit 2026-10-09).
  { path: ["chat", "completions"], method: "stream", shape: "S1" },
  { path: ["chat", "completions"], method: "parse", shape: "S1" },
  { path: ["chat", "completions"], method: "runTools", shape: "S1" },
  { path: ["messages"], method: "stream", shape: "S2" },
  { path: ["messages", "batches"], method: "create", shape: "S2" },
  // Legacy completions — and any `<alias>.completions.create` where `<alias>`
  // is a `client.chat` that escaped into a local (see S8).
  { path: ["completions"], method: "create", shape: "S3" },
];

/**
 * A provider model endpoint in a string literal. Not anchored on `/v1/`: an
 * OpenAI-compatible host without the prefix (`…/chat/completions`), a Gemini
 * `:generateContent`, or a URL assembled from pieces (`"/v1/" + "chat/completions"`)
 * spends exactly the same money.
 */
const RAW_ENDPOINT = /(\/v1\/(messages\b|embeddings|responses\b|audio\/|images\/)|\bchat\/completions\b|:(stream)?generateContent\b)/i;

/** Property names along a (possibly call-/non-null-wrapped) access chain, innermost last. */
function chainNames(e: ts.Expression): string[] {
  const names: string[] = [];
  let cur: ts.Expression = unwrap(e);
  for (;;) {
    if (ts.isPropertyAccessExpression(cur)) {
      names.unshift(cur.name.text);
      cur = unwrap(cur.expression);
    } else if (ts.isElementAccessExpression(cur) && ts.isStringLiteralLike(cur.argumentExpression)) {
      names.unshift(cur.argumentExpression.text);
      cur = unwrap(cur.expression);
    } else if (ts.isCallExpression(cur)) {
      cur = unwrap(cur.expression);
      names.unshift("()");
    } else {
      break;
    }
  }
  return names;
}

function endsWith(names: string[], suffix: string[]): boolean {
  if (names.length < suffix.length) return false;
  return suffix.every((s, i) => names[names.length - suffix.length + i] === s);
}

export function findModelCalls(file: string, text: string): Hit[] {
  const sf = parseSource(file, text);
  const hits: Hit[] = [];
  const at = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const visit = (node: ts.Node) => {
    // S1-S5: a property/element access naming an SDK model method — called or not.
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const method = ts.isPropertyAccessExpression(node)
        ? node.name.text
        : ts.isStringLiteralLike(node.argumentExpression)
          ? node.argumentExpression.text
          : null;
      if (method) {
        const owner = chainNames(node.expression);
        for (const s of SDK_SUFFIXES) {
          if (s.method === method && endsWith(owner, s.path)) {
            hits.push({ file, shape: s.shape, line: at(node) });
            break;
          }
        }
      }
    }
    // S8: the SDK namespace `x.chat.completions` escaping the access chain —
    // assigned, passed, or returned — so a later `alias.create(...)` is
    // invisible to S1. (`messages` is not checked: it is an ordinary array name.)
    if (ts.isPropertyAccessExpression(node) && endsWith(chainNames(node), ["chat", "completions"])) {
      const p = node.parent;
      const continued =
        (ts.isPropertyAccessExpression(p) || ts.isElementAccessExpression(p)) && p.expression === node;
      const wrapped = ts.isNonNullExpression(p) || ts.isParenthesizedExpression(p) || ts.isAsExpression(p);
      const destructured = ts.isVariableDeclaration(p) && ts.isObjectBindingPattern(p.name); // S6 counts it
      if (!continued && !wrapped && !destructured) hits.push({ file, shape: "S8", line: at(node) });
    }
    // S5b: a computed (non-literal) method name on chat.completions.
    if (
      ts.isElementAccessExpression(node) &&
      !ts.isStringLiteralLike(node.argumentExpression) &&
      endsWith(chainNames(node.expression), ["chat", "completions"])
    ) {
      hits.push({ file, shape: "S5", line: at(node) });
    }
    // S6: const { create } = x.chat.completions / x.messages
    if (ts.isVariableDeclaration(node) && ts.isObjectBindingPattern(node.name) && node.initializer) {
      const owner = chainNames(node.initializer);
      for (const el of node.name.elements) {
        const key = el.propertyName ?? el.name;
        if (!ts.isIdentifier(key)) continue;
        for (const s of SDK_SUFFIXES) {
          if (s.method === key.text && endsWith(owner, s.path)) {
            hits.push({ file, shape: "S6", line: at(el) });
            break;
          }
        }
      }
    }
    // S7: a provider model endpoint in a string literal (raw fetch).
    if (
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) &&
      RAW_ENDPOINT.test(node.text)
    ) {
      hits.push({ file, shape: "S7", line: at(node) });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return hits;
}

const FILES = listServerSources();
const ALL: Hit[] = [];
for (const p of FILES) ALL.push(...findModelCalls(rel(p), fs.readFileSync(p, "utf8")));

const outside: Record<string, number> = {};
for (const h of ALL) {
  if (GATEWAY_FILES.includes(h.file)) continue;
  outside[h.file] = (outside[h.file] ?? 0) + 1;
}

describe("population — the walker read the whole server tree", () => {
  it("reads every server source file (floor)", () => {
    expect(FILES.length).toBeGreaterThan(1000);
  });
  it("sees the provider calls inside the gateway itself (per-member vacuity)", () => {
    for (const g of GATEWAY_FILES) {
      expect(ALL.filter((h) => h.file === g).length, `${g}: the parser no longer sees its calls`).toBeGreaterThan(0);
    }
  });
  it("sees every baselined file's calls (a parser that stops matching reads as 'converted')", () => {
    for (const f of Object.keys(BASELINE)) expect(fs.existsSync(f), `${f} missing`).toBe(true);
  });
});

describe("ratchet — direct model calls outside the gateway may only shrink", () => {
  it("no file exceeds its baseline, and no new file appears", () => {
    const grown = Object.entries(outside)
      .filter(([f, n]) => n > (BASELINE[f] ?? 0))
      .map(([f, n]) => {
        const lines = ALL.filter((h) => h.file === f).map((h) => `${h.shape}@${h.line}`).join(", ");
        return `${f}: ${n} > baseline ${BASELINE[f] ?? 0} (${lines}) — route it through routeAITask or aiSpendGuard.meteredChatCompletion / meteredAnthropicMessage`;
      });
    expect(grown).toEqual([]);
  });
  it("the baseline is exact — when a site is converted, lower it in the same commit", () => {
    const shrunk = Object.entries(BASELINE)
      .filter(([f, n]) => (outside[f] ?? 0) < n)
      .map(([f, n]) => `${f}: ${outside[f] ?? 0} < baseline ${n} — lower BASELINE`);
    expect(shrunk).toEqual([]);
  });
  it("total", () => {
    const total = Object.values(outside).reduce((a, b) => a + b, 0);
    expect(total).toBe(Object.values(BASELINE).reduce((a, b) => a + b, 0));
  });
});

describe("canaries — equivalent representations of a model call (audit 2026-10-09)", () => {
  // Each of these spends model money exactly like chat.completions.create, and
  // each read as "no call" to the first version of this walker.
  const n = (src: string) => findModelCalls("fixture.ts", src).length;
  it("other SDK methods on the same namespaces: stream / parse / runTools / messages.stream / batches", () => {
    expect(n(`await client.chat.completions.stream({});`)).toBe(1);
    expect(n(`await client.beta.chat.completions.parse({});`)).toBe(1);
    expect(n(`await client.chat.completions.runTools({});`)).toBe(1);
    expect(n(`const s = anthropic.messages.stream({});`)).toBe(1);
    expect(n(`await anthropic.messages.batches.create({});`)).toBe(1);
    expect(n(`await client.completions.create({ model: "gpt-3.5-turbo-instruct", prompt: "" });`)).toBe(1);
  });
  it("the SDK namespace escaping into an alias, then called", () => {
    expect(n(`const completions = client.chat.completions; await completions.create({});`)).toBeGreaterThan(0);
    expect(n(`const c = client.chat.completions; await c.create({});`)).toBeGreaterThan(0);
    expect(n(`const chat = client.chat; await chat.completions.create({});`)).toBeGreaterThan(0);
  });
  it("a computed method name on chat.completions", () => {
    expect(n(`const m = "create"; await client.chat.completions[m]({});`)).toBe(1);
  });
  it("raw HTTP to a model endpoint without the /v1 prefix, or assembled from pieces", () => {
    expect(n(`await fetch("https://api.perplexity.ai/chat/completions", {});`)).toBe(1);
    expect(n(`await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent");`)).toBe(1);
    expect(n(`await fetch(base + "/v1/" + "chat/completions");`)).toBe(1);
  });
  it("still not: an ordinary messages array, a messages[i] index, a /v1/models probe", () => {
    expect(n(`const last = opts.messages[opts.messages.length - 1]; send(opts.messages);`)).toBe(0);
    expect(n(`await fetch("https://api.openai.com/v1/models");`)).toBe(0);
  });
});

describe("canaries — each extraction shape is seen; comments and strings are not calls", () => {
  const n = (src: string) => findModelCalls("fixture.ts", src).length;
  const shapes = (src: string) => findModelCalls("fixture.ts", src).map((h) => h.shape);
  it("S1 plain, called receiver, non-null receiver", () => {
    expect(shapes(`await client.chat.completions.create({ model: "m", messages: [] });`)).toEqual(["S1"]);
    expect(shapes(`await getOpenAI().chat.completions.create({});`)).toEqual(["S1"]);
    expect(shapes(`await client!.chat!.completions.create({});`)).toEqual(["S1"]);
  });
  it("S2 Anthropic messages.create", () => {
    expect(shapes(`const r = await anthropic.messages.create({ model: "claude", max_tokens: 1, messages: [] });`)).toEqual(["S2"]);
  });
  it("S3 embeddings / images / audio / responses", () => {
    expect(shapes(`o.embeddings.create({}); o.images.generate({}); o.audio.transcriptions.create({}); o.responses.create({}); o.audio.speech.create({});`)).toEqual(["S3", "S3", "S3", "S3", "S3"]);
  });
  it("S4 a reference that is not a call (bind, alias, callback)", () => {
    // The `create` reference AND the namespace passed as `this` (S8).
    expect(n(`const f = client.chat.completions.create.bind(client.chat.completions);`)).toBe(2);
    expect(n(`run(client.chat.completions.create);`)).toBe(1);
  });
  it("S5 element access", () => {
    expect(n(`client.chat.completions["create"]({});`)).toBe(1);
  });
  it("S6 destructuring", () => {
    expect(shapes(`const { create } = client.chat.completions; await create({});`)).toEqual(["S6"]);
    expect(shapes(`const { create: send } = anthropic.messages;`)).toEqual(["S6"]);
  });
  it("S7 raw HTTP to a model endpoint", () => {
    expect(shapes(`await fetch("https://api.openai.com/v1/chat/completions", {});`)).toEqual(["S7"]);
    expect(shapes("await fetch(`${base}/v1/messages`, {});")).toEqual(["S7"]);
    expect(shapes(`await fetch('https://api.openai.com/v1/audio/transcriptions');`)).toEqual(["S7"]);
  });
  it("comments and prose strings are not calls; a /v1/models probe is not a model call", () => {
    expect(n(`// client.chat.completions.create(...)\n/* anthropic.messages.create */`)).toBe(0);
    expect(n(`const doc = "call client.chat.completions.create directly";`)).toBe(0);
    expect(n(`await fetch("https://api.openai.com/v1/models");`)).toBe(0);
  });
  it("the gateway call shape is not a direct call", () => {
    expect(n(`await meteredChatCompletion(client, { model: "m", messages: [] }, { taskType: "x", orgId: 1, origin: "customer" });`)).toBe(0);
  });
});
