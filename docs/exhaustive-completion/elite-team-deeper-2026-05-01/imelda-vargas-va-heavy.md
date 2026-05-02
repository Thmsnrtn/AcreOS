# Imelda Vargas — AcreOS user review (VA-heavy solo operator)

I'm 42. Tampa. I close around 150 deals a year, alone — meaning my name is on every contract, my LLC funds every parcel, my account signs every wire. But "alone" is a lie. I have six Filipino virtual assistants in Cebu and Davao who run the engine: Maricel and Dindo on lead-list cleanup and skip tracing, Jenny and Roselyn on inbound seller responses and qualification calls, Marvin on mailer ops, Princess on document prep and closing coordination. They work my night, which is their day. I work my day, which is their night. We hand off twice every twenty-four hours.

I am the bottleneck. They are the engine. Anything that makes them faster, more accountable, or more independent is worth real money to me. Anything that makes me babysit them — review every action, fix every miscategorized lead, re-explain the same workflow on Slack at 11pm — is dead weight. I evaluated AcreOS over three days with this lens. Here is what I found.

---

## 1. Thirty-second verdict

Would I sign up today? **No, not for the team plan. I would sign up for the solo plan and continue using my current stack — Trello plus a shared Google Drive plus a Notion runbook — for VA workflow, because AcreOS does not yet meet the bar for a six-VA shop on three of the four things I need most.**

The product was built by someone who imagined "team" as "three or four U.S.-based partners on the same time zone, all with the same view of margins and decisions." That is not my team. My team is six people who need scoped data access without margin visibility, language-aware UX (English-as-second-language with a translation safety net), per-VA assignment with a real audit trail, and a queue model that survives a 12-hour timezone gap. AcreOS gives me roughly half of what I need and confidently advertises the other half as if it shipped. I caught two surfaces that pretend the work is done — `va-dashboard` and `audit-log` — that under the hood are not what they claim.

I'd revisit in six months if items 2, 3, and 5 below land.

---

## 2. The seven things I need — and what AcreOS actually has

### **(1) A real "VA" role with margin/profit hidden by default.**

My VAs cannot see what I'm willing to pay or what I sold a comparable parcel for. That is non-negotiable. Not because I distrust them — I trust Maricel more than most of my American contractors — but because I refuse to put them in a position where a screenshot leaks and the owner of a $40k-margin parcel learns my pricing model. It's a security perimeter, not a loyalty test.

What AcreOS has: four roles in `server/utils/permissions.ts` — `owner / admin / member / viewer` — with a 22-key `RolePermissions` shape covering create/edit/delete/view per entity and a single `viewOnlyAssignedLeads` boolean. **There is no "VA" role. There is no per-field visibility control. `member` can view all leads, properties, deals, and notes — meaning every margin field, every MAO calculation, every comp-derived `targetPrice` is exposed.** The schema on `team_members` has a `permissions: jsonb()` column (line 125 of `shared/schema.ts`) that *looks* like it would let me add a custom permission set, but `getPermissionsForRole()` ignores it entirely and returns a hardcoded role lookup. The column is dead weight in the schema.

What I'd build, in priority order:
1. A fifth role, `va`, with `viewOnlyAssignedLeads: true`, no export, no import, no delete on any entity, edit-only on assigned leads/properties/notes. Two days to add.
2. A field-level redaction layer on lead/property/deal serializers — when `role === 'va'`, strip `targetPrice`, `mao`, `estimatedMargin`, `comparables[].soldPrice`, `purchasePrice`, `salePrice`, `profitMargin`, `equityEstimate`, and the AVM band. Show a placeholder (`—` or "hidden") so the VA knows the field exists but cannot read it. One week, because every API response needs to pass through the redactor and every test needs a no-leak assertion. This is the work.
3. Wire the existing `permissions: jsonb()` column to the resolver — let me, the org owner, override role defaults per VA. Maricel has been with me three years; I trust her with `canExportData` but not `canViewMargins`. I should be able to grant her one without the other.

The `member` role today is functionally "U.S. business partner with no admin access." It is not a VA role. Pretending it is, is the gap.

### **(2) Per-VA assignment + a queue model that survives the timezone handoff.**

My day starts 8am Tampa, which is 8pm Cebu. Roselyn has been working seller responses since 8am her time and is wrapping up. Jenny is just starting her shift. The leads Roselyn touched but didn't close need to land in Jenny's queue with full context — what was said, what's pending, what the seller asked for that Roselyn promised to follow up on. The leads Jenny opens fresh need to be drawn from a prioritized queue, not picked off a list where Maricel and Marvin and Roselyn have already cherry-picked the easy ones earlier.

What AcreOS has: an `assignedTo` integer column on `leads`, `tasks`, and `deals` (line 347 of `shared/schema.ts`, plus references in tasks/4114). Assignment is a plain pointer. There is no queue surface. There is no round-robin. There is no "next available lead in territory X for skill Y." The assignment is set once, manually, when a lead is created — and unless someone reassigns it, the lead stays glued to whoever got it first regardless of whether they're awake, on shift, or even still on the team.

The `tasks` table has the right shape — `assignedTo` references `teamMembers.id`, `priority`, `status`, `dueDate`, `nextOccurrence` for recurring tasks — but the team-facing UI to *consume* a task queue is `va-dashboard.tsx`, which I'll cover separately. There is no Kanban-style claim/release surface, no auto-assignment based on shift schedule, no "Roselyn is offline, route this to Jenny" rule.

What I'd build:
1. Per-VA shift schedules on `team_members` — `shiftStart`, `shiftEnd`, `timezone` (per-member, not per-org; today timezone is org-level only at line 103 of schema.ts, defaulted to `America/New_York`, which means Cebu time gets mangled in every cron job and date-relative UI). One week.
2. A "lead queue" surface — `/queue/:role` — that pulls unassigned leads filtered by territory, lead-source skill match, and current shift coverage. Click "claim" to assign to yourself and pull the next one. This is what Salesforce calls a "lightning queue" and what Front calls "assigned to me from inbox." It's the right primitive. Two weeks.
3. A handoff rule: when a VA's shift ends, any lead they touched in the last 4 hours but didn't close auto-routes to the queue with a `handoff_note` field populated by the outgoing VA — what was said, what was promised, when to follow up. The shape is identical to a `tasks` row with `entityType=lead, entityId=N, parentTaskId=null, dueDate=now+4h`. Three days once shifts exist.
4. A "next up" widget on the lead detail itself, so when Jenny opens lead 1247, she sees: "Roselyn called this seller 6 hours ago, seller asked us to call back after 7pm Eastern, voicemail left, sentiment positive." Today the `notes` table holds this but it's appended chronologically with no salience model — Jenny has to scroll three pages to find Roselyn's last call.

### **(3) The audit trail — what AcreOS *says* exists vs. what's actually wired.**

This was the most disappointing finding of the audit, because the page sells the capability and the schema sells the capability and neither is what's actually backing it.

What I expected: a real audit trail of every VA action — Maricel updated lead 1247 at 3:14am from IP 122.x in Cebu, changed `phoneNumber` from X to Y, before/after diff captured, ipAddress and userAgent on the row. That is what `shared/schema.ts:4149` describes — the `audit_log` table has `userId`, `action`, `entityType`, `entityId`, a `changes: { before, after, fields }` jsonb, `ipAddress`, `userAgent`, `metadata`, and is keyed to organizationId. That schema is correct. The `/audit-log` page in `client/src/pages/audit-log.tsx` reads from `/api/activity` and renders a table with action, entity, user, and timestamp. CSV export with proper injection defense. Pagination. Entity-type filter. Search. **That surface is real and good.**

What I found broken: the `/va-dashboard` page (`client/src/pages/va-dashboard.tsx`) and its companion `/api/va/audit-trail` endpoint (`server/routes-va-engine.ts:1720`) are a separate, parallel system that **does not write to the `audit_log` table.** They store VA tasks in `organization.settings.va_tasks` — a JSON blob inside the org's settings field. Look at line 1726:

```ts
const tasks: any[] = (orgRecord as any)?.settings?.va_tasks || [];
```

The "audit trail" the VA dashboard renders is a derived view of that JSON blob — it shows task completion records (taskId, title, category, completionNotes, actualMinutes), not who edited which lead at what time. **It is a task-completion log, not an action audit.** A VA could update a lead's phone number, delete a note, mark a deal as dead, and none of that would appear on the VA dashboard's audit trail. It would (theoretically) appear on `/audit-log`, *if* the underlying API routes are calling the audit writer — which I could not verify across the surfaces I tested. I could not find a `logAudit()` or `recordAuditEvent()` call site grepping `server/`. The schema exists. The UI exists. The wiring between them and the actual route handlers I cannot prove exists.

So:
1. **Verify and document which mutating routes write to `audit_log`.** If the answer is "few, sporadically," that's a bug. Every authenticated mutation should pass through an audit middleware that captures actor, action, entity, before/after, IP, UA. Lift it out of route handlers — make it a middleware that reads the route metadata. One sprint.
2. **Stop storing VA tasks in `organization.settings.va_tasks`.** That is fundamentally wrong. The `tasks` table at line 4101 is the right home — it has `assignedTo`, `entityType`, `entityId`, `dueDate`, `recurrenceRule`, and is properly indexed. Migrate. Two days plus a backfill script.
3. **Rename the VA dashboard's "audit trail" to "Task completion log,"** because that's what it is. Reserve "audit trail" for the actual audit log. Words matter when I'm explaining to a buyer's attorney what controls I have over my offshore staff.
4. **Add a "filter by team member" to `/audit-log`** — today the filter is entity-type only. I want "show me everything Maricel did in the last 24 hours" as a one-click view, with an export button. This is one input field and one query parameter. Half a day.

### **(4) Language barrier — English-as-second-language UX.**

Five of my six VAs are fluent in English. Roselyn is conversational but her reading speed on dense UI is half what mine is, and her ability to parse idiomatic error messages ("Hmm, something went sideways — give it a sec") is roughly zero. I have watched her freeze on a Stripe error toast for ninety seconds because she was googling what "sideways" meant in this context.

What AcreOS has: English only. There is no `i18n` library imported (`grep` for `i18n|locale|translation` in `client/src/` returns nothing in `App.tsx` or any config). Every label, every toast, every error, every form-field placeholder is hardcoded English. Many of the toasts use idiomatic phrasing ("workflow draft is still in the form — try again," `va-dashboard.tsx:47`). Some are colloquial. Some are sarcastic. None of this is wrong for a U.S. solo operator. All of it is hostile to my Cebu team.

What I'd ask for, in order of value:
1. A **plain-English mode** flag in user preferences. When enabled, replace idiom with literal — "Workflow not saved. The form is still on screen. Try again." instead of "Your workflow draft is still in the form — try again." This is one switch and one alternate string table per surface. Two weeks for the surfaces my VAs touch (leads, properties, tasks, va-dashboard, organization/members).
2. A real `i18n` integration with at least Filipino/Tagalog as the second locale. Not a v1 expectation — but if AcreOS markets itself to the Land Investor segment, half of that segment runs offshore VAs. This is a known shape. Months 6–12.
3. **Loading-state copy reuse.** Today every page invents its own "Loading…" / "Hmm…" / "Just a moment." Centralize, simplify, and make every string a translation key.

### **(5) Rate-limit and accidental-damage guardrails for VAs.**

My biggest fear is not a malicious VA. It's a tired VA at 4am their time, six hours into a shift, accidentally bulk-deleting 200 leads when the intent was to bulk-archive 20. I want hard stops on bulk destructive actions for non-owner roles.

What AcreOS has: the `member` role today has `canDeleteLeads: false`, which is the right default — VAs can't delete. Good. But: `canEditLeads: true` and there is no concept of "mass edit" guardrails. A single PATCH to `/api/leads/:id` is unbounded. A scripted bulk update is unbounded. The `tasks` page lets me bulk-update task status without a confirmation modal beyond a certain count. The CSV import surface (which `member` doesn't have, fine) is the kind of thing that, if a VA ever did get permission, could overwrite half the database in one upload.

What I want:
1. A "mass change" threshold — any single API call that would mutate >25 records prompts a confirmation step in the UI and writes a `mass_change` audit event with the actor, the count, and the affected IDs. Server-side, not just client-side. Three days.
2. A **soft-delete-only** mode for non-owners. When a VA "deletes" anything (if I ever grant that permission), it goes to a 30-day archive. I, the owner, have to confirm hard delete. The infrastructure for this is partially in `audit_log` (capturing the before-state) but not enforced. One week.
3. An **action rate limit** per-user, per-hour — 200 lead edits/hour is fine, 2000 is suspicious. Today rate limiting (if it exists) is per-IP, which doesn't help me when six VAs share a Cebu coffee-shop wifi during a typhoon.

### **(6) Time-zone-aware everything.**

The org-level `timezone` field (`shared/schema.ts:103`, default `America/New_York`) drives every "Created at," every "Due in 3 hours," every cron-fired campaign send time. My VAs see "Due in 3 hours" and have to mentally subtract 12 hours to know whether that's their lunchtime or their morning. Half the time they get it wrong.

What I want:
1. **Per-user `timezone`** on `team_members` — populated at invite time, editable in profile. Display all times in the viewer's local zone with the org-zone in a tooltip on hover. One sprint.
2. **Shift-aware reminders** — "Due in 3 hours" expressed as "Due 11am your time, today" or "Due 4am your time tomorrow — likely outside your shift." Two days once per-user TZ exists.
3. **The cron jobs themselves** — campaign sends, mailer drops, automated SMS — must respect the *recipient*'s timezone, not the org's. A Tampa-based founder mailing a Texas-based seller does not want the send time skewed by my Cebu VA's local time. This is mostly already correct (the recipient's address determines the geography) but worth a pass.

### **(7) Onboarding / training surface for new VAs.**

When I hire a new VA, I spend six to ten hours over Zoom walking them through Trello, my Notion runbook, my Slack channels, and the three CRMs I have a foot in. I would pay for AcreOS if onboarding a new VA into AcreOS itself took 90 minutes instead of 8 hours.

What AcreOS has: an `OnboardingWizard` (`client/src/components/onboarding/OnboardingWizard.tsx`) and a `ProductTour`, both org-scoped (the founder memory is clear: organizations.onboarding*, not user.onboardedAt). The flow is built for the *founder*. There is no "VA onboarding" track that walks Roselyn through her assigned-leads queue, the lead-update form fields, the task system, and the chat surface — without showing her billing, settings, or the audit log she shouldn't have access to.

What I'd build: a role-aware onboarding mode. When a new `va` role member signs in for the first time, route to a `/onboarding/va` flow that shows the four surfaces they actually use (queue, lead detail, tasks, team chat) with annotated tooltips, a 3-minute video per surface, and a quiz at the end. Three weeks. Pays for itself the first time I hire a seventh VA.

### **(8) Chat / handoff infrastructure.**

I currently run my VA team on Slack — one channel per VA for one-on-ones, one channel for the whole team, one DM with my closing coordinator Princess. AcreOS has `/team-inbox` and a presence system (`/api/team-messaging/presence`, used in `team-dashboard.tsx:81`). I poked at it for an hour.

What works: presence dots (online/away/offline) update on a 30-second poll. The shape is right. There is a websocket service (`server/websocket.ts`) underpinning this.

What's missing for my use case:
1. **Threaded messages on a lead/property/deal.** When Roselyn talks to a seller and wants Jenny's input on whether to soften the offer, the conversation needs to be pinned to lead 1247, not lost in a generic team channel. Today the `notes` table is the closest thing — but notes are for outcomes, not deliberation. A separate `lead_threads` surface, pinned to the entity, mention-able with @username, would replace half my Slack traffic. Two weeks.
2. **"VA on-call" presence.** When a seller calls back at 11pm Tampa time, the system should know which VA is currently on shift and route the inbound to them. This is the same per-user `timezone + shift` data as item (2) above, plus an inbound-routing rule. One week once shifts exist.
3. **A "raise hand" pattern.** When Maricel hits a lead she can't handle (a complex title issue, a hostile owner, a price negotiation that's outside her authority), she needs a one-click "needs founder review" that puts the lead in *my* queue with her notes attached. Today she'd Slack me, I'd open the CRM separately, I'd hunt for the lead. Bad. The shape would be a `tasks` row with `priority=urgent, assignedTo=ownerTeamMemberId, parentTaskId=null, entityType=lead, entityId=N`. Three days.

### **(9) Billing surface — what VAs cannot see.**

A subtler concern: when Maricel logs in, I do not want her seeing my Stripe subscription, my AVM credit balance, or how much I'm spending on data lookups. Today the `member` role has `canManageBilling: false` — good — but the route guard is only on the *settings* surface. The credit-deduction notifications, the AVM-cost banners, the "you've used 47 of 100 lookups this month" warnings appear in the working surfaces (lead detail, AVM page, property enrichment). My VAs would see those even with `member` role.

What I want: a role-gated rendering of every cost-visible UI element. When `role === 'va'`, hide credit banners, hide cost-per-action tooltips, hide the "this lookup will cost $0.50" confirmations. Replace with "this lookup needs founder approval — request access?" with a one-click escalation. One sprint, plus discipline going forward to keep cost UI out of working surfaces.

---

## 3. A day in my life, with AcreOS as it stands today

8:00am Tampa. I open AcreOS. Dashboard shows 47 new leads from last night — Maricel and Marvin's overnight shift output. They're tagged `assignedTo=Maricel.id` or `assignedTo=Marvin.id` from the import — but it's not clear from the dashboard which is which without clicking each one. I'd want a "by assignee" group view on the leads table; the current filter only does status and source.

8:30am. I check `/audit-log`. 312 entries from the night. Filtered by entity type "lead" — still 280. No way to filter by user. I scroll. I cannot tell at a glance whether Roselyn or Maricel touched lead 1247. I open the lead. The notes show "Called seller, voicemail" with a timestamp and a userId I don't recognize — it's Roselyn's Replit user ID, an opaque string. The display name is in there somewhere but the audit log shows only the ID. I have to cross-reference the team-members list. **A "user display name" join on the audit log read endpoint would save me four minutes a day.** Half a day of work.

10am. Princess pings me on Slack — closing on a parcel today, needs the title commitment uploaded. I upload it. I want to assign her the task "review and forward to escrow." The tasks page lets me create one, assign her, set priority, due in 2 hours. Good. But the due-time is in *my* timezone. Princess will see "Due 12pm" and have to mentally convert to her 12am — at which point she's asleep. **The timezone gap costs me real coordination.** This is item (6) above.

3pm. I want to spot-check Roselyn's qualifying calls — she did six this morning. I'd love to filter the audit log to "Roselyn, last 8 hours, lead category." I cannot. I have to scroll the whole audit log and eyeball her ID. **A team-member-detail page with an inline audit feed would solve this.** Three days of work.

6pm. Cebu shift starts. Roselyn comes online. I want to brief her — "two leads from this morning need follow-up tonight, here's what was said." Today I do this in a Slack DM with three pasted links. With a "handoff queue" surface and per-lead threads, this would be one click per lead and a typed sentence. **The reason I'm still on Slack for this is that AcreOS does not yet have the primitive.**

11pm. I sleep. I wake at 7am Tampa. The overnight log is what I need to review. Today I do it lead by lead. With a proper "what changed while I was offline" digest — built on the audit log, scoped to my last-seen-at — I'd review in 8 minutes, not 45. **A "since last login" audit summary widget on the dashboard.** Two days.

Three days of audit, six concrete daily friction points. Fix items 1 through 5 from section 4 and four of those six go away.

---

## 4. What's strong

- The `audit_log` schema is correct. Whoever designed line 4149 knew the shape — actor, action, entity, before/after, IP, UA, metadata. If the wiring is sparse, the foundation isn't the problem.
- The `audit-log.tsx` page is well-built — CSV export with proper injection defense (line 79's neutralization of `=+-@\t\r` leading characters is the kind of detail I notice), pagination, accessible filters. The UI is ready for more data.
- The `tasks` table has the right shape for assignment and recurrence. It's the right home for VA work; somebody just chose to put VA work in `org.settings` instead.
- The `RolePermissions` shape — 22 keys, fine-grained per CRUD per entity — is a good vocabulary. It needs a fifth role and a field-level layer on top, not a redesign.
- The four-role hierarchy is documented in code comments (`shared/schema.ts:124, 137`) — `acquisitions, marketing, finance, member` are mentioned as valid roles even though the resolver only handles `owner/admin/member/viewer`. There is intent here, just unfinished.

---

## 5. What I'd build first if I were on the team

In priority order, treating "ship to a paying VA-heavy customer" as the goal:

1. **Add the `va` role** with the redaction layer for margin fields. Two weeks. This is the unlock for the segment.
2. **Migrate `va_tasks` out of `organization.settings` into the `tasks` table.** One week including backfill. This makes VA work auditable and queryable.
3. **Wire an audit middleware across all mutating routes.** One sprint. Without this, the audit log is theater.
4. **Per-user timezone on team_members.** One sprint. This is the cheapest win for an offshore team and unlocks the shift model.
5. **Rename "VA dashboard" audit trail to "task completion log,"** add a "filter by member" to `/audit-log`, and link from each team-member detail page. One day.
6. **Plain-English mode flag.** Two weeks for the VA-touched surfaces. Foundation for real i18n later.
7. **Lead queue surface with claim/release.** Two weeks. This is the workflow primitive that turns a CRM into a VA-ready system.

That's a quarter of focused work for an engineer who knows the codebase. The result would be a product I'd pay for, and I'd be the kind of customer who refers other VA-heavy operators because the difference is night and day.

Today, I would not. The shape is there. The wiring is not.
