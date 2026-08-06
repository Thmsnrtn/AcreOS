# Trace T4 — The Tenant Boundary

**Region state.** The request-path tenant boundary is genuinely strong: `storage.getX(org.id)` is enforced across the AI tool switch, every REST task route fetch-verifies (`getTask(orgId, id)`) before mutating, the `sql.raw` sites in `archival.ts` / `investorStatementBatch.ts` are org-scoped or DB-sourced (no injection, no cross-org read), and `founder-chat/db-ops.ts` is a founder-only gateway with an explicit `organization_id`-in-WHERE guard for writes. The `lint:org-scoped-fetch` ratchet holds the *storage layer* honest.

**The defect class that survives every gate here: org identity that is asserted by the caller and never verified against membership, on paths the org-fetch lint cannot see — WebSocket connections, a process-global notification singleton, and two Pax tool-calls that skip the org argument.** The lint audits storage-method *signatures*; it is blind to call sites that omit the optional org arg and to non-storage lateral paths (WS, singletons). Four independent cross-tenant breaches live in that blind spot. `promptInjection*.test.ts` covers only string-level delimiter/instruction forgery — it never asserts a tool enforces org scope, so none of this is caught.

---

### F-23-1 — WebSocket accepts a client-asserted `orgId`, never checks membership → full cross-org event stream
**Severity:** P0 blocking
**Surfaced by:** T4
**Survives which gates:** No lint touches `server/websocket.ts` (org-fetch lint walks `storage.ts` only). DEFECT-0022 is marked **FIXED** in the registry — but its fix scoped the `subscribe` *handler*; it never addressed the connection's base org identity. WS bypasses all Express auth middleware (raw upgrade on `/ws`). The two `k6-websocket*.js` load tests exercise fan-out, not authorization.
**Evidence:** `server/websocket.ts:142` `const organizationId = parseInt(url.searchParams.get('orgId') || '0')`; `:157` `validateWsSession(req, userId)`; `:47-82` validateWsSession verifies the JWT cookie and asserts `row.id === claimedUserId` **only** — it never checks that `userId` belongs to `organizationId`; `:168-171` the connection auto-subscribes to `org:${organizationId}` from that unverified param; `broadcastToOrg` (`:298`) delivers to every subscriber of `org:{id}`.
**What's wrong:** An attacker uses their **own** valid `__session` cookie and their **own** `userId` but passes `?orgId=<victim>`. validateWsSession passes (their session, their id). `client.organizationId` becomes the victim's, and they are auto-subscribed to `org:<victim>`, receiving every `broadcastToOrg` / `broadcastAgentEvent` event for that org (deals, notifications, agent decisions) in real time. `isAllowedChannel` is moot — it scopes against `client.organizationId`, which is itself attacker-chosen.
**Impact:** Burns trust after sale (cross-tenant real-time data disclosure); any authenticated customer can wiretap any other org. Hurts every customer the moment there are two.
**Fix:** In `validateWsSession`, look up the authenticated user's real `organizationId` (join `users`→membership) and reject the connection if it ≠ the claimed `orgId`; derive `client.organizationId` from the session, never the query param.
**Gate it:** Vitest against `handleConnection`: a session for org A + `?orgId=B` must `ws.close(4003)`. Assert `client.organizationId` is session-derived. Add `server/websocket.ts` to a tenancy lint that flags `searchParams.get('orgId')` feeding a channel name.
**Effort:** M
**Blast radius:** `server/websocket.ts` (handshake); every `broadcastToOrg` consumer inherits the fix.
**Confidence:** high — read the full handshake + validateWsSession; org is never compared.

---

### F-23-2 — `founder:activity` channel open to any authenticated client (DEFECT-0022 residue, still marked FIXED)
**Severity:** P0 blocking
**Surfaced by:** T4
**Survives which gates:** DEFECT-0022's description names `founder:activity` explicitly as the leak and its status is **FIXED** (`docs/audits/defect-registry.md:225-233`). The fix added org-prefix checks for `deal:*/listing:*/negotiation:*` but left `founder:activity` returning `true` unconditionally. No test asserts founder-channel authorization.
**Evidence:** `server/websocket.ts:247-248` — comment says "Founder activity only for founder orgs", code is `if (channel === 'founder:activity') return true;` with **no founder/org check**. `broadcastAgentEvent` (`:342-344`) pushes **every org's** agent events to `founder:activity`; `broadcastFounderEvent` (`:334-335`) pushes founder briefings/approvals there.
**What's wrong:** Any authenticated customer sends `{type:'subscribe', channel:'founder:activity'}`; `isAllowedChannel` returns true; they then receive founder-level events and the agent-event stream of **all** orgs (line 344 fans every org's agent activity to this channel).
**Impact:** Burns trust after sale; cross-tenant + privilege-boundary disclosure to any customer. The registry's FIXED verdict is materially false for this channel.
**Fix:** Gate `founder:activity` on `client.isFounder` (resolve from session, not param). Stop fanning per-org agent events to a shared founder channel, or make founder consumption org-partitioned.
**Gate it:** Test: non-founder subscribe to `founder:activity` is rejected. Re-open DEFECT-0022 or file a follow-on; do not delete the pinning test — rewrite its assertion to include `founder:activity`.
**Effort:** S
**Blast radius:** `server/websocket.ts:248`, `:344`.
**Confidence:** high — the unconditional return is on one line I read.

---

### F-23-3 — Pax `update_task` / `complete_task` tools omit org scope → cross-org task read + write
**Severity:** P0 blocking
**Surfaced by:** T4
**Survives which gates:** `lint:org-scoped-fetch` audits storage-method *bodies*; `tasksRepo.updateTask` **does** mention `organizationId` (`server/storage/tasksRepo.ts:87-95`), so the method passes the lint. The lint's own documented limitation #1 is "a method that ACCEPTS an orgId but forgets to apply the predicate is not caught" — here the *call site* omits the optional arg, which the lint never inspects. `promptInjection*.test.ts` tests string forgery, not tool org-enforcement.
**Evidence:** `server/ai/tools.ts:1507` `const task = await storage.updateTask(args.task_id, taskUpdates);` and `:1513` `storage.updateTask(args.task_id, { status: "completed" })` — no org arg, and (unlike `update_lead_status:1141` / `update_property:1393`) **no `getTask(org.id, …)` precheck**. `tasksRepo.updateTask:88-89` `const conditions=[eq(tasks.id,id)]; if(organizationId) conditions.push(...)` — the org predicate is applied only when passed, and `.returning()` hands the row back, which tools.ts returns as `data.task`.
**What's wrong:** `task_id` is model/user-supplied. A prompt-injected doc or a user in org A ("complete task 50123") makes Pax mutate **any** org's task — and the tool returns that task's title/description/entity back to the caller. Cross-tenant write *and* read. Task ids are sequential integers, so enumeration is trivial.
**Impact:** Burns trust after sale (cross-tenant integrity + confidentiality via the assistant). Reachable without stolen credentials.
**Fix:** Add the org precheck used by every sibling tool: `const t = await storage.getTask(org.id, args.task_id); if(!t) return notFound;` and pass `org.id` to `updateTask`/switch to `storage.completeTask(id, org.id)`.
**Gate it:** Vitest: `executeTool('update_task', {task_id: <orgB task>}, orgA)` returns not-found and mutates nothing. Extend a tool-org-enforcement suite over the whole switch.
**Effort:** S
**Blast radius:** `server/ai/tools.ts` `update_task`, `complete_task`.
**Confidence:** high — read both tool cases, the repo method, and confirmed every REST caller has the precheck these two lack.

---

### F-23-4 — Notification tray served from a process-global singleton with no org filter
**Severity:** P0 blocking
**Surfaced by:** T4
**Survives which gates:** The org-fetch lint never sees this path (it is a service singleton, not a storage method). The endpoints sit behind `isAuthenticated + getOrCreateOrg` (`server/routes.ts:1863`) so they look "protected," but the handler ignores the resolved org entirely. `routes-notifications.ts` only defines `/preferences`, so `/history` and `/unread-count` fall through to the sovereign handlers.
**Evidence:** `server/routes-sovereign-integration.ts:90-110` — `GET /api/notifications/history` → `notificationDispatcher.getNotifications(limit)`, `GET /unread-count` → `getUnreadCount()`, `POST /:id/read` → `markAsRead(id)`; **none pass an org**. `server/services/notificationDispatcher.ts:520` is a module-level singleton; `:110` one shared `store: StoredNotification[]`; `:152` `dispatch()` does `this.store.unshift(notification)` for **every** org's event; `:482-488` `getNotifications` returns `this.store.slice(0,limit)` unfiltered; `:392-400` refresh *merges* (keeps) every in-memory cross-org item. (The DB method `storage.getNotifications(orgId,userId,…)` at `storage.ts:801` **is** org-scoped — the singleton path bypasses it.)
**What's wrong:** Any authenticated customer calling `/api/notifications/history` receives the shared in-memory tray — the founder org's notifications plus every org's dispatched notifications (deal titles, revenue milestones, agent escalation text) since process start. `POST /:id/read` lets them flip any notification's read flag.
**Impact:** Burns trust after sale; cross-tenant disclosure of notification content to any customer.
**Fix:** Route the tray API through the org-scoped DB method: `getNotifications(orgId, userId, limit)` filtered by the caller's org; `markAsRead` must verify the notification's org before writing. Stop treating the singleton store as a global tray.
**Gate it:** Vitest: dispatch for org B, then `getNotifications` as org A returns none. Add a tenancy-lint rule flagging notification tray endpoints whose handler never references `req.organization`.
**Effort:** M
**Blast radius:** `notificationDispatcher.ts` tray API, `routes-sovereign-integration.ts:88-123`.
**Confidence:** high — read the singleton, dispatch, refresh-merge, and the three endpoints.

---

### F-23-5 — `storage.updateTask/deleteTask/completeTask` are org-optional; REST is saved only by upstream prechecks
**Severity:** P2 real
**Surfaced by:** T4
**Survives which gates:** The methods mention `organizationId`, so the org-fetch lint is satisfied even though the predicate is conditional. No gate asserts callers pass it.
**Evidence:** `server/storage/tasksRepo.ts:87-124` — all three apply the org predicate only `if (organizationId)`. Call sites `server/routes.ts:2690/2734/2765` and `routes-crm-extras.ts:309/353/384` omit the org arg but are preceded by `getTask(orgId,id)` (verified safe); `routes-analytics.ts:316` `completeTask(id)` likewise. Only the F-23-3 tool sites lack the precheck.
**What's wrong:** The safety of six REST mutations rests entirely on a hand-written precheck one edit away from omission; the method itself does not fail closed. A future route (or the existing tool path, F-23-3) that skips the precheck silently mutates cross-org.
**Impact:** Neither today (prechecks hold) — a latent trap that becomes a breach on the next careless caller.
**Fix:** Make `organizationId` **required** on these three methods (fail closed) and pass `org.id` at every call site; the tool-path fix in F-23-3 falls out for free.
**Gate it:** Type-level — drop the `?` so `tsc` flags every unscoped caller. Cheapest possible ratchet.
**Effort:** S
**Blast radius:** `tasksRepo.ts` + ~7 call sites.
**Confidence:** high.

---

## Coverage ledger

**Examined exhaustively (read in full):** `server/ai/tools.ts` (all 2,814 lines — every tool case checked for org scope on read, write, and returned payload); `server/websocket.ts` (handshake, validateWsSession, isAllowedChannel, all broadcast methods); `server/services/notificationDispatcher.ts` (singleton, dispatch, refresh, tray API); `server/routes-sovereign-integration.ts` notification endpoints (`_req` ones verified); `server/jobs/archival.ts` (sql.raw DELETE — identifier-whitelisted, ids DB-sourced, cross-org sweep is by-design admin, **no breach**); `server/storage/tasksRepo.ts`; the six REST task call sites.

**Examined by sampling:** `server/services/investorStatementBatch.ts` (sql.raw is org-scoped array construction on both WHERE sides — **no breach**); `server/services/founder-chat/providers/db-ops.ts` (founder-only gateway; write path enforces `organization_id` in WHERE with an explicit `platform_wide:true` escape; **read path is cross-org by design for the founder** — acceptable, not customer-reachable); `scripts/check-org-scoped-fetch.mjs` (read header + baseline to establish the gate's stated blind spots); `promptInjection.test.ts` / `promptInjectionResistance.test.ts` (confirmed they cover string forgery, not tool org-enforcement).

**Did NOT examine:** `server/services/orgDataClear.ts` (listed in charge — not opened; GDPR/data-export delete path unverified for over-deletion across orgs); the connector executor (`server/services/connectors/executor.ts`) org-scoping of the ~16 connector tools (each dispatched with `org` but internal enforcement unread); webhook handlers other than the notification path; `founder-chat/db-ops.ts` reachability/mounting (assumed founder-guarded per orientation, not independently verified); the aggregate/report query surface beyond investor statements; module-level caches other than notificationDispatcher (e.g. aiContextAggregator cache — `invalidateContextCache(org.id)` is keyed by org but the store itself unread).

## Constitution Collisions

None. All findings are tenant-isolation defects; none propose a new nav entry, persona, marketplace/API surface, money-custody change, or AI destination. (Note only: F-23-2 concerns a `listing:*` marketplace channel path that exists in code while marketplace is FREEZE-verdicted — the leak is in the WS auth, not new marketplace surface, so no relitigation.)
