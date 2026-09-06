/**
 * Removal-protocol step 2, finally enforced.
 *
 * route-redirects.ts has documented its own removal protocol since 2026-05-03:
 *
 *   2. Search `git grep` for any in-app `<Link>` / `useLocation` push that
 *      still targets the legacy path; rewrite to `canonical`.
 *
 * That step was never once executed. Measured 2026-09-06, eight in-app links
 * across six files still pointed at routes that only redirect, two of them for
 * four months. Three costs, in ascending order of seriousness:
 *
 *   · a wasted navigation and a URL flash on every click;
 *   · the sunset can never happen — deleting the legacy <Route> would 404 a
 *     live in-app control, so the redirect calcifies into permanent furniture;
 *   · wouter's <Redirect to="/x" /> DROPS the query string. `/pax?intent=…&
 *     leadId=42` arrived at /ai as a bare /ai. The Today door's "Pax, draft the
 *     follow-up" therefore lost both the entity and the request, opened Pax
 *     cold — and resolved the decision as done on the way out. The customer
 *     asked for a draft, watched the row disappear as completed, and no draft
 *     existed. A link that silently discards its payload is worse than a broken
 *     one, because it looks like it worked.
 *
 * POPULATION — every .ts/.tsx under client/src, minus the two files whose JOB
 * is to name legacy paths (App.tsx registers the redirects; route-redirects.ts
 * is the register). LEGACY PATHS are read out of ROUTE_REDIRECTS itself, so a
 * redirect added tomorrow is governed by this rule without anyone editing it.
 * Comments are stripped first: this register is dense with prose naming the
 * very paths it retires, and a scan cannot tell the record from the thing.
 *
 * MUTATION PROBES (each must go RED):
 *   · restore href="/founder/solene-chat" in client/src/pages/founder/team.tsx;
 *   · restore href="/pax?intent=draft_follow_up&…" in DecisionQueue.tsx;
 *   · add a redirect entry for a path some page already links to.
 *
 * idempotent: true — pure source reads.
 */

import { describe, expect, it, vi } from "vitest";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "../helpers/stripComments";
import { ROUTE_REDIRECTS, legacyAskSearch } from "../../client/src/lib/route-redirects";
// This gate walks the source tree; its cost scales with the repo, and under the
// coverage run it does not fit the suite’s 30s default. A killed gate reports
// nothing about what it guards, so the budget is declared, not inherited.
vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });


const ROOT = path.resolve(__dirname, "../..");
const EXEMPT = new Set(["client/src/App.tsx", "client/src/lib/route-redirects.ts"]);

function clientSources(): Array<{ rel: string; src: string }> {
  const out: Array<{ rel: string; src: string }> = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(e.name)) {
        const rel = path.relative(ROOT, p);
        if (!EXEMPT.has(rel)) out.push({ rel, src: stripComments(fs.readFileSync(p, "utf8")) });
      }
    }
  };
  walk(path.join(ROOT, "client/src"));
  return out;
}

describe("no in-app navigation targets a route that only redirects", () => {
  const files = clientSources();
  const legacies = ROUTE_REDIRECTS.map((r) => r.legacy);

  it("reads a real population and a real register", () => {
    // Two floors, because both are invisible in a green result: how many files
    // were opened, and how many paths were governed.
    expect(files.length).toBeGreaterThan(400);
    expect(legacies.length).toBeGreaterThanOrEqual(12);
    expect(new Set(legacies).size).toBe(legacies.length);
  });

  it.each(ROUTE_REDIRECTS.map((r) => [r.legacy, r.canonical]))(
    "%s has no in-app callers (canonical: %s)",
    (legacy, canonical) => {
      // Bounded by a delimiter so /founder/now does not match /founder/nowhere,
      // and matched only in a navigation position (href=/to=), so prose and
      // API paths that merely share a prefix are not swept in.
      const re = new RegExp(
        `(?:href|to)=\\{?["\`]${legacy.replace(/[.*+?^$()|[\]\\]/g, "\\$&")}(?=["\`?#]|\\$\\{)`,
      );
      const offenders = files.filter((f) => re.test(f.src)).map((f) => f.rel);
      expect(
        offenders,
        `link to the retired ${legacy}; rewrite to ${canonical}. A <Redirect> also ` +
          `drops the query string, so any params on that link are silently lost.`,
      ).toEqual([]);
    },
  );

  it("the query-dropping half of the defect is pinned, not just the path", () => {
    // The path rule above would still pass if someone reintroduced the shape
    // through a redirect that is not yet registered. This asserts the specific
    // customer-facing repair: the Today CTA now carries a real instruction on
    // the param the composer actually reads.
    const q = stripComments(
      fs.readFileSync(path.join(ROOT, "client/src/components/today/DecisionQueue.tsx"), "utf8"),
    );
    expect(q).toContain("/ai?prefill=");
    expect(q).not.toContain("intent=draft_follow_up");

    // ...and the composer on the other end reads it. A prefill nobody consumes
    // is the same defect wearing a different param name.
    const cc = stripComments(
      fs.readFileSync(path.join(ROOT, "client/src/pages/command-center.tsx"), "utf8"),
    );
    expect(cc).toContain('.get("prefill")');
  });

  it("navigating away to compose a draft does not mark the work done", () => {
    const q = stripComments(
      fs.readFileSync(path.join(ROOT, "client/src/components/today/DecisionQueue.tsx"), "utf8"),
    );
    // The unit is the WHOLE <Button> element, not the tail after its testid.
    // Slicing forward from the testid silently excludes every attribute
    // declared above it — including onClick, which is where the defect lives.
    // Written that way, this assertion passed with the defect reinstated.
    const anchor = q.indexOf("decision-resolve-pax-draft");
    expect(anchor, "the pax-draft CTA was renamed or removed; this check is vacuous")
      .toBeGreaterThan(-1);
    const open = q.lastIndexOf("<Button", anchor);
    const close = q.indexOf("</Button>", anchor);
    expect(open, "no enclosing <Button> found for the pax-draft CTA").toBeGreaterThan(-1);
    expect(close).toBeGreaterThan(anchor);
    const button = q.slice(open, close);
    // Boundary canary: the span must contain the attributes on BOTH sides of
    // the anchor, or it is not the element it claims to be.
    expect(button).toContain("onClick=");
    expect(button).toContain("decision-resolve-pax-draft");
    expect(button).toContain("href=");
    expect(
      button.includes("onResolve"),
      "the pax-draft CTA resolves the decision as done before any draft exists — " +
        "the customer sees the row complete and nothing was drafted or sent",
    ).toBe(false);
  });
});

describe("legacyAskSearch translates the one param that changed meaning", () => {
  // On the deleted /founder/asks page ?id= was an ASK id. On the Decisions door
  // ?id= is a DECISION-LOG id — a different table with its own key space — so
  // forwarding the search string verbatim handed an ask id to the wrong
  // resolver. Behavioural assertions; no source scanning can prove this one.
  it("rewrites a legacy ask id onto the ask param", () => {
    expect(legacyAskSearch("?id=42")).toBe("?ask=42");
  });
  it("preserves unrelated params and their order-independence", () => {
    const out = new URLSearchParams(legacyAskSearch("?id=42&tab=open"));
    expect(out.get("ask")).toBe("42");
    expect(out.get("tab")).toBe("open");
    expect(out.get("id")).toBeNull();
  });
  it("leaves an already-correct ?ask= alone and drops the stale id", () => {
    const out = new URLSearchParams(legacyAskSearch("?ask=7&id=42"));
    expect(out.get("ask")).toBe("7");
    expect(out.get("id")).toBeNull();
  });
  it("returns an empty string rather than a bare ? for no params", () => {
    expect(legacyAskSearch("")).toBe("");
    expect(legacyAskSearch("?")).toBe("");
  });
});
