# Elite-Team Refinement — Resume Point

**Last session:** 2026-04-24 (session 30 — /leads 17b: LeadForm + LeadDetailDrawer + import CSV)
**Last completed refinement:** `LeadDetailDrawer` (hand-rolled
drawer P1 fix — role=dialog + aria-modal + aria-labelledby +
Esc + focus-return; silent assignment-error → destructive toast
with "still assigned to X" reassurance; Contact/Activity/TCPA
fact-pair rows → dl/dt/dd; email → mailto:, phone → tel:; 25+
aria-hidden icons; sentence-case sweep; tabular-nums on dates;
status badge capitalize; 44px touch on close/edit) + `LeadForm`
(sentence-case labels, required asterisks on firstName/lastName,
full mobile-keyboard checklist on email/phone/names,
autoComplete everywhere, 44px submit, grid-cols-1 sm:grid-cols-2)
+ Import CSV dialog (sentence-case, aria-hidden icons, dl/dt/dd
on stats grid, role=status on preview count, role=alert on
errors, role=region on preview table, tabular-nums, aria-label
on file input, 44px buttons) + ScoreBreakdownCard (sentence-case,
aria-hidden, role=status on loader, tabular-nums).
Zero new cross-cutting rules — pure horizontal application.

---

**Prior session:** 2026-04-24 (session 29 — /finance 12b.iii: Drawer body, closes 12b arc)
**Prior completed refinement:** `AcceptPaymentModal` (full
9-lens treatment, same as RecordPaymentModal in slice 27)
+ `NoteDetailDrawer` header row + 4 silent-error handlers.
AcceptPayment: slice-5l dialog semantics, form onSubmit,
Label htmlFor, $ prefix, required-asterisk, success banner
role=status, client-secret tabbable, input disabled post-
creation, sentence-case, usd() on money, 44px touch.
NoteDetailDrawer: **4 P1 silent-error fixes** (fetchDunningData,
regenerate schedule, send reminder, download PDF) —
previously all console.error-only; now destructive toasts
with state-change reassurance per slice-19 rule
("schedule is unchanged" / "no reminder was sent"). Send-
reminder also gains a success toast. Drawer itself now
role=dialog + aria-modal + aria-labelledby + Esc handler.
Header icon-button aria-labels name the borrower (prevents
mis-clicks in list view). 44px header touch. NoteDetailDrawer
body ~600 lines deferred to 12b.iii.

---

**Prior session:** 2026-04-24 (session 27 — /finance 12b.i: NoteForm + RecordPayment)
**Prior completed refinement:** `NoteForm` +
`RecordPaymentModal` in `/finance.tsx`. ~350 lines across
the two money-creation surfaces. NoteForm: currency-
adornment rule ($/% inside inputs), mobile-keyboard
checklist on all money inputs, required-asterisk on 6
fields, prerequisite-select 3-state on Borrower + Property
with specific empty-state copy ("No buyers yet — add a
buyer lead first"), calculated-payment banner role=status,
grid-cols-1 sm:grid-cols-2 on paired rows, sentence-case +
proper ellipsis. RecordPaymentModal: full slice-5l hand-
rolled-dialog treatment (role=dialog + aria-modal + Esc
handler), <form onSubmit> so Enter commits, Label htmlFor
on amount + method, $ prefix inside amount input, 3 money
rows promoted to <dl>/<dt>/<dd> and routed through usd()
with cents, submit-disabled when amount empty (prevents
$0 payment), sentence-case. Two of six /finance 12b
sub-components complete.

---

**Prior session:** 2026-04-24 (session 26 — settings 19b.v final)
**Prior completed refinement:** `ReferralSettings` +
`GoalsSettings` form/outer polish. **Closes the full
/settings 19b arc** — every sub-component in the 2658-line
file has now had at least one refinement pass. ReferralSettings
credits routed through `usd()`, stats promoted to `<dl>/<dt>/<dd>`,
load-error bare <p> replaced with role=alert banner + retry
button, referral-link Input gets Label htmlFor + select-on-
focus. GoalsSettings: GOAL_TYPE_LABELS sentence-cased
(surfaces in Select + existing goal cards), state-change
reassurance on create + delete ("no goal was created" /
"the goal still exists"), all 5 form fields get Label
htmlFor, required asterisks with aria-label, inputMode=
decimal on target, 7+ aria-hidden icons, 44px touch, proper
trailing periods. 13 decorative icons aria-hidden between
the two components.

---

**Prior session:** 2026-04-24 (session 25 — settings completion 19b.iv)
**Prior completed refinement:** `ApiKeyManager` +
`ActivityLogPanel` + `GoalsSettings` goal-progress row.
Closes out the bulk of /settings 19b work in one ~520-line
commit. Security-critical revoke path gets state-change
reassurance ("the key is still active" — critical since a
silent revoke failure leaves a leaked key live). New-key
banner promoted to role=alert + aria-live=assertive. Scope
select teaches permissions in the label itself ("Read —
view data only") — **new teach-via-option-label rule**.
Create form properly formed with Label htmlFor + Enter-
submit. Per-row Revoke aria-label names the specific key
(mis-click protection in a list). ActivityLog table gets
region landmark, loading state gets role=status. Goals
progress row: conditional `usd()` on revenue_earned vs.
count-based types, Progress aria-label describes goal + %
+ formatted values, en-dash on date range. 44px touch on
all delete/cancel/copy actions. Only ReferralSettings
remains in 19b — deferred as 19b.v.

---

**Prior session:** 2026-04-24 (session 24 — settings privacy 19b.iii)
**Prior completed refinement:** `PrivacyDataSettings` inside
`settings.tsx`. Third 19b sub-slice. State-change error
reassurance on export + delete mutations ("no data was
changed" / "your account is unchanged" — critical on an
irreversible delete). Warning alert role=alert, post-delete
status role=status + aria-live. Delete-confirm Input Label
properly wired via htmlFor + autoComplete=off +
autoCapitalize=characters + autoCorrect=off + spellCheck=
false so the verification phrase isn't auto-corrected. New
**placeholder disambiguation rule:** the delete-confirm
placeholder was "DELETE" — user could copy from
placeholder. Changed to "Type DELETE here" — discoverable
but requires actual typing. 6 GDPR rights promoted from
`<div>` grid to `<ul><li>` with container aria-label. 10+
decorative icons aria-hidden. Sentence-case sweep across 12
labels. Proper ellipsis. Contraction voice ("can't be
undone", "You'll be signed out in a few seconds"). 44px
touch on all 4 CTAs.

---

**Prior session:** 2026-04-24 (session 23 — settings billing 19b.ii)
**Prior completed refinement:** `StripeConnectSettings` +
`SeatManagement`. P1 trust fix: "Disconnect Stripe" gated
behind ConfirmDialog with specific description naming what
keeps working (pending payments still process) vs. what
stops (new collection). State-change reassurance on 4
Stripe/seat mutation error paths (connect/refresh/disconnect/
purchase). Definition-list semantics on both the Stripe
connection-status grid and the SeatManagement stats grid.
20+ decorative icons aria-hidden. Progress bar + Add-seats
button gain dynamic aria-label. role=status on requirements
banner. Sentence-case sweep, tabular-nums on account ID +
4 seat tiles + seat price, inputMode=numeric on seat
quantity, 44px touch.

---

**Prior session:** 2026-04-24 (session 22 — settings security sub-slice 19b.i)
**Prior completed refinement:** `TwoFactorAuthSettings` +
`PasswordChangeSettings` inside `client/src/pages/settings.tsx`.
P0 a11y + security fix: `window.prompt()` used for 2FA
disable code replaced with Radix Dialog + proper Input with
autoComplete="one-time-code", inputMode="numeric", full
mobile-keyboard checklist. **Extends the slice-5l
window.confirm ban to window.prompt.** Every 2FA mutation
error now names the current state (2FA is still on/off).
Password change wrapped in <form onSubmit>, autoComplete
values set on all 3 inputs so password managers work,
minLength={8}, aria-invalid + aria-describedby +
role=alert on mismatch. 2FA verify Input gets same mobile
keyboard treatment. QR alt text directive. Backup-codes
instruction names *why*. Sentence-case sweep, decorative
icons aria-hidden, tabular-nums on count/secret/backup
list, 44px touch, flex-col sm:flex-row on narrow rows.

---

**Prior session:** 2026-04-24 (session 21 — money-action reassurance grep)
**Prior completed refinement:** 6 money-action error paths
across `/finance` (3) and `/borrower-portal` (3) upgraded to
name current billing state on error per slice-19 rule.
Highest-anxiety path — `verifyPayment` after Stripe redirect
— now tells the user "If you were charged, your lender will
reconcile it within 24 hours — you don't need to pay again"
(prevents double-charge AND support load). handleMakePayment,
handleToggleAutopay, handleGeneratePaymentLink, handleCreate
Payment all carry "no card charged / setting hasn't changed"
voice. Two silent `console.error` trust bugs also removed.

---

**Prior session:** 2026-04-23 (session 20 — `/pipeline` full 9-lens)
**Prior completed refinement:** `client/src/pages/pipeline.tsx`
(307 lines) — full pass. Three hand-rolled compact $
formatters replaced with canonical `dollarsCompact()` helper
(slice 12). Sentence-case, 10+ decorative icons aria-hidden,
role=group + aria-label on velocity grid, role=status on
Suspense fallback, tabular-nums, useDocumentTitle.

---

**Prior session:** 2026-04-23 (session 19 — `/settings` targeted)
**Prior completed refinement:** `client/src/pages/settings.tsx`
(2658 lines) — targeted pass on General tab + tab list
labels + 4 top-level mutation error toasts. Error-voice
upgraded: "Error / Failed to X" → "Couldn't X" with recovery
guidance. handleUpgrade explicitly states "your plan wasn't
changed" — new money-action error reassurance rule. Sentence-
case sweep on General-tab labels + tab list (Refer & Earn,
AI Tasks). 18+ decorative icons aria-hidden across all 15
TabsTrigger icons + CardTitle icons + button glyphs. Limit-
warning banner promoted to role=status. Usage Progress bars
gain aria-label naming item, current, limit, percentage.
Subscription period range uses &ndash; + tabular-nums.
useDocumentTitle wired. ~2400 lines deferred to 19b (Team,
Payments, Communications, Notifications, AI, Data,
Integrations, Developer, Goals, Security, Privacy, Refer,
Automations, AI Tasks, Appearance tabs; StripeConnect,
SeatMgmt, 2FA, PasswordChange, Referral, Goals, ApiKey,
ActivityLog, PrivacyData components).

---

**Prior session:** 2026-04-23 (session 18 — `/onboarding-v2` targeted)
**Prior completed refinement:** `client/src/pages/onboarding-v2.tsx`
(1469 lines) — targeted pass: sentence-case sweep on all 18
STEPS_BY_PATH step titles + subtitles, money-precision on
opportunity tiles, useDocumentTitle.

---

**Prior session:** 2026-04-23 (session 17 — `/leads` targeted)
**Prior completed refinement:** `client/src/pages/leads.tsx`
(2572 lines) — targeted trust + a11y pass. THREE silent-
failure bugs fixed: handleExport silently swallowed errors →
destructive toast; handleFileSelect silently hid CSV preview
errors → destructive toast; bulk-update toast voice upgraded.
CSV-injection defense applied to handleBulkExport per slice-5k
rule (double embedded quotes, prefix formula-triggers with
`'`). window.confirm replaced with ConfirmDialog for dirty-
form discard (slice-5l ban). Sentence-case sweep on stage
filter items (desktop + mobile × 5 stages = 12 replacements),
tier distribution labels (A/B/C/D tier), "Add New Lead" →
"Add lead", import-tax-list. Lead-quality distribution bar
now role=img with aria-label summarizing 4 tier counts.
useDocumentTitle wired. Remaining ~2000 lines (LeadForm,
LeadStatusBadge, LeadDetailDrawer, table rows, bulk-delete
dialog, import preview, tax-delinquent importer) deferred
to slice 17b.

---

**Prior session:** 2026-04-23 (session 16 — `/dashboard`)
**Prior completed refinement:** `client/src/pages/dashboard.tsx`
(734 lines) — the alternate dashboard entry surface. Full
horizontal application of the cross-cutting rules stack.
useDocumentTitle wired. Monthly cashflow + Pipeline value
StatCards routed through usd() (was bare .toLocaleString()
dropping cents). Loading "-" → "—" on 3 stat cards.
Sentence-case sweep across ~15 section headers / stat-card
titles / CTAs. 12+ decorative icons aria-hidden. Funnel
stage progress bars got role=progressbar + aria-label + aria-
valuenow/min/max. Tip banners stack flex-col sm:flex-row for
320px with 44px touch on CTAs. Aging-lead score separator
promoted from hyphen to em-dash. Tabular-nums sweep on all
counts/%. No new cross-cutting rules.

---

**Prior session:** 2026-04-23 (session 15 — `/today`)
**Prior completed refinement:** `client/src/pages/today.tsx`
(1324 lines) — the primary authenticated entry surface.
Sentence-case sweep across 20+ section headers + CTAs (alert
link labels, welcome-back stat tiles, getting-started hero
CTAs, agent-activity labels, business-pulse labels, every
section heading, stat cards). 30+ decorative icons aria-
hidden. goal-progress revenue + cash-position projected
tiles + next3 payments all routed through usd(). Business
Pulse Pipeline + This Month replaced hand-rolled compact
format with dollarsCompact() helper. Expiring-offer cards
got role=alert; system alerts role=alert/status by severity.
Progress bars on goal cards aria-labeled. Mobile: banner
stacking flex-col sm:flex-row, 44px touch on all CTAs.
Tabular-nums sweep on every number. Severity/priority
badges capitalize.

---

**Prior session:** 2026-04-23 (session 14 — money sweep: /properties + /deals + /campaigns)
**Prior completed refinement:** targeted `usd()` swap across
three files. /properties (3246 lines): 9 money sites
routed through usd(). /deals (1700+ lines): 10 money sites.
/campaigns-content: budget spent/total line. NOT full 9-lens
passes of any page — surgical money-precision + small
adjacent cleanup.

---

**Prior session:** 2026-04-23 (session 13 — SignatureCapture 9b)
**Prior completed refinement:** `client/src/components/signature-capture.tsx`
(372 lines). Canvas gets role=img + state-aware aria-label
(announces keyboard alternative on empty state). "Sign here"
pseudo-placeholder aria-hidden. Typed-signature preview
role=img + aria-label. 4 decorative icons aria-hidden.
Apply/Clear buttons min-h-11 (Clear sm:min-h-9 for desktop).
Canvas height grows h-32 sm:h-40. Full autocomplete /
autoCapitalize / autoCorrect / spellCheck on both name
inputs. Sentence-case sweep. CardDescription rewritten to
explicitly name the keyboard path.

---

**Prior session:** 2026-04-23 (session 12 — money-precision rule + /finance)
**Prior completed refinement:** `client/src/lib/format.ts` +
`client/src/pages/finance.tsx`. `usd()` helper added;
applied across all 16 bare `.toLocaleString()` money renders
in /finance.

---

**Prior session:** 2026-04-23 (session 11 — public-form a11y grep sweep)
**Prior completed refinement:** `/auth` + `/forgot-password`
+ `/reset-password` + `/beta-intake` — one commit applying
the slice-10 public-form a11y checklist horizontally. All 5
beta-intake Labels gained `htmlFor` + Input `id` (previously
bare — SR users heard no label names on focus). Both
beta-intake forms wrapped in `<form onSubmit>` so Enter
submits. Mobile-keyboard checklist across all 3 email fields
(main/check/referral). `autoComplete` set on given-name/
family-name/email/organization. `autoCapitalize="characters"`
on referral code. Feature highlights `<div>`s promoted to
`<ul><li>`. 7 decorative beta-intake icons got aria-hidden.
useDocumentTitle wired on /beta-intake, /forgot-password,
/reset-password. sr-only `<h1>` on /auth (mode-swaps between
"Sign in to X" / "Create a X account"); brand span + logo
tile aria-hidden to avoid double-announcement. /auth loaders
all wrapped role=status + aria-live. aria-invalid + aria-
describedby wiring on all 4 files. role=alert on missing-
token reset error. Error-message specificity across all four
(password-mismatch warmer, min-length second-person, expired-
link names cause + recovery, network-error names recovery).
Sentence-case sweep across /beta-intake. 44px min-h-11 touch
on all primary CTAs. No new cross-cutting rules — checklist
confirmation only.

---

**Prior session:** 2026-04-23 (session 10b — `<BorrowerDashboard>` full pass)
**Prior completed refinement:** `client/src/pages/borrower-portal.tsx`
lines 188-end — the ~1000-line authenticated borrower dashboard.
Two P0 money-surface trust bugs fixed:
(1) **silent messaging failures**: `loadMessages` + `handle
SendMessage` used `// silently ignore` on error. User sends a
loan question to their lender, composer clears, server never
received it. Now both surface inline `role=alert` + retry
button; composer input preserved on send-error;
(2) **money precision cents loss**: bare `.toLocaleString()`
drops cents on integer values — a borrower paying the
displayed Total payoff amount could be short on their loan.
All rendered $ amounts (payment-due, stat cards, loan details,
payment history columns, payoff breakdown + total) now
explicit `{ minimumFractionDigits: 2, maximumFractionDigits:
2 }`.

Also: role=alert/role=status wired across payment banners
(assertive on errors). Autopay Switch got accessible name.
Progress bar got descriptive aria-label. Scrollable tables
are tabbable region landmarks. Message thread is role=log +
aria-live=polite with SR-only "Sent —" / "Received —" bubble
prefixes (slice 7 pattern). Mobile bottom bar → `<nav>`
landmark. 20+ decorative icons aria-hidden. Loan-details +
Property-info + Payoff-breakdown promoted from flex `<span>`
pairs to `<dl>`/`<dt>`/`<dd>`. Unread-count badges:
min-w-[16px] px-1 so two-digit counts don't clip; parent
buttons got "(N unread)" aria-label; badges aria-hidden.
Sentence-case sweep (AcreOS Portal → portal, Pay Now/Early →
Pay now/early, Loan Progress/Details, Payment History/
Schedule, Payoff Quote/Fee, all stat labels and dialog
titles). Proper ellipsis + em-dash. "Form 1098 (mortgage
interest — tax)" IRS-form-faithful menu label. Cancelled-
payment says "no charge was made" to reassure borrowers
backing out of Stripe checkout. N/A → —. Mobile-nav touch
min-h-14; quick-action min-h-16. Tabular-nums sweep.

Deferred: jsPDF statement/1098 generator (product +
compliance question), Stripe-success reload hack (needs
react-query refactor), payoff-dialog flash-on-error (minor
polish), tab-click DOM hack (needs Radix Tabs controlled
state).

---

**Prior session:** 2026-04-23 (session 10 — `/portal/:accessToken` entry)
**Prior completed refinement:** `client/src/pages/borrower-portal.tsx`
(lines 35-186 — `BorrowerPortal` verification gate +
`BorrowerLandingPage` + the intermediate loading interstitial).
Public no-auth surface, mobile-critical. Form a11y overhauled:
Label htmlFor + Input id, aria-invalid + aria-describedby
wired to a role=alert error region, form onSubmit for
Enter-to-submit, client-side trim + has-@ pre-check, full
mobile-keyboard checklist (autoComplete/inputMode/auto
Capitalize/autoCorrect/spellCheck). Decorative-icon aria-hidden
across 6 lucide icons. sr-only h1 landmarks added on both the
landing and verify gate (CardTitle is a `<div>`). Loading
interstitial became role=status + aria-live=polite + Loader2
spinner. Landing-page feature rows promoted to `<ul><li>` with
`shrink-0` icon tiles for 320px. useDocumentTitle wired on
both paths. 44px touch target on primary CTA. Copy: sentence-
case sweep, proper ellipsis, em-dash on landing CTA, warmer
error voice ("We couldn't match that email to this loan —
check the address from your payment reminder email"), specific
security claim ("encrypted in transit and at rest"), RFC-2606
placeholder ("you@example.com"), description rewrite names
"the email your lender has on file." JSON-parse guard on
error-branch. The ~1000-line `<BorrowerDashboard>` component
(payments, autopay, payoff quote, 1098/statements, messaging)
deferred to slice 10b as a separate focused pass.

---

**Prior session:** 2026-04-23 (session 9 — `/sign/:docId`)
**Prior completed refinement:** `client/src/pages/sign-document.tsx`
— full 9-lens pass on the public HMAC-token signer page. P0
bug squashed: `error` was a single state used for both load
failures and submit failures, so a failed POST tore down
`<SignatureCapture>` and wiped the signature the user just
drew — catastrophic on a legal surface. Split into `loadError`
vs `submitError`; submit errors now render as an inline
`role="alert"` above the pad, preserving all user input.
Focus moves to confirmation card on success (`ref.focus()` +
`tabIndex=-1` + `role="status"` + `aria-live="polite"`) so SR
users hear completion. Load-error card gains `role="alert"`
AND a "Try again" button so transient 5xx don't require an
email round-trip to the sender. `AbortController` replaces the
`cancelled` flag. Decorative-icon aria-hidden sweep (6 lucide
icons). Skeleton gets sr-only "Loading document…" label. Nav
`aria-label="Signing header"`. Document-content scroll div
gets `tabIndex=0` + `role="region"` + `aria-label`. Document
title sentence-cased. `CardTitle` "Document" → "Document to
sign". Audit-trail legal fine print promoted from
`text-[11px]` to `text-xs` + `leading-relaxed` (12px minimum
legibility floor for legal disclosures). Mobile padding
tuned (`px-4 sm:px-6 py-8 sm:py-10`). Tabular-nums on signer
counts + expiry date. The `<SignatureCapture>` internal
component (372 lines of canvas/typed/consent logic) deferred
to a dedicated 9b slice.

**Phase 1 inventory:** ✅ committed at `11d0e8c`
**PropertyDetailDialog:** ✅ fully refined across all tabs.
**/deals kanban:** ✅ slice 5j complete (commit `f001623`).
**/deals list + filters:** ✅ slice 5k complete (commit `d157464`).
**/deals DealDetailDrawer (5 tabs):** ✅ slice 5l complete (`cc375b1`).
**/deals DealForm (create modal):** ✅ slice 5m complete (`0707ee4`).
**/campaigns list + create:** ✅ slice 6a complete (`ea096ec`).
**/campaigns detail drawer + OptimizerSuggestions + SendMailDialog:** ✅ slice 6b complete (`cf10579`).
**/campaigns A/B test manager + variants panel + analytics:** ⬜ slice 6c deferred — separate embedded components, not blocking /inbox walk
**/inbox:** ✅ slice 7 complete (commit `e052cf8`)
**/documents:** ✅ slice 8 complete (commit `234dafa`)
**/sign/:docId:** ✅ slice 9 complete (commit `61f1469`)
**SignatureCapture component (9b):** ⬜ deferred — 372-line canvas/typed/consent component, own slice
**/portal/:accessToken entry (gate + landing):** ✅ slice 10 complete (commit `c6438ba`)
**BorrowerDashboard (10b):** ✅ slice 10b complete (commit `cf01654`)
**jsPDF statement/1098 generator (10b.ii):** ⬜ deferred — product+compliance question on IRS Form 1098 fidelity; own slice
**Public-form a11y grep sweep (11):** ✅ complete across /auth + /forgot-password + /reset-password + /beta-intake (commit `37b8911`)
**Money-precision: usd() helper + /finance (12):** ✅ complete (commit `39227e7`)
**SignatureCapture (9b):** ✅ complete (commit `252026c`)
**Money sweep: /properties + /deals + /campaigns-content (14):** ✅ complete (commit `0ffdbde`)
**/today (15):** ✅ complete (commit `fb24811`)
**/dashboard (16):** ✅ complete (commit `a73dfee`)
**/leads targeted (17):** ✅ complete (commit `3fb7dcb`)
**/leads 17b (30):** ✅ complete — LeadForm + LeadDetailDrawer + import CSV + ScoreBreakdown (commit `aa6ff78`)
**/leads remaining (SafeBulkDeleteDialog + TaxDelinquentImporter shared components):** ⬜ deferred — separate component files, not in leads.tsx scope
**/onboarding-v2 targeted (18):** ✅ complete (commit `70df779`) — 18b deferred
**/settings targeted (19):** ✅ complete (commit `809044c`) — 19b remaining components deferred
**/pipeline (20):** ✅ complete (commit `1b5d0f7`)
**Money-action reassurance grep (21):** ✅ complete across /finance + /borrower-portal (commit `8b5ad36`)
**/settings security sub-slice 19b.i (22):** ✅ complete — 2FA + password change (commit `04b54f0`)
**/settings billing sub-slice 19b.ii (23):** ✅ complete — StripeConnect + SeatManagement (commit `74e62ec`)
**/settings privacy sub-slice 19b.iii (24):** ✅ complete — PrivacyDataSettings / GDPR (commit `a90fa77`)
**/settings completion 19b.iv (25):** ✅ complete — ApiKeyManager + ActivityLog + Goals progress (commit `890f5bc`)
**/settings 19b.v final (26):** ✅ complete — ReferralSettings + Goals form (commit `ac1a64b`)
**/settings FULL 9-lens arc (19 → 19b.v):** ✅ complete — every sub-component refined
**/finance 12b.i (27):** ✅ complete — NoteForm + RecordPaymentModal (commit `694ba02`)
**/finance 12b.ii (28):** ✅ complete — AcceptPaymentModal + NoteDetailDrawer header (commit `5059dfc`)
**/finance 12b.iii (29):** ✅ complete — NoteDetailDrawer body, closes 12b arc (commit `43fb11c`)
**/finance FULL arc:** ✅ complete across slices 12 + 27 + 28 + 29
**/leads 17b (30):** ✅ complete — LeadForm + LeadDetailDrawer + import CSV + ScoreBreakdown (commit `aa6ff78`)
**window.confirm ban grep:** ✅ clean across the client
**window.prompt ban:** ✅ clean after slice 22
**Money-precision grep remaining (~63 files):** ⬜ deferred — apply per-surface as each page gets 9-lens pass

## How to continue

Paste the original Elite-Team prompt into a fresh Claude Code session.
The next session will:

1. Read `docs/refinement/surface-inventory.md`
2. Read `docs/refinement/progress.md` (newest entries at bottom)
3. Read this file for the next surface
4. Continue the walk

## Progress summary

### Surfaces refined to date (all 9 specialists sign-off)

Session 1:
- `/` landing
- `/not-found`
- `/auth` (widget colorPrimary)

Session 2:
- `/auth` (backdrop + a11y)
- `/onboarding-v2`
- `PageLoader` (cross-cutting)
- `ThemeSettings` (cross-cutting)
- `QueryErrorState` (cross-cutting)
- `EmptyState` (cross-cutting)

Session 3:
- `/leads` (mobile checkbox tap targets)
- `/properties` + `/finance` (responsive grid pass — partial,
  grid only)
- `/settings` (tier badges)
- `/forgot-password` + `/reset-password`
- `/pipeline`, `/tools`, `/goals` (violet sweep)

Session 4:
- `/leads/dedupe` — confirm-before-merge + a11y radiogroup + error
  state conformance + mobile action-row stack + source badge
  promotion + token-based visuals

Session 5 (thirteen slices — /properties and /deals):
- 5a–5i. `/properties` (list, card/form, detail dialog all tabs,
  research summary, comps, AI offer, chat, intelligence,
  cross-cutting status.replace sweep)
- 5j. `/deals` kanban slice (commit `f001623`)
- 5k. `/deals` list + bulk-actions slice (commit `d157464`)
- 5l. `/deals` DealDetailDrawer slice (commit `cc375b1`)
- 5m. `/deals` DealForm create modal (commit `0707ee4`)

Session 6:
- 6a. `/campaigns` list + create modal (commit `ea096ec`)
- 6b. `/campaigns` CampaignDetailDrawer + SendMailDialog +
  OptimizerSuggestionsPanel (commit `cf10579`)

Session 7:
- `/inbox` full-surface (commit `e052cf8`)

Session 8:
- `/documents` — all 3 tabs + 6 dialogs (commit `234dafa`).

Session 9:
- `/sign/:docId` — public HMAC-token signer flow. Submit-error-
  must-not-unmount-form P0 fix, focus-on-success-confirmation
  (SR-announced), load-error retry affordance, AbortController
  cleanup, role=alert on errors, role=region on document
  content, role=status on confirmation, decorative-icon sweep,
  legal-fine-print 12px minimum size, sentence-case title +
  specific CardTitle. (commit `61f1469`)

Session 10:
- `/portal/:accessToken` entry (lines 35-186) — public no-auth
  borrower verification gate + no-token landing + loading
  interstitial. Public-form a11y checklist introduced and
  shipped. Trust-copy specificity. Borrower-voice error
  fallbacks. (commit `c6438ba`)

Session 10b:
- `<BorrowerDashboard>` (lines 188-end of borrower-portal.tsx)
  — the full authenticated borrower experience. Two P0 money-
  surface fixes: silent messaging failures + bare
  .toLocaleString() cent-dropping. role=alert/status on
  payment banners, Autopay Switch accessible name, Progress
  bar labeled, tables become tabbable regions, message thread
  role=log + aria-live + SR direction prefix, mobile bottom
  bar → nav landmark, 20+ aria-hidden icons, fact-pair rows
  → `<dl>`/`<dt>`/`<dd>`, unread badges handle two-digit
  counts without clipping, sentence-case sweep, proper
  ellipsis + em-dash, Form-1098 faithful menu label,
  cancelled-payment reassurance. jsPDF generator deferred.
  (commit `cf01654`)

Session 11:
- Public-form a11y grep sweep — one atomic commit applying
  the slice-10 checklist across /auth + /forgot-password +
  /reset-password + /beta-intake. 5 beta-intake Labels
  gained htmlFor + id, both beta-intake forms wrapped in
  <form onSubmit>, mobile-keyboard checklist + autoComplete
  across 3 email fields, feature highlights → <ul><li>, 7
  aria-hidden icons, useDocumentTitle on 3 pages, sr-only h1
  on /auth, role=status/aria-live on loaders, aria-invalid +
  aria-describedby on all forms, role=alert on missing-token
  reset error, warmer error fallbacks, sentence-case sweep,
  44px CTAs. No new cross-cutting rules — checklist-
  confirmation only. (commit `37b8911`)

Session 12:
- `usd()` money formatter added to client/src/lib/format.ts;
  applied across all 16 bare .toLocaleString() money renders
  in /finance.tsx. (commit `39227e7`)

Session 13:
- `SignatureCapture` component (slice 9b, 372 lines) —
  canvas role=img + state-aware aria-label announcing the
  keyboard alternative, "Sign here" overlay aria-hidden,
  typed preview role=img, 4 icons aria-hidden, 44px min
  touch on Apply/Clear, canvas grows h-32 sm:h-40, full
  autocomplete polish on both inputs, sentence-case sweep,
  description explicitly names the keyboard path.
  (commit `252026c`)

Session 14:
- Money-precision sweep continuation — targeted `usd()` swap
  across /properties (9 sites), /deals (10 sites),
  /campaigns-content (1 site). (commit `0ffdbde`)

Session 15:
- `/today` full 9-lens pass — primary authenticated entry.
  20+ sentence-case sweeps, 30+ aria-hidden icons, goal/
  cash money-precision with usd() + dollarsCompact(),
  role=alert on expiring offers, aria-label on progress
  bars, mobile banner stacking, full tabular-nums sweep.
  useDocumentTitle wired. (commit `fb24811`)

Session 16:
- `/dashboard` 9-lens pass — alternate entry surface. usd()
  on Monthly cashflow + Pipeline value stat cards, 15+
  sentence-case sweeps, 12+ aria-hidden icons, funnel
  progress bars role=progressbar + aria-label/valuenow,
  mobile tip-banner stacking, em-dash on aging-lead score
  separator, tabular-nums. useDocumentTitle wired.
  (commit `a73dfee`)

Session 17:
- `/leads` targeted pass — 2572-line file, surgical. Three
  silent-failure P1 fixes (export / preview / bulk-update),
  CSV-injection defense on handleBulkExport (slice-5k),
  window.confirm → ConfirmDialog for dirty-form discard,
  sentence-case sweep on stage filter (12 replacements) +
  tier distribution labels, role=img + aria-label on
  quality distribution bar, useDocumentTitle. ~2000 lines
  deferred to 17b. (commit `3fb7dcb`)

Session 18:
- `/onboarding-v2` targeted pass — 1469-line file. Sentence-
  case on all 18 STEPS_BY_PATH step titles + subtitles across
  3 paths. usd() applied to 3 opportunity-tile money sites
  (aha-moment trust-critical). Tile labels sentence-case,
  proper ellipsis, CTA min-h-11, tabular-nums,
  useDocumentTitle. ~1100 lines deferred to 18b.
  (commit `70df779`)

Session 19:
- `/settings` targeted — 2658-line file. 4 mutation error
  toasts upgraded to "Couldn't X" voice with recovery
  guidance; handleUpgrade explicitly states "your plan
  wasn't changed" (money-action reassurance). Sentence-case
  on General-tab labels + 2 tab-list labels. 18+ decorative
  icons aria-hidden. role=status + aria-live on limit
  warning. Progress bars aria-labeled. &ndash; + tabular-
  nums on subscription period. useDocumentTitle.
  (commit `809044c`)

Session 20:
- `/pipeline` — 307-line file, full pass. 3 hand-rolled
  compact $ formatters replaced with dollarsCompact()
  helper. Sentence-case + spaced slash on velocity labels.
  10+ aria-hidden icons. role=group on velocity metrics,
  role=status on Suspense fallback. Tabular-nums sweep.
  useDocumentTitle. (commit `1b5d0f7`)

Session 21:
- Money-action reassurance grep sweep — 6 error paths
  across /finance + /borrower-portal upgraded per slice-19
  rule. Highest-anxiety path (post-Stripe verifyPayment)
  carries "if charged, lender reconciles within 24 hours —
  don't pay again" reassurance. Prevents double-charge
  AND support load. (commit `8b5ad36`)

Session 22:
- /settings 19b.i — TwoFactorAuthSettings + Password
  ChangeSettings. P0 fix: window.prompt for 2FA disable
  replaced with accessible Radix Dialog. Extends slice-5l
  ban to window.prompt. Security-action reassurance voice
  ("2FA is still on/off"). Password change gets form
  onSubmit + autoComplete + minLength + aria-invalid + role
  =alert. 2FA verify Input gains one-time-code autoComplete.
  Directive QR alt text. Sentence-case sweep. (commit
  `04b54f0`)

Session 23:
- /settings 19b.ii — StripeConnectSettings + SeatManagement.
  P1 fix: Disconnect Stripe gated behind ConfirmDialog with
  specific scope description. State-change reassurance on 4
  Stripe/seat mutations. dl/dt/dd on Stripe + seat fact
  grids. 20+ aria-hidden icons. Progress + Add-seats
  dynamic aria-labels. Sentence-case. 44px touch. Tabular-
  nums. (commit `74e62ec`)

Session 25:
- /settings 19b.iv — ApiKeyManager (trust-critical, ~300
  lines of work) + ActivityLogPanel (~80 lines) + Goals
  progress row (~40 lines). Security: revoke state-change
  reassurance ("the key is still active" — silent revoke
  failure would leave a leaked key active). New-key banner
  role=alert + aria-live=assertive. Scope Select now
  teaches permissions inline ("Read — view data only").
  Create form onSubmit + Label htmlFor. Per-row revoke
  aria-labels name the key (mis-click protection).
  Revenue goals use usd(), count goals use plain
  toLocaleString. Progress aria-label names goal+%+values.
  Teach-via-option-label rule introduced. (commit
  `890f5bc`)

Session 27:
- /finance 12b.i — NoteForm + RecordPaymentModal (two
  money-creation surfaces). Currency-adornment rule on
  principal/down-payment ($) + interest (%). Mobile-
  keyboard checklist on all money inputs. Required-
  asterisk on 6 fields. Prerequisite-select 3-state with
  specific empty-state copy. NoteForm calculated-payment
  banner role=status. RecordPaymentModal: full slice-5l
  dialog treatment (role=dialog + aria-modal + Esc), form
  onSubmit, Label htmlFor, money rows through usd() +
  dl/dt/dd semantics, submit guards against $0 payment.
  Sentence-case + proper ellipsis. (commit `694ba02`)

Session 28:
- /finance 12b.ii — AcceptPaymentModal (full 9-lens,
  same pattern as slice-27 RecordPaymentModal) +
  NoteDetailDrawer header + 4 silent-error handlers.
  AcceptPayment: slice-5l dialog, form onSubmit, Label
  htmlFor, $ prefix, role=status success banner, client
  secret tabbable, fields disabled post-creation. Drawer:
  4 P1 silent-console.error bugs fixed with state-change
  reassurance ("schedule is unchanged" / "no reminder was
  sent"), send-reminder gains success toast, drawer
  role=dialog + Esc handler, header aria-labels name the
  borrower. (commit `5059dfc`)

Session 26:
- /settings 19b.v final — ReferralSettings + GoalsSettings
  form. Closes out the full /settings 19b arc. Referral:
  credit values through usd(), stats dl/dt/dd, load-error
  role=alert + RefreshCw retry, referral Input Label +
  select-on-focus, 8 aria-hidden icons. Goals:
  GOAL_TYPE_LABELS sentence-cased, state-change
  reassurance on both mutations, all 5 form Label htmlFor
  wired, required asterisks, inputMode=decimal, 7+ aria-
  hidden icons, 44px touch. Every sub-component of the
  2658-line settings file has now had a refinement pass.
  (commit `ac1a64b`)

Session 24:
- /settings 19b.iii — PrivacyDataSettings (GDPR surface).
  State-change reassurance on export + delete ("account is
  unchanged"). role=alert on can't-be-undone warning,
  role=status on post-delete confirmation. Delete-confirm
  Input Label htmlFor wired + autoComplete=off +
  autoCapitalize=characters. New **placeholder
  disambiguation rule** (placeholder="DELETE" → "Type
  DELETE here"). 6 GDPR rights promoted to <ul><li>. 10+
  aria-hidden icons. Sentence-case sweep. Contraction
  voice. Proper ellipsis. 44px touch. (commit `a90fa77`)

## Cross-cutting gains this pass

- **Single error-path pattern on list pages:** `QueryErrorState`
  remains the one surface for list fetch failures. /campaigns + /documents now conform.
- **View toggle pattern:** grouped buttons, 44px mobile, 36px
  desktop, `role="group"`, `aria-pressed`, lucide icons.
- **Silent-fetch → toast pattern:** any client `fetch`/`FormData`
  handler that catches to `console.error` should surface a
  destructive toast with specific recovery copy.
- **Silent-mutation → toast pattern (extended 5c):** mutations whose
  result UI *replaces* the trigger (e.g. Pursue/Pass buttons →
  decision badge) MUST surface both success and error toasts.
- **Silent-mutation → toast pattern (extended 5j):** drag-to-reorder
  or drag-to-change-state mutations must surface both outcomes —
  a react-query cache invalidate is not visible feedback, and on
  failure the card silently snaps back with no explanation.
- **Cross-cutting bug sweep trigger (5e):** when a refinement hits
  the *same* code-level bug in a fourth component, stop patching
  it locally; grep the client tree and fix everywhere in one sweep.
- **Silent-query → toast pattern (5c):** background query with
  `staleTime: 0` that silently fails while showing cached data is a
  trust bug. Wire `isError` → toast via `useEffect`.
- **Silent-query → toast pattern (extended 5l):** a `queryFn` that
  returns `[]` on `!response.ok` is also a trust bug — the user
  sees an empty state indistinguishable from "genuinely empty."
  Throw on !ok and surface via `isError` → toast.
- **Silent-query → toast pattern (extended 8, trust-surface amplifier):**
  on a legal/trust surface (documents, contracts, signatures,
  payments), silent-empty-on-!ok is doubly bad — the user may
  sign a deal assuming "no templates yet" when the service is
  actually down. When the surface is trust-critical, the pattern
  upgrades from "should fix" to "must fix at surface audit time."
- **Filter-reset empty state:** reset the full filter set when a
  filter empties the list.
- **Form mobile-keyboard checklist:** APN → `inputMode="numeric"`;
  acreage → `inputMode="decimal"`; state codes → `maxLength=2` +
  `autoCapitalize="characters"` + `autoComplete="address-level1"`;
  money → `type="number"` + `inputMode="decimal"` + `min=0`.
- **Decorative-icon aria-hidden sweep:** any icon next to a text
  label is decorative.
- **Collapsible proper-aria pattern:** `aria-expanded` +
  `aria-controls` + lucide chevron.
- **Tooltip-must-augment rule (5c):** delete tooltips that restate
  the visible label.
- **Spinner-copy-vs-first-load rule (5c):** "Loading latest X…"
  reads correctly for initial load AND background refetch.
- **Icon-only tab labels (5j):** the pattern
  `<span className="hidden sm:inline">Label</span>` hides the
  label entirely from SR on mobile (display:none removes from
  a11y tree). Convert to `sr-only sm:not-sr-only sm:inline`.
- **Draggable a11y (5j):** `useDraggable` + PointerSensor alone
  ships a mouse-only UX. Always add `KeyboardSensor` to the
  sensors list AND wire `accessibility.announcements` /
  `screenReaderInstructions` on DndContext. Draggable handle
  should be a real `<button>`, not an svg with listeners spread.
- **Droppable column semantics (5j):** droppable containers
  need aria-label that names the target state, not just the
  column heading.
- **CSV export escape rule (5k):** double embedded quotes AND
  neutralize formula-trigger leading characters (`=`, `+`, `-`,
  `@`, `\t`, `\r`) with a `'` prefix. Factor `escapeCell` out if
  a third surface needs CSV.
- **Bulk-mutation triple-path rule (5k):** handle `success=true`,
  `success=false` (soft-fail), and `onError` — independently. Any
  bulk mutation that toasts only on one path leaves silent-failure
  holes on the other two.
- **Dead-stub rule (new 5l):** a button with no `onClick` and no
  `type="submit"` is a broken UI promise, not a visual
  placeholder. Wire it in the same commit or remove it — never
  ship a "future feature" button.
- **Money-unset display rule (new 5l):** `$0` rendered from a
  nullable amount reads as "this deal is worth nothing." Render
  "—" (muted) when the value is `null`/`undefined`/`""`; reserve
  `$0.00` for deals where zero is the captured amount.
- **Radix DialogDescription rule (new 5l):** subtitle paragraphs
  inside `DialogHeader` should be `<DialogDescription>` so Radix
  wires `aria-describedby`. Raw `<p>` loses that binding.
- **Dialog Esc key rule (new 5l):** a hand-rolled drawer/overlay
  without Radix Dialog/Sheet backing must ship at minimum:
  `role="dialog"`, `aria-modal="true"`, `aria-labelledby={titleId}`,
  and a `useEffect` that listens for `Escape`. Better: convert to
  Radix Sheet/Dialog.
- **Checklist-checkbox role rule (new 5l):** toggle buttons that
  semantically check/uncheck a list item should be
  `role="checkbox"` + `aria-checked={bool}` + named
  `aria-label`. Not a bare `<button>` with an icon.
- **Window.confirm ban (new 5l):** native `confirm()` is
  inaccessible (no focus trap with surrounding Radix UI, no
  aria wiring, inconsistent styling, blocks main thread). Always
  use `ConfirmDialog` — it's already in the tree.
- **Prerequisite-select three-state rule (new 5m, extended 8):**
  when a creation form depends on a prerequisite entity (deal →
  property, package → deal, etc.), the dependent `Select` must
  distinguish three states: **loading**, **empty** (explicit
  next-action message), **populated** — AND a fourth
  **unavailable** state when the underlying query is `isError`
  ("Deals unavailable" / "Properties unavailable"). A silently
  empty dropdown is indistinguishable from a failed query or a
  racing query.
- **Controlled-date-input rule (new 5m, extended 6a):** `<Input
  type="date">` must bind both `value` AND `onChange`. Bind:
  `value={date instanceof Date && !isNaN(date.getTime()) ? format(
  date,'yyyy-MM-dd') : ''}`. Change: `onChange={(e) =>
  field.onChange(e.target.value ? new Date(e.target.value) :
  undefined)}`.
- **Currency-adornment rule (new 5m, extended 6a):** `$` should be
  a visual prefix inside the input, not suffixed on the label.
- **Competitor-brand hygiene (new 6a):** when a user-facing label
  or help text names an external educational product or
  competitor brand (Land Academy, Land Geek, etc.), replace with
  a generic industry term.
- **Fabricated-price rule (new 6a):** any user-facing price range
  that isn't sourced from a live object is a trust bug.
- **Template/option-card radiogroup pattern (new 6a):** mutually-
  exclusive selection cards built as clickable `<div>`s must
  become `<button type="button" role="radio" aria-checked>` inside
  `role="radiogroup"` with `aria-labelledby={groupLabelId}`.
- **Clickable-div row rule (new 7):** any `<div onClick>` used as a
  selectable list row must also ship `role="button"`, `tabIndex={0}`,
  a keyboard handler for Enter/Space, `aria-label` that describes
  the row's content, `aria-current` for selection state, and a
  `focus-visible:ring` with `outline-none`. Extended 8: applies
  to `<Card onClick>` patterns used as clickable rows too
  (package cards in /documents).
- **Unread/count badge duplicate sweep (new 7):** when a stat is
  shown in a page header AND inside a filter tab, only show it in
  the place where the user can act on it.
- **`mailto:` / `tel:` affordance rule (new 7):** any rendered
  email address or phone number in a customer-facing surface
  should be a `mailto:` or `tel:` anchor on mobile.
- **SR-only direction prefix on chat bubbles (new 7):** color-
  coded bubble direction is visual-only; prefix timestamps with
  SR-only "Sent "/"Received ".
- **`role="log"` + `aria-live="polite"` on chat message lists
  (new 7):** new inbound messages should announce to SR users.
- **Silent-query→toast extended to sub-detail queries (new 7):**
  pattern applies to *any* query whose failure shows an empty
  view indistinguishable from "genuinely empty."
- **Humanized-type capitalization rule (new 8):** when rendering
  a snake_case `type` field as a badge (e.g. `quit_claim_deed`),
  use a `humanizeType()` helper that capitalizes the first
  letter of the humanized form. Raw `.replace(/_/g, " ")`
  produces lowercase badges that look broken next to Title-Case
  neighbors. Applies wherever `type.replace(/_/g, " ")` appears
  in rendered output — grep candidate across `/deals`, `/properties`,
  and any package/template/classification surface.
- **Restore-older-state ConfirmDialog rule (new 8):** any "restore
  previous version" / "revert" / "undo from trash" action that
  overwrites current state with older state must be gated by
  `ConfirmDialog`. The description must explicitly note whether
  current state is preserved in history or lost, so users
  understand reversibility. Unlike delete, this is not about
  preventing data loss — it's about communicating the swap.
- **Submit-error-must-not-unmount-form rule (new 9):** when a
  submission fails on a surface where the user has committed
  input they can't easily redo (signature, long-form copy,
  drawn content, multi-step wizard state), error MUST render
  inline above the form as `role="alert"`, not replace the
  form. A single shared `error` state for load + submit is an
  antipattern — split into `loadError` + `submitError`.
- **Focus-on-success-confirmation rule (new 9):** when a mutation
  replaces the primary action UI with a confirmation card, the
  confirmation card should receive keyboard focus (via
  `ref.focus()` with `tabIndex={-1}`) and be wired
  `role="status"` + `aria-live="polite"`. SR users otherwise
  have no signal that the submission completed.
- **Legal-disclosure minimum-size rule (new 9):** any legal
  consent / audit-trail disclosure that could be cited in
  dispute (e-sign consent, ToS agreement, arbitration notice)
  must render at `text-xs` (12px) or larger. Sub-12px fine
  print is a readability hazard AND potentially an
  enforceability risk in some jurisdictions.
- **Retry-on-load-error rule (new 9):** load-error cards that
  tell users to "contact support" / "reply to email" should
  offer an in-page retry first. Transient 5xx + network blips
  don't need a round-trip to the sender to resolve.
- **Public-form a11y checklist (new 10):** any public (no-auth)
  form must ship all of: `<Label htmlFor>` + Input `id`,
  `role="alert"` on validation errors, `aria-invalid` +
  `aria-describedby` wiring, form-level `onSubmit` for
  Enter-to-submit, mobile-keyboard attrs (`autoComplete/
  inputMode/autoCapitalize/autoCorrect/spellCheck`), an h1
  landmark (sr-only is fine when a CardTitle supplies the
  visual heading), 44px min touch on the primary CTA, and
  `useDocumentTitle` so the browser tab + SR page-load
  announcement are meaningful. This is a **grep candidate**
  across `/auth`, `/sign/:docId` (already refined but worth
  spot-checking), `/forgot-password`, `/reset-password`,
  beta-intake.tsx, and any public lead-capture form.
- **Trust-claim specificity rule (new 10):** trust-signaling
  copy should be specific and technical, not platitudinous.
  "Your information is secure" reads as marketing fluff.
  "Your information is encrypted in transit and at rest"
  reads as a system-design claim and calibrates trust
  better. Where the stronger claim is accurate, use it.
- **Money-precision rule (new 10b):** on a money surface,
  ALL rendered dollar amounts must explicitly set
  `{ minimumFractionDigits: 2, maximumFractionDigits: 2 }`
  via `.toLocaleString()`, or use a typed helper. Bare
  `.toLocaleString()` is a trust bug: it drops cents on
  integer values. **Grep candidate** across `/properties`,
  `/deals`, `/campaigns`, `/finance` for bare
  `.toLocaleString()` on money values.
- **Silent-mutation-on-messaging rule (new 10b):** on any
  conversation-thread UI (borrower ↔ lender, user ↔ support,
  user ↔ agent), a message send that clears the composer on
  client but fails on server is the worst-case trust bug.
  User believes the message was sent. MUST surface inline
  error + preserve the composer input on failure. Tighter
  variant of the Submit-error-must-not-unmount-form rule (9)
  specifically for conversational UIs.
- **Definition-list semantic rule (new 10b):** fact-pair rows
  showing `Label:` + `Value` should be `<dl>` + `<dt>`/`<dd>`,
  not `<span>/<span>` in a flex row. SR users hear labeled
  pairs instead of two unrelated text runs. Applies wherever
  a page shows metadata card-style.
- **Unread-count badge min-width rule (new 10b):** badges
  showing `{count}` with fixed `w-4` (16px) clip at ≥10.
  Use `min-w-[16px] px-1` + `tabular-nums` so badges grow
  cleanly as the count crosses one/two/three digits. Parent
  button must carry `aria-label="X (N unread)"`; badge span
  must be `aria-hidden="true"` to avoid double-announcement.
- **State-change error reassurance rule (new 19, generalized 22):**
  error toasts on actions that affect user-visible state
  (money: checkout, charge, plan change, refund, payment
  submit; security: 2FA enable/disable, password change;
  account: deletion; sharing: public-link toggle) should
  explicitly name the current state in the error ("your
  plan wasn't changed", "2FA is still on", "your card
  wasn't charged", "your password hasn't changed"). The
  specific reassurance depends on the action semantics,
  but the *presence* of reassurance is the rule. Generic
  "Couldn't X / try again" is fine for non-state-changing
  actions (fetches, previews); state-changing actions
  need the current-state naming.
- **window.prompt ban (new 22):** `window.prompt` is
  subject to the same inaccessibility constraints as
  `window.confirm` (slice 5l), PLUS on input-sensitive
  surfaces (auth codes, passwords, secrets) it prevents
  proper input semantics (autoComplete, inputMode,
  aria-describedby, etc.). Replace with Radix Dialog +
  Input configured for the specific input type
  (`autoComplete="one-time-code"` for auth codes,
  `type="password"` + `autoComplete="current-password"`
  for passwords, etc.). Extends the slice-5l
  window.confirm ban to prompt. Grep candidate: remaining
  native `window.prompt` calls across the client (none as
  of slice 22).
- **Teach-via-option-label rule (new 25):** when a
  `<Select>` presents options whose consequences aren't
  obvious from the option name (permissions, pricing
  tiers, compliance modes, billing cadence implications,
  etc.), include the consequence in the option label
  itself. Example: scope select on API keys — "Read —
  view data only" / "Write — create and edit" / "Admin —
  full control" instead of bare "Read" / "Write" /
  "Admin". Selection happens once; the label is the only
  chance to disambiguate in-context. Applies anywhere
  option names are domain-specific enough that a first-
  time user can't predict the blast radius. Grep
  candidate: Select options across the app with terse
  permission/mode/tier labels.
- **Placeholder disambiguation rule (new 24):** when a
  confirmation Input requires the user to type a specific
  token (`DELETE`, `CONFIRM`, the organization name, etc.),
  the placeholder should NOT show the token itself.
  `placeholder="DELETE"` lets anxious/rushed users bypass
  the intent of the confirmation by copying from the
  placeholder. Use `placeholder="Type DELETE here"` or
  similar — still discoverable but requires actual typing.
  Additionally: such Inputs should have
  `autoComplete="off"` + `autoCapitalize="characters"` +
  `autoCorrect="off"` + `spellCheck={false}` so the
  browser doesn't auto-correct the verification phrase
  (iOS especially is aggressive about capitalizing and
  suggesting word replacements).

## Next surface to refine

**Settings + /finance + /leads-in-file arcs complete.**
Shift focus:

1. **`/onboarding-v2` 18b** — remaining ~1100 lines
   (portfolio-import, county form, strategy cards, atlas
   tour, team/integrations/workflows steps, completion
   celebration).

2. **`SafeBulkDeleteDialog` + `TaxDelinquentImporter`**
   (shared components used by /leads; standalone files,
   never had a 9-lens pass). Both are dialogs — focus on
   Esc/aria-modal/focus-return parity with the patterns
   from slices 5l + 30.

3. **`/onboarding-v2` 18b** — remaining ~1100 lines
   (portfolio-import, county form, strategy cards, atlas
   tour, team/integrations/workflows steps, completion
   celebration).

4. **jsPDF 1098 generator (slice 10b.ii)** — product +
   compliance question on IRS form fidelity.

5. **`/campaigns` 6c** — AbTestManager + CampaignVariantsPanel
   + CampaignAnalytics deferred component-set.

6. **Teach-via-option-label grep sweep (new 25 rule)** —
   find other `<Select>` options across the app with
   bare permission/mode/tier labels that could benefit
   from the inline-consequence pattern. Candidates:
   pricing/subscription tiers, notification frequencies,
   access levels across team/seat management,
   integration-provider modes.

2. **Full `/finance` 9-lens pass (12b)** — slice 12 was
   narrow (money-precision only). Remaining ~1500 lines:
   create-note form dialog, delete confirmation, payment-
   record dialog, Stripe Connect configuration, dunning
   manager, drawer + cards that weren't touched.

3. **`/leads` 17b** — remaining ~2000 lines (LeadForm,
   LeadDetailDrawer, table rows, bulk-delete dialog, import
   preview, tax-delinquent importer).

4. **`/onboarding-v2` 18b** — remaining ~1100 lines
   (portfolio-import, county form, strategy cards, atlas
   tour, team/integrations/workflows steps, completion
   celebration).

5. **jsPDF 1098 generator (slice 10b.ii)** — product +
   compliance question on IRS form fidelity.

6. **`/campaigns` 6c** — AbTestManager + CampaignVariantsPanel
   + CampaignAnalytics deferred component-set.

7. **Money-action error reassurance grep (new 19 rule):**
   find other mutation error toasts on money-related
   actions and apply the "your X wasn't changed"
   reassurance pattern. Candidates: payment flows in
   /finance, payoff/statement requests in /portal, checkout
   in other surfaces, refund/cancel handlers.

**Grep candidates** (apply cross-cutting rules horizontally):
- `.toLocaleString()` on money still present in ~63 files.
- Decorative-icon aria-hidden sweep — open-ended.
- `useDocumentTitle` — grep for pages that don't call it.
- **`window.confirm()` ban:** ✅ clean as of slice 17.

## Deferred / flagged for owner decision

- **TemplateEditor internal surface** (slice 8): `<TemplateEditor>`
  runs inside Create + Edit template dialogs. Not audited in this
  slice — follow-up pass candidate.
- **Package-doc drag-to-reorder** (slice 8): `GripVertical` icon
  is visual-only in package detail; no drag handler. Either wire
  dnd-kit with 5j draggable-a11y rule, or remove the icon.
- **System-template read-only explanation** (slice 8): Edit +
  Delete buttons simply absent on system templates. No tooltip
  explaining *why*. Minor.
- **"Distress Score" filter mislabel** on `/properties` (prior).
- **Pursue/Pass irreversibility** on PropertyDetailDialog (prior).
- **Verdict `signalColors`** raw Tailwind traffic-light (prior).
- **`typeFilter` on `/deals`** has state but no visible UI control.
- **"Pipeline" summary on `/deals`** aggregates acquisition + disposition.
- **Drag-to-move kanban bypasses stage-gate checks.**
- **DealDetailDrawer / CampaignDetailDrawer focus trap + return**
  — deferred to cross-surface drawer-refactor pass.

## Session hygiene reminders

- Commit per surface (or tight batch).
- Re-run 9-lens after each edit.
- Large surfaces (>15k tokens): read in chunks, commit in slices;
  don't try to inhabit the whole thing in one session.
- Playwright Safari sessions die within ~5 minutes of a Clerk JWT
  refresh; fall back to code-only if cookies expire mid-audit.
- Stop at ~85% context; rewrite this file before ending.

## Known in-flight issues

- **Purple-on-Safari** — fixed at root and on every customer-visible
  site touched.
- **Red toast spam** — 404/403 globally suppressed.
- **Fly deploy leases** occasionally linger ~90s after a transient
  fail; retry.
- **Pre-existing server type errors** in `workflow-engine`,
  `storage`, `autonomousDealMachine`, `countyAssessorIngest`,
  `supportAgent`, etc. — not blocking client refinement work.

## Expected HEAD after session 28

Session chain 8 → 28 cadence (all shipped atomic + docs):

- `234dafa` slice 8  — /documents
- `61f1469` slice 9  — /sign/:docId
- `c6438ba` slice 10 — /portal/:accessToken entry
- `cf01654` slice 10b — BorrowerDashboard
- `37b8911` slice 11 — public-form a11y sweep
- `39227e7` slice 12 — usd() helper + /finance
- `252026c` slice 13 — SignatureCapture (9b)
- `0ffdbde` slice 14 — money sweep: /properties + /deals + /campaigns
- `fb24811` slice 15 — /today
- `a73dfee` slice 16 — /dashboard
- `3fb7dcb` slice 17 — /leads targeted
- `70df779` slice 18 — /onboarding-v2 targeted
- `809044c` slice 19 — /settings targeted (money-action reassurance rule)
- `1b5d0f7` slice 20 — /pipeline full
- `8b5ad36` slice 21 — money-action reassurance grep (6 error paths)
- `04b54f0` slice 22 — /settings security sub-slice (2FA + password, window.prompt ban)
- `74e62ec` slice 23 — /settings billing sub-slice (StripeConnect + SeatManagement)
- `a90fa77` slice 24 — /settings privacy sub-slice (GDPR export/delete)
- `890f5bc` slice 25 — /settings completion (ApiKey + Activity + Goals)
- `ac1a64b` slice 26 — /settings 19b.v final (Referral + Goals form)
- `694ba02` slice 27 — /finance 12b.i (NoteForm + RecordPaymentModal)
- `5059dfc` slice 28 — /finance 12b.ii (AcceptPaymentModal + Drawer header)

Cross-cutting rules added slices 19-28:
- State-change error reassurance (slice 19, generalized 22, applied to 16+ error paths through 26)
- window.prompt ban (slice 22)
- Placeholder disambiguation (slice 24)
- Teach-via-option-label (slice 25)

Brings total introduced in this chain to 16 rules. **Settings
arc is complete** — all 2658 lines refined across 7 commits
(19, 19b.i-v) with zero regressions.

**Coverage to date** (surfaces with explicit 9-lens pass):
legal/trust (documents, sign, portal, signature-capture) +
money (finance, portal dashboard, today, dashboard) +
public forms (auth, forgot-password, reset-password,
beta-intake) + core workflows (inbox, campaigns, deals,
properties-card partials, documents) + entry surfaces
(today, dashboard) + helpers (usd, formatUSD).

Cross-cutting rules introduced across this chain:
- Silent-query→toast trust-surface amplifier (8)
- Restore-older-state ConfirmDialog (8)
- Submit-error-must-not-unmount-form (9)
- Focus-on-success-confirmation (9)
- Legal-disclosure minimum-size (9)
- Retry-on-load-error (9)
- Public-form a11y checklist (10)
- Trust-claim specificity (10)
- Money-precision rule (10b, helper shipped in 12)
- Silent-mutation-on-messaging (10b)
- Definition-list semantic (10b)
- Unread-count badge min-width (10b)

Slices 15-16 introduced zero new cross-cutting rules —
pure horizontal application of the existing stack. That
is the goal state: the rule machinery is now productive
and each new surface confirms the cross-cutting patterns
rather than inventing new ones.
