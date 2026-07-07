# Wallis Thorndike — AcreOS vs LaunchDarkly, Honestly

**Persona:** Wallis Thorndike, 47, Brookline MA. Ex-LaunchDarkly platform engineer (2018–2024); now indie consultant. Built the SDK telemetry pipeline at LD; was on the team that wrote the JSON evaluation reason format that everyone copies. I do not love LaunchDarkly the company. I love the *abstraction* LaunchDarkly built. I'm here to read AcreOS's flag system the way I'd read a junior team's first attempt — without grading on a curve, but also without forgetting that AcreOS is one founder, not 200 engineers.
**Wave 3 audit. 2026-05-01.**

I started at `/founder/features`. Five-state machine: `off / founder-only / beta / tier:<x> / on`. That's the right primitive set for a single-tenant SaaS at AcreOS's stage. It is not LaunchDarkly. It is also not pretending to be. The interesting question is: **how far can this carry the product before it has to be rebuilt?**

My read: it carries comfortably to ~1,000 paying orgs and one mid-stakes incident. After that it becomes a liability — but the *seams* are right, and the rebuild is additive, not replace-from-scratch. That's the rare thing.

---

## 1. Thirty-second verdict

The 5-state machine in `server/services/featureFlags.ts:57` is a **clean primitive** with one fatal omission for production: **percentage rollouts**. There is no canary. There is no `"50% of pro-tier users"`. The audience type at `shared/schema.ts:11326` literally has the comment `// Future: orgIds, region, percent rollout, etc.` — the schema *anticipates* the gap and ships without it. That is the single largest delta vs LaunchDarkly and the single hardest thing to retrofit later because every consumer assumes deterministic boolean evaluation today.

Second fatal omission: **no audit trail beyond `changedBy` / `changedAt`**. One row, last-writer-wins. If two founders (or a founder and an admin script) flip the same flag in the same minute, the second write erases the first. There is no `feature_flag_changes` ledger. LaunchDarkly's audit log is half the value of the product for SOC 2 and post-incident review. AcreOS has zero of that today.

Third: **two parallel APIs for the same table.** `/api/feature-flags/admin/:key` (the new 5-state route) and `/api/admin/feature-flags/:key` (the legacy binary route at `routes.ts:1362`) both write to `platform_feature_flags`. The legacy route only takes `{enabled: boolean}` and **doesn't update `state`**, so a founder who hits the old route silently desyncs `state` from `enabled`. I found this in 90 seconds. The `rowToFlag` helper at `featureFlags.ts:44` papers over it (`state ?? (enabled ? "on" : "off")`), but the repair logic only works on read; the underlying row is corrupted.

Beyond those three: the bones are solid. Server-side evaluation, fail-closed semantics, founder bypass for provisioning, defense-in-depth (server middleware + client `<RequireFlag>`), Zod validation on writes, structured logging on flag updates. A surprising amount of LaunchDarkly's discipline is here for a system one person wrote.

---

## 2. The 5-state machine vs LaunchDarkly's targeting model

**LaunchDarkly's model:** flags have *variations* (any number, typed: boolean, string, number, JSON), and *targeting rules* — an ordered list of `(condition → variation)` clauses, with a default rule and a default off-variation. Each rule can target by user attribute (`country == "US"`), segment (named user list), or percentage rollout bucketed by user key. The output is the variation, plus a *reason object* (`{kind: "RULE_MATCH", ruleIndex: 2}`) for debugging.

**AcreOS's model:** one column, one of eight string values, evaluated by a switch statement (`featureFlags.ts:57`). Boolean output. No reason. No variations. No segments. No percentage.

This is not a fair comparison and I am not making it as one. AcreOS's model is appropriate for **module gating** (is the marketplace turned on for this org?) and **rollout staging** (founder → beta cohort → tier → everyone). It is *inappropriate* for **experiments** (does the new offer wizard convert better than the old one?), **kill switches with regional carve-outs** ("disable in EU only"), and **gradual rollouts** ("start at 5% of pro tier, double every 24h until 100%").

The honest framing for AcreOS: **this is a feature-gate system, not a feature-flag system.** Naming it "feature flags" sets expectations the implementation can't meet. I would either (a) rename internally to "feature gates" and add a separate experiment system later, or (b) extend the state model to include percentage rollout *now*, before the consumer count makes it expensive.

The minimum extension to cross the gap to "real" feature flags: add a `percent` field to `audience` (already JSONB), and a deterministic hash bucket — `hash(userId + flagKey) % 100 < percent`. That's 30 lines in `evaluateFlag`. It does not require a schema migration. It would unlock canary deploys for new modules, which is the operationally-most-valuable missing capability today.

---

## 3. Audience targeting — the `betaUserIds` array is a trap

`audience.betaUserIds: string[]` (schema.ts:11327). The UI in `founder/features.tsx:118` parses a CSV string and posts an array. The schema validator caps it at 10,000 (`routes-feature-flags.ts:75`). At 10,000 user IDs, this is fine for the data layout but already wrong for the UX — you do not paste 10,000 IDs into a textbox.

**What's missing:** the concept of a *segment*. LaunchDarkly's segments are reusable named user lists ("Beta Power Users") that flags reference by name. Update the segment, every flag using it picks up the change. AcreOS bakes the user list into each flag, which means:

1. Adding a new beta user to four flags = four PATCH calls = four chances to typo
2. Removing access requires editing every flag the user is in (no "revoke all beta access" button)
3. No way to target by attribute (`tier`, `region`, `signup_date`, `is_internal`, `volume_tier`) without enumerating user IDs

The schema is JSONB so this is extensible without migration. The ergonomic fix is a sibling table `feature_flag_segments(id, name, rule_json)` and an audience type `{segmentId: string}`. Even simpler: support `audience.tierMatches: string[]` and `audience.organizationIds: string[]` as additional fields, evaluated as union with `betaUserIds`. The `evaluateFlag` switch already has the right shape; the audience side is what's anemic.

The enterprise-tier soft-bypass at `featureGate.ts:32` (`if (tier === "enterprise") return next()`) is a smell. The comment says "kept for back-compat with the original featureGate. Future flags should not rely on this." That comment will become a security incident in 18 months when someone forgets and ships an enterprise-only flag that's `state: "tier:scale"` but enterprise also gets it free because of the bypass. **Delete the bypass; backfill the affected flags to `tier:scale`-or-higher logic.** The current state is a pre-paid time bomb.

---

## 4. Performance — evaluation latency is a database round-trip per call

`featureFlagService.isEnabled` at `featureFlags.ts:111` calls `getByKey`, which does a `SELECT ... WHERE key = $1 LIMIT 1` *every single invocation*. There is no cache. The doc comment in the service file claims "Per-request caching keeps DB hits to one read per request" — that comment is **aspirational**; I cannot find the implementation. There is no per-request memo, no LRU, no TTL cache, no Redis read-through.

This means: every API request that goes through `featureGate("feature_marketplace")` adds ~2–8ms (a primary-key indexed lookup over the network) before the actual handler runs. On a route with three flag checks, that's a 6–24ms tax per request. At p99 with a slow Postgres or transient connection blip, this becomes the long-pole.

**LaunchDarkly's bar:** sub-microsecond evaluation. SDKs ship the *entire flag dataset* to the client (server-side SDK polls/streams updates), and evaluation is local — a hashmap lookup plus a switch. That's the model AcreOS should adopt for the server side, not because LD is the gold standard, but because the dataset is tiny (the seed migration shows ~5–10 flags) and it never changes between requests within a normal window.

Concrete fix, ~50 lines: a module-level `Map<string, FeatureFlag>` cache, populated on app start, invalidated on PATCH (and on a 30-second TTL as belt-and-suspenders). The PATCH route already has the new flag value in scope (`featureFlagService.setFlag` returns it) — push it into the cache directly. This eliminates the per-request DB hit and makes flag evaluation effectively free.

The client side does this correctly already (`feature-flags-context.tsx:37`) — fetch once on mount, cache in React context, refetch on explicit `refresh()`. The server is the part that's regressing on its own design.

---

## 5. Kill switches and emergency flips

**The good:** founder can flip any flag to `off` with a single PATCH. The change is durable (DB write) and the next request to a `requireFlag`'d route will return 404. That's a working kill switch for module-level features.

**The bad:** there is no concept of "I broke `/marketplace` 30 seconds ago — flip it off NOW." Specifically:

1. **No CLI / scripted access.** Every flag flip requires logging into `/founder/features`, finding the row, picking the dropdown. If the founder is on a phone in a doctor's office, that's a 90-second incident response. LaunchDarkly has a CLI; AcreOS has zero out-of-band paths. *Easy fix:* a tiny script in `scripts/flag.ts` wrapping the PATCH endpoint with a service-key auth — 20 lines, eliminates the GUI dependency.
2. **No alert on flag flip.** When a flag goes from `on` to `off` in production, nothing fires. No Slack ping, no PagerDuty, no `flag_changed` log line tagged for SIEM. The structured log at `routes-feature-flags.ts:97` writes to logger but is not surfaced. *Easy fix:* webhook or notification provider call inside `setFlag`.
3. **Founder bypass means founder can't test the off state.** `requireFlag` at `featureGate.ts:24` always lets the founder through. If the founder flips a flag to off and then opens the page to confirm it's gone, *they still see it*. They have to switch to a non-founder account. This has caused production confusion at every company I've seen with this pattern. *Easy fix:* `?as=user` query override that suppresses the founder bypass for the current request.
4. **Stale cache between server and client.** Server-side cache (if/when added) and client-side context (`feature-flags-context.tsx`) both need to invalidate on PATCH. The current `refreshGlobal` call in the founder UI handles the *current operator's tab* — it does not invalidate other live tabs or other operators. There is no SSE/WebSocket broadcast of flag changes. For a kill-switch scenario, this means "flag is off in DB, but Mary's still-open tab acts like it's on." LaunchDarkly streams flag updates; AcreOS does not. For the AcreOS user count, polling every 60s in the context provider would close 99% of the gap with one line of `setInterval`.

---

## 6. Audit trail — the `changedBy` / `changedAt` columns are not enough

What's recorded today (`platform_feature_flags` row): the *current* `changedBy` and `changedAt`. That's it. One value, overwritten on every change.

What's needed for SOC 2 and incident review: an append-only ledger. Every flag change writes a row to `feature_flag_changes(id, flag_key, before_state, after_state, before_audience, after_audience, changed_by, changed_at, reason)`. This is ~20 lines of code in `setFlag` (`featureFlags.ts:122`) and one migration. The `reason` field is the load-bearing one — every PATCH should require a string explanation in production, even if it's "rolling out beta" or "incident response — disabling marketplace, ticket #4421."

I'd also add `before_state` to the response of the PATCH endpoint, so operators can paste it into incident reports. Right now the endpoint returns only the new value (`routes-feature-flags.ts:102`) — the operator has to remember what it was before, or query the changes table they don't have.

The `changedBy` field today is a Clerk user ID, not a name (`featureFlags.ts:127` writes `ctx.userId`). For audit purposes that's fine — it's stable — but the founder UI (`founder/features.tsx:267`) shows it raw to the user as `"by user_2abc..."`. Cosmetic, but it makes the audit trail feel half-finished. Resolve to email at render time.

---

## 7. SDK consistency — the client side is adequate, the route gating is not

**Client SDK (`useFlag`, `<RequireFlag>`):** the API in `feature-flags-context.tsx` is the right shape. Single fetch, context-cached, hook-based read, optional render guard. It's idiomatic React. The fail-closed-on-load behavior at line 71 (`return false` until loaded) is correct — better to flash a missing feature than briefly grant access.

**The legacy hook (`hooks/use-feature-flags.ts`):** this is a *second*, parallel implementation that hits a *different* endpoint (`/api/config/features`), has *different* fail semantics (fail-open: `if (!data) return true`), and is used by `layout-sidebar.tsx`. So the sidebar uses one fail-open flag system, and the page bodies use another fail-closed system, and they read from different DB queries. **A user can, today, see a sidebar link to a module they cannot access**, because the sidebar fails open and the route inside fails closed. I would consolidate to one system within a sprint. The right behavior is fail-closed with a skeleton during load, everywhere.

**Route-level gating:** the `controlledRoutes` array on each flag (`schema.ts:11342`) drives sidebar visibility but does not drive the actual route's `requireFlag` middleware. They're set independently. This means flag `feature_marketplace` could control sidebar route `/marketplace` while the API at `/api/marketplace` is gated by a *different* flag key (`module.marketplace` per the seed migration). I see this exact divergence: `routes.ts:1043` uses `feature_marketplace` while `migrations/0029` seeds `module.marketplace`. Different keys. This will silently break someone's first beta launch.

The fix: one canonical flag key per controlled surface, and a startup sanity check (`scripts/validate-flags.ts`) that grep's the codebase for `requireFlag(...)` and `featureGate(...)` calls and asserts every key is in the DB seed. ~30 lines. Catches the desync I just identified, in CI.

---

## 8. Stale flag cleanup — the conversation that hasn't happened yet

Twelve flags exist today (between the two seed migrations). At AcreOS's stage that's manageable by memory. By the time the founder ships v6 the count will be 40. By v8, 80. LaunchDarkly customers regularly hit 500–2,000 flags, and *most of them are dead* — the feature shipped, the flag stayed at `on`, nobody removed the call site. The dead flags accumulate as risk: every one is a place where a future config change can resurrect a half-removed feature.

There is **no stale-flag tooling in AcreOS today.** No "flag age" column. No "last evaluated" timestamp. No grep-the-codebase report that says "this flag has zero references in any source file — safe to delete." The schema doesn't even have a `created_at` to anchor age (it has `createdAt` actually — schema.ts:11343 — I missed it on first read; partial credit).

What I'd ship in week one of caring about this:
1. A founder-dashboard widget: "Flags older than 90 days that are `on` for everyone." These are removal candidates — the rollout is over, the flag is technical debt.
2. A flag-evaluation counter: increment a Redis key per evaluation, sample to a daily aggregate. "Flag X has not been evaluated in 30 days" = it's either dead code or a kill switch waiting in the wings; either way the founder should know.
3. A `flag_lifecycle` enum: `experimental | rollout | permanent | deprecated`. Surfaces intent. A `permanent` flag is a kill switch you keep forever (e.g. `stripe_enabled`). A `rollout` flag is one you delete after `state: on` for 30 days.

None of this is hard. All of it is invisible until you have 80 flags and an audit asks "which of these is load-bearing?"

---

## 9. The DB-error fail-open is a quiet danger

`featureGate.ts:42` — when the DB throws, the middleware calls `next()`. The comment says "DB unavailable — fail open to avoid breaking the app during initial setup." This is the *opposite* of what you want in production. If Postgres is down, every flag-gated route becomes wide open. A Marketplace that's gated to `tier:scale` is suddenly available to everyone on free tier, including unauthenticated users if the route allows it.

The "initial setup" justification is a one-day concern that's been frozen in production code. The right behavior is:

- In `NODE_ENV=development`: fail open with a loud warning log, so local dev isn't blocked.
- In production: fail closed — return 503, let the load balancer health-check fail, let the operator notice.

This is 5 lines. It's also the kind of latent default that turns into a CVE writeup someday. I'd ship the change in a stale Tuesday afternoon, not file a ticket for it.

The same fail-open pattern is mirrored in the storage `getEnabledFeatureFlags` error handler at `routes.ts:332-335` (`return enabled: []` on error → sidebar shows everything because `isRouteEnabled` fails-open on empty). Two places, same anti-pattern. Fix them together.

---

## 10. The `controlledRoutes` JSON column — schema design tax

Each flag carries a `controlled_routes: jsonb[]` column listing the sidebar `href`s it gates (`schema.ts:11342`). It's used by `/api/config/features` to tell the sidebar which routes to render. The data model is wrong in two ways:

1. **It's inverted.** The relationship is many-to-many (a route may be gated by multiple flags; a flag may gate multiple routes), but it's stored as one-way denormalized JSON. There's no integrity constraint linking `controlled_routes` to actual route definitions — a typo silently produces a route nobody can see.
2. **It's the wrong abstraction.** What the sidebar actually wants to know is "should this nav item render for this user?" — which is *exactly* the question `useFlag` answers. The sidebar should evaluate flags by key (`useFlag("feature_marketplace")`), not look up routes by URL.

The current shape exists because the original design wanted the sidebar to work *before login* (the `/api/config/features` endpoint at `routes.ts:326` is mounted before Clerk middleware). That's a real constraint — but it produces a public endpoint that leaks the existence of unannounced features to anyone who hits it. If `feature.atlas-async-jobs` is in `founder-only` state, the public endpoint correctly hides it (it's filtered to `enabled = true`); but the migration seeds it `enabled = false` *and the sidebar correctly hides it as a result*, which is fine until someone sets `state = on` and the route URL leaks before the actual page is announced. Belt-and-suspenders fix: filter the public endpoint to only return flags whose `state` is `on` (not `founder-only`, `beta`, or any tier — those are *private* by definition).

---

## 11. What LaunchDarkly does that AcreOS will eventually want

Listing in priority order, with honest "do you actually need this?" judgments:

- **Percentage rollout with deterministic bucketing.** *Need by Q3.* The hash-bucket trick (`hash(userId + flagKey) % 100 < percent`) is 30 lines and unlocks safe canaries. Without it, every release is "off for everyone or on for everyone" and that's how outages happen.
- **Segments (named user lists with rules).** *Need by 500 customers.* Let the founder define "Power Users" once and reference it from five flags. Schema: one new table; eval logic: one extra branch in the switch.
- **Variations beyond boolean.** *Don't need.* AcreOS doesn't have multivariate experiments. If they do later, do it in a separate `experiments` table with its own SDK.
- **Streaming flag updates (SSE/WebSocket).** *Want by 100 paying orgs.* Polling every 60s in the React context is a 1-line interim. Streaming is a week of work and unnecessary at current scale.
- **Reason objects on evaluation.** *Want for debugging.* When a flag returns false, return *why* — `{enabled: false, reason: "off"}` vs `{enabled: false, reason: "tier_mismatch", required: "pro", got: "starter"}`. Two extra fields on the API response. Saves hours of "why isn't this working for this customer."
- **SDK for non-React clients.** *Don't need.* AcreOS is a Replit-style monolith. There is no mobile app, no third-party integration that needs a flag SDK. Don't build one.
- **Approval workflows on flag changes.** *Don't need.* One operator. Comes back when the team is 5+.
- **Scheduled flag changes.** *Want.* "Flip this flag on at 8 AM EST when I'm asleep." A `scheduled_at` column on the changes ledger and a cron worker is half a day. Useful for marketing-aligned launches.

---

## 12. The five things to ship in the next two weeks

Ranked by leverage, all small:

1. **Delete the legacy `/api/admin/feature-flags/:key` route** (`routes.ts:1362`). It corrupts the `state` column on every write. There is exactly one operator and one UI; consolidate to `routes-feature-flags.ts`. ~10 lines deleted.
2. **Delete the enterprise-tier soft-bypass** (`featureGate.ts:32`). Backfill any affected flags. ~5 lines + audit pass.
3. **Add server-side flag cache.** Module-level Map, invalidate on PATCH, 30s TTL. ~50 lines. Eliminates per-request DB hit.
4. **Add `feature_flag_changes` ledger.** Append-only audit table, write on every `setFlag`. ~30 lines + migration.
5. **Reconcile `useFeatureFlags` (legacy) and `feature-flags-context` (canonical).** Pick one, delete the other, fix the sidebar fail-open behavior. ~half-day of grep-and-replace.

Those five close the largest gaps without inventing new abstractions. The harder work — percentage rollouts, segments, experiment framework — is correctly deferred. The 5-state machine carries the product to GA. What it doesn't survive is the first time the founder needs to flip a flag at 2 AM and audit who did what last Tuesday.

The bones are right. The polish is one engineer-week away.

— Wallis Thorndike, 2026-05-01
