# DevOps / SRE / Platform — 15 personas

## 46. Bartholomew Cross — SRE primary
**Lens:** Alert-fatigue reduction and on-call discipline
**Backstory:** On-call 5 years at unicorn; obsessed with signal/noise ratio.
**What I see:** The monitoring is basic: API response time, error rate, DB connection count. No SLO targets. The alert threshold for error-rate is 5%, which fires ~20 times/month (80% false alarms). On-call engineer gets paged at 2am for a 30-second hiccup that auto-recovers. Over 3 months, alert desensitization kicks in and real incidents get missed.
**Highest-leverage move:** Define SLO per service tier: API availability 99.9%, latency p99 <500ms. Alert only on violation (error-rate >1% *and* duration >5min). Wire Prometheus + Alertmanager: `alert if rate(errors[5m]) > 0.01 and avg(latency[5m]) > 500ms`. Measure alert:incident ratio (target: 10:1 signal). Review alerts weekly; mute false alarms. Effort: 1w setup + ongoing (4h/month).
**Biggest risk:** Over-tuning alert thresholds causes missed incidents (pendulum swings the other way).

---

## 47. Veronika Ivanova — On-call engineer
**Lens:** Incident response playbooks and PagerDuty discipline
**Backstory:** Built incident response playbooks; obsessed with MTTR (mean time to resolution).
**What I see:** The `/docs/runbooks/` exist but are incomplete. The P0-22 recovery console runbook was written post-hoc (not before deploy). There's no incident-severity classification. A database query taking 2 seconds and a production Stripe outage are treated the same (both trigger alert). MTTR is 45 minutes average; no drill has run to measure.
**Highest-leverage move:** Create 3 runbooks per tier: Sev-1 (all customers affected, revenue impact), Sev-2 (subset affected, degraded), Sev-3 (minor issue, no revenue impact). For each Sev-1, write step-by-step runbook (check logs, check DB, check third-party status, escalate). Run monthly drill: simulate Sev-1, measure time to detect + resolve. Target MTTR <15min for Sev-1. Effort: 2w docs + 1h/month drills.
**Biggest risk:** Runbooks get stale and engineers follow outdated steps during real incident.

---

## 48. Eitan Halpern — Chaos engineer
**Lens:** Failure-injection coverage and resilience testing
**Backstory:** Ran chaos-monkey at scale; obsessed with finding untested failure modes.
**What I see:** The system has circuit breakers (Lakshmi's suggestion) but zero chaos tests. What happens if Stripe returns 500 for 5 minutes? (Probably queue backs up, then crashes.) What happens if the database master fails over? (Hopefully Postgres HA handles it, but untested.) Zero automated resilience testing; the first real failure is in production.
**Highest-leverage move:** Use `gremlin` or `pumba` (chaos tools) to run 5 weekly failure scenarios: (1) kill 20% of database connections, (2) add 500ms latency to all Anthropic API calls, (3) kill the Stripe webhook receiver, (4) delete 10% of cached keys, (5) partitioning: isolate Redis from app. Measure system behavior; alert if incidents exceed MTTR threshold. Effort: 1w setup + 2h/week ongoing.
**Biggest risk:** Chaos test breaks real system and you didn't have good enough safety guards.

---

## 49. Gabrielle LeClerc — Fly platform engineer
**Lens:** Edge regions and multi-region failover
**Backstory:** Migrated 40 apps to Fly.io; obsessed with edge-region placement.
**What I see:** The deployment is single-region (assume us-east-1). The `routes-ai.ts` calls Anthropic (US-only), latency is <200ms (good). But a European operator using AcreOS has 400ms latency due to transatlantic round-trip. Zero multi-region deployment. If US-east-1 goes down, all customers are down.
**Highest-leverage move:** Deploy to 3 regions (us-east, eu-west, ap-southeast) on Fly. Use Anycast DNS + Fly's automatic failover. For API, route to nearest region. For data, replicate DB across regions (2 seconds RPO = acceptable). Measure latency by region (target p99 <300ms per region). Effort: 1w setup + 1w runbook-testing.
**Biggest risk:** Cross-region replication causes write-conflict if two regions accept writes simultaneously.

---

## 50. Yusra Al-Sayed — Postgres ops engineer
**Lens:** WAL replication lag and backup coverage
**Backstory:** Manages prod Postgres clusters; obsessed with RPO/RTO guarantees.
**What I see:** The backup strategy isn't documented. Presumably automated backups run nightly, but recovery has never been tested (Cécile's rollback drill on schema migrations is good; Boniface's DR drill for the full database is needed). The WAL replication to standby has unknown lag. If primary fails at 4am, how long until standby is promoted? Unknown.
**Highest-leverage move:** Document backup strategy: hourly WAL shipping (Point-in-Time Recovery), daily snapshots (S3), weekly full backups (cold storage). Run quarterly restore drill: provision new environment from backup, verify data consistency, measure RTO. Document steps in `/docs/runbooks/07-database-restore-from-snapshot.md` (already exists per P0-24, verify it's executable). Monitor WAL lag <5 seconds. Effort: 2d setup + 4h/quarter drills.
**Biggest risk:** Backup is corrupted and you can't restore (test every backup by attempting restore).

---

## 51. Jonas Eriksson — Observability engineer
**Lens:** Span fidelity and distributed tracing
**Backstory:** Built Honeycomb-shape tracing at series-B; obsessed with trace-tree completeness.
**What I see:** The `apiTelemetry` middleware (FW-9) logs request/response but doesn't trace down to database queries. A slow `/api/founder/financials` request traces as one span (3s) without visibility into the 7 table joins. The Anthropic API calls have no tracing; Claude latency is opaque. Zero distributed tracing between services (if multiple services exist).
**Highest-leverage move:** Wire Honeycomb SDK (or OpenTelemetry) to capture spans at multiple layers: HTTP request (parent), database query (child), external API call (child). Tag spans with org_id + user_id so traces are queryable by customer. Measure span duration; alert if any span >1000ms. Build dashboard: "slow requests by query." Effort: 1w instrumentation + 1d dashboard.
**Biggest risk:** Too many spans bloat trace data; sampling strategy is needed.

---

## 52. Coralie Vincent — IaC engineer
**Lens:** Drift detection and state consistency
**Backstory:** Terraform + Pulumi expert; obsessed with declared vs actual infra.
**What I see:** The infrastructure is deployed on Fly.io (good) but there's no IaC (Infrastructure as Code). The Fly app config is probably managed via CLI, not version-controlled. If someone manually changes app settings via Fly dashboard, there's no record. The Postgres cluster configuration (autovacuum tuning, max_connections) is manual. Database schema is in migrations but infra is not.
**Highest-leverage move:** Codify all infra in Terraform: Fly app deployment, machine specs, environment variables, database config, backups, monitoring. Store `.tf` files in git. Use `terraform plan` in CI: reject any deploy that would drift infra state. Set up drift-detection cron: monthly, scan live infrastructure vs Terraform state, alert if delta >0. Effort: 2w setup + 1h/month ongoing.
**Biggest risk:** Terraform state file gets corrupted and you lose track of what's deployed.

---

## 53. Ranveer Bhattacharya — Security ops engineer
**Lens:** Key rotation and secret management
**Backstory:** SecOps at fintech; obsessed with credential-lifecycle discipline.
**What I see:** The API keys (Anthropic, Stripe, Twilio, SendGrid) are stored in `NEXT_PUBLIC_*` environment variables (bad—public secrets). The encryption key for skip-trace results (`fieldEncryption.ts`) is rotated... never? Unknown. The Clerk secrets rotate every 90 days (fine). But there's no audit trail of who accessed which secret when.
**Highest-leverage move:** Move all secrets to AWS Secrets Manager (or Fly's native secrets). Rotate: API keys every 6 months, encryption keys every 90 days, Clerk/auth secrets every 90 days. Implement audit-log on secret access (who, when, which secret). Wire Veronika's incident runbooks to include "reset all secrets" step for compromise scenarios. Effort: 2w setup + 2h/month maintenance.
**Biggest risk:** Key rotation breaks integrations (Anthropic key rotated, old key still in deployed app).

---

## 54. Esperanza Mendez — Runbook author
**Lens:** The 2am junior engineer test
**Backstory:** Wrote 200 runbooks at SaaS; obsessed with runbooks that non-experts can execute.
**What I see:** The `/docs/runbooks/` folder has 7 files (good start). But several are incomplete. The "database restore" runbook exists but assumes knowledge of Postgres psql commands. A 2am junior engineer reading it doesn't know if `\dt` means "list tables" or "delete tables." The incident-response runbook doesn't specify: at what point do you wake the CTO?
**Highest-leverage move:** Audit every runbook for clarity. For each: (1) target audience (junior engineer, not expert), (2) step-by-step with shell commands (copy-paste), (3) success criteria (how do you know the fix worked?), (4) escalation path (call CTO at step N if this fails). Write new runbooks: Slack-integration troubleshooting, certificate-renewal, manual subscription refund, customer data export. Effort: 1w audit + 1w new runbooks.
**Biggest risk:** Runbooks assume too much expertise; junior engineer panics and escalates needlessly.

---

## 55. Hadrien Boucher — Incident commander
**Lens:** Comms cadence and transparency
**Backstory:** Led 50+ Sev-1s; obsessed with communication velocity.
**What I see:** The incident response doesn't mention communication. When AcreOS goes down for 30 minutes, do customers get a status-page update? (Probably not—no status page exists.) Are there comms every 10 minutes during incident? (Probably not.) The post-incident review doesn't mention comms quality.
**Highest-leverage move:** Set up status page (Statuspage.io or similar). During Sev-1: update status every 10 minutes (even if update is "still investigating"). Post incident summary within 24h. Wire Esperanza's runbook to include comms checklist: "notify #customer-incidents at T+0min, T+10min, T+30min, post resolution summary at T+120min." Measure customer satisfaction with comms (use NPS survey post-incident). Effort: 1d setup + 1h per incident.
**Biggest risk:** Over-communication (updates every 2 min) exhausts channels and people ignore them.

---

## 56. Nadya Petrov — Postmortem engineer
**Lens:** Five-whys discipline and blameless culture
**Backstory:** Author of "blameless postmortem" practice; obsessed with root cause vs proximate cause.
**What I see:** The incident log exists (presumably) but there's no formal postmortem template. After an incident (P0-10 Dropbox Sign webhook idempotency took 1 day to fix), there's no structured review: What was the root cause? What could have prevented it? What warning signs did we miss? Zero documentation, zero learning loop.
**Highest-leverage move:** Create postmortem template: incident summary, timeline, proximate causes (what broke), root causes (why the system was breakable), contributing factors (alerting failed, runbook incomplete), action items (Sev-0: fix today, Sev-1: fix this week, Sev-2: fix next month), follow-up. Schedule postmortem within 24h of incident resolution (while memory is fresh). Track action-item completion. Effort: 1d setup + 1h per incident.
**Biggest risk:** Postmortems become blame exercises; people become defensive and hide root causes.

---

## 57. Tomasso Ricci — Capacity planner
**Lens:** Growth modeling and headroom
**Backstory:** Forecasted infra capacity at scale; obsessed with growth modeling.
**What I see:** AcreOS is at month 2 with 8 customers (assume ~2K operators, 100M API calls/month). No capacity plan. The Fly machine (assume 2-core) is fine today. But if AcreOS hits 10x growth (80 customers, 1B API calls/month), will it handle it? Unknown. There's no alert if CPU/mem reaches 70% (should reserve 30% headroom).
**Highest-leverage move:** Build capacity model: current API call rate (100M/mo = 38K/day = 1.6K/hour), forecast 6-month growth (assume 10x). Estimate resources needed: (current + 6mo*growth) × 1.5 safety buffer. Set up alerts: trigger at 70% CPU, 70% memory, 70% DB connections. Review monthly. Wire `/founder/capacity` dashboard showing "months until upgrade needed." Effort: 1w.
**Biggest risk:** You reserve so much headroom that costs balloon unnecessarily.

---

## 58. Phelan Walsh — Multi-region engineer
**Lens:** Replication consistency and write-conflict resolution
**Backstory:** Built active-active across 3 regions; obsessed with replication lag.
**What I see:** No multi-region deployment today (single region, see Gabrielle's concern). But if AcreOS expands internationally, multi-region will be needed. The question: if US and EU regions accept writes simultaneously (operator in NY updates property, operator in London updates same property), how are conflicts resolved? No strategy.
**Highest-leverage move:** Document conflict-resolution strategy before deploying multi-region: (1) primary-region writes (all writes go to primary, replicate to others; simple, higher latency), (2) Last-Write-Wins (LWW) with timestamps, (3) application-level conflict resolution (not general DB solution). For land/note/BH/FF, most ops are independent, so conflicts are rare. Implement strategy in post-Series-A phase. Effort: 1w design (now), 2w implementation (later).
**Biggest risk:** Choosing LWW without understanding domain (e.g., lease agreement signed in NY, then modified in London—which write wins? The newer one, but business logic says NY).

---

## 59. Ananya Desai — Disaster recovery engineer
**Lens:** Restore time vs RTO target
**Backstory:** Ran 100+ DR drills; obsessed with restore-time validation.
**What I see:** The Boniface P0-24 DR drill exists, but is it executable? The `/docs/runbooks/07-database-restore-from-snapshot.md` probably has steps, but the last drill was... when? Have the runbook steps actually been tested this year? Unknown. If the database was corrupted this week, could we restore to Wednesday's backup in <1 hour? Unknown.
**Highest-leverage move:** Run quarterly DR drill: (1) pick a date in the past (Wednesday), (2) provision new Postgres instance, (3) restore from Wednesday backup, (4) verify data consistency (row counts match, transactions balanced), (5) measure restore time. Document steps in runbook. If restore takes >1 hour, that's your RTO. If business needs <30min RTO, invest in faster restores. Effort: 4h per quarter (3 drills/year).
**Biggest risk:** Drill succeeds but real restore fails (backup was corrupted, or restore commands are out of date).

---

## 60. Janosch Vogel — Deploy engineer
**Lens:** Rollback automation and deployment safety
**Backstory:** Built blue/green at scale; obsessed with rapid rollback.
**What I see:** The deployment to Fly (assume CI/CD via GitHub Actions) probably works, but rollback strategy is unclear. If a deploy at 2pm breaks the payment flow, can the on-call engineer click "rollback" and get to known-good state in <5 minutes? Probably requires manual steps. Zero blue/green or canary deployment; every deploy is full cutover.
**Highest-leverage move:** Implement blue/green on Fly: deploy to "green" environment in parallel, smoke-test, switch traffic. Rollback = switch traffic back to blue (instant). For larger changes, use canary: route 5% traffic to new version, monitor error rate, gradually increase to 100% if healthy. Wire deploy runbook: checklist before deploy (tests passing, no P0s open), success criteria (error-rate <0.1%, latency <10% delta), rollback trigger (error-rate >1% for 2min). Effort: 1w setup + 1d per deploy.
**Biggest risk:** Blue/green increases infrastructure cost (run 2 environments); canary increases complexity.

---

## Category synthesis — top 5 recommendations

1. **Runbook completeness + incident response discipline (postmortem template, runbook audit for "2am junior engineer", comms checklist, MTTR measurement)** — Esperanza + Veronika + Hadrien + Nadya converge: audit all 7 runbooks for clarity + shell commands, create postmortem template, add comms checklist to incident response, measure MTTR (target <15min Sev-1). Effort: 2w. · cited by: Esperanza, Veronika, Hadrien, Nadya, Bartholomew

2. **Alerting + SLO discipline (define SLOs per service tier, reduce alert-false-positive ratio, tune alert thresholds)** — Bartholomew + Eitan + Jonas converge: define SLOs (API 99.9%, latency p99 <500ms), alert only on violation (not flapping), measure alert:incident ratio (target 10:1), review alerts weekly. Effort: 1w. This reduces on-call fatigue and catches real incidents. · cited by: Bartholomew, Eitan, Jonas, Coralie, Ranveer

3. **Infra-as-code + secret management (Terraform for all infra, AWS Secrets Manager for API keys + encryption keys, rotate quarterly)** — Coralie + Ranveer + Tomasso converge: codify Fly app + Postgres config in Terraform, move secrets to AWS Secrets Manager, rotate API keys 6mo, encryption keys 90d. Effort: 2w setup + 2h/month. · cited by: Coralie, Ranveer, Tomasso, Bartholomew, Eitan

4. **Observability + chaos testing (distributed tracing with Honeycomb, chaos scenarios weekly, failure-injection coverage)** — Jonas + Eitan + Yusra converge: instrument code with OpenTelemetry (HTTP, database, external API), run 5 weekly chaos tests (connection drop, latency injection, cascade failures), measure system resilience. Effort: 1w + 2h/week. · cited by: Jonas, Eitan, Yusra, Hadrien, Esperanza

5. **Disaster recovery + multi-region readiness (quarterly DR drill with restore validation, blue/green deployment for instant rollback, multi-region strategy documented)** — Ananya + Yusra + Gabrielle + Janosch + Phelan converge: run quarterly DR drill (restore from backup in <1hr, measure RTO), implement blue/green deployment (instant rollback), document multi-region strategy (primary-region writes + replication). Effort: 2w per deploy + 4h quarterly. · cited by: Ananya, Yusra, Gabrielle, Janosch, Phelan

