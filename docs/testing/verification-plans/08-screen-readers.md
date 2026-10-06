# Plan 8 — Screen readers on the customer doors

**Status:** Not yet run · **Owner:** [OWNER] founder to assign · **Index:** [README](README.md)

## Goal

Establish that a customer who uses a screen reader can reach and use each of
the customer doors — **Today · Map · Deals · Finance · Pax**, plus **Inbox**
and **Settings** from the top bar (CLAUDE.md, "five fixed doors") — with the
three screen-reader / browser pairings most customers would use, and with the
keyboard alone.

## Why the campaign could not cover it

The campaign ran axe-core on every page. Automated rules catch a subset of
accessibility defects (missing names, invalid ARIA, contrast); they cannot
tell whether a page _makes sense_ when read aloud, whether focus lands where
it should after an action, or whether live updates are announced. No
assistive technology was run.

## Scope — routes

Taken from `DEFAULT_SIDEBAR_ITEMS` in `client/src/lib/nav-items.ts` and
`PROTECTED_DOOR_ROUTES` in `client/src/lib/sidebar-hidden-routes.ts`:

| Door     | Route                                  | Primary task to complete by screen reader                                                           |
| -------- | -------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Today    | `/today`                               | Hear the day's briefing in order; open and complete one queued action                               |
| Map      | `/maps`                                | Find a parcel by search; hear its key facts without using the visual map; reach the parcel's detail |
| Deals    | `/deals` (Pipeline hub at `/pipeline`) | Find a deal; move it to another stage without drag-and-drop                                         |
| Finance  | `/money` (Note Register at `/finance`) | Read a notes table with row and column headers; open one note's schedule                            |
| Pax      | `/ai`                                  | Send a message; hear the response when it arrives; act on one suggested draft                       |
| Inbox    | `/inbox`                               | Hear unread count; open a thread; reply                                                             |
| Settings | `/settings`                            | Change one preference and one billing field; hear validation errors                                 |

Persona changes content behind the doors, so run the table for at least two
personas with different Finance tabs.

## Pairings and environment

| Pairing                          | Platform                                   |
| -------------------------------- | ------------------------------------------ |
| NVDA + Firefox                   | Windows, current NVDA and Firefox releases |
| VoiceOver + Safari               | macOS and iOS / iPadOS, current releases   |
| TalkBack + Chrome                | Android, current releases                  |
| Keyboard only (no screen reader) | Any desktop browser                        |

- Staging with real sign-in (plan 2), or a local build with the test-auth
  bypass for desktop pairings only. Record which.
- A tester who uses the screen reader fluently. If no one on the team does,
  engage an external assistive-technology tester; record that as the owner.
- Seeded data so tables, lists and the map have content.

## Procedure

For each pairing and each door:

1. **Orientation.** Land on the door. Record whether the page title, a single
   `h1`, and landmarks (banner, navigation, main) are announced, and whether
   the heading outline matches the visual structure.
2. **Navigation.** Move between doors using the nav; confirm the current door
   is announced as current, and that focus moves to the new page's main
   content or heading after a route change.
3. **Primary task.** Complete the task in the scope table without sighted help.
   Record each point where the tester had to guess, got lost, or could not
   continue.
4. **Controls.** Every icon-only button has an accessible name (CLAUDE.md
   requires `aria-label`); toggles and tabs announce state; menus and dialogs
   move focus in and return it on close; Escape closes them.
5. **Forms.** Every input announces its label; errors are announced and tied
   to their field; required fields are identified before submission.
6. **Live updates.** Pax responses, toasts, and Inbox arrivals are announced
   once (not repeatedly, not never).
7. **Keyboard-only pass.** Repeat 2–5 with no screen reader: visible focus on
   every interactive element (a CLAUDE.md rule), no keyboard trap, logical
   tab order, skip link to main content.
8. **Mobile.** On iOS and Android, repeat 1–3 with swipe navigation, including
   the mobile bottom nav (`MOBILE_DOORS` in `client/src/lib/nav-items.ts`).

Log each issue with: door, pairing, step, what was expected, what was
announced or happened, and the WCAG 2.2 success criterion it maps to.

## Pass criteria

- Every primary task in the scope table can be completed on every pairing.
- No issue mapping to a WCAG 2.2 Level A criterion remains open.
- Level AA issues are either fixed or listed with the founder's written
  acceptance for launch. **[TARGET — founder to confirm the conformance level
  required for launch]**
- **Fail:** any door whose primary task cannot be completed by screen reader or
  keyboard alone; any keyboard trap; any form field with no programmatic label.

## Results

Not yet run.

## Still owed

- An owner (internal fluent user or external tester) and a date.
- Founder decision on the conformance target (WCAG 2.2 AA is the usual
  benchmark).
- A text alternative design for the Map door, if one does not already exist —
  the map is visual by nature, so the parcel search and list must carry the
  information.
- The axe findings from the campaign report (branch
  `claude/simulation-campaign-2026-10`) fixed first, so this manual pass is not
  spent rediscovering automated findings.

## Run log

_(empty — append entries per the format in [README](README.md))_
