/**
 * A failed read rendered as "you have none" is a fabricated fact.
 *
 * `GET /api/founder/job-health` caught its database error and answered
 * `res.json([])`. The job-health console is the surface whose entire purpose is
 * telling the founder whether the background jobs ran — and on it, **an empty
 * list reads as "no job has failed".** A total scheduler outage and a perfectly
 * healthy system rendered the identical screen.
 *
 * Three more did the same, two of them with the error swallowed entirely — not
 * even logged:
 *
 *   - `GET /api/notifications/history` → `[]`. A customer with unread mail saw
 *     an empty inbox and had no way to know the read had failed.
 *   - `GET /api/notifications/unread-count` → `{ count: 0 }`. Zero is a NUMBER a
 *     customer reads off a badge: twelve notifications became none.
 *   - `GET /api/founder/agent-collaboration/messages` → `[]`, so a failed read
 *     of the agent history rendered as "the agents have not spoken".
 *
 * THE LIE WAS IMPLEMENTED TWICE, ON BOTH SIDES OF THE WIRE. `useJobHealthLogs`
 * also carried `if (!res.ok) return []`, so fixing the server alone would have
 * changed nothing on screen. That is the half-fix that looks complete, and it is
 * why this file asserts the client hook too.
 *
 * WHY THIS IS A CONSTITUTION MATTER, not a style one. *"Fabrication is never
 * acceptable: no invented numbers, no fake activity, no placeholder data
 * presented as real."* `{ count: 0 }` minted from a caught exception is an
 * invented number. And the canonical laws are explicit that **unknown is a valid
 * state** — one that must stay distinguishable from zero. `lint:no-fabrication`
 * catches `Math.random`; it cannot see a catch block, which is why this class
 * survived it.
 *
 * WHAT THE FIX GIVES BACK. `Errors.internal` logs and answers 5xx, so the
 * client's `QueryErrorState` — which CLAUDE.md's UI patterns already name as the
 * error state, with retry — can finally render. The job-health page had no error
 * branch at all, because `isError` could never be true.
 *
 * THE DETECTOR IS NARROWER THAN THE DEFECT, DELIBERATELY, and one case shows
 * why. `/api/founder/intelligence/company-briefing` caught its error and
 * answered `{ healthScore: 0, mood: "yellow", headline: "Briefing temporarily
 * unavailable", … }`. The COPY told the truth; `healthScore: 0` and a mood the
 * system does not know were invented numbers sitting beside it. Honest prose
 * does not launder a fabricated metric next to it, and a founder reads the
 * number. It was fixed with the others — but a regex wide enough to catch a
 * multi-key object with a zero in it would flag `{ status: "error",
 * retryAfter: 0 }` too, and a checker that cries wolf gets deleted. So the sweep
 * covers the unambiguous shapes and this paragraph carries the rest.
 *
 * THE CLIENT SIDE IS LARGER AND IS **NOT** SWEPT HERE. 33 places in `client/src`
 * carry `if (!res.ok) return [] / null`, and many are correct: a 404 for an
 * optional badge genuinely means "no record". The dishonest case is narrower —
 * a 5xx collapsed into emptiness — and `!res.ok` cannot tell them apart. Fixing
 * that needs the 404/5xx distinction made per call site, which is a different
 * unit and not a blanket change. Measured, recorded, not guessed at.
 */

import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { REPO_SWEEP_TIMEOUT_MS, stripComments } from "../helpers/stripComments";

// THIS FILE SWEEPS THE WHOLE REPOSITORY. Stripping comments correctly means
// parsing, ~2.7ms a file, and under the coverage run's instrumentation a
// sweep does not fit the suite's 30s default. Killing it does not make the
// suite faster — it makes this gate stop reporting. Declared, not inherited.
vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

const ROOT = path.resolve(__dirname, "../..");

function serverFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".ts") && !/\.test\.|\.spec\./.test(e.name)) out.push(p);
    }
  };
  walk(path.join(ROOT, "server"));
  return out;
}

/**
 * A `catch` block that answers with an EMPTY or ZERO payload.
 *
 * Deliberately narrow. It matches only the shapes that state a fact about the
 * caller's own data — `[]`, `{}`, `{ count: 0 }`, `{ total: 0 }` and friends —
 * and not a catch that answers `{ status: "error", … }`, which is honest, nor
 * one that returns a cached or degraded value it can name. A checker that
 * flagged every catch would cry wolf, and a checker that cries wolf gets
 * deleted.
 */
const EMPTY_ANSWER =
  /res\s*\.\s*(?:json|send)\s*\(\s*(?:\[\s*\]|\{\s*\}|\{\s*(?:count|total|unread|results?|items?|rows?|data)\s*:\s*(?:0|\[\s*\])\s*,?\s*\})\s*\)/;

interface Hit {
  where: string;
  snippet: string;
}

function emptyAnswersInCatch(): Hit[] {
  const hits: Hit[] = [];
  for (const abs of serverFiles()) {
    const src = stripComments(fs.readFileSync(abs, "utf8"));
    const rel = path.relative(ROOT, abs);
    // Walk each `catch (…) {` and take its body by brace balance, so the window
    // is the catch block itself and never the try above it. A fixed-size window
    // is how unit 63's mutation survived — it reached past the block it meant.
    for (const m of src.matchAll(/catch\s*\([^)]*\)\s*\{/g)) {
      let depth = 1;
      let i = m.index! + m[0].length;
      while (i < src.length && depth > 0) {
        if (src[i] === "{") depth += 1;
        else if (src[i] === "}") depth -= 1;
        i += 1;
      }
      const body = src.slice(m.index! + m[0].length, i - 1);
      const found = EMPTY_ANSWER.exec(body);
      if (!found) continue;
      const line = src.slice(0, m.index).split("\n").length;
      hits.push({ where: `${rel}:${line}`, snippet: found[0].replace(/\s+/g, " ") });
    }
  }
  return hits;
}

describe("a caught error never answers with emptiness", () => {
  it("the detector finds catch blocks at all (vacuity guard)", () => {
    // If the brace walk or the catch regex broke, this file would pass by
    // inspecting nothing — the failure mode every source scan here has hit.
    let catches = 0;
    for (const abs of serverFiles()) {
      catches += [...stripComments(fs.readFileSync(abs, "utf8")).matchAll(/catch\s*\([^)]*\)\s*\{/g)]
        .length;
    }
    expect(catches, "no catch blocks parsed from server/").toBeGreaterThan(500);
  });

  it("the detector recognises the shapes it is looking for (self-check)", () => {
    // Asserted rather than assumed, in both directions: a pattern that matched
    // nothing would report a clean repo, and one that matched everything would
    // make the sweep useless.
    for (const yes of [
      "res.json([])",
      "res.json({})",
      "res.json({ count: 0 })",
      "res.json({ total: 0 })",
      "res.json({ items: [] })",
    ]) {
      expect(EMPTY_ANSWER.test(yes), `missed: ${yes}`).toBe(true);
    }
    for (const no of [
      'res.json({ status: "error", message: e.message })',
      "res.json(rows)",
      "res.json({ count })",
      "res.json({ ok: false })",
    ]) {
      expect(EMPTY_ANSWER.test(no), `over-matched: ${no}`).toBe(false);
    }
  });

  it("no catch block answers 200 with an empty or zero payload", () => {
    // ABSOLUTE, no register. `Errors.*` is always available and always the right
    // answer here: an error that cannot be reported is an error the customer
    // will interpret as a fact about their account.
    const hits = emptyAnswersInCatch();
    expect(
      hits.map((h) => `${h.where}   ${h.snippet}`).join("\n"),
      "a caught error answers 200 with emptiness. That states a FACT about the " +
        "caller's own data — 'you have none', 'the count is zero', 'nothing " +
        "failed' — out of a failure to look. The constitution's rule is that " +
        "fabrication is never acceptable and that UNKNOWN is a valid state that " +
        "must stay distinguishable from zero. Use Errors.internal (it logs) so " +
        "the client's QueryErrorState can render a retry.",
    ).toBe("");
  });
});

describe("the job-health chain is honest end to end", () => {
  // Named as well as swept, because this one is the reason the sweep exists and
  // because the lie was implemented independently on BOTH sides of the wire —
  // a server-only fix would have changed nothing on screen while looking done.
  it("the endpoint refuses instead of returning an empty history", () => {
    const src = stripComments(
      fs.readFileSync(path.join(ROOT, "server/routes-sovereign-integration.ts"), "utf8"),
    );
    const at = src.indexOf('app.get("/api/founder/job-health"');
    expect(at, "the job-health endpoint is gone").toBeGreaterThan(-1);
    const body = src.slice(at, src.indexOf("\n  });", at));
    expect(body).toContain("Errors.internal(res, err)");
  });

  it("the hook throws instead of turning a failure back into an empty list", () => {
    const hook = stripComments(
      fs.readFileSync(path.join(ROOT, "client/src/hooks/use-sovereign-dashboard.ts"), "utf8"),
    );
    const at = hook.indexOf("export function useJobHealthLogs()");
    expect(at, "useJobHealthLogs is gone").toBeGreaterThan(-1);
    const body = hook.slice(at, hook.indexOf("\n}", at));
    expect(
      body,
      "the hook swallows the failure into [] again, so the page can never show " +
        "an error no matter what the server does",
    ).not.toContain("if (!res.ok) return []");
    expect(body).toContain("throw new Error(");
  });

  it("the page has an error branch, and it says what is unknown", () => {
    // The page had none, because `isError` could never be true. The copy matters
    // as much as the branch: "couldn't load" and "no jobs have run" are the two
    // readings this whole unit exists to keep apart.
    const page = fs.readFileSync(path.join(ROOT, "client/src/pages/job-health.tsx"), "utf8");
    expect(page).toContain("QueryErrorState");
    expect(page).toContain("if (isError)");
    expect(
      page,
      "the error state does not distinguish 'could not read' from 'nothing ran'",
    ).toMatch(/NOT the same as no jobs/i);
  });

  it("the other health surfaces refuse too", () => {
    // Same shape, same inversion, found by the sweep above rather than by
    // looking: an empty list on a HEALTH console reads as good news.
    const admin = stripComments(
      fs.readFileSync(path.join(ROOT, "server/routes-admin.ts"), "utf8"),
    );
    expect(admin, "the org-health console answers a caught error with []").toMatch(
      /Org health error[\s\S]{0,200}?Errors\.internal|Errors\.internal\(res, err\)/,
    );
    const intel = stripComments(
      fs.readFileSync(path.join(ROOT, "server/routes-founder-intelligence.ts"), "utf8"),
    );
    expect(
      intel,
      "the company briefing mints a healthScore again out of a caught error",
    ).not.toContain("healthScore: 0,");
  });

  it("the notification endpoints refuse too", () => {
    const src = stripComments(
      fs.readFileSync(path.join(ROOT, "server/routes-sovereign-integration.ts"), "utf8"),
    );
    for (const route of [
      'app.get("/api/notifications/history"',
      'app.get("/api/notifications/unread-count"',
    ]) {
      const at = src.indexOf(route);
      expect(at, `${route} is gone`).toBeGreaterThan(-1);
      const body = src.slice(at, src.indexOf("\n  });", at));
      expect(body, `${route} still answers a caught error with emptiness`).toContain(
        "Errors.internal(res, err)",
      );
      // The missing-session guard was the same lie in a narrower case.
      expect(body, `${route} mints an empty tray from a missing session`).toContain(
        "Errors.unauthorized(res)",
      );
    }
  });
});
