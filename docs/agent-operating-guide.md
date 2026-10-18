# Agent operating guide

How any AI agent (any model, any session) works on AcreOS. CLAUDE.md holds the
engineering standards and the standing founder decisions; this file holds the
working method. Read both before starting.

## How to work

1. **Verify before fixing.** Every finding, report or claim — including your
   own and other agents' — is a hypothesis. Reproduce it on current `main` by
   finding the code by symbol, not by line. If it no longer reproduces, say so
   with evidence and move on.
2. **Every fix gets a test that fails without the fix.** Test the behaviour,
   not the presence of a name. Then undo the fix on purpose, watch the test go
   red, and restore it.
3. **Small, local changes.** One concern per branch and PR. Security fixes
   ship alone and first, worded neutrally — this repository is public, so no
   commit, comment, doc or CI log may describe how to exploit anything.
4. **Read gate verdicts from files, never through a pipe**
   (`cmd > out.txt 2>&1; echo $? > out.status`). Finish editing before you
   measure. Run `npm run check`, `npm test` and `npm run build` yourself; a
   report of green is not proof.
5. **Hunt "built but unwired"**: routes never mounted, jobs never scheduled,
   functions with no callers, schema without a migration. Search for call
   sites of everything new.
6. **Never weaken, skip or delete a test to get green.** When a ratchet count
   legitimately drops, lower its baseline in the same commit.
7. **Independent review before merge.** After any non-trivial change, a fresh
   reviewer that did not build it audits it, treating every claim as a
   hypothesis.
8. **Before merging to `main`, enumerate every workflow run for the SHA**, not
   only the ones that run on branches.
9. **Production is founder-only.** Read-only checks first, counts only, never
   ids or customer data in output; ask before any change; production deploys
   are a manual "Deploy to Fly.io" dispatch.

## Decisions

- Ask the founder only when the decision is genuinely theirs: pricing, plan
  limits, credits, production changes, deleting customer data, anything
  public. Offer two or three options with a recommendation first and why.
- Everything else: choose the sensible default, say what you chose, continue.
- Every founder decision is written to `docs/company/founder-decisions-*.md`
  (dated, existing format) and, if it is a standing rule, to the DO-NOT-DO list
  in CLAUDE.md and `shared/governance/constitution.ts`. A decision that lives
  only in a chat is lost to the next session.

## Move the product forward, not only keep it healthy

1. Start each session by reading `docs/company/next-moves.md`, the latest
   founder-decision files and `docs/company/roadmap-2026-07.md`. Propose the
   three highest-value next moves — customer outcome, cost, how it will be
   measured — and do the top one unless the founder redirects.
2. **Measure before and after.** Every feature ships with a number
   (time-to-first-deal, page load, simulation findings, cost per customer).
   No number, no claim.
3. **Use the simulations as the test drive.** Run the persona walk and the
   campaign sims (`tests/simulation/campaign/`) to find where customers get
   stuck before building; re-run them after and show the finding gone.
4. **Finish loops end to end.** Done means a customer can use it from the
   door they would naturally enter, it is wired, tested, measured, and visible
   to the founder — not that the code exists.
5. **Think like the founder.** Every paid action must cover its own cost
   (house mail is the template: purchased credits only, priced above real
   cost plus fees plus margin). Never invent data. Keep the five customer
   doors and four founder doors fixed. Let the autopilot take work off the
   founder's plate rather than add screens.
6. **Bring ideas, not only tasks.** When a pattern shows up, propose the
   product change with a recommendation; the founder decides.

## Reporting

- Plain language first: what is done, what it means for customers, what
  needs the founder. Then the details.
- Say what was verified by running it versus by reading it, what failed, and
  what is left. Never claim done without proof.
- Times in Eastern (EDT/EST).
- End every session by updating `docs/company/next-moves.md`.

## Parallel work

- Each agent gets its own branch and worktree, a written brief with these
  rules, and files no other agent is editing.
- Heavy commands (check, test, build, Playwright) run one at a time under a
  shared lock; the machine is small.
- Agents stop on usage limits and container restarts. Resume them from where
  they stopped; do not restart them from scratch.
