# Elite-Team Refinement — Resume Point

**Last session:** 2026-04-22
**Last completed surface:** `/not-found` (commit `7b025e1`)
**Phase 1 inventory:** ✅ committed at `11d0e8c`

## How to continue

Paste the original Elite-Team prompt into a fresh Claude Code session. The
session will:

1. Read `docs/refinement/surface-inventory.md` — the ordered list of ~500
   surfaces with known issues and priority.
2. Read `docs/refinement/progress.md` — log of surfaces already signed-off,
   newest at bottom.
3. Read this file for the immediate next surface.
4. Continue the walk.

## Next surface to refine

**`/auth`** (sign-in / sign-up flow).

Already addressed in this session: Clerk widget `colorPrimary` override
(commit `2bc68e9`) — kills the default Clerk purple. Deploying now.

Remaining `/auth` refinements for the next session:
- [M] Verify every Clerk widget state at 375px: email entry, OTP,
  Google OAuth button row, sign-up name form, "check your email"
  screen, 2FA prompt, recovery code entry. Capture Playwright
  screenshots of each; refine any cramped layout.
- [A] Accessibility audit of the Clerk widget at the app wrapper level
  (SkipToContent already present; verify focus order when the widget
  mounts and when switching between sign-in/sign-up).
- [CW] Strip duplicated "Don't have an account? Sign up" — Clerk
  renders it internally AND the auth-page wrapper had a toggle in
  comments; verify no double-link.
- [T] Add a quiet "Secure sign-in powered by Clerk" + AcreOS brand
  moment below the widget so the jump from `/` to `/auth` feels
  continuous.
- [D] Desktop (1440px): the max-w-md form in a vast empty page feels
  lonely. Consider a split layout (brand/visual on left, form on
  right) at lg+.

## Surfaces remaining (high-priority chunk)

In inventory order after `/auth`:
- `/onboarding-v2` (critical — first-run)
- `/today` (started — mid-refinement in previous session, see progress
  for the text-violet → text-primary batch already shipped)
- `/leads`
- `/leads/dedupe`
- `/properties`
- `/deals`
- `/finance`
- `/settings` (includes the Theme Preset picker — the Safari purple
  source is likely here if not Clerk)

## Session hygiene reminders

- Commit per surface (or tight batch). One commit = one logical unit.
- Re-run 9-lens after each edit, not just at start/end.
- Verify via Playwright MCP at 375px AND 1440px where appropriate.
- Update `docs/refinement/progress.md` with every sign-off.
- Stop at ~85% context; rewrite this file before ending.

## Known in-flight issues to watch for on any surface

- **Purple leak** (Safari iPhone only): Clerk widget fix shipping now.
  If user reports purple persists after reload, investigate theme
  preset in `localStorage['acreos-theme-config']` on their iPhone.
- **Red error toasts**: 404/403 now suppressed globally (`queryClient.ts`).
  If any toast appears unwarranted, add to the suppression list.
- **Credits endpoint 500**: Fixed via prod DB column add 2026-04-22.
- **Fly deploy leases** can linger ~90s after a failed deploy; retry.

## What commit `HEAD` should be when you start

After this session's deploy completes: `7b025e1` or later.
