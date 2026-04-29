# Prototype → Production Design System

**Phase A output for the AcreOS production port.** Single source of truth for
tokens, type pairings, component mapping, density rules, motion specs, and
voice. Read top-to-bottom before touching production CSS or components.

Source of canonical values: `~/Desktop/acreos-design-export/` (extracted from
`AcreOS-design-export.zip`). When this doc and the export disagree, the export
wins — update this doc.

---

## 0. Why this exists

The prototype lives at `acreos/*.jsx`, hand-rolled CSS, no module system, no
types, designed for taste-only review. The production app lives at
`client/src/` with Tailwind + shadcn + wouter + Tanstack Query and is the only
thing that ships.

The prototype's **values** (hexes, spacing, type, motion) are the spec. Its
**mechanism** (inline `<style>` strings, `window.*` globals, A/B/C component
ladders) is throwaway. Phase A captures the values; Phases B–H apply them to
production.

Read alongside `~/Desktop/acreos-design-export/handoff/HANDOFF.md` (canonical
component table, globals replacement guide). The directive in
`docs/exhaustive-completion/_progress.md` is the operational plan.

---

## 1. North star — voice exemplar

Every UI string, marketing surface, error message, and AI agent output passes
this test: **could it live in the same document as this letter?**

> **WHY WE BUILT THIS**
> *A land investor who couldn't stop building systems.*
>
> I'm a land investor, and I'm the kind of person who can't leave a broken
> system alone. For years, my operation ran on a spreadsheet, a dozen browser
> tabs, AI assistants that didn't know what I was working on, and a stack of
> emails and voicemails that kept growing while I tried to close deals.
>
> It mostly worked. But the leaks were everywhere. A reply missed by a day. A
> skip-trace I'd already paid for. A mailer to a seller who told me no six
> months ago. Each one was small. Together they were the difference between a
> good year and a great one.
>
> AcreOS is what came out the other side. Three agents — Atlas, Pax, Sophie —
> that handle the parts of the job that should never have been manual.
> Comping, replies, loan servicing, follow-ups. They run in the background.
> You stay on the decisions only you should make.
>
> The rule is honesty. Every agent shows its work — what it did, what it
> used, how confident it is, what it skipped. You can pause anything, edit
> anything, override anything, in one click.
>
> If you're running a land business and the seams are starting to show, this
> is built for you.

This letter ships verbatim somewhere accessible (about page, `/why`, or the
landing flow). It is also the voice exemplar for everything else.

### 1.1 Voice rules

- **Specific over vague.** "A reply missed by a day" not "missed
  opportunities."
- **Honest about problems.** Don't pretend things were fine before AcreOS.
- **Plain language with occasional editorial heft.** "The seams are starting
  to show" is fine. "Synergize your workflows" is not.
- **Trust the reader.** No condescension, no "as you may know."
- **The rule is honesty.** Applied to AI: every agent shows what it did, what
  it used, how confident it is, what it skipped. One-click override on
  anything.

### 1.2 Voice anti-patterns — never write any of these

- Hype: supercharge, revolutionize, game-changer, unleash, unlock
- AI buzzwords: powered by AI, intelligent, smart (the product), magical
- Fake urgency: limited time, act now, only X spots left
- Fake personalization: "Hi {name}, we noticed you..."
- Bro tone: crush it, beast mode, hustle, grind
- Corporate stiff: synergy, leverage, paradigm, solutions (as a noun)
- Cutesy: Yay! Awesome! You're amazing! Great job! 🎉

If tempted to write any of these, stop and rewrite.

### 1.3 AI agent framing

Three coworkers, each one word for the role:

| Agent | Role | What it owns |
|---|---|---|
| **Atlas** | Analysis | Comps, valuations, parcel research, market signals |
| **Pax** | Communication | Replies, drafts, mailers, follow-ups, outreach |
| **Sophie** | Servicing | Loan servicing, document handling, transactional ops |

Visual presence: subtle named-agent attribution. Quiet bylines: "Atlas
suggested this." "From Sophie's analysis." Never an AI badge or banner. Once
the user accepts a suggestion, the byline persists for provenance traceability
but doesn't shout.

The rule of honesty: every agent output exposes what it did, what sources it
used, how confident it is, what it skipped. One-click pause / edit / override
on every action.

---

## 2. Visual baseline

Design family (vibe space, not literal references): Stripe + Apple HIG +
Things 3 + Substack/Read.cv + Craft + Notion (warm, not playful) + Arc
(considered, not expressive). Through-line: **restraint and craft.**

Aesthetic register: clean marketing-site flourish (landing, pricing, hero
moments) + Apple HIG discipline (in-app component grammar) + occasional
Sequoia-register material moments (subtle translucency for floating cards,
soft glows for emphasis — not visible glass as decoration).

**Calm dominates.** Every surface, every state. No celebrations beyond subtle
acknowledgment ("first deal closed" as a quiet text moment, never confetti).
The work is its own reward.

### 2.1 Density principle

Default to breathing room. Allow density only where genuinely needed (long
lists, deal grids, audit logs). Most surfaces feel calm and considered;
workflow-heavy surfaces (pipeline, inbox, contacts, tables) get density when
function genuinely demands it. Things 3 / Linear pattern, **not** the
Salesforce pattern.

User control: per-list-type preference (rows / cards / expand-on-click) with
sensible defaults per surface, persisted per user.

### 2.2 Motion principle

macOS-standard motion. Clean, purposeful, never noisy or clunky.

- **150–250 ms** transitions on most state changes
- Native easing curves (cubic-bezier matching macOS — see §3.4)
- Clear hover states; no ambient motion
- Page navigation feels instant
- Small state changes get a quick subtle transition
- No parallax, no auto-rotating elements, no decorative loops, no
  scroll-jacking

If a transition doesn't serve clarity, remove it.

### 2.3 Visual anti-patterns — explicitly avoid

- **Brutalism** — raw harsh edges, bare structure
- **Heavy glassmorphism** — visible frosted glass everywhere (subtle Sequoia
  translucency only)
- **Skeuomorphism** — leather, paper textures, faux-physical
- **Generic SaaS dashboard** — KPI tile grids, gauge widgets, the
  Salesforce/HubSpot register
- **Gradients-as-design** — rainbow, mesh, gradient text (single subtle
  gradient as accent is fine)
- **Crypto / web3** — neon, gradient text effects
- **Dribbble illustrations** — overly polished startup illustrations of
  people pointing at floating UI cards

### 2.4 Interaction anti-patterns

- Aggressive onboarding modals or tour overlays
- Notification bombs
- Excessive empty-state celebration (confetti, balloons, big emoji)
- Forced gamification (streaks, badges, points, leaderboards)
- Auto-playing video on load
- Cookie banners that block content
- Newsletter / discount / chat pop-ups
- Forced "rate us" prompts

### 2.5 Brand identity — products to NOT feel like

If AcreOS starts to feel like any of these, you've drifted: Salesforce /
HubSpot, Zillow / Redfin, REIPro / Carrot, generic SaaS landing pages
(Calendly / Typeform), AI hype products (ChatGPT clones), crypto / web3.

---

## 3. Token inventory — five themes × light/dark

Lifted verbatim from `~/Desktop/acreos-design-export/acreos/theme.jsx`. Every
hex below is what design signed off on; do not approximate during port.

### 3.1 Theme catalogue

| ID | Display name | Tagline | Mood |
|---|---|---|---|
| `homestead` | Homestead | Warm earth, terracotta, cream | House brand. Default. |
| `quarry` | Quarry | Editorial stone, ink, one red | Monochrome editorial, FT/NYT energy |
| `nocturne` | Nocturne | Operator dark, one signal | Linear/Arc, single red signal |
| `meadow` | Meadow | Sage, honey, daylight | Optimistic, human, daylight |
| `slate` | Slate (renamed from `titan`) | Clinical blue-grey, data-dense | Finance / terminal |

**Rename note.** Prototype uses `titan` as the ID. Production uses `slate` to
remove the superhero association. **All other theme IDs are locked as-is.**

Each theme is a different product mood — neutrals, surface treatments, color
language all shift. Dark mode is a true companion variant per theme, not an
inversion.

### 3.2 Token categories (per theme × per mode)

Each theme defines values for these CSS variables. Production already uses the
`--acr-*` prefix for the homestead light/dark variant; the port extends this
system to all five themes.

```
Surface
  --acr-bg            page background
  --acr-bg-sunken     deeper recessed background
  --acr-bg-raised     lifted-from-page background
  --acr-surface       card / panel surface (default)
  --acr-surface-2     card-on-card / hover surface
  --acr-sidebar-bg    sidebar background
  --acr-sidebar-ink   sidebar text on its background

Lines
  --acr-line          default border / divider
  --acr-line-soft     subtler divider

Foreground
  --acr-ink           primary text
  --acr-ink-2         secondary text
  --acr-ink-3         tertiary / muted text
  --acr-ink-4         placeholder / disabled

Brand
  --acr-brand         primary accent
  --acr-brand-ink     ink that reads on brand fill
  --acr-brand-soft    tinted brand background

Semantic
  --acr-accent        secondary brand accent
  --acr-pos / -soft   positive / success
  --acr-warn / -soft  warning
  --acr-neg / -soft   destructive / error

Effects
  --acr-glow          focus / accent glow
  --acr-shadow-1      level-1 lift (cards)
  --acr-shadow-2      level-2 lift (hover, popovers)
  --acr-shadow-3      level-3 lift (modals, hero cards)
  --acr-ring          focus ring (3px outer)

Charts
  --acr-chart-a … -d  4-color chart palette
```

### 3.3 Full per-theme tables

Lifted from `theme.jsx`; verify against that file before pasting into CSS.

#### 3.3.1 Homestead — warm earth, terracotta on cream

| Token | Light | Dark |
|---|---|---|
| `--acr-bg` | `#FAF4E8` | `#1A120A` |
| `--acr-bg-sunken` | `#F1E9D6` | `#120B05` |
| `--acr-bg-raised` | `#FFFBF1` | `#241811` |
| `--acr-surface` | `#FFFBF1` | `#241811` |
| `--acr-surface-2` | `#F3EAD4` | `#2D2017` |
| `--acr-line` | `rgba(80,40,15,0.14)` | `rgba(255,230,195,0.10)` |
| `--acr-line-soft` | `rgba(80,40,15,0.07)` | `rgba(255,230,195,0.05)` |
| `--acr-ink` | `#241607` | `#F8EAD2` |
| `--acr-ink-2` | `#5A4424` | `#CBB896` |
| `--acr-ink-3` | `#8F7A52` | `#8F7E62` |
| `--acr-ink-4` | `#BAAA85` | `#5C4E3C` |
| `--acr-brand` | `#C2531C` | `#ED8852` |
| `--acr-brand-ink` | `#FFFBF1` | `#1A0E05` |
| `--acr-brand-soft` | `rgba(194,83,28,0.14)` | `rgba(237,136,82,0.16)` |
| `--acr-accent` | `#4C7B80` | `#7FB3B7` |
| `--acr-pos` / soft | `#3B7C2E` / `rgba(59,124,46,0.14)` | `#7FCA72` / `rgba(127,202,114,0.16)` |
| `--acr-warn` / soft | `#C48A1E` / `rgba(196,138,30,0.14)` | `#F0BC58` / `rgba(240,188,88,0.16)` |
| `--acr-neg` / soft | `#B33419` / `rgba(179,52,25,0.14)` | `#EE8063` / `rgba(238,128,99,0.16)` |
| `--acr-glow` | `rgba(194,83,28,0.35)` | `rgba(237,136,82,0.40)` |
| `--acr-ring` | `0 0 0 3px rgba(194,83,28,0.28)` | `0 0 0 3px rgba(237,136,82,0.35)` |
| `--acr-chart-a/b/c/d` | `#C2531C / #4C7B80 / #C48A1E / #3B7C2E` | `#ED8852 / #7FB3B7 / #F0BC58 / #7FCA72` |
| `--acr-sidebar-bg` / ink | `#F1E7D0 / #2B1B0A` | `#130C05 / #F2E0C4` |
| `--acr-shadow-1` | `0 1px 2px rgba(60,30,8,0.06)` | `0 1px 2px rgba(0,0,0,0.4)` |
| `--acr-shadow-2` | `0 1px 2px rgba(60,30,8,0.06), 0 8px 22px -6px rgba(60,30,8,0.16)` | `0 2px 4px rgba(0,0,0,0.35), 0 14px 36px -8px rgba(0,0,0,0.55)` |
| `--acr-shadow-3` | `0 2px 4px rgba(60,30,8,0.08), 0 22px 50px -12px rgba(60,30,8,0.22)` | `0 4px 8px rgba(0,0,0,0.4), 0 26px 60px -12px rgba(0,0,0,0.7)` |

Production already ships this set — see `client/src/index.css` lines 12–120
(`:root` + `.dark` blocks). Phase B will keep this verbatim and extend the
system to the four other themes.

#### 3.3.2 Quarry — editorial stone, ink, one red

| Token | Light | Dark |
|---|---|---|
| `--acr-bg` | `#F3F0EA` | `#121210` |
| `--acr-bg-sunken` | `#E7E3DB` | `#08080714` |
| `--acr-bg-raised` | `#FBFAF5` | `#1B1B18` |
| `--acr-surface` | `#FBFAF5` | `#1B1B18` |
| `--acr-surface-2` | `#EDEAE2` | `#232320` |
| `--acr-line` | `rgba(20,20,16,0.18)` | `rgba(245,242,232,0.14)` |
| `--acr-line-soft` | `rgba(20,20,16,0.08)` | `rgba(245,242,232,0.07)` |
| `--acr-ink` | `#0C0C0A` | `#F2EFE5` |
| `--acr-ink-2` | `#3D3D38` | `#BDBAB0` |
| `--acr-ink-3` | `#74746B` | `#7E7B71` |
| `--acr-ink-4` | `#ACACA1` | `#4F4D47` |
| `--acr-brand` | `#C8241C` | `#E85142` |
| `--acr-brand-ink` | `#FBFAF5` | `#121210` |
| `--acr-brand-soft` | `rgba(200,36,28,0.10)` | `rgba(232,81,66,0.14)` |
| `--acr-accent` | `#0C0C0A` | `#F2EFE5` |
| `--acr-pos` / soft | `#18623A` / `rgba(24,98,58,0.10)` | `#5BC783` / `rgba(91,199,131,0.14)` |
| `--acr-warn` / soft | `#8F6A00` / `rgba(143,106,0,0.10)` | `#E4B14A` / `rgba(228,177,74,0.14)` |
| `--acr-neg` / soft | `#9E1E17` / `rgba(158,30,23,0.10)` | `#E85142` / `rgba(232,81,66,0.14)` |
| `--acr-glow` | `rgba(200,36,28,0.22)` | `rgba(232,81,66,0.35)` |
| `--acr-ring` | `0 0 0 3px rgba(200,36,28,0.25)` | `0 0 0 3px rgba(232,81,66,0.35)` |
| `--acr-chart-a/b/c/d` | `#0C0C0A / #74746B / #C8241C / #18623A` | `#F2EFE5 / #7E7B71 / #E85142 / #5BC783` |
| `--acr-sidebar-bg` / ink | `#EDEAE2 / #0C0C0A` | `#0E0E0C / #F2EFE5` |
| `--acr-shadow-1` | `0 1px 0 rgba(20,20,16,0.05)` | `0 1px 0 rgba(0,0,0,0.5)` |
| `--acr-shadow-2` | `0 1px 0 rgba(20,20,16,0.06), 0 2px 8px rgba(20,20,16,0.06)` | `0 1px 0 rgba(0,0,0,0.5), 0 8px 24px rgba(0,0,0,0.5)` |
| `--acr-shadow-3` | `0 2px 0 rgba(20,20,16,0.08), 0 12px 32px -8px rgba(20,20,16,0.14)` | `0 2px 0 rgba(0,0,0,0.6), 0 20px 48px -8px rgba(0,0,0,0.7)` |

#### 3.3.3 Nocturne — operator dark, single signal

| Token | Light | Dark |
|---|---|---|
| `--acr-bg` | `#FAFAF9` | `#0A0A0A` |
| `--acr-bg-sunken` | `#EFEFED` | `#050505` |
| `--acr-bg-raised` | `#FFFFFF` | `#121212` |
| `--acr-surface` | `#FFFFFF` | `#121212` |
| `--acr-surface-2` | `#F4F4F2` | `#1A1A1A` |
| `--acr-line` | `rgba(15,15,15,0.10)` | `rgba(255,255,255,0.08)` |
| `--acr-line-soft` | `rgba(15,15,15,0.05)` | `rgba(255,255,255,0.04)` |
| `--acr-ink` | `#0A0A0A` | `#F4F4F4` |
| `--acr-ink-2` | `#3A3A3A` | `#B8B8B8` |
| `--acr-ink-3` | `#777777` | `#7A7A7A` |
| `--acr-ink-4` | `#B4B4B4` | `#4A4A4A` |
| `--acr-brand` | `#D63A2D` | `#FF4A38` |
| `--acr-brand-ink` | `#FFFFFF` | `#0A0505` |
| `--acr-brand-soft` | `rgba(214,58,45,0.10)` | `rgba(255,74,56,0.12)` |
| `--acr-accent` | `#0A0A0A` | `#F4F4F4` |
| `--acr-pos` / soft | `#1E7A3E` / `rgba(30,122,62,0.10)` | `#4ADE80` / `rgba(74,222,128,0.12)` |
| `--acr-warn` / soft | `#B8820E` / `rgba(184,130,14,0.10)` | `#FAC84D` / `rgba(250,200,77,0.12)` |
| `--acr-neg` / soft | `#B02B20` / `rgba(176,43,32,0.10)` | `#FF4A38` / `rgba(255,74,56,0.12)` |
| `--acr-glow` | `rgba(214,58,45,0.30)` | `rgba(255,74,56,0.45)` |
| `--acr-ring` | `0 0 0 3px rgba(214,58,45,0.25)` | `0 0 0 3px rgba(255,74,56,0.4)` |
| `--acr-chart-a/b/c/d` | `#0A0A0A / #777777 / #D63A2D / #1E7A3E` | `#F4F4F4 / #7A7A7A / #FF4A38 / #4ADE80` |
| `--acr-sidebar-bg` / ink | `#F4F4F2 / #0A0A0A` | `#050505 / #F4F4F4` |
| `--acr-shadow-1` | `0 1px 2px rgba(0,0,0,0.05)` | `0 1px 2px rgba(0,0,0,0.6)` |
| `--acr-shadow-2` | `0 1px 2px rgba(0,0,0,0.05), 0 8px 24px -6px rgba(0,0,0,0.12)` | `0 2px 4px rgba(0,0,0,0.5), 0 12px 32px -8px rgba(0,0,0,0.7)` |
| `--acr-shadow-3` | `0 2px 4px rgba(0,0,0,0.06), 0 20px 48px -12px rgba(0,0,0,0.18)` | `0 4px 8px rgba(0,0,0,0.5), 0 24px 56px -12px rgba(0,0,0,0.8)` |

#### 3.3.4 Meadow — sage, honey, daylight

| Token | Light | Dark |
|---|---|---|
| `--acr-bg` | `#F5F6EE` | `#141A10` |
| `--acr-bg-sunken` | `#EAECDF` | `#0B1008` |
| `--acr-bg-raised` | `#FCFCF5` | `#1D2417` |
| `--acr-surface` | `#FCFCF5` | `#1D2417` |
| `--acr-surface-2` | `#EEF0E3` | `#262E1E` |
| `--acr-line` | `rgba(30,50,22,0.12)` | `rgba(220,240,200,0.10)` |
| `--acr-line-soft` | `rgba(30,50,22,0.06)` | `rgba(220,240,200,0.05)` |
| `--acr-ink` | `#132010` | `#EEF2E0` |
| `--acr-ink-2` | `#425038` | `#BCC4AA` |
| `--acr-ink-3` | `#7B8470` | `#838B72` |
| `--acr-ink-4` | `#B0B6A4` | `#535947` |
| `--acr-brand` | `#3D6B2F` | `#8BC76A` |
| `--acr-brand-ink` | `#FCFCF5` | `#0E1508` |
| `--acr-brand-soft` | `rgba(61,107,47,0.14)` | `rgba(139,199,106,0.18)` |
| `--acr-accent` | `#D89528` | `#F2BF55` |
| `--acr-pos` / soft | `#3D6B2F` / `rgba(61,107,47,0.14)` | `#8BC76A` / `rgba(139,199,106,0.18)` |
| `--acr-warn` / soft | `#D89528` / `rgba(216,149,40,0.16)` | `#F2BF55` / `rgba(242,191,85,0.18)` |
| `--acr-neg` / soft | `#C85632` / `rgba(200,86,50,0.14)` | `#EA8460` / `rgba(234,132,96,0.18)` |
| `--acr-glow` | `rgba(61,107,47,0.32)` | `rgba(139,199,106,0.40)` |
| `--acr-ring` | `0 0 0 3px rgba(61,107,47,0.28)` | `0 0 0 3px rgba(139,199,106,0.35)` |
| `--acr-chart-a/b/c/d` | `#3D6B2F / #D89528 / #6B8F3B / #C85632` | `#8BC76A / #F2BF55 / #B0D47E / #EA8460` |
| `--acr-sidebar-bg` / ink | `#E7EBDA / #132010` | `#0D130A / #E8ECD4` |
| `--acr-shadow-1` | `0 1px 2px rgba(30,50,22,0.06)` | `0 1px 2px rgba(0,0,0,0.4)` |
| `--acr-shadow-2` | `0 1px 2px rgba(30,50,22,0.06), 0 8px 22px -6px rgba(30,50,22,0.14)` | `0 2px 4px rgba(0,0,0,0.35), 0 12px 32px -8px rgba(0,0,0,0.55)` |
| `--acr-shadow-3` | `0 2px 4px rgba(30,50,22,0.08), 0 22px 50px -12px rgba(30,50,22,0.2)` | `0 4px 8px rgba(0,0,0,0.4), 0 24px 56px -12px rgba(0,0,0,0.65)` |

#### 3.3.5 Slate — clinical blue-grey, data-dense (renamed from Titan)

| Token | Light | Dark |
|---|---|---|
| `--acr-bg` | `#F1F4F8` | `#0A1018` |
| `--acr-bg-sunken` | `#E4E9F0` | `#050810` |
| `--acr-bg-raised` | `#FFFFFF` | `#121A26` |
| `--acr-surface` | `#FFFFFF` | `#121A26` |
| `--acr-surface-2` | `#EAEEF4` | `#1A2330` |
| `--acr-line` | `rgba(18,30,48,0.14)` | `rgba(180,210,255,0.10)` |
| `--acr-line-soft` | `rgba(18,30,48,0.07)` | `rgba(180,210,255,0.05)` |
| `--acr-ink` | `#0B1220` | `#E6EDF8` |
| `--acr-ink-2` | `#38465E` | `#B4BECC` |
| `--acr-ink-3` | `#6D7A92` | `#778294` |
| `--acr-ink-4` | `#A6B0C2` | `#4B5566` |
| `--acr-brand` | `#1E4FCC` | `#5B8BFF` |
| `--acr-brand-ink` | `#FFFFFF` | `#07101F` |
| `--acr-brand-soft` | `rgba(30,79,204,0.12)` | `rgba(91,139,255,0.18)` |
| `--acr-accent` | `#0B7A82` | `#4BC3CC` |
| `--acr-pos` / soft | `#0F7A4A` / `rgba(15,122,74,0.12)` | `#4CC88A` / `rgba(76,200,138,0.18)` |
| `--acr-warn` / soft | `#B5720A` / `rgba(181,114,10,0.12)` | `#EAB14A` / `rgba(234,177,74,0.18)` |
| `--acr-neg` / soft | `#B8213B` / `rgba(184,33,59,0.12)` | `#F1536E` / `rgba(241,83,110,0.18)` |
| `--acr-glow` | `rgba(30,79,204,0.32)` | `rgba(91,139,255,0.45)` |
| `--acr-ring` | `0 0 0 3px rgba(30,79,204,0.28)` | `0 0 0 3px rgba(91,139,255,0.4)` |
| `--acr-chart-a/b/c/d` | `#1E4FCC / #0B7A82 / #B5720A / #B8213B` | `#5B8BFF / #4BC3CC / #EAB14A / #F1536E` |
| `--acr-sidebar-bg` / ink | `#E4E9F0 / #0B1220` | `#060C14 / #E6EDF8` |
| `--acr-shadow-1` | `0 1px 2px rgba(18,30,48,0.06)` | `0 1px 2px rgba(0,0,0,0.5)` |
| `--acr-shadow-2` | `0 1px 2px rgba(18,30,48,0.06), 0 8px 22px -6px rgba(18,30,48,0.14)` | `0 2px 4px rgba(0,0,0,0.4), 0 12px 32px -8px rgba(0,0,0,0.6)` |
| `--acr-shadow-3` | `0 2px 4px rgba(18,30,48,0.08), 0 22px 50px -12px rgba(18,30,48,0.2)` | `0 4px 8px rgba(0,0,0,0.45), 0 24px 56px -12px rgba(0,0,0,0.7)` |

### 3.4 Motion tokens

Already in production (`client/src/index.css` ~line 60). Lifted from
prototype `round3-css.jsx`.

```
--acr-dur-fast      120ms     hover/focus/press
--acr-dur-normal    240ms     state transitions, popovers, modals
--acr-dur-slow      320ms     route transitions, reveal animations
--acr-ease-spring   cubic-bezier(.22, 1, .36, 1)        macOS spring
--acr-ease-standard cubic-bezier(0.25, 0.46, 0.45, 0.94) macOS standard
```

`prefers-reduced-motion: reduce` collapses all three durations to ≤ 60 ms and
strips spring overshoot to standard easing.

### 3.5 Z-index layers

```
--acr-z-sidebar  10
--acr-z-topbar   20
--acr-z-drawer   30
--acr-z-modal    9100
--acr-z-toast    9999
```

### 3.6 Spacing rhythm

Lifted from `SHELL_CSS` and `ACR_CSS` literals. Tailwind's default scale
matches; no overrides needed. Use these step values:

| Step | px | Use |
|---|---|---|
| 1 | 4 | Icon-to-label gap, micro-padding |
| 2 | 8 | Pill padding, button gap |
| 3 | 12 | Input padding, small section gap |
| 4 | 16 | Card padding (compact), nav-item gap |
| 5 | 20 | Card padding (default — `acr-card-pad`) |
| 6 | 24 | Section padding (default), settings row gap |
| 8 | 32 | Page content padding, settings panel padding |
| 10 | 40 | Hero spacing |
| 12 | 48 | Top-of-page gap, footer breathing room |
| 16 | 64 | Page-bottom margin (`acr-content` 28/32/48) |

### 3.7 Radius scale

| Token | Value | Use |
|---|---|---|
| `rounded-sm` | 3 px | Inline kbd, small chip |
| `rounded-md` | 8 px | Button, pill, input (default) |
| `rounded-lg` | 16 px | Card, panel |
| `rounded-xl` | 20 px | Large card, hero card |
| `rounded-2xl` | 24 px | Modal, large feature surface |
| `rounded-full` | 9999 px | Avatar, pill capsule, focus ring |

Card default in prototype is **14 px** (`.acr-card`) — sits between `lg`
(16 px) and `md` (8 px). Production should round-down to 14 px via
`rounded-[14px]` or extend the Tailwind scale with a custom value if used
broadly. Phase B decision: add `acr-card` Tailwind utility OR keep
`rounded-[14px]` inline.

### 3.8 Status / chart accents

Production tailwind already exposes:

```
status.online   rgb(34 197 94)
status.away     rgb(245 158 11)
status.busy     rgb(239 68 68)
status.offline  rgb(156 163 175)
```

These are tier-agnostic state colors used outside the theme system (e.g. real-
time presence dots). Keep as-is; do not theme.

---

## 4. Type system

Two-font system per surface. **One curated pairing per user**, picked in
Settings → Appearance. Never let users pick fonts à-la-carte (high risk of
broken combinations).

### 4.1 Pairings to ship

| Pairing ID | Display | Body | Mono | Notes |
|---|---|---|---|---|
| `editorial` (default) | **Fraunces** (variable, opt 9–144) | **Inter** (variable, weight 100–900) | **JetBrains Mono** | Already in production. House default. |
| `modern` | **Söhne Headline** (or Inter Tight as drop-in) | **Inter** | **JetBrains Mono** | Crisp, neutral, tech-forward |
| `classic` | **Charter** (or Iowan Old Style fallback) | **Inter** | **JetBrains Mono** | Editorial, warm, less serif-display |
| `native` | **SF Pro Display** (system) | **SF Pro Text** (system) | **SF Mono** (system) | Apple-native; zero font load |
| `refined` | **New Spirit** (or Fraunces Extra Soft fallback) | **Söhne** (or Inter as drop-in) | **JetBrains Mono** | Premium editorial, softer than Editorial |

**Self-host requirement.** Phase B will only ship pairings whose fonts can be
self-hosted (latin-subset variable woff2). Söhne and New Spirit are licensed
faces — if licensing isn't in place at port time, fall back to the parenthetical
substitute without renaming the pairing. Document substitutions in
PORT-AUDIT.md.

### 4.2 Loading strategy

- Native (`native` pairing): no font load.
- Other pairings: load on demand — only the active pairing's fonts are
  fetched. Switch pairing → background-load new fonts → swap on `load`.
- All fonts use `font-display: swap` and latin-subset `unicode-range`.

### 4.3 Type scale

Lifted from prototype CSS strings. All sizes in px / line-height in unitless
multipliers.

| Role | Family | Size | Weight | Line | Letter-spacing | Notes |
|---|---|---|---|---|---|---|
| Display | display | 36 | 600 | 1.05 | -0.025em | Hero, marketing |
| H1 (page) | display | 24 | 600 | 1.15 | -0.022em | `acr-page-title` |
| H2 (section) | display | 20 | 600 | 1.2 | -0.02em | `set-h h3` |
| H3 (card) | display | 15–16 | 600 | 1.2 | -0.01em | `acr-section-title` |
| Body L | sans | 14 | 400 | 1.5 | 0 | Default body |
| Body | sans | 13 | 400/500 | 1.5 | -0.005em | Default UI |
| Small | sans | 12 | 500 | 1.4 | -0.005em | Helper, meta |
| Tiny | sans | 11–11.5 | 500 | 1 | 0 | Pill, badge, label |
| Eyebrow | sans | 10.5 | 500 | 1 | 0.07–0.08em uppercase | `acr-eyebrow`, group titles |
| Mono | mono | 11–13 | 500 | 1 | 0 | `acr-kbd`, parcel IDs |

### 4.4 Tabular numbers

Currency, parcel IDs, percentages: add `font-variant-numeric: tabular-nums`
(prototype's `.acr-tabnum` class). Tailwind: `tabular-nums`.

---

## 5. Component grammar

Lifted from `acreos/primitives.jsx` and `acreos/shell.jsx`.

### 5.1 Buttons

System-feel matching macOS. Medium radii (6–8 px), native padding, clear
primary/secondary visual weight. **Sizes:** sm (26 px tall, 12 px font), md
(32 px, 13 px), lg (38 px, 13.5 px). **Variants:** primary (brand fill,
inset highlight + shadow-1), secondary (surface + line border + shadow-1),
ghost (transparent → surface-2 hover), subtle (surface-2 → bg-sunken hover).

Focus: replace `outline:none` with `box-shadow: var(--acr-ring)` on
`:focus-visible`. Never strip focus.

### 5.2 Cards / surfaces

Flat by default with subtle borders. Floating with shadow + slight
translucency for emphasis only (modals, popovers, hero, AI suggestion cards).
Subtle Sequoia register — readable as floating depth, never visible
glass-as-decoration.

```
.acr-card  surface + 0.5px line border + 14px radius + shadow-1
.acr-card-pad  20px padding
.acr-card-int  hover lift to shadow-2
```

### 5.3 Pills / badges

Capsule (`rounded-full`), 11 px tabular-nums weight 500, 3 × 8 px padding.
Tones: `neutral`, `pos`, `neg`, `warn`, `brand`, `ghost`. Optional dot prefix.

### 5.4 Iconography

- **Outline icons by default** (lighter, calmer)
- **Filled icons for selected/active** (Finder, Things 3 toolbar pattern)
- **Single icon family** — Lucide React across the platform; do not mix.
  SF Symbols are not web-deliverable; Lucide is the closest restrained set.

### 5.5 Information hierarchy in lists

| List surface | Default | User-switchable |
|---|---|---|
| Inbox / threads | Rows | Yes — rows / cards / expand-on-click |
| Contacts | Rows | Yes |
| Audit log | Rows | No (chronological dense by definition) |
| Pipeline | Cards (kanban) | Yes — cards / table |
| Buy boxes | Cards | Yes |
| Lists | Rows | Yes |
| Campaigns | Rows | Yes |
| Deals (`/deals`) | Table | Yes |

Per-user, per-list-type preference. Persist server-side in user settings.

### 5.6 Numerical data display

**No hero KPI tile grids.** Most-important number per surface gets quiet
emphasis via type weight, position, or subtle ink color shift; supporting
metrics integrate calmly into the layout. Editorial-feel data display, not
gauge-and-dashboard.

---

## 6. Density, motion, personalization

### 6.1 Density modes

| Mode | Vertical rhythm | Card padding | Row height | When to use |
|---|---|---|---|---|
| `compact` | 4 px base | 16 px | 32–36 px | Long lists, dense tables |
| `comfortable` | 8 px base | 20 px | 40–44 px | Default for most surfaces |
| `adaptive` (recommended) | per-surface default | per-surface | per-surface | Compact in CRM, comfortable in Atlas / today |

User preference persists in `user.preferences.density`.

### 6.2 Motion preference

- `full` (default) — all transitions, durations from §3.4
- `reduced` — durations collapse to ≤ 60 ms, springs flatten to standard
  easing
- Defaults to reduced when `prefers-reduced-motion: reduce` is set in OS

### 6.3 Personalization surfaces

Settings → Appearance:
- Theme picker (5 themes, swatches + tagline — see `acreos/settings.jsx`
  AppearancePanel reference)
- Mode toggle (Light / Dark / Auto-follows-system)
- Font pairing picker (4–5 pairings)
- Density (compact / comfortable / adaptive)
- Motion (full / reduced)

Settings → Sidebar:
- Show/hide each section + each item
- Drag-to-reorder

Settings → Notifications:
- Per-event-type × per-channel matrix (in-app / email / SMS / none)
- Per-channel quiet hours

Settings → Lists:
- Per-list-type view preference (rows / cards / expand-on-click)

Settings → Autonomy: see §7.

This is **not** "settings as a feature." It's the platform expressing respect
for the user's working life. Group thoughtfully, default sensibly, surface
controls users actually want.

---

## 7. Autonomy matrix

Per-agent × per-action × threshold permissions.

### 7.1 Top-level scale per agent (0–3)

| Level | Label | Behavior |
|---|---|---|
| 0 | Observe | Suggest only. Nothing acts without you. |
| 1 | Draft | Drafts replies, offers, mailers. You review each. |
| 2 | Execute | Acts on routine tasks. Asks above threshold. |
| 3 | Autonomous | Runs the function. Daily briefing only. |

### 7.2 Per-action overrides

Expand-to-reveal under each agent:

| Agent | Per-action axes |
|---|---|
| Atlas | Comps · Valuations · Parcel research · Market analysis |
| Pax | Replies · Mailer drafting · Mailer sending · Outreach |
| Sophie | Loan servicing · Document handling · Payment flagging |

Each axis: independently settable level 0–3, optional monetary threshold,
optional time-window guardrail.

### 7.3 Monetary thresholds

Inline numeric input per applicable action. Examples:
- "Pax can send mailers under **$500** autonomously, ask above"
- "Sophie can flag payments under **$10K**, escalate above"

### 7.4 Time-based guardrails

- "Pause outbound communications between **7 PM** and **8 AM** local"
- "Daily action limit per agent: **N** actions" (prevents runaway)

### 7.5 UX

Progressive disclosure:
1. Top: 4-step scale per agent
2. Expand → per-action overrides for each agent
3. Threshold inputs inline with each action
4. "Reset to recommended defaults" always visible
5. Sensible defaults that work without expanding

The surface should feel calm despite the depth. Group by agent; whitespace
generously; this is not a war room.

### 7.6 Audit trail

Every autonomous action is logged: what was done, sources used, confidence,
"would have asked at threshold X" for threshold-gated actions. Audit
log surface (`/audit`) is the canonical view — calm chronological, filter +
search.

---

## 8. Feature flag system

Founder mode controls what customer-facing surfaces show.

### 8.1 Flag states

| State | Audience |
|---|---|
| `off` | Development; customers and founder do not see |
| `founder-only` | Founder only — private testing |
| `beta` | Specific opted-in users |
| `tier:free` / `tier:pro` / `tier:scale` | Subscription-gated |
| `on` | Live for everyone |

### 8.2 Founder UI — `/founder/features`

Calm table, one row per flag: name, description, current state, audience, last
changed (actor + ts), edit. Inline state edit. Every change logged.

### 8.3 Architectural commitment

- Route returns 404 when flag is off
- Sidebar hides when flag is off
- API endpoints reject when flag is off

**Not a hide-from-sidebar hack.** The underlying feature is genuinely inert
when the flag is off — customers can't hit it by URL, can't call its API.

### 8.4 Initial flags (Phase D)

| Flag | Default state |
|---|---|
| `module.land-academy` | `off` (not yet built) |
| `module.marketplace` | `off` (decision pending) |
| `surface.command-palette-v2` | `founder-only` |
| `feature.atlas-async-jobs` | `founder-only` |
| `theme.quarry` / `theme.nocturne` / `theme.meadow` / `theme.slate` | `on` (ship at port complete) |
| `feature.autonomy-matrix` | `founder-only` until UX polish complete |

---

## 9. Component mapping — prototype → production

Every prototype primitive maps to a production component (or maps to a port
TODO). HANDOFF.md §3 owns the page-level canonical-version table; this section
covers atomic primitives.

### 9.1 Atomic primitives

| Prototype (`acreos/primitives.jsx`) | Production (`client/src/components/`) | Status |
|---|---|---|
| `Card` (`.acr-card`) | `ui/card.tsx` | Re-skin to use `--acr-surface` + 14 px radius + shadow-1 |
| `Button` (`.acr-btn-{primary/secondary/ghost/subtle}`) | `ui/button.tsx` | Add `subtle` variant; align focus-ring to `--acr-ring` |
| `Pill` (`.acr-pill`) | `ui/badge.tsx` | Re-skin: pill capsule, tabular-nums, dot-prefix |
| `Kbd` (`.acr-kbd`) | new — extract from `command.tsx` | Add as `ui/kbd.tsx` |
| `SectionTitle` (`.acr-section`) | new | Add as `components/section-title.tsx` |
| `Sparkline` | `ui/chart.tsx` | Verify minimal mono-line variant exists |
| `Avatar` (`.acr-avatar`) | `ui/avatar.tsx` | Re-skin tones (brand/accent/pos) |

### 9.2 Shell primitives (`acreos/shell.jsx`)

| Prototype | Production | Status |
|---|---|---|
| `Sidebar` (`.acr-sidebar`) | `components/layout-sidebar.tsx` | Re-skin: 240 px width, collapsed 60 px, sidebar-bg/ink tokens, brand strip on active |
| `Logo` | `components/acreos-logo.tsx` | Verify SVG matches export's mark exactly |
| `NavItem` (`.acr-nav-item`) | within `layout-sidebar.tsx` | Re-skin to match prototype rules |
| `TopBar` (`.acr-topbar`) | `components/page-shell.tsx` (top bar slot) | Re-skin: backdrop-blur surface, 14 × 24 padding, sticky |

### 9.3 Settings primitives (`acreos/settings.jsx`)

| Prototype | Production | Status |
|---|---|---|
| `SettingRow` | new — `components/settings/setting-row.tsx` | Build per prototype (16 × 28 padding, line-soft divider) |
| `Toggle` (`.set-toggle`) | `ui/switch.tsx` | Re-skin to match 32 × 19, brand-on, knob 15 px |
| `Select` (`.set-select`) | `ui/select.tsx` | Re-skin chevDn icon position, 0.5 px line border |
| `AutonomyPanel` | new — `components/settings/autonomy-panel.tsx` | Build per §7 spec |
| `AppearancePanel` | new — `components/settings/appearance-panel.tsx` | Build per `acreos/settings.jsx` reference |
| `ProvidersPanel` | new — `components/settings/providers-panel.tsx` | Wire to existing provider registry (server/services/providers/) |

### 9.4 Page-level mapping

See `~/Desktop/acreos-design-export/handoff/HANDOFF.md` §3 for the canonical
table. Highest letter suffix wins (`CommandCenterC` over `B` over unsuffixed).
Procedure: open `acreos/app.jsx` switch, find `case '<route>'`, follow the
`window.X ? <X /> : ...` ladder, take the highest letter, then
`grep "ComponentNameC ="` for the definition.

---

## 10. Density rules per surface type

Per §2.1 and §6.1. Phase E surfaces apply these defaults; users can override
per-list-type.

| Surface tier | Default density | Default list view | Notes |
|---|---|---|---|
| `/today` | comfortable | n/a | Hero greeting, calm cards |
| Pipeline (`/pipeline`) | adaptive | cards (kanban) | Compact-mode collapses card body |
| Inbox (`/inbox`) | comfortable | rows | Compact narrows row height |
| Parcel detail | comfortable | n/a | Sections breathe |
| Buy boxes / lists / campaigns | comfortable | cards / rows | Per surface |
| Offers / documents / dispositions | comfortable | rows | Tabular by default |
| Audit log | compact | rows | Always dense, no toggle |
| Settings | comfortable | n/a | Calm despite depth |
| Founder mode | compact | varies | Denser, more analytical (continuous design language with subtle accent) |

---

## 11. State coverage

Every page must support four states. The prototype's Tweaks-driven preview is
NOT the implementation — production handles states via Tanstack Query
(`isLoading`, `isError`, empty checks).

| State | Implementation | Voice exemplar |
|---|---|---|
| Loading | `<Skeleton>` matching final layout. Never a spinner. | n/a |
| Empty (zero data) | First-run friendly. Inline primary CTA. | "No deals yet. Add your first parcel." |
| Empty (filtered to zero) | Tells user **what filter** is hiding things. Clear-filter button. | "No deals match 'Hot' in the last 30 days. Clear filter." |
| Error | Recoverable. Retry button. Specific blame, not "Something went wrong." | "Atlas timed out reading parcel details. Retry." |

Prototype canonical voice: `tier-c-wire.jsx` `ErrorState` (`DataTree timed out`
example). Match its tone for every error state.

Production primitives in use: `<Skeleton>` (`ui/skeleton.tsx`), `<EmptyState>`
(`components/empty-state.tsx`), `<QueryErrorState>`
(`components/query-error-state.tsx`). Re-skin during Phase E to match the
prototype tone.

---

## 12. Accessibility floor

Production target: WCAG 2.1 AA. Prototype is not audited — gaps to address
during port:

- **Focus rings.** Every interactive element has a visible focus indicator
  using `var(--acr-ring)`. Never `outline: none` without replacement.
- **Keyboard.** ⌘K palette, sidebar nav, drag-drop pipeline (provide
  arrow-keys-to-move-stage or "Move to…" menu).
- **ARIA.** Modals: `role="dialog"` + focus trap. Toasts: `aria-live="polite"`
  (sonner does this for free). Tables: semantic `<table>`.
- **Color contrast.** Founder mode (deep accent on near-black) — verify token
  contrast at port time.
- **Motion.** Respect `prefers-reduced-motion: reduce` (see §6.2).

---

## 13. Subtle acknowledgment moments

Calm dominates, but a few user moments warrant subtle acknowledgment (no
performance):

- First deal closed — quiet text moment, maybe a small typographic mark on
  `/today`. Nothing more.
- 100th / 500th / 1000th deal — same restrained register.
- Account created — clean welcome. Not "Yay!"
- AI agent multi-day autonomous run completed — a quiet acknowledgment worth
  noting.

These are pattern interrupts, not celebrations. They tell the user "the
platform noticed" without performing emotion.

**Anti-pattern (never ship):** confetti, balloons, big emoji, achievement
notifications, milestone modals, gamification, forced "rate us" prompts.

---

## 14. Six surfaces deserving extra attention

Phase G dedicated polish per surface:

1. **`/today`** — most-seen surface, sets the daily tone. Hero greeting copy
   quality matters. Each piece earns its place.
2. **Onboarding flow** — first impression. Multi-screen wizard. Walk-into-a-
   workspace feel, not a tour overlay. Reference:
   `~/Desktop/acreos-design-export/acreos-onboarding/`.
3. **Founder mode** — daily working surface for the founder. Continuous design
   language with subtle accent + denser layout. Same family, deeper data.
4. **Settings** — trust surface. Calm despite depth (autonomy matrix,
   feature flags, theme picker, font picker).
5. **Landing page** — high-stakes conversion. Reference:
   `~/Desktop/acreos-design-export/acreos-landing/`. Editorial typography,
   restraint, founder letter accessible.
6. **Pricing page** — high-stakes revenue moment. Trust-building, no hype,
   Stripe-quality UX. Voice register: trust-building and confident, never
   apologetic or discount-y. Compare against meaningful alternatives ("vs
   hiring a VA," "vs assembling 5 separate tools"), not generic SaaS.
   No countdown timers, no fake scarcity.

---

## 15. Expert designer's permissions

You are not transcribing a prototype to production. You are an expert UI
designer with senior designer's permission to:

- **Reshape patterns that feel redundant.** Consolidate variant-soup; document
  in PORT-AUDIT.md.
- **Refine moments where the prototype is underdesigned.** Fill in detail
  consistent with the design system.
- **Tone down moments where the prototype feels gimmicky or demo-y.** Strip
  decoration that doesn't serve clarity.
- **Add states the prototype didn't show but production needs.** Loading,
  empty, error, multi-tenant variations, edge cases.
- **Apply the design brief to interpret prototype patterns through the
  founder's taste.**

You are NOT permitted to:

- Change functionality (auth, database, AI agents, business logic,
  integrations remain untouched).
- Invent new features the prototype doesn't suggest, except the autonomy
  matrix (§7) and feature flag infrastructure (§8).
- Diverge from this brief without flagging it in PORT-AUDIT.md.
- Make a surface feel different from the rest of the platform without reason.

**The test for every surface:**
- Could this paragraph live in the same document as the founder letter?
- Does this surface feel like the user's workspace, not a SaaS rental?
- Does it pass the "never generic, never noisy, never showing off, always
  specific intent" bar?

If yes, ship. If no, refine.

---

## 16. Files to read (not modify) during the port

Reference these live throughout Phases B–H:

```
~/Desktop/acreos-design-export/
├── acreos/
│   ├── theme.jsx              5 themes × light/dark — canonical token spec
│   ├── primitives.jsx         Card / Button / Pill / Kbd / Sparkline / Avatar
│   ├── shell.jsx              Sidebar / TopBar / Logo / NavItem
│   ├── settings.jsx           Settings nav + AutonomyPanel + AppearancePanel + ProvidersPanel
│   ├── onboarding.jsx         Onboarding wizard primitives
│   ├── pages-tier1.jsx        Command Center / Pipeline / Parcel detail / Inbox / Contacts / Calendar
│   ├── pages-tier2345.jsx     Buy boxes through Founder mode
│   ├── tier-a.jsx, tier-b.jsx, tier-c.jsx, tier-c-wire.jsx
│   │                           Iteration variants — highest letter wins (HANDOFF.md §3)
│   ├── round3-*.jsx           Later refinement iterations (motion + microinteraction tokens)
│   ├── command-center.jsx, command-palette.jsx, guided-tour.jsx, pax.jsx
│   ├── icons.jsx              Lucide-equivalent icon catalogue used by prototype
│   ├── data.jsx               Frozen prototype data — replace with API per HANDOFF.md §6
│   └── app.jsx                Switch table; resolves canonical component per route
├── acreos-landing/            Landing-page reference (sections-1/2/3.jsx + sections.css)
├── acreos-onboarding/         Onboarding screens reference (screens-1..4.jsx + onboarding.css)
├── handoff/
│   ├── HANDOFF.md             Build order, canonical-component table, globals replacement
│   ├── README.md              Handoff conventions (some referenced files do not exist)
│   ├── GAPS.md                Known gaps surfaced during prototype build
│   └── index.html             Walkthrough guide
└── tailwind.config.ts         Reference Tailwind config (production has its own already)
```

**Do not modify export files.** They are read-only reference. When export and
in-repo `acreos/` differ, the desktop export wins.

---

## 17. Operational handoff

Phase A delivers this document and tracker updates. Phases B–H follow per
directive in `_RESUME-PORT-PHASE-B.md`. Each session ends cleanly when context
fills:

1. Update `_progress.md` with current phase + sub-phase
2. Update `_gap-status.md` with completed criteria
3. Write `_RESUME-PORT-PHASE-X.md` with last commit SHA, current state, next
   specific step, mid-task decisions

Resume in fresh session: paste directive + latest resume doc.

---

*Phase A output. Treat this document as living spec — update when the export
diverges or when port decisions warrant.*
