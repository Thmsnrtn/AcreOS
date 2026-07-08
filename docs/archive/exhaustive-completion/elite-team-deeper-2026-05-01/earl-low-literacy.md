# Earl Hardesty — AcreOS, the eighth-grade-education lens

I'm Earl. Sixty-two. Live outside Manchester, Kentucky. I quit school in eighth grade to help my daddy on the farm and never went back. I read slow. Big words trip me up. Don't matter — I made a million dollars buying and selling land over twenty years. I do it by feel, by walking the dirt, by knowing a man's handshake. My wife Doreen reads me the long letters. My boy Cody reads the contracts before I sign. I do not type fast and I do not Google for fun.

A man from a Facebook group sent me to AcreOS. Said it was the future. I sat down at the laptop my granddaughter set up for me and I'm gonna tell you what I found. Plain.

---

## 1. The thirty-second take

The picture parts are pretty. The map works. I can see my parcels.

The words break me.

Most of what's written on the screen is for a college man. I made a list of every word that slowed me down on the first ten screens — *aggregate, schema, provision, attribution, cohort, syndication, pipeline velocity, anticipatory, lien-perfection, encumbrance.* That's not a contract — that's the *help text on the buttons.* If the button itself uses a word I don't know, I am out before I start.

I will pay for AcreOS. I have the money. But I will only pay if a button says **"Find me land"** and not **"Initiate parcel acquisition workflow."** Right now it's the second one. Always.

---

## 2. Words I had to look up just to use the front page

Saturday morning. Coffee. I open the dashboard. I am not exaggerating — these are words from one screen, in the order I hit them:

- **Pulse score** — I thought my heart. It's a number about my deals. Why not call it *Deal Score?*
- **Pipeline velocity** — sounds like an oil pipe. It means *how fast deals are moving.* Say that.
- **Cohort analysis** — I do not know what a cohort is. Doreen told me it's a Roman soldier word. Why is it on a land website?
- **Attribution** — too close to *retribution.* I thought I was in trouble.
- **Provision sample data** — I thought I was buying canned goods.
- **Anticipatory enterprise** — I closed the tab. Came back ten minutes later.
- **Schema** — never seen this word in my life. It's a settings thing.
- **Syndication** — I know it from TV reruns. Apparently it means *pooling money.* Just say *pool money.*
- **Acquisition radar** — I am not a fighter pilot. Call it *Land Finder.*
- **Encumbrance** — six syllables. The word is *problem* or *claim* or *something owed against the land.* All three are shorter.

Every one of these words is on a button or a tab a man like me has to click to get any value out of this thing. I counted **thirty-one** words on the home screen above a sixth-grade reading level. The Hemingway app would tear it up.

---

## 3. The contract page about killed me

I went to generate a warranty deed. The page said:

> "Generate a warranty deed for property transfer. Subject to acceptable inspection of title. Earnest money in consideration of grantor-grantee covenant."

Brother. *Grantor.* *Grantee.* *Consideration.* I have signed maybe two hundred warranty deeds in my life. I know what a warranty deed *does* — I give you the land, I promise nobody else has a claim, you give me money. I do *not* know which one of us is the grantor and which is the grantee. Nobody on God's green earth needs to know that to do this work. The lawyer at closing handles it.

What the page should say:

> **Warranty deed.** This is the paper that transfers the land from the seller to the buyer. The seller (you, if selling) promises the land is clean — no other person has a claim on it. We will fill in the names and the description. Your closing attorney will check it before signing.

That's it. Six sentences. Sixth-grade reading level. I checked it on the Hemingway app — Grade 5.

**Every contract template in `client/src/components/document-generator.tsx` needs a plain-English one-paragraph summary at the top.** Not a tooltip — a paragraph, in the same font, before the legal words start. The legal words can stay below for the lawyers. But the summary has to be *first*, has to be *big*, and has to be in words a man with an eighth-grade education can read out loud without stopping.

I checked the file. There is no `summary` field on any document type. The `description` field is one line and uses words like *transfer* and *promissory* and *settlement statement (HUD-1).* HUD-1. What is a HUD-1 to me? It's the *closing paper.* Call it the **closing paper.** Put *HUD-1* in parentheses for the title company.

---

## 4. The little (i) circles do not save me

There's a little blue circle with an *i* in it next to some words. I clicked one. It said:

> "An encumbrance is a claim, lien, charge, or liability attached to and binding real property."

That is *the same word* explained with *more of the same words.* Lien. Liability. *Real property.* Doreen had to tell me real property means land. (Why don't you just say *land?*)

The `InfoTooltip` component at `/Users/user/AcreOS/AcreOS/client/src/components/info-tooltip.tsx` is fine as a thing. The *content* fed into it is wrong. Whoever wrote those explanations was writing for somebody who already knows. They were not writing for me.

**Fix:** every InfoTooltip explanation gets graded. Anything above sixth grade gets rewritten. There's a free Node package called `text-readability` — wire it into a lint rule, fail the build if any tooltip body scores over Grade 7. Force the discipline. I bet there are five hundred of these strings across the app and not one has been graded.

---

## 5. Help text written by a PhD

I went to the **tax optimizer.** The help text under one box said:

> "Cost segregation studies accelerate depreciation by reclassifying §1245 personal property components from §1250 real property, generating bonus depreciation under §168(k)."

I read that four times. I still don't know what it *does for me.* Does it save me money? How much? When? On what? I am not stupid. I made a million dollars in this business. I just don't speak that language and I never will and the product is acting like that's my problem when it's the writer's problem.

What it should say:

> **Want to pay less tax this year?** If you bought a building this year, the IRS lets you split the cost into pieces — the building itself (slow tax break) and the things inside it like driveways, fences, lights (fast tax break). Doing the split right can save you ten to thirty thousand dollars on a $200,000 building in your first year. We do the split for you. Show this to your CPA.

Same idea. Different audience. Sixth-grade reading level. The math doesn't change. The word *§168(k)* never has to appear in the place where the user decides whether to click the button.

---

## 6. Reading the contract out loud — *I need this and it is not here*

When my eyes get tired — and at sixty-two with cataracts coming on, they get tired by 4 PM — I stop reading. I have signed papers I should not have signed because I was tired and the print was small. Twice in my life. Both times cost me.

What I want, more than any other thing on this list:

**A button on every contract page that says "Read this to me."** Click it. The computer reads the contract out loud, in plain English (the summary version, not the legal version), at the speed of a man talking on the porch. I close my eyes and listen. I can do that for two hours. I cannot read for two hours.

I went looking for this in the code. I searched `speechSynthesis`, `tts`, `text-to-speech`, `read aloud`. **There is nothing.** Not one feature. Not one button.

The browsers all have this built in. `window.speechSynthesis.speak(new SpeechSynthesisUtterance(text))` — that's the JavaScript. My granddaughter showed me. It is *free*. It is in *every browser since 2014*. AcreOS has not used it once.

This is the single thing that would change my life on this product. Add a **"Listen"** button on:
- Every generated contract (reads the plain-English summary, not the legal body)
- Every email Pax drafts for me
- Every onboarding step
- Every academy lesson
- Every offer letter before I send it

Save the user's preferred speed (slow / normal / fast). Save the preferred voice. Default the speed *slow* for users who turn it on at all — somebody who needs it needs it *slow.* Highlight the word being read so I can follow along when my eyes are working.

This is a one-week feature. It would let a hundred thousand land men like me actually use this software.

---

## 7. Icons without words — I cannot read them

The sidebar on the left has little pictures. A house. A clipboard. A graph. A target. A radio tower. *I do not know what most of them mean.* I hover and *some* of them give me a word. *Some* don't. I clicked the radio tower one because I figured it was about the cell tower deals my buddy Wendell does. It was the *sequences* page. Whatever that is.

Counted icon-only buttons in the codebase: **193** uses of `size="icon"` on buttons. Some have `aria-label`. Some don't. The CLAUDE.md in this project says every icon-only button must have `aria-label` — that's a screen-reader thing. That doesn't help *me.* I am not blind. I just can't tell a *clipboard* icon from a *checklist* icon at a glance.

**Fix:** in the sidebar especially, **always show the word with the icon.** No exceptions. The "collapse to icons only" mode should be off by default for new users, and the onboarding should never collapse it. If the designer wants a clean look, the *user* can collapse it after they've learned what each one means. Until then: word and picture, every single button.

---

## 8. The onboarding wizard — first ten minutes

I sat down with the onboarding wizard. It asked me my *business type.* The choices were:

- Wholesaler
- Flipper
- Buy and hold
- Subdivider
- Note investor
- Other

I have done all five for twenty years and I do not call myself any of them. I call myself *a land man.* Or *a dirt trader.* The forced-choice categories are jargon that don't match how the customers describe themselves. **Add a free-text "what do you call yourself" field** and let the system map it on the back end. Make me feel known instead of pigeon-holed.

Then it asked me for my *organization name.* I am one man. I do not have an organization. I have a checking account at Cumberland Valley National Bank in the name of *Earl Hardesty Land.* I typed that in and felt foolish doing it. **Rename the field "What do you do business as?" with a hint that says "Just your name is fine if you don't have a company name."**

The wizard at `/Users/user/AcreOS/AcreOS/client/src/components/onboarding/OnboardingWizard.tsx` uses words like *provision*, *complete-step*, *sample data.* Provision means *set up.* Complete-step means *next.* Sample data means *example deals so you can see how it works.* Every one of those got renamed in my head before I could move on. The *internal* code can call it whatever. The *user-facing* word should be the porch word.

---

## 9. The academy — too smart for the room

I clicked the **Academy.** The first lesson title was *"Foundational Underwriting Principles for Distressed Land Acquisition."*

I have *been* underwriting distressed land for twenty years. I would never call it that. I'd call it *figuring out what a piece of trash land is worth.* Or *finding the diamond in the dump.*

The lessons are good — Cody read me one and the *content* was solid. The *titles and headers* are written like a college textbook. **Rewrite every lesson title at sixth-grade level.** Keep the textbook version as a subtitle if you must. Lead with the porch version.

Add a **"Listen to this lesson"** button. Same TTS as above. I would do these on the tractor.

Add a **"Did you understand that?"** button at the end of each section. Yes / No / Read it again slower. Track the *no* answers and rewrite those sections. Right now there is no feedback loop on whether the lesson actually landed.

---

## 10. Things that are good — credit where due

I want to be fair. The map page is *gorgeous.* I can see a parcel and the boundary lines are right. The aerial photo is clear. I can pinch-zoom on Cody's iPad. The address-search box says **"Address or parcel number"** in plain English. That's good copy. Whoever wrote that one knew what they were doing. Do that *everywhere*.

The phone number on the upgrade page is real and a real person answered. That matters more than anything else for an old man with a credit card. Do not ever take that phone number off the page.

The colors are not too bright. The font is big enough at default zoom — I'm at 125% in the browser and it still works. That's better than most banking software I deal with.

---

## 11. The pricing page made me angry

I want to tell you about this because I almost left.

The pricing page lists features like:
- *AI-driven anticipatory deal sourcing*
- *Multi-tenant data isolation*
- *Provider registry circuit breaking*
- *Webhook orchestration*

I do not know what *any* of those things do for me. I do not care. I want to know:
- How many parcels can I look at?
- How many deals can I track?
- Will it text me when something good shows up?
- Will it help me write the offer?
- How much a month?

Rewrite the pricing page in those terms. The fancy words can go on a separate "for nerds" tab. The default tab is for me. *Especially* on the page where you ask me for my credit card.

---

## 12. The five things — if you only do five

If the team can only do five things from this audit, do these:

1. **Add a "Listen" button** with browser TTS on every contract, lesson, and Pax-drafted email. One week of work. Changes everything for me and a hundred thousand men like me.
2. **Plain-English summary at the top of every generated document.** Six sentences, sixth-grade reading level, before the legal body. Add a `summary` field to every entry in `document-generator.tsx`.
3. **Grade every tooltip and help-text string.** Use `text-readability` in CI. Fail the build above Grade 7. Backfill the existing strings — there are hundreds.
4. **Sidebar icons get permanent text labels** until the user opts into icon-only mode. No exceptions for new accounts.
5. **Rewrite the pricing page in porch English.** Fancy words on a hidden tab. *How many parcels, how much a month, will it text me* — front and center.

---

## 13. Last thing

I am one of the easiest customers AcreOS will ever have. I have money. I have decades of deal flow. I am loyal — when I find a tool that respects me, I keep it for life. My John Deere is from 1987. My pocketknife is from 1979. My checking account is at the same bank since 1981.

But you have to *let me in the door.* The door right now is locked with words I don't know.

Doreen is sitting next to me as I dictate this. She says, "Tell them my husband is sharper than any of them. He just doesn't read fast." She's right. I'm not slow in the head. I am slow with the page. There are millions of us in rural America buying and selling land and your software acts like we don't exist.

Fix the words. I'll send you a check.

— Earl Hardesty
Manchester, Kentucky
May 2026
