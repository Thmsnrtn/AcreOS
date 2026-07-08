# Sigrún Pálsdóttir — Realtime / WebSocket Audit

**Persona:** Sigrún Pálsdóttir, 41, ex-Stream realtime infra, ex-Pusher channels team. Built fan-out for sports betting (40k concurrent), then chat-as-a-service. Cares about back-pressure, message ordering, presence, and what happens when one Fly machine dies mid-broadcast.

**Wave:** 3 — specialized engineering deep-dive
**Lens:** WebSocket vs SSE vs polling; server scalability; presence; multi-instance pub-sub; reconnection; ordering; subscription patterns.

---

## TL;DR

AcreOS has **a serviceable single-instance WebSocket server** (`server/websocket.ts`) with channel scoping, JWT-validated upgrades, ping/pong liveness, and 31 server-side broadcast call sites. The client side is **two-headed and inconsistent**: a singleton `useRealtime()` hook that the rest of the app composes through, plus a separate ad-hoc `useKpiStream` hook that opens its own WebSocket to the same `/ws` endpoint, doubling connections per dashboard mount. Pax observations use **Server-Sent Events** on a different code path. War Room and Agent Debate Panel — two of the most realtime-shaped surfaces in the product — are **3-second polling loops**. There is **no Redis pub/sub adapter**, which means with `min_machines_running = 2` (Fly.toml line 22), a broadcast emitted on machine A is **invisible to clients connected to machine B**. This is the most important finding in this audit.

---

## What's Wired (WebSocket)

| Surface | Mechanism | Notes |
|---|---|---|
| `notification-banner.tsx` | `useWebSocketChannel("founder:activity")` | Wired correctly, single shared connection |
| `agent-collaboration.tsx` | `useWebSocketChannel("founder:activity")` | Wired |
| `team-messaging` (`message.new`) | `wsServer.broadcastToOrg` from POST handler | Server pushes; client UI in `conversation-tray` does **not** subscribe — falls back to 10s polling (line 274) |
| Deal Hunter matches | `wsServer.broadcastToOrg(orgId, "deal_match", …)` | Server-emitted |
| Negotiation updates | `broadcastNegotiationUpdate` | Server-emitted, no observed client subscriber |
| Marketplace listings | `broadcastListingEvent` | Server-emitted, no observed client subscriber |
| KPI updates | `kpiStreamingService` → `org:{id}` channel | Has its own client hook, second WS connection |
| Nervous system events (`agent.thinking`, `kpi.shifted`, `system.heartbeat`) | `realtimeNervousSystemService.emit()` | Logged to DB *and* broadcast — good for replay |

Server channel naming convention (`websocket.ts` lines 100–106) is sane: `org:{id}`, `user:{id}`, `deal:{orgId:dealId}`, `listing:{orgId:listingId}`, `negotiation:{orgId:sessionId}`, `market:{state}:{county}`, `founder:activity`. **Authorization** in `isAllowedChannel()` (line 231) correctly forces an org prefix on entity channels — a user in org 7 cannot subscribe to `deal:9:123`. This is hardened against IDOR.

---

## What's Wired (SSE)

One SSE endpoint exists: `GET /api/pax/observations/stream` (`routes-ai.ts` line 1752). Used by `pax-copilot-rail.tsx` line 415. Per-org client cap of 10, 25-second heartbeat comments, oldest-evicted on overflow. **The chosen transport is fine** for a uni-directional Pax observation feed — but it's an architectural fork: the same data could ride the existing WebSocket on a `pax:{orgId}` channel and avoid the dual-mechanism cognitive load. `pushObservationSSE` writes through a `(global as any).__paxObsClients` Map, which is **process-local** — same multi-instance hazard as WS broadcasts.

The Pax chat itself (`/api/ai/chat/stream`, `routes-ai.ts` line 384) uses SSE for per-message token streaming. That is the right call — request-scoped, no fan-out — and is unrelated to the realtime infrastructure question.

---

## What's Polled (Should Probably Be Pushed)

| Component | Interval | What it fetches |
|---|---|---|
| `conversation-tray.tsx:274` | 10s | Conversations list |
| `conversation-tray.tsx:473` | 10s | Messages in active conversation |
| `team-general-channel.tsx:53` | 10s | Channel messages |
| `notification-center.tsx:83` | 30s | Notifications |
| `deal-inbox.tsx:320` | 60s | Deal inbox |
| `WarRoom.tsx:113` | **3s** | War room messages while `status === "active"` |
| `AgentDebatePanel.tsx:159` | **5s** | Active debates |
| `useNotificationCount` (`use-realtime.ts:171`) | 60s | Badge count — kept as fallback even when WS connected |

The 3-second War Room poll is the worst offender: every founder-tier user with War Room open hammers the API once per 3 seconds across a query that joins messages + agents. With 100 founders watching debates simultaneously, that's 33 req/s on a panel that **already has WebSocket events** flowing for `agent:thinking` and `agent:consensus_started` from `routes-sovereign-integration.ts`. The push channel exists; the consumer was never wired.

The team-messaging path is the clearest miss: the **server already broadcasts `message.new`** on every send (`routes-team-messaging.ts:270`), but `conversation-tray` keeps its 10s `refetchInterval` instead of subscribing. Two systems doing the same job, the polled one losing.

---

## Multi-Instance Pub/Sub — Critical Finding

`fly.toml`:
```
min_machines_running = 2
auto_start_machines = true
soft_limit = 200; hard_limit = 250  # http_service concurrency
```

`server/websocket.ts` keeps clients in a **process-local** `Map<string, WSClient>`. `broadcast()` iterates that Map. A health-check observation already calls this out (`server/routes.ts:510`):

> "REDIS_URL missing — background jobs and WebSocket pub/sub will not work in multi-instance mode"

**Confirmed:** `REDIS_URL` is referenced for BullMQ in `routes-admin.ts:2511` and validated in `routes-setup.ts:318`, but **`server/websocket.ts` has zero Redis imports**. There is no pub/sub adapter, no `redis.subscribe()` on connection, no `redis.publish()` on broadcast. This means:

- A team message sent on machine A is broadcast only to clients connected to machine A. Founders on machine B see it 10 seconds later via the polling fallback — *and only because the polling fallback exists*.
- KPI updates are stochastically delivered based on which machine the mutating request landed on.
- The `founder:activity` channel — which is the entire premise of the "living dashboard" in `realtimeNervousSystemV10.ts` — fragments along machine boundaries.

This matches Salma's note. The fix is `pub:{channel}` / `sub:*` adapter in `wsServer.broadcast()`: publish to Redis, subscribe in `initialize()`, and have each instance fan out to *its* local clients on receive. Standard pattern, ~80 lines.

---

## Reconnection Logic

`use-realtime.ts:103` — exponential backoff starting at 1000ms, doubling to a `MAX_RECONNECT_DELAY = 30_000`. Reset to 1000 on successful open. **Good.** No jitter (recommend ±20% to avoid thundering herd on Fly machine cycles). `useKpiStream.ts:74` — flat 5-second reconnect with **no backoff**, **no max attempts**, will hammer a downed server forever. Inconsistent with the main hook.

Server-side ping/pong (`websocket.ts:256`) terminates clients that miss 90s pings. 30s ping interval. Reasonable. No `pong` is currently sent in response to a server ping — relies on `ws.on('pong')` callback (line 188) which does fire from the browser's automatic pong response. Verified correct.

---

## Message Ordering & Delivery Guarantees

There are **none**. `broadcast()` is best-effort, in-memory, fire-and-forget. If a client reconnects after a 30-second outage, every event during that window is **lost**. The `realtime_event_log` table (used by `realtimeNervousSystemService.emit`) gives a replay surface, but no client uses it on reconnect. There's no `lastEventId` cursor, no `Last-Event-ID` SSE header support on the Pax stream, no sequence numbers on WS frames.

For the deal/listing/negotiation channels this is probably acceptable (the next mutation will resync). For chat (`team_messages`) and agent debates it is **not** — losing a message in a 3-message debate distorts the record. Recommend: include `eventId` (auto-incrementing per channel) on every WS frame, and on reconnect have the client send `{type: 'subscribe', channel, since: lastEventId}` and the server replays from `realtime_event_log`.

---

## Presence

There is **no presence system**. No `who's online`, no typing indicators, no read receipts, no last-seen timestamps surfaced to UI. `wsServer.getConnectionsForOrg(orgId)` exists internally (line 345) but isn't exposed to clients. For team messaging at the seats-required tier this is a noticeable gap — competitors at this price point ship green dots and "X is typing." Implementation cost is small once the Redis adapter is in: an `org:{id}:presence` set with TTL refreshed on heartbeat.

---

## Auth on the WS Upgrade

`validateWsSession()` (line 47) verifies the Clerk `__session` JWT manually and maps `sub` → `users.id`. Good — the comment on line 39 documents that this validator was missed during the Clerk migration and silently rejected every connection (close code 4003) until repaired. The 30-second clock skew grace is reasonable. **One subtle bug:** `payload.exp * 1000 <= Date.now() - GRACE_PERIOD_MS` — this should be `>=` for the grace period to actually grant *more* time, not less. As written, the grace makes the token expire 30s *earlier*. The intent is clear from the comment but the inequality is inverted.

---

## Connection Cap

`MAX_WS_CONNECTIONS = 1000` per instance (line 111). With 2 machines, 2k concurrent. Soft-limit at 200 HTTP requests doesn't constrain WS. At 10x current scale the cap will bite — but the Fly autoscale should add machines. Important: the cap is checked **after** auth (line 145), meaning a flood of unauthenticated connections still passes the Clerk JWT validation (DB query) before being rejected. Move the cap check **before** `validateWsSession` to avoid the DoS amplification.

---

## Subscription Pattern Quality

The `useWebSocketChannel` wrapper (`use-websocket-channel.ts`) is doing something weird: it listens with `on("*", …)` for wildcard plus a hardcoded list of named events (`notification`, `agent_alert`, `agent_proposal`, `trust_promotion`, `action_executed`, `self_healing_executed`) only when channel === `"founder:activity"`. That hardcoded switch (line 67) means **adding a new event type requires editing the hook**. The wildcard already catches everything via `_type`/`_channel` metadata; the named-event block is dead weight. Recommend deleting lines 67–105.

---

## Recommended Fixes (Priority Order)

1. **Redis pub/sub adapter in `server/websocket.ts`.** Without this, multi-instance Fly is broken-by-design for realtime. ~half-day of work, unblocks everything else. (Critical)
2. **Wire `conversation-tray` and `team-general-channel` to WS.** The events already broadcast; just subscribe to `org:{id}` and invalidate the cache on `message.new`. Drops 10s polling. (High)
3. **Wire War Room and Agent Debate Panel to WS.** Both surfaces have server-side push; client just polls. 3s polling on War Room is a hot path. (High)
4. **Replay-on-reconnect via `realtime_event_log` + `lastEventId`.** Required for chat correctness. (Medium)
5. **Delete second WebSocket connection in `useKpiStream`.** Compose through `useRealtime` like everything else; it's already on the same `/ws` and same auth. (Medium)
6. **Fix the `exp` grace-period inequality.** One-character bug. (Low but trivial)
7. **Move connection-cap check before JWT validation.** DoS hardening. (Low)
8. **Add presence (`org:{id}:presence` set in Redis) once the adapter exists.** (Low — but big UX delta for team-tier)
9. **Fold Pax observations stream into the main WS as `pax:{orgId}`.** Removes dual transports and the parallel `__paxObsClients` Map. (Low)
10. **Delete the hardcoded event switch in `useWebSocketChannel`.** (Trivial)

---

## What I'd Want Before Sign-Off

- A load test: 500 simultaneous WS clients across both Fly machines, measure broadcast delivery rate per machine. Today this would prove the pub/sub gap quantitatively.
- A 60-second network blip simulation on a chat client; verify whether messages sent during the gap appear after reconnect.
- An audit of every `wsServer.broadcast*` call site (31 of them) cross-referenced with whether *any* client actually subscribes. I suspect a third of them broadcast to channels nothing listens on.

---

## Files Referenced

- `/Users/user/AcreOS/AcreOS/server/websocket.ts`
- `/Users/user/AcreOS/AcreOS/server/routes-realtime.ts`
- `/Users/user/AcreOS/AcreOS/server/routes-team-messaging.ts`
- `/Users/user/AcreOS/AcreOS/server/routes-ai.ts` (SSE endpoints, lines 384, 1752)
- `/Users/user/AcreOS/AcreOS/server/services/kpiStreamingService.ts`
- `/Users/user/AcreOS/AcreOS/server/services/realtimeNervousSystemV10.ts`
- `/Users/user/AcreOS/AcreOS/server/services/realtimeAlerts.ts`
- `/Users/user/AcreOS/AcreOS/server/services/eventMeshDrain.ts`
- `/Users/user/AcreOS/AcreOS/client/src/hooks/use-realtime.ts`
- `/Users/user/AcreOS/AcreOS/client/src/hooks/use-websocket-channel.ts`
- `/Users/user/AcreOS/AcreOS/client/src/hooks/use-kpi-stream.ts`
- `/Users/user/AcreOS/AcreOS/client/src/components/conversation-tray.tsx`
- `/Users/user/AcreOS/AcreOS/client/src/components/team-general-channel.tsx`
- `/Users/user/AcreOS/AcreOS/client/src/components/notification-banner.tsx`
- `/Users/user/AcreOS/AcreOS/client/src/components/founder/WarRoom.tsx`
- `/Users/user/AcreOS/AcreOS/client/src/components/founder/AgentDebatePanel.tsx`
- `/Users/user/AcreOS/AcreOS/client/src/components/pax-copilot-rail.tsx`
- `/Users/user/AcreOS/AcreOS/fly.toml`
