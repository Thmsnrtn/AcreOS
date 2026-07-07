# BECK ANDERSON — Dyslexic Land Investor, AcreOS Audit

**Wave 3 / Reading-disability lens · 2026-05-01**
*Beck Anderson, 38, Madison WI. Sixty parcels in seven states, mostly Midwest tax-deed and rural recreational. Dyslexic since I learned to read. I see fine — eyes are 20/20 — but a wall of dense text is a fence to me. I read about a third the speed of my wife. I bought my first parcel because the seller's call recording was thirty-seven minutes long and I could listen to it at 1.4× while folding laundry. The contract that came after took me four hours.*

---

## 1 · Thirty-Second Verdict

Reuben (the blind investor in Wave 2) gave you a **conditional yes**, contingent on the seven-day a11y sprint. I'll give you the same answer with a different shape.

**Today: I can use AcreOS. I can't use it well.**

The visual scaffolding is there — Reuben called it "the bones are right" and I'd say the same about the *visible* bones. The font system is real (variable Inter + Fraunces, five pairings including a `native` SF stack), spacing is tokenised, headings are present, the icon set is consistent (Lucide everywhere). For a dyslexic reader, those things matter as much as ARIA matters for Reuben. I noticed them within the first minute.

What stops me from saying "yes I love it" is the same class of defect that hurts Reuben, refracted through different glass. Reuben hears "image"; I see a hundred-word paragraph and slide off it. Reuben hears "button"; I see an unlabelled icon row and don't know which to click. Reuben needs `aria-label`; I need *visible* labels under icons. The **missing accommodation is the same one missing for him**: the team has not yet sat someone non-typical in the chair and watched them fail.

The thing that would convert me — the thing I would pay for — is a **"Read it to me" button on every legal document and every long Pax response.** Right now there is no TTS anywhere in the app despite Pax having a "voice mode" UI surface. That is the dyslexic-reader equivalent of Reuben's missing `<ChartDataTable>`. Same defect class. Same severity. Same cost to fix.

---

## 2 · Daily-Use Walkthrough As A Dyslexic Reader

Let me walk you through what my morning looked like.

### Login + landing — fonts feel right

Clerk login works fine; the form is short and labelled. I land on `/` and the first thing I notice is *the font is not bad*. That sounds like faint praise. It isn't. Most CRMs ship Roboto or Open Sans at 14px on a tight line-height and I bounce off them inside thirty seconds. AcreOS ships **Inter at the body, Fraunces at display, with `letter-spacing: -0.025em` on display headings and `line-height: 1.1`** (`client/src/index.css:938`). The body inherits Tailwind's default 1.5 which is honest.

Two specific wins for me:
1. **The `native` font pairing exists.** `client/src/fonts.css:130` falls through to system SF Pro. SF Pro Text is the single most dyslexia-friendly sans I've ever read — Apple did the work on it for VoiceOver users and the side-effect helps me. The fact that I can pick this in Settings → Appearance and the entire app rerenders against the system stack is *enormous*. I switched to `native` within five minutes.
2. **Five font pairings, no paid faces, no runtime CDN fetch.** I read the comment header in `fonts.css` and I almost laughed. Whoever wrote it cared about both performance and choice. That's the right instinct. Now extend it one more rung — see §4 below.

What's missing from the type system, that I'd notice immediately:
- **No OpenDyslexic or Lexend pairing.** Lexend in particular has measurable reading-speed gains for dyslexic readers (Bonnardel et al. 2019, then the Google Fonts team formalised it). Adding a sixth pairing called `accessible` with Lexend body + system display would cost one woff2 file (~80KB latin subset) and zero design effort. I'd switch to it on day one.
- **No "increase line-height" toggle.** Reading research is unambiguous: dyslexic readers benefit from **line-height ≥ 1.5 and paragraph spacing ≥ 1.5× line-height**. Tailwind defaults give me 1.5 on body, but `text-sm` (`leading-5` = 1.25) and `text-xs` (`leading-4` = 1.33) — used liberally throughout the app — are below that threshold. A density mode called `reading` (parallel to `compact`/`comfortable`/`adaptive` already in `theme-context.tsx:17`) that bumps every Tailwind text size to its more generous leading sibling would be ten lines of CSS.

### Pax responses — wall-of-text problem

I open Pax, ask "what's the IRR on Lot 14?". Pax streams back **a 280-word answer in a single paragraph.** No bullets. No bold. No section breaks. The streaming itself is fine — I can see the words landing. But by the time the answer is complete I am twenty seconds into staring at it and I have not finished reading the first sentence twice.

Looking at `property-analysis-chat.tsx:113`, every response paragraph renders as `<p className="text-sm leading-relaxed">`. `leading-relaxed` is 1.625, which is decent. But `text-sm` (14px) at 1.625 line-height is still a brick of small text. The renderer *does* parse markdown — `h2`, `h3`, lists are recognised at lines 70–113 — which means the **fix is upstream in the prompt**, not in the renderer. Pax should be instructed to:
- Open with a one-sentence headline (the answer).
- Follow with three bullets max.
- Reserve prose paragraphs for things that actually need them.

This is a `client/src/lib/pax-system-prompt.ts` (or wherever the system prompt lives) edit, not a UI edit. Devereux didn't catch it because he's auditing a11y; Aniyah didn't catch it because she's auditing sovereignty; I caught it on minute three.

The other Pax problem: **no "Read this aloud" button on responses.** The chat has a copy button, a regenerate button, a feedback thumbs. No speaker icon. The Web Speech API ships with every modern browser — `window.speechSynthesis.speak(new SpeechSynthesisUtterance(text))` is two lines. Add a speaker icon to every Pax message bubble that pipes the text through SpeechSynthesisUtterance with rate 1.0 (configurable 0.8–1.5 in settings). I would use it on every response longer than four lines.

### The legal documents — this is the killer

I navigated to the document generator (`document-generator.tsx`, 1,147 lines, which itself tells you something). I generated a sample purchase agreement.

What I saw: **a four-page single-spaced legal document, in the same body font as the rest of the app, no page breaks, no section anchors, no read-aloud, no plain-language summary.** The download is a PDF. The in-app view appears to be HTML rendered in a dialog with overflow scroll.

For a sighted typical reader this is fine. For me it is the moment I close my laptop and email the document to my wife to read out loud. Which I have done before, with previous CRMs, and which is why I no longer use those CRMs.

What this surface needs, in priority order:
1. **A "Read aloud" button at the top of the document.** SpeechSynthesisUtterance walking the rendered text node-by-node. Pause/resume. Same controls as a podcast. Highlight the currently-spoken sentence with a subtle background tint — that single feature, called "synchronized highlighting," is the difference between "I'm losing my place" and "I can follow along." The research term to google is "bimodal reading" if your engineer hasn't seen it before.
2. **A plain-language summary at the top.** Pax can already write these — feed the document text back into Pax with a "summarise this contract for a non-lawyer in 5 bullets" prompt and render it as a collapsible card above the legalese. Lila (Wave 1) asked for similar simplification on park-model contracts.
3. **A jump-table of contents.** Section anchors so I can skip to "Price," "Closing," "Contingencies," "Default" without scrolling through 200 lines of recital boilerplate. Auto-generate from `<h2>` tags.
4. **A reading-mode toggle that bumps font to 18px and line-height to 1.7.** Even *with* read-aloud, I sometimes need to read the contract myself when I'm somewhere I can't have audio playing. The current 14px legal font in a dialog is the dyslexic reader's nightmare.

If these four ship, my four-hour contract review becomes a forty-minute one. That's not a quality-of-life feature for me. That's the difference between closing a deal in the same week I receive the offer, vs. losing it.

### The dashboard — visual hierarchy is good, density is wrong

Today's dashboard at `/today` is dense. Cards are tightly packed, numbers stacked, labels small. For a dyslexic reader, the **density itself is the noise.** I cannot focus on the morning's most important number when nine cards compete for my attention with similar-weight typography.

Two specific wins I'd ask for:
- **One hero number per page, at display weight, in Fraunces, sized at 3rem.** Today's pipeline has it; lots of other surfaces don't. The hero number is what I look at first, and the rest of the page should clearly subordinate.
- **Cards in `comfortable` density should have ≥24px gaps.** Right now even `comfortable` density (`theme-context.tsx`) feels tight to me. Add a `reading` density that takes spacing one notch further.

The good news: the design system *can* express this. The CSS variables are routed through theme tokens. A `reading` density would be a one-file change in `theme-context.tsx` plus a global CSS rule keyed off `[data-density="reading"]`.

### Iconography over labels — the icon-button problem hurts me too

Reuben caught the unlabelled icon buttons because VoiceOver reads them as "button." I catch them because **I cannot reliably remember which icon means what** when there are six of them in a row with no text underneath.

The Pax composer at `pax-copilot-rail.tsx:1341,1547,1557,1589` is the offender. Six icon-only buttons. I know what most icons mean in isolation, but in a row, my dyslexic working memory drops one of the six. I'll click "voice input" when I meant "attach file" because they're adjacent and the icon shapes are similar.

The fix that helps both Reuben and me: **add visible text labels under each icon button, or behind a hover/long-press tooltip that's also keyboard-triggerable.** `aria-label` alone helps Reuben. `aria-label` + visible label or persistent tooltip helps both of us.

### Forms — the lead-creation form

`/leads/new` is fine for me. Short fields, visible labels, generous spacing. I had no friction. Forms are easy to design for dyslexia because the chunks are pre-cut for you.

Where forms break: **the description / notes textareas.** They render at `text-sm` with no max-width. A 2000-character free-text field that wraps at 1200px wide gives me a 110-character measure. Optimal reading measure is **45–75 characters per line**. Cap textarea width at `max-w-prose` (Tailwind's 65ch). One Tailwind class per textarea, app-wide.

### Tables — VirtualTable is hostile to me

Reuben hated this for screen-reader reasons. I hate it for visual reasons.

`VirtualTable` renders rows in a grid with no zebra striping (that I can see), and the row height is tight enough that on a long lead list my eye loses track of which row I'm on by row 8. The fix is one CSS rule: `nth-child(even)` background tint at 4% opacity. Add it on a `[data-table-stripe="true"]` attribute. Devereux's a11y mode might already enable it; for me it should be on by default and toggleable in Settings.

Also: **there is no "find within table"** that I noticed. ⌘F-in-table that scopes the browser find to the current table and highlights matches would be a 30-line component. I don't read tables top-to-bottom; I find the row I need and ignore the rest. Right now I scroll and squint.

### Audio briefing — the missed opportunity

I noticed `MorningBriefing.tsx` in the `founder/` directory (line 5: *"where each agent 'speaks' their update in character"*). The comment implies an audio mode. The implementation is purely visual — it's a card grid with text content per agent.

This is the closest thing AcreOS has to a TTS feature and **it's unused.** Wire it up: pipe each agent's text through SpeechSynthesisUtterance with a different rate per persona (Sophie quick, Atlas slow, Forge measured), and let me press play and hear my morning briefing while I drive to the post office to mail offer letters. That's a feature I would tell other dyslexic land investors about. There aren't many of us in this niche, but we read every recommendation thread, and we recommend hard.

### Cognitive load — one specific irritant

The page topbar is sticky. Fine. The breadcrumb in it changes per route. Fine. But **the topbar has no visible page title in display weight**, just a breadcrumb at body weight. When I land on `/parcels/abc-123` I have to read the breadcrumb to know where I am. A breadcrumb is *path*, not *identity*. I want both.

Add a 24–28px display-weight `<h1>` directly under the breadcrumb on every detail page. This is also what Reuben needs for `useDocumentTitle` parity in the visible UI — the same defect class shows up for both of us.

---

## 3 · Specific Failures, Ranked By How Much They Cost A Dyslexic Reader

| # | Where | The defect (visual) | What I want |
|---|-------|---------------------|-------------|
| 1 | Document generator output | 4-page legal doc, no read-aloud, no summary, 14px body | Read-aloud + plain-language summary + section anchors + reading mode |
| 2 | Pax response bubbles | Wall of prose, no TTS, no structure | "Read aloud" button + system prompt that prefers bullets + headline-first |
| 3 | `pax-copilot-rail.tsx:1341,1547,1557,1589` | Six icon buttons in a row, no visible labels | Visible labels under icons OR persistent tooltips (also fixes Reuben) |
| 4 | `theme-context.tsx:17` density modes | `compact`/`comfortable`/`adaptive` — no `reading` mode | Add `reading` density → 1.7 line-height + 24px gaps + max-w-prose textareas |
| 5 | `fonts.css` font pairings | 5 pairings, no Lexend / OpenDyslexic | Add `accessible` pairing (Lexend body) — 80KB latin subset |
| 6 | `text-sm` / `text-xs` everywhere | 14px and 13px at tight leading | Disallow `text-xs` for body content; bump `text-sm leading-5` → `leading-6` |
| 7 | `VirtualTable` | No zebra stripe, tight rows, no in-table find | nth-child(even) tint, ⌘F-in-table, taller rows in `reading` density |
| 8 | `MorningBriefing.tsx` | Comment says "speaks," code doesn't | Wire SpeechSynthesisUtterance per agent + play-all button |
| 9 | Page topbar (every detail page) | Breadcrumb only, no display-weight H1 | Add 24–28px H1 below breadcrumb on detail surfaces |
| 10 | Free-text notes textareas | Wrap at full container width (110+ chars/line) | `max-w-prose` (65ch) on every textarea |
| 11 | Today / dashboard | Nine cards, similar weight, no hero number | Promote one number/page to display weight + Fraunces |
| 12 | Settings → Appearance | Theme + font + density + motion, no "reading aids" | Add Reading Aids panel: line-height slider, font-size scale, reading mode toggle |

Twelve items. All cosmetic from one angle. All disabling from mine.

---

## 4 · The Fix List I Would Actually Build

I'm a builder, not just a critic. Here's the seven-day sprint I'd run if I were Thomas:

**Day 1 — Type system extension.**
Add Lexend variable woff2 to `client/public/fonts/`. Register a sixth pairing called `accessible` in `fonts.css`. Add it to the `FONT_PAIRINGS` array in `theme-context.tsx:21`. Settings appearance picker auto-renders it. ~2 hours.

**Day 2 — Reading density.**
Add `"reading"` to the `Density` type union (`theme-context.tsx:17`). Wire a `[data-density="reading"]` global CSS block in `index.css` that bumps `text-sm` to `text-base` leading, expands gaps, applies `max-w-prose` to long-form text. ~4 hours.

**Day 3 — TTS primitive.**
Build `useSpeechSynthesis()` hook returning `{speak, pause, resume, cancel, isSpeaking, voices, rate, setRate}`. Build `<ReadAloudButton text={…} />` component. Drop it on Pax message bubbles, document-generator output, and morning briefing. ~1 day.

**Day 4 — Document reading mode.**
The document-generator output dialog gets a toolbar: read-aloud, font size slider, line-height slider, jump-to-section dropdown. Plain-language summary card at top, generated by a new Pax prompt. ~1 day.

**Day 5 — Pax prompt structure.**
Edit the system prompt to require: headline-first sentence, bullets where possible, prose only when prose is right. Test against ten common questions, tune until responses are scannable. ~½ day.

**Day 6 — Icon labels + sticky H1.**
Visible micro-labels under composer icons. Display-weight H1 on every detail-page topbar. Same edits help Reuben (a11y) and the older Land Investor demographic Thomas keeps mentioning. ~½ day.

**Day 7 — Settings → Reading Aids panel.**
A new tab in Settings → Appearance that surfaces all the above as a single coherent set. Default state: off. Once-on: persists. ~½ day.

That's five engineer-days. Same scale as Devereux's a11y sprint. The two sprints overlap on icon labels and visible H1s, so running them together costs maybe seven calendar days for one engineer.

---

## 5 · Pricing — What I Will Pay

I run sixty parcels. My personal CRM bill is currently $340/month across three tools (one for leads, one for closings, one for accounting). I would consolidate to AcreOS at the **mid-tier** ($189/mo if Tegan's pricing holds) the day reading-aids ship.

I would pay an extra **$25/mo for a "Reading Aids Plus" add-on** if it included:
- Premium TTS voices (ElevenLabs or similar — the browser default `speechSynthesis` is robotic; for legal-document length content I want a pleasant voice).
- Per-document reading-time estimates ("this contract takes 18 minutes to read aloud, 6 minutes as summary").
- Audio export — download the read-aloud as MP3 to listen on my truck commute.

I would *not* pay for an "accessibility version" of AcreOS that's a separate SKU. Reuben said the same. We're aligned on this and the alignment is not a coincidence — disabled users have learned to spot the second-class-SKU pattern and we all bounce off it. **Build one app. Make the reading-aids opt-in inside the one app.** That's the deal.

---

## 6 · The Deal-Killer

Reuben's deal-killer was the charts. Mine is the **legal documents.**

I have to read contracts to close deals. AcreOS's whole value prop is that it generates contracts and helps me manage closings. If I cannot read those contracts efficiently — if the in-app document viewer is a wall of 14px legalese in a scroll dialog — then the product is asking me to leave the product to do the most important task it generates.

Today, that's exactly what I do. I download the PDF, AirDrop it to my iPad, open it in Voice Dream Reader (a third-party TTS app) and listen to it there. AcreOS gets none of that engagement. The PDF leaves the system and what comes back is "I'll sign" or "let me think about it." All the value of an integrated document workflow — version tracking, signature capture, audit trail — is gated behind a reading surface I cannot use.

Fix the document reading surface. Read-aloud, plain-language summary, jump-to-section, reading-mode font scaling. **One screen.** That's the product I would tell every dyslexic land investor about. There are more of us than you'd think — dyslexia rates are estimated 10–15% in the general US adult population, and *higher* in entrepreneurial small-business demographics (the famous Cass / Logan studies). In a Land Investors community of 50,000, that's 5,000–7,500 of us, and we will all hit the contract surface within the first week of trying AcreOS.

So: ship Days 3 and 4 of the sprint above. Skip the rest, ship those, and I'm a customer. Skip those, ship the rest, and I'm a four-hour-per-contract user who eventually leaves.

---

## 7 · A Note On Visual Patterns

One last thing, because this audit is about *me* and not just about TTS.

I read by **shape**, not by letter. Dyslexic readers chunk visual patterns — the silhouette of a word, the rhythm of a paragraph, the gestalt of a layout. AcreOS's design system is, accidentally, helpful here:
- The `homestead` and `meadow` themes have lower contrast than `quarry` or `nocturne`. For me, that's better — high-contrast pure black on white triggers visual fatigue. (For Reuben's low-vision peers, it's worse. Different defaults for different users — which is why a settings toggle, not a single ship-default, is the right answer.)
- Headings in Fraunces with `letter-spacing: -0.025em` are *visually distinctive enough* that I can scan a page and find them without reading them. That's the right move. Don't move headings to a sans-serif "to be modern." The display-serif gives me a shape anchor.
- Icon-led nav (sidebar at `layout-sidebar.tsx`) with text labels next to the icons is the gold standard. Icon-only collapsed mode is fine for me *because* I can hover and the label appears. Keep both.

The system is closer than the team realises. The pieces exist. They just haven't been pointed at this user yet.

---

## Postscript — How I Tested

Ninety minutes on Chrome 124 / macOS 15, font pairing set to `native`, density `comfortable`. Then thirty minutes with font pairing `editorial`, density `compact`, to see the worst case. Then fifteen minutes with the OS-level "Increase Contrast" and "Reduce Transparency" both on, to simulate the cumulative-fatigue state I'm in by 4 PM most days.

I read Reuben's audit before mine and was struck by how often our defects rhyme. They are different users with different disabilities and the *same six fixes* — visible labels, structural hierarchy, density alternatives, TTS primitives, reading-mode density, theme-token darkening — would resolve 80% of both audits. That convergence is the signal Thomas should pay attention to. Accessibility is not a checklist of conditions; it is **a small set of design decisions, applied consistently, that benefit everyone non-typical.** Make those decisions and you ship a better product for typical users too.

If Thomas wants me on the design partner panel along with Reuben, I'll show up. I'll record myself reading every screen aloud and send him the timestamps where I stalled. Until then, I'm rooting for you from my truck, where the only thing reading the contract to me right now is a third-party app I had to find on my own.

— Beck Anderson, May 1, 2026

*Chrome 124, macOS Sonoma. Notes captured by voice into Otter.ai, transcribed, then read back to me by my wife for sanity-check before I edited them. That last step is the one a Reading Aids panel would let me skip.*

*If anyone wants to talk about the dyslexic-investor design partner panel, my email is on file with Thomas. I answer within two days. I have to read the email first.*
