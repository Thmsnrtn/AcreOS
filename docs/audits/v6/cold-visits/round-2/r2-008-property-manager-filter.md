# R2-008: Property Manager (30 Units) -- Should Filter Out

**Persona**: Property manager, 42. Manages 30 residential rental units across 2 buildings. Looking for a CRM/management platform to handle tenants, maintenance requests, rent collection, and lease renewals.
**Device**: ThinkPad, Firefox
**Referral**: Google search "AI property management software"

---

## 1. CATEGORY (60 seconds)

**Score: 4 / 5 (for filtering)**

> "'The AI-Powered Platform for Land Investors.' -- Investors, not managers. And 'Land' -- I manage buildings, not land."

The headline filters effectively but not as instantaneously as it did for the RE agent (R2-004). The word "Platform" and "AI-Powered" initially caught their attention from the search results. They had to read the FULL headline to realize this isn't for them.

> "'Find motivated sellers. Analyze parcels. Send direct mail. Close deals.' -- None of this is property management. I don't find sellers. I manage tenants."

> "How It Works is entirely about land acquisition. Import parcels, AI analysis, direct mail, close deals. Zero mention of tenants, leases, maintenance, rent."

They scan the feature cards:

> "'Portfolio Mapping' -- I could map my properties, but I already know where they are. 'AI Valuations' -- maybe useful if I'm thinking of selling, but not my daily need. 'Campaign Automation' -- I need tenant communication, not seller outreach."

> "The Adjacent Verticals section lists 'Buy & Hold -- Rental portfolio management.' That's... actually me. But it says 'Coming soon.' So they KNOW property managers exist in their adjacent market but don't serve them yet."

This is the one moment where the visitor pauses:

> "If 'Buy & Hold' was available, I'd be very interested. 'Rental portfolio management' is literally my job title. But it's not built yet."

**Comparable**: They were looking for AppFolio, Buildium, or RentRedi. AcreOS is in a completely different category.

**Verdict**: Filters out correctly but slightly slower than the RE agent. The "Buy & Hold -- Coming soon" creates a brief moment of interest that doesn't convert.

---

## 2. VALUE PROP (60 seconds)

**Score: 4 / 5 (for filtering)**

> "'AI Deal Intelligence -- Sophie scores leads, drafts offers.' I don't need lead scoring. My tenants are already in the building. I need Sophie to handle maintenance tickets."

> "'Document Generation -- purchase agreements, contracts, closing documents.' I need lease agreements, not purchase agreements. Close but not the same thing."

> "'Compliance Built-In -- phone compliance, do-not-call lists.' I communicate with tenants, not cold prospects. Fair housing compliance would be relevant. DNC lists are not."

Every feature is recognizable to this visitor but misapplied. They can see the underlying capability (document generation, compliance, communication automation) but the specific implementation is for a different use case.

> "This is a well-built product for the wrong audience. If they redirected these same capabilities toward property management -- tenant CRM instead of lead CRM, lease documents instead of purchase agreements, rent collection instead of deal tracking -- it would be exactly what I need."

**Verdict**: Correctly identifies that the value prop targets land acquisition, not property management. The visitor recognizes the technical capabilities as transferable but not currently applicable.

---

## 3. PRICING (2 minutes)

**Score: N/A (filtered out)**

> "Pricing doesn't matter if the product isn't for me. But out of curiosity..."

> "'Pro at $49/mo' -- that's cheaper than AppFolio at $280+/mo for 30 units. If they built the Buy & Hold vertical, the pricing would be extremely competitive."

> "But I can't pay for features I can't use. 'Leads,' 'Properties,' 'Campaigns' -- these are the wrong nouns. I need 'Tenants,' 'Units,' 'Work Orders.'"

**Verdict**: N/A -- filtered before pricing engagement. Notes that pricing WOULD be competitive if the vertical existed.

---

## 4. SIGNUP READINESS (5 minutes total)

**Score: 3 / 5 (for filtering -- imperfect)**

> "I'm not signing up. But..."

The "But" is the problem. This visitor considers signing up for two reasons:

1. The waitlist: "There's a waitlist form at the bottom. 'Join the waitlist to get early access.' Maybe I should join for the Buy & Hold vertical."

2. The auth page: If they somehow navigated to /auth, the tagline says "The operating system for real estate professionals." That IS them. They ARE a real estate professional.

> "If someone sent me a direct link to the signup page without the landing page, and I saw 'The operating system for real estate professionals,' I might sign up thinking this was a general RE platform. The auth page is less well-filtered than the landing page."

> "I'll join the waitlist instead. Drop my email, say I'm interested in Buy & Hold. Maybe they'll build it."

The waitlist form captures their email with vertical="general" which doesn't specify which vertical they actually want. The form doesn't ask which vertical they're interested in -- it just sends a generic submission.

**Verdict**: Correctly does NOT sign up for the main product. But the waitlist form is a missed opportunity because it doesn't capture vertical interest. And the auth page tagline could create a false positive if accessed directly.

---

## 5. FIRST-RUN MENTAL MODEL (5 min post-signup)

**Score: N/A (filtered out)**

This visitor does not enter the product.

If they DID somehow sign up (auth page direct link scenario):

> The onboarding would present beginner/active/enterprise paths -- all framed around investing. The "Where Do You Want to Invest?" prompt would make no sense. They'd likely abandon within 60 seconds of onboarding.

**Verdict**: N/A

---

## TOTAL SCORE: 11 / 15 on applicable questions (filtering mostly works)

**Summary**: The headline correctly filters this property manager. "Land Investors" clearly excludes "Property Managers." However, the filter has two weak points: (1) the "Buy & Hold -- Rental portfolio management" waitlist item creates a moment of false hope that could distract from the core filtering, and (2) the auth page tagline "The operating system for real estate professionals" is broad enough to potentially capture a property manager who bypasses the landing page. The waitlist form is also a missed opportunity -- it accepts an email but doesn't ask WHICH vertical the visitor wants, so the signal is lost. For a property manager who joins the waitlist for Buy & Hold, AcreOS has no way to segment that interest from a generic submission.

**Recommendations**:
1. The waitlist form should include a vertical selector dropdown, not just an email field.
2. The "Coming soon" items should have individual "Notify me" buttons that tag the specific vertical.
3. The auth page tagline should match the landing page: "for Land Investors" not "for real estate professionals."
