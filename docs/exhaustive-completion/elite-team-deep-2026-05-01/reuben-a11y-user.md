# REUBEN ALCOTT — Blind Land Investor, AcreOS Audit

**Wave 2 / Disabled-user lens · 2026-05-01**
*Reuben Alcott, 41, blind since age 6. VoiceOver on macOS + iOS. Twelve deals/year on my own books. I read Devereux's report after I tried the app, not before — I wanted to hear it first, then check whether his findings matched the noise in my ears.*

---

## 1 · Thirty-Second Verdict

Would I use AcreOS as a blind investor *today*? **No. But — and this is a real "but" — I would seven days from now if Thomas runs Devereux's sprint.**

That's a much better answer than I usually give. Most "modern" SaaS — and I have banned three of them from my workflow this year alone — is built on a foundation that is hostile to a screen reader. AcreOS is not. The bones are right. The Radix primitives are doing the work I need them to do. The skip-link works. Reduced motion works. The sidebar landmark is labelled. The form errors actually announce. I have used apps with ten times the marketing budget that fail every single one of those.

What stops me from saying "yes" today is a stack of small omissions that, in aggregate, mean I cannot run my pipeline by ear. Charts read as the word "image." The pipeline kanban tells me nothing about which deal is where. The page title never changes, so all twelve of my open tabs say "AcreOS." The send button on Pax — the AI I am supposed to talk to — announces as "button." Just "button." That's a one-line fix. And there are fifty-five of them.

Fix those, and I switch. Today, I close the tab and go back to my spreadsheet.

---

## 2 · Daily-Use Walkthrough With VoiceOver

Let me take you through what I actually heard, in order, on the morning I tried this.

### Login

I open `acreos.com`, log in with Clerk. **This works.** Clerk has been audited a hundred times and it shows. Email field announces "Email, edit text." Password field announces "Password, secure edit text." Sign-in button is labelled. I'm in. No sighted help required for the door. Good — most apps fail at the door.

A small footnote: the Clerk-proxied auth subdomain announces correctly because Clerk owns the markup. The instant I land on a page Thomas's team built, the experience changes. That is the tell I am listening for, and I hear it within the first five seconds.

### Landing on `/`

VoiceOver reads: "AcreOS, web content." That's the document title. It will read that exact phrase every time I switch tabs, every time I land on a new route, every time I wake from a sleep. I open eight tabs in a session and they are *all called AcreOS*. I cannot tell you how disorienting that is. The browser tab list — `VO-F2-F2` to bring it up — becomes useless. Devereux flagged this as 2.4.2 and rated it "easy fail." It is also, for me personally, the single most disabling defect in the app. `client/src/App.tsx` has no `useDocumentTitle` anywhere. I checked.

I press `Tab`. "Skip to main content, link." Good. I press `Return`. Focus jumps. I now hear the dashboard heading: "Today's pipeline, heading level 2." Then a long pause, then "image." That image is a Recharts sparkline at `client/src/components/analytics-content.tsx` somewhere around line 40, where Devereux logged the hardcoded color array. To me, that chart is *literally invisible*. Not metaphorically — there is no fallback text, no `<title>` element, no `aria-label`, no hidden `<table>`. Recharts ships with `role="img"` defaults and nothing else. So I am told there is an image and I am told nothing about what it depicts. This happens once on the dashboard. It happens five times on `/analytics`. It happens on `/portfolio-optimizer`. It happens on `/voice-analytics`. The application has eyes; I do not.

### Navigation — sidebar and ⌘K

I press `VO-U` for the rotor and select Landmarks. I get: "main, navigation Main navigation, navigation Breadcrumbs, complementary × 4." That's clean. I land in Main navigation, arrow down. "Dashboard, link. Parcels, link. Leads, link. Deals, link. Pipeline, link." Fourteen items, properly labelled, properly listed. `client/src/components/layout-sidebar.tsx:849` has the `aria-label="Main navigation"` and it pays off here.

What does *not* work: the collapse toggle at `layout-sidebar.tsx:1033`. I tab to it and VoiceOver says "button." That's it. Just "button." I have no idea if pressing it will collapse the sidebar, log me out, or order pizza. Devereux flagged this in row 3 of his Top-15 and he is correct. Add `aria-label="Collapse sidebar"` and `aria-pressed={collapsed}` and I know what I'm doing.

`⌘K` opens the command palette. cmdk — the underlying library — is one of the best-behaved screen-reader citizens in the React ecosystem. It announces itself as a combobox, announces the option count, announces selections as I arrow. Good. I type "leads" and I hear "Leads, 1 of 4." I press `Return`. I land on `/leads`. The page title still says AcreOS. Of course it does.

Devereux's keyboard journey Task 2 noted that opening the Pax rail does not auto-focus the textarea. I confirm it. I open Pax, then I have to tab through six elements in the rail header — "Close, button," "History, button," "Settings, button," and three more icons that announce as just "button" (those are items 2 in his Top-15) — before I land on the input. Six taps to type a question to my AI assistant, every single time. Radix's `onOpenAutoFocus` would fix this in two lines. The fact that nobody has flipped that switch is the kind of detail that tells me nobody on the team has actually tried to use Pax with a screen reader.

Once I am in the input and type a message and hit `⌘+Return`, the response streams in. I do hear it — the streaming region has `aria-live="polite"` per Devereux's note on `property-analysis-chat`. That's good. But the send button itself, when I tab to it instead of using the keyboard shortcut, says "button." Just "button." That is `pax-copilot-rail.tsx:1622`. The most-used button in the most-used surface in the application is unlabelled.

### Pipeline — the kanban question

This is the test that breaks most CRMs for me.

I navigate to `/pipeline`. Heading: "Pipeline, heading level 1." Then a row of column headings: "Lead," "Qualified," "Offer Out," "Under Contract," "Closed." I tab into the first column. I hear: "View, link." Then "View, link." Then "View, link." Eleven of them in a row. **I cannot tell which deal is which.**

Looking at the markup later, I see that the deal cards are `<div onClick>` wrappers — Devereux flagged the same pattern in `parcels` lists in his keyboard-journey Task 1, and it generalizes. The "View" link inside is the only focusable element, and its accessible name is the literal word "View." There is no `aria-label="View 1240 Pine Acre Drive, $48,000 offer pending"`. There is no `aria-describedby` pointing at the deal title. From a sighted user's perspective the card is information-dense and obvious. From mine, it is eleven copies of the word "View."

Fix: each card should be a `<button>` or `<a>` whose accessible name is the deal's natural-language summary. "1240 Pine Acre Drive, Lead column, offer pending forty-eight thousand dollars." Done. I can run the pipeline.

Bonus pattern: support left/right arrow to move a focused card between columns, with a live-region announcement on each move ("Moved 1240 Pine Acre Drive to Under Contract"). Trello-style. Sighted users get this for free with drag-and-drop; for me it would be the *only* way to reorganize the pipeline without a mouse. This is a feature most kanban implementations skip and it is the difference between a kanban I can use and one I cannot.

### Forms — creating a lead

`/leads/new`. Form opens. First field: "First name, edit text, required." Good — required is announced. Second field: "Last name, edit text, required." Third: "Email, edit text." Wait — was that one required? It's a required field in the schema. I check the source: `aria-required` is missing from about half the inputs. Devereux caught this in section 6 item 7. The shadcn FormMessage works (errors announce after submit), but I should not have to *fail submission* to learn that a field is required. That's a 3.3.2 issue at minimum.

Disabled "Save" button, after I left the email blank: VoiceOver says "Save, dimmed, button." Why is it dimmed? No `aria-describedby` pointing at the validation message. I have to tab around hunting for the error. Devereux's keyboard Task 3 noted the same.

### Color and theme

I cannot evaluate color directly. But I can evaluate the *system* that produces colors, and the system is sound: theme tokens routed through CSS custom properties, with light/dark variants for each of homestead/quarry/nocturne/meadow/slate. Devereux's contrast matrix tells me that 8 of 10 theme/mode combos fail SC 1.4.3 on `--acr-ink-3`. That is the helper-text everywhere — table secondaries, breadcrumb separators, form helpers. The fix is one line per theme: darken the token. Thirty minutes. There is no excuse for shipping a 2026 SaaS app with 8/10 themes failing AA on the most-used secondary text token, and I will write that sentence verbatim into any review I publish if it is unfixed at GA.

### iOS — a brief note

I also tested for thirty minutes on my iPhone with VoiceOver. The mobile bottom nav is labelled correctly (Devereux's note on `MobileBottomNav` checks out), the swipe-to-explore reads each tab with its label, and the touch targets are honestly the right size — `max-sm:h-11 max-sm:w-11` on the Button primitive does the work. Where mobile falls down: the parcel detail page on iOS gets stuck in a focus loop where the sticky `PageTopbar` re-announces its breadcrumb every time I swipe past it. That's a `aria-hidden` story, not a focus-trap story, but it is annoying enough that I avoided the mobile app after fifteen minutes.

### Charts — the worst chapter

I have to write this part with some restraint because it is the single thing that makes me question whether anyone tried VoiceOver before shipping.

`/analytics`. There are four charts on the page. VoiceOver reads, in order: "image. image. image. image." Then it says "Cash flow trend, heading level 3," and then "image" again because there is a fifth chart underneath that heading. Recharts renders an `<svg>` and Recharts in 2026 still does not auto-generate `<title>` or `<desc>` elements. Devereux's seven-day sprint allocates Day 3 to a `<ChartDataTable>` companion component, and that is the right call. A visually-hidden `<table>` mirroring the data series — column headers as months, rows as metrics, values as the chart values — is the WAI-ARIA-recommended pattern for data viz, and it is the difference between "I cannot use this app" and "I can use this app."

Until that ships I will tell you, plainly, what I do: I screenshot the chart, send it to Be My AI, and listen to GPT describe it. I have to leave the app to read the app. That is absurd.

### Tables — VirtualTable

I open `/leads`. The lead table loads. VoiceOver reads it as a sequence of cells, but every time I move down a row, *the column context is lost.* I hear: "John Davis. Hot. Phoenix. April twelfth." But I do not hear "Name: John Davis. Status: Hot. City: Phoenix. Last contact: April twelfth." Because `VirtualTable.tsx` is a grid of `<div>`s, not a `<table>` with `<th scope="col">`. When VoiceOver crosses cells it has no header to re-announce. Devereux logged this at section 6 item 10. Either real `<table>` semantics or `role="grid"` + `role="columnheader"` + `aria-rowindex`/`aria-colindex` will fix it. Currently I am told four data points per row with no labels. By the fifth row I have lost track.

### Modals + drawers

Radix Dialog is correct. Focus traps. Esc closes. Title announces. Devereux noted that `pax-schedule-button` returns focus to `<body>` instead of the trigger, and I confirmed it: open the schedule, hit Esc, my next Tab lands on the skip-link because focus has fallen all the way back to the top of the document. That is annoying but not disqualifying.

The dialog's traffic-light close button at `client/src/components/ui/dialog.tsx:62` strips its own focus ring with `focus:outline-none`. That doesn't affect me directly — I cannot see the ring — but it affects every keyboard-only sighted user. It's an own-goal.

### Notifications

Toast notifications announce. The region is `aria-live="polite"`. I tested by triggering a save. I heard "Lead saved." Good. The Pax notification bell — `notification-banner.tsx` — announces only the badge count, not the context. "1, button." Should be "Notifications, 1 unread." Devereux item 5 in the screen-reader journey.

What I want — and this would be a real differentiator — is for the toast queue to also feed into a "VoiceOver history" panel that I can revisit. When VoiceOver is busy reading something else, polite toasts get queued and sometimes dropped, and I miss them. A persistent activity log keyed off the toast region would let me catch up. It's not a WCAG requirement; it's just good design for me.

### Demo / live-product mode

I tested the in-app demo at `live-demo-mode.tsx`. The step indicator at line 284 is, I want to say, *delightful.* It announces "Step 3 of 8" via a proper `role="img" aria-label`, and pause/resume/cancel buttons all have labels. That is a beautifully accessible component and Devereux's own audit calls it out as a template. **Use it.** Clone the pattern into the onboarding wizard step dots (`onboarding-wizard.tsx:468,769`), into any progress UI, into the deal-stage stepper. Whoever wrote `live-demo-mode.tsx` understood the assignment. Bring them in to retrofit the rest.

### Heading hierarchy

`VO-U` → Headings → Settings page. I get: H1 "Settings," H2 "Plan," H4 "Add more seats." That's the `h2`→`h4` skip Devereux logged at `client/src/pages/settings.tsx:543`. The rotor is how I navigate large pages. When the hierarchy lies, the rotor lies. I cannot trust the structure. Five minutes of fixes scattered across six pages.

If you have never used the Headings rotor, it is the thing that makes long pages tractable. I can list every heading on the page and jump directly. A broken hierarchy means I jump to a section and have no sense of where I am in the document, because the levels do not nest. This is one of those defects that costs nothing to fix and is purely a matter of someone running `axe-core --tags=wcag2a,wcag2aa` once.

### Color reliance

I cannot test this myself, but I read the source. `voice-analytics.tsx:41`, `portfolio-optimizer.tsx:49`, `regulatory-intel.tsx:283` — risk swatches communicated by red/green/amber alone. My low-vision colleagues — and there are more of them in land investing than you would think, because the demographic skews older — *cannot* parse these. Devereux's fix: pair every coloured chip with an icon (`AlertTriangle`, `CheckCircle`). Standard. Should already be there.

---

## 3 · Specific Failures I Hit, Ranked By How Much They Cost Me

| # | Where | What VoiceOver said | What it should have said |
|---|-------|---------------------|--------------------------|
| 1 | `client/src/App.tsx` (no per-route title) | "AcreOS" on every page | "Pipeline — AcreOS," "Lead: John Davis — AcreOS," etc. |
| 2 | `analytics-content.tsx:40` and every other Recharts | "image" | The chart's actual headline trend, plus a hidden data table |
| 3 | `pax-copilot-rail.tsx:1622` (send button) | "button" | "Send message" |
| 4 | `pax-copilot-rail.tsx:1341,1547,1557,1589` (composer icons) | "button" × 4 | "Insert template," "Voice input," "Attach file," "Clear chat" |
| 5 | Pipeline kanban deal cards | "View, link" × 11 | "1240 Pine Acre Drive, offer pending $48,000, view" |
| 6 | `VirtualTable.tsx` | Cell values without headers | Cell values prefixed by column name on each row |
| 7 | `layout-sidebar.tsx:1033,1334,1504` | "button" × 3 | "Collapse sidebar," "Pin sidebar," "Close mobile menu" |
| 8 | `pax-thinking-block.tsx:17` | "button" (chevron) | "Show reasoning, collapsed" with `aria-expanded` |
| 9 | `onboarding-wizard.tsx:468,769` (step dots) | "button" × N | "Step 3 of 6: Pricing, current step" |
| 10 | `floating-action-button.tsx:108` | "button" (Plus icon) | "Create new" |
| 11 | `notification-banner.tsx` (bell) | "1, button" | "Notifications, 1 unread" |
| 12 | Form fields (half of Lead form) | required-ness silent | `aria-required="true"` on every required input |
| 13 | `pax-schedule-button` modal | Focus returns to body on Esc | Focus returns to trigger button |
| 14 | Settings page rotor | h2 → h4 skip | h1 → h2 → h3 → h4 |
| 15 | Recharts SVG | No `<title>` or `<desc>` | Both, plus `role="img" aria-label="..."` |

Devereux had fifteen items. I confirmed every one of mine maps to one of his — which means his audit is *accurate from the user's chair*, not just from a checklist. That's rarer than it should be.

---

## 4 · The "Would I Switch" Threshold

I currently use a spreadsheet, a notebook (the paper kind, with bumpdots so I can find the columns), and a phone. I switch to AcreOS the day all of this is true:

1. **Per-route document titles.** This is one hook (`useDocumentTitle`) called from ~80 page components. Half a day for a contractor. Without it, I cannot use my own browser tab list, and I will not use any web app where I can't use the tab list.
2. **`aria-label` on the 55 raw icon buttons.** This is the codemod Devereux scoped for Day 2. Lint rule + grep + write. One day.
3. **A `<ChartDataTable>` companion for every Recharts chart.** This is the hard one — but every chart has its source data already in the React state. The component is ~30 lines and gets used everywhere. Maybe two days, including the audit pass.
4. **Pipeline cards as `<button>` or `<a>` with full accessible name.** Half a day.
5. **`VirtualTable` with `role="grid"` and column headers.** One day. TanStack Table v8's accessibility mode does this for free if they migrate.
6. **`--acr-ink-3` darkened to ≥ 4.5:1** for every theme combo. This isn't for me — I can't see colors — but it's for my low-vision peers and the older land investors Thomas keeps mentioning. Thirty minutes.

That's Devereux's seven-day sprint. **I would not need anything beyond that** to move my twelve-deal book onto AcreOS. None of this is novel research. None of this is custom. All of it is one engineer with the audit document in front of them.

---

## 5 · Pricing — At What Price Would Accessibility Be Enough

This is the question nobody asks me, so I'll answer it twice.

**Sighted-user price ($89/mo, $189/mo, $389/mo or whatever Tegan lands on):** I will pay the same price as a sighted user. I do not want a discount. I do not want a "limited free tier for accessibility users" — I have heard that pitch and it is patronizing and it always degrades the product for us because it becomes a second-class SKU. Charge me full price. Ship me a usable app. We're done.

**What I will *not* pay for:** an app that requires me to use an "accessibility mode" toggle. Accessibility mode is a code smell. It means the real app isn't accessible and the team built a stripped-down fork to claim WCAG. I have used three of those. They are always behind on features by 9–12 months and they are always missing the thing I most need that day. Build *one app* that is accessible. That's the deal.

I have specifically banned three SaaS tools from my workflow this year for this exact pattern. I won't name them publicly, but two of them are CRMs that the land-investing community on Reddit recommends constantly. I read every recommendation thread, I write a polite note explaining what fails, and the founders never reply. If Thomas replies — even once, even with "we'll fix it next sprint" — he is already ahead of every competitor in this category.

**What I *will* pay extra for** — and this is interesting — is a "Pax voice mode" that I can drive end-to-end by speaking. AcreOS already has voice infrastructure (`/voice-analytics` exists). If Pax can take a verbal "show me my pipeline, ranked by closing date, read the top three" and respond by voice, that is *more* useful to me than a perfectly tagged DOM. I would pay $50/month on top of base for that. It is a competitive moat *specifically* for the disabled and aging-investor segment, which by my count is at least 8% of the active land-investing population in the US, and growing as the demographic ages.

So my pricing answer is: full base price for an accessible app, plus a +$50/mo voice-driven add-on that I would buy on day one.

---

## 6 · The Deal-Killer

There is exactly one thing in this codebase that, if it shipped to GA without fixing, would tell me Thomas does not actually intend to serve me — and would mean I would not just decline to use AcreOS, I would warn the screen-reader community off it.

**It is the charts.**

The icon-button labels are an oversight. The document titles are an oversight. The kanban cards are an oversight. I forgive oversights. Every codebase has them; the question is whether the team patches them when told.

But Recharts reading as "image" — *for an investing app where the entire value proposition is data* — is not an oversight. It is the default behavior of a library that the team chose, and the choice has stood for however many releases. Every chart on every dashboard, every IRR plot, every cash-flow projection, every demographic distribution, every comp distribution — silently invisible to a blind investor. The product *is* the charts. If the charts are inaccessible, the product is inaccessible, full stop. It does not matter how good the rest is.

So: ship the seven-day sprint, give me `<ChartDataTable>`, and I am a customer. Skip Day 3, ship the rest, and I am still a sighted-eyes-only product, and I will say so publicly.

I think Thomas will fix it. The shape of this codebase — the `MotionConfig reducedMotion="user"`, the `SkipToContent`, the labelled landmarks, the working live regions, the mobile 44×44 hit targets — tells me someone on this team *cares*. The defects are not the defects of a team that does not care. They are the defects of a team that has not run VoiceOver yet.

That distinction matters more than people realize. A team that doesn't care will argue the audit. A team that cares will read it, schedule the work, and ship it. Devereux gave them the seven-day plan. I gave them the user-level translation. Now it is a calendar problem, not an engineering problem, and the calendar problem is one founder deciding whether the next sprint is "another feature" or "the people we already excluded."

So run it. I'll send my keyboard.

---

## Postscript — A Note On How I Tested

I tested for ninety minutes on macOS 15 with VoiceOver on Safari, then thirty minutes on iOS 18 with VoiceOver on Safari mobile. I did not look at the screen — my partner sat across the room and confirmed afterward that the visual state matched what I had inferred from audio, which is how I always validate my notes.

I read Devereux's audit *after* finishing my own walkthrough. Every defect I logged independently maps to one of his fifteen items. That convergence matters: it means the codebase's accessibility problems are not edge cases or matters of opinion. They are objective, reproducible, and fixable in the order Devereux laid out.

If Thomas wants me on the design partner panel for the seven-day sprint, I will show up. I will run VoiceOver on every PR. I will tell him when "image" becomes "Cash flow trending up twelve percent week over week." Until that day, I am rooting for you from the spreadsheet.

— Reuben Alcott, May 1, 2026

*VoiceOver, macOS Sonoma, Safari 17. iOS 18, VoiceOver, Safari mobile. Notes captured by voice into Drafts; transcribed and edited by hand.*

*If anyone wants to talk about the design partner panel, my email is on file with Thomas. I answer within a day. Always have.*
