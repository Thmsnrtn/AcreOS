/**
 * The founder's one required door must be able to RESOLVE what it lists.
 *
 * FOUNDER_DOORS names Decisions "the only routine place the founder is required
 * to interact", and it lists the questions agents are blocked on. For six weeks
 * it could not answer one. The 2026-07-27 four-door merge deleted the standalone
 * /founder/asks page as a duplicate; `AnswerAskDialog` and `SupersedeAskDialog`
 * lost their only mount in that deletion and were never picked up, so the whole
 * ask lane was a read-only list with an Answer button that navigated to the page
 * it was already on. The API had been live the entire time.
 *
 * Nothing caught it, and one reason is worth recording: a grep for importers of
 * those dialogs returns a hit, because route-redirects.ts contains PROSE naming
 * the files while describing the orphaning. A gate that counts mentions would
 * have certified the defect it was written to prevent. Hence: comments stripped,
 * and a mount means an import statement AND a JSX element, not a filename in a
 * string.
 *
 * POPULATION — derived, never listed. Every interactive dialog under
 * client/src/components/founder/asks/ (an exported component that POSTs to
 * /api/founder/asks/:id/…) is in scope, so a third dialog joins this rule by
 * existing. A per-member vacuity assertion follows, because an extractor that
 * quietly stops matching one member reads exactly like that member being clean.
 *
 * MUTATION PROBES (each must go RED):
 *   · remove the <AnswerAskDialog …/> mount from founder-decisions.tsx;
 *   · keep the mount but delete the import;
 *   · change the Answer button back to a link to /founder/asks?id=N;
 *   · point the Letter's CTA back at /founder/decisions?id=${askId}.
 *
 * idempotent: true — pure source reads.
 */

import { describe, expect, it, vi } from "vitest";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "../helpers/stripComments";
// This gate walks the source tree; its cost scales with the repo, and under the
// coverage run it does not fit the suite’s 30s default. A killed gate reports
// nothing about what it guards, so the budget is declared, not inherited.
vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });


const ROOT = path.resolve(__dirname, "../..");
const ASK_DIR = path.join(ROOT, "client/src/components/founder/asks");

const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const readStripped = (rel: string) => stripComments(read(rel));

/** Every client file that could hold a mount. */
function clientFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.tsx$/.test(e.name)) out.push(path.relative(ROOT, p));
    }
  };
  walk(path.join(ROOT, "client/src"));
  return out;
}

/**
 * The population: dialogs that PERFORM an ask outcome. Derived from the
 * directory + the endpoint they call, so the list cannot drift from reality.
 */
function interactiveAskDialogs(): Array<{ file: string; component: string; endpoint: string }> {
  const found: Array<{ file: string; component: string; endpoint: string }> = [];
  for (const name of fs.readdirSync(ASK_DIR)) {
    if (!name.endsWith(".tsx")) continue;
    const rel = path.relative(ROOT, path.join(ASK_DIR, name));
    const src = stripComments(read(rel));
    const endpoint = src.match(/\/api\/founder\/asks\/\$\{[^}]+\}\/(\w+)/)?.[1];
    if (!endpoint) continue; // read-only presenter (e.g. terminal-ask-row)
    const component = src.match(/export function (\w+)/)?.[1];
    expect(component, `${rel} POSTs to an ask endpoint but exports no component`).toBeTruthy();
    found.push({ file: rel, component: component!, endpoint });
  }
  return found;
}

describe("the founder ask lane can actually answer an ask", () => {
  const dialogs = interactiveAskDialogs();

  it("finds every interactive ask dialog in the directory", () => {
    // Vacuity floor. If the extractor stops matching, this fails rather than
    // silently shrinking the population to zero and passing.
    expect(dialogs.length).toBeGreaterThanOrEqual(2);
    expect(dialogs.map((d) => d.endpoint).sort()).toEqual(["answer", "supersede"]);
  });

  it.each(interactiveAskDialogs())(
    "$component has a live JSX mount, not just a mention",
    ({ component, file }) => {
      const importRe = new RegExp(`import\\s*\\{[^}]*\\b${component}\\b[^}]*\\}\\s*from`);
      const jsxRe = new RegExp(`<${component}[\\s/>]`);

      const hosts = clientFiles().filter((f) => {
        if (f === file) return false;
        const src = stripComments(read(f));
        return importRe.test(src) && jsxRe.test(src);
      });

      expect(
        hosts,
        `${component} (${file}) has no live mount. It POSTs to /api/founder/asks/:id/` +
          `${dialogs.find((d) => d.component === component)?.endpoint} — an ask outcome no ` +
          `surface can reach. Mount it, or delete the dialog and the endpoint together.`,
      ).not.toHaveLength(0);
    },
  );

  it("the mention-trap that hid this defect is still in the repo, and this gate is immune to it", () => {
    // route-redirects.ts NAMES both dialog files while describing the orphaning.
    // It does so inside a STRING LITERAL, which is worse than a comment: no
    // comment-stripper removes it, so a naive "does anything reference this
    // file?" sweep answers YES for a component with zero mounts. That is
    // precisely why the orphaning survived review.
    //
    // Assert both halves — the trap is present, and the predicate this gate
    // actually uses steps over it — so the mount check above cannot quietly
    // decay into a mention count.
    const trap = read("client/src/lib/route-redirects.ts");
    expect(trap, "the prose record of the orphaning was removed; this canary is now vacuous")
      .toContain("answer-ask-dialog.tsx");

    const stripped = stripComments(trap);
    expect(stripped).toContain("answer-ask-dialog.tsx"); // survives stripping: it is a string
    expect(/import\s*\{[^}]*\bAnswerAskDialog\b[^}]*\}\s*from/.test(stripped)).toBe(false);
    expect(/<AnswerAskDialog[\s/>]/.test(stripped)).toBe(false);
  });
});

describe("ask deep links address asks, not decision-log rows", () => {
  const DECISIONS = "client/src/pages/founder-decisions.tsx";

  it("the Answer button opens a dialog instead of navigating to the door it is on", () => {
    const src = readStripped(DECISIONS);
    // /founder/asks is a <Redirect> back to this very page. A link to it is a
    // no-op the founder experiences as a button that does nothing.
    expect(src).not.toMatch(/href=[{`"]\/founder\/asks/);
    expect(src).toMatch(/data-testid=\{`decisions-answer-ask-\$\{ask\.id\}`\}/);
    expect(src).toMatch(/onClick=\{\(\) => \{[^}]*setOpenAskId\(ask\.id\)/s);
  });

  it("asks use ?ask= and the decision log keeps ?id= — two key spaces, two params", () => {
    const decisions = readStripped(DECISIONS);
    expect(decisions).toContain('new URLSearchParams(window.location.search).get("ask")');
    expect(decisions).toContain('new URLSearchParams(window.location.search).get("id")');

    // The Letter's headline CTA sends an ASK id. Sent as ?id= it was fed to the
    // decision-log resolver, which matched an unrelated row or nothing at all.
    const home = readStripped("client/src/pages/founder/home.tsx");
    expect(home).toContain("/founder/decisions?ask=${brief.decision.askId}");
    expect(home).not.toContain("/founder/decisions?id=${brief.decision.askId}");
  });

  it("no client surface links to a founder ask route that only redirects", () => {
    const offenders = clientFiles()
      .filter((f) => f !== "client/src/App.tsx")
      .filter((f) => /href=[{`"]\/founder\/asks/.test(stripComments(read(f))));
    expect(offenders, "link to /founder/asks — it redirects to /founder/decisions").toEqual([]);
  });
});
