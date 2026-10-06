# Plan 1 — WebKit and Safari (desktop and iOS)

**Status:** Not yet run · **Owner:** [OWNER] founder to assign · **Index:** [README](README.md)

## Goal

Establish whether the customer app works in the browsers a large share of
AcreOS's audience uses: Safari on macOS, Safari on iPhone and iPad, and the
WebKit engine generally. "Works" means a customer can sign in, open all five
doors (Today · Map · Deals · Finance · Pax) plus Inbox and Settings, and
complete each door's primary action without an engine-specific defect.

## Why the campaign could not cover it

The campaign container had no WebKit build. Its device runs used
`playwright.campaign-mobile.config.ts` (on branch
`claude/simulation-campaign-2026-10`; do not assume it exists on `main`). That
config imports `playwright.mobile.config.ts` and forces every device project —
iPhone 14, iPhone SE, iPhone 14 Pro Max, iPad Mini — onto
`browserName: "chromium"`, and drops the `webServer`. Its own header says it
"measures LAYOUT contracts (touch targets, overflow, blank dialogs) at
iPhone/iPad sizes — it says nothing about Safari's engine." The campaign's UX
crawl config (`playwright.campaign.config.ts`, same branch) pins its iPhone
and iPad projects to Chromium for the same reason. So iPhone-_sized_ layouts
were exercised; Safari's engine, cookie policy, form controls and iOS
behaviours were not.

## What already exists on `main` (read before running anything)

- `playwright.mobile.config.ts` — device projects built from Playwright's
  `devices["iPhone 14"]`, `["iPhone SE"]`, `["iPhone 14 Pro Max"]`,
  `["iPad Mini"]`, whose default browser type is WebKit, plus `Pixel 5`.
- `.github/workflows/e2e-mobile.yml` — installs `chromium webkit` and runs
  `npm run test:e2e:mobile`, `tests/e2e-mobile/mobile-feel-contracts.spec.ts`
  and `tests/e2e-mobile/customer-surface-journeys.spec.ts` on pushes to
  `main` and `claude/**`.
- `playwright.config.ts` — a `jtbd-webkit` project running
  `tests/e2e/jtbd-outcomes.spec.ts` on WebKit with the iPhone 14 descriptor.
- `tests/README-launch-audit.md` — notes on running real iOS Safari through a
  device cloud.

Whether the WebKit projects in that workflow are green on the current `main`
SHA is **not established by this plan** — step A0 below is to read the runs.
Playwright's WebKit is a build of the engine, not shipping Safari: it does
not reproduce iOS Safari's browser chrome, Intelligent Tracking Prevention
behaviour exactly, the on-screen keyboard, or real touch hardware. Tiers B
and C below exist for that reason.

## Environment and prerequisites

| Tier                         | Environment                                                                                              | Needs                                                                                                                                                                        |
| ---------------------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A — automated WebKit         | Local build with `E2E_TEST_AUTH=1` (as in `.github/workflows/e2e-mobile.yml`), or the CI workflow itself | `npx playwright install --with-deps webkit`; `DATABASE_URL`, `ENCRYPTION_KEY`, dummy `CLERK_SECRET_KEY` and `VITE_CLERK_PUBLISHABLE_KEY` as the mobile config's header lists |
| B — real desktop Safari      | Staging, real Clerk sign-in (see plan 2)                                                                 | A Mac on the current and previous major macOS / Safari; a staging test account                                                                                               |
| C — real iOS / iPadOS Safari | Staging, real Clerk sign-in                                                                              | Physical iPhone (current and previous iOS major) and iPad, or a device cloud (`BROWSERSTACK_USERNAME` / `BROWSERSTACK_ACCESS_KEY`, per `tests/README-launch-audit.md`)       |

The E2E bypass is refused on any Fly machine (`assertTestAuthSafe()` in
`server/auth/testAuth.ts`), so Tiers B and C must use real Clerk sessions.

## Procedure

### Tier A — automated WebKit

- **A0.** Read the latest `e2e-mobile.yml` runs for the current `main` SHA.
  Record per-project (iPhone 14, iPhone SE, iPhone 14 Pro Max, iPad Mini)
  outcomes from the run itself, not from memory.
- **A1.** With WebKit installed, run locally:

  ```bash
  npx playwright test --config=playwright.mobile.config.ts \
    tests/e2e-mobile/mobile-feel-contracts.spec.ts > a1.log 2>&1; echo EXIT=$?
  ```

  This is the same spec the campaign ran under Chromium, now on WebKit — the
  difference between the two runs is the engine signal.

- **A2.** Run `npx playwright test --project=jtbd-webkit`.
- **A3.** If the campaign's UX crawl (`tests/simulation/campaign/ux-crawl.spec.ts`
  on the campaign branch) has landed on `main`, run it under a sibling config
  that keeps the device descriptors' default WebKit browser instead of forcing
  Chromium. If it has not landed, skip A3 and record the skip.

### Tiers B and C — real Safari, manual walk

For each browser/device, signed in as a staging test customer, walk each door
and record pass/fail per row:

| Area          | What to check                                                                                                                   |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Sign-in       | Clerk sign-in completes, session survives a reload and a tab close/reopen (Safari cookie policy)                                |
| Today         | Page renders, primary cards load, no blank state where data exists                                                              |
| Map           | Map tiles and parcel layers render; pan/zoom by touch; the page is usable with the on-screen keyboard open in search            |
| Deals         | Pipeline renders; moving a deal between stages works by touch (no hover-only affordance); no double-tap-to-activate             |
| Finance       | Tables scroll horizontally inside their container, not the page; CSV/PDF export downloads and opens                             |
| Pax           | Message send, streamed response renders, input stays above the keyboard                                                         |
| Inbox         | List, open thread, compose with the keyboard open                                                                               |
| Settings      | Form inputs including date and select controls (Safari's native pickers), file upload from Files / Photos                       |
| Shell         | Bottom nav and safe-area insets on notched devices; back/forward restores state; returning from background reconnects live data |
| Installed app | If `client/public/manifest.json` is used to add to home screen, repeat sign-in and one door in standalone mode                  |

Capture a screenshot or screen recording for every failed row.

### Out of scope here

The Capacitor iOS shell (`capacitor.config.ts`, `docs/mobile/capacitor-rollout.md`)
runs in WKWebView, a different surface. Whether it is in scope for launch is a
founder decision; if it is, it needs its own pass of this table.

## Pass criteria

- **Tier A:** every WebKit project in A0–A2 exits 0, read from the run's own
  exit status. A test that is skipped on WebKit counts as not covered, not as
  passed.
- **Tiers B and C:** every row above passes on every listed browser/device, or
  each failure has a filed defect with severity and the founder has accepted
  it for launch in writing.
- **Fail:** any door that cannot be reached, any primary action that cannot be
  completed, any sign-in that does not persist, or any console error raised by
  application code on a door.

## Results

Not yet run.

## Still owed

- An owner and a date.
- A decision on the minimum supported Safari / iOS versions (founder to
  confirm) — this plan assumes current and previous major.
- A decision on whether the Capacitor iOS shell is a launch surface.
- If the WebKit projects in CI are red or flaky on `main`, a triage of each
  before Tier B begins.

## Run log

_(empty — append entries per the format in [README](README.md))_
