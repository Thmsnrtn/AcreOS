# Salma El-Hadid — Regional Architecture Audit

**Author:** Salma El-Hadid (ex-Cloudflare global infra, ex-Fly.io edge planner)
**Date:** 2026-05-01
**Wave:** 2 of 87-persona AcreOS audit
**Scope:** Where AcreOS runs, where it should run, and the tipping points that force a multi-region migration

---

## 1. One-line verdict

AcreOS is correctly single-region today (`iad`), and should stay that way until **one of three tripwires fires**: (a) a paying Canadian/EU customer signs a contract with a residency clause, (b) a single non-east-coast metro crosses ~150 paying orgs, or (c) the team commits to a sub-99.95% downtime SLA. Until then, multi-region is an expensive distraction — but the **failover plan is the gap that needs fixing this quarter**, not multi-region.

---

## 2. Current regional architecture

What I confirmed by reading the repo (not by inference):

| Layer | Where it runs | Source of truth |
|---|---|---|
| App (Node) | Fly.io `iad` (Ashburn, VA) | `fly.toml` line 2: `primary_region = 'iad'` |
| App machines | 2 warm, performance-2x, 4GB | `fly.toml` lines 19–22, 41–44 |
| Postgres | Fly Postgres, single primary, shared-cpu-2x / 1GB | `project_infra.md` |
| DB read replica | **Code path exists, env unset** | `server/db.ts:54` — `DATABASE_REPLICA_URL` falls back to primary |
| Redis | **Optional, warn-level** | `routes.ts:509` — "REDIS_URL missing → BG jobs and WS pub/sub will not work in multi-instance mode" |
| DNS | Cloudflare (`acreos.io`) | `project_infra.md` |
| Auth | Clerk via `/__clerk` proxy (Cloudflare-conflict workaround) | `project_infra.md` |
| DB backups | S3 (`DB_BACKUP_S3_BUCKET`) — bucket region not asserted in repo | `server/jobs/dbBackup.ts:42` |
| Static assets | Served from the app VM (Vite build → `dist/`) | `script/build.ts`, `server/static.ts` |
| Object storage / user uploads | **No first-party R2/S3/Tigris integration** found in `server/` or `client/` | grep result |

**Read this carefully:** AcreOS has the *plumbing* for a read replica (`dbReadOnly` is exported and consumable), but no replica is currently provisioned. That's a one-flag flip when the time comes — good. It also means today every analytics query, every dashboard hydrate, every cohort scan hits the primary. Fine at current scale, painful at 10x.

---

## 3. Latency map — typical user-to-server RTT

`iad` is in northern Virginia. Round-trip to a Fly.io edge from major US metros:

| User metro | Approx RTT to `iad` | UX feel | Notes |
|---|---|---|---|
| New York / Boston | 10–20 ms | Instant | Best case |
| Atlanta (one of your concentrations) | 20–30 ms | Instant | GA Land Investors are well-served |
| Miami / Tampa (FL concentration) | 30–45 ms | Snappy | Acceptable |
| Dallas / Houston (TX concentration) | 40–55 ms | Snappy | TX is the largest concentration and is *not* well-served, but acceptable |
| Phoenix (AZ concentration) | 60–80 ms | Noticeable on multi-roundtrip flows | Edge of acceptable |
| Denver | 50–70 ms | Snappy | |
| Seattle | 70–90 ms | Noticeable | |
| Los Angeles / SF | 70–95 ms | Noticeable | Worst case domestic |
| Toronto (future CA) | 15–25 ms | Instant | `iad` happens to be great for ON/QC |
| Vancouver (future CA) | 70–90 ms | Noticeable | |
| London (future EU) | 80–95 ms | Noticeable | But residency is the bigger problem, not latency |

**Per-roundtrip cost is not the real story.** A typical AcreOS dashboard load fires ~6–12 sequential or partially-parallel API calls (parcel detail, portfolio stats, AVM, comp tape, etc.). At 80 ms RTT, that's 0.5–1.0 s of *just network*. At 20 ms, it's 100–200 ms. West-coast users feel this as "the app is a little laggy" without being able to articulate why. **The fix isn't multi-region — it's request batching and BFF aggregation** (which is a Mira/Anya conversation, not mine).

The Cloudflare proxy in front of the app does help — TLS terminates close to the user, and the warm Cloudflare→Fly leg is optimized. But the *origin* is still `iad`.

---

## 4. Multi-region readiness — by layer

Where you sit if a Canadian deal forces your hand tomorrow:

### Database — **NOT READY**
- Single primary, no replica provisioned.
- Drizzle code paths split read vs. write (`db` vs. `dbReadOnly`) — good.
- Audit needed: how many call sites use `db` for reads that could safely use `dbReadOnly`? My quick scan suggests **most read paths still use `db` directly** — the split is opt-in. Until that's flipped to opt-out, a replica buys you ~30% relief, not the 70% you'd want.
- Multi-region writes (Fly's read-replica + LiteFS-style fly-replay header) require code awareness of "I tried to write on a replica region, replay me to the primary." AcreOS has zero of this today.

### Cache — **NOT READY**
- Redis is *optional*. The health check warns "REDIS_URL missing → BG jobs and WS pub/sub will not work in multi-instance mode."
- This is the buried landmine. AcreOS already runs 2 machines (`min_machines_running = 2`). If REDIS_URL is genuinely unset in production, the two instances are not coordinating — rate limits are per-instance, idempotency keys are per-instance, WebSocket fan-out is local-only. **Verify this is set in prod before doing anything else regional.**
- For multi-region: Redis would need either (a) regional clusters with no cross-region state, or (b) a single primary with replicas — adds latency to every cache-coordinated operation.

### Assets / CDN — **MOSTLY READY (for the wrong reason)**
- Cloudflare is in front of `acreos.io` — static asset cache will Just Work for the marketing surface and signed-out routes.
- App-bundle assets are served by the Node process from `dist/`. Cloudflare will cache them by URL with the right `Cache-Control` headers. `httpCacheHeaders.ts` exists; I'd want to verify it's setting `immutable` on hashed Vite outputs.
- **Gap:** no first-party object storage. User uploads (parcel photos, signed PDFs from native e-sign, comp imagery) are not in R2/S3 today — which means they're either (a) not implemented yet, or (b) on the app filesystem, which is *catastrophic* for a multi-machine setup. Verify with the e-sign and parcels owners.

### Auth — **READY-ISH**
- Clerk is global by design — their edge handles user sessions worldwide.
- The `/__clerk` proxy is the Cloudflare-conflict workaround. It's a server-side hop, so it adds ~RTT to auth flows but it works.
- **Concern:** the proxy lives inside the `iad` app. A Toronto user authenticating goes Toronto → Cloudflare edge → `iad` → Clerk → back. Adds 30–60 ms vs. direct Clerk. Acceptable.

### Sessions — **READY**
- Clerk-managed JWTs, no server-side session table that I can see. Good for multi-region — JWTs validate locally.
- `CLERK_JWT_KEY` PEM fallback path exists in `clerkAuth.ts` per memory — that means even if Clerk's network is slow from a remote region, JWT verification is local. This is the single best regional decision already made.

---

## 5. Tipping points — when multi-region stops being optional

Concrete signals, in order of likelihood:

1. **Residency contract clause (highest probability, soonest).** First Canadian customer with a procurement team that reads PIPEDA literally. They will ask "where does our data live?" If the answer is "Virginia," you either (a) lose the deal, (b) sign with an indemnity you can't honor, or (c) stand up a `yyz` Postgres in 2 weeks. Probability this happens before single-metro tipping: **~70% within 12 months** given Canadian Land Investor adjacency.

2. **EU expansion (medium probability, 18–24 months).** GDPR is more aggressive than PIPEDA. Standard contractual clauses can paper over a US-hosted tenancy for B2B SaaS, but enterprise EU customers will push for `lhr` or `fra`. Don't pre-build for this; wait for the deal.

3. **Single-metro tipping point — the "100 California customers" question.** My rule of thumb: a metro forces regional presence when *all* of:
   - 100+ paying orgs in the metro AND
   - >40% of those orgs are *active daily* AND
   - p95 user-perceived latency from that metro exceeds 1.5 s on the primary dashboard surface.
   - For AcreOS specifically, with TX/FL/AZ/GA being the concentrations, **`dfw` is the second region to add** if anywhere — not `sjc`. TX is your largest concentration *and* is centrally located for both coast spillover and Mexico-adjacent adjacent personas down the line.

4. **SLA commitment.** The moment a contract says "99.95%" you have ~4.4 hours of downtime/year to play with. A single-region Fly outage (these have happened — `iad` had a multi-hour event in 2024) eats your entire annual budget in one incident. **At 99.9% you can stay single-region with a tested failover. At 99.95% you cannot.**

5. **Compliance frameworks.** SOC 2 Type II doesn't *require* multi-region, but auditors will ask about your DR/BCP plan and a single-region answer with no tested failover will get flagged.

---

## 6. Failover playbook gap

This is the bigger problem than multi-region, and it's solvable in a sprint.

**What happens today if `iad` Fly machines go down:**
- Both app machines are in `iad`. Cloudflare keeps DNS warm but origin is unreachable. Users get 502s.
- Recovery is manual: `flyctl scale count 2 --region ord` (or wherever), wait for boot, hope the migrations release-command doesn't trip.
- Postgres is single-primary in `iad`. If the *Postgres VM* is down (not just app), even spinning up app elsewhere doesn't help — no DB to talk to.
- Backup restore from S3 (`dbBackup.ts`) is the cold path. RTO measured in hours, not minutes. RPO depends on backup cadence (verify — I didn't dig into the cron).

**Concrete gaps:**
- No documented runbook for "iad is down, what do I do." If Thomas is on a plane, nobody on the team has the muscle memory.
- No tested failover. Untested failover ≈ no failover.
- No standby replica in a second region. A `dfw` or `ord` Postgres replica with `flyctl postgres create --replicas` costs maybe $30–60/mo and would cut RTO from hours to ~20 minutes.
- No status page — when `iad` is down, users have no signal except their app being broken.

**What I'd do this quarter (cost: ~1 sprint, ~$50/mo):**
1. Provision a Fly Postgres read replica in `dfw` (TX concentration, geographic diversity from `iad`).
2. Set `DATABASE_REPLICA_URL` and audit which read paths can switch to `dbReadOnly` (the plumbing is already there).
3. Document the failover runbook: how to promote the replica, how to repoint app machines, how to roll DNS.
4. Run a **fire drill** — schedule a Saturday morning, intentionally fail over to the replica, validate the app works, fail back. Until you've done this end-to-end, you don't have a failover plan, you have a *theory*.
5. Stand up a status page (statuspage.io or similar) so customers have a signal that isn't "Twitter."

---

## 7. The migration plan — when we cross a tipping point

When the first tripwire fires, here's the sequenced playbook. Don't do this preemptively; do it the week the trigger event happens.

### Phase 0 — readiness (do this *now*, regardless of tripwire)
- Verify `REDIS_URL` is set in production. If not, this is a P0 — your two-machine setup has silent coordination bugs.
- Provision the `dfw` (or `ord`) read replica per the failover gap above. This is the foundation for *both* failover and multi-region.
- Audit object storage. If user uploads exist on the app filesystem, move to R2 *before* you have two regions.

### Phase 1 — passive standby (triggered by failover SLA need)
- Read replica live in second region.
- App machines optionally added in second region with `auto_start_machines = true` but kept cold.
- Failover is still manual but tested.

### Phase 2 — Canada residency (triggered by first CA enterprise deal)
- Stand up a *separate* `acreos-ca` Fly app in `yyz` with its own Postgres.
- Tenant-shard at the org level: Canadian orgs are routed to the CA app via Cloudflare Workers based on org metadata (or a subdomain like `ca.acreos.io`).
- This is **not** active-active replication — that's a trap. It's tenant isolation. Each org lives in exactly one region. This satisfies PIPEDA and avoids the cross-region-write nightmare.
- Clerk handles auth across both — no change there.

### Phase 3 — read-local, write-primary (triggered by single-metro tipping)
- Add app machines in `dfw` for TX/FL/AZ users.
- They read from a local replica, write back to `iad` primary using Fly's `fly-replay` header pattern.
- This requires server code changes — every write path needs to either (a) detect "I'm not in the primary region" and emit `fly-replay`, or (b) the framework does it. AcreOS today has zero of this. **Budget 2–3 weeks of focused engineering work** for this phase.

### Phase 4 — true multi-master (do not do this)
- I'm including this for completeness. Don't do it. Multi-master Postgres or CRDT-based replication is a 6-month project and a permanent operational tax. AcreOS will not need it within 5 years. If anyone proposes it, push back hard.

### Cost trajectory
- Today: ~$80–150/mo Fly + Postgres.
- Phase 1 (replica + standby): +$50–100/mo.
- Phase 2 (CA region): +$150–250/mo and one quarter of eng work for tenant routing.
- Phase 3 (read-local): +$200–400/mo and one quarter of eng work for write replay.

---

## Summary for the synthesis pass

- **Today is correct.** Single region `iad`, two warm machines, single Postgres. Don't change this for the sake of changing it.
- **The real gap is failover, not multi-region.** A read replica in `dfw` + a tested runbook + a status page is one sprint of work and buys you both DR and the foundation for future multi-region.
- **The first forcing function will be Canadian residency, not latency.** Plan for tenant-sharded regional isolation, not active-active replication.
- **One immediate verify-or-fix:** confirm `REDIS_URL` is actually set in prod. The code treats it as optional and warns at the health check; with `min_machines_running = 2` that warn is a P0 if it's true.
- **Two questions for other personas:**
  - To the e-sign and parcels owners: where do user uploads live today? If "filesystem," that's a Salma blocker.
  - To Anya/Mira on UX latency: west-coast users will benefit more from request batching than from a west-coast region. Worth a measurement pass.
