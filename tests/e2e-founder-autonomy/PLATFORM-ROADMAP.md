# AcreOS platform roadmap — deep audit

**Date:** 2026-04-21
**Mandate:** zoom out across ~50 elite perspectives and catalog
300+ improvements that would take the platform to best-in-class
status.

---

## Where this platform is working toward

AcreOS isn't a CRM. The current trajectory — across the last
month's architectural work — points at something more specific:

> **A vertical OS that doesn't just manage a Land Investor's data
> but actively operates their business, with the investor as
> strategist and the platform as operator.**

Four pillars of that vision:

1. **Autonomous operations** — the 12-agent board + decision
   executor + safety-rail stack lets the founder (and customer)
   set direction, not dispatch tasks. Target: 1 hour of human
   attention per month per business.
2. **Self-improving** — prompt evolution, calibration, memory
   consolidation, A/B experiments all compound. Month 12 should
   feel meaningfully sharper than month 1 without human
   engineering.
3. **Narrative-first interface** — dashboards are for engineers.
   The founder gets a monthly letter; the customer gets a monthly
   letter. Numbers are there when you drill; the front door is
   prose.
4. **Vertical depth** — deliberately narrow (land investing with
   seller-finance emphasis). Depth beats breadth. Every feature
   should make a Land Investor's business measurably better,
   not theoretically more flexible.

Everything else in this document is in service of those four.

---

## How this catalog is organized

Twelve zones, each graded with priority (P1 = this quarter,
P2 = this year, P3 = "when there's time"). ~320 concrete items
total. The catalog is for strategic orientation, not sprint
planning — most items need context before execution.

At the end: a top-20 priority list with honest tradeoffs.

---

## Zone 1 — Navigation & information architecture

*50 elite perspectives: power user, new user, keyboard-only user,
mobile user, visually-impaired user, multi-org user, information
architect.*

| # | Item | Priority |
|---|---|---|
| 1 | Sidebar has 44+ items at full expansion. Usage-based reordering (show most-visited on top) | P2 |
| 2 | Breadcrumbs on deep paths (`/founder/experiments/123`) | P2 |
| 3 | Unify ⌘K (operator) + ⌘⇧K (founder) palettes into role-aware single palette | P3 |
| 4 | "Recently visited" list in sidebar | P2 |
| 5 | Keyboard shortcut overlay (press `⌘/` to see all) | P1 |
| 6 | Mobile bottom-nav default 4 items should be personalized by role | P2 |
| 7 | In-app forward/back history without relying on browser chrome | P3 |
| 8 | Command palette needs recency bias on results | P2 |
| 9 | Founder business group (13 items) should cluster by cadence (daily/weekly/monthly) | P2 |
| 10 | Favorites / pinned pages | P3 |
| 11 | Pax rail should be collapsible to icon-dock (iOS-style) | P2 |
| 12 | Notification pane filters (priority, category, org) | P2 |
| 13 | Sidebar: "recently viewed customers" shortcut | P3 |
| 14 | Org switcher for multi-org users (not yet common but coming) | P2 |
| 15 | Breadcrumb trail on `/organizations/:id` detail pages | P2 |
| 16 | Back-button behavior made consistent across pages | P2 |
| 17 | Tooltips on collapsed sidebar icons (currently only labels on hover) | P2 |
| 18 | Route transitions animated (fade/slide) | P3 |
| 19 | Loading indicator during route prefetch | P3 |
| 20 | Deep links preserve state (filter, sort, selection) | P2 |
| 21 | URL-driven filters so back button restores view | P2 |
| 22 | Collapsible sections remember state per user | P3 |
| 23 | Tab navigation within complex pages (org detail) | P2 |
| 24 | Sticky subnav on long pages | P2 |
| 25 | Jump-to-anchor links in letter / long content | P3 |

## Zone 2 — Visual design system

*Typography designer, visual designer, brand designer, iOS/macOS
designer.*

| # | Item | Priority |
|---|---|---|
| 26 | Type scale audit — consolidate to 6-8 sizes max, mapped to semantic tokens (display/title/body/caption) | P1 |
| 27 | Spacing scale enforced — 4/8/12/16/24/32/48/64; current mix (`space-y-4/6/8`) is ad-hoc | P2 |
| 28 | Border-radius: pick a scale (sm/md/lg/xl) and apply — currently ad-hoc | P2 |
| 29 | Shadow scale systematized (none / sm / md / lg / xl / 2xl) | P2 |
| 30 | Icon-size rules: 3 sizes max (14px / 16px / 20px) with documented use | P2 |
| 31 | Button sizes normalized — one size per context, not mixed | P2 |
| 32 | Motion system: spring curves, durations, staggers documented | P2 |
| 33 | Dark mode pass — every branded color pair verified | P1 |
| 34 | Hover / focus / active states consistent on every interactive element | P1 |
| 35 | Keyboard focus ring visible app-wide, respects `:focus-visible` | P1 |
| 36 | Empty-state illustrations beyond Lucide icons — branded | P3 |
| 37 | Logo: replace "A" placeholder with proper wordmark + icon | P1 |
| 38 | Favicon: branded, not generic | P1 |
| 39 | "Land Investors" gradient from hero: repeat on key brand moments | P3 |
| 40 | Recharts default styling replaced with brand palette + typography | P2 |
| 41 | Aerial imagery (13 unused photos in public/images) — use on landing hero + section backgrounds | P1 |
| 42 | Status indicators: one set of tokens (red/amber/green/blue) with semantic names | P2 |
| 43 | Badge variants: define when to use each (`default/secondary/outline/destructive`) | P2 |
| 44 | Card header spacing normalized | P2 |
| 45 | Divider use reduced — rely on spacing + hierarchy | P3 |
| 46 | Text truncation consistent — `line-clamp-N` everywhere | P2 |
| 47 | Form input labels above input (not placeholder-only) | P1 |
| 48 | Form error messages positioned consistently | P1 |
| 49 | Mobile touch targets ≥ 44×44 enforced | P1 |
| 50 | Hero typography responsive scale refined — feels too large on tablet | P3 |
| 51 | Theme tokens usage audit — no arbitrary hex/rgb | P2 |
| 52 | Color-contrast automated check in CI | P2 |
| 53 | Print stylesheet for letters / summaries | P3 |
| 54 | `prefers-reduced-motion` respected app-wide | P2 |
| 55 | High-contrast mode tested | P3 |
| 56 | Subtle grain / desert-gradient background used deliberately (not on every page) | P2 |

## Zone 3 — Copy, voice, and i18n

*Copywriter, content designer, localization lead.*

| # | Item | Priority |
|---|---|---|
| 57 | Style guide: voice + tone doc with examples | P2 |
| 58 | Pronoun consistency — pick "you" (second person) and stick | P1 |
| 59 | Error-message pattern: "Couldn't X" not "Failed to X" | P2 |
| 60 | Empty-state voice tested across personas | P2 |
| 61 | Button label normalization: Save / Save changes / Update / Commit — pick one per context | P2 |
| 62 | Date formatting: pick a format per surface (relative for recency, absolute for records) | P2 |
| 63 | Money formatting: a utility that normalizes $1,234 / $1.2K / $1.2M | P2 |
| 64 | Success toasts: concise + specific, not celebratory | P2 |
| 65 | Loading messages: avoid "Loading..." — say what's happening | P3 |
| 66 | Placeholder text: consistent tone | P2 |
| 67 | Tooltip library: hints on ambiguous UI elements | P2 |
| 68 | Link affordances: `→` arrow on "Learn more" links uniformly | P3 |
| 69 | Plurals: `pluralize()` helper used everywhere (fixed on Todo page, audit rest) | P2 |
| 70 | Relative time: `2h ago` format everywhere (date-fns `formatDistanceToNow`) | P2 |
| 71 | Large numbers: `1.2K` for counts, full amount for money | P3 |
| 72 | Confirmation dialogs: describe consequence, not "Are you sure?" | P2 |
| 73 | Toast position: top-right consistent (we moved notif bell there, align toasts) | P2 |
| 74 | Agent voice: each agent distinct — Sophie warm, Atlas terse, Ledger precise | P2 |
| 75 | Units: "acres" default, option for hectares later | P3 |
| 76 | Currency: USD default, architecture for non-USD customers | P3 |
| 77 | Address formatting: US-normalized (one-line vs multiline) | P3 |
| 78 | No jargon leak (like original changelog issue) — add to QA checklist | P2 |
| 79 | Scripted onboarding copy reviewed and tightened | P1 |
| 80 | Help center article quality pass — depth varies wildly | P2 |

## Zone 4 — Interactions and micro-UX

*Interaction designer, animator, haptics engineer, keyboard power-user.*

| # | Item | Priority |
|---|---|---|
| 81 | Form validation inline (debounced) instead of on-submit | P1 |
| 82 | Input masking: phone, SSN, dates formatted as typed | P2 |
| 83 | Address autocomplete via Google Places or similar | P1 |
| 84 | Tab order audited on every form | P1 |
| 85 | Copy-to-clipboard affordance on IDs, tokens, codes (with ✓ feedback) | P2 |
| 86 | Drag-drop reorderable lists (campaigns, sequences, pinned items) | P2 |
| 87 | Bulk selection on list views with toolbar actions | P2 |
| 88 | Undo for destructive actions (archive/delete) | P1 |
| 89 | Autosave on long forms with "saved" indicator | P2 |
| 90 | Unsaved-changes warning on navigation | P1 |
| 91 | Optimistic UI updates (mutations feel instant) | P2 |
| 92 | Automatic retry on transient network failures | P2 |
| 93 | Offline state banner + queued writes | P3 |
| 94 | Slow-network indicator (>3s) with explanation | P3 |
| 95 | Prefetch on hover for predictable next clicks | P2 |
| 96 | Animated counter for KPIs on dashboards | P3 |
| 97 | Chart interactivity: hover values, zoom, date-range selection | P2 |
| 98 | Sortable tables remember sort per user | P2 |
| 99 | Filter state in URL (shareable, back-button restores) | P2 |
| 100 | Column customization in tables (show/hide, reorder) | P3 |
| 101 | Export (CSV/PDF) on every list view | P2 |
| 102 | Swipe gestures on mobile lists (swipe-to-archive) | P2 |
| 103 | Pull-to-refresh on mobile | P2 |
| 104 | Long-press context menus on mobile | P3 |
| 105 | Haptic feedback on mobile (buttons, confirms) | P3 |
| 106 | Keyboard shortcuts for power users: `a` archive, `s` star, `j/k` navigate | P2 |
| 107 | Quick-reply templates in communication flows | P2 |
| 108 | Inline editing for simple fields (click value → edit) | P2 |
| 109 | Modal focus trap + return-to-trigger on close | P1 |
| 110 | Modal stacking with proper z-index | P2 |
| 111 | Toast stacking (multiple simultaneous toasts) | P3 |
| 112 | Progress for long operations (uploads, exports) | P2 |
| 113 | Cancel for long operations | P2 |
| 114 | Background-job status visible in header | P2 |
| 115 | Drag-to-resize split panes (map + list) | P3 |
| 116 | Dark-mode toggle reachable from any page | P1 |
| 117 | Font-size zoom respects system preference | P2 |
| 118 | Screen-reader announcements for live updates | P1 |
| 119 | ARIA landmarks on every page | P1 |
| 120 | Kbd shortcuts printed in help sheet dynamically | P2 |

## Zone 5 — Authentication and account

*Security engineer, identity architect, customer success.*

| # | Item | Priority |
|---|---|---|
| 121 | SSO: add Microsoft + Apple alongside Google | P2 |
| 122 | Magic link flow polish | P2 |
| 123 | 2FA setup wizard (we have TOTP, UX could be clearer) | P2 |
| 124 | Password strength meter with specific guidance | P2 |
| 125 | Forgot-password flow tested end-to-end | P1 |
| 126 | Email verification copy + CTA | P2 |
| 127 | Account switcher for multi-org users | P2 |
| 128 | Session timeout: graceful re-auth without context loss | P1 |
| 129 | Profile photo upload + crop | P3 |
| 130 | Timezone auto-detected with override | P2 |
| 131 | Notification preferences matrix (channel × event type) | P2 |
| 132 | Data export (GDPR) self-serve | P2 |
| 133 | Account deletion flow with confirmation + grace period | P2 |
| 134 | Invite team members UX polished | P2 |
| 135 | Role permissions matrix visible + editable | P2 |
| 136 | Impersonation mode for support (logged, banner visible) | P3 |
| 137 | Login history visible to user | P2 |
| 138 | Connected devices management | P3 |
| 139 | API key management with rotation reminders | P2 |
| 140 | Webhook configuration UX + test event | P2 |
| 141 | Billing portal integration polished | P2 |
| 142 | Trial countdown visible in header | P1 |
| 143 | Payment failure grace period surfaced in UI | P2 |
| 144 | Referral code share surfaces (we have $20 credit, make it prominent) | P2 |
| 145 | White-label settings (logo, colors, domain) self-serve | P3 |

## Zone 6 — Core features / functional depth

*Product manager, Land Investor power user, operations specialist.*

| # | Item | Priority |
|---|---|---|
| 146 | Lead dedupe across sources (by phone + address hash) | P1 |
| 147 | Property photo galleries with lightbox | P2 |
| 148 | Aerial imagery on property detail — use existing photos + integrate Mapbox/Google | P1 |
| 149 | Parcel boundary overlays on map | P2 |
| 150 | Flood zone + zoning overlays | P2 |
| 151 | Comps search with ML ranking (Land Credit score is a start) | P2 |
| 152 | ARV calculator wizard polished | P2 |
| 153 | Offer-letter template library with variables | P1 |
| 154 | DocuSign (or equivalent) e-sign integration | P1 |
| 155 | Title company connector (OrderTitle API) | P2 |
| 156 | Recording (deed + agreements) tracking | P2 |
| 157 | Escrow tracking UI | P2 |
| 158 | Closing checklist with task automation | P1 |
| 159 | Post-close task automation (record deed, notify seller, etc.) | P1 |
| 160 | Tax planning integration (export to Drake/TurboTax) | P3 |
| 161 | 1031 exchange tracking workflow | P2 |
| 162 | Seller-finance note servicing screen polish | P2 |
| 163 | Auto-reminder for note payments (email + SMS) | P1 |
| 164 | Borrower portal polish (already clean — verified visually) | ✓ |
| 165 | Partial payment / late-fee UI | P2 |
| 166 | Collections workflow + escalation ladder | P2 |
| 167 | Deed-in-lieu flow | P3 |
| 168 | Foreclosure tracking (compliant, respectful) | P3 |
| 169 | Insurance integration for note-secured properties | P3 |
| 170 | Cap-rate calculator | P2 |
| 171 | ROI forecasting per deal | P2 |
| 172 | Scenario planning / what-if (cash flip vs note) | P2 |
| 173 | Portfolio stress tests (interest-rate, default scenarios) | P3 |
| 174 | Market trend alerts (per county, per price band) | P2 |
| 175 | County assessor data freshness indicators | P2 |
| 176 | Provider intelligence UI (already built) — add per-provider override controls | P2 |
| 177 | Campaign A/B at template level (we have experiment framework) | P2 |
| 178 | Email deliverability health per domain | P2 |
| 179 | Domain warm-up workflow (gradual send ramp) | P2 |
| 180 | SMS compliance (TCPA) reminder banner | P1 |
| 181 | Direct-mail cost tracking per piece + per campaign | P2 |
| 182 | Campaign calendar view | P2 |
| 183 | Content calendar (when to mail / email / SMS) | P2 |
| 184 | Sequence builder with visual drag-drop | P2 |
| 185 | Lead scoring model transparency (show why a lead scored X) | P2 |
| 186 | Conversion funnel visualization (leads → contacts → offers → closed) | P1 |
| 187 | Attribution report (which channel produced this deal) | P2 |
| 188 | Cohort analysis UI | P2 |
| 189 | Retention curves by signup cohort | P2 |
| 190 | Revenue forecasting (next 30/60/90) | P2 |
| 191 | LTV/CAC dashboard | P2 |
| 192 | Unit economics per deal | P2 |
| 193 | Agent/VA assignment + management | P2 |
| 194 | Task delegation workflow with @mentions | P2 |
| 195 | Time tracking on tasks (if billable) | P3 |
| 196 | Commission tracking for multi-person teams | P2 |
| 197 | Equity split tracking for partnership deals | P3 |
| 198 | Investor reporting (for founders raising capital) | P3 |
| 199 | Document OCR for tax bills, surveys | P1 |
| 200 | NLP on seller phone/SMS transcripts — extract intent | P2 |
| 201 | Voice-to-text for field notes | P3 |
| 202 | GPS-stamped property visit logs | P3 |
| 203 | Photo-based lead capture (drive-by snap) | P3 |
| 204 | Offline mode on mobile for field work | P3 |
| 205 | Bulk offer generation from a saved parcel list | P1 |
| 206 | Template variable library (merge fields catalog) | P2 |
| 207 | Merge-field preview before send | P2 |
| 208 | Opt-out management unified across channels | P1 |
| 209 | Contact consolidation across phones, emails, names | P1 |
| 210 | Relationship graph (who knows whom in your contacts) | P3 |

## Zone 7 — AI / agent layer

*AI researcher, autonomous-systems architect, safety engineer.*

| # | Item | Priority |
|---|---|---|
| 211 | Agent personalities: refine voice so Sophie/Atlas/Forge are distinct in blind text tests | P1 |
| 212 | Agent UI: illustrated avatars beyond lucide codename tags | P2 |
| 213 | Agent handoffs between domains — visible, tracked | P2 |
| 214 | Agent disagreement surfacing (contradictory_recs scenario already surfaces this) | P2 |
| 215 | Agent learning from founder corrections — already wired, expand to capture sentiment | P2 |
| 216 | Agent memory inspection UI (I built this server-side; expose to founder) | P2 |
| 217 | Agent trust-score visualization with trajectory | P2 |
| 218 | Agent performance leaderboard (fastest-learning, highest-confidence) | P3 |
| 219 | Agent cost tracking per decision (we have calibration, extend to $) | P2 |
| 220 | Agent latency per decision | P2 |
| 221 | Agent action-replay audit — see the prompt + output for any decision | P1 |
| 222 | Agent-to-agent channels UI (agentMessages table, build viewer) | P2 |
| 223 | Agent subscription management — which channels each agent reads | P3 |
| 224 | Agent priority queue visualization | P3 |
| 225 | Agent proactive notifications (agent pushes to founder inbox) | P2 |
| 226 | Agent muting (quiet an agent during a known-bad period) | P3 |
| 227 | Agent delegation hierarchy | P3 |
| 228 | Agent authority tiers visualization | P2 |
| 229 | Agent budget dashboard (spend vs envelope per agent) | P2 |
| 230 | Agent cost-per-outcome analysis (did Opus calls produce $ ROI?) | P2 |
| 231 | Agent override acceptance rate trend line | P2 |
| 232 | Agent calibration per decision category (not just global) | P2 |
| 233 | Prompt version history (agentPromptEvolutions — add a diff viewer UI) | P1 |
| 234 | Prompt diff viewer — side-by-side | P2 |
| 235 | Agent skill registry — what each agent can do | P3 |
| 236 | Agent tool-usage stats (which tools, how often) | P3 |
| 237 | Agent reasoning trace viewer (raw LLM output + parsed decision) | P1 |
| 238 | Agent hallucination detection signals | P3 |
| 239 | Agent safety-invariant dashboard (hard caps, guardrails firing) | P2 |
| 240 | Agent outcome-feedback loop visible end-to-end | P2 |
| 241 | Agent explanation on demand ("explain decision #42") | P2 |
| 242 | Agent "why did you do that?" inline on audit rows | P2 |
| 243 | Agent journal / memory notes searchable | P2 |
| 244 | Agent recommendation-to-founder feed (proactive, not just reactive) | P1 |
| 245 | Agent meta-learning insights ("I've noticed the system is better at X than Y") | P3 |
| 246 | Agent tenure / longevity tracking (gamification for founder) | P3 |
| 247 | Agent inter-consistency check (Atlas + Forge opinion on same question) | P3 |
| 248 | Agent proposal synthesis (we have this — expand to cross-domain) | P2 |
| 249 | Agent fine-tuning: ship custom-tuned models per agent when volume justifies | P3 |

## Zone 8 — Performance and technical debt

*Performance engineer, SRE, platform architect.*

| # | Item | Priority |
|---|---|---|
| 250 | Bundle-size analysis + budget | P2 |
| 251 | Route-level code splitting (lazy-loaded already — verify) | ✓ mostly |
| 252 | Image optimization pipeline (WebP, lazy-load, responsive srcset) | P1 |
| 253 | Font subsetting | P2 |
| 254 | CSS purging (Tailwind does this) | ✓ |
| 255 | Service-worker caching strategy review | P2 |
| 256 | Full offline PWA experience | P2 |
| 257 | Install-PWA prompt UX | P3 |
| 258 | Push notifications | P2 |
| 259 | Background sync (offline writes queued) | P2 |
| 260 | IndexedDB cache for offline data | P3 |
| 261 | API response caching (React Query already) | ✓ |
| 262 | Query deduplication (React Query) | ✓ |
| 263 | Stale-while-revalidate strategy per query | P2 |
| 264 | WebSocket reconnection UX feedback | P2 |
| 265 | Long-poll fallback for WS | P3 |
| 266 | Compression audit (gzip + brotli) | ✓ fly.io |
| 267 | HTTP/3 / QUIC | ✓ fly.io |
| 268 | CDN for static assets | ✓ fly.io edge |
| 269 | Edge caching for public pages (landing, pricing) | P2 |
| 270 | Preload critical resources | P2 |
| 271 | Defer non-critical JS | P2 |
| 272 | First Contentful Paint < 1.5s target | P1 |
| 273 | Time-to-Interactive target | P1 |
| 274 | Lighthouse score audit (aim 90+) | P1 |
| 275 | Accessibility score audit (aim 95+) | P1 |
| 276 | SEO score audit (aim 95+) | P1 |
| 277 | Web-vitals monitoring in prod | P2 |
| 278 | Error tracking (Sentry — verify alert channels) | ✓ mostly |
| 279 | Performance budget in CI | P3 |
| 280 | Database-index audit | P2 |
| 281 | N+1 query detection in dev | P2 |
| 282 | API latency p99 tracking | P2 |
| 283 | Slow-query log surfaced | P2 |
| 284 | Connection-pool sizing validated | P2 |
| 285 | Background-job concurrency limits | P2 |
| 286 | Graceful degradation when AI providers down (we have circuit breaker) | ✓ |
| 287 | AI-cost runaway protection (we have hard cap) | ✓ |
| 288 | Worker-job retry strategy with backoff | ✓ |

## Zone 9 — Security and privacy

*Security engineer, privacy engineer, compliance officer.*

| # | Item | Priority |
|---|---|---|
| 289 | Content Security Policy (in place, audit for nonce + strict) | ✓ verified in changelog |
| 290 | HSTS enabled | ✓ |
| 291 | Cookie SameSite + Secure verified | ✓ mostly |
| 292 | XSS input sanitization on all user-generated text | P1 |
| 293 | CSRF token strategy | ✓ Clerk |
| 294 | Rate limiting per-user (we have per-IP) | P1 |
| 295 | IP-based rate limiting (have) + user-based | ✓ + P1 |
| 296 | Session-fixation prevention | ✓ Clerk |
| 297 | Account lockout after failed logins (have brute-force) | ✓ |
| 298 | Email verification required for paid actions | P2 |
| 299 | Phone-number verification optional | P3 |
| 300 | Audit log visible to user (I've built one for founder; add customer view) | P2 |
| 301 | Unusual-login alert | P2 |
| 302 | Secure password-reset flow audited | P1 |
| 303 | 2FA backup codes | P2 |
| 304 | OAuth permission scopes visible | P2 |
| 305 | API-key rotation UX + reminders | P2 |
| 306 | Webhook-signature verification | P1 |
| 307 | Field-level encryption transparency (what's encrypted) | P2 |
| 308 | Privacy controls: granular consent per data type | P2 |
| 309 | Data-retention settings per org | P2 |
| 310 | Right to deletion self-serve | P2 |
| 311 | Consent management for marketing communications | P1 |
| 312 | Cookie preferences granular (not just accept-all) | P2 |
| 313 | Third-party service disclosure page | P2 |
| 314 | Subprocessor list kept current | P2 |
| 315 | SOC2 prep / readiness | P3 |
| 316 | GDPR data-map documented | P2 |
| 317 | CCPA opt-out flow | P2 |

## Zone 10 — Growth, marketing, community

*Growth engineer, SEO lead, community manager, developer relations.*

| # | Item | Priority |
|---|---|---|
| 318 | SEO: per-page meta titles + descriptions | P1 |
| 319 | Structured data (JSON-LD) for SaaS app | P2 |
| 320 | Open Graph images (1200x630) — current ones are 192x192 | P1 |
| 321 | Twitter card assets proper | P1 |
| 322 | Sitemap.xml generated | P2 |
| 323 | robots.txt with proper directives | P2 |
| 324 | Blog / content marketing channel | P3 |
| 325 | Case studies on landing (with real customer numbers) | P1 |
| 326 | Trust badges (SOC2, HIPAA if ever, Stripe-verified) | P2 |
| 327 | Live chat (Intercom or similar) for sales | P3 |
| 328 | Demo booking page with calendar | P2 |
| 329 | Webinar signup flow | P3 |
| 330 | Affiliate program UX (referral exists, formalize) | P2 |
| 331 | Partner directory | P3 |
| 332 | Integration marketplace (land-vertical tools) | P3 |
| 333 | Community forum | P3 |
| 334 | Feature voting (what should we build next) | P3 |
| 335 | Public roadmap | P2 |
| 336 | Status page (have — clean) | ✓ |
| 337 | Changelog (have — just cleaned) | ✓ |
| 338 | API docs (OpenAPI spec) | P2 |
| 339 | Developer docs (webhooks, integrations) | P2 |
| 340 | Help center search (sidebar search exists, make global) | P2 |
| 341 | Video tutorials | P3 |
| 342 | Guided tours per feature (Intro.js or similar) | P3 |
| 343 | In-app announcements (version/feature releases) | P2 |
| 344 | Product-updates email cadence | P2 |
| 345 | Referral-program UX promoted at success moments | P2 |

## Zone 11 — Monetization and billing

*Billing engineer, conversion optimizer, CFO-minded product lead.*

| # | Item | Priority |
|---|---|---|
| 346 | Stripe Checkout flow vs custom — benchmark both | P2 |
| 347 | Trial limits exposed in UI with upgrade CTA in context | P1 |
| 348 | Upgrade prompts contextual (hit the limit → specific prompt) | P1 |
| 349 | Downgrade flow polished (not hidden but not punitive) | P2 |
| 350 | Proration explanation at upgrade/downgrade | P2 |
| 351 | Invoice history viewable | P1 |
| 352 | Usage-based billing transparency (for AI tokens if ever) | P2 |
| 353 | Team-seat addition with clear pricing | P2 |
| 354 | Annual vs monthly switcher in settings | P2 |
| 355 | Discount codes entry UX | P2 |
| 356 | Cancel flow with retention offer | P1 |
| 357 | Pause-subscription option (not just cancel) | P2 |
| 358 | Reactivation flow (return customers) | P2 |
| 359 | Dunning email quality — uses Sophie's voice | P2 |
| 360 | Failed-payment grace period with clear communication | P1 |
| 361 | Multiple payment methods (card + ACH) | P2 |
| 362 | Auto-tax calc (Stripe Tax integration) | P2 |
| 363 | Currency localization for non-US customers | P3 |
| 364 | Enterprise contract upload + sign | P3 |
| 365 | Net-30 invoicing for enterprise | P3 |
| 366 | Usage alerts before overage ("you're at 80% of lead limit") | P1 |

## Zone 12 — Industry / vertical deepening

*Land Investor power user, seller-finance specialist, county-records expert.*

These are the "vertical depth" items that make AcreOS specifically
better than a generic CRM for Land Investors:

| # | Item | Priority |
|---|---|---|
| 367 | County-assessor API breadth (more counties covered) | P1 |
| 368 | Parcel data freshness indicators per county | P2 |
| 369 | Tax-delinquent list automation per county | P1 |
| 370 | Heir-search / probate integration | P2 |
| 371 | Legal-description parser (metes and bounds → polygon) | P2 |
| 372 | Title encumbrance detection | P2 |
| 373 | Access / easement analysis | P3 |
| 374 | Mineral rights tracking | P3 |
| 375 | Water rights tracking (Western states) | P3 |
| 376 | Comparable-sales engine weighted for land (not residential) | P1 |
| 377 | Per-acre pricing normalization across parcels | P2 |
| 378 | Zoning-change detection alerts | P2 |
| 379 | Wetlands / environmental-hazard overlays | P2 |
| 380 | Road frontage / access ratings | P2 |
| 381 | Land-type classification (hunting / farming / recreational / timber) | P2 |
| 382 | County-specific recording fee schedules | P2 |
| 383 | Closing-cost calculator per county | P2 |
| 384 | Note-servicing templates per state (interest-rate caps, usury laws) | P1 |
| 385 | Dodd-Frank compliance checks on seller-finance offers | P1 |
| 386 | SAFE Act compliance for seller-finance originators | P2 |
| 387 | Land-use permit research | P3 |
| 388 | Timber cruise data integration | P3 |
| 389 | Solar / wind lease potential analysis | P3 |
| 390 | Carbon-credit eligibility for hold-and-lease | P3 |

---

## Summary stats

- **~390 catalogued items** across 12 zones
- **~40 P1 items** (this-quarter priority)
- **~140 P2 items** (this-year priority)
- **~90 P3 items** (when-there's-time)
- **~15 already done** (marked ✓)

---

## Top 20 — where I'd start

If I had capacity for 20 items next quarter, these are the highest
leverage (pulled from the P1 list, weighted by how often they affect
every customer and how disproportionately they shape perceived
quality):

| Rank | Item | Zone | Why |
|---|---|---|---|
| 1 | Type scale + spacing scale audit | Design | Every surface benefits; current ad-hoc sizes make the app feel "almost-good" |
| 2 | Open Graph images (1200×630, branded) | Growth | First impression on every shared link — currently broken 192×192 |
| 3 | Replace "A" logo with branded wordmark + icon | Design | Logo is on every page, login, email, favicon |
| 4 | Close-flow templates library + DocuSign integration | Features | The "last mile" of a deal; biggest Land Investor workflow |
| 5 | Bulk offer generation from parcel list | Features | Power-user lever; big-deal flow |
| 6 | Lead dedupe across sources | Features | Data quality — users feel this constantly |
| 7 | Contact consolidation (phones, emails, names) | Features | Same as above |
| 8 | Agent action-replay audit | AI | Trust requires traceability |
| 9 | Prompt diff viewer | AI | For prompt-evolution approvals |
| 10 | Agent reasoning trace viewer | AI | "Why did the system do X?" answered inline |
| 11 | Conversion funnel visualization | Features | Every founder wants to see this |
| 12 | Trial countdown in header | Billing | Drives upgrade urgency |
| 13 | Contextual upgrade prompts | Billing | Hits right when user feels the limit |
| 14 | Usage alerts before overage | Billing | Saves surprise + drives upgrade |
| 15 | SMS / TCPA compliance banner | Features | Legal protection |
| 16 | Unsaved-changes warning on nav | Interactions | Every app has this; we don't |
| 17 | Undo for destructive actions | Interactions | Confidence-building for bulk work |
| 18 | Keyboard-focus ring visible app-wide | Design | A11y + power-user feel |
| 19 | Dark-mode audit pass | Design | Dark users exist; current coverage is partial |
| 20 | Aerial imagery on landing hero | Design | 13 beautiful unused photos; landing is first impression |

---

## Closing thought

This catalog reflects a platform at an inflection point. The
foundation (vertical depth, autonomous architecture, safety rails)
is stronger than most land-investing tools and, arguably, most
vertical-SaaS platforms generally. The work now is refinement —
taking what exists from "best-in-class architecture" to
"best-in-class experience."

The 300+ items here aren't a to-do list; they're a map. The right
question isn't "which 300 do we ship" but "which 20 compound hardest
for our customer's next year."
