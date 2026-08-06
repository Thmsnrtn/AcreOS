# 13 — Reliability: how does the solo founder learn AcreOS broke, on his phone, in how many minutes?

**State of the region.** The reliability substrate is genuinely mature and mostly honest: Sentry is really wired (`initSentry()` at boot, single correct express error handler, `unhandledRejection`/`uncaughtException` capture), there is a real deadman (`deadmanCheck.ts` over a 118-entry `JOB_ROSTER`), a real self-rescheduling scheduler with backoff + DLQ (`scheduler.ts`), a real page fan-out to the founder's phone (VAPID push + email + ntfy via `alertSpine`/`oncall`/`pagerService`), and an automated weekly restore-*verify* job (`backupRestoreVerify.ts`). The old dual-Sentry-handler bug (lens 03/11) is fixed — only one registration survives at `server/index.ts:705`.

**The single defect class that survives every gate here: failure is quieter than absence.** The deadman pages P0 when a critical job *stops running*, but a critical job that *runs and fails every time* — most importantly the backup pipeline (`db_backup`, `backup_restore_verify`) — is routed through `job:failed`, which is `founderClass: "C"` / `defaultChannel: "in_app"` (`notificationDispatcher.ts:69`), i.e. an in-app tray row that "never interrupts the founder". A corrupt backup discovered at 05:00 Sunday never buzzes his phone. Compounding it: **no full DR restore has ever been executed** (the drill ledger is empty; the one runbook citing a "timed restore exercise" links to a dead path that is actually a tabletop *audit* whose own verdict is "zero demonstrated restore"), and the `backup_verified` proof table has **no reader**.

---

### F-13-1 — A background job that runs and FAILS never reaches the founder's phone (backup pipeline is the worst case)
**Severity:** P1 serious
**Surfaced by:** slice 13 (reliability)
**Survives which gates:** `jobRosterCoverage` only asserts roster↔`withJobLock` parity; the deadman + `deadmanCheck` tests only assert *absence* liveness (2× cadence with no row); no test asserts a *failing* critical job pages. `lint:reachability` sees `job:failed` is emitted and consumed, so it's "wired" — it just resolves to an in-app tray, which no gate scores as insufficient.
**Evidence:** `server/services/notificationDispatcher.ts:69` — `"job:failed": { defaultChannel: "in_app", label: "Job Failed", founderClass: "C" }` (no `urgentChannel`). Class C is documented "never interrupts the founder" (`notificationDispatcher.ts:14-15`). Emission path: `server/utils/jobRuntime.ts:86-91` writes `status:"failed"` + `eventMeshPublisher.jobFailed(...)` → `server/services/eventMeshPublisher.ts:108-118` publishes `job:failed`. `backupRestoreVerify` failure surfaces *only* this way: `runScheduledJobs.ts:3392-3399` throws on `status==='failed'` and the outer `.catch` just `log(...)`s; `backupRestoreVerify.ts` calls **no** `raiseAlert`/`notifyOnCall` (grep: empty). `dbBackup.ts:180` on a failed backup only `log(...)`s. `autonomousHealthMonitor` pages P1 but only on its *own* revenue/budget checks (`autonomousHealthMonitor.ts:500-522`), not on arbitrary job failures.
**What's wrong:** The deadman covers "job went dark" with a real P0 page, but "job ran and failed" is downgraded to an in-app notification the founder must go looking for. The weekly restore-verify's entire purpose — catch a silently-corrupt backup *before* you need it — is defeated: it throws `backup restore-verification FAILED`, that becomes a Class-C tray row, and the founder learns nothing on his phone.
**Impact:** Burns trust after sale. The founder believes he is protected; a corrupt/failed backup sits undiscovered for days until he opens `/job-health` or actually needs a restore. Worst-case is silent data-loss exposure for customer #1's `financial_ledger` and signed docs.
**Fix:** Route `job:failed` for `critical: true` roster jobs (join on `JOB_ROSTER`) through `alertSpine.raiseAlert({severity:"critical"})` so a failing critical job pages exactly like a dark one. Minimum: have `backupRestoreVerify.ts` and `dbBackup.ts` call `raiseAlert` on failure directly.
**Gate it:** New test `criticalJobFailurePages.test.ts`: for every `JOB_ROSTER` entry with `critical:true`, assert its failure path reaches a phone transport (spy on `pageCriticalThrottled`). Baseline: today 0 of the critical roster jobs page on failure via the generic path.
**Effort:** M
**Blast radius:** `notificationDispatcher.ts`, `runScheduledJobs.ts` (backup jobs), `backupRestoreVerify.ts`, `dbBackup.ts`.
**Confidence:** high — every hop is cited; would rise only by running a live failing job and confirming no push.

---

### F-13-2 — No full DR restore has ever been executed; the runbook cites a "timed restore drill" that never happened
**Severity:** P1 serious
**Surfaced by:** slice 13 (reliability)
**Survives which gates:** DR readiness is documentation + operational, not code — no lint/ratchet/test looks at it. `dr_drills` staleness is surfaced by `/api/jobs/health` but only if a row exists; with zero rows there is nothing to flag as "stale".
**Evidence:** `docs/runbooks/dr-drill-history.md:22-23` — "(no drills recorded yet)". `docs/reliability/dr-runbook-postgres-restore.md:73-84` — RTO table is all `____` placeholders, "Until then, RTO is unproven." Yet `docs/runbooks/07-database-restore-from-snapshot.md:7` cites "Boniface DR drill — `docs/exhaustive-completion/dr-drill-boniface.md` for the most recent timed restore exercise" — **that path does not exist** (`ls`: No such file). The real file is `docs/archive/exhaustive-completion/elite-team-deeper-2026-05-01/boniface-dr.md`, and it is a **tabletop AUDIT**, not a drill; its own verdict (line 21): "AcreOS has backups but no demonstrated restore ... Today's 'DR plan' is a hope and a credit card." `backupRestoreVerify.ts` restores into a scratch DB on the *same* host for count-parity only — it is backup-integrity verification, not a rehearsed full recovery, and it is config-dormant unless `DB_BACKUP_S3_BUCKET` + AWS creds are provisioned (`jobRegistry.ts:103-111`, roster entry `:367-369`).
**What's wrong:** The two canonical DR sources disagree: the append-only ledger says zero drills; runbook 07 asserts a "most recent timed restore exercise" via a dead link to a doc that says the opposite. At 2am the founder follows a broken pointer to reassurance that was never earned. RTO/RPO remain unmeasured.
**Impact:** Burns trust after sale (and blocks the first enterprise/procurement deal, which will demand a number). If the DB is lost, recovery time is genuinely unknown.
**Fix:** Run the manual restore drill in `dr-runbook-postgres-restore.md` once end-to-end, fill the RTO table, append a `dr-drill-history.md` block + `dr_drills` INSERT. Fix `07-...md:7,81` to point at the archived audit and stop calling it a drill. Provision the backup bucket so `backup_restore_verify` leaves config-dormant.
**Gate it:** Extend the existing `dr_drills` staleness surface into a ratchet/alert: if newest `dr_drills.ran_at` > 90d (or zero rows once past Phase 0), raise a `reliability` finding. Baseline: 0 drills recorded.
**Effort:** M (the drill itself) + S (doc fixes)
**Blast radius:** `docs/runbooks/07-...md`, `dr-drill-history.md`, `dr_drills` table, Fly secrets.
**Confidence:** high — the empty ledger and dead link are both verified.

---

### F-13-3 — `backup_verified` proof rows have no reader — the restore-verify trail is built-but-unwired
**Severity:** P2 real
**Surfaced by:** slice 13 (reliability)
**Survives which gates:** the reachability ratchet tracks `tablesNoReader` as an aggregate count (57 at HEAD per orientation) and does not fail on one more; nothing asserts *this specific* proof table is consumed.
**Evidence:** `backupRestoreVerify.ts:288-298` inserts `backupVerified` rows (status verified|failed). Grep for readers across `server/routes*.ts`, `server/services/`, `client/src/`: **zero** — only the writer job, `jobRegistry.ts`, and `runScheduledJobs.ts` reference the symbol. The file header (`backupRestoreVerify.ts:16`) claims the row is "the durable proof trail the deadman/founder surfaces can read"; no deadman code and no founder surface reads it.
**What's wrong:** The weekly restore-verify writes a proof/failure row that no UI, no alert, and no deadman consumes. Combined with F-13-1 (failure only goes to an in-app tray), a failed verification is effectively write-only.
**Impact:** Burns trust after sale — the founder cannot see "was my last backup restorable?" anywhere, defeating the point of the job.
**Fix:** Add a founder-cockpit read of the latest `backup_verified` row (age + status + max drift) on `/job-health` or the Letter, and/or have the deadman flag `backup_verified` staleness. Update the header if the deadman is the intended reader.
**Gate it:** Unit test asserting at least one route/service selects from `backupVerified`; keep it in the `tablesNoReader` reachability set until wired.
**Effort:** S
**Blast radius:** one founder route + one client panel.
**Confidence:** high.

---

### F-13-4 — Sentry is functional but its *provisioning* is ungated: unset DSN in prod = silent no-op, indistinguishable from "no errors"
**Severity:** P2 real
**Surfaced by:** slice 13 (reliability)
**Survives which gates:** `secretsValidation.ts` classes `SENTRY_DSN` as `productionOnly` + `required:false` (`:72`) → a *warning* in logs, never a boot failure. No synthetic check ever sends a test event to confirm the pipe is live. No ratchet covers it.
**Evidence:** `server/utils/sentry.ts:57-60` — `initSentry()` returns early when `!dsn`; `captureException`/`setSentryUser` all early-return on `!initialized` (`:120,132`). `server/index.ts:704` gates the express handler on `process.env.SENTRY_DSN`. `secretsValidation.ts:96-101` emits only a warning for a missing `productionOnly` secret. `syntheticChecks.ts` verifies DB writes but has no "error tracking reachable" check.
**What's wrong:** If `SENTRY_DSN` is not provisioned (or is wrong), every `captureException` is a no-op and the express handler is never mounted — yet the app boots green. The founder's primary "server threw a 500" phone/dashboard signal can be silently dark. "No errors reported" is indistinguishable from "error pipeline is off". (This is the same "no data vs pipeline broken" ambiguity the charge asks about, applied to the error pipe itself.)
**Impact:** Burns trust after sale — a class of 500s reaches customers while the founder's dashboard shows calm. Blocks fast learning at exactly the wrong moment.
**Fix:** In production, escalate a missing `SENTRY_DSN` from warning to a boot-time loud finding (or a startup synthetic that captures a sentinel event and confirms ingestion). Log a single unmistakable line at boot: `error-tracking: LIVE|DARK`.
**Gate it:** A `productionReadiness` assertion (there is already `logIntegrationReadiness` at `index.ts:52` for SES/Stripe/Mapbox) — add Sentry LIVE/DARK to that one-glance summary. Baseline: Sentry absent from the readiness summary today.
**Effort:** S
**Blast radius:** `secretsValidation.ts` / `integrationReadiness.ts`, boot log.
**Confidence:** high on the code; medium on real-world impact (cannot read Fly secrets to confirm DSN is actually unset).

---

### F-13-5 — The event-mesh dispatcher's "urgent" sms/push/email channels are unwired stubs — a labeled-urgent tier silently delivers nothing
**Severity:** P2 real
**Surfaced by:** slice 13 (reliability)
**Survives which gates:** the code is honest-by-comment (`recordChannelUnavailable`) so no fabrication lint fires; `lint:reachability` sees the events consumed (in-app). No test asserts that a Class-B `urgentChannel` event actually reaches a phone.
**Evidence:** `notificationDispatcher.ts:209-227` — `wantsPush`/sms/email legs call `recordChannelUnavailable(...)` and mark delivery `"suppressed"`; header comments (`:11, :26, :55, :296-301`) state "SMS/email/push have NO delivery rail wired here yet (Wave C owns the delivery)". So `agent:escalation` and `approval:requested` (`founderClass:"B"`, `urgentChannel:"sms"`, `:66,:68`) resolve to an in-app row only.
**What's wrong:** Two notification systems coexist: `alertSpine`/`notifyOnCall` (real push+email+ntfy, used by deadman/health/reconciliation) and this event-mesh dispatcher (in-app only; sms/email/push are stubs). Events labeled "urgent" here create the *appearance* of an escalation channel that does not exist. A founder relying on "approval needed" pushing to his phone gets nothing.
**Impact:** Burns trust after sale — an approval/escalation the founder expects to be paged about waits silently in a tray. Not P1 because the genuinely-critical reliability pages use the separate live `alertSpine` path.
**Fix:** Either wire the dispatcher's urgent legs to `pushNotificationService`/`emailService` (Wave C), or route Class-B `urgentChannel` events through `alertSpine.pageCriticalThrottled` at P1 and delete the stub legs.
**Gate it:** Test: any `NOTIFICATION_CONFIG` entry with an `urgentChannel` must have a live delivery rail (fail while the rail is a stub). Baseline: 3 entries (`agent:escalation`, `approval:requested`, `agent:conflict`) declare `urgentChannel` with no rail.
**Effort:** M
**Blast radius:** `notificationDispatcher.ts`.
**Confidence:** high.

---

## Coverage ledger

**Examined exhaustively (read in full):** `server/utils/sentry.ts`, `server/index.ts:40-76` + `660-780` (Sentry/boot/job gating), `server/jobs/backupRestoreVerify.ts`, `server/jobs/jobRegistry.ts`, `server/jobs/deadmanCheck.ts`, `server/jobs/scheduler.ts`, `server/services/alertSpine.ts`, `server/services/oncall.ts`, `server/services/solene/pagerService.ts`, `server/middleware/secretsValidation.ts`, `docs/runbooks/dr-drill-history.md`, `docs/reliability/dr-runbook-postgres-restore.md`, `docs/runbooks/07-database-restore-from-snapshot.md`, `notificationDispatcher.ts` (config + delivery + urgent-channel routing).

**Examined by sampling / grep:** `pushNotificationService.ts:1-120` (VAPID degrade path), `dbBackup.ts` (failure surfacing lines only), `runScheduledJobs.ts:3383-3401` (backup registration), `eventMeshPublisher.ts:108-118`, `autonomousHealthMonitor.ts:490-524`, `jobRuntime.ts:42-91` (withJobLock failure emit), `syntheticChecks.ts` (header + write-probe), `.github/workflows/deploy.yml` (rollback grep — auto-rollback on failed health check confirmed present at `:208-239`), `fly.toml` (`release_command`), `boniface-dr.md` (first 30 lines).

**Did NOT examine:** whether Fly secrets actually provision `SENTRY_DSN` / `DB_BACKUP_S3_BUCKET` / `VAPID_*` / `SOLENE_PAGE_TOPIC` in production (out-of-repo; findings are framed on the ungated *code path*, not a claim the secrets are unset). Did not open the full `runScheduledJobs.ts` (5,848-line god-file) beyond the backup region; did not audit every one of the 118 roster jobs' individual failure paths — F-13-1 is proven at the shared `job:failed` routing layer, which covers all of them. Did not run the app or trigger a live page. Did not deep-read `burnRateMonitor.ts`/`externalStatusMonitor.ts`/`reconciliation.ts` (they use the live `alertSpine` path, out of the failing-backup scope). Client-side `error-boundary.tsx` and `clientLogger.ts` Sentry wiring noted (present) but not exhaustively reviewed.

## Constitution Collisions

None. All findings are reliability/observability gaps; none proposes a new nav entry, a new AI destination, marketplace/API expansion, money-custody change, or fabrication. F-13-1/F-13-2 argue *for* louder honest signals, which aligns with the "refuse-not-fabricate / no fake calm" posture.
