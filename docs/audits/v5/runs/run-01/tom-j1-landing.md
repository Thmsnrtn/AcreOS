# Persona Simulation: Tom Beaulieu -- J1 Landing to First Parcel

| Field | Value |
|---|---|
| Persona | Tom Beaulieu, 45, part-time land investor / full-time construction contractor, Grand Junction CO |
| Device | Laptop 1280x720 |
| Browser | Chrome |
| Network | Fast |
| Session | Expired (signed up in January, hasn't logged in since early February) |
| Parcels in system | 23 (imported from spreadsheet months ago) |
| Concurrency | Solo |
| Date | 2026-04-18 |

---

## Persona Context

Tom is not technical. He uses his iPhone for most things, has a PC his daughter set up, and relies on QuickBooks for his contracting business. He signed up for AcreOS in January, spent ~6 hours setting it up, imported 23 parcels, configured some agents (he thinks), and then a commercial project pulled him away in February. He hasn't logged in for 2.5 months. He doesn't remember whether he used Google or email/password to sign up. He doesn't remember the terminology (pipeline? leads? agents?). He wants to get back to where he was without re-learning the product.

> "What was I doing in here again? I set this up back in January and I can't remember any of it."

---

## Step 1: Find AcreOS in Browser History

**Action:** Tom opens his laptop, opens Chrome, and looks for AcreOS. He vaguely remembers the name. He types "acre" in the address bar and Chrome autocomplete shows `acreos.fly.dev`. He clicks it.

**What happens:**

Tom's Clerk session has expired. The JWT token from January/February is no longer valid. Two possible outcomes:

**Scenario A: Session cookie cleared.** Chrome may have cleared the cookie via browser cleanup, a Chrome update, or session expiration. Tom arrives at the landing page (`/`) as an unauthenticated user. The landing page loads normally.

**Scenario B: Stale session cookie present.** The Clerk cookie exists but the session is expired. The SPA boots, Clerk checks the session, determines it's invalid, and... what? Possibilities:
- Clerk silently clears the invalid session and treats Tom as unauthenticated (lands on landing page)
- Clerk redirects to the auth page with an error (confusing for Tom)
- The app tries to load authenticated routes, gets 401s from the API, and shows error states

In either scenario, Tom ends up needing to re-authenticate. The critical question is: **how graceful is the transition?**

### Tom's Experience (Most Likely Path)

Clerk's SDK handles expired sessions gracefully -- it detects the invalid session during initialization and sets `isSignedIn = false`. The app's routing logic (`user ? <Redirect to="/today" /> : <LandingPage />`) renders the landing page.

Tom sees the landing page. He's confused.

> "Wait, I already signed up for this. Why am I seeing the home page? Did my account get deleted?"

He looks for a "Sign In" button. He finds it in the nav bar (third element: "Sign In"). He clicks it.

**FRICTION EVENT F-01: No "Welcome back" state for returning users.**
When a returning user arrives at the landing page after session expiration, there is no visual cue that they've been here before. No "Welcome back" banner, no "Sign In to continue where you left off" message. The landing page is identical for new and returning visitors. Tom doesn't know if his account still exists.

---

## Step 2: Attempt to Sign In

**Action:** Tom clicks "Sign In" in the nav. URL: `/auth` (no `?mode=register`, so the page initializes in sign-in mode).

**What he sees:** Clerk SignIn widget centered on a blank page.

The Clerk widget asks for email (or phone) and password. There may also be social login buttons (Google, Apple) depending on the Clerk dashboard configuration.

**Tom's problem: He doesn't remember how he signed up.**

He stares at the sign-in form. Options he might have used:
1. Email + password
2. Google sign-in
3. Apple sign-in

He tries email + password first. He types his email address. He types what he thinks his password is. It's wrong.

> "What was my password? I can never remember these things."

He tries another password. Wrong again.

He looks for "Forgot password" -- Clerk's SignIn widget has a "Forgot password?" link. He clicks it. Clerk sends a password reset email. He checks his email, clicks the link, sets a new password, and comes back to sign in.

**Time elapsed: ~3-4 minutes.** Tom's threshold for authentication friction is 2 minutes. He's at the limit.

**Alternative scenario:** Tom might try Google sign-in instead. If he originally signed up with Google, this works instantly. If he originally signed up with email/password and now clicks Google, Clerk may:
- Link the Google account to his existing account (if the email matches)
- Create a new account (if Clerk is configured to treat each auth method separately)

If a new account is created, Tom now has two accounts -- one with his 23 parcels and one empty. He won't realize this has happened until he gets inside and sees an empty dashboard.

**FRICTION EVENT F-02: Auth method ambiguity for returning users.**
Tom doesn't remember his authentication method. The sign-in page offers multiple options (email/password, Google, possibly Apple) with no hint about which one Tom used previously. If he picks the wrong method, he may accidentally create a duplicate account or fail to authenticate. Clerk does not show "You previously signed in with Google" hints.

---

## Step 3: Successful Sign-In -- Where Does He Land?

**Action:** Tom successfully signs in (either via password reset or Google).

**Redirect behavior:** The `<SignIn>` component has `fallbackRedirectUrl="/today"`. After authentication, Tom is redirected to the Today dashboard.

**What Tom sees:**

The Today page is a dashboard hub. After 2.5 months of absence, Tom sees:

**Stat cards:** These show current counts (leads, properties, deals, etc.). His 23 imported parcels should appear in the properties count. Other counts depend on what he set up in January.

**Priorities section:** The Today page fetches `/api/today/priorities` which generates dynamic priorities based on current data state. After 2.5 months, priorities might include:
- Stale leads (leads not contacted in >30 days)
- Overdue follow-ups
- Agents with errors or stale runs
- Unfinished onboarding steps

**System alerts:** The alerts section fetches `/api/alerts/active`. After 2.5 months, there might be:
- `stale_leads` alert -- leads that haven't been contacted
- `note_overdue` alert -- notes past their due date
- `stuck_deals` alert -- deals that haven't progressed
- `stale_avm` alert -- property valuations that are outdated

**Agent status:** If Tom configured agents in January, they may have been running (or failing) for 2.5 months. The dashboard should surface agent activity, but it's unclear whether agent status is prominently displayed on the Today page or buried in the Agents section.

### Tom's Reaction: Disoriented

> "OK, I'm in. I see some numbers. 23 properties -- that's right, I think I put 23 in there. But what are all these alerts? 'Stale leads' -- I don't know what that means. 'Overdue follow-ups' -- follow-ups on what?"

The dashboard shows him information, but Tom doesn't have the context to interpret it. He set things up 2.5 months ago and doesn't remember the terminology or the workflow he configured.

**What Tom wants to see:**
1. "You have 23 properties in your portfolio" -- confirmation his data is safe
2. "You've been away for 75 days. Here's what happened" -- a summary of agent activity, alerts, and changes
3. "Pick up where you left off: [big obvious button to his most recent activity]"

**What he actually sees:**
A dashboard with stat cards, priority items, and alerts -- all using terminology he's forgotten. No "welcome back" message. No re-orientation help. No "here's what happened while you were away" summary.

**FRICTION EVENT F-03: No returning-user re-orientation.**
The Today page is the same for a user who logged in yesterday and a user who's been away for 2.5 months. No "welcome back" banner, no absence summary, no contextual re-introduction to terminology. Tom has to re-learn the interface from scratch.

---

## Step 4: Find His Parcels

**Action:** Tom wants to see his 23 parcels to confirm they're still there and remember what he was working on.

**Navigation:** The sidebar has: Today, Pipeline, Properties, Money, AI, Agents, Settings.

Tom doesn't remember which section has his parcels. "Properties" seems right. He clicks it.

**What he sees:** A list of his 23 parcels (assuming he imported them as properties, not leads). The list shows columns like county, state, acreage, status, and possibly assessed value.

> "OK, there they are. 23 properties. I recognize some of these -- that's the 5-acre lot in Mesa County, and the one in Grand County. Good, my data is still here."

But some parcels have statuses he doesn't recognize. Some are marked with tags or statuses that he either set in January and forgot, or that agents set automatically.

> "Why does this one say 'Hot Lead'? I don't remember marking it as hot. Did I do that? Did the computer do that? There's no way to tell."

**FRICTION EVENT F-04: No "last modified by" or change attribution.**
Parcels have statuses and tags with no visible attribution. Tom can't tell whether he set a status in January or whether an agent changed it while he was away. No "modified by" field, no activity log on the record. This is the same audit trail gap Sarah identified, but from a different angle -- Tom needs attribution not for compliance but for personal context.

---

## Step 5: Check What Agents Did

**Action:** Tom vaguely remembers setting up "agents" that were supposed to do things automatically. He clicks "Agents" in the sidebar.

**What he expects:** Some kind of dashboard showing what the agents have been doing for the past 2.5 months.

**What he might see:**
- A list of configured agents with status indicators (active, paused, error)
- Run history showing when each agent last ran and what it did
- Error logs if agents failed (e.g., credit exhaustion, API timeouts)

**Potential scenarios:**

1. **Agents ran successfully.** Tom's agents have been processing data for 2.5 months. They may have scored leads, updated property statuses, or generated reports. But Tom has no context for interpreting these results.

2. **Agents ran and exhausted credits.** Free-tier AI requests are 25/day. If agents consume AI requests, they may have hit the daily limit consistently, ran partially, and produced incomplete results. There may be error entries in a log Tom doesn't know to check.

3. **Agents paused automatically.** The platform may pause agents after a period of user inactivity or credit exhaustion. Tom sees them listed as "paused" with no explanation of why.

4. **Agents errored silently.** Agents hit errors (API timeouts, rate limits, data issues) and failed. Error logs exist somewhere but are not surfaced on the main Agents page or the Today dashboard.

In any scenario, Tom's reaction is the same:

> "I think I set something up in here but I have no idea what it's doing or if it worked. There's stuff running but I don't know what any of it means. I feel like I'm looking at someone else's computer."

**FRICTION EVENT F-05: No agent activity summary for returning users.**
After 2.5 months of absence, there is no summary of agent activity: total runs, successes, failures, credits consumed, data changed. The Today dashboard may have alerts, but they don't specifically say "Your agents ran 150 times and failed 47 times" or "Your agents scored 15 leads while you were away."

---

## Step 6: Try to Add New Parcels

**Action:** Tom has a PDF list of parcels from a county tax sale. He wants to add 10-15 new parcels.

**What he's looking for:** A big obvious "Add Parcel" or "Import" button.

**Where he looks:**
1. The Properties list view -- is there an "Add" or "Import" button in the toolbar?
2. The sidebar -- is there a "+" button or "New" option?
3. The top nav -- is there a global "Add" button?
4. The command palette (Cmd+K) -- Tom doesn't know this exists. He won't try it.

**Potential friction:**
- The "Add Property" button might be present but labeled differently ("New Lead" vs. "Add Property" vs. "Create Parcel")
- The import function might be in a dropdown menu or submenu Tom doesn't think to check
- The import might only accept CSV, not PDF (Tom has a PDF list from the county)

> "How do I add more parcels? I see my list of 23 but I don't see a button to add new ones. Let me look around... Settings? No. AI? No. Pipeline? There's stuff here but it says 'Leads' not 'Properties.'"

Tom is confused by the distinction between "Leads" (in Pipeline) and "Properties." In his mental model, everything is a "parcel." The product's taxonomy (leads, properties, deals, notes) is a CRM framework that doesn't match Tom's vocabulary.

**FRICTION EVENT F-06: CRM terminology doesn't match user mental model.**
Tom thinks in "parcels." AcreOS uses "leads," "properties," "deals," and "notes" -- a CRM vocabulary that doesn't map to Tom's experience. He doesn't know whether to add his new parcels as "leads" or "properties" and there's no guidance explaining the difference.

---

## Step 7: Give Up or Continue?

**Decision point:** Tom has been back in the product for about 5-7 minutes. He has:
- Successfully logged in (after password reset friction)
- Found his 23 parcels (they're still there)
- Failed to understand the dashboard alerts and priorities
- Failed to understand what agents have been doing
- Struggled to find where to add new parcels
- Felt lost in CRM terminology he's forgotten

### Tom's Verdict: FRUSTRATED BUT PERSISTING

Tom is frustrated but hasn't given up completely. His data is there -- that's the critical thing. If his 23 parcels were missing, he would have closed the tab immediately.

But the product hasn't helped him re-orient. It doesn't acknowledge that he's been away, doesn't summarize what happened, and doesn't guide him toward his next action ("add new parcels from your tax sale list"). He feels like he's re-learning the product from scratch.

> "My spreadsheet doesn't forget me. I open it, there are my parcels, there's my data. I don't have to log in, I don't have to remember passwords, and I don't have alerts about 'stale leads' -- whatever that means. This thing was supposed to be better than my spreadsheet but right now it's just more confusing."

---

## Final Verdict: PERSISTING WITH FRICTION -- At Risk of Abandonment

Tom will give AcreOS one more session. If he can figure out how to add his new parcels and if the agents start making sense, he'll stay. If the next session is equally confusing, he'll go back to his spreadsheet.

---

## Friction Events

| # | Event | Severity | Description |
|---|-------|----------|-------------|
| F1 | No "welcome back" state for returning users | HIGH | Landing page is identical for new and returning visitors. No visual cue that Tom's account exists. He doesn't know if his data survived until he signs in and checks. |
| F2 | Auth method ambiguity | HIGH | Tom doesn't remember whether he signed up with Google or email/password. No hint on the sign-in page about his previous auth method. Wrong choice could create a duplicate account. |
| F3 | No returning-user re-orientation | CRITICAL | After 2.5 months of absence, the Today dashboard offers no "welcome back" message, no absence summary, no "here's what happened while you were away." Tom must re-learn the interface from scratch. |
| F4 | No change attribution on records | HIGH | Parcel statuses and tags have no "last modified by" or "changed by agent" attribution. Tom can't distinguish his own January edits from automatic agent changes. |
| F5 | No agent activity summary | HIGH | After 2.5 months, there's no summary of agent runs, successes, failures, or data changes. Tom doesn't know if agents helped, hurt, or did nothing. |
| F6 | CRM terminology mismatch | HIGH | Tom thinks in "parcels." The product uses "leads," "properties," "deals," and "notes." No glossary, no tooltip, no contextual help explaining what these terms mean or how they relate. |
| F7 | Password reset flow adds friction | MEDIUM | Tom doesn't remember his password. The password reset flow (Clerk) works but adds 3-4 minutes of friction. Above Tom's 2-minute tolerance for auth issues. |
| F8 | No guidance for adding new parcels | MEDIUM | Tom has a PDF tax sale list. There's no obvious "Import" or "Add Parcel" button visible without knowing the UI conventions. The import might only accept CSV, and Tom has a PDF. |
| F9 | Onboarding state from January | LOW | If Tom left onboarding partially complete in January, the product might try to resume it. Re-entering step 3 of a wizard he did 2.5 months ago with no context for steps 1-2 would be confusing. |
| F10 | Auth page unbranded | LOW | Minor issue -- but Tom arriving at a blank auth page with no AcreOS branding contributes to the "is this even the right site?" uncertainty. |

---

## Recommendation Score

**4/10 -- Data is safe, but the product doesn't help returning users.**

AcreOS preserved Tom's 23 parcels through 2.5 months of inactivity -- that's good. But the product offers zero re-orientation for returning users: no welcome-back flow, no absence summary, no agent activity digest, no terminology reminders. Tom has to re-learn the product from scratch, which means competing against the spreadsheet that never forgets him.

For Tom to stay, AcreOS needs:
- A "Welcome back" interstitial that says "You've been away for 75 days. Here's what happened."
- Agent activity digest: "Your agents ran X times, found Y opportunities, encountered Z errors."
- Contextual tooltips on first re-visit: "Leads = people who might sell. Properties = parcels you're tracking."
- A prominent "Add Parcel" button on the properties page (not buried in a menu)
- PDF-to-CSV conversion help for tax sale lists

---

## Verbatim Quotes (Tom Would Say)

1. "I already signed up for this. Why is it showing me the home page again? Did they delete my account?"

2. "Was it Google or email? I can never remember. Let me try email... wrong password. Great. Now I have to reset my password for something I used twice."

3. "OK, my parcels are here. That's good. But some of them say 'Hot Lead' and I don't remember doing that. Did I set that up or did the computer decide that on its own? I can't tell."

4. "I set up agents back in January. Did they do anything? Are they still running? I see them in the list but I have no idea what they've been doing for two months. It's like coming back to your house and finding out the sprinklers have been running the whole time."

5. "My spreadsheet might not be fancy but at least I know what everything means. 'Parcel,' 'county,' 'price I paid,' 'what I want to sell it for.' Here it's 'leads' and 'pipeline' and 'campaigns' and I feel like I accidentally signed up for a marketing tool."
