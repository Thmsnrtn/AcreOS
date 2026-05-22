# Financial + Mail Platform — Next Wave Plan

**Status:** Draft, 2026-05-22 (Tom + Claude planning session)
**Author:** Tom Norton + Claude Opus 4.7
**Depends on:** F-D36 launch gate (`SIMULATION_MODE=false`)
**Estimated effort:** 6–8 weeks engineering + 4–6 weeks USPS permit paperwork in parallel

## Why this plan exists

Today AcreOS gates the cheap things (CRUD on leads/properties) and leaves the expensive things (SMS, postcards, AI tokens) effectively uncapped beyond a sequence count. One Lob postcard campaign on a Starter customer is 750% of their monthly MRR. The platform is one heavy month away from negative unit economics on every paid tier.

Three pillars solve this together:

1. **Financial substrate** — every dollar in and every dollar out flows through a single ledger that splits revenue into buckets (tax / refund / opex / profit) the moment it arrives and posts every external API spend against `opex_available` automatically. Founders see real-time contribution margin per org.

2. **Mail router + consolidator play** — stop being a Lob reseller; become a small bulk mailer with software UX on top. Route each shipment to the cheapest viable provider (Lob / PostGrid / EDDM / direct presort). Aggregate cross-customer batches to hit USPS volume tiers. Sell co-marketing back-of-card to flip margin positive.

3. **Customer-facing mail UX that earns the "wow"** — live per-piece tracking, transparent provider routing, live cost math, EDDM map-select, QR↔inbound-call attribution, Pax-drafted copy, USPS Informed Delivery integration. "Where has this tool been?"

Plus a fourth, smaller stream: realign pricing tiers to meter what actually costs money.

## What gets built (one-line per pillar)

| Pillar | Deliverable | Touch surface |
|---|---|---|
| 1 | `financial_ledger` schema + Stripe webhook splitter + cost-event hooks + `/founder/finance` UI | server/routes-finance-ledger.ts, services/financial-ledger.ts, pages/founder/finance.tsx |
| 2 | `MailRouter` + provider adapters (Lob, PostGrid, EDDM, presort) + daily aggregation queue + USPS permit | services/mail/router.ts, providers/, jobs/mailAggregator.ts |
| 3 | `/outreach/mail` redesign — composer + map-select + live tracker + attribution graph | pages/outreach/mail/, components/mail/ |
| 4 | Credit system extension — meters SMS+email+postcard+skip-trace+AI under one pool | shared/billing/credits.ts, services/credits.ts |

---

# Pillar 1: Financial Ledger

## Goal

Single immutable append-only ledger of every dollar in and every dollar out, denominated in **cents**, tagged with `org_id`, `feature`, and `bucket`. Source of truth for:

- Real-time MRR by tier
- Per-org contribution margin (live)
- Net-negative customer alarms
- Tax reserve balance
- Refund reserve balance
- Opex runway
- Profit accrual

## Schema

```ts
// shared/schema.ts — new table
export const financialLedger = pgTable("financial_ledger", {
  id: serial("id").primaryKey(),

  // What
  amountCents: bigint("amount_cents", { mode: "number" }).notNull(),   // signed; positive=income, negative=expense
  bucket: text("bucket").notNull(),  // 'revenue' | 'tax_reserve' | 'refund_reserve' | 'opex_available'
                                     // | 'profit_reserve' | 'owner_draw' | 'opex_spent'
  category: text("category"),        // 'subscription' | 'sms' | 'email' | 'postcard' | 'skip_trace' | 'ai_tokens' | 'stripe_fee' | ...

  // Where it came from
  organizationId: integer("organization_id").references(() => organizations.id),
  feature: text("feature"),          // 'campaign_send' | 'pax_chat' | 'lead_enrichment' | ...
  providerName: text("provider_name"),  // 'lob' | 'postgrid' | 'eddm' | 'twilio' | 'ses' | 'openrouter' | 'stripe'
  providerEventId: text("provider_event_id"),  // stripe_invoice_xxx, lob_letter_yyy, etc.

  // Idempotency
  externalEventId: text("external_event_id").unique(),  // dedupe key — never post the same event twice

  // Bookkeeping
  postedAt: timestamp("posted_at").defaultNow().notNull(),
  postedBy: text("posted_by"),       // 'stripe_webhook' | 'lob_cost_hook' | 'manual_adjustment'
  notes: text("notes"),

  // Optional links into existing records
  invoiceId: integer("invoice_id"),
  campaignId: integer("campaign_id"),
}, (t) => ({
  byOrg: index("ledger_org_idx").on(t.organizationId),
  byBucket: index("ledger_bucket_idx").on(t.bucket),
  byPostedAt: index("ledger_posted_at_idx").on(t.postedAt),
}));
```

**Append-only invariant:** no UPDATE/DELETE on this table. Corrections post a counter-entry. Audit trail is the table.

## Hooks

| Event | Posts |
|---|---|
| Stripe `invoice.paid` (gross +9900¢) | +9900 revenue; -2475 tax_reserve; -990 refund_reserve; -495 profit_reserve; -5940 opex_available |
| Stripe `charge.refunded` | -X refund_reserve; +X revenue (back-out) |
| Stripe fee (~3% + 30¢) | -X opex_available, category=stripe_fee |
| Lob postcard sent | -X opex_available, category=postcard, provider=lob/postgrid/eddm/presort |
| Twilio SMS sent | -X opex_available, category=sms |
| SES email sent | -X opex_available, category=email |
| Skip-trace lookup | -X opex_available, category=skip_trace |
| OpenRouter AI call | -X opex_available, category=ai_tokens |

All hooks idempotent via `externalEventId` unique constraint.

## Allocation policy (configurable, defaults)

```ts
// shared/billing/allocation-policy.ts
export const ALLOCATION_POLICY = {
  tax_reserve: 0.25,       // federal/state — non-negotiable
  refund_reserve: 0.10,    // chargeback + voluntary refund buffer
  profit_reserve: 0.05,    // "don't touch" runway
  owner_draw: 0.05,        // salary equivalent
  opex_available: 0.55,    // everything else; what variable spend draws against
};
// Total: 1.00 ✓
```

Lives in `founder_settings` so Tom can tune without a deploy (already supported via the settings substrate).

## Founder UI surface

New page: `/founder/finance` (extracts from the dashboard monolith per CLAUDE.md).

**Above the fold:**
- Live MRR (sum of active subscription deltas, last 30 days)
- Five bucket balances as horizontal stacked bars (tax / refund / profit / opex available / opex spent)
- Net contribution margin this month: $X (Y%) — green/red

**Per-org cohort:**
- Sortable table: org name | tier | MRR | variable cost this month | contribution margin $ | margin %
- Filter: "show net-negative customers" — gives Tom (and Sophie agent) the actionable list
- Row click → org detail with cost breakdown by category + 30-day cost timeline

**Decision-queue integration:**
- If org's variable cost > 60% of MRR for 14 consecutive days, Sophie raises a queue item: "Acreage Capital LLC will end month at -$12 contribution. Pause Lob send to this org? Cap to 2 postcards/day? Notify them?"

## Migration / rollout

1. Create table (idempotent migration).
2. Post all hooks behind feature flag `LEDGER_DOUBLE_WRITE=true` — write to ledger but don't yet remove old cost-tracking code.
3. Backfill from existing `aiUsageDaily`, `directMailOrders`, `messageEvents`, `skipTraces` tables with `postedBy='backfill_2026_05_22'`.
4. Verify ledger sum reconciles with Stripe Dashboard income for one full week.
5. Flip `/founder/finance` to read from ledger as source of truth.

## Success criteria

- [ ] Sum of ledger revenue rows over last 30 days matches Stripe Dashboard ±$0.10
- [ ] Sum of ledger opex_spent rows matches: Lob invoices + Twilio invoices + SES invoices + OpenRouter invoices for the same period ±$1
- [ ] `/founder/finance` shows live contribution margin per active org
- [ ] At least one Sophie decision-queue item fires when a synthetic org is forced to net-negative

---

# Pillar 2: Mail Router + Consolidator

## Goal

Make AcreOS the cheapest direct-mail provider any individual customer could plausibly pick — by aggregating across customers, routing per shipment, and bypassing Lob's middleman markup at volume.

## Provider matrix (target steady-state)

| Provider | All-in cost | Min volume | Lead time | Personalization | Use case |
|---|---:|---:|---|---|---|
| Lob | $0.55–$1.20 | 1 piece | 1–3 days | Yes | small batches, premium speed |
| PostGrid | $0.45–$0.85 | 1 piece | 1–3 days | Yes | default cheaper Lob replacement |
| EDDM | $0.31 | 200/route | 4–7 days | Carrier route only | geo-farming, county-wide blasts |
| Direct presort partner (RPI / Cathedral / NorthStar) | $0.30–$0.40 | 500/day | 2–5 days | Yes (VDP) | aggregated cross-customer batches |
| Lettrlabs / handwriting | $1.50–$3.00 | 1 piece | 5–7 days | Premium | high-value cold-offer ("white-glove") SKU |

## MailRouter contract

```ts
interface MailShipment {
  customerId: number;
  pieces: MailPiece[];          // each has recipient, template, vars
  speed: 'next_day' | 'standard' | 'batch_3d' | 'batch_weekly' | 'eddm_geo';
  budgetCentsPerPiece?: number; // hard ceiling; router refuses to exceed
  personalizationRequired: boolean;
  callbackUrl?: string;         // for delivery-status webhooks
}

interface ProviderQuote {
  provider: 'lob' | 'postgrid' | 'eddm' | 'presort' | 'lettrlabs';
  costPerPieceCents: number;
  deliveryEtaDays: number;
  minVolume: number;
  meetsConstraints: boolean;
  reasonIfNot?: string;
}

class MailRouter {
  async quote(shipment: MailShipment): Promise<ProviderQuote[]>;
  async route(shipment: MailShipment): Promise<{
    chosenProvider: ProviderQuote;
    alternatives: ProviderQuote[];
    savedVsLobCents: number;  // for the "you saved $X" badge in UI
  }>;
}
```

Router selection rule (simplest version):
1. Filter providers that meet `personalizationRequired`, `speed`, `budgetCentsPerPiece`.
2. Of remaining, pick lowest `costPerPieceCents`.
3. Tie-break: prefer aggregation queue (presort) when shipment can wait.

## Aggregation queue (the leverage move)

```
Day 0  10am: Customer A queues 12 pieces (speed=batch_3d)
Day 0  11am: Customer B queues 8  pieces (speed=batch_3d)
        ...
Day 0   4pm: CUTOVER. Aggregator selects all batch_3d-eligible from last 24h.
              Total: 1,247 pieces across 41 customers.
              Generate Mail.dat file; presort to 5-digit zip + carrier route.
              SFTP to RPI for next-day SCF drop-ship.
              Post -$0.32 × 1,247 = -$399.04 to opex_available.
              Charge each customer $0.50/piece (or their tier's overage rate).
Day 1   9am: USPS scans into ingestion at SCF.
Day 1+: USPS IMb scans flow back via Informed Visibility API.
        Each piece's status walks: printed → in_transit → out_for_delivery → delivered.
```

## Provider adapters

Each adapter implements the same interface; differences hidden behind it:

```
server/services/mail/providers/
  lob.ts          # existing — refactor to MailProvider interface
  postgrid.ts     # NEW
  eddm.ts         # NEW — wraps USPS BCG API + print partner
  presort.ts      # NEW — Mail.dat export + SFTP drop
  lettrlabs.ts    # NEW
  __index.ts      # exports registry
```

## USPS permit + presort onboarding (parallel work)

This is paperwork, not code. Lead time 4–6 weeks. Start immediately so it's ready when Pillar 2 ships.

1. Apply for USPS Mail.dat-eligible Permit Imprint Indicia at the local Business Mail Entry Unit. ~$350/yr.
2. Open a CAPS (Centralized Account Processing System) account for postage settlement.
3. Apply for Informed Visibility access (free, but requires permit).
4. Select print partner — RPI / Cathedral / NorthStar / Mailing Services of Pittsburgh. Get sample pricing.
5. Negotiate Mail.dat delivery SLA + SFTP credentials.
6. Test pipeline with 50–100 piece dummy batch addressed to founder + test addresses.

## Cost-attribution into ledger (Pillar 1 dependency)

Every provider adapter calls `ledger.postOpexSpent({ providerName, category: 'postcard'|'letter', amountCents, organizationId, feature, externalEventId })`. Router behavior is observable: a single `provider_spend_summary` view answers "what did Lob cost us this month vs PostGrid vs EDDM vs presort?"

## Co-marketing flip (margin upside, can ship later)

After core router is live, sell back-of-card to local title companies, surveyors, lenders, hard-money funds.

- Sponsor pays per-piece (negotiated, $0.30–$0.50 typical for a geo-matched send).
- Acreos applies the sponsor's pre-approved back-template.
- Net cost flips: from -$0.32 to +$0.10 per piece.
- New SKU in marketplace: "Mail Sponsorship" — sponsors buy slots, customers see sponsor logos on the back, customers get cheaper mail.

This is the moat. Lob can't do it because Lob doesn't know who the recipient is or who the matching sponsor would be. Acreos does.

## Success criteria

- [ ] Router can quote a shipment across all 5 providers in <500ms
- [ ] EDDM map-select can place a 1k-piece carrier-route blast
- [ ] Aggregation queue runs daily at 4pm CT, processes ≥1 cross-customer batch
- [ ] Per-piece USPS IMb scan flows back into `outreach_pieces.status` within 6 hours of scan
- [ ] One real customer batch ships via presort at sub-$0.40 all-in cost (measurable in ledger)

---

# Pillar 3: Customer-Facing Mail UX

This is where we earn the "where has this tool been all this time" reaction.

## Design principles (anchored to the brief Tom gave)

1. **Radical cost transparency.** Show the real per-piece cost before send, show the provider chosen, show the savings vs Lob baseline. Customer never wonders "is the platform marking this up?"
2. **Live per-piece state.** Every piece has a status timeline from queued → printed → USPS ingest → in transit → expected delivery → delivered → response window. No "your campaign is somewhere in the void."
3. **Attribution by default.** Every piece carries a unique QR + per-campaign tracked phone number. Every scan, every call, every reply links back to the piece, the lead, the deal.
4. **Cost-aware composer.** As the customer builds a send, the $/piece updates live as they change template, route, speed, personalization.
5. **Mistake-resistant.** Preview every piece. 30-minute hold-window after queue (one-click cancel). Refuse to send to recently-mailed addresses without explicit override.
6. **Pax in-flow.** "Draft this postcard for absentee owners in Hidalgo County who've owned ≥5 years" — Pax produces 3 variants; customer picks; ships.
7. **Mobile-first.** Investors check status from the truck.

## New page: `/outreach/mail`

Replaces existing campaign builder for mail surface. Five tabs:

### Tab 1 — **Compose**

| Section | Pattern |
|---|---|
| Audience | Multi-select: existing lead lists / saved views / property filters / EDDM map. Live count + estimated cost as filters change |
| Piece type | Cards: Postcard 4¼×6 ($0.45) / Postcard 6×9 ($0.65) / Letter #10 ($0.75) / Handwritten ($2.00). Hover shows what's included |
| Template | Library with response-rate badges. "This template: 4.7% response rate (12 campaigns, 8,400 sends). [Use] [Compare]" |
| Copy | Inline editor + Pax button: "Draft for me" — opens a side panel with 3 Pax variants |
| Speed | Radio: Next day / Standard / Batch (cheapest, 3-day) / EDDM blast / White-glove. Each shows live $/piece |
| Send button | Bottom-anchored. Shows total $: "Queue 247 pieces for $111.15 ($0.45/piece — saved $185.25 vs Lob)" |

### Tab 2 — **In Flight**

Live tracker for every piece currently in motion. Default view: timeline grouped by campaign.

```
Campaign R001 — "Hidalgo absentees v3"
247 pieces • $111.15 cost • sent 2026-05-22

┌─────────────────────────────────────────────────────────────────────┐
│ ●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●○○○○○○○○○○○○○○○○○○○○○○○○○○○○○○○○○○○○ │
│ printed  in transit                expected delivery  response window│
│  247       247                          227             20           │
└─────────────────────────────────────────────────────────────────────┘

  expand for per-piece view →
```

Per-piece detail expands to a list with: recipient name, address, status chip, USPS scan timestamps, QR scan count, inbound call count, response status.

**Wow moments:**
- Animated mailbox icon "opens" on delivery (USPS IMb scan)
- Each piece's QR scan triggers a subtle highlight on its row + counter increment
- Inbound call attribution: piece glows + plays a soft chime if the customer has notifications on

### Tab 3 — **Results**

Per-campaign attribution analytics.

- Funnel: sent → delivered → QR scanned → call received → call answered → deal opened → deal closed
- Cost per stage ($/sent, $/delivered, $/scan, $/call, $/deal)
- Response timeline: "47% of responses arrived in days 7–12"
- Cohort comparison: how this campaign performed vs prior campaigns using the same template
- Export raw piece-level data as CSV

### Tab 4 — **EDDM Map**

Full-screen interactive county map. Layers:
- Postal carrier routes (color-coded by household count)
- Parcel overlay (filter by acreage, owner state, last sale year, tax status)
- Demographic overlay (median income, owner-occupancy %)

Drag to select routes. Live updating "1,247 boxes selected across 8 routes — $387 to mail all of them. Estimated delivery in 4–7 days."

This is a competitive moat — almost no SaaS competitor has this. Land investors do this manually with paper maps today.

### Tab 5 — **Mail Credits**

Self-service top-up + history.

- Credit gauge: "Mail credits this month: 850 of 2,500 (34%)"
- Burn-rate chart: "At current pace, you'll run out in 8 days"
- Recharge: pay $X for Y credits, instant
- Itemized history: every credit debit tagged to a piece, every refund visible
- "What costs what" reference card always visible

## Public-facing transparency layer

For every piece sent, the customer can share a **public tracking link** with the recipient (optional setting). Recipient opens the link → sees:

- "A letter from [customer name] is on its way to you. Expected delivery: Friday, May 27."
- Map showing piece's current postal-route region (no exact location, just region)
- "Reply to [tracked phone] or scan QR on the piece"

This is novel. It positions AcreOS-mailed pieces as more legitimate than spam mail. Recipients are more likely to open them.

## Pax integration touchpoints

- **Draft copy** — Pax composes 3 variants based on audience characteristics
- **Suggest cadence** — "Most responses came 7–14 days after first send for this audience profile. Schedule follow-up?"
- **Detect mistakes** — "23% of this list was mailed in the last 30 days. Filter to new addresses?"
- **Flag unit-economics** — "This send will cost $185. Your remaining mail credits cover only 154 of 247 pieces. Top up or trim list?"
- **Auto-pause** — When response rate exceeds threshold, suggest pausing remaining sends to focus inbound

## Mobile-specific patterns

- Push notification on delivery scan ("Piece #142 delivered to 1234 Main St")
- Voice-trigger from /outreach/mail: "Pax, mail the standard postcard to everyone I tagged 'hot' yesterday"
- One-thumb composer for follow-up sends to a single lead

## Success criteria

- [ ] Composer shows live $/piece updating as customer changes options
- [ ] Every piece has a status timeline with at least 4 USPS scan events captured
- [ ] EDDM map can select a route + queue a 200+ piece blast
- [ ] At least one customer (could be Tom) completes a full send → delivered → response → deal-opened loop with attribution visible in /outreach/mail/results
- [ ] First five paying customers describe the UI as "obviously better than" their current tool (Pebble, REI Pebble, DirectSkip, Mailfold, etc.) in onboarding survey

---

# Pillar 4: Credit system + tier realignment

Smaller scope, big leverage. Done in parallel with Pillars 1–3 because it gates the pricing model.

## What changes

`services/usageLimits.ts` currently caps `leads / properties / notes / ai_requests / campaigns / sequences`. Extend to cap **variable-cost actions** with a unified credit pool denominated in cents-to-us.

### New tier-credit map

| Tier | MRR | Credit pool (¢) | Default split |
|---|---:|---:|---|
| Free | $0 | 50 | preview only |
| Starter | $20 | 750 (~$7.50 max cost) | ~$12.50 floor margin |
| Pro | $49 | 2,500 (~$25 max cost) | ~$24 floor margin |
| Scale | $79 | 8,000 (~$80 max cost) | break-even floor; differentiated by unlimited reads + BYOK |

### Credit weights

```ts
// shared/billing/credit-weights.ts
export const CREDIT_WEIGHTS = {
  sms_outbound: 1,           // ~$0.01
  email_outbound: 0.02,      // ~$0.0002 (very cheap)
  postcard_eddm: 31,         // ~$0.31
  postcard_postgrid: 55,     // ~$0.55
  postcard_lob: 75,          // ~$0.75
  letter_presort: 32,        // ~$0.32
  letter_lob: 120,           // ~$1.20
  skip_trace: 30,            // ~$0.30
  ai_turn_avg: 1.5,          // ~$0.015 — varies by model
};
```

1 credit ≈ 1¢ of variable cost. Customer thinks in dollars, system tracks in cents.

### Overage policy

Per-customer setting on signup:
- **Hard wall** (default): hit cap → block + upgrade nudge. Predictable bill, no surprises.
- **Pay-as-you-go**: hit cap → continue, billed at $0.02/credit ($0.020 = 2× cost-to-us, so still positive margin).

### BYOK lanes (Pro+)

Extend the existing `byokSupport: true` toggle from data providers to communications:
- BYO Twilio subaccount — your phone numbers, your A2P registration, your bill
- BYO SES domain — your sending reputation, your verified addresses
- BYO Lob/PostGrid key — passes through to your account

When BYOK is on for a channel, that channel's spend doesn't draw from credit pool. Customer feels less metered; AcreOS overhead drops to zero on that channel.

## Pricing page update

`client/src/pages/pricing.tsx` — reflect new credit pools, BYOK lanes, and an explainer of how credits map to actions. Concrete examples:

> Starter ($20/mo) — 750 mail credits. That's:
> - **24 EDDM postcards** to a single carrier route, OR
> - **13 standard letters** to a targeted list, OR
> - **750 SMS messages** to your leads, OR
> - **mix and match** — Pax helps you optimize

Visceral, concrete, in the customer's mental model.

## Success criteria

- [ ] Every variable-cost action posts a credit debit AND a ledger row in the same DB transaction
- [ ] Hitting the credit wall blocks the action and surfaces a "buy more or upgrade" interstitial
- [ ] BYOK Twilio test send works end-to-end through customer's own subaccount
- [ ] New pricing page reads from canonical `shared/billing/tier-pricing.ts` + `credit-weights.ts` (single source of truth)

---

# Sequencing (8-week target with one engineer; faster with parallelism)

```
Week 0  ──────────────────────────────────────────────────────────────
  • Flip SIMULATION_MODE for Tom's own org only (per-org override)
  • Validate one real Stripe checkout end-to-end against Tom's account
  • Apply for USPS Mail.dat permit (PARALLEL — 4-6 week paperwork)
  • Select print partner (RPI vs Cathedral vs NorthStar — 1 day of calls)

Week 1–2  ───────────────────────────────────────────────────────────
  • Pillar 1 schema: financial_ledger table + migration
  • Stripe webhook splitter posts revenue → 5-bucket rows
  • Cost-event hooks for AI / SMS / email (existing telemetry tables → ledger)
  • Lob cost hook posts opex_spent rows

Week 2–3  ───────────────────────────────────────────────────────────
  • Pillar 4: credit-weights.ts + extended TIER_LIMITS map
  • Hard-wall enforcement at action level (block + interstitial)
  • Pricing page UI update; concrete examples per tier
  • BYOK Twilio adapter scaffolding (test with Tom's own subaccount)

Week 3–4  ───────────────────────────────────────────────────────────
  • Pillar 2 router contract + Lob adapter refactor
  • PostGrid adapter (drop-in second provider)
  • Provider quote endpoint returns 2-provider comparison
  • Router auto-selects cheapest meeting constraints

Week 4–5  ───────────────────────────────────────────────────────────
  • Pillar 3 — /outreach/mail Compose tab + In Flight tab
  • Per-piece status pipeline (Lob webhooks + PostGrid webhooks → outreach_pieces.status)
  • Cost-aware composer with live $/piece
  • Mistake-resistance: 30-min hold window, recent-mail dedupe

Week 5–6  ───────────────────────────────────────────────────────────
  • EDDM provider + carrier-route map UI (Tab 4)
  • Pax integrations: draft copy / detect mistakes / suggest cadence
  • Public tracking link for recipients
  • Founder finance UI: live MRR + per-org contribution margin

Week 6–7  ───────────────────────────────────────────────────────────
  • Presort provider adapter (assuming USPS permit ready)
  • Daily aggregation queue + Mail.dat export + SFTP delivery
  • Results tab — funnel + cohort comparison
  • QR + tracked-number attribution wiring

Week 7–8  ───────────────────────────────────────────────────────────
  • Flip SIMULATION_MODE globally OFF
  • Migrate Tom's org to live, run 1 real customer flow
  • Watch first 7 days closely; tune credit weights against real cost data
  • Co-marketing sponsor SKU MVP (manual matching to start; productize later)
```

## Dependency graph

```
USPS permit ──┐                                            
              ▼                                            
              ─── presort adapter ─── aggregation queue ──┐
                                                          │
ledger schema ── stripe webhook ── cost hooks ────────────┼─── /founder/finance
                                                          │
credit weights ── tier map ─── hard wall ─── pricing page ┘
                                                          
router contract ── Lob+PostGrid ── EDDM ── presort ──── /outreach/mail
                                                          
Pax draft ─── attribution wiring ─── public tracking link ─── ship
```

The single longest-lead-time item is the USPS permit. Start it Day 1.

# Cross-cutting concerns

## Telemetry / observability

Every adapter + every ledger post emits a structured log:
```json
{
  "event": "mail.provider.quote",
  "provider": "postgrid",
  "shipmentId": 12345,
  "pieces": 247,
  "costPerPieceCents": 55,
  "savedVsLobCents": 185,
  "latencyMs": 240
}
```

Dashboards in `/founder/inspector/mail` show:
- Daily volume by provider
- Cost per provider over time
- Aggregation batch efficiency (pieces per batch, $ saved vs spot rate)
- Provider error rate

## Testing strategy

- Unit: every adapter, router, credit-weight calculation
- Integration: simulated Stripe webhook → ledger row → bucket balance update
- Contract: provider adapters all conform to `MailProvider` interface — one test runs against all
- End-to-end: Playwright flow that composes → previews → queues → cancels (30-min window) → re-queues → ships → tracks
- Cost calibration: weekly job compares actual provider invoices vs ledger sum; alerts if drift > 1%

## Migration safety

- Both Pillar 1 and Pillar 4 ship behind feature flags (`LEDGER_DOUBLE_WRITE`, `CREDIT_HARD_WALL_ENABLED`).
- Double-write to ledger for 30 days before flipping it as source of truth.
- Credit hard wall enforced as a warning toast first (1 week), then hard block.
- All provider routing decisions logged before being acted on — allows post-hoc cost analysis.

# What we explicitly DON'T build now

- Stripe Treasury sub-accounts (overkill until $50k+/mo flows)
- Real bank-account sweeps (virtual ledger is enough for first quarter)
- Auto-pause Sophie agent (decision-queue suggestion, not auto-execute)
- Co-marketing sponsor matching automation (manual to start)
- Enterprise tier pricing (custom contract on request; not a public SKU)
- Multi-currency support (USD-only for now)

# Open questions for Tom

1. **USPS permit owner** — Acreos LLC or a separate "Acreos Mail Services LLC"? Liability + tax implications.
2. **Refund policy** — automatic refund on credit overcharge, or manual review? Defines refund_reserve sizing.
3. **Sponsor curation** — Tom pre-approves sponsors, or open marketplace? Trust/quality vs scale.
4. **Pax tone in mail composer** — first-person investor voice or third-person "AcreOS suggests"? Affects copy.
5. **Public tracking link default** — opt-in or opt-out per customer? Default shapes recipient perception of AcreOS as a brand.

# Document graveyard / out-of-scope footnotes

- Lettrlabs / handwritten tier — keep as premium SKU but not first-batch implementation
- ListSource / PropStream parcel ingest — already exists, just plumb into EDDM map
- BYOK Lob — possible but unlikely worth shipping (PostGrid is cheaper anyway)
- "Profit First" multi-bank-account real-cash split — defer until $250k+/mo flows

---

# Verification: how we'll know it worked

90 days after Pillar 1 + 2 + 4 ship (Pillar 3 may lag for UI polish):

| Metric | Pre-plan | Target post-plan |
|---|---|---|
| Median per-piece mail cost | $0.85 (Lob spot) | $0.45 (router) → $0.32 (with aggregation) |
| Net contribution margin per Starter customer | unknown, likely -$50–$120/mo | +$5–$15/mo (positive floor) |
| Postcards sent per month, platform-wide | <100 (sim mode) | >5,000 (real production) |
| "Wow" moments per customer onboarding | 0 measured | ≥3 (track via NPS open-ended) |
| Founder-side time spent on cost firefighting | hours/week | <30min/week (Sophie auto-flags) |

The single most important measurement: **does every paying customer have a positive contribution margin in their first 60 days?** If yes, the unit economics work. If no, the credit weights or tier prices need tuning — and the ledger gives us the data to do it.
