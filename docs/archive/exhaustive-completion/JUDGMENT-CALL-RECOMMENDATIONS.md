# Judgment Call Recommendations

Written overnight 2026-04-29. Per-item recommendation for the 11 open
judgment calls surfaced during the production port + post-port debug.

**Format per item:**
- (a) Recommendation
- (b) Why this maps to the brief
- (c) Strongest alternative + what'd argue for it
- (d) Tradeoff being made
- (e) Implementation effort estimate (S/M/L)

**Effort scale:**
- **S** — single sitting, < 4 hours, low regression risk
- **M** — focused day, 4–12 hours, requires testing
- **L** — multi-day session, > 12 hours, high coordination/regression risk

These are recommendations only. Founder triages tomorrow morning.

---

## 1. `/parcels/:id` route — feature build

**Source:** JUDGMENT-CALLS E.2.3.1. Prototype has a Parcel Detail surface
(Atlas Run panel + map + comps + title) with no production analog. Port phase
deferred it as feature-add not visual port.

**(a) Recommendation:** Defer further. Don't build during the next polish
pass; treat as a separate feature project with its own scope/spec.

**(b) Why this maps to the brief:** The brief frames AcreOS as a *Land
Investor* operating system; parcels are the core unit. A dedicated parcel
detail page is brief-aligned in spirit. But the brief also says (§Phase E):
"Auth, database, AI agents, business logic, integrations remain untouched"
during port. Building the route mid-polish reintroduces port scope without
the design care a Tier 1 surface deserves.

**(c) Strongest alternative + argument:** Build a thin v1 now —
`/parcels/:id` route that just renders a property detail card composed of
existing widgets (`PropertyEnrichmentPage`, `AVMPage`, comps from
`MarketDataPage`). The argument: the surface is *not* truly absent — pieces
exist scattered across `/properties`, `/property-enrichment`, `/avm`,
`/market-data`. Composing them into one route gives Land Investors the
unified parcel view the brief describes without new business logic. Effort
shrinks from L to M.

**(d) Tradeoff:** Defer = correct scope discipline, but Land Investors keep
chasing data across 4 surfaces. Build thin v1 = better UX, but committing
to an integration shape before Atlas Run is properly designed risks
re-doing it.

**(e) Effort:** L for full prototype-matched build with Atlas Run;
M for thin compositional v1.

---

## 2. `founder-dashboard.tsx` re-skin (7435 lines / 293 hardcodes)

**Source:** JUDGMENT-CALLS E.6.1. Deferred to Phase G; only centralized
status map landed. Full re-skin warrants prototype-reference walkthrough.

**(a) Recommendation:** Replace the page rather than re-skin. Build a new
`founder-dashboard-v2.tsx` against `acreos/round3-integrations-2.jsx::FounderHomeC`
as the reference. Keep the old page mounted at `/founder-dashboard-legacy`
for one release, then delete.

**(b) Why this maps to the brief:** Design-system §14 lists founder mode as
one of six "extra-attention surfaces" — the brief explicitly schedules
"continuous design language with subtle accent + denser layout." A 7435-line
file with 293 inline color literals is structurally hostile to that kind of
care. The brief implies founder mode is the *taste-defining* surface;
patching 293 hardcodes to tokens preserves the broken structure.

**(c) Strongest alternative + argument:** Mechanical token migration only —
write a codemod that swaps known hex literals to design tokens, ship it,
defer further design work. Argument: it's safer, regresses nothing, and
unblocks deletion of one-off hex patterns. Founder gets a cleaner
tokenized version to iterate on without committing to a full rewrite.

**(d) Tradeoff:** Replace = clean slate, founder gets the actual prototype
fidelity, but two weeks of focused work and risk during transition.
Codemod = days not weeks, but you still have a 7435-line page that's hard
to evolve. Replace is the right long-term call; codemod is the right
this-quarter call.

**(e) Effort:** L (replace, with prototype walkthrough) or S (codemod-only
mechanical token migration).

---

## 3. `onboarding-v2.tsx` re-skin (1543 lines / ~50 remaining hardcodes)

**Source:** JUDGMENT-CALLS E.7.1. Phase G.2 partial polish landed; full
redesign deferred to dedicated session against `acreos-onboarding/screens-1..4.jsx`.

**(a) Recommendation:** Schedule a focused 2-day session against the
prototype. Don't attempt incremental polish — the gap between prototype's
"walk-into-a-workspace feel" and current is structural, not cosmetic.

**(b) Why this maps to the brief:** Design-system §14 calls out onboarding
explicitly: "First impression. Multi-screen wizard. Walk-into-a-workspace
feel, not a tour overlay." The current page works but reads as a setup
wizard, not the *workspace-arrival* the brief describes. The remembered
project state already says onboarding is org-scoped via
`OnboardingWizard.tsx` — the heavy lift is the *visual* shift, not the
state model.

**(c) Strongest alternative + argument:** Strip the page to its skeleton
and replace stage-by-stage. Argument: lower risk than a full rebuild;
preserves persistence shape; lets you A/B against current. Counter: the
whole point is that the wizard *flow* itself doesn't match the brief's
"walking into the room" metaphor — stage-by-stage replacement preserves
the flow that needs to change.

**(d) Tradeoff:** Full redesign = brief-aligned but risky on the highest-
stakes funnel surface. Stage replacement = safer but doesn't deliver the
brief's intent. Onboarding is the moment that decides if a Land Investor
becomes a customer; the brief says *workspace, not tour* — full redesign
is right.

**(e) Effort:** L (full redesign with prototype reference) or M (stage
replacement preserving flow).

---

## 4. Sidebar nav structure — flat IDs vs `NAV_MODULES` tree

**Source:** JUDGMENT-CALLS C.1.1, E.1.1, FINAL-PORT-AUDIT §5.3.
`useNavPreferences.sidebarItems` returns flat IDs; `layout-sidebar.tsx`
renders a structured `NAV_MODULES` tree. Mobile customization works;
desktop sidebar customization is not wired.

**(a) Recommendation:** Adopt the flat registry as canonical. Refactor
`NAV_MODULES` into a *grouping layer* on top of `ALL_NAV_ITEMS` —
groups become a flat array of `{ groupId, itemIds[] }` referencing
the registry. Desktop sidebar then renders by hydrating the IDs.

**(b) Why this maps to the brief:** Design-system §3 says navigation is
"opinionated about what's primary, but lets the operator customize."
A single source of truth (the flat registry) for both mobile + desktop is
the only way that promise holds — divergent definitions inevitably drift.
The structured tree's only real value is the groupings; that value
survives as a thin grouping layer.

**(c) Strongest alternative + argument:** Keep both, accept the divergence,
*don't* expose desktop customization in Settings → Appearance for now.
Argument: the structured tree carries information (group names,
capability tags) that the flat registry doesn't have; reconciling now
forces decisions about which structure wins. Quick fix: hide the
"customize sidebar" path until a focused refactor session.

**(d) Tradeoff:** Refactor = a unified model and customization works
everywhere, but it's a wide change touching every page that uses
sidebar items. Hide-for-now = honest about state, but founder pays the
cognitive cost of "why does this work on mobile but not desktop."

**(e) Effort:** M (refactor) or S (hide customization on desktop).

---

## 5. Notifications matrix redesign

**Source:** JUDGMENT-CALLS C.2.1, FINAL-PORT-AUDIT §5.3. Existing matrix
runs against the older `notification_preferences` table; richer
category/event tree exists in `server/services/notificationPreferences.ts`
but isn't surfaced. Phase C shipped quiet hours on top.

**(a) Recommendation:** Migrate the matrix to consume the richer service.
Bundle with: (i) drop the older table once migration verifies, (ii)
re-skin to the calm matrix design from brief §6.3, (iii) keep quiet
hours card above as the established pattern.

**(b) Why this maps to the brief:** Brief §6.3 calls for a "calm matrix —
events × channels, default off, opt in deliberately." Today's matrix is
more chaotic than that — too many rows, default-on for many events,
ungrouped. The richer service's category tree is the structural piece
needed to ship calm.

**(c) Strongest alternative + argument:** Rebuild from scratch with a
new schema that matches the brief exactly (categories with explicit opt-in
ladder, no inheriting defaults). Argument: the existing service still
carries legacy category structure not aligned to the brief's framing;
rebuilding once at this volume is cheaper than two migrations.

**(d) Tradeoff:** Migrate = lower risk, ship sooner, but inherit some
legacy structure decisions. Rebuild = brief-pure but two months not two
weeks; ships less. Migrate is right unless founder feels strongly the
structure is wrong, not just the visual.

**(e) Effort:** M (migrate) or L (rebuild from scratch).

---

## 6. `/founder/features` vs `/founder/feature-flags` naming

**Source:** JUDGMENT-CALLS D.4.1, FINAL-PORT-AUDIT §5.4. Both pages exist:
old binary `/founder/feature-flags`, new 5-state `/founder/features`.

**(a) Recommendation:** Consolidate to `/founder/features` (the new page).
Make the new page able to render binary flags as a fallback ("state
unknown — interpreted as binary"). Add a redirect from
`/founder/feature-flags` → `/founder/features`. Keep old page source for
one release in case flags-state migration surfaces edge cases, then delete.

**(b) Why this maps to the brief:** Brief §8 specs the 5-state machine
explicitly. Two pages doing nearly-the-same job is the kind of drift the
brief calls "polish gap" — Land Investors don't care, but it telegraphs
disorder to anyone who reads the codebase. The 5-state page is the
brief-correct surface.

**(c) Strongest alternative + argument:** Keep both, document the
difference in tooltips. Argument: binary flags exist in production data
and the old page is the truth-source for those rows; the new page's
audience editor doesn't apply to binary flags. Two pages = honest about
two data shapes.

**(d) Tradeoff:** Consolidate = single mental model, drift goes away.
Keep both = honest about the two data shapes. Consolidate wins because
the brief spec'd one model — divergence is a port artifact, not a design
goal.

**(e) Effort:** S.

---

## 7. Autonomy granularity + storage model

**Source:** JUDGMENT-CALLS C.4.1, D.5.1. Autonomy stored as nested object
inside `users.appearance_preferences` JSONB; tab gated via `useFlag`
component-level not route-level.

**(a) Recommendation:** Promote `autonomy` out of `appearance_preferences`
into its own column `users.autonomy_preferences` JSONB. Keep
component-level gate (don't move to route-level). Reasoning is split:
storage moves because autonomy is operational, not appearance — naming
matters when other engineers read the code; route gate stays where it is
because the rest of /settings is correctly visible.

**(b) Why this maps to the brief:** Brief §8.4 implies autonomy is its
own first-class concern, not a UI preference. Burying operational config
inside an "appearance_preferences" blob is the kind of accumulating
debt that makes future founders second-guess the schema. The brief also
says (§8.3) "no hide-from-sidebar hacks" — that's about navigation not
routing — but the spirit applies: 404'ing the entire /settings page
because one tab is gated would surprise users.

**(c) Strongest alternative + argument:** Leave it in
`appearance_preferences`. Argument: migration cost (column add + data
migration + zod schema split + 6+ call-site updates) for a naming change
nobody outside engineering sees. The blob fits "user preferences" as a
category umbrella; "autonomy lives there" is a documented decision
(JUDGMENT-CALLS C.4.1).

**(d) Tradeoff:** Promote = clean schema for the next engineer reading
the code, but a real migration. Leave = no migration cost, but every
engineer who lands on the autonomy code asks "why is this in
appearance_preferences." Founder taste call; the migration *cost* is
small but non-zero.

**(e) Effort:** S (column promotion + migration) or 0 (leave).

---

## 8. Agent identity colors — `AGENT_COLORS` / `JOB_COLORS` reconciliation

**Source:** FINAL-PORT-AUDIT §5.4. `AGENT_COLORS` (in `agent-detail.tsx`)
and `JOB_COLORS` (in `founder-dashboard.tsx`) hold per-codename hex
literals. Brief §1.3 says "simple letter mark beside it" but doesn't
fully spec the palette.

**(a) Recommendation:** Letter-mark + token-driven semantic tone. Each
agent gets one canonical letter (S for Sophie, F for Forge, A for Atlas,
P for Pax-as-customer-mask). Background uses a small fixed palette of
semantic tones from the design system (`--acr-tone-emerald`,
`--acr-tone-iris`, `--acr-tone-amber`, etc.) — three or four tones max,
assigned per agent. Hex literals deleted.

**(b) Why this maps to the brief:** Brief §1.3 is explicit about the
letter mark. Memory says "customers see Pax only; founder sees
Sophie/Forge/Atlas/etc. Never mix them" — that's a *separation* requirement
which a token palette honors (each persona gets a distinguishable but
quiet identity). Hex literals fight the design-token discipline the
rest of the brief enforces.

**(c) Strongest alternative + argument:** Keep per-codename hexes, but
move them into a single `agent-identity.ts` registry consumed by both
files. Argument: per-codename color *is* identity (Atlas = amber, Sophie
= rose) — flattening to four semantic tones erases distinction. Argument
fails partly because there are too many agents for unique color identity
to scale; tones-of-similar-saturation is a more sustainable convention.

**(d) Tradeoff:** Letter+tone = scalable, brief-aligned, but each agent
loses a small amount of unique visual identity. Hex registry =
recognition stays sharp but stops scaling beyond ~6 agents. Letter+tone
is the right call long-term.

**(e) Effort:** S (registry consolidation only) or M (full letter-mark
+ token palette + replace all consumers).

---

## 9. `finance.tsx` revenue/interest callouts — `text-emerald-600` / `text-amber-600`

**Source:** FINAL-PORT-AUDIT §5.4, Tier 3 audit. 32 inline color callouts
on monetary values.

**(a) Recommendation:** Replace with semantic tones from the design
system: positive deltas → `--acr-tone-positive`; negative → `--acr-tone-
negative`; warning thresholds → `--acr-tone-attention`. Don't preserve
the literal emerald/amber — those tones are too vivid for a finance
surface that should read calm-but-readable.

**(b) Why this maps to the brief:** Brief §1.2 ("the surface is
*considered*, not loud") and §6 (data displays should not cosplay as
dashboards) both push toward calmer monetary affect. Direct emerald-600
on dollar amounts reads as Stripe Dashboard, not as the AcreOS-brand
considered finish.

**(c) Strongest alternative + argument:** Keep inline tailwind classes,
just consolidate to two values (`text-positive` / `text-negative`
utility classes mapped in tailwind config). Argument: cheaper, same
tokenization benefit, doesn't require a CSS-variable round-trip.
Counter: Tailwind utilities don't theme-switch the way CSS variables do
under the 5-theme system; semantic tones must hit the variable layer
to honor Homestead/Quarry/Nocturne/Meadow/Slate parity.

**(d) Tradeoff:** Token-driven = themes work everywhere, but a touch
more refactor. Tailwind-utility = quicker but breaks the multi-theme
discipline. Token wins on consistency.

**(e) Effort:** S.

---

## 10. Founder letter — landing-flow accessibility

**Source:** FINAL-PORT-AUDIT §5.4. Letter exists at `/founder-letter` but
the brief requires "verbatim somewhere accessible (about page, /why, or
in the landing flow)." Route-level only satisfies bare minimum.

**(a) Recommendation:** Wire two surfaces:
(i) Footer link on the landing page reading *"From the founder"* →
`/founder-letter`. Quiet, not hero. (ii) Inline excerpt (3–4 sentences
from the letter) on the `/about` page or pricing page below the fold,
with "read full letter" → `/founder-letter`. Don't put the letter in the
hero or signup flow — the brief says *accessible*, not *promoted*.

**(b) Why this maps to the brief:** Brief explicitly calls for verbatim
accessibility. The Land Investors framing (memory: "v6 positioning") is
a story-driven brand — the founder voice belongs visible-but-not-loud.
Footer + about-page excerpt is exactly the "accessible without selling"
posture that voice expects.

**(c) Strongest alternative + argument:** Single footer link only.
Argument: simpler, doesn't risk the letter feeling like marketing copy;
people who care will find it. Counter: most visitors never scroll to
the footer on a content-rich landing page; the brief uses *accessible*
deliberately, not *findable*.

**(d) Tradeoff:** Two surfaces = better discoverability, slight risk of
"too founder-forward" tone. One surface = cleaner, lower discovery.
Two surfaces is right because the brief weights accessibility, not
ascetic restraint.

**(e) Effort:** S.

---

## 11. Inbox Pax-draft pre-fill

**Source:** JUDGMENT-CALLS E.2.4.1. Prototype shows "Pax drafted a reply ·
ready to review" card with pre-filled copy. Production shows blank
textarea. Inline TODO + `data-tour` anchor placed; full integration
deferred as feature add.

**(a) Recommendation:** Build it next, but as a feature project not a
polish pass. Spec needs: `POST /api/ai/draft-reply` (HANDOFF.md §6 stub
spec), source-attribution UI ("Pax drafted this"), edit/send actions,
a "regenerate" button, and a per-org disable toggle in settings (not
everyone wants AI drafts).

**(b) Why this maps to the brief:** Brief frames Pax as the *one
customer-facing AI persona* — auto-drafted replies in inbox is the
canonical Pax surface (memory: "Persona architecture — customers see
Pax only"). Without this, Pax has no daily touchpoint for most users;
inbox is where they live.

**(c) Strongest alternative + argument:** Defer indefinitely; pull when
founder picks the next feature push. Argument: AI drafts in customer
support tools have well-known failure modes (overconfident, generic,
miss context); shipping bad drafts is worse than no drafts. Counter: if
Pax can't draft an inbox reply, the persona doesn't have a foothold
anywhere a customer interacts with it daily — the brief's promise
hollows out.

**(d) Tradeoff:** Build = Pax becomes daily-real for customers but
ships AI quality risk. Defer = avoids the risk but the persona stays
abstract. Build with strong UX guardrails (edit-required-before-send
default, regenerate, source attribution) is the brief-aligned call.

**(e) Effort:** M (full integration with guardrails + per-org toggle).

---

## Cross-cutting pattern

Reading these eleven together, three themes recur:

1. **Surfaces deferred to Phase G are now polish-pass candidates.**
   Items 2 (founder-dashboard), 3 (onboarding-v2), 5 (notifications),
   8 (agent colors), 9 (finance callouts) all want the same kind of work:
   focused 1–2 day session against a prototype reference, replace not patch.
2. **Schema drift between port-time decisions and post-port preferences.**
   Items 4 (sidebar registry), 7 (autonomy storage), 6 (founder/features)
   all reflect "we shipped two structures and accepted divergence as
   port-time scope discipline; now decide canonical." Each individually
   is small; collectively they form a "schema-consolidation pass" that
   could be its own focused session.
3. **One feature project: Pax in inbox.** Item 11 is the only true
   feature-add in the list; the others are polish or schema. Worth
   sequencing separately.

If I were ordering tomorrow's triage by ROI: 6 → 9 → 10 (S effort, brief
clarity gains), 4 → 7 → 8 (S/M, schema/identity), 1 → 5 → 2 → 3 (M/L,
focused design sessions), 11 (M, separate feature project).
