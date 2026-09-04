/**
 * Stop must stop the agent, not just the screen.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 * The client had a proper AbortController and a Stop button. The SSE route had
 * no `req.on("close")` and threaded no signal into `processChatStream`. So on
 * abort the socket died, every `res.write` became a silent no-op, and the
 * async generator ran to completion: more model calls, more spend, and more
 * `executeTool` invocations.
 *
 * The approval kernel gates five send/payment tools. `create_deal`,
 * `update_deal`, `update_lead_status`, `create_lead`, `create_property`,
 * `update_property`, `draft_offer` (which mutates the deal), `remember_fact`
 * and `trigger_zapier` / `trigger_make` are not among them — and a fired
 * Zapier automation is not recallable by anything downstream. Someone who
 * pressed Stop BECAUSE they saw Pax about to do the wrong thing watched it do
 * the wrong thing, invisibly (2026-09-04 review, CONFIRMED).
 *
 * ── WHAT THIS PINS ──────────────────────────────────────────────────────────
 * Position, over a DERIVED population. Every `executeTool(` and every
 * `client.chat.completions.create(` inside processChatStream is enumerated
 * from the source, and each one must be preceded by a cancellation check /
 * carry the signal. A tool call added next year without a guard fails here,
 * which a fixed list of call sites would not do.
 *
 * A behavioural test would be better and is not available cheaply: driving
 * processChatStream means standing up a provider client, a conversation row
 * and the whole tool registry. This asserts the property over the code that
 * would have to change to break it, and says so rather than implying more.
 *
 * idempotent: true — pure source reads, no DB, no network.
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

/** processChatStream's body, bounded by the next top-level declaration. */
function streamBody(): string {
  const src = read("server/ai/executive.ts");
  const start = src.indexOf("export async function* processChatStream(");
  expect(start, "processChatStream is gone — this test reads nothing").toBeGreaterThan(-1);
  const after = src.slice(start + 10);
  const nextTop = after.search(/\n(?:export )?(?:async )?function[* ]|\nexport (?:const|class|interface) /);
  return after.slice(0, nextTop > 0 ? nextTop : after.length);
}

/** Offsets of every occurrence of `needle`, in order. */
function offsets(haystack: string, needle: RegExp): number[] {
  const out: number[] = [];
  for (const m of haystack.matchAll(needle)) out.push(m.index ?? -1);
  return out.filter((i) => i >= 0);
}

describe("the agent checks whether the customer is still there", () => {
  const body = streamBody();

  it("reads a real function (vacuity guard)", () => {
    expect(body.length).toBeGreaterThan(4000);
    expect(body).toContain("executeTool(");
    expect(body).toContain("client.chat.completions.create(");
  });

  it("the signal is part of the options contract", () => {
    const src = read("server/ai/executive.ts");
    expect(src).toMatch(/interface ChatOptions[\s\S]{0,4000}signal\?: AbortSignal;/);
    expect(body).toMatch(/const \{[^}]*signal[^}]*\} = options;/);
    expect(body).toMatch(/const cancelled = \(\) => signal\?\.aborted === true;/);
  });

  it("every executeTool call is preceded by a cancellation check", () => {
    const guards = offsets(body, /if \(cancelled\(\)\) break;/g);
    const calls = offsets(body, /await executeTool\(/g);
    expect(calls.length, "no tool call found — the pattern has stopped matching").toBeGreaterThan(0);
    expect(guards.length, "no cancellation check found").toBeGreaterThan(0);
    for (const call of calls) {
      const guardBefore = guards.filter((g) => g < call).pop();
      expect(
        guardBefore,
        `an executeTool call at offset ${call} has no cancellation check before it — ` +
          `this is the tool a customer pressing Stop is trying to prevent`,
      ).toBeDefined();
      // And nothing else runs a tool between that guard and this call, which
      // is what makes it a guard for THIS call rather than an earlier one.
      const between = body.slice(guardBefore!, call);
      expect(
        between.includes("await executeTool("),
        `the nearest check before offset ${call} is separated from it by another ` +
          `tool call — the guard belongs to that one, not this one`,
      ).toBe(false);
    }
  });

  it("every model call inside the stream carries the signal", () => {
    // Not just our loop: an in-flight completion is one already being paid
    // for, so cancellation has to reach the provider.
    const calls = [...body.matchAll(/client\.chat\.completions\.create\(/g)];
    expect(calls.length).toBeGreaterThanOrEqual(2);
    for (const m of calls) {
      const tail = body.slice(m.index ?? 0, (m.index ?? 0) + 1400);
      expect(
        tail,
        `a model call at offset ${m.index} does not pass the abort signal — ` +
          `the turn stops locally and the completion is paid for anyway`,
        // `, { signal })` in any spelling — one call closes with `} as any,`
        // before the request-options argument.
      ).toMatch(/,\s*\{ signal \}\)/);
    }
  });
});

describe("the route tells the agent when the customer hangs up", () => {
  const route = read("server/routes-ai.ts");

  it("aborts on close, and only when the response has not finished", () => {
    expect(route).toContain("const controller = new AbortController();");
    expect(route).toMatch(/req\.on\("close", \(\) => \{\s*if \(!res\.writableEnded\) controller\.abort\(\);/);
    // The conditional is the whole trick: req 'close' fires on a NORMAL end
    // too, so an unconditional abort would abort every successful turn on its
    // way out.
  });

  it("passes the signal into the stream and stops iterating on abort", () => {
    const at = route.indexOf("processChatStream(message, org, userId, {");
    expect(at).toBeGreaterThan(-1);
    expect(route.slice(at, at + 400)).toContain("signal: controller.signal,");
    expect(route).toMatch(/if \(controller\.signal\.aborted\) break;/);
  });

  it("a cancelled turn is not logged as an error", () => {
    // Otherwise every Stop press buries a real failure in the same channel.
    const at = route.indexOf("[AI Stream] turn cancelled by the client");
    expect(at, "the abort path does not distinguish itself from a failure").toBeGreaterThan(-1);
    const block = route.slice(at - 700, at + 200);
    expect(block).toContain("APIUserAbortError");
    expect(block).toContain("AbortError");
  });
});
