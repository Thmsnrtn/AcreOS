# AcreOS Surface Inventory

> Generated 2026-04-22 for the Elite Team Continuous Refinement Pass.
> 163 distinct routes × ~3–5 states each = ~500 surfaces total.
> Ordered by visit frequency / user impact (public first, then highest-traffic
> authenticated, then long-tail).
>
> Each surface has typical states unless noted: **loaded / loading / empty /
> error / auth-redirect**. Mobile-critical surfaces get explicit 375px and
> 414px checks; desktop-only tools (founder ops) skip mobile verification.
> For every surface, nine specialist lenses apply (see prompt).

Status legend: ⬜ not refined · 🟦 in progress · ✅ all-9 sign-off ·
⚠️ deferred with rationale.

---

## 1. Public Surfaces (unauthenticated, SEO-relevant)

Critical for first impression, conversion, and trust signals.

| Status | Route | States | Mobile-critical | Notes |
| ------ | ----- | ------ | --------------- | ----- |
| ⬜ | `/` (landing) | hero, features, pricing teaser, footer | Yes | Multi-section hero page |
| ⬜ | `/pricing` | loaded, toggle monthly/annual | Yes | Comparison table swipe hint added 2026-04-22 |
| ⬜ | `/changelog` | loaded, empty, error | Yes | Reads `CHANGELOG.md` |
| ⬜ | `/status` | loaded, degraded, loading, error | Yes | Live service checks |
| ⬜ | `/terms` | static | Yes | Legal doc |
| ⬜ | `/privacy` | static | Yes | Legal doc |
| ⬜ | `/help` | static + search | Yes | Public help hub |
| ⬜ | `/auth` | sign-in, sign-up (hash #/register), ticket callback, error | Yes | Clerk widget — default purple needs override |
| ⬜ | `/portal/:accessToken` | borrower portal (external link) | Yes | No-auth path with HMAC token |
| ⬜ | `/sign/:docId` | signer view, expired, signed | Yes | E-sign landing |
| ⬜ | `/not-found` catch-all | loaded | Yes | 404 page |

## 2. Onboarding

First-run experience. Every friction here costs conversion.

| Status | Route | States | Mobile-critical | Notes |
| ------ | ----- | ------ | --------------- | ----- |
| ⬜ | `/onboarding-v2` | multi-step wizard, each step, error recovery | Yes | 1339-line page, grid-cols-3 in places |
| ⬜ | `/founder/onboarding` | founder-only | No | Admin-facing |
| ⬜ | *Invite-accept flow* | embedded in `/auth?invite=<token>` | Yes | Side-effect of auth page |

## 3. Post-Login Core (highest traffic)

Every authenticated user hits these daily.

| Status | Route | States | Mobile-critical | Notes |
| ------ | ----- | ------ | --------------- | ----- |
| 🟦 | `/today` | loaded, empty (new user), partial data, error | Yes | Post-sign-in landing; 13 queries, Business Pulse, Pax Noticed |
| ⬜ | `/pipeline` | list, detail, empty | Yes | Deals pipeline view |
| ⬜ | `/leads` | table, detail drawer, empty, filter, bulk-select | Yes | 2000+ line page, status badges recolored 2026-04-22 |
| ⬜ | `/leads/dedupe` | clusters, merge, skip | Yes | Batch dedupe tool |
| ⬜ | `/properties` | map + list split, detail, create modal | Yes | 2800+ lines, map + list |
| ⬜ | `/deals` | kanban, list, detail drawer, 5-tab detail, empty | Yes | 1300+ lines, AI coaching recolored 2026-04-22 |
| ⬜ | `/offers` | list, detail, create | Yes |  |
| ⬜ | `/offers/batches` | list, detail | Yes |  |
| ⬜ | `/finance` | notes list, detail, create note | Yes | Seller-financing notes |
| ⬜ | `/money` | aggregate finance dashboard | Yes |  |
| ⬜ | `/tasks` | list, detail, complete, empty | Yes |  |
| ⬜ | `/inbox` | thread list, thread detail, compose | Yes | Unified inbox |
| ⬜ | `/activity` | timeline, filters | Yes |  |
| ⬜ | `/goals` | active, complete, create | Yes | Grid-cols-2 in places |
| ⬜ | `/dashboard` | founder/user variant, widgets | Yes | Generic dashboard |

## 4. AI Features (customer-facing)

Atlas, Pax — customer-visible AI surfaces.

| Status | Route | States | Mobile-critical | Notes |
| ------ | ----- | ------ | --------------- | ----- |
| ⬜ | `/ai` | AI hub / Pax insights | Yes |  |
| ⬜ | `/pax` | Pax copilot full view | Yes |  |
| ⬜ | `/atlas` | Atlas chat + suggestions | Yes |  |
| ⬜ | `/negotiation` | negotiation copilot | Yes | LLM-backed |
| ⬜ | `/vision-ai` | photo analysis | Yes |  |
| ⬜ | `/document-intelligence` | doc OCR + extraction | Yes |  |
| ⬜ | `/deal-hunter` | AI deal finder | Yes |  |

## 5. Marketing & Outreach

| Status | Route | States | Mobile-critical | Notes |
| ------ | ----- | ------ | --------------- | ----- |
| ⬜ | `/campaigns` | list, detail, create, template picker | Yes |  |
| ⬜ | `/direct-mail` | batch list, create, sent log | Yes |  |
| ⬜ | `/sequences` | list, detail, editor | Yes |  |
| ⬜ | `/my-letter` | custom letter editor | Yes |  |
| ⬜ | `/syndication` | platform picker, status | Yes |  |
| ⬜ | `/syndication-status` | dashboard | Yes |  |
| ⬜ | `/listings` | public listings feed | Yes |  |
| ⬜ | `/investor-network` | buyer directory | Yes |  |

## 6. Research & Intelligence

Heavy data views, maps, external API calls.

| Status | Route | States | Mobile-critical | Notes |
| ------ | ----- | ------ | --------------- | ----- |
| ⬜ | `/maps` | Mapbox view, property markers | Yes | Heavy vendor chunk |
| ⬜ | `/counties` | county list, detail | Yes |  |
| ⬜ | `/market-data` | tables, charts | Yes |  |
| ⬜ | `/market-intelligence` | reports | Yes |  |
| ⬜ | `/market-watchlist` | saved markets | Yes |  |
| ⬜ | `/zoning` | zoning lookup form + result | Yes | Grid-cols-3 internal |
| ⬜ | `/skip-tracing` | single trace, bulk, results | Yes | Grid-cols-3 recolored 2026-04-22 |
| ⬜ | `/title-search` | search + result | Yes |  |
| ⬜ | `/property-enrichment` | pipeline, results | Yes |  |
| ⬜ | `/tax-delinquent` | search, list, bulk | Yes |  |
| ⬜ | `/property-tax` | per-property tax view | Yes |  |
| ⬜ | `/avm` | single-property AVM | Yes |  |
| ⬜ | `/avm-bulk` | batch AVM | No |  |
| ⬜ | `/seller-intent` | prediction dashboard | Yes |  |
| ⬜ | `/radar` | acquisition radar | Yes |  |
| ⬜ | `/deal-feed` | daily deal feed | Yes |  |
| ⬜ | `/deal-patterns` | analysis | Yes | Grid-cols-3 internal |

## 7. Financial Ops

| Status | Route | States | Mobile-critical | Notes |
| ------ | ----- | ------ | --------------- | ----- |
| ⬜ | `/bookkeeping` | ledger, categories | Yes |  |
| ⬜ | `/cash-flow` | projection, history | Yes |  |
| ⬜ | `/forecasting` | charts | Yes |  |
| ⬜ | `/fee-dashboard` | fees breakdown | Yes | Grid-cols-3 internal |
| ⬜ | `/closing-costs` | estimator | Yes |  |
| ⬜ | `/commissions` | history, detail | Yes |  |
| ⬜ | `/depreciation` | calculator | Yes |  |
| ⬜ | `/exchange-1031` | 1031 tracker | Yes |  |
| ⬜ | `/tax-optimizer` | scenarios | Yes | Grid-cols-3 recolored 2026-04-22 |
| ⬜ | `/tax-researcher` | research | Yes |  |
| ⬜ | `/portfolio` | portfolio overview | Yes |  |
| ⬜ | `/portfolio-health` | metrics | Yes |  |
| ⬜ | `/portfolio-optimizer` | optimization | Yes |  |
| ⬜ | `/portfolio-pnl` | P&L | Yes |  |
| ⬜ | `/price-optimizer` | price recommendations | Yes |  |
| ⬜ | `/dunning` | collections | Yes |  |
| ⬜ | `/capital-markets` | investor-facing data | Yes |  |
| ⬜ | `/land-credit` | credit score view | Yes |  |

## 8. Workflow / Automation

| Status | Route | States | Mobile-critical | Notes |
| ------ | ----- | ------ | --------------- | ----- |
| ⬜ | `/automation` | rules list, create | Yes |  |
| ⬜ | `/workflows` | diagrams, edit | Desktop-priority | Complex editor |
| ⬜ | `/decision-queue` | pending decisions, approve/reject | Yes |  |
| ⬜ | `/documents` | docs library | Yes |  |
| ⬜ | `/state-documents` | per-state forms | Yes |  |
| ⬜ | `/dodd-frank` | compliance checker | Yes |  |
| ⬜ | `/compliance` | status dashboard | Yes |  |
| ⬜ | `/regulatory-intel` | feed | Yes |  |
| ⬜ | `/ab-tests` | experiments list | Yes |  |
| ⬜ | `/webhooks` | subscriptions | Desktop-priority |  |
| ⬜ | `/blind-offer-wizard` | wizard | Yes |  |

## 9. Team / Collaboration

| Status | Route | States | Mobile-critical | Notes |
| ------ | ----- | ------ | --------------- | ----- |
| ⬜ | `/team` | member list, roles | Yes |  |
| ⬜ | `/team-dashboard` | metrics | Yes |  |
| ⬜ | `/team-inbox` | shared inbox | Yes |  |
| ⬜ | `/team-kpi` | per-rep KPIs | Yes |  |
| ⬜ | `/team-leaderboard` | rankings | Yes |  |
| ⬜ | `/agent-collaboration` | agent-to-agent view | Yes | Border uses purple |
| ⬜ | `/agents` | agent list | Yes |  |
| ⬜ | `/agent-performance` | metrics | Yes |  |
| ⬜ | `/agent-command-center` | control | Yes |  |
| ⬜ | `/ai-team` | AI agent roster | Yes |  |
| ⬜ | `/conscious-organization` | org health | Yes |  |
| ⬜ | `/anticipatory-enterprise` | predictions | Yes |  |

## 10. Settings & Profile

| Status | Route | States | Mobile-critical | Notes |
| ------ | ----- | ------ | --------------- | ----- |
| ⬜ | `/settings` | profile, org, theme, billing tabs | Yes | 1700+ lines; theme picker lives here (important for the purple bug) |
| ⬜ | `/settings/email` | per-campaign email config | Yes |  |
| ⬜ | `/settings/mail` | direct-mail config | Yes |  |
| ⬜ | `/settings/privacy` | privacy controls | Yes |  |
| ⬜ | `/support` | support tickets + chat | Yes |  |
| ⬜ | `/academy` (NOT IN ROUTES — orphan?) | | No | Check |

## 11. Admin / Beta Ops

| Status | Route | States | Mobile-critical | Notes |
| ------ | ----- | ------ | --------------- | ----- |
| ⬜ | `/admin/beta` | beta dashboard | No |  |
| ⬜ | `/admin/beta-analytics` | metrics | No |  |
| ⬜ | `/admin/beta-intake` | applications | No |  |
| ⬜ | `/admin/decisions` | decision review | No |  |
| ⬜ | `/admin/integrations-health` | health table | No |  |
| ⬜ | `/admin/monitor` | system monitor | No |  |
| ⬜ | `/admin/ops` | ops dashboard | No |  |
| ⬜ | `/admin/queues` | queue monitor | No |  |
| ⬜ | `/admin/safety-gates` | safety rules | No |  |
| ⬜ | `/admin/support` | support admin | No |  |
| ⬜ | `/reseller` | reseller dashboard | No |  |
| ⬜ | `/data-export` | export jobs | No |  |
| ⬜ | `/data-moat` | data moat dashboard | No |  |
| ⬜ | `/usage` | usage analytics | Yes |  |
| ⬜ | `/audit-log` | log viewer | No |  |
| ⬜ | `/event-log` | events | No |  |
| ⬜ | `/job-health` | job monitor | No |  |

## 12. Founder-Only

Not customer-visible. Lower refinement priority but still must-not-break.

| Status | Route | States | Mobile-critical | Notes |
| ------ | ----- | ------ | --------------- | ----- |
| ⬜ | `/founder` | founder home | No |  |
| ⬜ | `/founder-dashboard` | 7363-line page, 40+ queries | No | Lots of purple in here |
| ⬜ | `/founder-home` | home | No |  |
| ⬜ | `/founder/agents` | agent list | No |  |
| ⬜ | `/founder/agents/:codename` | agent detail | No |  |
| ⬜ | `/founder/ai-observatory` | LLM traces | No |  |
| ⬜ | `/founder/beta-analytics` | metrics | No |  |
| ⬜ | `/founder/daily-digest` | digest | No |  |
| ⬜ | `/founder/decisions` | decisions queue | No |  |
| ⬜ | `/founder/expansion` | expansion plan | No |  |
| ⬜ | `/founder/experiments` | experiment tracker | No |  |
| ⬜ | `/founder/feature-flags` | flag management | No |  |
| ⬜ | `/founder/integrations` | integration health | No |  |
| ⬜ | `/founder/letter` | letter editor | No |  |
| ⬜ | `/founder/preview` | customer preview | No |  |
| ⬜ | `/founder/prompt-evolutions` | prompt history | No |  |
| ⬜ | `/founder/prompt-history` | history | No |  |
| ⬜ | `/founder/providers` | provider matrix | No |  |
| ⬜ | `/founder/settings` | founder-specific settings | No |  |
| ⬜ | `/founder/strategy` | strategic compass | No |  |
| ⬜ | `/founder/todo` | todos | No |  |
| ⬜ | `/founder/tools` | founder tools | No |  |
| ⬜ | `/founder/traces` | LLM traces | No |  |
| ⬜ | `/founder/trends` | trend analysis | No |  |
| ⬜ | `/founder/v13` | sovereign v13 | No | Grid-cols-6 fixed 2026-04-22 |
| ⬜ | `/sovereign` | sovereign dashboard | No |  |
| ⬜ | `/board-of-directors` | board view | No |  |
| ⬜ | `/executive-dashboard` | exec view | No |  |
| ⬜ | `/command-center` | command center | No |  |
| ⬜ | `/memory-browser` | agent memory | No |  |
| ⬜ | `/model-training` | training UI | No |  |
| ⬜ | `/night-cap` | end-of-day | No | Heavy violet usage |
| ⬜ | `/real-runtime` | runtime monitor | No |  |
| ⬜ | `/safety-gates` | safety rules | No |  |
| ⬜ | `/cohort-analysis` | cohorts | No |  |
| ⬜ | `/matching-engine` | matching internals | No |  |
| ⬜ | `/buyer-qualification` | buyer qualifier | No |  |
| ⬜ | `/buyer-network` | buyer network | No |  |
| ⬜ | `/va-dashboard` | VA dashboard | No |  |
| ⬜ | `/field-scout` | field scout view | No |  |
| ⬜ | `/territory-manager` | territory manager | No |  |
| ⬜ | `/kpis` | KPI dashboard | No |  |
| ⬜ | `/analytics` | analytics hub | No |  |
| ⬜ | `/freedom-meter` | freedom meter | No | Heavy purple |
| ⬜ | `/proactive-monitor` | proactive monitor | No |  |
| ⬜ | `/tools` | tool list | Yes | Recently audited for purple |
| ⬜ | `/marketplace` | marketplace | Yes |  |
| ⬜ | `/marketplace-analytics` | marketplace metrics | No |  |
| ⬜ | `/voice-analytics` | voice call analytics | No |  |

## 13. Cross-Cutting Component States

Every one of these appears across multiple pages and is refined as a unit.

| Status | Component / Primitive | Surface |
| ------ | --------------------- | ------- |
| ⬜ | `<Button>` variants (default, outline, destructive, ghost, link) | global |
| ⬜ | `<Card>` + hover/active states | global |
| ⬜ | `<Input>`, `<Textarea>`, `<Select>`, `<Combobox>` | forms |
| ⬜ | `<Dialog>` / `<Sheet>` (Radix) — mobile full-screen behaviour | modals |
| ⬜ | `<Toast>` + variants (default, destructive, success) | feedback |
| ⬜ | `<Skeleton>` shapes + shimmer | loading |
| ⬜ | `<EmptyState>` component | empty |
| ⬜ | `<QueryErrorState>` | error |
| ⬜ | `<AutoBreadcrumb>` | navigation (new 2026-04-22) |
| ⬜ | `<PageHeader>` | navigation |
| ⬜ | Layout sidebar (desktop) + mobile drawer | navigation |
| ⬜ | Bottom tab bar (mobile) | navigation |
| ⬜ | Focus ring system (`:focus-visible`) | accessibility |
| ⬜ | Error boundary UI | errors |

## 14. Breakpoint Matrix

Every mobile-critical surface above must be verified at:

- 320px (iPhone SE 1st gen — smallest still-in-use)
- 375px (iPhone SE/13 mini baseline)
- 414px (iPhone Plus / Pro Max width)
- 768px (iPad portrait, below `md:`)
- 1024px (iPad landscape / small laptop — `lg:` boundary)
- 1440px (standard laptop)
- 1920px (full desktop)

For each breakpoint: no horizontal page-scroll, all tap targets ≥44pt, text ≥12px
(≥16px for form inputs to prevent iOS zoom), critical content above fold, no
icon-label crush.

## 15. Deferred / Not-in-scope

| Route | Reason |
| ----- | ------ |
| `/founder/*` most admin surfaces | Customer-invisible; defer to final polish pass |
| `/workflows` visual editor | Desktop-only tool by design |
| `/avm-bulk` | Batch tool, desktop-only acceptable |

---

## Sign-off Rubric (per-surface)

Before marking a surface ✅, all nine specialists must silently agree:

1. **Designer** — hierarchy, rhythm, spacing, typography, color usage all
   intentional and consistent with the rest of the app.
2. **Mobile designer** — verified at 375px in Playwright; all controls reachable
   with a right thumb; no horizontal scroll; text legible.
3. **Accessibility** — keyboard-traversable; visible focus; meaningful aria
   labels on icon-only buttons; color contrast ≥4.5:1 for text.
4. **Engineer** — loading/empty/error states present and correct; no console
   warnings; type-safe; no unhandled rejections.
5. **AI systems** — if LLM output appears, it's structured, grounded, and has a
   graceful fallback on failure.
6. **Land investor** — vocabulary is correct (parcel, acreage, APN, seller
   financing, etc.); no SaaS-generic labels on domain-specific data.
7. **Copywriter** — CTAs are specific verbs + object; empty-states have clear
   next action; error messages name the problem and the fix.
8. **Infrastructure** — external calls have timeouts; retries are bounded;
   degraded modes are graceful.
9. **Trust** — currency, dates, and periods are explicit; money/legal screens
   display confirmation affordances; no "oops try again."

---

*The inventory is living — append discovered sub-surfaces as refinement progresses.*
