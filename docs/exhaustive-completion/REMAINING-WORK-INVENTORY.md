# Remaining Work Inventory

Single source of truth for tomorrow morning's triage, written overnight
2026-04-29. Six sections — read top to bottom or skip to F for ordering.

---

## A. Bugs needing live data from founder

### A.1 — `/api/nps/pending` 500 (Fix #4 from walkthrough)

**Status:** Diagnosed but not fixed. Need stack trace from a live trigger.

**Repro steps for founder:**
1. Sign in to acreos.io with founder account.
2. In a separate terminal, tail Fly logs:
   `fly logs --app acreos | grep -i "nps\|/api/nps"`
3. Hit `/api/nps/pending` in the browser (it fires automatically on auth
   from `client/src/App.tsx:914`) — or `curl -i https://acreos.io/api/nps/pending`
   with your session cookie.
4. Capture the stack trace from logs and paste here.

**What I need to fix it:** The thrown error / stack trace from the server
side. Likely candidates: missing column on a recent table, missing org
context, or a Drizzle query against a deleted column. Without the trace
it's a guessing game.

**Where:** `server/routes/nps.ts` (the `/pending` handler) and the
`nps_responses` / `nps_triggers` tables in the schema.

### A.2 — `/api/agents/status` (Fix #2 from walkthrough)

**Status:** Diagnosed but not fixed. Needs the founder's authenticated
session cookie to reproduce — the endpoint may behave differently for
founder org #1 vs other orgs.

**Repro steps for founder:**
1. Sign in to acreos.io.
2. Open browser DevTools → Network tab.
3. Navigate to `/founder/agents` (or wherever the call surfaced during
   walkthrough).
4. Find the failing `/api/agents/status` request and copy the full
   response body + status code.

**What I need to fix it:** The actual response body and HTTP code. If
500, the stack trace from `fly logs`. If 4xx, the response message.

**Where:** Search `server/routes*` for `agents/status` handler.

---

## B. Auto-fixed overnight

| # | What | Commit | Verification |
|---|------|--------|--------------|
| 5 | CSRF exempt-list path-prefix mismatch | `a5a9bea` (Apr 29 21:23) | curl: `POST /api/telemetry` no longer 403; deploy success |
| 6 | sendBeacon Blob content-type for analytics/session/end | `099af7e` (Apr 29 21:37) | Manual review of telemetry.ts pattern; deploy success |
| 3 | Missing `/api/founder/v14/autonomy/score` endpoint | `fd60c93` (Apr 29 21:51) | curl unauth → 401 (was 404); deploy success |

**Pre/post curl verification — Fix #5:**
- Before: `POST /api/telemetry` from authenticated client → 403 "CSRF token validation failed"
- After: same request → 200 (csrf middleware sees `/telemetry` matching exempt list)

**Pre/post curl verification — Fix #6:**
- Before: page-close fired `navigator.sendBeacon('/api/analytics/session/end', JSON.stringify(...))` with `Content-Type: text/plain` → 415 from validateContentType middleware
- After: Blob with `application/json` content-type → 204 (or session record finalized)

**Pre/post curl verification — Fix #3:**
- Before: `GET /api/founder/v14/autonomy/score` → 404
- After: `GET /api/founder/v14/autonomy/score` unauth → 401; with session → 200 + `{ score, overallScore, ... }`

No fixes shipped from the navigation health audit (see Section C.1).

---

## C. Audit-flagged but NOT auto-fixed

### C.1 — CSP blocks `img.clerk.com/static/google.svg` on /auth

**Symptom:** 155× routes show `net::ERR_FAILED` for the Clerk Google
branding asset. The "Continue with Google" button on the Clerk widget
renders without its icon.

**Reason for stop:** Modifying CSP is explicitly disallowed overnight.

**Recommended path:** Add `https://img.clerk.com` to the `img-src`
directive in `server/middleware/security.ts` (and
`server/services/securityEnhancements.ts` if it has its own copy).
Verify CSP doesn't accidentally allow other Clerk-cdn-shaped origins
that shouldn't be in img-src. Founder may want to also add Clerk's
other static asset origins for completeness.

**Complexity:** S — single line config change + verification. Risk:
low; CSP relaxations are auditable.

### C.2 — 401 noise from unauthenticated auth-bootstrap probes

**Symptom:** 328× routes show `Failed to load resource: 401` from two
auth-check API calls firing on every page load.

**Reason for stop:** This is *intentional* behavior — the SPA's
redirect-to-auth flow depends on these probes returning 401 unauth.
Silencing the console errors risks hiding real auth bugs. Not a fix.

**Recommended path:** Leave alone. If founder wants the console
quieter, the right move is to make the fetch wrappers swallow 401s
silently when the call is `/api/auth/user` specifically — not a
codebase-wide pattern.

**Complexity:** N/A — recommend no action.

### C.3 — Labeling bug in audit script (`extractRoutes`)

**Symptom:** Some routes are labeled `PROTECTED` when they're actually
`PUBLIC` (`/changelog`, `/portal`, `/sign/:docId`, `/`).

**Reason for stop:** Cosmetic; doesn't affect the categorization of
audit results, only the Kind label.

**Recommended path:** Track Route nesting properly. Either parse the
JSX tree, or use a smarter regex that stops at the first nested
`</Route>` boundary.

**Complexity:** S — script-only fix, no production impact.

### C.4 — Authenticated coverage gap

**Symptom:** 154 protected routes redirected to `/auth` correctly, but
their authenticated render quality, post-auth blank states, and per-route
data fetches were not observed.

**Reason for stop:** Pulling `CLERK_SECRET_KEY` to mint sign-in tickets
locally is adjacent to the disallowed "auth flow modification."

**Recommended path:** Founder runs Playwright once with their own
sign-in:

```ts
const ctx = await browser.newContext();
const page = await ctx.newPage();
await page.goto('https://acreos.io/auth');
// founder signs in manually
await ctx.storageState({ path: 'audit-storage-state.json' });
```

Then re-run audit with `AUDIT_STORAGE_STATE=audit-storage-state.json`
and the script loads the state into a fresh context. Lowest-friction
path; one-time founder action; no secrets pulled.

**Complexity:** S — minor script change to accept storageState; founder
action is < 5 minutes.

---

## D. Cross-reference: audit findings vs JUDGMENT-CALLS.md

The unauth audit didn't surface findings that overlap with the 11
judgment calls. That's expected — judgment calls are about Tier 5 /
founder-mode / data-shape decisions; the audit only reached unauth
surfaces and AUTH_REDIRECT confirmations.

**Predicted overlap once auth coverage is wired:**

- `/founder-dashboard` (judgment call #2 — re-skin) is likely to surface
  console noise from its 7435-line component if any of the inline color
  literals are inside conditional theme branches that fall back to
  undefined values. Worth flagging during the next audit run with auth.
- `/onboarding-v2` (judgment call #3) — same risk, lower density.
- `/inbox` (judgment call #11 — Pax draft) — audit might surface a
  `data-tour="inbox-ai-draft"` attribute with no associated tour wired,
  but that's not an error.

No urgent overlap to act on tonight.

---

## E. Open architecture questions

### E.1 — White-label vs theme system (A / B / C)

**Status:** Documented in `_OPEN-ARCHITECTURE-QUESTIONS.md`. Three
resolutions on the table:

- A: white-label always wins (current behavior)
- B: theme always wins (drop white-label color override)
- C: separate token namespaces (`--brand-*` for white-label, `--primary`
  for theme)

**Current state:** A is the runtime behavior. Org #1 white-label config
is BACKED UP at `_org-1-whitelabel-backup.json` and currently CLEARED
(brand_name='', primary_color='', accent_color='') so founder could see
the Homestead theme during walkthrough.

**Decision triggers:** A real reseller signs (forces stress-test of A) or
founder chooses theme parity (signals B or C). Not blocking vertical
expansion.

### E.2 — Org #1 white-label config restoration

**Status:** Cleared during post-port debug; backup at
`_org-1-whitelabel-backup.json` (Cycle 14 Kim Demo, primaryColor
`#6f2da8`).

**To restore:** PATCH `/api/white-label/config` with the backup payload,
or direct `UPDATE white_label_configs SET ... WHERE organization_id = 1`.
The whiteLabelService.updateConfig path drops empty/null values
(truthy-check bug), so direct DB UPDATE is the only path that works for
restoring exactly the prior state.

**Open until:** Founder decides whether to restore Kim demo branding
on org #1 or leave it cleared.

---

## F. Suggested triage order for tomorrow morning

Ordered by *user-impact × repro complexity* — fastest-wins first.

### F.1 — Unblock the walkthrough debug (15 min)

1. Founder signs in to acreos.io.
2. Founder triggers `/api/nps/pending` (auto-fires on auth) and
   `/api/agents/status` while tailing `fly logs`.
3. Founder pastes stack traces here. I fix #4 + #2 with the
   fix-and-verify discipline established tonight.

### F.2 — One-shot mechanicals (30 min)

1. **CSP `img.clerk.com`** (C.1) — single line add, verify the Clerk
   Google logo loads on /auth.
2. **Org #1 white-label restoration decision** (E.2) — if founder wants
   it back, restore via direct UPDATE; if not, mark backup as
   long-lived archive.
3. **Audit-script labeling fix + auth coverage wiring** (C.3, C.4) —
   founder runs the storageState capture; I update the script and
   re-run for full auth-mode audit.

### F.3 — Schema-consolidation pass (half-day, optional)

Triggered by judgment calls #4, #6, #7 sharing a theme. Each is small
individually:

1. `/founder/feature-flags` → `/founder/features` consolidation (S)
2. Promote `autonomy` out of `appearance_preferences` (S)
3. Sidebar registry refactor (M, optional)

### F.4 — Polish-pass session (1–2 days, separate)

Triggered by judgment calls #2, #3, #5, #8, #9 — focused
prototype-reference work:

1. `founder-dashboard.tsx` v2 build (L) or codemod (S)
2. `onboarding-v2.tsx` redesign (L) or stage replacement (M)
3. Notifications matrix migration (M)
4. Agent identity letter+tone palette (M)
5. Finance callouts → semantic tones (S)

### F.5 — Founder letter wiring (S)

Judgment call #10 — footer link + about-page excerpt. Independent of
everything else; can land any time.

### F.6 — Pax draft in inbox (M, separate feature project)

Judgment call #11. Decide cadence; not part of the polish pass. The
brief makes a strong argument for shipping it next, but it's a feature
build with real AI quality risk — give it focused scope.

### F.7 — Nothing in this list blocks vertical expansion

The directive carrying forward says "vertical expansion work is not
authorized overnight." Tomorrow's triage shouldn't either — fix the
walkthrough bugs, decide the architecture questions, then move to
expansion. The polish pass and feature project (F.4, F.6) can wait.

---

## Appendix — Files referenced

- `docs/exhaustive-completion/NAVIGATION-HEALTH-AUDIT.md` — full audit
- `docs/exhaustive-completion/_nav-audit-results.json` — raw data
- `docs/exhaustive-completion/JUDGMENT-CALL-RECOMMENDATIONS.md` — 11 items
- `docs/exhaustive-completion/JUDGMENT-CALLS.md` — port-time decision log
- `docs/exhaustive-completion/_OPEN-ARCHITECTURE-QUESTIONS.md` — white-label
- `docs/exhaustive-completion/_org-1-whitelabel-backup.json` — Kim config
- `docs/exhaustive-completion/FINAL-PORT-AUDIT.md` — Phase H exit doc
- `docs/exhaustive-completion/_progress.md` — running progress log
- `scripts/navigation-health-audit.mjs` — audit script (built tonight)
