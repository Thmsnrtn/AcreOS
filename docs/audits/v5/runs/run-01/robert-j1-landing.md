# Persona Simulation: Robert "Bobby" Tate
## Journey 1 -- Landing to First Parcel

| Field | Value |
|---|---|
| Persona | Robert "Bobby" Tate, 68, retired school principal, Clarksville TN |
| Device | iPad tablet, 768x1024 portrait |
| Network | 3G throttled (~400 kbps) |
| Tech comfort | Low. Reads every word. Intimidated by AI. Prefers phone calls. |
| Session | Fresh (no cookies, no prior visit) |
| Concurrency | Solo |
| Date | 2026-04-18 |

---

## Step 1: Arrival at acreos.fly.dev/

**Action:** Robert taps a link his nephew texted him. Safari loads acreos.fly.dev on his iPad.

**What he sees (3G delay):** A blank white page with a tiny spinner for 3-5 seconds while the React SPA bundle downloads (~400 kbps). The browser tab says "AcreOS -- The Operating System for Real Estate Investors."

> "The what for who? Operating system? I thought this was a website for selling land."

**Page renders.** Sticky nav with a small green "A" square, the word "AcreOS," and three nav items: Pricing, Sign In, Get Started Free.

### Hero Section

He sees:

- Badge: "Now in Public Beta"
- Heading: "The operating system for **real estate professionals**"
- Subheading: "AcreOS replaces your spreadsheets, disconnected tools, and guesswork with a single platform that manages leads, automates outreach, and closes deals -- powered by AI."
- Strategy badges: Wholesaling, Fix & Flip, Buy & Hold, STR / Airbnb, Land, Multifamily, Commercial, Creative Finance, Notes
- Two buttons: "Start Free" and "View Pricing"

**Robert's internal monologue:**

> "Public Beta. That means it's not finished yet. Do I really want to put my information into something that's still being tested?"

> "Operating system... I know what an operating system is on my computer. This is confusing. Is this something I install?"

> "'Manages leads, automates outreach, and closes deals -- powered by AI.' I don't know what half of that means. What's a lead? I have five parcels of land in Tennessee I'm trying to keep track of. I don't need to 'automate outreach.' I just need to know what my parcels are worth."

> "Wholesaling, Fix & Flip, Buy & Hold... I see 'Land' in there, good. But why is it buried in the middle of all these other things? Am I in the right place?"

### Friction Event F-1: Jargon Overload in Hero

| Severity | HIGH |
|---|---|
| Element | Hero subheading + strategy badges |
| Issue | The hero copy uses industry jargon ("leads," "automates outreach," "closes deals," "AI") that a low-tech retiree with 5 rural parcels does not identify with. Robert does not think of himself as someone who "closes deals." He thinks of himself as someone who owns some land and wants help managing it. The word "AI" specifically triggers anxiety. |
| Quote | "Powered by AI? My grandson showed me that ChatGPT thing. I don't trust a computer to handle my property." |
| Recommendation | Add a plain-English subheading variant or a one-liner under the hero: "Track your parcels, know what they're worth, and manage everything in one place." The current copy targets aggressive, deal-flow-oriented professionals and excludes passive landowners. |

### Social Proof Section

He scrolls down slowly. He sees four stats:

- 18 -- Free data sources
- $0 -- To get started
- 14 -- Day free trial
- 500+ -- Properties managed

> "$0 to get started, that's good. But '500+ properties managed'? That's not very many. My church has 600 members."

### Friction Event F-2: Weak Social Proof

| Severity | MEDIUM |
|---|---|
| Element | Social proof stat "500+ Properties managed" |
| Issue | For a cautious buyer, "500+" is a small number that signals an immature product. Combined with the "Public Beta" badge, this compounds distrust. Robert expected to see thousands, or at least a testimonial from a real person. |
| Quote | "Only 500? How do I know this thing even works?" |
| Recommendation | Replace with a testimonial from a real user, or reframe as "500+ properties managed this month" or remove the stat entirely until the number is more impressive. A quote from a real human being would do far more for Robert than a number. |

### Features Section

He reads all six feature cards:

1. **Portfolio Mapping** -- "Visualize every parcel on interactive maps with GIS overlays, flood zones, and zoning data."
2. **AI Valuations** -- "Instant property valuations powered by comps analysis and 18 open data sources."
3. **AI Deal Intelligence** -- "Sophie, your AI copilot, scores leads, drafts offers, and surfaces the best opportunities."
4. **Document Generation** -- "Auto-generate purchase agreements, contracts, and closing documents in seconds."
5. **Campaign Automation** -- "Multi-channel outreach with SMS, email, and direct mail sequences."
6. **Compliance Built-In** -- "TCPA consent tracking, DNC list checks, and audit trails for every communication."

> "Portfolio Mapping -- now that sounds useful. I'd like to see my five parcels on a map."

> "AI Valuations -- well, I'd like to know what my land is worth. But 'comps analysis'? That's realtor talk."

> "Sophie, your AI copilot? Who is Sophie? I thought this was about land, not airplane copilots. And 'scores leads'? I don't have leads. I have parcels."

> "TCPA consent tracking? DNC list checks? I have no idea what any of that means. Is this for telemarketers?"

### Friction Event F-3: "Sophie" AI Copilot is Confusing

| Severity | MEDIUM |
|---|---|
| Element | Feature card "AI Deal Intelligence" |
| Issue | The landing page introduces an AI character named "Sophie" without context, then the onboarding wizard later introduces a different AI character named "Atlas." Robert does not understand what a "copilot" is in a software context. The inconsistency between Sophie (landing page) and Atlas (onboarding) will create additional confusion later. |
| Quote | "Who is Sophie? And who is Atlas? Are there real people I can talk to, or is this all computers?" |
| Recommendation | Pick one AI brand name and use it consistently. Introduce the AI assistant in human terms: "Your personal assistant that helps you understand your land." |

### Friction Event F-4: Compliance Jargon

| Severity | LOW |
|---|---|
| Element | Feature card "Compliance Built-In" |
| Issue | TCPA, DNC -- these are regulatory acronyms that a retiree who owns 5 parcels will never encounter. This feature card is completely irrelevant to Robert and makes the product feel like it's for a different audience. |
| Quote | "DNC list checks? Is that something about the government?" |
| Recommendation | Consider audience-adaptive feature display, or at minimum expand the acronyms: "Telephone Consumer Protection Act (TCPA)..." -- though better to simply not lead with compliance for non-power-users. |

### Pricing Teaser Section

He sees four pricing cards:
- Free: $0 -- "10 leads, 3 properties"
- Starter: $20/mo -- "250 leads, campaigns"
- Pro: $49/mo -- "500 leads, BYOK, unlimited"
- Scale: $79/mo -- "10 seats, unlimited everything"

> "Free -- 3 properties. I have 5 parcels. So the free plan doesn't even cover what I have? I'd have to pay $20 a month just to list all my land?"

> "BYOK? What on earth is BYOK?"

### Friction Event F-5: Free Tier Too Restrictive for Basic Use Case

| Severity | HIGH |
|---|---|
| Element | Free tier -- "3 properties" |
| Issue | A retiree with 5 parcels cannot use the Free tier. This forces an immediate paywall for someone who has not yet experienced any value. The jump from "free" to $20/month before Robert has even signed up creates a trust barrier. He does not know if the product works yet. |
| Quote | "Three properties? I have five. So I can't even try this out without paying? That's a deal-breaker right there. My nephew said it was free." |
| Recommendation | Raise the Free tier to at least 5-10 properties. The "10 leads" limit is fine since Robert does not use leads, but the property cap is the first real wall he hits. |

### Friction Event F-6: "BYOK" Unexplained Acronym

| Severity | LOW |
|---|---|
| Element | Pro tier -- "BYOK" in description |
| Issue | "BYOK" (Bring Your Own Key) is developer jargon. Robert has no idea what this means. It makes the product feel exclusionary. |
| Quote | "BYOK? Is that a typo?" |
| Recommendation | Spell it out: "Use your own API keys" or remove from the teaser entirely -- it belongs in the full pricing comparison, not the teaser. |

### CTA Section

> "Ready to modernize your real estate business?"

> "I don't have a real estate business. I have five lots in Cumberland County. This website doesn't seem to be for people like me."

### Footer

He scans the footer. He sees: "(c) 2026 AcreOS. All rights reserved." and links for Pricing and Sign In.

### Friction Event F-7: No Phone Number or Contact Info

| Severity | HIGH |
|---|---|
| Element | Footer / entire landing page |
| Issue | There is no phone number, no chat widget, no "Contact Us" link, no mailing address anywhere on the landing page. The only contact point is an email link (hello@acreos.com) buried on the pricing page. For Robert, who defaults to calling someone when confused, this is a dead end. He has no way to ask a human being for help. |
| Quote | "There's no phone number anywhere. How am I supposed to get help if something goes wrong? I don't want to send an email and wait three days." |
| Recommendation | Add a visible phone number or at minimum a live chat widget. For a product targeting professionals who may be less technical, a phone number in the footer or nav is essential trust infrastructure. |

**Decision point:** Robert almost closes the tab. But his nephew told him this would help, so he taps "View Pricing" to learn more before signing up.

---

## Step 2: Pricing Page (acreos.fly.dev/pricing)

**Load time on 3G:** 1-2 second route transition (SPA, no full page reload). Page renders.

**What he sees:**

- Back arrow + AcreOS logo linking home
- "Get Started" button in nav
- Heading: "Simple, transparent pricing"
- Subheading: "Start free. Upgrade when you're ready. Every paid plan includes a 14-day free trial."
- Monthly/Annual toggle (defaults to Monthly)
- Four tier cards: Free ($0), Starter ($20/mo), Pro ($49/mo, "Most Popular" badge), Scale ($79/mo)
- Full feature comparison table (16 rows)

> "Simple, transparent pricing -- well, that's encouraging."

> "Monthly or Annual... I'll leave it on Monthly for now."

He reads each tier card:
- **Free:** "Explore the platform" -- CTA: "Get Started"
- **Starter:** "Replace your spreadsheet" -- CTA: "Start 14-Day Free Trial"
- **Pro:** "For serious operators" -- CTA: "Start 14-Day Free Trial" (highlighted)
- **Scale:** "For growing teams" -- CTA: "Start 14-Day Free Trial"

> "'Explore the platform' -- okay, I can try it for free. But I already saw it only allows 3 properties."

> "'For serious operators' -- well, I'm not an operator. I'm retired."

### Feature Comparison Table

Robert reads the table carefully, row by row:

| Feature | Free | Starter | Pro | Scale |
|---|---|---|---|---|
| Leads | 10 | 250 | 500 | Unlimited |
| Properties | 3 | 50 | 100 | Unlimited |
| Notes | 2 | 25 | 50 | Unlimited |
| AI Requests / day | 25 | 500 | 1,000 | Unlimited |
| Campaigns | X | 5 | Unlimited | Unlimited |
| Sequences | X | 2 | Unlimited | Unlimited |
| BYOK Data Providers | X | X | check | check |
| Team Seats | 1 | 1 | 2 (add more at $20/seat) | 10 (add more at $40/seat) |
| Open Data Sources (18) | check | check | check | check |
| AI Deal Intelligence | check | check | check | check |
| Document Generation | check | check | check | check |
| Portfolio Mapping | check | check | check | check |
| Stripe Connect Payments | X | check | check | check |
| Direct Mail Integration | X | check | check | check |
| SMS/Voice Outreach | X | X | check | check |
| Priority Support | X | X | check | check |

> "Notes -- 2? What kind of notes? Like sticky notes? Or mortgage notes? If it's mortgage notes I don't have any. If it's like writing notes to myself, 2 is ridiculous."

> "AI Requests per day -- 25. I don't even know what that means. Am I going to accidentally use them all up?"

### Friction Event F-8: "Notes" Ambiguity

| Severity | MEDIUM |
|---|---|
| Element | Feature comparison row "Notes" |
| Issue | In the real estate context, "Notes" could mean mortgage/promissory notes (a financial instrument) or text notes/annotations on a property. The landing page strategy badges include "Notes" as a business type. This ambiguity confuses Robert, who does not deal in either. |
| Quote | "I don't have any mortgage notes, and I sure hope I can write more than 2 notes to myself." |
| Recommendation | Rename to "Mortgage Notes" if that is what is meant, or add a tooltip/explanation. |

### Friction Event F-9: "AI Requests / day" is Opaque

| Severity | MEDIUM |
|---|---|
| Element | Feature comparison row "AI Requests / day" |
| Issue | Robert has no mental model for what an "AI Request" is, how one gets consumed, or whether 25 is enough. This creates free-floating anxiety about resource limits he cannot understand or control. |
| Quote | "What if I use up all 25 and then I can't do anything? How would I even know?" |
| Recommendation | Either hide AI request limits from the pricing table (handle via soft limits internally) or add a tooltip: "Each time you ask the AI assistant a question, that uses one request. 25 per day is enough for most individual users." |

> "Alright, I'll try the free plan. Three properties isn't enough but maybe I can see how it works first."

He taps "Get Started" on the Free tier card.

---

## Step 3: Auth Page (acreos.fly.dev/auth)

**What he sees:** A centered Clerk sign-in widget with:

- Clerk-branded sign-in form (rendered by Clerk's embedded component)
- Email field
- "Continue" button
- "Or continue with" -- Google, potentially Apple
- Below the Clerk widget: "Need an account? Sign up" toggle link

**Robert's experience on 3G:** The Clerk widget takes 3-6 seconds to load its iframe/JS on 3G. During this time, Robert sees a blank centered area or a spinner. He is not sure if the page is broken.

### Friction Event F-10: Clerk Widget Load Time on 3G

| Severity | HIGH |
|---|---|
| Element | Clerk SignIn component |
| Issue | On a 3G connection, the Clerk authentication widget loads its own JavaScript bundle independently of the app. This creates a 3-6 second window where Robert sees either nothing or a small spinner in the center of the screen, with no explanatory text. He does not know if the page is loading, broken, or intentionally blank. |
| Quote | "Is this thing broken? There's nothing here. Just a little spinning circle. Maybe my internet is too slow." |
| Recommendation | Add a skeleton placeholder or text like "Loading sign-in..." while the Clerk widget loads. The current experience is an empty page with a generic spinner that provides no context. |

**The Clerk widget loads.** Robert sees "Sign in to AcreOS" with an email field.

> "Sign in? I don't have an account yet. I need to sign up."

He looks below and sees: "Need an account? Sign up." He taps it.

The view toggles to the Clerk SignUp widget.

### Friction Event F-11: Default to Sign-In Instead of Sign-Up

| Severity | MEDIUM |
|---|---|
| Element | Auth page default mode |
| Issue | Robert arrived from a "Get Started" CTA, which implies creating an account. But the auth page defaults to sign-in mode. He must find and tap "Need an account? Sign up" to switch. This is a small but real friction point -- the CTA promised account creation, but the page assumes he already has one. |
| Quote | "It says 'Sign in' but I don't have an account. Where do I sign up? Oh, down here at the bottom. That's confusing." |
| Recommendation | When the user arrives from a "Get Started" or "Start Free" CTA, append `?mode=register` to the URL. The code already supports this (`params.get("mode") === "register"`), but the landing page links do not use it -- they all link to plain `/auth`. |

**Robert fills out the Clerk sign-up form:**

- Enters his email: bobbytate1958@gmail.com
- Clerk sends a verification code
- He checks his email on the iPad (switches apps), finds the code, switches back to Safari
- Enters the verification code

### Friction Event F-12: App-Switch for Email Verification on Tablet

| Severity | MEDIUM |
|---|---|
| Element | Clerk email verification flow |
| Issue | On an iPad, switching from Safari to the Mail app and back is disorienting for a low-tech user. Robert has to find the code, remember it, switch back, and type it in. On 3G, the Safari tab may reload when he switches back, forcing him to start over. |
| Quote | "Okay, they sent me a code. Let me check my email... Where did Safari go? Oh Lord, it reloaded the page. Do I have to start over?" |
| Recommendation | This is a Clerk-platform limitation. Consider adding Google sign-in prominently as an alternative that avoids the app-switch problem. The current Clerk config appears to support social login. Also consider magic links instead of codes. |

**Robert successfully verifies and creates his account.** He is redirected to `/today` (the dashboard).

---

## Step 4: Post-Auth -- Onboarding Wizard

**What appears:** The onboarding wizard (onboarding-v2.tsx) loads. Robert sees a dark-themed (gray-950 background) full-screen page:

- Green badge: "The Most Intelligent Land Investing Platform"
- Heading: "Welcome to AcreOS"
- Subheading: "Tell us where you are in your land investing journey -- we'll configure everything for you."
- Three path cards:
  1. **Just Getting Started** -- "I'm new to land investing and want to learn the ropes"
  2. **Active Real Estate Professional** -- "I'm already doing deals and need better tools"
  3. **Team or Enterprise** -- "I run a land investing operation with a team"

> "Land investing journey? I'm not on a journey. I already own land. I'm retired."

> "Just Getting Started -- no, I already have parcels. Active Real Estate Professional -- I'm not a professional, I'm retired. Team or Enterprise -- definitely not."

### Friction Event F-13: Path Selection Does Not Fit Robert

| Severity | HIGH |
|---|---|
| Element | Onboarding path selection |
| Issue | None of the three paths describe Robert's situation. He is not a beginner (he owns land), not an active professional (he is retired), and not an enterprise. He is a passive landowner who wants to track existing parcels. The onboarding forces him into a category that does not exist. He will likely pick "Just Getting Started" as the least-wrong option, but the subsequent flow (county targeting, deal hunting, strategy selection) will all be irrelevant to his needs. |
| Quote | "None of these are me. I already have land, but I'm not a professional. I guess I'll pick the first one." |
| Recommendation | Add a fourth path: "I already own property and want to manage it" or "Existing landowner" that skips deal-hunting and goes straight to portfolio setup (add your parcels, see them on a map, get valuations). |

### Friction Event F-14: "Land Investing" Framing vs. Landing Page "Real Estate Professionals"

| Severity | MEDIUM |
|---|---|
| Element | Onboarding badge + path cards |
| Issue | The landing page says "real estate professionals." The onboarding says "land investing." The path cards say "land investing journey," "land investing operation." This terminology shift is jarring. The product's identity is inconsistent between pages. |
| Quote | "Wait, is this a land investing thing or a real estate thing? The first page said real estate, now it says land investing." |
| Recommendation | Align terminology across the product. Per project conventions, the term should be "real estate professional." |

**Robert taps "Just Getting Started."** He proceeds through the beginner path.

### Step 4a: Welcome Step

He sees:
- "Welcome to AcreOS"
- "Let's personalize your experience"
- Green box with brain icon: "Atlas AI is ready to help"
- Text: "I'll guide you through finding your first land deal step by step. Land investing is simpler than most real estate -- no tenants, no repairs, just buying cheap and selling for a profit."
- Button: "Let's Get Started"

> "Atlas AI? I thought there was someone named Sophie. Now it's Atlas? Are there two AIs?"

> "'Buying cheap and selling for a profit' -- I'm not trying to flip land. I already own it. This whole thing is about buying more land, not managing what I have."

### Friction Event F-15: Onboarding Assumes Acquisition, Not Management

| Severity | HIGH |
|---|---|
| Element | Welcome step Atlas AI text |
| Issue | The entire beginner onboarding flow is oriented toward acquiring new land deals. Robert wants to manage existing parcels. The Atlas AI introduction talks about "finding your first land deal" -- Robert does not want to find deals. This fundamental mismatch means the entire onboarding is wasted effort for Robert's use case, and may cause him to abandon. |
| Quote | "I don't want to find deals. I want to put my five parcels in here and see what they're worth. This isn't for me." |
| Recommendation | The onboarding should ask whether the user wants to (a) find new deals, (b) manage existing properties, or (c) both. The beginner path should not assume the user has zero properties. |

He taps "Let's Get Started."

### Step 4b: Target County

- "Where Do You Want to Invest?"
- "Your first step: pick a county to explore"
- Fields: Target State (placeholder: "e.g., TX"), Target County (placeholder: "e.g., Hudspeth")
- Pro tip box: "Start with rural counties in TX, AZ, NM, or CO. Look for counties with low competition..."
- Button: "Scan This County" (disabled until fields filled)

> "Where do I want to invest? I don't want to invest! I already own land in Cumberland County, Tennessee! Why is it asking me to pick a county in Texas?"

> "Hudspeth County? Where is that? I've never heard of it."

Robert, somewhat confused, enters "TN" for state and "Cumberland" for county, thinking maybe this will help him manage his existing parcels.

He taps "Scan This County."

### Step 4c: Instant Deal Hunt

A spinner appears: "Scanning Cumberland County, TN for motivated sellers..."

Below: "Checking tax delinquency records - Scoring seller motivation - Finding opportunities"

> "Motivated sellers? Tax delinquency? I'm not delinquent on my taxes! What is this doing?"

After loading (5-10 seconds on 3G), results appear -- or an error if the API doesn't have data for that county.

If results appear: "Found X opportunities (Y properties scanned)"

Cards appear showing owner names, acreage, motivation scores, "Hot Deal" badges, offer prices, resale values, and potential profit.

> "These are other people's properties? Why is it showing me other people's land? I thought I was putting in MY land."

> "Motivation Score? What's a motivation score? And why does it say 'Hot Deal' with a fire emoji?"

### Friction Event F-16: Deal Hunt is Alarming to a Passive Landowner

| Severity | CRITICAL |
|---|---|
| Element | Instant Deal Hunt step |
| Issue | The deal hunt surfaces OTHER people's property with "motivation scores" (implying financial distress) and "potential profit" figures. To Robert, this feels predatory and confusing. He entered his own county expecting to see his own land, and instead sees a tool designed to find distressed sellers. This is the single most likely point where Robert closes the tab. |
| Quote | "This is showing me people who are behind on their taxes so I can buy their land cheap? That's not what I signed up for. This feels wrong. I'm done." |
| Recommendation | For users who select a path indicating they own existing property, skip the deal hunt entirely. For beginners, add context: "These are public records showing potential investment opportunities." But fundamentally, a passive landowner path should not include deal hunting at all. |

Assuming Robert persists, he taps "Continue to Dashboard."

### Step 4d: Strategy Selection

"What's Your Strategy?" with categories:

- Land & Development: Land Flipper, Developer/Subdivider, Tax Lien/Tax Deed
- Residential: Wholesaler, Fix & Flip, Buy & Hold, Short-Term Rental
- Commercial & Multifamily: Commercial, Multifamily, Mobile Home/MHP
- Notes & Creative: Note Investor, Creative Finance
- Multi-Strategy: Agent-Investor, Hybrid/Multi-Strategy

> "My strategy? I don't have a strategy. I have land. I guess 'Buy & Hold'? I'm holding land. But I'm not really investing, I just... own it."

He hesitantly taps "Buy & Hold."

### Step 4e: Meet Atlas AI

- "Meet Atlas, Your AI Deal Partner"
- "Atlas works 24/7 so you don't have to"
- Capabilities: Finds deals every night, Scores every lead with Seller Motivation AI, Schedules follow-ups automatically, Sends your Morning Briefing at 7 AM daily
- Button: "Activate Atlas"

> "My AI Deal Partner? I don't want a deal partner. And it's going to send me emails at 7 AM? I don't need daily emails about land deals I'm not looking for."

### Friction Event F-17: Unwanted AI Activation

| Severity | MEDIUM |
|---|---|
| Element | Atlas tour step, "Activate Atlas" CTA |
| Issue | The button text "Activate Atlas" implies opting into an autonomous AI system. Robert does not want an AI deal partner running 24/7 and sending daily emails. There is no clear way to decline individual features -- it's a single "Activate" button. The alternative is a tiny "Skip setup" link in the header that he may not notice. |
| Quote | "Activate Atlas? I don't even know what that means. What if it starts buying land in my name? Where's the 'no thank you' button?" |
| Recommendation | Add an explicit "No thanks, take me to my dashboard" option at the same visual weight as the activate button. Make it clear that Atlas can be turned on later. |

Robert nervously taps "Activate Atlas" because it's the only prominent button.

### Step 4f: Complete

Confetti animation plays. Green checkmark.

- "You're all set!"
- "Your first target county is configured. AcreOS found opportunities while we talked -- let's look at them."
- Three stat boxes: Target Counties: 1, Deals Found: 3+, Deal Machine: Active
- "What to do first": Review your deal opportunities, Send your first mailer campaign, Ask Atlas a question about land investing
- Button: "Go to My Dashboard"

> "'Send your first mailer campaign'? I don't want to send mail to strangers. I want to see my five parcels on a map."

> "Deal Machine: Active -- what Deal Machine? I didn't sign up for a deal machine!"

Robert taps "Go to My Dashboard."

---

## Step 5: Dashboard and Navigation to Properties

Robert arrives at the dashboard (`/today` or `/dashboard`). He sees the sidebar navigation and looks for something related to his parcels.

He eventually finds "Properties" in the sidebar and taps it.

---

## Step 6: Properties Page -- Adding First Parcel

**What he sees:** The Properties empty state with:

- Large green map icon
- "Build your property portfolio"
- "Add properties you're evaluating or already own. Get instant valuations, track due diligence, and manage your entire inventory."
- Two buttons: "Add a Property" and "Import from CSV"
- Pro tip: "Enter the APN (Assessor Parcel Number) to automatically pull county records, GIS data, and comparable sales."

> "Build your property portfolio -- okay, now we're getting somewhere. 'Add properties you're evaluating or already own.' Finally, this is what I wanted to do from the start."

> "'Import from CSV' -- I don't know what a CSV is."

> "APN? Assessor Parcel Number? I might have that on my tax bill somewhere."

He taps "Add a Property."

### Add Property Dialog

A modal appears: "Add New Property"

"Enter the property details including APN, location, and acreage."

Form fields:
- APN (placeholder: "123-456-789")
- Acres (placeholder: "5.0")
- County (placeholder: "San Bernardino")
- State (placeholder: "CA")
- Purchase Price (placeholder: "5000")
- Market Value (placeholder: "15000")
- Description (placeholder: "Beautiful desert lot with road access...")
- Status dropdown (defaults to "available")
- "Add Property" submit button

> "APN -- okay, I need to find that. Let me look at my tax bill..."

Robert gets up from the iPad, finds his Cumberland County tax bill in a file cabinet, comes back, and types in the APN.

> "Acres -- 12.5, that's easy."

> "County -- Cumberland. State -- TN."

> "Purchase Price -- I don't remember exactly. I bought this 15 years ago. I'll skip that."

> "Market Value -- I don't know, that's what I wanted THIS to tell ME."

> "Status -- 'available'? Available for what? I'm not selling it. Is there a 'I own this' option?"

### Friction Event F-18: "Status" Options Assume Deal Pipeline

| Severity | MEDIUM |
|---|---|
| Element | Property form -- Status dropdown |
| Issue | The status options (available, under_contract, due_diligence, closing, sold, listed) are all deal-pipeline stages. There is no simple "owned" or "holding" status for someone who just owns property and is not actively transacting. Robert does not know which to pick. "Available" sounds like he is listing it for sale. |
| Quote | "Available? I'm not selling it. Under contract? No. Due diligence? I don't know what that means. There's no option for 'I just own this.'" |
| Recommendation | Add an "Owned / Holding" status option for users who simply own property. This is the most natural status for a passive landowner. |

### Friction Event F-19: Market Value Field Expects User Input

| Severity | LOW |
|---|---|
| Element | Property form -- Market Value field |
| Issue | Robert came to this platform partly to learn what his land is worth. The form asks him to enter the market value himself. The empty-state pro tip mentions auto-pulling data via APN, but the form does not indicate that a valuation will happen automatically after submission. Robert feels like the tool expects him to already know what he is trying to learn. |
| Quote | "If I knew the market value, I wouldn't need this website." |
| Recommendation | Add helper text under Market Value: "Leave blank -- we'll estimate this from public records after you save." |

Robert fills in what he can and taps "Add Property."

On 3G, there is a 2-4 second wait with a spinner ("Adding...").

**Success:** The property appears in his list. He sees his parcel in Cumberland County, TN.

> "Well, it worked. But that was a lot of trouble just to get one parcel in here. And I have four more to do."

### Friction Event F-20: Free Tier Allows Only 3 Properties

| Severity | HIGH |
|---|---|
| Element | Free tier property limit (3) |
| Issue | Robert has 5 parcels. He can add his first parcel and two more, then he will hit the paywall on the 4th. He has not yet received enough value to justify paying $20/month. He needs to see all 5 parcels on a map with valuations before he can assess whether the product is worth paying for. |
| Quote | "I added three, and now it says I can't add more unless I pay? But I haven't even seen if the valuations are right. How am I supposed to decide if this is worth $20 a month if I can't even put all my land in here?" |
| Recommendation | Raise the Free tier property limit to 10, or offer a one-time "import your portfolio" exception that allows up to 10 properties during onboarding. Let the user experience the full value before hitting the paywall. |

---

## Journey Summary

### Total Time Estimate
- Landing page to auth: ~5 minutes (reading every word)
- Auth/sign-up with email verification: ~3 minutes (includes app-switch)
- Onboarding wizard (6 steps): ~8 minutes (confusion adds time)
- Navigate to Properties, add first parcel: ~5 minutes (finding tax bill adds time)
- **Total: ~21 minutes**

### Friction Events Summary

| ID | Severity | Element | Core Issue |
|---|---|---|---|
| F-1 | HIGH | Hero copy | Jargon-heavy, excludes passive landowners |
| F-2 | MEDIUM | Social proof | "500+" is underwhelming, no human testimonials |
| F-3 | MEDIUM | Sophie vs Atlas | Inconsistent AI character naming |
| F-4 | LOW | Compliance card | TCPA/DNC acronyms unexplained |
| F-5 | HIGH | Free tier | 3-property limit blocks basic use case |
| F-6 | LOW | BYOK acronym | Unexplained developer jargon in pricing |
| F-7 | HIGH | No contact info | No phone number anywhere on landing page |
| F-8 | MEDIUM | "Notes" ambiguity | Mortgage notes vs. text notes unclear |
| F-9 | MEDIUM | AI Requests/day | Opaque resource limit creates anxiety |
| F-10 | HIGH | Clerk load time | 3-6s blank screen on 3G, no loading text |
| F-11 | MEDIUM | Auth defaults to sign-in | CTAs say "Get Started" but page shows "Sign In" |
| F-12 | MEDIUM | Email verification | App-switch on iPad is disorienting |
| F-13 | HIGH | Path selection | No option for passive landowner |
| F-14 | MEDIUM | Terminology drift | "Real estate professionals" vs. "land investing" |
| F-15 | HIGH | Onboarding assumes acquisition | Entire flow is about finding deals, not managing property |
| F-16 | CRITICAL | Deal Hunt | Shows distressed-seller data; alarming to passive owner |
| F-17 | MEDIUM | Atlas activation | No clear decline option, fear of autonomous AI |
| F-18 | MEDIUM | Property status options | No "owned/holding" status; all options are deal stages |
| F-19 | LOW | Market Value field | Asks user to input what they came to learn |
| F-20 | HIGH | Free tier paywall | Hits wall at 3 properties; needs 5 to evaluate product |

### Severity Distribution

- CRITICAL: 1
- HIGH: 7
- MEDIUM: 9
- LOW: 3

---

## Final Verdict

**Robert's likely outcome: ABANDONMENT at onboarding (70% probability)**

Robert is most likely to abandon during the Instant Deal Hunt step (F-16), when the product reveals that it is fundamentally oriented toward acquiring distressed properties rather than managing existing ones. The secondary abandonment point is the pricing page (F-5/F-20), when he realizes the free tier cannot hold his 5 parcels.

If Robert somehow persists through the full journey and adds his first parcel, he will have spent 21 minutes fighting through a flow designed for a different user. He will have been forced to select an investor path that does not match his identity, activate an AI system he does not want, and complete a deal-hunting exercise he finds ethically uncomfortable.

The product has strong capabilities that Robert would genuinely value -- Portfolio Mapping, AI Valuations, and property tracking -- but these capabilities are buried behind an acquisition-focused onboarding that assumes every user is an active deal-seeker.

**Robert's parting words:**

> "My nephew said this would help me keep track of my land. Instead, it tried to turn me into some kind of land speculator and then told me I can't even list all five of my parcels without paying. I think I'll stick with my spreadsheet."

---

## Top 5 Recommendations (Priority Order)

1. **Add a "Manage Existing Property" onboarding path** that skips deal hunting, county targeting, and strategy selection. Ask: "Do you own property already? Let's get it into the system." Go straight to property entry with map preview.

2. **Raise the Free tier property limit to 10** (or at least 5). Let users experience the core value (parcels on a map with valuations) before hitting a paywall. The lead limit (10) can stay low since that is the monetization lever for deal-seekers.

3. **Add a phone number or live chat to the landing page footer.** Robert -- and users like him -- will not email. A phone number is the single highest-trust signal for a less technical audience.

4. **Fix the auth page to default to sign-up mode when arriving from "Get Started" CTAs.** The code already supports `?mode=register` via query parameter. Update the landing page `Link` hrefs from `/auth` to `/auth?mode=register` on all sign-up CTAs.

5. **Unify the AI assistant branding.** Pick either "Sophie" or "Atlas" and use it everywhere. The landing page says Sophie; the onboarding says Atlas. This inconsistency erodes trust for users who are already wary of AI.
