# Persona 08 — Tom Beaulieu, Returning User

## Demographics
- **Name:** Tom Beaulieu
- **Age:** 45
- **Location:** Grand Junction, Colorado
- **Role:** Part-time land investor; full-time construction contractor (owns Beaulieu Contracting LLC)

## Background

Tom has been a general contractor for 20 years. Three years ago, a friend told him about buying rural land at tax sales. Tom liked the idea — passive income, no tenants, no toilets. He bought a course, watched some YouTube videos, and started acquiring small parcels (1-10 acres) in western Colorado and eastern Utah. He has completed about 15 transactions total, mostly through Craigslist, Facebook Marketplace, and one local land listing site.

Tom is not technical. He uses his iPhone for most things, has a desktop PC at home that his teenage daughter set up, and relies on QuickBooks for his contracting business. He can navigate websites and apps but does not troubleshoot problems — if something doesn't work, he closes it and tries later, or asks his daughter. He does not read documentation or watch tutorial videos unless he is stuck and frustrated.

Tom's contracting business is seasonal. He is slammed from April through October and has almost zero bandwidth for land deals. November through March is his land investing season. He signed up for AcreOS in January, spent about 6 hours setting it up over two weekends, imported 23 parcels from a spreadsheet his friend helped him make, configured some agents (he thinks), and then a big commercial project came in early February and he hasn't logged in since.

## Current Situation

It is now mid-April. The commercial project is winding down and Tom wants to get back into land investing for the summer lull between projects. He opens his laptop, finds AcreOS in his browser history, and clicks the link.

What Tom remembers:
- He signed up for something called AcreOS
- He put some parcels in there
- There were "agents" that were supposed to do things automatically
- He thinks he set up an organization but isn't sure what he called it

What Tom does not remember:
- Whether he signed in with Google or email/password
- What agents he configured or whether they are running
- The terminology the product uses (pipeline? leads? dispositions?)
- Whether he ever finished setting things up or left it half-configured

What he will encounter:
- A stale session that may or may not still be valid (he hasn't closed the browser tab in 2 months, but the laptop has been asleep)
- Possible authentication redirect that he wasn't expecting
- His 23 parcels, in whatever state he left them
- Agents that may have been running (or failing) for 2 months without his attention
- Any onboarding state he left incomplete

## Goal for Using AcreOS

Tom wants to:
1. Log back in without frustration
2. See his parcels and remember what he was working on
3. Understand what (if anything) happened while he was away
4. Pick up where he left off without re-learning the product from scratch
5. Eventually: add 10-15 new parcels from a tax sale list he just received

He does not want to re-do onboarding, re-watch tutorials, or re-read documentation. He wants the product to meet him where he is.

## Technical Comfort Level

**Low-to-moderate.** Tom can:
- Fill out forms and navigate menus
- Upload files if the process is obvious (drag and drop, or a clear "Upload" button)
- Use basic table sorting and filtering (column header clicks)

Tom cannot:
- Troubleshoot authentication issues beyond "try another browser"
- Understand error messages with technical jargon (400, 401, CORS, session expired)
- Distinguish between different agent types or remember configuration he did months ago
- Use keyboard shortcuts (does not know they exist)

## Expectations Shaped by Other Products

| Product | Expectation Set |
|---------|----------------|
| **QuickBooks** | Opens to a dashboard that shows the important stuff. Recent activity. Things that need attention. Does not dump him into a blank screen. |
| **Facebook** | Remembers him. Shows him what happened since he was last there. Notifications tell him what changed. |
| **Amazon** | "Your orders" shows him everything he's done. He can pick up where he left off. If he abandoned a cart, it's still there. |
| **iPhone apps** | Tap the icon, it opens where he left off. No re-login, no re-onboarding, no "welcome back, let's start from scratch." |

Tom expects continuity. He expects the product to remember his context and help him re-orient, not force him to re-learn.

## Realistic Failure Modes

1. **Session expired with no context.** Tom clicks his bookmarked URL. He gets redirected to a login page with no indication of why. He doesn't remember if he used Google or email. He tries email/password — "invalid credentials." He tries Google — it creates a new account instead of linking to his existing one. Now he has two accounts, zero parcels in the new one, and no way to reach his old data.
2. **Stale onboarding state.** Tom left the onboarding wizard at step 3 of 5 two months ago. When he logs in, the product dumps him back into step 3 with no option to skip or dismiss. He doesn't remember steps 1-2 and the context of step 3 makes no sense.
3. **Agents ran and failed silently.** The agents Tom configured have been hitting an API every day for two months and failing (perhaps his trial credits ran out). There are 1,400 error entries in a log he's never seen. The dashboard shows nothing about this. The agents appear "active" but have produced no results.
4. **Terminology confusion.** Tom clicks around and sees "Pipeline," "Leads," "Dispositions," "Agents," "Campaigns." He doesn't remember what any of these mean in the AcreOS context. There are no tooltips, no contextual help, no "what's this?" links.
5. **Data appears stale or wrong.** His 23 parcels are there, but some have statuses he doesn't recognize. Did he set those? Did an agent set those? There is no way to tell. No activity log, no "last modified by," no change history.
6. **Cannot find the thing he wants to do next.** Tom has a PDF list of parcels from a county tax sale. He wants to add them. He cannot find an "Import" or "Add Parcels" button. He looks in the sidebar, the top nav, the settings page. It is buried in a submenu he doesn't think to check.

## What Would Make Him Abandon

Tom will close the tab and go back to his spreadsheet if:

- **He cannot log in within 2 minutes.** If the authentication flow is confusing, broken, or creates a duplicate account, he will give up. He has a spreadsheet that works. It doesn't lock him out.
- **He cannot find his parcels.** If his 23 parcels are not immediately visible and recognizable after login, he will assume his data is lost and leave.
- **The product makes him feel stupid.** If the interface assumes he remembers the terminology, the workflow, and the configuration from two months ago, and provides no affordance for re-orientation, he will feel lost and frustrated. He will not ask for help — he will leave.
- **There is no clear "what happened while you were gone" summary.** If agents ran (or failed), and there is no notification, no badge, no summary, Tom will not know the product was doing anything. It will feel dead and pointless.

## Signature Quote

> "What was I doing in here again? I set this up back in January and I can't remember any of it."
