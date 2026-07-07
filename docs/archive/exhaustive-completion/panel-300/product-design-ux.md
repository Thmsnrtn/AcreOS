# Product Design / UX — 300-Persona Panel

**Category slots:** 76–90  
**Date:** 2026-05-08  
**Synthesis methodology:** 15 independent memos clustered into 5 consensus recommendations

---

## Persona Memos

### 76. Lyra Henriksen — Senior product designer

**Lens:** Progressive disclosure; interaction polish.

**What I see:** Your product is functionally sound (all verticals wired, forms validated, data flows). What's missing is progressive disclosure — the art of hiding complexity until the user needs it. `/leads` shows 12 columns by default; you need to show 3 and hide 9 until the user clicks "columns." `/money` has 5 tabs when it should have 3. The first-time experience is cognitive overload.

**Highest-leverage move:** Audit 5 core surfaces (`/properties`, `/leads`, `/deals`, `/money`, `/settings`) and apply progressive disclosure: (1) hide advanced columns / settings / tabs until power users toggle "advanced mode," (2) inline help-text tooltips on confusing labels, (3) empty-state guidance (every blank list/table shows a 1-sentence explanation + CTA). Measure: time-to-aha (target: ≤4:00 for each vertical), scroll depth (target: 60%+ of users scroll past first viewport on day-1). This is a 2-week design + 1-week implementation sprint that collapses onboarding friction.

**Effort:** 3 weeks total

---

### 77. Anand Krishnamurthy — UX researcher

**Lens:** Diary studies; user behavior patterns.

**What I see:** You're 5 customers deep. You have one data-driven metric (time-to-aha from activation_events). You don't have qualitative understanding: what does Wendell do in the first 30 minutes? Where does he get stuck? What makes him smile?

**Highest-leverage move:** Run a 2-week diary study with 3 customers (1 per vertical). Each day, they spend 5 min recording a voice memo: "What I did today in AcreOS. What worked. What confused me." Compile transcripts + listen actively. Patterns emerge: "All three land investors tried to bulk-select leads before discovering the deal-room feature" or "Note investors wanted a 'what-if' yield calculator before entering data." By month-2, you'll have 10–20 raw insights that seed your next 4 weeks of design work. Measure: design decisions traced back to diary feedback (target: 100% of next sprint). This is your north star for UX prioritization.

**Effort:** 2 weeks (recruitment + listening + synthesis)

---

### 78. Soraya Najafi — Customer journey mapper

**Lens:** Service blueprints; backstage handoffs.

**What I see:** Your customer journey is: signup → onboarding → using the product. What's invisible is the founder backstage (provisioning account, running nightly scans, sending templated emails). The maps don't show where system failures happen (if Pax drafting fails, does the customer see an error or silence?).

**Highest-leverage move:** Map a 30-day customer journey (Land Investor wedge) with two swim lanes: customer-facing + backstage. Mark 5 critical handoff points: (1) day-1 signup → account provisioned, (2) day-2 scan queued → results delivered, (3) day-7 offer drafted → email sent, (4) day-14 payment logged → ledger updated, (5) day-30 NPS survey → sentiment tagged. For each handoff: what could break? (scan fails silently, email bounces, NPS sentiment doesn't tag). Design pre-emptive UX: if scan fails, customer sees "results delayed — we found X issues — you'll get an update by 5pm." This turns invisible failures into transparent recovery.

**Effort:** 1 week (mapping + pre-emptive error design)

---

### 79. Quill Jansen — Microcopy writer

**Lens:** Apology shape; help-text tone.

**What I see:** Your product has generic microcopy: "Error," "Loading," "Submit." There's no voice — no personality, no apology when things go wrong, no celebration when they go right. Microcopy is where users feel if you care.

**Highest-leverage move:** Write a 1-page microcopy guide with 3 sections: (1) error messages (pattern: what went wrong + why + what to do next. Example: "County scan hit a timeout — this sometimes happens on Fridays. We're retrying it; you'll get results by Saturday morning. Want to scan a different county in the meantime?"), (2) empty states (1-sentence explanation + 1 CTA. Example: "No deals yet. Start by scanning a county near you."), (3) success states (affirm the customer + next step. Example: "Offer letter generated! Download it, print it, send it. Want to tweak the price before you send?"). Retrofit 20 high-touch surfaces. Measure: sentiment tags on support tickets (target: zero mentions of "unhelpful error messages" by month-2). This is a 1-week payoff with 3-month tail.

**Effort:** 2 weeks (guide + retrofits)

---

### 80. Zelda Constantine — Brand designer

**Lens:** Voice consistency; visual expression of the brand.

**What I see:** Your brand is "built by an operator for operators." But your visual identity doesn't express operator-class confidence. The colors are safe. The typography is generic. The illustrations (if any) are stock-photo flat. Operators see "another SaaS," not "built for people like me."

**Highest-leverage move:** Hire a brand designer ($10K–$15K) to create a visual system: (1) color palette rooted in real-estate (soil brown, sky blue, paper off-white, 2 accent colors), (2) typography (one serif for headlines — authority, one sans for body — clarity), (3) icon set (deal, note, scan, offer, payment, 16 total, all confident lines, no cute), (4) 1 illustration style (line drawings of real operators working, not cartoons). Use it in: product UI (buttons, cards, empty states), founder letters (custom header + illustrations), website hero (operator-first imagery). Measure: brand recall (ask "what's the feeling when you open AcreOS?" target: "I feel like this is built for me"). By month-4, your visual identity is your competitive moat.

**Effort:** 6 weeks (vendor) + 2 weeks (implementation)

---

### 81. Octave Pellerin — Illustrator

**Lens:** Empty-state + onboarding illustrations; character continuity.

**What I see:** Your empty states are blank slates (table headers, no data). Illustrations would humanize the experience. By month-3, you'll have 8–10 empty states (no leads, no notes, no deals). Each one is an opportunity to reinforce brand + guide the user.

**Highest-leverage move:** Commission an illustrator to create 10 empty-state illustrations (land investor, note investor, wholesaler — 3–4 per vertical). Each illustration shows a relatable scene: land investor sitting at a desk with a county map, note investor reviewing a ledger, wholesaler shaking hands on a deal. Include 1-line caption: "Ready to find your first deal?" + CTA button below. Consistency rule: same character (the founder?) appears in 3–4 illustrations, showing different moments of operator life. This builds personality. Measure: empty-state dwell time (if users linger to read the caption, you've won). By month-3, your product feels warm instead of corporate.

**Effort:** 3 weeks (vendor)

---

### 82. Maeve Sullivan — Motion designer

**Lens:** Micro-interactions; acceleration curves.

**What I see:** Your product has no motion. Buttons don't have affordances (no hover state, no active state). Lists don't animate on load. You're missing the craft that makes a product feel alive vs clunky.

**Highest-leverage move:** Pick 3 high-traffic interactions and add motion: (1) button click (scale 0.95 on press, 1.0 on release, 150ms easing), (2) list load (fade in + slide up, 300ms ease-out, staggered by 50ms per row), (3) accordion open (expand smoothly, rotate chevron 90°, 200ms ease). Wire these via Framer Motion or Tailwind-UI variants. Measure: user delight (qualitative — does anyone comment "smooth"?), performance impact (target: <100ms additional render time). By month-3, your product feels polished instead of utilitarian.

**Effort:** 2 weeks (motion definition + implementation)

---

### 83. Kazue Yamamoto — Design system PM

**Lens:** Tokens + components; adoption metrics.

**What I see:** Your design system exists (Radix + Tailwind). But it's loose — buttons have 5 different styles, spacing is inconsistent, colors are named arbitrarily. The next 50 surfaces you build will feel fragmented unless the system is a forcing function.

**Highest-leverage move:** Tighten the design system: (1) define 6 semantic button styles (primary, secondary, danger, ghost, link, disabled + loading state), (2) define 4 spacing scales (xs=2px, sm=4px, md=8px, lg=16px) enforced via Tailwind config, (3) define color tokens (@see Ivete's brand system) mapped to semantic names (text-primary, text-secondary, border-default, bg-success). Create a `/design-system` storybook page showing all tokens + components. Measure: design consistency (no designer should have 2 ways to do the same thing), build velocity (new surfaces should reuse 80% of components). By month-4, the system is a force multiplier.

**Effort:** 2 weeks (token definition + storybook)

---

### 84. Reinier Visser — Accessibility designer

**Lens:** Screen-reader first; ARIA fidelity.

**What I see:** Your app doesn't support screen readers well. Forms lack `aria-label` on inputs. Tables lack `<caption>` and headers. Modals don't trap focus. You're excluding users and setting yourself up for ADA risk.

**Highest-leverage move:** Run a screen-reader audit (NVDA or JAWS) on 5 core surfaces. Test 3 workflows: (1) signup (can user fill form + submit?), (2) create a lead (can user navigate fields + save?), (3) view a deal (can user read deal structure + understand terms?). For each failure, document the fix (add aria-label, add role="region", add tabindex). Prioritize: submit the fixes in groups (week-1: forms, week-2: tables/lists, week-3: modals/dialogs). Target: WCAG 2.1 A compliance by month-3 (critical path), AA compliance by month-6. Measure: % of workflows that work with screen reader (target: 100% for top-5 surfaces).

**Effort:** 4 weeks (audit + fixes + testing)

---

### 85. Pilar Ortega — Mobile UX designer

**Lens:** Touch-first; thumb-zone placement.

**What I see:** Your app is "responsive" (scales to 375px width). But it's not touch-optimized. Buttons are 32px (too small for thumb). The top nav takes 50px height on mobile (leaves 430px for content; that's cramped). Horizontal scrolling + deep nesting make mobile feel broken.

**Highest-leverage move:** Design a mobile-first `/leads` view: (1) swap table for a card list (each card = 1 lead, thumb-size tap targets, 48px min height), (2) move filters to a collapsible drawer (swipe from left), (3) move bulk-action toolbar to sticky bottom bar (action buttons clustered, thumb-reachable), (4) infinite scroll (no pagination on mobile). Test on a real iPhone SE (375px width) with thumbs, not mouse. Measure: mobile conversion (signups on mobile / desktop, target: ≥30% on mobile by month-3). By month-2, mobile users should have parity with desktop for the core wedge.

**Effort:** 2 weeks (design + implementation)

---

### 86. Iulius Marin — Voice/AI UX designer

**Lens:** Conversation repair; voice affordances.

**What I see:** Pax (your AI draft assistant) is a chat-like interface ("here's your offer letter draft"). But if Pax hallucinates (generates a price that's nonsensical), the user has no way to "correct" Pax — they can only delete and re-generate. The conversational UX is brittle.

**Highest-leverage move:** Add 2-tier interaction to Pax: (1) Tier-1: after Pax generates a draft, show three buttons: "Looks good" (accept), "Adjust price" (edit field appears below), "Regenerate" (new draft). User can edit the price inline + re-submit. (2) Tier-2: if user says "lower the price by $5K," Pax should understand the relative adjustment, not require absolute prices. This turns "hallucinate and delete" into "generate, refine, accept." Measure: user edits per draft (target: 50% of users edit ≥1 field). By month-2, Pax drafts are starting points, not final outputs.

**Effort:** 1 week (UI + prompt refinement)

---

### 87. Sigrid Bjørnsen — Dark-mode designer

**Lens:** Contrast pairing; color fidelity.

**What I see:** You have no dark mode. Land investors work at night + in offices with poor lighting. Dark mode isn't a feature; it's a necessity. But naive dark mode (invert all colors) breaks contrast + looks broken.

**Highest-leverage move:** Design a proper dark-mode palette: (1) define a neutral base (bg-dark: #0f1117, text-primary: #e0e0e0), (2) adjust your brand colors for dark (text-success in light: green #22c55e; in dark: #86efac — lighter so it pops on dark bg), (3) test contrast (use WebAIM contrast checker; target: 4.5:1 for text, 3:1 for UI elements). Ship dark mode in week-2 with a toggle in `/settings`. Measure: dark-mode adoption (% of users who turn it on, target: >30% by month-2). This is a 1-week payoff that delights night workers.

**Effort:** 2 weeks (color rework + implementation + testing)

---

### 88. Esperanza Iglesias — Internationalization UX

**Lens:** Text-expansion budgets; locale adaptation.

**What I see:** You're English-first (US English). By month-6, you'll have customers asking for Spanish (Mexico, Texas large community). UI labels that fit "Note Investor" (12 chars) might not fit "Inversionista de Pagarés" (20 chars). You need expansion budgets.

**Highest-leverage move:** Audit your 10 most-used labels for text-expansion: (1) measure English length, (2) estimate Spanish + Portuguese expansion (typically +20–30%), (3) design with 30% extra space (e.g., button with "View" → plan for "Ver Detalles"). Add to your design system a rule: "All UI text allocates +30% horizontal space for i18n." When you hire a translator (month-4), you won't have to re-do layouts. Measure: % of labels that break when Spanish text lands (target: 0% by month-4).

**Effort:** 1 week (audit + design rule)

---

### 89. Calliope Demetriou — Error-state UX

**Lens:** Recovery affordances; error shame reduction.

**What I see:** When something goes wrong (scan fails, note ledger calculation error), the UI shows an error message + a vague "retry" button. The user has no context: is it transient? What went wrong? Should I try a different county?

**Highest-leverage move:** Design a 3-tier error response: (1) Tier-1 (transient): "This county scan hit a temporary timeout. Retrying automatically in 5 seconds..." (countdown + spinner, no user action needed), (2) Tier-2 (user error): "County code invalid. Try a county name instead (e.g., 'Tarrant, TX')" (hint + example), (3) Tier-3 (system error): "This is a bug on our end. We've logged it + our team is investigating. Email support@acres if you need immediate help." (empathy + escalation path). Measure: error-recovery rate (% of users who retry after error, target: >70% for transient, >50% for user-error). This turns frustration into progress.

**Effort:** 2 weeks (error taxonomy + UX design + implementation)

---

### 90. Tobias Reuter — Empty-state UX

**Lens:** First-day hero framing; CTA clarity.

**What I see:** Your empty states say "No leads yet" or "No deals found." They're accurate but demoralizing. Empty states are where new users have their first "oh, I get it" moment.

**Highest-leverage move:** Reframe all empty states as invitations to action: "No leads yet. Scan your first county to find distressed properties." → illustration of county map + "Scan Now" button. "No deals yet. Create your first deal to model your investment." → illustration of shaking hands + "Create Deal" button. "No notes yet. Upload your portfolio to track yields." → illustration of spreadsheet → "Import Notes" button. Each empty state has: (1) a relatable illustration (Octave's work), (2) 1-sentence explanation (Quill's microcopy), (3) a prominent CTA button. Measure: first-day artifact creation rate (% of users who create ≥1 lead/deal/note on day-1, target: >40%). This turns empty product into invitation.

**Effort:** 1 week (design + copy + implementation)

---

## Category Synthesis: Product Design / UX

**Consensus calls from the 15 memos above:**

### C1. Progressive disclosure + cognitive load reduction on 5 core surfaces

`/properties`, `/leads`, `/deals`, `/money`, `/settings` are overwhelming on first view. Hide advanced columns / settings / tabs until the user toggles "advanced mode." Add inline tooltips + empty-state guidance. This immediately drops time-to-aha and reduces support burden. 2–3 weeks of work, massive impact on onboarding friction.

**Effort:** 3 weeks  
**Personas converged:** Lyra (Senior designer), Anand (UX researcher), Soraya (Customer journey mapper)

### C2. Brand + visual system lock-down (color palette, typography, icons, illustrations)

Your brand needs to say "built by an operator for operators." Commission a brand designer ($10K–$15K) to create: color palette (soil brown + sky blue), typography (serif headlines, sans body), 20-icon set (confident lines, no cute), + 10 empty-state illustrations. Implement across product UI, founder letters, website. This is a 6-week external vendor + 2-week implementation. By month-4, your visual identity is your moat.

**Effort:** 6 weeks (vendor) + 2 weeks (implementation)  
**Personas converged:** Zelda (Brand), Octave (Illustrator), Maeve (Motion)

### C3. Accessibility audit + WCAG 2.1 A compliance path

Screen-reader + mobile + dark-mode support are non-negotiable. Run audits on 5 core surfaces + fix: aria-labels, focus traps, tab order, color contrast. WCAG 2.1 A by month-3, AA by month-6. This prevents ADA risk + opens your market to users with disabilities. 4 weeks of work, future-proofs your UX.

**Effort:** 4 weeks (audit + fixes + testing)  
**Personas converged:** Reinier (Accessibility), Pilar (Mobile), Sigrid (Dark mode)

### C4. Error + empty-state UX redesign (recovery affordances, first-day hero)

Errors today are vague ("Error") or shame-inducing. Empty states are demotivating. Redesign both: (1) errors with 3-tier responses (transient/user-error/system), (2) empty states with relatable illustrations + 1-sentence explanation + prominent CTA. This turns frustration into progress and empty product into invitation. 2–3 weeks of work, high delight payoff.

**Effort:** 3 weeks  
**Personas converged:** Calliope (Error states), Tobias (Empty states), Quill (Microcopy)

### C5. Pax conversational UX repair + AI transparency

Pax generates drafts but has no "refine" loop. User can only delete + regenerate. Add tier-1 interaction: accept / adjust price / regenerate. This turns "hallucinate and delete" into "generate, refine, accept." Also: make AI processing transparent (show when Pax is thinking, show model version, allow prompt inspection). 1–2 weeks of work, high-confidence AI feels less risky.

**Effort:** 2 weeks  
**Personas converged:** Iulius (Voice/AI UX), Anand (User research), Lyra (Progressive disclosure)

---

**Top-1 recommendation for Product Design / UX:**  
**Ship progressive disclosure + cognitive load reduction on 5 core surfaces** before customer #1 goes live. This immediately drops time-to-aha and makes the product feel simpler. The 3-week effort prevents the "onboarding is overwhelming" feedback that derails customer #2–5. This is your biggest UX ROI before launch.

