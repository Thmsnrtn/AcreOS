# Sigfried Anderlecht — Feature Deprecation Playbook

**Reviewer:** Sigfried Anderlecht, 53, ex-Atlassian product-deprecation lead (Stride
sunset, HipChat-to-Slack handoff, Bitbucket Pipes legacy retirement).
**Date:** 2026-05-01
**Wave:** 3 (elite team — deeper)
**Lens:** announcement timing, migration paths, comms cadence, in-product warnings,
data export, support staffing, ticket-volume forecasting.

---

## 1. Why this matters now

AcreOS is pre-launch but already has shippable deprecation debt. Two categories:

1. **Internal-facing legacy** — `client/src/pages/founder-dashboard.tsx` is **7,369
   lines**. The new shell at `/founder` and `/founder-home` (App.tsx:547–550)
   already supersedes it. The sidebar still links to it
   (`layout-sidebar.tsx:851`: *"The legacy operational dashboard is still at
   /founder-dashboard"*) and command-palette has a `command-item-founder-dashboard`
   entry.
2. **External-facing legacy** — `server/routes-borrower.ts:286–581` already ships
   three deprecated borrower endpoints (`/api/portal/:accessToken/payment`,
   `/verify-payment`, `/autopay`) with `X-Deprecation-Warning` headers, a
   `deprecatedPaymentRateLimiter` (2 req/min), and a "use session-based auth"
   migration message. **Headers are live, but there is no announcement, no
   sunset date, and no migration deadline.** That is the textbook "deprecated
   forever" trap.

Atlassian killed Stride cleanly because we set the date *before* we shipped the
warning. AcreOS shipped the warning first. We fix that on the way in.

---

## 2. The five-stage deprecation lifecycle

Every deprecated surface walks all stages. No shortcuts.

| Stage | Length | External signal |
|-------|--------|-----------------|
| 1. Soft-flag | 30 days | None — flag in `beta` state |
| 2. Announce | T-60 opens | Email + banner + docs |
| 3. Warn | T-60 → T-30 | Yellow banner |
| 4. Pressure | T-30 → T-7 | Red banner + dismissal cooldown |
| 5. Sunset | T-7 → T+0 | Modal interstitial; route → 410 |
| 6. Tombstone | T+30 | Code deleted; 410 + `Link:` header |

The 60/30/7 cadence maps to how customers plan: monthly billing (60 → "next
cycle"), sprint horizon (30 → "this sprint"), oh-shit week (7 → "stop everything").

---

## 3. The legacy founder-dashboard sunset (worked example)

**Surface:** `/founder-dashboard` (7,369-line page)
**Replacement:** `/founder` + `/founder-home` (already live)
**Audience:** 1 (Thomas). Internal-only.
**Risk:** Low — single-user, no external dependents.
**Recommendation:** Compress the cadence to **14/7/0** because audience = 1.

### Migration path

`/founder-home` (clean home + autonomy-health card + unified todo preview)
covers ~70% of the legacy surface. Remaining 30% inventory:

- Agent detail → `/founder-agents` + `agent-detail.tsx` (done).
- Job colors → `client/src/lib/agent-identity.ts` (partial per line 6 comment).
- Prompt history / evolutions → already separate pages.
- TODO at `founder-dashboard.tsx:5443` ("full re-skin") is open.

**Action: do not re-skin. Re-skinning a doomed 7k-line file is sunk cost.**
Replace the remaining 30% with focused pages, then delete.

### In-product warning sequence

- T-14: Sticky banner at top of `/founder-dashboard`. "This page retires
  May 15. Use /founder-home for daily ops; /founder-agents for agent
  detail." Use `notification-banner.tsx` (already exists).
- T-7: Banner becomes a **modal interstitial** on first visit per session.
  Dismissable, but logs `deprecation.dashboard.dismissed` to telemetry.
- T-0: Route returns a 200 with a `<RedirectScreen />` — 5-second countdown
  to `/founder-home`, "deep link to old view (read-only)" link for one
  week of grace.
- T+7: Route returns 410 with `Link: </founder-home>; rel="successor-version"`.
- T+30: File deleted. PR title: `chore(founder): remove legacy founder-dashboard.tsx (-7,369 LOC)`.

---

## 4. Borrower endpoint deprecation (real external case)

**Surfaces:** `/api/portal/:accessToken/payment`, `/verify-payment`, `/autopay`
**Replacement:** `/api/borrower/*` (session-based auth)
**Audience:** Active borrowers using legacy magic-link flow.
**Risk:** Medium — these are live customer payment endpoints.

### What's already shipped (good)

- `X-Deprecation-Warning` response header (RFC-style guidance).
- Rate limiter capped at 2 req/min — soft throttle to push migration.
- `logger.warn("Deprecated endpoint accessed: ...")` for telemetry.

### What's missing (must fix before launch)

1. **No `Sunset:` header (RFC 8594).** Add `Sunset: Wed, 01 Jul 2026 00:00:00 GMT`.
2. **No `Deprecation:` header (RFC 9745).** Add `Deprecation: true` plus
   `Link: </api/borrower/payment>; rel="successor-version"`.
3. **No deprecation docs page.** Need `/docs/api/deprecations.md` with curl-level
   migration recipes per endpoint.
4. **No telemetry aggregation.** `logger.warn` lands in logs but nothing
   surfaces a daily stragglers report.
5. **No email outreach.** Magic-link borrowers need 60/30/7 emails.

### Cadence (full 60/30/7)

- **T-60:** Email all borrowers who used the endpoint in last 90 days. One
  paragraph, one button, one fallback link.
- **T-30:** Second email + in-portal yellow banner via `notification-banner.tsx`
  with `severity="warning"`. Do **not** auto-dismiss.
- **T-14:** "We're really doing this" email + 5-min Loom from Thomas.
  Atlassian internal data: ~40% reduction in T-0 ticket spike when founder
  records the video.
- **T-7:** Red banner. Endpoint still works but injects 1500ms artificial delay.
- **T-1:** Final email.
- **T+0:** 410 Gone with JSON body containing new URL. Keep 410 for **≥90 days**
  (bad retry logic hammers for weeks).

---

## 5. Communication cadence (the 60/30/7 doctrine)

| Channel | T-60 | T-30 | T-14 | T-7 | T-1 | T+0 | T+30 |
|---------|:----:|:----:|:----:|:----:|:----:|:----:|:----:|
| Email blast | ✓ | ✓ | — | ✓ | ✓ | — | — |
| In-product banner (yellow) | ✓ | ✓ | — | — | — | — | — |
| In-product banner (red) | — | — | ✓ | ✓ | ✓ | — | — |
| Modal interstitial | — | — | — | ✓ | ✓ | ✓ | — |
| Docs deprecation page | ✓ | (kept) | (kept) | (kept) | (kept) | (kept) | ✓ retire |
| Status page entry | — | — | — | ✓ | ✓ | ✓ | — |
| Founder Loom | — | — | ✓ | — | — | — | — |
| Response header | ✓ | ✓ | ✓ | ✓ | ✓ | (410) | — |

Two rules from Atlassian's playbook that AcreOS should adopt:

1. **No deprecation gets announced on a Friday.** Tuesday or Wednesday only.
   Weekend dead-time burns goodwill.
2. **No deprecation gets announced in the same week as a feature launch.**
   Mixed messages destroy CSAT. Calendar separation = ≥7 days.

---

## 6. Data export options

Every deprecated surface holding user-visible state needs one-click export
**before** the T-60 banner. Non-negotiable.

- **/founder-dashboard** — internal, no user data, no export.
- **Borrower endpoints** — history duplicated in `/api/borrower/transactions`.
  No export needed, but the email must say so: *"Your payment history is
  unchanged and visible at the new URL."*
- **(Future)** analytics/reports deprecations need CSV export preserved on the
  replacement *and* a "download all historical data" link in the banner.

Pattern: `GET /api/<surface>/export.csv` with a 30-day post-sunset retention.

---

## 7. Support staffing & ticket-volume forecasting

Atlassian's empirical model, AcreOS-scaled:

- **Tickets ≈ 2–4% of active users of the surface**, across the 60-day window.
- **70% land in T-7 to T+7.**
- **AHT ≈ 14 min** ("where's the new URL?", "did my data move?", "bookmark broke").

Borrower endpoints: ~100 active borrowers (placeholder until `logger.warn`
aggregation reports real count) → 2–4 tickets total, 1–3 in spike week. ≤1 hr.

External API consumers flip the math: 100 consumers → 4 tickets but 45 min
each (integration help). Plan a **named engineer on-call T-7 → T+7**, not
just support. Each deprecation gets a DRI.

**Forecast line per runbook:**
`audience=<N> · expected_tickets=<2-4% of N> · spike_week_share=70% · AHT=14min · DRI=<name>`

---

## 8. Process artifacts to add

None of these exist yet. All should before the borrower sunset.

1. **`docs/deprecations/README.md`** — index of active deprecations.
2. **`docs/deprecations/<surface>.md`** — one per deprecation: audience size,
   migration path, sunset date, cadence checklist, comms log, usage telemetry.
3. **`server/middleware/deprecationHeaders.ts`** — reusable middleware stamping
   `Sunset:`, `Deprecation:`, `Link: rel="successor-version"`. Today hand-rolled
   in `routes-borrower.ts`.
4. **`client/src/components/deprecation-banner.tsx`** — reusable banner reading
   a config map (`{ route: { sunset, replacement, severity } }`). Legacy
   founder-dashboard currently has no banner at all.
5. **Flag pattern `deprecated.<surface>`** — the 5-state system in
   `server/middleware/featureGate.ts` already supports staging
   `off → beta → on`. Infra exists; not used for deprecations yet.

---

## 9. The "deprecation-forever" trap

Borrower endpoints have shipped `X-Deprecation-Warning` for an unknown
duration with **no sunset date**. Worst possible state: customers learn to
ignore the warning, future engineers treat the legacy as load-bearing, and
the replacement gets second-class treatment.

**Fix this week:** add `Sunset:` header with a real date (July 1, 2026 = 60
days post-launch). Commit the docs page. Calendar T-30. Anything less is theater.

---

## 10. Rollback discipline

Every deprecation needs a rollback path **valid through T+30**:

- Tag the removal commit `deprecated/<surface>-removed`.
- Feature-flag the removal — revert in <5 min.
- Explicit rollback trigger: e.g. "if >5% of active users hit the 410 in 24h,
  restore the route and push T-0 out by 14 days."

Atlassian rolled back the Stride sunset twice. Embarrassing both times but
the right call both times. The rollback path *is* the deprecation, not a
failure of it.

---

## 11. Summary recommendations (priority-ordered)

1. **Set a sunset date on borrower endpoints.** July 1, 2026. Add `Sunset:` /
   `Deprecation:` headers. Ship `/docs/deprecations/borrower-portal.md`. (1 day.)
2. **Inventory the legacy founder-dashboard.** Land the 30% gap on focused
   pages, then delete the 7,369-line file. (2–3 days; large cognitive payoff.)
3. **Ship `deprecation-banner.tsx` + `deprecationHeaders.ts`.** Reusable
   primitives so the next deprecation costs hours, not days.
4. **Formalize the 60/30/7 cadence.** Add `docs/deprecations/PLAYBOOK.md`
   (this document is the first draft).
5. **Wire deprecation telemetry into daily-digest.** `logger.warn` aggregation
   surfaces stragglers without anyone asking.

Five moves convert AcreOS from deprecation-by-vibes to lifecycle discipline.
The work is small. The cost of skipping — 7k-line files no one dares delete,
headers warning forever — is large.

— Sigfried
