# Experience

The doors, how unknown is shown, and the conventions that actually hold.
Verified at `10447296`, 2026-08-19.

---

## Five customer doors, four founder doors

**Today · Map · Deals · Finance · Pax**, plus Inbox and Settings from the top
bar. Identical for every persona and on every device. All three declaring files
agree: `DEFAULT_SIDEBAR_ITEMS`, `MOBILE_DOORS`, and the desktop rail's
`NAV_MODULES`.

**Persona changes only the CONTENT behind each door** — gated sections,
vocabulary, Finance tabs, the `businessTypeOnly` verticals. Never the doors.

A door cannot be collapsed by persona even by accident: `resolveHiddenRoutes()`
unions all three hiding axes and *then* subtracts the nine
`PROTECTED_DOOR_ROUTES`, so a future registry entry naming a door is inert rather
than load-bearing.

The founder side follows the same discipline, and harder — **the more the
autopilot operates the business, the fewer doors the founder needs**:

**The Letter (`/founder`) · Decisions · Controls · Story**, plus the
`/founder/admin/*` namespace for deep instruments visited deliberately. All three
rendering surfaces — desktop sidebar, mobile bottom bar, command palette — map
over the single `FOUNDER_DOORS` export rather than re-listing it.

**No new top-level nav entry, ever, on either side.** New surfaces live behind an
existing door as a child, section, or tab.

### Three corrections to the prose

- **`/founder/admin/*` is one route, not a namespace.** `/founder/admin/costs` is
  the only one at HEAD. `CLAUDE.md` and several docs describe it as an instrument
  namespace; that is aspiration, not state.
- **The founder route ratchet has ZERO headroom.** `FOUNDER_ROUTE_BASELINE = 82`
  and the count is 82. The next founder route added anywhere fails the build —
  which is the ratchet working, but know it before you start. 82 also overstates
  the real surface: only 58 render a page, 24 are redirects.
- **The four-door founder nav sits behind a localStorage flag that defaults ON,
  with a fully live pre-doctrine alternative behind it.** `?ui=old` flips to
  `FOUNDER_NAV_ITEMS_LEGACY` (Now · Steering · Studio · Inspector · CMO), which
  still renders. The doctrine is the default, not yet the only thing.

And the rule's actual scope: **five doors governs the NAV, not the route table.**
`App.tsx` declares 301 routes; 94 non-founder, non-redirect routes appear in no
nav registry at all. That is not a violation — it is what "reachable but not a
door" looks like — but do not read the nav as an inventory of the product.

## How unknown, conflict and refusal reach a customer

This is where the fabrication ban becomes an interface.

**UNKNOWN is a labelled gap with a reason, never an absent row or a default.**
`LandProfileGap` carries `{field, label, reason}` where reason is
`not_looked_up | no_data | lookup_failed`, and the parcel surface renders those
as three visibly different states: "Not yet pulled", "No data at this location",
"Source unavailable". A reader can tell "we have not asked" from "we asked and
there is nothing" — which is the whole point, and the distinction most products
throw away.

**REFUSAL is a persisted, appealable, customer-visible artifact** — not a chat
message that evaporates. A Pax refusal writes a row carrying the cited immutable
rule id *and* its plain-language text snapshotted at write time, and the customer
reaches the appeal from inside the Pax door. Snapshotting the text matters: the
customer sees what they were actually told, not what the rule says today.

**CONFLICT is computed, persisted, served — and rendered nowhere.**
`shared/evidence/claim.ts` makes conflict a first-class resolved state and says
the UI must show the disagreement. The API returns `conflicting: [...]`. There
are **zero client callers of the evidence endpoint**. This is the largest
experience gap in the product: the truth architecture's most distinctive output
has no surface.

## Conventions, and how strongly they hold

**Enforced as absolutes, with empty debt registers, over every file — not
samples:**

- Every icon-only button has an accessible name — 207 across 717 non-test `.tsx`.
- Every form input has an associated label — register empty, one declared
  exemption.
- Focus is visible — a global `*:focus-visible` rule.

**Followed at scale but NOT gated** — 1281 `<Skeleton>` elements across 335
files; `EmptyState` and `QueryErrorState` each imported by 135 files; 66 files
use the stagger animations. `EmptyState` enforces its own doctrine structurally:
`cta` is a **required** prop, so an empty state without a next action does not
compile. That is the pattern to copy — make the doctrine a type error rather than
a review comment.

**One live inconsistency worth knowing:** `fetch-honesty.ts` (`okOrThrow`,
`nullOn404`, `listFrom`) is the canonical "empty is not failed" primitive and has
four importers, while the shared `queryClient` helper that commits the exact
defect it fixes has 47 call sites. The canonical thing is real and the
non-canonical thing is what most code uses — the adoption trap, in the client.

## Frozen surfaces

`FROZEN_ROUTES` — `/marketplace`, `/capital-markets`, `/vision-ai`,
`/negotiation` — are denied client-side **before** the feature-flag logic, so a
flags outage cannot un-hide them. Deleted surfaces deliberately keep their entry
so a stale bundle gets a clean deny rather than a chunk-load error. That is the
expansion ladder made visible in the client.

## Nav link integrity

Currently perfect, and worth re-measuring rather than trusting: 102/102
`NAV_MODULES` hrefs, 32/32 `ALL_NAV_ITEMS`, 49/49 `FOUNDER_NAV_DEEP_DIVES` all
resolve to a real route. Two deep-dive links point at redirects, which is
harmless but is the shape that rots first.

## The standard

The backend may become extraordinarily sophisticated. **The customer experience
should become simpler.** Adaptive compression is a feature, not a compromise.

Watch for: elementary workflows, hidden complexity, weak defaults, unnecessary
configuration, dense interfaces, inconsistent behaviour across personas, generic
AI bolted onto a screen, duplicated CRM/task/inbox concepts, poor evidence
explanation, awkward map interactions, silent provider failure, inaccessible
newly-activated states, and expensive intelligence that adds little.
