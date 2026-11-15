# P0 front-door fixes (D11) — Step 0 record and local proof

Package: `claude-package-front-door-fixes-2026-11` (Muse, 2026-11-03).
Branch: `claude/p0-front-door-fixes`, off main `f7f2e3f`.

## Where this was measured

**A staging-shaped local build, not staging.** This session had no staging
E2E token and no staging sign-in, so it could not act as a user on staging.
Everything below ran against `npm run build` + `node dist/index.cjs` with the
E2E workflow's environment (`.github/workflows/e2e-mobile.yml`), on a local
Postgres 16 + pgvector with the schema pushed by
`tests/e2e-mobile/global-setup.ts`.

**"Fresh post-onboarding user"** means a brand-new tenant: the
`e2e-persona-<slug>` session cookie resolves to a new user that provisions
its own org on first request (`server/auth/testAuth.ts`). Each probe run
used a new slug, acknowledged the AI disclosure, answered the cookie
banner, and walked `/onboarding-v2` through the UI choosing **"Set up data
later"** — no sample data, nothing imported.

Viewports: phone 390×844, tablet 820×1180, desktop 1440×900; themes light
and dark. The first-sight check after the fix also covered iPhone SE
320×568, Galaxy S20 360×800, iPad mini 768×1024, 1280×800 and 2560×1440.
Probes are in `probes/` (Chromium 153; they hardcode the sandbox's browser
path). Raw output: `step0-land_flipper.json`, `step0-note_investor.json`,
`nav-main.json`.

## Step 0 verdicts (on main, before any change)

| Leg | Verdict | What was measured |
|---|---|---|
| Fix 1 — Pax composer on /ai | **Broken** | The composer rendered on 12 of 12 runs (2 personas × 3 viewports × 2 themes), and Playwright's `isVisible()` was true, but it was off the first screen on 12 of 12. Its top edge was at 1,758px of the document on the phone (viewport 844), 1,622px on the tablet (1,180) and 1,316px on desktop (900). Above it were the hero, the disclaimer, two suggestion lists and the welcome block. Cause: layout. It was not gating; the `AiChatGuard` theory does not apply. |
| Fix 2 — first-value CTA on /today | **Broken against the bar; partly contradicts the spec** (see below) | 0 of 12 runs showed either pinned form ("Import your first tape" / "Add your first watch"). Two CTAs do exist (see below). |
| Fix 3 — "Transition was skipped" | **Not reproduced → re-proof only** | 0 page errors in 12 runs: 3 viewports × 2 themes × {motion allowed, reduced motion}. Each run walked the CJ path (landing → `/auth?mode=register` → `/today` → onboarding by clicks → `/today` → `/ai` → `/today`), all 8 doors by in-app links, and 3 rapid double navigations including the `/pax` and `/dashboard` redirects. With reduced motion, 0 transitions started. No motion code was changed. |

Screens: `screens/before-ai-phone-390x844.png` (the composer is not on screen).

### Fix 2 detail: what exists today, and why it does not meet the bar

A fresh user's /today already has two CTAs:

- **`FirstDealCard`**: "Your first deal → Bring in your first list → **Import a list**".
- **The persona empty-state card**:
  - land investor: "Add your first parcel" / "Import leads" / "Try with sample data";
  - note investor: "Add your first note" / "Import your portfolio" / "Try with sample data".

Why they miss the bar:

- Neither uses the design's pinned copy.
- For a note investor, "Import your portfolio" routes to `/finance`, not to the import.
- `FirstDealCard` tells a note investor "There are no owners on your list yet", which is land vocabulary.
- "Try with sample data" is a mock dataset.

So the package's original premise, "no first-value CTA", is not what reproduces today. What reproduces is "no CTA in the pinned form wired to the real flow".

**Stopped half: "Add your first watch."** Nothing available to this package says which product object a "watch" is. The repo has two candidates, and neither can be wired without guessing:

- the **market watchlist** (`/market-watchlist`):
  - a feature-flagged route;
  - its entries carry `emailAlert`, so a CTA that creates one runs into D6;
- the **tax county watches** (`tax_county_watches`):
  - created only as a side effect of importing a tax list;
  - there is no "add a watch" flow.

The UI design (§4.1) was not in the repo, and its persona mapping for the two forms could not be read. So only the unambiguous half is built: "Import your first tape" for a note investor, which is Linnea's path. The CJ1 persona (land investor) gets no pinned CTA from this package.

## What was built

### Fix 1: composer dock
`client/src/components/pax/pax-composer-dock.tsx`, `pax.tsx`, `command-center.tsx`, `page-shell.tsx`.

How it works:
- The composer block renders, through a portal, into a sticky slot that PaxPage places in the conversation region.
- That region's top edge is on the first screen at every viewport.
- The composer pins to the bottom of the screen, above the mobile bottom nav when that nav is shown. At the end of the thread it rests after the last message.
- It is the same element with the same state and handlers. Pax behaviour is unchanged.

Sticky positioning needs `<main>` not to be a scroll container, so PageShell gained an opt-in `stickyToViewport` (`overflow-x: clip` instead of `hidden`). It is opt-in because about 17 page-level `sticky` elements have never actually stuck. Only Pax opts in.

The placeholder is the pinned copy, verbatim: "Ask about a note, a parcel, or what changed this week". Not built: examples "drawn from the user's own objects" (§3.1). That needs a data fetch and is left for a later package.

Before → after, top edge of the composer:

| Viewport | Before | After |
|---|---|---|
| phone 390×844 | 1,758px (document) | 638–704px, on screen |
| SE 320×568 | — | 362–428px |
| desktop 1440×900 | 1,316px (document) | 802–860px |

16 of 16 viewport × theme combinations: in view both where the page settles and at `scrollY=0`, with nothing painted over it.

Screens: `screens/after-ai-*.png`.

### Fix 2 (note investor): "Import your first tape"
`client/src/components/today/FirstValueCta.tsx`, `today.tsx`, `notes.tsx`.

- **Placement.** In the Today hero, under the greeting and beside "Review N decisions" when that shows. That puts it on the first screen on every viewport. §4.2's order is unchanged for everything else.
- **Audience.** A note investor whose acquired-note book is empty. Fresh state is read from the existing `GET /api/notes/acquired` total. There is no new endpoint and nothing new is tracked.
- **Action.** It opens `/notes?action=new`, which is the note-tape import (intent "acquired" by default).

One fix was needed so the CTA actually lands in the import. Driving it showed that **every in-app link to `/notes?action=new` opened a closed import on a phone**. The cause:
- On an in-app route change, `/notes` is rendered once in the outgoing page-transition layer and mounted again in the incoming one. The trace is in `probes/wkdbg.cjs`: the h1 node changes identity while the dialog closes.
- The first instance opened the dialog and stripped `?action=new`, so the surviving instance read no action.
- A full page load mounts once, which is why typing the URL worked.

The param is now stripped when the dialog closes. This also fixes the existing "Add your first note" and "Import an updated tape" links.

Screen: `screens/after-today-fresh-note-investor-phone.png`.

## Tests, and the mutants that prove they bite

New tests:
- `tests/e2e-mobile/pax-composer-first-sight.spec.ts` covers every mobile project (iPhone 14, Pixel 5, iPhone SE, iPhone 14 Pro Max, iPad mini) plus 1280 and 1440 desktop, in light and dark. It asserts: in the viewport at settle and at `scrollY=0`; topmost at its centre; shown; accepts input; pinned placeholder.
- `tests/e2e-mobile/today-first-value-cta.spec.ts`:
  - a fresh note investor sees the pinned CTA on the first screen, at phone and desktop widths;
  - clicking it lands in the note-tape import (file picker visible) and it stays open;
  - with one acquired note, the CTA is gone;
  - a fresh land investor gets no CTA.
- `tests/unit/firstValueCta.test.ts` pins the decision function.
- CJ1's composer step now also asserts first-screen and not covered. This tightens it; nothing is loosened.

Mutants (each built and run, `--retries=0`):

| Mutant | Spec | Result |
|---|---|---|
| M1: composer rendered inline (dock bypassed) | composer spec, iphone-se | **red** (2 failed) |
| M2: `<main>` stays `overflow-x: hidden` | composer spec, iphone-14 | **red** (4 failed) |
| M3: `/notes` strips `?action=new` on mount (main's code) | CTA spec, iphone-14 | **red** (phone case) |
| M4: route-heading focus allowed to leave a dialog | CTA spec, iphone-14 | green, so the guard was **dropped** as unproven |

## Finding not fixed: the onboarding "Go to Today" bounce

This was found by Step 0's navigation trace (`probes/finish.cjs`). It sits outside the three intended states, so per the stop condition it is reported, not fixed.

What a user sees:
- A fresh user on the final onboarding step clicks **"Go to Today instead"**.
- They are sent back to **step 1 of the wizard** ("Your workspace, your way.").
- The server has already recorded onboarding complete.

Mechanism:
1. `onboarding-v2.tsx` `completeMutation.onSuccess` calls `invalidateQueries(["/api/me/needs-onboarding"])` without awaiting it, then `navigate(...)` at once.
2. `OnboardingGate` on `/today` renders from the cached `needsOnboarding: true`, which has a `staleTime` of 60s, and `<Redirect>`s back.
3. Trace: `pushState /today` → `pushState /onboarding-v2`.

This double navigation is the "onboarding step that navigates twice" mechanism that `view-transitions.ts` names for "Transition was skipped". The skip still happens underneath: 5 of 16 transitions per run were skipped by the browser. The #394 handler consumes it, so no page error surfaces. CJ1 hides the bounce because its next step is a `page.goto('/today')`.

Likely fix (one line, not applied): await the invalidation, or `setQueryData(["/api/me/needs-onboarding"], { needsOnboarding: false })` before `navigate`.

## Gates

See the PR body for the measured figures at the PR head.

## Close-out evidence still owed

Staging proof (Rollout §1–5) runs after the merge deploy:
- screenshots of /ai at phone and desktop;
- /today for a genuinely fresh note investor;
- the CJ navigation paths with page-error capture;
- the CJ run id and staging image the Atlas row will cite.

None of these exist yet.
