# Full Fix Inventory — Strategic 8-Run Cycle 1 Findings

Total findings: 30 (6 CRITICAL, 14 HIGH, 10 MEDIUM). 14 fixes deployed during cycle 1 session.

## Already FIXED in cycle 1 session (do not re-fix)

| ID | Title | Severity | Fix Commit |
|----|-------|----------|------------|
| STR-001 | Notes schema drift → 500 on every auth page | CRITICAL | scripts/migrate.mjs — owning_entity/deleted_at/deleted_by/version added |
| STR-002 | hydrateUser race → 500 burst | CRITICAL | server/auth/clerkAuth.ts — onConflictDoNothing |
| STR-003 | CSRF blocking new-user mutations | CRITICAL | server/middleware/csrf.ts + client/src/lib/csrf-fetch.ts |
| STR-004 | Clerk setActive hydration | HIGH (r1/r2) | client/src/lib/clerk-session-recovery.ts (listener-based) |
| STR-005 | Migrations pipeline | HIGH | fly.toml [deploy].release_command |
| STR-006 | CI broken | HIGH | .npmrc + deploy.yml |
| STR-012 | /api/ai timeout at 30s | HIGH | server/middleware/security.ts — 90s for /api/ai |

## Still OPEN

### CRITICAL (3 open)

| ID | Title | Source Runs | Effort | Class |
|----|-------|-------------|--------|-------|
| STR-011 | Clerk client.sessions empties on client-side nav | r2, r3, r4, r5 | 2hr | CODE |
| STR-015 | LOB_LIVE_API_KEY/LOB_TEST_API_KEY unconfigured | r4 | 5min | CONFIG |
| STR-023 | /api/properties/by-location returns 500 | r6 | 1hr | CODE |
| STR-016 | /api/ai/chat 500 regression after STR-012 deploy | r4 | 30min | CODE |

### HIGH (10 open — 4 in cycle 1 were fixed, see above)

| ID | Title | Source Runs | Effort | Class | Blocking |
|----|-------|-------------|--------|-------|----------|
| STR-007 | /api/user returns 404 (client calls wrong path) | r1 | 15min | CODE | LAUNCH |
| STR-013 | /api/counties returns 404 | r4 | 1hr | CODE | RERUN (r4) |
| STR-014 | /api/direct-mail/templates returns 404 | r4 | 30min | CODE | RERUN (r4) |
| STR-017 | /api/fema/flood-zone returns 404 | r7 | 1hr | CODE | RERUN (r7) |
| STR-018 | /api/due-diligence returns 404 | r7 | 30min | CODE | RERUN (r7) |
| STR-020 | Server trusts client monthlyPayment on note create | r8 | 30min | CODE | LAUNCH |
| STR-024 | /api/geocode/reverse 404 | r6 | 30min | CODE | RERUN (r6) |
| STR-025 | /api/parcels/search 404 | r6 | 1hr | CODE | RERUN (r6) |
| UX-001 | Tagline drift ("real estate professionals") | r1, r5 | 15min | COPY | LAUNCH |
| UX-004 | "APN" used without explanation | r5 | 15min | COPY | LAUNCH |

### MEDIUM (10 open)

| ID | Title | Source Runs | Effort | Class |
|----|-------|-------------|--------|-------|
| STR-008 | Pax endpoints 429 on warmup | r1 | 30min | CODE |
| STR-009 | /api/analytics/session/start + /api/telemetry 403 | r1 | 30min | CODE |
| STR-010 | Silent mutation failure (no user-visible toast) | r1 | 1hr | CODE |
| STR-019 | DD checklist not auto-seeded on property create | r7 | 30min | CODE |
| STR-021 | No amortization preview endpoint | r8 | 45min | CODE |
| STR-022 | /api/getting-started/checklist 404 | r5 | 15min | CODE |
| UX-002 | Auto-generated "E2E's Organization" greeting | r1 | 15min | COPY |
| UX-003 | No "build list from county data" flow from empty state | r2 | 1hr | UX |
| UX-005 | Persona-amplified UX-002 | r5 | (dup) | COPY |
| AI-001 | Pax tone leans motivational / sales-y | r3 | 30min | COPY (prompt) |
| AI-002 | Pax lacks uncertainty markers / attribution | r3 | 30min | COPY (prompt) |

## Total effort estimate

- CRITICAL open: ~3.5 hours
- HIGH open: ~6.5 hours
- MEDIUM open: ~6 hours
- **Subtotal: ~16 hours of fix work**
- Plus Phase 8 re-runs (8 personas × ~30min each with browser stability issues): ~4-6 hours
- **Total cycle: ~20-22 hours**

## WARNING

Total fix effort estimated at ~16 hours (excluding re-runs). Multi-session
resume expected. This session only finishes inventory + minor fixes before
checkpointing.

## Priority queue for next session

1. STR-016 (30min, CODE) — this is my regression from the STR-012 deploy in cycle 1. Fix first to validate /api/ai/chat works, which unblocks Pax quality testing in cycle 2.
2. STR-015 (5min, CONFIG) — operator action: `flyctl secrets set LOB_TEST_API_KEY=<key>`. Ship a test key for free.
3. STR-023 (1hr, CODE) — read route handler, check DB query, fix.
4. STR-011 (2hr, CODE) — needs Clerk proxy investigation; check `/__clerk/v1/client` response.
5. All HIGH BLOCKING-RERUN items (STR-013/014/017/018/024/025, total ~4hr).
6. Remaining HIGH + MEDIUM in rough effort order.

## Notes for the resumer

- CSRF auto-attachment is already deployed (client/src/lib/csrf-fetch.ts + apiRequest). You can POST to mutation endpoints from authed sessions with no extra scaffolding.
- Clerk session auth via API: `POST https://api.clerk.com/v1/sessions/<sess_id>/tokens` with `{}` gives you a JWT to use as `__session` cookie. Use `user_3CaZCrUqwtHueUi1bdSgyxkHQV3` as the test user.
- fly.toml release_command runs `scripts/migrate.mjs` on every deploy — safe to add more idempotent ALTER TABLE statements there for schema patches.
- Test user currently has org id 2 with 1 property (APN 301-45-678 Cochise AZ — created during cycle 2 test) and 1 note (id=1, $20k/10%/84mo).
