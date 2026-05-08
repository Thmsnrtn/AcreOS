# ana-solis — Brand & Category Design

**Reading list:**
- `docs/exhaustive-completion/REMAINING-WORK-INVENTORY.md` (white-label decision pending; theme system at fork)
- `landing/copy.ts` (founder voice, 72 lines on competitive frame; the positioning is 40% there)
- `client/src/pages/agents.tsx` (Atlas / Pax / Sophie tabs; no origin mythology)
- `docs/exhaustive-completion/elite-team-deep-2026-05-01/ana-brand.md` (original brand audit: 60% of the way, operator-class identity confirmed)

**State read (1 paragraph):**
The brand foundation is solid — terracotta + parchment palette, Fraunces typeface, three named agents, founder voice on the homepage. What's missing is the *conviction* that locks those pieces together. Six weeks of discipline (agent origin paragraphs, voice rulebook per agent, motion signatures, wordmark commission) turns the brand. Six months of drift turns it into "another operator-class SaaS wearing terracotta paint." The vertical expansion is the inflection: *do we expand as "AcreOS for Land / for Notes / for Wholesalers" (Path A) or as "AcreOS — Operating Systems for the people who actually do the deals" (Path C — masthead + named verticals)?* That decision is being made implicitly by the next route you ship; it should be explicit now. The competitive frame sentence exists ("REI Pro is a database with a chatbot bolted on. Pebble is a Salesforce skin. AcreOS is what it looks like when you give the operator three coworkers who never sleep") — but it lives in the brand memo, not the landing. It needs to ship. Wendell (the operator) and Asher (the CEO) agree on the worldview; Ana's job is to make sure the customer reads it everywhere.

**Push forward — my 5 moves (ranked):**

1. **Write the agent origin paragraphs (one sentence each, founder voice) and ship on `/agents` page** — Why "Atlas"? Why "Pax"? Why "Sophie"? One sentence each, visible on the agents tab. This is the highest-leverage brand move. It's also the easiest: 15 minutes of writing, 1 day of placement + QA. The mythology lives in Thomas's head; move it to the product. — *Why now: agents are the brand's north star; 60% of customers never learn the origin story because it's not in the product.*

2. **Commission the wordmark + mark from a typeface-savvy designer** — Fraunces with a parcel-corner-stake or hexagonal lot-line glyph, terracotta on parchment. $8–15K, one week of designer time. The current footer says "AcreOS" in plain text. A wordmark carries an enormous amount of brand surface that a plain logotype can't. Reference: Linear's cube, Stripe's purple rectangle, Square's cash-app mark. — *Why now: we're about to ship multiple verticals; a wordmark locks the masthead brand before the vertical proliferation happens.*

3. **Lock the brand-architecture rule: masthead + named verticals (Path C)** — "AcreOS is the company. AcreOS for Land is the product. There will be more products. The voice, agents, visual system, and worldview are shared. Verticals are emphasis, not separation." Write this on the wall. Print it in the onboarding fork at step-0 (land / notes / both) so the feature gate is consistent with the brand gate. 1d decision + write-up. — *Why now: the next vertical ships in 4 weeks; decide the brand shape now or inherit two conflicting brand narratives (one per vertical) that'll take 6 months to untangle.*

4. **Implement motion signatures per agent (Atlas snap-in / Pax soft-rise / Sophie tick-settle)** — 1d implementation, three CSS easing curves, three duration tweaks. Atlas transitions at 120ms ease-out (crisp analyst move). Pax at 240ms spring (conversational warmth). Sophie at 180ms tick-in weight-settle (accountant precision). This earns permanent brand asset from a cheap mechanical change. — *Why now: Bavo's motion already ships clean; adding agent-specific signatures locks the brand into the motion system without rework.*

5. **Ship the competitive frame paragraph on the landing (before pricing section)** — "REI Pro and Pebble are good at what they do. They are databases you operate. AcreOS is the first software where the operator stops being the integration layer." This is the category wedge that justifies the pricing. Currently it's 3 lines in the FAQ. It needs a dedicated paragraph on the landing, visible before customers hit the price table, so they understand the *why* before they see the *how much*. — *Why now: without the frame, the pricing jump (Solo $79 → Operator $249) reads as expensive. With the frame, it reads as honest. Frame ships first.*

**What I'd defer (and why):**
- Voice rulebook per agent (200-line markdown) until month-2 (the prompt-engineering cycle needs real customer data to anchor the tones; writing it now would be theorizing; ship the origin paragraphs first, let the team feel the voice, then codify)
- Audio identity ($3K design work) until month-3 (motion + wordmark earn more brand surface per dollar; audio is the cherry, not the cake)
- Theme system overhaul (white-label vs theme namespace decision, Path A/B/C) until a paying white-label customer forces it (it's real work; it's not blocking Land Investor product; defer)

**What scares me most:**
Wendell will read the masthead-+ verticals rule and say *"but my competitors are saying 'AcreOS solved my land-investing problem.' If you say 'AcreOS for Land' and also 'AcreOS for Notes,' won't the Land Investors feel less special?"* Short answer: no. The Notion model (Notion + Notion AI, later Notion Teams) preserved the core and added depth. The Stripe model (Stripe + Connect + Atlas) preserved the core and added verticals. The key is that the *wordmark* stays unified; the *agents* stay unified; the *voice* stays unified. The vertical name is emphasis, not fragmentation. But I can't explain this in a memo; Wendell needs to hear this from Thomas in a 15-minute conversation before we ship. The conversation needs to happen in the next sprint, not month-2. That's the actual risk: drifting into two-vertical ambiguity because we never made the rule explicit with the founder.

— Ana
