/**
 * A scheduled audit that cannot reach its target must SAY SO — it may not
 * report a conclusion it did not earn.
 *
 * ── WHAT THIS WAS WRITTEN FOR ─────────────────────────────────────────────
 * Measured 2026-09-05 against the GitHub Actions API, not against the code:
 *
 *   Desktop-feel Audit           366 runs, 366 SUCCESS   — none opened a browser
 *   Customer Journey Audit       same shape
 *   Borrower Cookie-Session E2E   94 runs,  94 FAILURE   — none reached a check
 *
 * All three read `TARGET_URL` from a repository secret that is not set. Two
 * exited 0 on that branch and went green; one exited 1 and went red. Both are
 * wrong, and they are wrong in the same way: the run's conclusion described
 * the CONFIGURATION, while every reader takes it to describe the PRODUCT.
 * 366 green checks said "the customer journey is fine" about an audit that had
 * never run, and 94 identical reds burned down the alarm the borrower workflow
 * exists to raise — its "Open issue on RED" step never fired once, because the
 * E2E step it keys on was always SKIPPED.
 *
 * This is the repo's third law at the level of CI: a gate proves its property
 * only over the population it actually reads, and an EMPTY population reports
 * exactly like a clean one.
 *
 * ── WHY A SOURCE TEST AND NOT A LIVE CHECK ────────────────────────────────
 * This test cannot see the Actions API or the secret. What it CAN hold is the
 * structural property that made the silence possible: on the branch where the
 * target is missing, the workflow must reach the shared announce action. A
 * fourth audit added later with the same guard and no announcement is what
 * fails here.
 */
import { describe, expect, it, vi } from "vitest";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { stripYamlComments as withoutComments } from "../helpers/stripYamlComments";
// This gate walks the source tree; its cost scales with the repo, and under the
// coverage run it does not fit the suite’s 30s default. A killed gate reports
// nothing about what it guards, so the budget is declared, not inherited.
vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });


const WORKFLOW_DIR = path.resolve(process.cwd(), ".github/workflows");
const ACTION = ".github/actions/audit-unconfigured";

const read = (rel: string) => readFileSync(path.resolve(process.cwd(), rel), "utf8");

/**
 * Strip YAML/shell comment lines before ANY predicate — the population's
 * included.
 *
 * This file's own fix put the words `TARGET_URL`, `exit 1` and the run counts
 * into explanatory comments inside all three workflows. A raw substring scan
 * would read that documentation as the defect and as the population, which is
 * the fourth law and is not hypothetical here: the repo has already paid for
 * it four times in one day (a `find drizzle` scan matching the comment saying
 * `find drizzle` was removed; a mount check satisfied by the line above the
 * commented-out mount).
 *
 * A `#` line is a comment in YAML and, inside a `run:` block, in the shell
 * too, so one rule covers both.
 */

const workflows = readdirSync(WORKFLOW_DIR)
  .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))
  .map((f) => `.github/workflows/${f}`);

/**
 * THE POPULATION: workflows that (a) run on a schedule and (b) guard on an
 * unset `TARGET_URL`. That is exactly the set for which "nobody is watching
 * this run, and it may silently have nothing to audit" is true.
 *
 * Derived from the files, not typed out, so a fourth scheduled audit with the
 * same guard joins the population by existing.
 */
const scheduled = workflows.filter((rel) => /^\s{2,}schedule:/m.test(withoutComments(read(rel))));
const guarded = scheduled.filter((rel) =>
  /if\s+\[\s+-z\s+"\$\{TARGET_URL:-\}"\s+\]/.test(withoutComments(read(rel))),
);

describe("the shared announcement exists", () => {
  it("the composite action is present and files exactly one standing issue", () => {
    expect(existsSync(path.resolve(process.cwd(), `${ACTION}/action.yml`))).toBe(true);
    const src = withoutComments(read(`${ACTION}/action.yml`));
    expect(src, "the run summary is the in-run signal — without it a skipped audit is invisible in its own run").toContain("GITHUB_STEP_SUMMARY");
    expect(src, "a warning annotation puts the fact on the run's own page").toContain("::warning");
    expect(src, "the durable signal is one issue outside the run").toContain("issues.create");
    expect(
      src,
      "the action must be QUIET ON REPEAT: a 6-hourly cron that comments every run " +
        "becomes four notifications a day, which is how 366 silent successes got " +
        "ignored in the first place. It must look for an already-open issue first.",
    ).toContain("issues.listForRepo");
    expect(
      src,
      "an audit that cannot run must not also file its issue on manual dispatch — " +
        "a human running it by hand can read the summary",
    ).toContain("github.event_name == 'schedule'");
    expect(
      src,
      "the issue step must be NON-FATAL. If the token cannot write issues, a 403 " +
        "here would fail the job — rebuilding the exact ambiguity this action exists " +
        "to remove, a red meaning \"unconfigured\" in the same column as a red meaning " +
        "\"the audited flow is broken\".",
    ).toContain("continue-on-error: true");
    // The dedupe must span CLOSED issues too. Searching only open ones means
    // closing the issue — the natural response to "noted" — makes the next
    // scheduled run file a fresh one, four a day on a 6-hourly cron. That was
    // the first version's behaviour, found by reading the issue it had just
    // filed rather than the code that filed it.
    const dedupe = /issues\.listForRepo\(\{[\s\S]{0,240}?\}\)/.exec(src);
    expect(dedupe, "the dedupe lookup is gone — every run would file another issue").not.toBeNull();
    expect(
      dedupe![0],
      "the dedupe searches only OPEN issues, so closing one re-arms it. File " +
        'once per audit, ever: state: "all".',
    ).toMatch(/state:\s*["']all["']/);
  });
});

describe("every scheduled audit announces when it cannot run", () => {
  it("reads a real population (vacuity guard)", () => {
    expect(workflows.length, "no workflows were read at all").toBeGreaterThan(5);
    expect(scheduled.length, "no scheduled workflow was found — the cron predicate stopped matching").toBeGreaterThan(2);
    expect(
      guarded.length,
      "no TARGET_URL-guarded scheduled workflow was found. Three existed on 2026-09-05 " +
        "(desktop-feel, customer-journey, borrower-cookie). If the guard was re-spelled, " +
        "re-point this predicate — do not let the population empty, because an empty " +
        "population passes every assertion below.",
    ).toBeGreaterThanOrEqual(3);
  });

  // Per-member, not aggregate: a parser that silently stops matching ONE
  // workflow reads exactly like that workflow being clean.
  for (const rel of guarded) {
    describe(rel, () => {
      const src = withoutComments(read(rel));

      it("reaches the announce action on the unconfigured branch", () => {
        expect(
          src,
          `${rel} guards on an unset TARGET_URL but never reaches ${ACTION}. ` +
            "Its scheduled runs therefore report a conclusion about the configuration " +
            "while every reader takes it to be about the product.",
        ).toContain(`uses: ./${ACTION}`);
      });

      it("does not turn 'unconfigured' into a failure", () => {
        // The borrower workflow's original defect, kept as an assertion rather
        // than a memory: `exit 1` inside the guard makes "the secret is unset"
        // indistinguishable from "the borrower flow is broken", and the second
        // is the only thing the workflow exists to tell anyone.
        const guardBlock = /(-\s+name:[^\n]*\n(?:\s+[^\n]*\n)*?\s+if\s+\[\s+-z\s+"\$\{TARGET_URL:-\}"\s+\][\s\S]*?\n\s+fi)/.exec(src);
        expect(
          guardBlock,
          `could not locate the TARGET_URL guard block in ${rel} — the extractor stopped ` +
            "matching, which reads exactly like the workflow being clean. Re-point it.",
        ).not.toBeNull();
        expect(
          guardBlock![1],
          `${rel} exits non-zero when TARGET_URL is unset. That red means "unconfigured", ` +
            "which is the same red as \"the audited flow broke\" — and this repo has already " +
            "watched 94 consecutive runs of exactly that ambiguity go unread.",
        ).not.toMatch(/exit\s+1/);
      });

      it("grants the token the issue write it needs", () => {
        // Neither github-script step in these workflows had ever run — every
        // scheduled run stopped at the TARGET_URL guard — so the default token
        // permissions were never exercised. Inheriting a read-only default
        // would turn the notice into a 403 that reads as one more failed audit.
        expect(
          src,
          `${rel} reaches a step that creates a GitHub issue but does not declare ` +
            "`issues: write`. On a repository whose default token is read-only that " +
            "step 403s, and the fact it exists to report never reaches anyone.",
        ).toMatch(/^\s*issues:\s*write/m);
      });

      it("skips its real work rather than running it against nothing", () => {
        expect(
          src,
          `${rel} must gate its audit steps on the guard's skip output, or the announcement ` +
            "is decoration and the steps run anyway.",
        ).toMatch(/if:\s*steps\.guard\.outputs\.skip\s*!=\s*'true'/);
      });
    });
  }
});
