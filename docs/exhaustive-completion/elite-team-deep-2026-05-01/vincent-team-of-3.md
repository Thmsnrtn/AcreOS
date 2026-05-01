# Vincent Bauer — AcreOS for a Team of 3

> Tampa, 47, six years in the Land Investing game. 60 deals/year on a 3-person op: me on acquisitions, Maria in Manila on lead intake + skip tracing, Doug (paralegal contractor) on closings. Current stack: REI Pro for CRM, Pebble for mailers, Slack for chatter, Notion for SOPs, Airtable I built myself for the master pipeline. I don't want a fourth tool. I want one tool that replaces three of the above.
>
> Audit window: 2026-05-01. Read Liana's RBAC deep-dive (`liana-rbac.md`) before forming an opinion. Files I poked: `shared/schema.ts` (teamMembers, activityLog, entityComments), `server/routes-comments.ts`, `server/routes-organization.ts`, `server/utils/permissions.ts`, the team components in `client/src/components/`.

---

## 1. Thirty-Second Verdict

AcreOS has the *parts* of a small-team product — there's a `team_members` table with six roles, an `activity_log`, an `entity_comments` table with a `mentions` jsonb, a notification dispatcher, even a websocket server. What it doesn't have is the *contract*. Three of the six roles silently behave as "member." Most mutating endpoints have no role check at all. The `viewOnlyAssignedLeads` flag on the member matrix is decoration — no query honors it. There is no per-record owner enforcement, no approval workflow, no "VA shouldn't see margin" column-level masking. Comments exist as a table; whether they trigger a Slack-style ping in real time is an article of faith.

For me — solo founder + VA + paralegal — that means I can technically add Maria and Doug as seats, but I can't actually delegate. I can't tell Doug "you only see closings I assigned you" and trust the wall. I can't tell Maria "respond to leads but don't see what we paid for the list" and trust the wall. **The roles are theatre.** I'll pay for the seat, I'll set the role, and the next morning Maria will accidentally rename my org because `PATCH /api/organization` has no guard. (Liana's audit, §3 and §8.)

I'd buy this product as a personal CRM today. I won't put my team on it until Liana's day-7 sprint ships.

---

## 2. Daily-Use Walkthrough — 3 People, 1 Day

### 7:30 AM — Maria starts in Manila

She logs in, opens the lead inbox. AcreOS shows her every lead in the org — all 1,800 of them — because `GET /api/leads` ignores the `viewOnlyAssignedLeads` flag (Liana §3). I expected: "her queue, today, sorted by SLA." What she sees: the firehose. She figures out which ones are hers by scrolling for `assignedTo === Maria`. That's a filter I have to teach her to apply every morning. Airtable's view-as-Maria handled this in 2017.

She marks lead #4421 as "Responded — interested, wants $24K." The activity log captures it (`activity_log` row, `action: "updated"`, `changes: { status: { old: "new", new: "responded" } }`). Good. But does *I* see it? There's a websocket server (`server/websocket.ts`), there's a `notificationDispatcher`, there's a `notification-center.tsx` component. Whether the dispatcher actually pushes a "Maria touched a lead" event to my browser or whether I have to refresh the page to see it — undocumented and not provable from the schema. **The infrastructure is there. The wiring is unverified.** If I have to refresh to see what my VA did, I'm back in Slack telling her "ping me when you respond," which is what I'm trying to escape.

### 10:00 AM — I review and approve

Maria's flagged 6 leads as "ready for offer." In my Airtable, this is a view: `status = ready_for_offer AND assigned_to = Maria`. In AcreOS: same, doable via the leads filter. I open lead #4421, want to send the $24K offer. I click "send offer" — and there's no approval gate. The system would send if the button existed for her too. Whether Maria has the offer-send button is a function of (her role) × (whether the endpoint has a `requirePermission` guard), and the endpoint currently doesn't (Liana §3, the deals/lead-AI mutation list). So she *could* send the offer herself if she found the button. I'm relying on UI hiding, not API gating. That's a "VA goes through F12" away from a real problem.

There is no `requiresApproval` flag on offers/deals as a workflow concept. The schema has `requiresApproval` on Pax autonomous actions (line 1605) and on AI agent decisions (line 1888), but not on human-VA-prepared offers. **The handoff is verbal: "Maria, don't send. Tag me when ready."** The product doesn't enforce it. Notion + Slack handles this with a checkbox and an @mention. AcreOS doesn't have the checkbox.

### 1:00 PM — Doug closes a deal

Doug is on a 1099 — paralegal contractor in Sarasota. I want him in AcreOS for closing checklists, document upload, signature tracking. Today: I'd add him as `member` (no other role fits — there's no `paralegal` or `contractor` role; `acquisitions/marketing/finance` all collapse to member per Liana §2). Member can edit deals. Member can rename my org. Member can configure my AI settings. Member can read every lead's notes including the ones where I wrote "John from Acme is being slippery, watch the title work."

There is no role I can assign Doug that says "closings only, read-only on the rest." `viewer` would block the closings work because viewer can't edit. `member` is too broad. The four-pragmatic-roles taxonomy Liana recommends (recommendation 1b in her sprint) doesn't help me here either — I need a fifth concept: scoped contributor. Doug is the canonical case. **This product was scoped for "founder + maybe a VA" and not for "founder + VA + 1099 specialist." That's a 3-person op, which is the *modal* small Land Investing team in Tampa, in Phoenix, in Dallas.**

### 4:00 PM — End of day

I want a daily roll-up: what did Maria do, what did Doug do, what did I do. The `activity_log` has every event (line 1487 — `userId`, `teamMemberId`, `action`, `entityType`, `entityId`, `changes` jsonb diff). There is a `team-dashboard-content.tsx` component. Whether it surfaces "today's activity per teammate" or whether it's stuck on "team performance metrics over time" — I'd need to click through. I don't see a "Maria — 47 actions today: 12 leads responded, 8 status changes, 3 notes" surface. Linear does this. Notion does this. Airtable does this with a row-grouped view. AcreOS has the data; the surface I need isn't obvious.

### 6:00 PM — Doug needs a closing checklist

Doug pings me on Slack: "Vince, where's the title commitment for #4421?" In the world I want, he opens lead #4421 in AcreOS, sees a "Closing" tab with the document tree, the title commitment is uploaded, he marks step 3 complete, and the activity log fires "Doug completed: title commitment review" and I get a ping. In the world I have, Doug doesn't have a login because I haven't figured out how to scope his access without him seeing my margin and renaming my org. So we're on Slack, screen-sharing my Airtable, with him reading me column values out loud. That's 2026.

### 9:00 PM — I review the day

I want a single pane: "All activity, last 24h, grouped by teammate." The activity_log can answer this query in 50ms. There's no surface I can find that renders it as a daily journal. The existing surfaces are: `activity-feed.tsx` (per-record I think), `activity-timeline.tsx` (per-record I think), `team-dashboard-content.tsx` (aggregated metrics, not raw events). What I want is closer to GitHub's contribution timeline: per-person, per-day, scrollable, filterable by entity type. **The data exists. The pane doesn't.**

---

## 3. Friction Per Role

### Maria (VA, Manila — `acquisitions` role attempted)

1. **The role label lies.** I set her to `acquisitions`, the team picker accepts it, the page reloads, the badge says "Member" because `getRoleLabel` doesn't have an `acquisitions` case (Liana §2). I assume the save failed. I save again. Same. I file a support ticket. Support tells me it actually saved fine, the label just doesn't render. That's a 30-minute trust hit on day one.
2. **`viewOnlyAssignedLeads: true` is decoration.** She sees every lead in the org because the storage layer doesn't filter (Liana §3). I have to teach her to apply a filter every login.
3. **No "today's queue" view scoped to her.** She has to build the filter herself. Maria is sharp but she's not going to build a saved view; she's going to email me asking for the URL.
4. **No real-time presence.** I can't see "Maria is online, viewing lead #4421." Slack has it. AcreOS has the websocket plumbing but no presence layer surfaced.
5. **Mailer cost / list cost is visible.** Lead has `acquisitionCost`-style fields (campaign join). She sees them. I don't want her seeing them — not because I distrust her, but because if her account is phished (Liana §4 walks through this exact scenario), my cost basis walks out the door with the credentials.

### Doug (Paralegal contractor, Sarasota — has to be `member`)

1. **No role exists for "external contractor, scoped to closings."** Member is too broad; viewer can't write.
2. **Profit margin visible.** Deal records have `purchasePrice`, `salePrice`, `netProfit` (or composable equivalents). Doug doesn't need to see margin to close a deal. There's no column-level masking. (Liana §5 lists the schema affordances; column masking isn't among them.)
3. **He can rename my org.** `PATCH /api/organization` is unguarded. He won't. But he *can*. (Liana §3.)
4. **He can configure my AI settings.** Same reason. (Liana §3.)
5. **No 1099 / contractor flagging.** `team_members.isActive` is binary. There's no concept of "this teammate is external, log every action they take to a separate compliance feed, expire their access on 2026-08-01." For a paralegal who's helping me through Q3 only, that's the contract I want.

### Me (Vincent, owner)

1. **No real-time activity feed I trust.** I think the websocket pushes some events. I don't think it pushes "Maria changed lead status." So I'm refreshing.
2. **No approvals workflow.** I rely on Slack for "Maria, don't send until I review." When she joins next month and forgets to ping me, an offer goes out at $26K instead of $22K. The product should have caught this. It doesn't.
3. **No mention notifications inside records.** `entity_comments.mentions` is a `jsonb<string[]>` (line 11776) — the column exists, but `routes-comments.ts` is 4 endpoints (GET/POST/DELETE/and one more) with no mention dispatch logic visible. So when Maria writes "@vincent the seller wants more time" in a comment, whether I get pinged is again unverified. The schema column exists; the surface that pings me is unclear.
4. **I can't act-as Maria to QA her workflow.** Liana §3 mentions the founder bypass — but that's for me, AcreOS-the-company, supporting customers. Inside my own org, there's no "view as Maria" mode to validate the wall I built actually walls.
5. **No audit trail surfaced.** The `activity_log` exists (line 1487). `routes-organization.ts:937-941` groups it by team member for performance views. There's no "show me everything Maria did between Apr 1 and Apr 30" report I can find in 2 clicks. For a 1099 contractor's monthly invoice review, I need that.

---

## 4. Per-Record + Per-Row Permissions Gap

The schema has the *bones*: `leads.assignedTo`, `deals.assignedTo`, `tasks.assignedTo`, `properties.assignedTo`, `notes.assignedTo` — all FK to `team_members.id` (Liana §5). What's missing is the *contract*:

| What I want | Schema today | Storage today | Gap |
|---|---|---|---|
| "Maria sees only leads assigned to her" | `assignedTo` column exists | `getLeads` ignores it | Storage filter — Liana sprint item #6 |
| "Doug sees only deals on his closings" | `assignedTo` exists on deals | `getDeals` ignores it | Same |
| "VA can edit notes but not delete them" | No `note.locked` or `note.private` flag | N/A | Schema + storage |
| "Founder writes private deal commentary VA can't read" | No `private` boolean on notes | N/A | 1 column + 1 query change (Liana §5 narrow exception) |
| "Doug doesn't see margin" | No column-level masking | Returns full row | Per-column masking is a project, not a feature |
| "Maria can't see what we paid for the list" | Campaign cost is on `campaigns` table, joined | Joined freely | Same |
| "Doug's access expires Aug 1" | `team_members.isActive` exists; no expiry timestamp | N/A | Schema column + scheduled job |
| "Maria can't see the org's billing email" | Billing email is on `organizations` row | `GET /api/organization` returns full org | Field-level redaction by role |

**Per-record assignment exists as data; not as enforcement.** It's used as a list filter and a group-by key for the team-performance dashboard. It is not a *boundary*. I can assign a lead to Maria, Doug can open it, edit it, change the assignee, delete the assignee — all unguarded.

For my team of 3, the cheap wins (in this order):

1. **Honor `viewOnlyAssignedLeads`.** This is Liana sprint item #6, half a day. After this, Maria's "I see everything" complaint goes away.
2. **`notes.private` boolean.** Half a day. Lets me write candid deal notes the VA can't read.
3. **Role-based column projection on lead/deal reads.** When the requester's role is `member`, strip `acquisitionCost`, `mailerCost`, `netProfit` from the response. 1-2 days. Lets me put Doug and Maria on the platform without exposing margin.
4. **`team_members.expiresAt` column.** Half a day. Lets me 1099 someone for a quarter without the cleanup risk.

Items 3 and 4 are not in Liana's sprint. They should be — they're the difference between "AcreOS is a CRM for me" and "AcreOS is a team product."

---

## 5. What's Missing for Collaboration

Tracing the Slack-replacement claim:

| Capability | Schema | API | UI | Real-time |
|---|---|---|---|---|
| In-record comments | `entity_comments` (line 11769) | `routes-comments.ts` 4 endpoints | `comment-thread.tsx` | Unverified |
| @mentions | `entity_comments.mentions: jsonb<string[]>` | No dispatch logic in `routes-comments.ts` visible | Likely renders | **No ping** — mentionService exists but wiring unclear |
| Activity feed | `activity_log` (line 1487) | Written by mutation routes | `activity-feed.tsx`, `activity-timeline.tsx` | WS server exists; per-event push unverified |
| Approval / handoff | None for human workflows | None | None | None |
| Internal vs external comments | None — no `internal: boolean` | N/A | N/A | N/A |
| Reactions / emoji | None | N/A | N/A | N/A |
| Threaded replies | `entity_comments` is flat — no `parentId` | N/A | N/A | N/A |
| Read receipts | No `lastReadAt` per user per entity | N/A | N/A | N/A |
| Presence (who's viewing this lead) | No surface | N/A | N/A | WS could carry it; doesn't |
| File attachments on comments | `entity_comments` has no file FK | N/A | N/A | N/A |

**Comment thread is flat, no replies, no reactions, no internal/external distinction, no attachments.** Mentions store user IDs in a jsonb but the dispatch path isn't obvious. There is a `mentionService.ts` and a `team_mention` notification kind (line 5042), so the wiring *probably* exists — but for a small team buying this product to escape Slack, "probably" is not enough. I need to test it on day 1 and see Maria's `@vincent` ping me on my phone within 5 seconds. If it doesn't, I'm back on Slack and AcreOS becomes Tool #4 instead of Tool #1.

The deeper miss: there's no concept of **task-on-record with a handoff state machine.** The pattern I need:

1. Maria works lead → marks "ready for offer" → state = `pending_owner_review`
2. AcreOS pings me. I open it. Approve or kick back with comment.
3. Approved → state = `approved`, offer sends. Doug gets a task: "set up closing for #4421."
4. Doug closes → state = `closed`, all three of us see the same record's history.

This is a Linear-flavored workflow on top of leads/deals. AcreOS has `playbooks` (`shared/schema.ts` has playbook tables) and Pax has approval gates (`requiresApproval` on agent actions, line 1605, 1888). What's missing is the **human-team approval primitive that's not Pax-mediated.** A simple "this record needs your sign-off" inbox.

### Notification hygiene — three people, three configs

`notification_preferences` exists as a service (`server/services/notificationPreferences.ts`), there's a notification dispatcher, there's `notification-preferences.tsx` on the client. So the *machinery* for per-user notification config is real. The questions I'd want answered before I onboard my team:

1. Can Maria mute notifications between 8 PM and 8 AM Manila time without missing a critical lead? (timezone-aware quiet hours)
2. Can Doug get pinged only on closing-related events (deal stage changes for deals where `assignedTo === Doug`) and nothing else?
3. Can I get a digest at 7 AM and 6 PM instead of a stream all day?
4. When I @mention someone in a comment, do they get a *channel-aware* ping? (Slack DM if they're @vincent in business hours, email if it's after-hours, push if mobile.)
5. If Maria flags a lead as "needs founder review," is that a different notification class than a routine status change?

I can't answer these without clicking through the surface. The data model implies "yes" to most. The proof is in the QA.

---

## 6. Pricing — $79/mo + 2 Seats

Per the pricing surface I've seen (and Tegan's audit referenced from the elite team folder), the entry tier is around $79/mo for the founder. Two more seats at $25-40 each puts me at $129-159/mo.

**Math from my side:**

- REI Pro: $97/mo solo, +$50/seat = $197 for 3 seats.
- Pebble: ~$0.50/mailer × 4,000/mo = $2,000/mo (this isn't seat-priced, AcreOS doesn't replace it cleanly without a postage cost passthrough).
- Slack: $7.25/seat × 3 = $22/mo.
- Notion: $10/seat × 3 = $30/mo.
- Airtable Team: $20/seat × 3 = $60/mo.

Stack total minus Pebble: $309/mo. AcreOS at $159 *would* save me ~$150/mo if it actually replaced Slack + Notion + Airtable for my team. **Today it replaces none of them with confidence.**

The role taxonomy doesn't enforce — so Airtable's row-level views still beat me there. The comment + mention real-time path is unverified — so Slack still wins. The SOPs surface (academy? playbooks?) isn't where Notion is — so Notion still wins.

**At $159/mo, AcreOS needs to replace at minimum 2 of those 3 cleanly.** The product has the data model to do it. The enforcement and the surfaces aren't there yet.

What I'd actually pay:

- $79/mo solo, today, as a personal CRM. Yes. Already better than REI Pro for me alone.
- $159/mo for 3 seats with the current state of RBAC. **No.** I'd add Maria as a shared login on my account (which I shouldn't do but would) and skip Doug entirely.
- $159/mo *after* Liana's day-7 sprint + the `notes.private` + role-based column projection: yes, immediately, and I'd recommend it to my mastermind group.
- $200/mo for 3 seats with proper handoff/approval workflows: yes, and I'd cancel Slack.

**The pricing is right; the product isn't done enough to charge it for teams yet.**

---

## 7. The Deal-Killer

**The role I assign in the picker doesn't enforce what the role label promises.**

Specifically: I add Maria as `acquisitions`. The badge says "Member" (the label code doesn't know about acquisitions — Liana §2). The active permissions resolve as `member` (the matrix doesn't have an acquisitions row — Liana §2). The `viewOnlyAssignedLeads: true` flag on the member matrix doesn't enforce because the storage layer ignores it (Liana §3). And `PUT /api/leads/:id`, `PATCH /api/organization`, the deal mutations — all unguarded (Liana §3).

So when I tell Maria "you're an acquisitions specialist, you have acquisitions-level access," and she takes me at my word, three things are true at the same time:

1. The system saved her role as `acquisitions`.
2. The UI tells both of us the role is `Member`.
3. Her actual capability is `member` plus every unguarded mutating endpoint, which is most of them.

**That's three different stories for one user. I cannot put a real human on this product and tell them what they can do, because the product itself can't tell them.**

Liana's 1-2 week sprint fixes this. Pick the four-role pragmatic taxonomy (recommendation 1b), gate every mutating endpoint, honor `viewOnlyAssignedLeads`, ship deactivation as a real control, audit invitation accepts. After day 7 of her sprint, the role on the row tells me what the user can do, full stop. That's the contract I need to onboard my team.

Until then, AcreOS is a really good single-player CRM with a multiplayer button that takes my money but doesn't actually let me play with my team.

---

## Closing — Why I'm Still Watching This Product

I've been a Land Investor for six years. I've watched five tools claim to handle teams and three of them go bankrupt because they bolted RBAC on at month 36 instead of month 6. AcreOS has the *bones* — the schema is right, the activity log is right, the comments table is right, the websocket server exists, the notification dispatcher exists. **This is a product that was designed for teams and hasn't finished wiring up the enforcement layer.** That's a fixable problem on a 9-day sprint clock. It is not a "the architecture is wrong" problem.

If Thomas ships Liana's day-7 set, plus `notes.private`, plus role-based column projection on lead/deal reads, plus a 30-second test that proves @mentions ping in real time — I move my team over the same week. My VA, my paralegal, my Airtable, my Slack, my Notion. One bill. One source of truth. The product I've been waiting for since 2020.

If those don't ship in the next 60 days, I stay on REI Pro + Slack + Notion + Airtable, and I check back at the next pricing email.

Make the role tell the truth. Everything else follows.
