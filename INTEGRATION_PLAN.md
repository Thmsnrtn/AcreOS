# AcreOS Sovereign Company Protocol — Integration Plan

## Current State Assessment

### What's Built (Phases 1-20)
- **20 protocol phases** committed (v1 through v20 in latest commit)
- **27+ background jobs** running on schedule (lead nurturing, deal hunting, briefings, agent reactions, etc.)
- **10 AI agent personas** (CEO, CFO, VP Sales, etc.) with personality + decision logic
- **29 MCP tools** exposed for property/geo/environmental data
- **WebSocket server** with channel subscriptions and ping/pong
- **Sequence processor** for email/SMS campaign automation
- **Voice AI** call recording + transcription + coaching scores
- **Capacitor** mobile config (iOS/Android) with native plugin declarations

### The Core Problem: 60% Built, 0% Visible

The backend runs autonomously — jobs execute, agents make decisions, events get logged — but **the founder cannot see or control any of it**. There are zero frontend pages for Phases 11-20.

---

## Connectivity Matrix

| Component | Backend | Routes | Frontend UI | Real-Time | Founder Visible |
|-----------|---------|--------|-------------|-----------|-----------------|
| Phases 6-10 | 100% | 100% | 40% | 20% | 30% |
| Phases 11-14 | 40% (stub) | 100% | 0% | 0% | 0% |
| Phases 15-20 | Routes only | 100% | 0% | 0% | 0% |
| Event Mesh | 100% infra | 100% | N/A | 0% | 0% |
| Agent Orchestration | 40% | 100% | 20% | 0% | 20% |
| Job Scheduler | 100% | N/A | 0% | N/A | 0% |
| WebSocket | 100% | 100% | 40% | 60% | 30% |
| Notifications | 20% | 100% | 0% | 0% | 0% |
| Mobile/Capacitor | Config only | N/A | 0% | N/A | 0% |
| MCP Tools | 100% | 100% | 0% | N/A | 0% |
| Voice AI | 60% | 100% | 10% | 0% | 20% |
| Sequences | 100% | 100% | 100% | 5% | 80% |

---

## 5 Critical Gaps (Ordered by Impact)

### Gap 1: No Founder Dashboard for Phases 11-20
- Zero UI pages for: Board of Directors, Financial Authority, Sovereignty Dashboard, Agent Performance, Memory Browser
- Backend data sits in DB tables with no way to surface it

### Gap 2: Event Mesh is Dead Infrastructure
- `eventMeshV12.ts` has publish/subscribe/retry/dead-letter — all built
- **Zero active subscriptions.** No service calls `.publish()`. No background job drains the queue
- Events never reach WebSocket or founder

### Gap 3: Agent Collaboration is Polling, Not Real-Time
- Agents coordinate via DB polling (every 2 minutes via `agentReactionProcessor`)
- No bidirectional conversations, delegation, consensus, or conflict resolution
- v11 has agent negotiation routes but service is stub

### Gap 4: Notifications Don't Exist
- Preference schema stored but **no service reads preferences or sends anything**
- No push notifications (Capacitor plugin declared, never initialized)
- No in-app toasts, no SMS alerts, no email triggers from agent events

### Gap 5: WebSocket Broadcasts Are Incomplete
- Deal Hunter alerts broadcast every 5 minutes ✅
- Morning briefing: generated but NOT pushed ❌
- Agent decisions: logged but NOT broadcast ❌
- Approval requests: NOT pushed to founder ❌
- Job completions: NOT broadcast ❌

---

## Implementation Plan: 5 Phases

### Phase A: Founder Visibility Layer (Priority 1)
**Goal:** Founder can see everything the system does

**New Pages:**
1. `sovereign-dashboard.tsx` — unified org health: agent status, job health, event stream, approval queue
2. `board-of-directors.tsx` — agent negotiation logs, escalations, override history
3. `agent-performance.tsx` — trust scores, revenue attribution per agent, decision accuracy
4. `memory-browser.tsx` — browse episodic/semantic/working memory from v13
5. `job-health.tsx` — which jobs ran, when, success/failure, duration, manual trigger button

**Data Wiring:**
- Each page calls existing v11-v14 API routes
- Add GET endpoints where missing (job health logs, agent message history)
- Add sidebar navigation entries for new pages

### Phase B: Activate Event Mesh (Priority 2)
**Goal:** Business events flow through the system in real-time

**Publishing (add `.publish()` calls):**
- Deal closed → `deal:closed`
- Deal found by Deal Hunter → `deal:discovered`
- Agent decision made → `agent:decision`
- Approval needed → `approval:requested`
- Job completed → `job:completed`
- Revenue milestone → `revenue:milestone`

**Subscribing (register handlers):**
- Event mesh subscriber → WebSocket broadcast
- Event mesh subscriber → notification service (Phase D)
- Event mesh subscriber → agent reaction triggers

**Background Drain:**
- Add `eventMeshDrain` job: every 10 seconds, process pending events, match to subscribers, execute callbacks

**UI:**
- `event-log.tsx` — filterable event stream (channel, type, publisher, timestamp)

### Phase C: Real-Time WebSocket Integration (Priority 2)
**Goal:** Founder gets instant updates without refreshing

**New Broadcasts:**
- Morning briefing generated → push to `user:{founderId}`
- Agent message sent → push to `org:{orgId}` channel
- Approval request created → push to `user:{founderId}`
- Deal discovered → push to `org:{orgId}`
- Job failure → push to `user:{founderId}`

**Frontend Integration:**
- Add `useWebSocket` hook that subscribes to channels on mount
- Dashboard components listen for real-time updates and re-render
- Toast/banner component for urgent notifications

### Phase D: Notification Service (Priority 3)
**Goal:** Founder gets proactive alerts via preferred channels

**Service Implementation:**
1. Read founder preferences from existing `notification_preferences` table
2. Route events to correct channel:
   - **In-app:** Toast notification via WebSocket
   - **Email:** Via existing email service (SendGrid/Postmark)
   - **SMS:** Via Twilio (already configured for voice)
   - **Push:** Via Capacitor PushNotifications plugin

**Notification Triggers:**
- Agent escalation (awaiting approval) → immediate in-app + SMS
- Deal found by Deal Hunter → in-app + email digest
- Revenue milestone reached → in-app + email
- Agent conflict unresolved → in-app + SMS after 30 min
- Job failure → in-app

### Phase E: Agent Collaboration Upgrade (Priority 4)
**Goal:** Agents work together in real-time, not by polling

**Collaboration Model:**
1. Replace 2-minute DB polling with event mesh subscriptions
2. CEO can delegate tasks to other agents via `agent:delegate` event
3. Receiving agent processes task, publishes `agent:result` event
4. CEO receives result, incorporates into decision
5. Consensus: multi-agent voting on strategy decisions
6. Conflict resolution: escalate to founder if agents disagree after 2 rounds

**Founder Override UI:**
- Agent conversation viewer (threaded messages from `agentMessages` table)
- "CEO Override" button — founder can redirect any agent decision
- Override feedback logged and used to adjust agent trust scores (v14 feedback loop)

---

## Implementation Order (What to Build First)

```
Week 1-2:  Phase A — Founder Visibility (5 new pages + data wiring)
Week 3:    Phase B — Event Mesh Activation (publish/subscribe/drain)
Week 3-4:  Phase C — WebSocket Real-Time (broadcasts + frontend hooks)
Week 4-5:  Phase D — Notification Service (preferences → channels)
Week 5-6:  Phase E — Agent Collaboration (delegation, consensus, override)
```

---

## Files to Create

### Frontend (client/src/pages/)
- `sovereign-dashboard.tsx`
- `board-of-directors.tsx`
- `agent-performance.tsx`
- `memory-browser.tsx`
- `job-health.tsx`
- `event-log.tsx`

### Frontend (client/src/hooks/)
- `useWebSocketChannel.ts` — subscribe to WS channels, auto-reconnect
- `useNotificationToast.ts` — display in-app notifications

### Frontend (client/src/components/)
- `AgentConversationViewer.tsx` — threaded agent messages
- `NotificationBanner.tsx` — urgent alerts banner
- `JobHealthTable.tsx` — job run history + manual trigger

### Backend (server/services/)
- `notificationDispatcher.ts` — routes events to email/SMS/push/in-app
- `eventMeshDrain.ts` — background job to process event queue

### Backend (server/routes/)
- Update existing v11-v14 routes with missing GET endpoints
- Add `routes-job-health.ts` for job log viewer API

---

## What NOT to Build (Out of Scope)

- Mobile-native UI (Capacitor wrapping is sufficient for now)
- Offline mode (requires significant architectural changes)
- MCP founder-facing UI (Claude Desktop integration is sufficient)
- A/B testing in sequences (nice-to-have, not critical path)
- Real-time voice coaching (requires streaming ASR, complex)

---

## Success Criteria

When done, the founder should be able to:
1. **See** every agent decision, job execution, and event in real-time
2. **Control** agent behavior via overrides that feed back into learning
3. **Receive** proactive alerts about opportunities and issues
4. **Monitor** system health without checking server logs
5. **Trust** that the 20-phase protocol is actually running and producing results
