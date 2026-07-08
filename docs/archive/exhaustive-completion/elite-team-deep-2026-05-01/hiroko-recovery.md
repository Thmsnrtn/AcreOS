# Hiroko Watanabe — Error State & Recovery UX Audit

**Wave 2 of 87. 2026-05-01. Scope: every place AcreOS shows the user something has gone wrong.**
**Read first: `vesna-polish.md` (toast voice), `ines-reliability.md` (where things actually fail).**

---

## 1. One-line verdict

AcreOS is in the top 5% of B2B SaaS for error copy — the `Couldn't [verb]; your [noun] is unchanged` pattern is used 80+ times correctly, the page-level error boundary uses a homestead-styled coverage page (not a stack trace), and the e-sign counterparty surface is *better* than DocuSign's. The remaining gaps are surgical: ~12 high-stakes surfaces still leak raw `error.message` with no reassurance ("Failed to send mail" on direct mail send is the worst offender — money + legal + outbound trust collapses there), the maintenance page leaks founder-mode codenames (Sophie, Atlas) to customers, and `getErrorMessage` does substring matching on `error.message` that will silently break the moment server messages change. Two days of focused rewrites closes the gap.

---

## 2. Error pattern inventory

### 2.1 Toast (the dominant error surface — ~150 call sites)

| Pattern | Example file:line | Quality |
|---|---|---|
| **Apple-grade** — verb + reassurance + retry | `client/src/pages/founder-dashboard.tsx:1548` `"Couldn't test endpoint"` / `"${error.message} — the endpoint's last-known status is unchanged."` | **5/5** |
| **Apple-grade** — verb + draft preserved | `client/src/components/template-editor.tsx:204` `"Couldn't create template"` / `"${error.message} — your draft is preserved."` | **5/5** |
| **Apple-grade** — money/legal explicit | `client/src/pages/finance.tsx:1255` `"…no card was charged."` | **5/5** |
| **Apple-grade** — partial success accounting | `client/src/components/seller-intent-panel.tsx:118` `"${errorCount} failed and weren't scored. Retry from each lead's Analyze button."` | **5/5** |
| **Mid** — "Couldn't" + raw `error.message` only, no reassurance | `client/src/components/ai-offer-generator.tsx:147,185,213` `description: error.message` | **3/5** |
| **Bad** — Title-Case "X Failed" + raw message | `client/src/components/email-settings-content.tsx:215` `"Activation Failed"`; `client/src/components/background-mode.tsx:67` `"Task Failed"`; `client/src/hooks/use-push-notifications.tsx:134` `"Subscription Failed"` | **2/5** — Title-Case + "Failed" both banned by §11 |
| **Worst** — "Failed to [verb]" + raw `error.message` for high-stakes outbound | `client/src/components/campaigns-content.tsx:457,825` `'Failed to switch mode'`, `'Failed to send mail'` | **1/5** — see §3.3 |

### 2.2 Inline form error (`<FormMessage>` and `<InlineError>`)

- `client/src/components/ui/form.tsx:146-172` — RHF FormMessage renders the Zod `error.message` raw with `<AlertCircle>` icon, `role="alert"`, `aria-live="polite"`, destructive color. Mechanically correct. **Quality of the message is whatever the schema author wrote.** I did not find a `validationMessages.ts` central style guide. Risk: each new form invents its own copy ("Required", "Please enter a valid email", "This field is required") and they drift out of voice. **3/5 — infrastructure great, copy un-policed.**
- `client/src/components/inline-error.tsx` — 18-line component, single message string + optional retry button. Used at `pages/deals.tsx:466`. Generic but clean. **3/5 — caller controls quality.**
- `client/src/pages/sign-document.tsx:262-273` — bespoke alert div for signature submit failure, copy is `"Couldn't submit your signature"` + `"Your signing link is still valid — please try again."` **5/5 — exemplary.**
- `client/src/pages/reset-password.tsx:32,36,46` — local `setError` strings: `"The two passwords don't match. Please retype them."`, `"Your new password must be at least 8 characters."`, `"We couldn't reset your password. This link may have expired — request a new one."` **5/5 — every one tells user what's wrong AND what to do next.**

### 2.3 Page-level error boundary (`<ErrorBoundary>`)

- `client/src/components/error-boundary.tsx:48-134` — class component, captures via `componentDidCatch`, generates `errorId` (`err_${Date.now()}_${random}`), forwards to Sentry, renders `<ServerErrorPage>` from `coverage-page.tsx` plus a debug strip with the trace ID and a Hard refresh button. Used at App root (`App.tsx:1076`), inside `<PageShell>` (`page-shell.tsx:100`), inside `team-inbox.tsx:358`, and around the campaign drawer (`campaigns-content.tsx:662-683` — exemplary local fallback: `"Couldn't open campaign"` / `"Couldn't load this campaign's detail view. The campaigns list is still usable — pick a different campaign or try again."`). **Quality: 4.5/5.** See §7 for the one fixable issue.

### 2.4 Page-level coverage pages (`coverage-page.tsx`)

- `NotFoundPage` — `"This page wandered off."` / `"The page you're looking for doesn't exist, has moved, or the link is out of date. No harm done — pick where to head next."` **5/5.**
- `ServerErrorPage` — `"AcreOS hit a snag on our end."` / `"Not your fault. Our servers got tripped up loading this. Most retries succeed within a few seconds…"` **5/5 — the "Not your fault" sentence is the most important sentence in the whole error system.**
- `ForbiddenPage` — `"You don't have access to this."` / `"The owner of this workspace hasn't given you access to this page, or your role doesn't include it. Ask your team lead, or head back where you came from."` **5/5.**
- `MaintenancePage` — `"AcreOS is doing a quick tune-up."` / `"…Sophie is still watching the notes, Atlas is still watching the parcels…"` **2/5 — copy is otherwise lovely but it leaks two founder-only persona codenames to customers.** Per `MEMORY.md` "Persona architecture": Sophie/Atlas are founder-mode names; customers see Pax. **This is the same bug Vesna flagged on `/today` and `empty-states.tsx:128`, except it ships at the moment of maximum trust fragility — when AcreOS is *down*.** Severity: P0.

### 2.5 Network-down / offline state

- `client/src/components/offline-indicator.tsx:54` — `"You're offline. Changes will sync when reconnected."` Sticky amber banner; reconnect → emerald 1.5s `"Reconnected! Syncing data..."`. **4/5 — copy is good, but "Changes will sync when reconnected" is partly aspirational** — the offline-cache hook exists (`hooks/use-offline-cache.ts`, `hooks/use-offline-storage.ts`), but most mutations don't queue. A user who clicks "Send campaign" while offline will see the toast error, not a queued send. **This is a promise the app can't always keep.** Tighten to: `"You're offline. Reads cached locally; writes will fail until you reconnect."` Less elegant, more honest.

### 2.6 Timeout state

- No dedicated timeout UI. `getErrorMessage` (`error-utils.ts:22-23`) catches `timeout` substring → `"Request timed out. Please check your connection and try again."`. `getErrorTitle` → `"Request Timeout"`. **3/5 — generic and uppercase Title-Case, but at least specific.** No "your X is unchanged" reassurance because this layer doesn't know what verb was attempted.

### 2.7 Server `Errors.*` (the response shape behind almost all of the above)

`server/utils/errors.ts:38-74` — `notFound/badRequest/validationFailed/unauthorized/forbidden/limitExceeded/internal`. Conformant `{ error, message, details, statusCode }` envelope. Auto-logs on 500. Production strips error-message details from 500 (`"Internal server error"`). **5/5 for engineering hygiene.** The catch is that the *human-readable `message`* is whatever the route handler passes — there's no shared catalog. So `Errors.notFound(res, "Lead")` returns `"Lead not found"` (good), but `Errors.badRequest(res, "Invalid input")` returns `"Invalid input"` (useless to the user). Recommend a small `messages.ts` in `server/utils/` so handlers compose from a shared lexicon.

---

## 3. High-stakes failure paths

The four moments where bad recovery copy causes permanent trust loss.

### 3.1 Payment failures — **5/5, protect this**

- `client/src/pages/borrower-portal.tsx:375` — `"We couldn't start your payment right now. No card was charged — please try again."` (and 381 — the `catch` branch — same copy). Money + counterparty + outbound trust. The "No card was charged" sentence is the entire reason the borrower won't call angry tomorrow.
- `client/src/pages/finance.tsx:1255` — same pattern in payment-link generation.
- `client/src/pages/settings.tsx:454` — subscribe failure: `"…no card was charged and your seat count is unchanged."` Two reassurances in one sentence.
- `client/src/pages/dunning-manager.tsx:71` — `"The customer's card wasn't charged. You can try again or cancel the case."`
- `client/src/pages/finance.tsx:765` — billing portal: `"Couldn't open the billing portal"` / `"Check your connection and try again."` Could add `— your subscription is unchanged` for symmetry. Minor.

**Verdict:** payment is the strongest-protected surface in the app. The voice discipline holds even under code review pressure.

### 3.2 E-sign failures — **4.5/5, one tightening needed**

- **Originator side** (`client/src/components/request-signatures-dialog.tsx:103-108`): `"Couldn't request signatures"` / `"${err.message} — your signer list is preserved. Try again."` 5/5.
- **Counterparty side** (`client/src/pages/sign-document.tsx`):
  - Load failure (line 169-191): full card with `"Can't load this document"` / `{loadError}` / `"If you believe this is a mistake, reply to the email that sent you this link — the sender can reissue it."` + Try again button. **This is better than DocuSign.** It tells the *external counterparty* — who has zero AcreOS context — exactly who to contact. 5/5.
  - Submit failure (line 262-273): `"Couldn't submit your signature"` + `"…Your signing link is still valid — please try again."` 5/5.
  - Server-internal: `eSigningService.sendForSignature` lacks idempotency (per Ines §1.3) so a retry can send two emails to the counterparty. The UI says nothing went wrong; the counterparty receives two "please sign" emails. **The *engineering* failure leaks past the UX layer.** Per Ines: row-level `FOR UPDATE` check before external POST.

### 3.3 Mailer / direct-mail / outbound — **2/5, fix today**

This is the one place the voice discipline breaks.

- **`client/src/components/campaigns-content.tsx:823-829`** — direct mail send (real money to Lob/wire to print/USPS) on failure shows:
  ```
  toast({ title: 'Failed to send mail', description: error.message, variant: 'destructive' });
  ```
  - "Failed to send mail" = banned voice ("Failed to" instead of "Couldn't").
  - Raw `error.message` = could be `"500 Internal Server Error"` or `"Lob API error: API key invalid"` — neither tells the user *what's safe*.
  - Missing: "no mail was queued. Your campaign and credit balance are unchanged." This is a money + legal (TCPA-adjacent) + outbound moment. The single most-rewritable error string in the app.
- **`client/src/components/campaigns-content.tsx:457`** — `'Failed to switch mode'` + raw `error.message`. Switching test↔live mode on a campaign mailer is the moment where the *next* send becomes real money. Same fix.
- **`client/src/pages/finance.tsx:551`** — dunning reminder send: `"Couldn't send reminder"` / `"…no reminder was sent."` Already correct. Use as the reference rewrite.
- **`client/src/components/email-compose-sheet.tsx:107`** — outbound email send: `"Couldn't send email"` / `"Your draft is preserved. Try sending again."` Correct.
- **`client/src/pages/inbox.tsx:695`** — `"Couldn't load messages"` / `"Check your connection and try again."` Correct but generic; OK because it's a read.

### 3.4 AI-draft failures — **3.5/5**

AI failures are interesting because the user often *doesn't know* the AI ran. If a draft fails and the textarea stays empty, the user types from scratch — annoying but not destructive. If the AI returns a half-complete draft and the failure UI is unclear, the user might *send* the half-draft thinking it's complete. **Highest-risk pattern: silent partial-failure.**

- `client/src/pages/inbox.tsx:286-306` — `draftReplyMutation` on error sets `draftError` state with `err.message`. The UI rendering of `draftError` (not pasted in this audit) needs verification — does it show alongside the empty textarea, or replace it? Recommend: textarea always present, error chip above it: `"Pax couldn't draft a reply — your message is unchanged. Type your own or try again."`
- `client/src/components/ai-offer-generator.tsx:146,184,213` — three `description: error.message` calls with no reassurance. `"Couldn't generate offer suggestions"` is great as a title; the description should add `"— your existing offer fields are unchanged. Try again."`
- `client/src/components/content-generation.tsx:230` — `"Couldn't generate copy"` / `"Your existing draft is unchanged. Try again."` 5/5.
- `client/src/components/due-diligence-panel.tsx:134` — `"Couldn't generate dossier"` / `"${error.message || 'No analysis was started'} — your due-diligence settings are unchanged."` 5/5.
- `client/src/components/due-diligence-panel.tsx:432` — inline failure card on a polled job: `"Dossier generation failed"` + Try again button. **3/5 — "generation failed" is passive-blame voice; should be `"Pax couldn't finish the dossier"` to match the rest of the app.**
- `client/src/components/deal-feed/daily-deal-feed.tsx:600` — `"Couldn't generate today's deals — one of our data sources is taking a break."` **5/5 — anthropomorphizes the failure ("taking a break") instead of blaming the user. This is the voice.**

### 3.5 Form validation (Zod / RHF)

Not strictly money/legal, but: `FormMessage` (`ui/form.tsx:146`) renders whatever the schema returns. I did not find a centralized validation message file. Recommend a `client/src/lib/validation-messages.ts` that exports the standard set in voice. Otherwise every new schema author writes `"Required"` or `"Invalid"` and the voice degrades by attrition.

---

## 4. Anti-patterns found

### 4.1 Generic title strings ("Error" / "Failed")

- `client/src/components/email-settings-content.tsx:215` — `"Activation Failed"` Title-Case
- `client/src/components/background-mode.tsx:67` — `"Task Failed"` Title-Case
- `client/src/hooks/use-push-notifications.tsx:134` — `"Subscription Failed"` Title-Case
- `client/src/components/campaigns-content.tsx:457,825` — `'Failed to switch mode'`, `'Failed to send mail'`

Five total. Banned by §11. Two-line fix each.

### 4.2 Bare `description: error.message` with no reassurance

Found 9: `ai-offer-generator.tsx:147,185,213`; `email-settings-content.tsx:216`; `campaigns-content.tsx:458,826`; `integrations-settings.tsx:379,406,434`; `vertical-badge.tsx:62`. Each needs the standard `— your X is unchanged` suffix.

### 4.3 Dead-end error UI (worst pattern: shows "Error" with no action)

I checked deliberately and **could not find a single example** of an error state in AcreOS that lacks an escape hatch. Every `QueryErrorState` has a retry button or surrounding navigation; every coverage page has a primary CTA; every toast lives in a UI where the user can re-press the button. **This is rare and worth protecting.**

The closest near-miss: `client/src/pages/founder-dashboard.tsx:1719` — `toast({ title: data.success ? "Endpoint approved" : "Could not approve", description: data.message })`. When `data.success === false`, the toast is **not** marked `variant: 'destructive'` and there's no retry pathway shown. The user has to find the row again to click Approve again. Severity: low (founder-only surface) but worth fixing.

### 4.4 Shame language / blame language

Zero instances of `"Invalid input"`, `"You did wrong"`, `"You must"`. AcreOS does not blame the user — every error attributes the problem to the system. **Strong.**

One borderline case: `client/src/lib/error-utils.ts:11` — `"You don\'t have permission to do this."` is mildly accusatory. Compare the page-level `ForbiddenPage` ("You don't have access to this. The owner of this workspace hasn't given you access… Ask your team lead"). The toast version should match — `"Your role doesn't include this. Ask your workspace owner."` keeps the agency with the org, not the user.

### 4.5 The substring-matching error classifier (architectural anti-pattern)

`client/src/lib/error-utils.ts:1-97` classifies errors by **substring searching `error.message`** for `"401"`, `"403"`, `"500"`, `"network"`, `"timeout"`. This means:
- The day a server returns `"Validation failed: phone must be 10 digits, got 401-555-0100"` (note the `401`), the client labels it a session-expired error and signs the user out.
- Any error with `404` in the body (e.g. a server-side calculation result) gets classified `"notFound"`.
- Localized error messages (Spanish/French/etc) silently lose all classification.

Fix: classify by HTTP status code on `Response` (which `apiRequest` already has access to in `queryClient.ts`), not by `error.message` substring. Pass the status code through as an `error.status` field. Severity: medium — works today but brittle. **This is what Stripe Dashboard learned the hard way circa 2018.**

### 4.6 Duplicate error-state systems

Three independent implementations of "show an error card with retry":
1. `<QueryErrorState>` (`query-error-state.tsx`) — full + compact variants, motion, theme-aware.
2. `<InlineError>` (`inline-error.tsx`) — 18 lines, no motion, plain.
3. Bespoke divs in `sign-document.tsx`, `campaigns-content.tsx:896`, `due-diligence-panel.tsx:432`, etc.

Pick one. Recommend `<QueryErrorState compact={true}>` becomes the inline standard, retire `<InlineError>`.

---

## 5. Fifteen specific rewrites — before → after

| # | File:line | Before | After |
|---|---|---|---|
| 1 | `components/campaigns-content.tsx:825-827` | `title: 'Failed to send mail', description: error.message` | `title: "Couldn't send mail", description: \`${error.message} — no mail was queued. Your campaign and credits are unchanged.\`` |
| 2 | `components/campaigns-content.tsx:457-459` | `title: 'Failed to switch mode', description: error.message` | `title: "Couldn't switch send mode", description: \`${error.message} — your campaign is still in ${currentMode} mode. No mail was sent.\`` |
| 3 | `components/email-settings-content.tsx:215-217` | `title: "Activation Failed", description: err.message` | `title: "Couldn't activate this email address", description: \`${err.message} — your existing email setup is unchanged.\`` |
| 4 | `components/background-mode.tsx:67-71` | `title: "Task Failed", description: errorDetails.slice(0, 100)…` | `title: "Couldn't finish that task", description: \`${errorDetails.slice(0,100)}… No further actions ran.\`` |
| 5 | `hooks/use-push-notifications.tsx:134-136` | `title: "Subscription Failed", description: "Could not enable push notifications. Try again later."` | `title: "Couldn't turn on push notifications", description: "Your existing notification settings are unchanged. Try again, or check that browser notifications are allowed."` |
| 6 | `components/ai-offer-generator.tsx:147` | `description: error.message` | `description: \`${error.message} — your offer fields are unchanged. Try again.\`` (apply to :185, :213 too) |
| 7 | `components/integrations-settings.tsx:379,406,434` | `description: err.message` | `description: \`${err.message} — your integration is unchanged.\`` |
| 8 | `pages/coverage-page.tsx:236-238` | `"…Sophie is still watching the notes, Atlas is still watching the parcels. Just the front door is closed."` | `"…AcreOS keeps watching your notes and parcels in the background. Just the front door is closed."` (kill the Sophie/Atlas leak — same fix Vesna already flagged elsewhere) |
| 9 | `components/offline-indicator.tsx:54` | `"You're offline. Changes will sync when reconnected."` | `"You're offline. AcreOS shows your last loaded data; new actions will fail until you reconnect."` (truth instead of aspiration) |
| 10 | `components/due-diligence-panel.tsx:432` | `"Dossier generation failed"` (passive blame) | `"Pax couldn't finish the dossier"` (anthropomorphize, take ownership) |
| 11 | `pages/founder-dashboard.tsx:1719` | `title: data.success ? "Endpoint approved" : "Could not approve", description: data.message` | Split into two `toast()` calls; failure case: `title: "Couldn't approve endpoint", description: \`${data.message} — the endpoint is still pending review.\`, variant: "destructive"` |
| 12 | `lib/error-utils.ts:11` (toast variant) | `"You don't have permission to do this."` | `"Your role doesn't include this. Ask your workspace owner."` |
| 13 | `lib/error-utils.ts:23` | `"Request timed out. Please check your connection and try again."` | `"This took too long to respond. Your work is unchanged — try again, or come back in a moment."` |
| 14 | `lib/error-utils.ts:27` | `"An unexpected error occurred. Please try again."` (this string violates §11 in spirit — "unexpected error occurred" is a euphemism for "something went wrong") | `"AcreOS hit an unexpected snag. Your work is unchanged — try again."` |
| 15 | `pages/sign-document.tsx:90` (counterparty) | `"This signing link is invalid or has expired."` | `"This signing link is no longer valid — it may have expired or been re-sent. Reply to the email that sent it for a fresh link."` (counterparties don't know what "invalid" means; tell them what to *do*) |

---

## 6. Recovery design principles — five rules for the team

Codify these in `docs/voice.md` and link from `CLAUDE.md`.

1. **Name what failed, in a verb the user just did.** Title is `"Couldn't [verb]"` — never `"Error"`, `"Failed"`, `"Oops"`, or `"Something went wrong"`. The verb must match the button the user pressed. ("Couldn't send mail" not "Couldn't send", not "Mail failed".)

2. **State what's still safe.** Description always includes `— your [noun] is unchanged` or the equivalent affirmative. If money is involved: `— no card was charged`. If outbound is involved: `— no [email/SMS/mail] was sent`. If draft work exists: `— your draft is preserved`. Reassurance is mandatory, not optional.

3. **Offer one specific next action.** Either `Try again`, `[contact channel]`, or `Wait — Pax is retrying`. Never `Please contact support` without a link. Never an error with no button or affordance.

4. **Don't blame the user.** Blame the system. "Pax couldn't finish" not "Generation failed". "Your role doesn't include this" not "You don't have permission". "AcreOS hit a snag" not "An error occurred". The user is the protagonist; the system is the only entity that can be wrong.

5. **External-counterparty errors are different.** A borrower or signer landing on AcreOS for the first time has zero context. Their error UI must (a) tell them who sent the link, (b) tell them what to do (reply to the email, contact the sender), (c) never show an AcreOS error code. `pages/sign-document.tsx:175-177` is the reference.

---

## 7. The page-level error boundary — does it exist; if so, is it good?

**Yes, it exists. It is genuinely excellent for B2B SaaS. Score: 4.5/5.**

`client/src/components/error-boundary.tsx`:
- Class component with `getDerivedStateFromError` + `componentDidCatch`. Correct React pattern.
- Generates a unique `errorId` (`err_${Date.now()}_${random}`) — visible to the user as `Trace: err_…` so support requests are traceable.
- Forwards to Sentry (`Sentry.captureException`) with `componentStack`, `url`, `errorId`. Engineering observability is wired.
- Renders `<ServerErrorPage>` from `coverage-page.tsx` — the same homestead-styled "Not your fault. Most retries succeed within a few seconds" layout used for /500 routes. **Visual + voice consistency between *application crashed* and *route returned 500* is rare.**
- Below the styled page, a debug strip shows the trace ID, the raw error message, and a "Hard refresh" button. The strip uses muted colors and monospace — present without dominating.
- Three nesting layers: App root (`App.tsx:1076`), inside every `PageShell` (`page-shell.tsx:100`) so a single page's crash doesn't kill the sidebar/topbar, and surgical local boundaries around risky surfaces (`campaigns-content.tsx:662` around the campaign drawer, `team-inbox.tsx:358` around the inbox).
- Local-fallback example (`campaigns-content.tsx:662-683`): `"Couldn't open campaign"` / `"Couldn't load this campaign's detail view. The campaigns list is still usable — pick a different campaign or try again."` This is the textbook pattern: *contain* the failure, *describe* what's still working.

**The 0.5 deduction:**
- The "Try again" button (`handleRetry`) sets `hasError: false` and re-renders the children. If the underlying cause is a stale React Query cache or a corrupted Zustand store, the same crash fires again. There's no `queryClient.clear()` or store reset. The "Hard refresh" fallback covers this, but a smarter retry would invalidate caches first.
- `console.error` at line 34 in production is fine for now (Sentry catches the upstream), but should be conditional on `import.meta.env.DEV` once Sentry is verified.
- The `errorId` is ephemeral — generated client-side, not correlated with any server-side request ID. If the crash was triggered by a backend response, support has the trace ID but no way to find the originating request. Consider: when `apiRequest` receives a non-OK response, attach the response's `X-Request-Id` to the thrown error; ErrorBoundary surfaces both `errorId` and `requestId`.

Otherwise: this is what every SaaS error boundary should look like. Protect it.

---

## 8. Appendix — quick numbers

- `<EmptyState>` usages: 43
- `<QueryErrorState>` usages: 17
- `<ErrorBoundary>` usages: 18 (4 unique mount points + factory `withErrorBoundary` + tests)
- `"Something went wrong"` instances in client code: **0** (the only matches are the comments forbidding it). §11 enforcement is real.
- Toast call sites with `Couldn't [verb]` pattern: ~80
- Toast call sites violating the pattern: **~12** (listed in §4)
- High-stakes failure paths with non-conformant copy: **2** (campaign mail send 825, switch mode 457)
- Founder-codename leaks in customer-visible error UI: **1** (maintenance page)

---

## 9. The ranked fix list

If you do nothing else this week:

1. **`campaigns-content.tsx:825`** — direct mail `"Failed to send mail"` rewrite. (P0, money/legal, 5 minutes)
2. **`coverage-page.tsx:236`** — kill Sophie/Atlas leak in maintenance page. (P0, persona arch, 2 minutes)
3. **`campaigns-content.tsx:457`** — `"Failed to switch mode"` rewrite. (P0, 5 minutes)
4. **The five Title-Case "X Failed" titles** in §4.1. (P1, ~20 min)
5. **The nine bare `description: error.message` toasts** in §4.2. (P1, ~30 min)
6. **`error-utils.ts:27`** — `"An unexpected error occurred"` rewrite. (P1, in-spirit §11 violation, 2 min)
7. **Centralize validation messages** in `lib/validation-messages.ts`. (P1, prevents drift, 1h)
8. **Refactor `error-utils.ts` to status-code classification** instead of substring. (P2, brittle today, 2h)
9. **Retire `<InlineError>`** in favor of `<QueryErrorState compact>`. (P2, 1h)
10. **Wire `X-Request-Id` from `apiRequest` failures into `ErrorBoundary` debug strip.** (P2, traceability, 1h)

Total time to close every gap in this audit: **roughly one focused engineering day**. The system is closer to Stripe-Dashboard-grade than the founder thinks. The remaining gap is finishing what's already 90% done.

---

*Hiroko Watanabe · Wave 2 · 2026-05-01*
*"A product is judged by how it apologizes."*
