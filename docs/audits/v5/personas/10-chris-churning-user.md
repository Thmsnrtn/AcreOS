# Persona 10 — Chris Hadley, Churning User

## Demographics
- **Name:** Chris Hadley
- **Age:** 37
- **Location:** Columbus, Ohio
- **Role:** Licensed real estate agent, Keller Williams franchise; solo practitioner

## Background

Chris has been a real estate agent for 9 years, mostly residential. Last year, a colleague mentioned that vacant land deals have higher margins and less competition. Chris got interested. He spent a few weekends learning about land investing — watched some YouTube videos, joined a Facebook group, and decided to try finding undervalued parcels in Franklin and Delaware counties where he already knows the market.

Chris is not a land investor by trade. He does not have a land-specific workflow, a mailing operation, or a portfolio of parcels. He has a real estate license, a CRM he already uses for residential deals (Follow Up Boss), and a vague idea that there might be a tool specifically for land.

He found AcreOS through a Google search ("land investment software"), signed up for a free trial 2 weeks ago, and has logged in 4 times. Total time in the product: about 35 minutes.

## Current Situation

Chris is frustrated and wants out. Here is what happened over his 4 sessions:

**Session 1 (Day 1, 12 minutes):** Signed up, completed onboarding. Was presented with pipeline, agents, organizations. Did not understand why he needed an "organization" as a solo agent. Created one called "Chris H Land" because the product required it. Looked for a way to search for undervalued parcels in Franklin County. Could not find it. Closed the tab.

**Session 2 (Day 4, 8 minutes):** Came back, tried again. Found the "Agents" section, hoped it would search for parcels. Read the agent descriptions but couldn't figure out which one finds undervalued land. Tried configuring one. It asked for inputs he didn't have (APN, owner name). Closed the tab.

**Session 3 (Day 9, 10 minutes):** Tried importing a list of parcels from the county auditor site. Downloaded a CSV from Franklin County's GIS portal. The CSV had different column headers than AcreOS expected. Import failed with a mapping error he didn't understand. Closed the tab.

**Session 4 (Day 14, 5 minutes):** Logged in to figure out how to cancel. Could not find a "Cancel Account" or "Delete Account" option. Looked in Settings, Profile, Billing. Found a billing section but it only showed his plan — no cancel button. Closed the tab and searched Google for "how to cancel AcreOS."

Chris is now in his **5th and final session.** He wants three things: cancel his subscription, export any data he entered (he manually added 4 parcels in session 2), and delete his account. He is annoyed, mildly hostile, and wants zero friction.

## Goal for Using AcreOS

Chris's goals have changed:
- ~~Find undervalued parcels in his county~~ (original goal, abandoned)
- Cancel his trial/subscription before he gets charged
- Export the 4 parcels he entered (addresses, his notes)
- Delete his account and all his data
- Never think about this product again

## Technical Comfort Level

**Moderate.** Chris uses technology daily for his real estate business — Follow Up Boss (CRM), DocuSign, MLS portal, Canva for flyers, Google Workspace. He can navigate most web apps without help. He is not technical enough to troubleshoot import mapping errors or understand API terminology, but he can find settings pages and fill out forms.

He will not contact support. He will not file a ticket. He will not wait for an email response. If he cannot self-serve his exit, he will dispute the charge with his credit card company and leave a negative review.

## Expectations Shaped by Other Products

| Product | Expectation Set |
|---------|----------------|
| **Netflix** | Cancel anytime, one click, immediate. No retention flow, no guilt trip, no "are you sure" gauntlet. Just let him leave. |
| **Spotify** | "Download your data" option in settings. Clear, self-serve. |
| **Amazon** | Account closure is findable (even if buried). Data export is available. Process completes without contacting support. |
| **Follow Up Boss** | His current CRM has a clear "Export All Contacts" button and a "Cancel Subscription" page in billing. It took 2 minutes. That is his benchmark. |

Chris expects cancellation and data export to be self-serve, immediate, and frictionless. Any barrier — even a reasonable one like a confirmation dialog — will feel like a dark pattern to him because he is already frustrated.

## Realistic Failure Modes

1. **Cannot find cancellation.** There is no "Cancel" or "Close Account" button anywhere in the settings. The only option is to email support@acreos.com. Chris does not want to email anyone. He wants a button. If he has to email, he will write an angry one-liner and then dispute the charge.
2. **Cancellation requires phone call.** The cancel flow says "Contact us to cancel your subscription." Chris will not call. He will dispute the credit card charge, leave a 1-star review on G2 and Capterra, and tell the Facebook group the product is a scam.
3. **Data export is incomplete or absent.** Chris clicks "Export" and gets a CSV with parcel IDs and status codes but not the notes he typed or the addresses he entered. Or there is no export option at all. His 4 parcels are trapped. This confirms his "data hostage" suspicion.
4. **Account deletion is not real.** Chris finds a "Delete Account" option, clicks it, confirms, and gets a message: "Your account has been scheduled for deletion in 30 days." He wanted it gone now. Or worse: he "deletes" his account, then can still log in the next day. The data is still there. He feels deceived.
5. **Retention dark patterns.** The cancel flow presents a 5-step wizard: "Tell us why you're leaving" (required), "Would you like to speak with a specialist?" (modal with no obvious close), "We'll give you 50% off for 3 months" (another modal), "Are you really sure?" (confirm dialog), and finally the actual cancel button. Chris is seething by step 2.
6. **Unexpected charge.** Chris signed up for a "free trial" 14 days ago. He just got charged $49 because the trial auto-converted and there was no reminder email. Now he is not just annoyed — he is actively hostile. He wants a refund AND account deletion.
7. **Orphaned organization.** Chris deletes his account but the organization "Chris H Land" persists in the system as an ownerless entity. If he ever signs up again (he won't), it will cause a conflict. More importantly, the product is now storing his organization name and any associated data with no owner and no consent.

## What Would Make Him Abandon

Chris has already decided to leave. The question is not whether he abandons — it is how he feels about AcreOS on the way out. This determines whether he:

**Leaves neutral** (if the exit is clean):
- Found the cancel button in under 60 seconds
- Exported his data in one click
- Account deletion was immediate and confirmed
- No charge on his card, or immediate refund if charged
- He forgets AcreOS exists within a week

**Leaves hostile** (if the exit has friction):
- Could not find cancellation without searching Google
- Had to email support or call someone
- Data export was incomplete or missing
- Was charged after the trial with no warning
- Leaves a negative review. Tells his Facebook group. Disputes the charge.

The exit experience IS the product experience for a churning user. Chris will judge AcreOS entirely on how cleanly it lets him go.

## Signature Quote

> "I don't care about your roadmap. I don't want a discount. I just want to cancel, get my data, and move on. Why is this so hard?"
