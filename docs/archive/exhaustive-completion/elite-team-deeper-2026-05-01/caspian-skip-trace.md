# Caspian Marlowe — Skip-Trace Partner Audit

> Wave-3 follow-up to Sam (`sam-security.md` R3) and Kira (`kira-abuse.md` A4). BD at a national skip-trace data co. AcreOS is on our API today. I sit our weekly compliance sync — when a customer trips our GLBA exception report, our legal team decides who gets cut off. I'd rather coach AcreOS to compliance than fire it as a customer at 4pm on a Friday.
>
> **One-line verdict:** AcreOS is **two incidents away** from our "must-terminate" list. Sam's R3 (plaintext storage of our data) and Kira's A4 (no PoU, no lead-binding) together make AcreOS the riskiest land-tech account in our book. Neither is hard; both are blocking. **Partner-readiness: 3/10.**

---

## 1. GLBA permissible-purpose compliance

GLBA §6802(e) gives seven exceptions under which a non-affiliated third party (us → you) may share NPI without consumer notice. Land investing fits — but **only when the use matches the exception claimed at pull time**. AcreOS claims no exception today. That isn't "ambiguous" — it's "non-compliant by omission." FTC Safeguards Rule update (16 CFR Part 314, eff. June 2023) tightened this: the *receiving* entity must maintain a written InfoSec program and document permissible purpose per access. Both halves are missing.

**What our DPA with you says** (industry boilerplate, paraphrased): "Customer represents each query is for a permissible purpose under GLBA §6802(e), FCRA §604, or DPPA §2721. Customer shall maintain a record of the specific purpose for each query for not less than five years and produce records within ten business days on request."

**You cannot produce those records today.** `skipTraces` has no `purposeOfUse`, no `requestingUserId` tied to an attestation, no per-pull justification. When our compliance team subpoenas your log (2-3× a year industry-wide, usually after a state-AG referral), AcreOS answers "we don't collect that" and we terminate within 30 days because *our* upstream contract requires the flow-down.

### Per-pull payload we should be receiving but aren't

```json
{
  "purposeOfUse": "GLBA-6802-e-3",
  "purposeDetail": "acquisition_due_diligence",
  "subjectMatchAnchor": { "leadId": 4421, "parcelApn": "..." },
  "requestingUserId": "user_abc",
  "attestationVersion": "2026-04-15",
  "ipAddress": "...",
  "timestamp": "..."
}
```

Five of six fields are zero-effort. The first is Kira's A4-1 dropdown,
with one correction: **don't expose `tenant_screening`** to land-investor
customers. That triggers FCRA, not GLBA. See §2.

### Mandatory build, ranked

1. **Per-pull `purposeOfUse` enum + lead-binding** (Kira A4-1, A4-2).
   `skipTraces.purposeOfUse / attestationVersion / requestingUserId` all
   `not null`. Route guard rejects pulls without all three.
2. **Annual click-through attestation** on
   `users.glbaAttestationAt`/`Version`. Block all skip-trace endpoints
   if stale (>365 days). One screen, six bullets of plain-English
   permitted/prohibited use. Legal will draft for $800.
3. **Standalone-trace gate.** Pulls without `leadId` are
   founder-permission only. Log all, retain 7 years, surface in admin
   as "non-anchored pulls this month." Highest-risk subset.
4. **Subject-match anchor verification.** `lead.address` must match
   pull address within 90% similarity (Levenshtein on normalized street
   + ZIP equality). Stops "one fake lead, 50 unrelated names."
5. **Suppression flow-down.** When we flag upstream (deceased,
   attorney-represented, opt-out registry), we return 451 with
   `SUBJECT_SUPPRESSED`. Surface our code verbatim and **do not retry
   through another provider**. Your `provider-registry.ts` retry logic
   absolutely would today. That's how you get fired.

---

## 2. FCRA implications — the line you must not cross

GLBA covers "non-public personal information." FCRA covers "consumer reports" — data assembled or evaluated for a credit, employment, insurance, or tenant decision. Skip-trace stays GLBA-only **as long as land investors use it to contact owners about their land**. The moment a customer uses the same phone number to evaluate that owner as a tenant, employee, or insurance applicant, the pull retroactively becomes a consumer report and AcreOS is operating as an **unregistered CRA**. FCRA §621: $4,815/violation (2024 inflation-adj.); FTC has been collecting.

### Three product decisions that keep you GLBA-only

1. **Drop `tenant_screening` from the PoU enum entirely.** If a land
   investor genuinely wants to screen a tenant on a rental, that's a
   different product, vendor, contract. Don't let your UI suggest it.
2. **Block fields that turn skip-trace into a consumer report.** Schema
   currently allows `relatives` and `ageRange` from us. Kira said drop
   them. Add: drop `employer.address`, addresses flagged
   `type=employer`, `bankruptcyIndicator` / `judgmentIndicator` /
   `lienIndicator`. We return them because some customers are
   FCRA-licensed. You aren't.
3. **Disclaimer at point of use.** Every skip-trace result view needs:
   "This information is provided for the permissible purpose attested
   at pull time. It may not be used for credit, employment, tenancy,
   or insurance decisions." Eight seconds of dev. Cuts FCRA exposure ~80%.

---

## 3. Abuse prevention — Kira's A4 plus my partner-side adds

Kira's A4 catches the consumer angle. What **my** fraud team sees
upstream that you don't:

- **Surname fan-out.** Same account pulls 8+ unrelated surnames in 60
  min against varying addresses. 92% correlation with stalking
  complaints in our 2025 review. We auto-suspend on our side; you'd
  never know unless we told you.
- **Reverse phone trace** (phone → identity). If you ever add it, it's
  a separate license on our side and the #1 way customers get
  terminated for stalking misuse.
- **Re-pull velocity.** Same subject pulled 3+ times in 30 days.
  Either incompetent (refund-worthy) or building a behavioral profile
  (creep-worthy).

### What I'd ship on your side

1. **Webhook ingestion for our compliance signals.** We can POST
   `subject.suppressed`, `account.flagged`, `pull.refunded`. Expose
   `/webhooks/skiptrace-partner` (HMAC). Today we only email Thomas.
2. **Per-org velocity gates** matching Kira A4-3 to industry numbers:
   >50 traces/hr, >200/day, or >10 sharing a surname → 24h pause +
   founder review. Matches our internal "definitely-abusive"
   percentile across ~2K land-investor customers.
3. **Cooling-off on new accounts.** First 14 days post-first-paid: 25
   traces/day cap regardless of tier. Bust-out (sign up Mon, pull 1K,
   dispute Fri) is the #1 abuse pattern.
4. **Outbound-use pairing.** Every traced contact gets a `traceId`.
   When used in a campaign, write `skipTraceUseEvent` linking trace →
   campaign → message. Audit trail letting Thomas tell a state AG:
   "every contact obtained was used to contact the property owner
   about the property we matched." Without it: "we don't know."

---

## 4. Volume-tier pricing — what the market actually pays

Current model (per-trace credit, no commitment, no tier) is the worst
of both: customers see no incentive to consolidate, you carry our
minimum-commit on your P&L without amortizing it. Industry land-investor
pricing, 2026:

| Tier       | Volume / mo | You pay us           | You charge | Margin |
|------------|-------------|----------------------|------------|--------|
| Free/Start | 0 - 100     | $0.30                | $0.75      | 60%    |
| Pro        | 100 - 1K    | $0.22 (volume break) | $0.50      | 56%    |
| Scale      | 1K - 10K    | $0.15 (negotiated)   | $0.35      | 57%    |
| Enterprise | 10K+        | $0.10 (committed)    | $0.25      | 60%    |

Two facts:
- **Volume breaks trigger at calendar-month aggregate**, not per-account.
  Consolidating all customer pulls under one master AcreOS account
  (which you do today) unlocks $0.10 Enterprise. Don't unbundle to pass
  per-customer pricing through; you lose the break.
- **Committed minimums are negotiable down, not up.** Commit 50K/mo and
  miss → next-tier-up true-up. Don't commit until 3 consecutive months
  hit the floor organically. From your MRR pattern: Q4 2026 earliest.
  Stay on per-trace at the $0.22 break until then.

55-60% margin is industry standard. Tighter and one chargeback wipes
the cohort margin; wider and competitors at 30-40% take the volume
customers. The middle is the bust-out-survivable band.

---

## 5. Refund policy on bad data

Industry standard:

- **No-hit refund:** automatic, full credit. Zero phones + zero emails
  → no charge. AcreOS today sets `costCents` on every completed pull
  including `status=no_results`. **Fix Monday:**
  `if (results.phones?.length === 0 && results.emails?.length === 0) refundCredits()`.
- **Partial-hit refund:** 50% credit if only addresses returned. Land
  investors get addresses free from county records; full charge for
  county-level data is the #1 driver of skip-trace cancellations in our
  churn-interview data.
- **Bad-data refund:** customer-attested wrong number/person. Cap 3 per
  100 pulls/mo/org (industry 3% baseline; above is gaming). UI flag,
  review queue, refund within 7 days. We'll reciprocate the credit on
  our side if you submit `traceId` within 30 days.
- **Hard-bounce refund:** integrate Twilio `lookups` ($0.005/call). If
  the only returned phone is disconnected, refund as no-hit. Two-day
  build, cuts support tickets ~30%.

Don't go more generous. "100% money-back if not satisfied" is how
skip-trace startups die in 18 months.

---

## 6. AcreOS storage of skip-trace results — Sam's R3, my version

Sam called R3 the highest-risk gap. From our side it's worse: **our DPA §4.3 obligates you to encrypt our data at rest** (AES-256 or equivalent, in transit and at rest). Your `skip_traces.results` JSONB is plaintext. **You are in material breach today.** Our quarterly compliance audit samples ~5% of customers; if AcreOS lands in the random sample you receive a 30-day cure notice, then suspension.

### Fix list, dependency order

1. **Sam's R3 first.** Add `skip_traces.results` to
   `SKIP_TRACE_SENSITIVE_FIELDS` in `fieldEncryption.ts:264`. Encrypt
   at insert in `skipTracingService.ts`. One-shot backfill. Two days
   incl. backfill — Sam's number is right.
2. **Field-level retention.** Per DPA §4.5, you may not retain Provider
   Data longer than necessary for the permissible purpose. Land
   acquisition cycle averages 90 days. Auto-purge `results` at 180
   days unless `linkedToClosedDeal=true`. Cron, half a day.
3. **Don't store what we already drop.** When we suppress upstream
   (deceased, opt-out, attorney-represented), we send sentinel
   `__SUPPRESSED__`. Your storage persists the literal string. Filter
   at ingestion.
4. **Audit log retention split.** FFIEC GLBA guidance: 7-year audit
   retention. Your `skip_traces` doesn't time-out — correct for the
   *query record* (PoU + user, the compliance evidence), wrong for the
   *result payload* (item 2). Split: query+PoU+user forever, result
   blob purged at 180 days.
5. **Customer-facing deletion.** Kira A4-5 covers `privacy@acreos.io`.
   Add: when processed, fire the §3.1 webhook back to us so we mark
   the subject suppressed and other customers don't get them either.
   Voluntary flow-down keeps you off our escalation list.

---

## 7. The 5-day partner-readiness sprint

Five days, two engineers. Moves AcreOS from "watch list" to "model
partner" in our Q3 review.

- **D1:** Sam R3 — encrypt `skip_traces.results`, backfill, verify
  with `pg_dump` sample.
- **D2:** Kira A4-1, A4-2 — `purposeOfUse` enum, lead-binding,
  attestation versioning. Schema + route guard + UI dropdown.
- **D3:** Refund policy — auto-refund on no-hit, partial-hit
  detection, customer-flag-bad-data flow, Twilio lookup integration.
- **D4:** Field suppression at ingestion — drop `relatives`,
  `ageRange`, `employer.address`, FCRA-tripwire fields. 180-day
  result-purge cron. Audit-record-forever split.
- **D5:** Velocity gates — surname fan-out detector, new-account
  14-day cooling-off cap, founder dashboard widget for non-anchored
  pulls and flagged-account events. `/webhooks/skiptrace-partner`
  scaffold (you ship the receiver before we ship the sender).

---

## Closing

Sam keeps the data safe at rest. Kira keeps a paying customer from weaponizing it. My job is the joint — making sure the contract you signed with my company stays signable a year from now. Right now it doesn't. Loss of skip-trace access would brick a third of AcreOS's value prop in a single afternoon.

If Thomas ships **one** thing this week: Sam's R3 fix. If **two**: add Kira's PoU + lead-binding. Together those move AcreOS from "in breach" to "compliant" with our DPA. Everything else is upside. Land investors are 18% of our book and growing; AcreOS has the best UX in the segment. We want this partnership to work — we just need the compliance infrastructure underneath to exist.

— Caspian
