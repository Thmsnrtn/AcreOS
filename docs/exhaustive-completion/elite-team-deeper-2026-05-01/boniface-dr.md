# Boniface Wotherspoon — Disaster Recovery Game Day Audit

**Persona:** Boniface Wotherspoon, 51 · ex-AWS Game Day facilitator
**Wave:** 3 / Elite Deeper
**Date:** 2026-05-01
**Scope:** RTO/RPO posture, restore-from-backup, regional failover, ransomware response, on-call readiness, customer comms during incident
**Lens:** "If I push the big red button right now, who knows what to do, in what order, and how long does it take? If anyone has to read code to find out, you have already failed the drill."

I read Bjorn's Fly audit, Nadia's Postgres audit, and Salma's regional audit. They each surfaced one third of the DR gap from their own angle. My job is to put them in the same room and run a tabletop. The picture that emerges is consistent and ugly: AcreOS has *components* that look like a recoverable system, but **zero rehearsal, zero documented runbook for a database loss event, zero ransomware playbook, and a single-person dependency on the founder for every recovery decision.**

---

## 1. One-line verdict

> **AcreOS has backups but no demonstrated restore, two warm machines but no second region, a single human (Thomas) who is the runbook, and three customer-comms channels (status page, in-app banner, email blast) that don't exist. Today's "DR plan" is a hope and a credit card. The good news: 90% of the gap closes in two sprints.**

---

## 2. RTO/RPO — what should AcreOS commit to, and what can it actually deliver?

### Stated targets — there are none

Grepped `docs/operations/runbook.md`, `docs/runbooks/*`, and the SOC2 docs. **No declared RTO. No declared RPO.** This is itself a finding: a SaaS holding billing data and PII without a written recovery objective is signing contracts on hope. Anouk (compliance) will care. Procurement teams at the first enterprise deal will demand a number.

### What AcreOS can deliver today (measured, not claimed)

| Scenario | Today's RTO | Today's RPO | Verified? |
|---|---|---|---|
| Single app machine crash | <2 min (Fly auto-restart) | 0 | Yes — Fly auto-heals |
| Both app machines down, region OK | 5–15 min (manual `flyctl scale`) | 0 | No — never drilled |
| Postgres VM corruption, snapshot exists | **12–40 min** (Bjorn's estimate) | **up to 24 hours** (daily snapshot tier) | **Never restored, ever** |
| Postgres + WAL gone, only S3 backup | **2–6 hours** (cold restore from `dbBackup.ts` dump + WAL replay) | unknown — backup cadence undocumented | **Never restored, ever** |
| iad region outage (Fly + Postgres) | **4–24 hours** (provision new region, restore from S3) | up to 24 hours | Never drilled |
| Ransomware — encrypted at app + DB layer | **Unknown — could be days** | up to 24 hours of data loss minimum | Zero plan |
| Ransomware — encrypted backups too | **Indeterminate** — no immutable/offline copy | total | Zero plan |

### What AcreOS should commit to (Boniface's recommendation)

For a SaaS with billing and investor data targeting SOC 2:

| Tier | RTO | RPO | Cost delta |
|---|---|---|---|
| **Bronze** (today's promise, achievable in 1 sprint) | 1 hour | 1 hour | $0 — drill existing snapshots, document the restore path |
| **Silver** (target by Q3 2026) | 30 min | 15 min | +$60/mo for HA Postgres + WAL archiving |
| **Gold** (required by first SOC2 customer) | 15 min | 5 min | +$354/mo for warm replica region per Bjorn's math |

**Anything in a customer contract today that says "99.9%" or implies < 1 hour recovery is a lie until a restore drill is run and documented.** This is the single most-urgent legal-exposure item in the audit.

---

## 3. The restore drill — run it this week, not "soon"

Bjorn called this P0. Nadia called it P0. I'm calling it P0 a third time because it's what game-day exists to expose. Here's the scripted exercise — owner, steps, success criteria, debrief format.

### Drill 1: "Postgres is corrupt, restore from yesterday's snapshot"

**Owner:** Thomas + one other engineer (the muscle-memory must not live in one head).
**Duration:** 90 min including debrief.
**Pre-conditions:** prod traffic continues normally; restore lands in `acreos-db-restoretest`.

```bash
# 0. announce in #incidents — "DRILL, NOT REAL"
# 1. enumerate
flyctl postgres backup list -a acreos-db
# 2. provision restore target
flyctl postgres create --name acreos-db-restoretest --region iad --vm-size shared-cpu-2x
# 3. restore
flyctl postgres backup restore <id> -a acreos-db-restoretest
# 4. smoke
psql $RESTORETEST_URL -c "select count(*) from users;"
psql $RESTORETEST_URL -c "select max(created_at) from audit_log;"
psql $RESTORETEST_URL -c "select count(*) from payments where created_at > now() - interval '7 days';"
# 5. teardown
flyctl apps destroy acreos-db-restoretest --yes
```

**Success criteria:**
- Time-from-go to "smoke passes" recorded.
- Row counts within 24h delta of prod.
- No surprises (extension missing, role missing, password drift).

**Debrief template** (`docs/dr/drill-2026-05-postgres.md`):
- What we did
- What broke vs. what we expected
- Time-to-restore (the number that goes into RTO claims)
- Three actions that came out of it

### Drill 2: "Region down, fail to dfw"

Cannot run today — there is no dfw replica. **Phase 0 prerequisite: Salma's recommendation to provision the dfw replica.** Once that's live, the drill is:

```bash
# 1. simulate iad outage by scaling app to 0 in iad
flyctl scale count 0 --region iad
# 2. promote replica
flyctl postgres failover -a acreos-db
# 3. scale app in dfw
flyctl scale count 2 --region dfw
# 4. verify Cloudflare routes to dfw origin (DNS or Worker rule)
# 5. fail back
```

**This drill cannot be passed without a second region. There is no shortcut.**

### Drill 3: "Ransomware — backups are also encrypted"

This is the one nobody runs and everyone needs. See §6.

### Drill cadence

- First three drills: this quarter.
- Then: **quarterly, calendar-invited, never on a TODO list.** The TODO list is where DR drills go to die. The calendar invite is what makes them happen.

---

## 4. The runbooks that don't exist

Inventory of `docs/runbooks/`:
- `ai-quota-exceeded.md` ✓
- `data-breach-response.md` ✓
- `db-migration-failed.md` ✓
- `deal-hunter-blocked.md` ✓
- `redis-connection-lost.md` ✓
- `runaway-background-job.md` ✓
- `runaway-job.md` ✓
- `stripe-webhook-stopped.md` ✓
- `valuation-model-drift.md` ✓

**Missing — these are the DR-class runbooks that don't exist:**

| Runbook | Why it matters | Owner | Pages |
|---|---|---|---|
| `postgres-down.md` | The single highest-blast-radius failure | Founder + Nadia | 3 |
| `region-iad-outage.md` | Tied to single-region posture | Founder + Salma | 3 |
| `restore-from-snapshot.md` | The exact commands from §3 drill | Founder | 1 |
| `ransomware-response.md` | Legal + insurance + comms in one doc | Founder + Anouk + counsel | 5 |
| `customer-data-loss-event.md` | Disclosure timeline, refund matrix, contract triggers | Founder + counsel | 3 |
| `secrets-compromise.md` | Coordinated rotation across 30+ keys | Founder | 2 |
| `clerk-outage.md` | Auth provider down — degraded read-only mode? | Founder | 2 |
| `stripe-down.md` | Already partially in stripe-webhook-stopped, but billing-down ≠ webhook-stopped | Founder | 2 |

**Each runbook must contain, at minimum:**
1. Detection — what alert fires? what dashboard?
2. Severity classification — when does this become customer-comms-worthy?
3. Communication script — pre-written status-page text, pre-written customer email, pre-written in-app banner
4. Step-by-step recovery — copy-pasteable commands
5. Verification — how do you know you're done?
6. Post-mortem template

The existing runbooks are good, but they're operational not strategic. The above eight are strategic and belong in the same folder.

---

## 5. On-call readiness

### Who's on-call today?

Thomas. Always Thomas. Memory file confirms: `Thomas Norton — AcreOS founder, hands-on technical, expects production-quality.` This is the "key person risk" that every game-day surfaces.

**Scenarios that break:**
- Thomas is on a plane (4 hours, no signal).
- Thomas is in surgery (multi-day).
- Thomas's phone is dead and he's at his daughter's recital.
- Thomas has the only access to the Fly account, the only access to Stripe, the only access to Cloudflare DNS, the only access to the GPG key that decrypts S3 backups.

### What the team needs (priority order)

1. **A second on-call human** — even if part-time, even if contracted. Someone with `flyctl` access, Stripe dashboard access, Cloudflare DNS access. **No-bus-factor-of-one is a SOC2 audit finding.**
2. **A documented escalation chain** — if primary doesn't ack in 15 min, who's secondary?
3. **An incident commander rotation** — separate from primary on-call. The IC runs the meeting, the on-call runs the keyboard. Conflating them under one person under stress causes mistakes.
4. **A break-glass account** — a sealed credential envelope (literally — physical, in a safe) with read-only Fly/Stripe/Cloudflare access for the COO/CFO/board chair to use *only* if Thomas is unreachable for >4h. This is standard for compliance and is missing.
5. **Pager** — PagerDuty / Opsgenie / similar. Sentry alerts going to email is not pageable. Needs phone-call escalation on P0.

### On-call drill (separate from restore drill)

Once a quarter, an unannounced "Thomas is unavailable" tabletop. Random Tuesday afternoon, Slack message: "Thomas is on a plane. Postgres is reporting 50% query failure rate. Go." Watch what happens. The first time you run this you will be horrified. That's the point.

---

## 6. Ransomware — the audit that nobody wants

This is the scenario the team is least prepared for. It's also the one that most often ends startups outright. Coverage:

### Threat model

Three vectors I'd attack AcreOS from:
1. **Compromised CI** — push a malicious commit, GitHub Actions has `FLY_API_TOKEN` and `DB_BACKUP_S3_*` in secrets. Game over: I can deploy code that exfils + drops + ransom.
2. **Compromised founder laptop** — Thomas signs into Fly/Stripe/Cloudflare from one machine. Stealer malware → I have everything in 4 minutes.
3. **Compromised Postgres credentials** — leaked `DATABASE_URL` via accidental log line. I `pg_dump`, encrypt, drop the live data, leave a ransom note in a `READ_ME` table.

### The defenses that exist

- Fly secrets are encrypted at rest. ✓
- Postgres is on Fly's private network (`*.flycast`). ✓ (assuming, verify)
- `FIELD_ENCRYPTION_KEY` provides column-level encryption for some PII. ✓ (Bjorn flagged the no-rotation issue)
- Backups go to S3 (`server/jobs/dbBackup.ts`). ✓ but...

### The defenses that don't exist (each is a P0 or P1)

**R1. Backups are not immutable.** S3 bucket — is `Object Lock` enabled? Is versioning + MFA-delete on? Without these, a compromised IAM key deletes both live data AND backups in 90 seconds. This is the canonical ransomware playbook against startups. **Verify today; if not, enable today.**

**R2. Backups are not offline.** All backups live in cloud-native storage controlled by the same identity surface as the primary. A second copy to a separate provider (Backblaze B2, Wasabi, or — for the truly paranoid — a literal external drive cycled weekly) is the difference between "we restored" and "we paid the ransom."

**R3. Backups are not air-gapped to a second account.** The S3 bucket is presumably owned by the same AWS account as everything else. Cross-account replication to a `acreos-cold-recovery` account whose IAM credentials live in a different password manager / are accessible to a different human (the COO?) is the standard ransomware-resistant architecture. Cost: ~$5/mo for the second account + storage.

**R4. No encryption-at-rest verification.** Backups use GPG (per memory) — but the recovery key: where is it? On the laptop that's already compromised? In 1Password whose master password is the same as the laptop password? **A recovery key that lives only on the compromised host is no recovery key.** Print it. Store it physically. Two copies, two locations.

**R5. No detection.** Ransomware on Postgres looks like sudden DROP TABLE statements from a privileged role. Nothing watches for this. Add: a `pg_stat_statements` watch for DDL spikes (Nadia's extensions enable this), a row-count anomaly alert (rows-per-table baseline + 50% drop = page), and an audit-log integrity check (gaps in IDs, sudden truncation).

**R6. No insurance.** Cyber insurance with a ransomware rider runs $300–800/mo for a SaaS at AcreOS's stage. The first time you need it pays for it for 30 years.

**R7. No legal coordination.** Ransomware response in 2026 has legal complications: paying a sanctioned group (some are on OFAC list) is a federal crime. A 3am decision on whether to pay is *not* a decision the founder should make alone. Counsel-on-retainer with cyber expertise is the right answer; a phone number on the laptop screensaver, not a notion doc.

### Ransomware tabletop (run within 60 days)

Scenario: "It's 6:47am Saturday. A Slack DM to thomas@acreos.io with a Bitcoin address and a screenshot of the `users` table. The `acreos-db-snapshots` S3 bucket is empty. The Fly Postgres returns connection errors. What do you do for the next 6 hours?"

You will discover, in real time, that:
- Nobody knows the AWS support phone number.
- The legal counsel doesn't have a cyber specialist.
- The "second human with Fly access" is on vacation.
- The backup-of-the-backup either doesn't exist or hasn't been tested.
- Customer comms — there's no template, the status page doesn't exist, the email-blast tool requires SendGrid creds Thomas has.

This is what tabletops are for. You discover the gaps in a meeting room, not at 6:47am Saturday.

---

## 7. Customer communications during incident

The third pillar of DR. Bjorn and Nadia and Salma all focused on the technical recovery. Customers don't care about your `flyctl` commands; they care about: is my data safe, is the app working, when will it work, do I get a refund.

### Channels — what exists

| Channel | Status | Gap |
|---|---|---|
| Status page (`status.acreos.io`) | **Does not exist** | Need this; statuspage.io is $29/mo or use Better Stack's free tier |
| In-app banner / system status | **No code path** | Add a banner component fed from a feature flag / KV |
| Email blast | Implicit via Mailgun/SendGrid | No incident-comms template, no list segmentation |
| SMS (Twilio?) | None for incidents | P3 — only matters for paid tiers with SLA |
| Support inbox | Exists (Inbox messages) | Not the right channel for one-to-many incident updates |

### Pre-written templates (must exist before incident, not during)

`docs/dr/comms-templates/` should contain:
- `degraded-performance.md`
- `partial-outage.md`
- `full-outage.md`
- `data-loss-disclosure.md` (the hardest to write; write it now while calm)
- `security-incident-disclosure.md`
- `recovery-complete.md`

Each template has placeholders (`{{component}}`, `{{eta}}`, `{{affected_orgs}}`) and has been **legal-reviewed once**. During incident you fill in placeholders and send. You do not draft from scratch under stress.

### Disclosure timing — the hard rule

For a PII breach affecting a US customer: state laws vary, but assume 72 hours from discovery to notify in writing. For SOC2: 24 hours to notify the auditor. For SOC2 with a customer contract: read the contract, the answer is usually 24 hours. **Build the comms infra to send within 4 hours so you can hit any of these without panic.**

---

## 8. Paying-customer data integrity — the asymmetric risk

50 paying customers. Most are sole proprietors or small teams. Each one has dropped invoices, tax-relevant transactions, contact data, deal pipelines, signed e-sign documents into AcreOS. **For most of them, AcreOS is the system of record for their business.** Losing their data is not "we'll restore from backup" — it's "you put my business on hold for a week and I'm churning."

### What protects customer data integrity today

- Daily Postgres snapshot (Fly tier).
- S3 backup via `server/jobs/dbBackup.ts` (cadence — verify; logs may show schedule).
- Optimistic locking on `payments` (Adriana's audit).
- `audit_log` table (append-only).

### What threatens it

1. **Migration drift** — Nadia documented the `migrate.mjs` vs `_journal.json` divergence. The day a botched migration drops a column, the recovery story is "restore the snapshot, replay 24h of customer activity from `audit_log`" — and AcreOS has not validated that `audit_log` is replay-sufficient. (Spoiler: it almost certainly isn't.)
2. **No PITR on the basic Fly Postgres tier.** Up to 24h of data loss on any restore. Bjorn flagged. Critical for billing-grade data.
3. **No customer-visible "your data was last backed up at..." indicator.** Customers can't self-verify. This is a trust gap that becomes a sales objection at the enterprise tier.
4. **No customer-initiated export.** If AcreOS has a bad day, customers can't pull their data out and continue elsewhere. The `customer-data-loss-event.md` runbook should include a manual `pg_dump --schema-only` per-org as a last resort. Better: ship a self-serve export feature *now*, before you need it.

---

## 9. The integration — Bjorn + Nadia + Salma + Boniface

Each prior auditor identified their slice. Here's the integrated DR critical path with no duplication:

| Phase | Item | Owner | Who flagged it | Effort |
|---|---|---|---|---|
| 0 | Verify `REDIS_URL` set in prod | Founder | Salma | 5 min |
| 0 | Verify S3 bucket has Object Lock + versioning | Founder | Boniface | 1 hour |
| 0 | Print + physically store backup decryption keys | Founder | Boniface | 1 hour |
| 1 | First Postgres restore drill — establish baseline RTO | Founder + Nadia | Bjorn, Nadia, Boniface | 2 hours |
| 1 | Write `postgres-down.md`, `restore-from-snapshot.md` runbooks | Founder | Boniface | 4 hours |
| 1 | Stand up status page | Founder | Salma, Boniface | 2 hours |
| 1 | Pre-write comms templates, legal-review once | Founder + counsel | Boniface | 1 day |
| 2 | Provision dfw Postgres replica + read-path audit | Founder + Nadia | Salma, Bjorn | 3 days |
| 2 | Failover drill (manual, scheduled) | Founder + 2nd human | Salma, Boniface | 1 day |
| 2 | PagerDuty / Opsgenie + escalation chain | Founder | Boniface | 1 day |
| 2 | Second human with break-glass access | Founder | Boniface | governance, not tech |
| 3 | Ransomware tabletop with counsel | Founder + counsel + 2nd human | Boniface | 1 day |
| 3 | Cross-account S3 replication for backups | Founder | Boniface | 4 hours |
| 3 | Cyber insurance quote | Founder | Boniface | 1 week elapsed |
| 4 | Quarterly drill calendar set, perpetually | Founder | Boniface | governance |

---

## 10. Severity-ranked findings

| # | Finding | Severity | Effort | Owner |
|---|---|---|---|---|
| 1 | Zero restore drills, ever — RTO is fiction until proven | **P0** | 2h | Founder + Nadia |
| 2 | No documented `postgres-down` or `region-down` runbook | **P0** | 1 day | Founder |
| 3 | Bus factor of 1 — Thomas is the only operator | **P0** | governance | Founder |
| 4 | S3 backup immutability (Object Lock + MFA-delete) unverified | **P0** | 1 hour | Founder |
| 5 | No ransomware response plan | **P0** | 2 days incl. tabletop | Founder + counsel |
| 6 | RTO/RPO uncommitted in writing | **P1** | 2 hours | Founder + counsel |
| 7 | No status page or incident-comms templates | **P1** | 1 day | Founder |
| 8 | No second-region replica for failover | **P1** | 3 days | Founder + Salma |
| 9 | No PagerDuty / phone-call escalation | **P1** | 1 day | Founder |
| 10 | No cross-account / offline backup copy | **P1** | 4 hours | Founder |
| 11 | No customer self-serve data export | **P2** | 3 days | Founder |
| 12 | Decryption keys live only on the compromised host | **P2** | 1 hour | Founder |
| 13 | Cyber insurance — no quote yet | **P2** | 1 week elapsed | Founder |
| 14 | No quarterly drill calendar | **P3** | 30 min | Founder |

---

**— Boniface**
*"Backups, runbooks, and on-call humans are three legs of the same stool. AcreOS has parts of one leg. Run the first drill this week. The second one a month later. By Q4 you will have a real DR posture instead of a hopeful one."*
