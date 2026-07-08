# Tobias Wheeler — AcreOS, after the stroke

I'm Tobias. I'm 56. I've bought and held land in western Pennsylvania for almost twenty years — small acreage, mineral splits, a couple of hunting parcels I lease out. Eighteen months ago I had what the neurologist called a "minor" stroke. The body came back fast. The head is slower. I read fine, but it takes me longer. Words sometimes go missing for a beat — I'll know exactly what I mean and have to wait for the noun to surface. Multi-step processes — the kind where you have to hold three things in your head while doing a fourth — those are the ones that still trip me. I am the customer who proves whether your product is *legible* or only *clever.*

This audit is about cognitive load. Everything Wendell calls "dense" lands on me as "impossible." Everything Cesar calls "elegant" I might call "where did the button go." I am not asking you to dumb the product down. I am asking you to make it survivable for a brain that gets one fewer free retry than it used to.

---

## 1. Thirty-second verdict

AcreOS works for me on a good day and fails me on a bad one. The dashboard, the parcel detail, the offer wizard — all built for somebody whose working memory is intact and whose word-retrieval is instant. There is no mode, no toggle, no setting that says *"I need a little more time and a little less density."* The closest the product comes to acknowledging me is the accessibility checklist in `CLAUDE.md` (focus rings, aria-labels, label-input pairing) — which is correct and important and *not what cognitive accessibility is.* WCAG AA on color contrast does not help me when a wizard advances on a click I didn't mean to make.

Three things would change my experience entirely:
1. **Undo on everything.** Not on bulk-delete (that one's solved — `safe-bulk-delete-dialog.tsx` is exactly right) — on the *single* destructive action that I'm 90% likely to misclick.
2. **Save-on-blur, everywhere a form lives.** I cannot tell you how many times I've drafted half an offer, opened a tab to look up a county code, come back, and found my work gone.
3. **Confirmation copy that tells me what I'm about to break.** "Are you sure?" tells me nothing. "This will email 47 sellers and cannot be recalled" tells me everything.

Six weeks of work. Outsized impact. Not just for stroke survivors — for tired investors, distracted ones, parents working between school pickups, every user on a bad night.

---

## 2. A Tuesday in March — what a normal session feels like

**9:00 AM.** I open `/dashboard`. I count the regions: pulse score, morning brief, decision queue, deal-flow metrics, agent activity, recent leads, county heatmap, AI request budget. Eight things competing for my eye. On a good morning I parse it in fifteen seconds. On a bad morning I sit there for two minutes trying to figure out where to look first. **The dashboard has no visual hierarchy that says "start here."** Wendell can flick his eyes across it. I cannot. A "primary action" zone — *one* thing the system recommends I do today, large, top-left, with a clear verb — would let me start.

**9:20 AM.** I'm reviewing a lead in `/leads/4421`. I update the seller's phone number — old one was disconnected. I tab away to look up the county recorder. I come back. **The phone field has reverted.** I had typed it in but never clicked Save. There is no save-on-blur. There is no autosave indicator. There is no "you have unsaved changes" banner. I lost three minutes and the seller's number, which I had to find again. This happens to me roughly twice a week. *This is the single highest-impact bug in the product for cognitive-impaired users and it is not classified as a bug.*

**10:00 AM.** I open the `/offer-wizard` for a parcel in Indiana County. Five steps. Each step has a Next button. The Next button is enabled the moment the step renders, before I've filled anything in. I miss-click — my hand twitched, or I meant to click the field next to it — and now I'm on step 2 with empty data on step 1, and I don't know whether step 1 saved blank or kept the defaults. **Wizards must not advance without an explicit completion signal, and the Next button must not be the same visual weight as the field controls.** Make Next a primary button bottom-right; make the field controls neutral. Right now they're both blue.

**11:00 AM.** I want to delete a duplicate lead. I click the trash icon. A confirmation dialog appears: *"Are you sure you want to delete this lead?"* — Cancel / Delete. I click Delete. The lead is gone. **This is the wrong dialog.** It told me nothing I didn't already know. What I needed: *"Deleting this lead will also remove 3 notes, 1 task, and 1 attached document. The lead will move to Trash and can be restored within 30 days."* Same click count, exponentially more legible. The product has the data — it just doesn't show it.

**12:30 PM.** Lunch. I come back. I'm logged out. **My session expired during a 45-minute lunch.** I have to log in through the Clerk proxy again, two-factor, the works. For an investor who's a knowledge worker doing 12 things in parallel, fine. For me, an hour of context I had loaded in my head is gone. I had to re-find the parcel I was looking at. Session lifetime needs to be longer for users who opt in — or the product needs to *resume* where I was, with a one-click "pick up where you left off" affordance. Right now it dumps me on `/dashboard` and I have to retrace.

**2:00 PM.** I try the campaigns surface — `/campaigns`. I'm building a postcard mailer. There are tabs for Audience, Template, Schedule, Send. I click Send by accident before the schedule is set. **I get a confirmation that says "Send 47 postcards now?"** I click Cancel, but my heart's already in my throat. This is the kind of moment where on a bad day I would have clicked Confirm out of pure inertia. The Send button needs to be physically far from the back-and-forth navigation, not adjacent to the Schedule tab. Better still: Send should require a *typed* confirmation ("Type SEND to confirm") for any irreversible bulk action over a threshold (say, 25 recipients). That friction is the right friction for me. Wendell will grumble at it once and never notice it again.

**3:30 PM.** I close the laptop. I got two things done. Two years ago I'd have done eight.

---

## 3. The cognitive-load inventory

What costs me the most, ranked by frequency:

1. **Lost work from no save-on-blur.** Several times a week. (Forms in leads, parcels, notes, tasks, deal underwrite, offer wizard, settings.)
2. **No undo on single-row destructive actions.** Trash → confirm → gone. The bulk path has Undo (good); the single-row path doesn't.
3. **Wizards that advance without explicit completion.** Offer wizard, onboarding wizard, campaign builder, deal wizard.
4. **Confirmation dialogs that don't say what's about to happen.** Generic "Are you sure?" copy treats me like the consequence is unknowable, when the system knows it perfectly.
5. **Session timeouts during long thinking pauses.** Lunch, phone calls, looking up county codes — anything over 30 minutes.
6. **Dense dashboards with no recommended starting point.** Eight regions, no "begin here."
7. **Parallel-when-it-should-be-sequential workflows.** I want to do task A, then task B, then task C. The product wants me to choose any order, and on a foggy morning I freeze.
8. **Word choices that assume domain fluency.** "Comp," "buy-box," "DD," "earnest," "1031" — I know these words. On a bad morning I have to *retrieve* them. Tooltips on first reference (per session, not per page) would help.
9. **Toasts that vanish.** A success toast that disappears after 4 seconds is a success toast I missed. Make it dismissable, log the message in a notification tray, and let me check what just happened.
10. **Inline error messages that appear above the field instead of below it, where my eyes are.** Standard form-design issue, but a cognitive-load multiplier.

---

## 4. Undo — what's there, what isn't

Good news first: `client/src/components/safe-bulk-delete-dialog.tsx` is *the* model. It has:
- A pre-flight summary of what's about to be deleted
- A typed-confirmation step for large batches
- An Undo button on the success toast
- A 30-day Trash with explicit restore
- An aria-label that reads naturally with a screen reader

That pattern needs to ride on every destructive single-row action in the product. Today it doesn't. Spot-checks:

- **Lead detail → delete** — confirms but does not Trash; once gone, gone.
- **Note delete** — silent delete, no confirmation, no undo. *Particularly hostile* because notes are exactly the kind of thing I might delete by accident on a bad day.
- **Task complete → undo** — completing a task is destructive in the sense that it leaves my queue. There's no "I completed that wrong, restore it." Manual re-creation only.
- **Offer cancel** — once an offer is canceled, it's archived in a tab I have to dig for. Should be one click to revive.
- **Campaign pause / archive** — paused is fine, archived is hard to recover.

The fix is one shared pattern: a `useUndoableMutation` hook that shows the action's success toast with an Undo button for 10 seconds, and a Trash table for anything that bypasses the toast window. The infra is half-built (the bulk path has it). Generalize it. *Every* destructive action gets it.

---

## 5. Confirmation dialogs — copy that does work

`confirm-dialog.tsx` is a clean shell. The problem is not the component — it's the props every caller passes. Survey of titles in the codebase that need rewriting:

- "Are you sure?" → *delete this — what does it cost*
- "Confirm action" → *what is the action and what changes*
- "Cancel subscription?" → *list of features I lose, data retention period, reactivation path*
- "Delete this lead?" → *list of attachments / notes / tasks that come with it*
- "Send campaign?" → *count of recipients, estimated cost, irrevocability statement*

This is not work for engineering — it's work for product writing. One person, one week, full pass through every confirm-dialog caller in the codebase. Maximum impact for users like me who navigate by *reading the dialog* instead of *trusting the muscle memory.*

A pattern that helps: every destructive confirmation should answer three questions in order:
1. **What will change** — concrete, count-bearing, no abstractions
2. **What is recoverable** — Trash, undo window, archive
3. **What is the alternative** — Cancel, but also "Pause," "Archive instead," "Move to..."

Right now most dialogs answer none of these. They answer "yes/no?" — which is the question I'm trying to figure out by reading the dialog.

---

## 6. Save-on-blur — the highest-leverage fix in this audit

I cannot stress this enough. **Forms must save on blur, or autosave on a debounce, with a visible indicator.** Every form. Every field. The pattern:

- On blur: write to a draft endpoint, return ack within 200ms
- Indicator near the field: "Saved" with a checkmark, "Saving…" with a spinner, "Couldn't save — retry" with a button
- On navigation away with unsaved local changes: a *non-blocking* prompt with three options (Save and go / Discard / Stay)
- Drafts persist on the server, scoped to the user, recoverable from a Drafts tray

The infra exists in pieces: I see `useMutation` patterns, debounced search inputs, draft logic in the offer wizard. It needs to be the *default* form pattern. A `useAutosaveForm` hook wrapping react-hook-form would let every form opt in with one line. Two engineers, one sprint. Single biggest accessibility-win in the product.

The current pattern — type, click Save, get a toast — assumes I will remember to click Save. On a bad day I will not. On a phone call I will not. On a fog-of-stroke morning I will absolutely not. **This is a workflow that punishes inattention. Brains like mine are inattentive in chunks. The product needs to be forgiving in chunks.**

---

## 7. Session timeout — generosity

Right now session expires somewhere between 30 minutes and an hour of inactivity (I haven't traced the exact number; I just know it bites at lunch). For users who opt in (a setting in `/settings/profile` — "extend session to 8 hours"), it should be possible to keep a session alive across a workday. Two safeguards:

- A re-auth challenge for sensitive actions (billing changes, role changes, bulk delete > 50 rows) regardless of session age
- An idle warning at 8 hours with a one-click extend button

The Clerk proxy supports this (refresh token rotation, configurable session lifetime). It's a config decision, not a re-architecture. *Different brains have different tempos.* A product that ships one tempo serves one brain.

Bonus: on session expiry, **resume where I was.** Capture last route + scroll position + form state in localStorage, restore on next login. Today the post-login redirect is `/dashboard` regardless of what I was doing. The five-line fix saves me a real cost.

---

## 8. Sequential vs parallel workflows

There are tasks I want the system to *guide* me through, not *let me wander.* Examples:

- **Onboarding wizard** — already sequential, mostly works, has the "skip" trapdoor that on a bad day I hit by accident. Make Skip a small text link, not a button next to Continue.
- **Offer wizard** — currently sequential but lets me jump to any step via the step indicator. On a clear morning I want that. On a foggy one I want the system to *prevent* me from skipping. A user-level setting — "Guided mode: complete steps in order" — would let me opt into rails when I need them.
- **First-time deal underwrite** — currently a single dense form with twelve sections. Sequential mode: one section at a time, with a progress bar, with the previously-entered data summarized at the top of each new step. Same data, different rhythm.

The principle: *the system should know which mode the user wants.* A toggle in `/settings/accessibility` — "Show one step at a time on long forms" — would let me ask for it without forcing it on Wendell. Two engineers, two sprints, opt-in everywhere.

---

## 9. Per-surface friction — cognitive lens

**`/dashboard`** — Add a "primary action of the day" card, large, top-left, with one verb. Demote all other cards to a secondary grid. The current "everything at equal weight" layout is hostile to brains that need a starting point.

**`/leads/:id`** — Add save-on-blur to every field. Add a Drafts indicator. Add a Trash flow with Undo. Add a "what changed when" audit trail visible in a side panel, not buried in `/activity`.

**`/parcels/:id`** — The detail surface is dense but well-organized; the tabs help. Two requests: a *plain-language summary* at the top ("This is a 12.4-acre parcel in Indiana County, PA. The owner is John Smith. The last sale was 2018 for $48,000. There are no liens.") and a "read aloud" button that uses the Web Speech API to narrate it. The latter is a 30-line addition that helps me, helps every blind user, and helps every investor in a car.

**`/offer-wizard`** — Sequential mode toggle. Save-on-blur. Inline summary at the top of each step. Big primary Next button bottom-right; demote all other controls. Confirmation dialog before sending that lists what's in the offer.

**`/campaigns`** — Send button must be physically far from navigation. Typed confirmation for any send over 25 recipients. Cost summary in the confirm. Undoable for 5 minutes after send (Stripe-style cancellation window — campaign sits in a "queued" state for 5 minutes before going out).

**`/settings`** — Add an Accessibility tab with: extend session, sequential mode default, autosave indicator visibility, reduce motion (respects `prefers-reduced-motion` already? — verify), font-size step (110%, 125%, 150%), high-contrast mode toggle. Most of this exists in pieces but isn't surfaced in one place.

**`/academy`** — Add an audio version of every text module. Brains that read slowly often listen faster. The content already exists; a single TTS pipeline gets us 80% of the way there.

**`/notifications`** — Make the toast tray *persistent.* Every toast logs to a tray I can scroll through. Today, miss a toast and it's gone. That's a real harm.

**Color & iconography** — I read fine. But icon-only buttons with no label require me to translate symbol → meaning, which costs me. The CLAUDE.md rule that every icon-only button has an aria-label is correct. *Add a user setting: "show button labels alongside icons."* It's a CSS rule, not a redesign.

---

## 10. The deal-killer

The deal-killer for me is the cumulative cost of small frictions. No one of them ends my use of AcreOS. All of them together turn a 4-hour productive day into a 2-hour productive day. I will use the product. I will pay for the product (Pro tier, $49 — fair for my volume). I will recommend it to other land investors my age, *but only if* the cognitive-accessibility work above ships.

The investor population is aging. Thomas knows this — the Land Investor demo skews 50+. A measurable percentage of that demo has had a stroke, a TBI, an early dementia diagnosis, severe ADHD, post-COVID brain fog, or just the ordinary slowing-down of a 60-year-old brain. *They are not edge cases.* They are the median customer in five years. The product that makes itself legible to them now will own that market when it matures.

The work is not heroic. Save-on-blur is a hook. Undo-on-everything is a generalized pattern. Confirmation copy is a writing pass. Session timeout is a config. Sequential mode is a toggle. Six weeks of focused work. Half a percent of engineering effort. Tenfold return on retention for a cohort that, today, churns silently because no one asks them why.

Ask us. We'll tell you. We'll tell you slowly, and the words will sometimes go missing, but we'll tell you.

— Tobias
