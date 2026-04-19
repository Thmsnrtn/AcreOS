# First-Run Gap Diagnosis

## What a new user experiences post-onboarding

1. Complete onboarding-v2 wizard (6 steps, well-built)
2. Land on `/today` — NOT `/dashboard`
3. `/today` shows: greeting, stat cards (all zeros), priorities section (empty), goals (empty)
4. Sidebar shows 7 top-level groups with 30+ items across CRM (9 items), Campaigns (3), Inbox, AI Hub, Intelligence (9), Finance (4), Settings (4)
5. The GettingStartedChecklist component exists at `getting-started-checklist.tsx` but is only rendered on `/dashboard` (line 304) — NOT on `/today`

## Root Causes

1. **GettingStartedChecklist is on the wrong page.** It renders on `/dashboard` but new users land on `/today`. They never see it.

2. **30+ sidebar items all visible immediately.** CRM alone has 9 items (Leads, Skip Tracing, Properties, Portfolio Map, Deal Pipeline, Marketplace, Listings, Documents, Blind Offer Wizard). A new user with zero data doesn't need most of these.

3. **Empty /today has no guided next action.** The stat cards show zeros, priorities are empty, goals are empty. Nothing says "here's what to do first."

4. **Onboarding→product disconnect.** The wizard says "You're Ready to Find Deals!" then drops the user into a dashboard of zeros with no deals, no leads, no properties.

## Fix Recommendations (ranked by leverage)

| Fix | Leverage | Complexity | v5 Rework |
|-----|----------|-----------|-----------|
| A. Add GettingStartedChecklist to /today | CRITICAL | LOW | NONE |
| B. Add empty-state hero to /today when user has 0 parcels | HIGH | LOW | NONE |
| C. Collapse sidebar sections by default for new users | MEDIUM | MEDIUM | MINOR-UI |
| D. Add Atlas quickstart affordance to /today | MEDIUM | LOW | NONE |
