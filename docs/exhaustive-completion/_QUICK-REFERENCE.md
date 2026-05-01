# AcreOS — Quick Reference (Founder Single-Page Summary)

**Date:** 2026-05-01
**Synthesis of:** 86 audits across two waves (12 strategic personas + 74 deep specialists).
**See also:** `_MASTER-FINDINGS.md` (the full deduped inventory) · `_ACTION-PLAN.md` (the sequenced sprints).

---

## The verdict (3 sentences)

AcreOS is a **brilliant solo cockpit** with genuinely strong bones — a real founder voice, three named agents (Atlas/Pax/Sophie), an ambitious agent layer, the right Clerk/Stripe/native-esign architectural picks, a token-disciplined design system, and a 50-state legal-config scaffold no other LandTech tool ships. **What's broken is the gap between bones and propagation**: the founder voice dies at the auth wall, six conflicting tier-price tables make every revenue number fiction, the persona architecture (Pax for customers, Atlas/Sophie/Forge for the founder) leaks in 8+ surfaces, four explicit security/legal P0 bugs ship today, and ~95% of the customer surface still mounts the old patterns instead of the disciplined primitives sitting one import away. **The highest-leverage 30-day move is to make one canonical pricing table, fix the four launch-blocking bugs (founder-check leak, doc immutability, signed-doc tampering, 2FA-unwired), wire `Idempotency-Key` end-to-end so a Stripe outage stops double-charging, and propagate the `Couldn't [verb]; your [noun] is unchanged` apology pattern to every error site** — all together, two focused weeks of work.

---

## The 5 things to fix this week (P0, must-ship-before-customers)

| # | Fix | Effort | Source |
|---|---|---|---|
| 1 | **Single source of pricing truth** — collapse 6 conflicting `TIER_PRICES` tables (server/storage.ts:3452, routes-admin.ts:3293, routes.ts:1443, agents/revenue.ts:14, expansionRadar.ts:55, autonomousSalesPipeline.ts:309) into `shared/billing/tier-pricing.ts`; CI test that Stripe agrees nightly. | 1d | Marisol §1, Tegan §2, Ashok §2, Harlowe §2 |
| 2 | **Fix R1 + R2 + R4 security P0s** — replace inline founder check at `routes-admin.ts:465,485` with `isFounderAdmin`; reject `content` updates on `signed` documents at `routes-doc-system.ts:725` + add `documentContentHash` to `signatures`; rip `routes-2fa.ts` and use Clerk MFA. | 2d | Sam §1, Pelle §2.7, Marguerite §2 |
| 3 | **Wire client-side `Idempotency-Key`** — default `mutations.retry: false` in `client/src/lib/queryClient.ts:329`; generate UUID per mutation in `apiRequest`; sites: stripe checkout, credits purchase, e-sign send, campaign send, public sign. Without this a single 502 = double-charge. | 1.5d | Ines §1, Hessam §2.1 |
| 4 | **Encrypt skip-trace results + make `FIELD_ENCRYPTION_KEY` required in prod** — `skip_traces.results` jsonb is plaintext owner phones/relatives/employer; add to `SKIP_TRACE_SENSITIVE_FIELDS` and backfill. Flip `secretsValidation.ts:33` `required: true`. | 1.5d | Sam §1 R3, Aravind §2 |
| 5 | **Kill founder-codename leaks on customer surfaces** — `empty-states.tsx:128` "Atlas AI", `today.tsx:688` "Sovereign dashboard →" link, `today.tsx:1212` "AI action queue", `coverage-page.tsx:236` "Sophie/Atlas" in maintenance. Add ESLint rule banning `Atlas\|Sophie\|Forge\|Sovereign` in non-`/founder/*` JSX. | 0.5d + lint | Vesna §3 P0-1/P0-2, Asher §3, Mira §4.7, Hiroko §2.4, Joaquín §3a |

---

## The 5 things to fix this month (P1, ship in next 30 days)

| # | Fix | Effort | Source |
|---|---|---|---|
| 1 | **Resolve the pricing-page split** — landing sells $199–$1,290 operator-class; `/pricing` sells $20–$79 prosumer. Pick one (Tegan + Asher both recommend Operator-class). 25× discrepancy is the single biggest narrative incoherence. | 1w (decision + comms) | Asher §4, Tegan §2-3, Ana §1, Wendell §1 |
| 2 | **Microcopy + apology pattern propagation** — `Couldn't [verb]. [Reassurance] — try again.` Strip 11 `Please`s in inbox.tsx, 4 `successfully` adverbs, 3 `!` exclamations, 8 Title-Case dialog titles, 7 generic `error.message`-only toasts. Move `error-utils.ts` to status-code classification (substring matching is brittle). Codify in `docs/voice.md`. | 4d | Asher §3+§10, Vesna §3+§4, Mira §3-§6, Hiroko §3-§9, Tomás §4-§5 |
| 3 | **IA collapse — kill duplicate routes; cut `/settings` from 17 tabs → 7** — redirect `/pipeline → /deals`, `/money → /finance`, `/dashboard → /`, `/command-center → /`, `/founder-dashboard → /founder`. Settings: account / workspace / team / billing / notifications / integrations / data. | 1w (with redirects) | Holm §3-§6, Karri §1-§7, Joaquín §5 |
| 4 | **Eval harness v0 + migrate top 10 direct-OpenAI bypass sites to `routeAITask`** — 50-prompt golden set on Pax inbox-draft, Sonnet-as-judge, banned-phrase regex hard-fail, persona-leak hard-fail. ~101 services bypass router today; cost + observability invisible. Pin `gpt-4-turbo-preview` (deprecated) callsites. | 2w | Theo §2+§4+§8, Yusuf §1, Sayuri §2, Sandeep §2, Mateo §3 |
| 5 | **Per-org AI cost ceiling + Stripe Tax + Sub-processor DPA closure** — daily $/org cap (default $5 trial, $25 paid); flip `automatic_tax: { enabled: true }` on checkout sessions (multi-state nexus exposure today); counter-sign DPAs with the 12 listed sub-processors (currently zero on file — Anouk). | 1w | Sandeep §2, Hana §2, Vikram §2, Marisol §2, Anouk §3 |

---

## The 3 things you should explicitly NOT do

| # | Don't | Why (and who flagged it) |
|---|---|---|
| 1 | **Don't build family-office multi-entity (`entity_groups`) until you have 50 paying single-org customers.** | Theodora explicitly says no fit at any price; 6–9 months of engineering for an audience that won't move the needle. The `parent_organization_id` exists for white-label reseller, fine — leave it. |
| 2 | **Don't reach for a heavy lifecycle ESP (Customer.io / Iterable / Braze) before 1,000 customers.** Markdown templates + your own `emailService` + a real provider for transport (SendGrid or Postmark) is enough. Sigrid §3 + Camila both: ship a 14-message program before paying for Mailchimp-tier infra. | Sigrid §3, Camila §4. The lifecycle gap is content + transport, not platform. |
| 3 | **Don't ship the next vertical (Note Investor / Wholesaler / Subdivider) until the Land Investor wedge is at $10M ARR.** Linnea + Trey + Brigid all said "renaming a column isn't a data model" — note-investor schema, wholesaler-license guardrails, and subdivider polygon-draw are each a 1–3-quarter build. Win Land first, then Note Investor (Sophie is already half-trained for that). Wholesale = 36-month decision, not 24. | Linnea §1, Trey §1, Brigid §2, Ashok §2.3, Wendell §6, Ana §6, Asher closing |

---

## The 3 strategic decisions awaiting founder input

These are *not* engineering questions. They block prioritization and only the founder can answer.

| # | Decision | Why it blocks | Recommendation in audit |
|---|---|---|---|
| 1 | **Operator-class ($249–$1,290) or prosumer ($20–$79) — pick one in 14 days.** | Every other revenue number, every COGS calc, every NRR target, every CAC payback math depends on this. Today MRR on `/founder-home` is wrong by 45–250% on Pro/Scale because six tier tables disagree. | **Operator-class.** A 200-deal Land Investor's WTP for honest software with three named agents is not $79 (Tegan §2, Ana §1, Wendell §1, Asher §4). |
| 2 | **Vertical expansion order — Note Investor next, then which?** | Roadmap claims "AcreOS for Land / Notes / Wholesale / Tax" as the multi-vertical thesis (Series-A required); each is a separate data model and 1–3 quarters of build. | **Land → Note Investor (Sophie already mid-trained, $300M TAM) → Tax-Delinquent (smaller TAM but Marcus says the persona-vocab already nails it once data is real) → Wholesale (delicate license law, defer 36mo).** Theodora (family-office) and Otto (capital markets) are cul-de-sacs at this stage. (Linnea, Trey, Brigid, Marcus, Otto, Theodora, Ana, Ashok all align on the same ranking.) |
| 3 | **Team-size readiness target by Q4 — Solo / Team-of-3 / Team-of-10?** | Round-robin lead assignment, RBAC roles that aren't theatre, manager dashboards, per-seat pricing — all gated on this. | **Team-of-3 in 90 days, Team-of-10 in 180.** Vincent (3-person) and Penelope (10-person) both said the bones are there but the *contracts* aren't. Penelope said yes-conditional with 6 specific items in 90 days. Family-office (Theodora) is no for 12+ months. |

---

## The "if AcreOS only had 30 days of engineering left" priority list

| # | Item | Why it's top-10 |
|---|---|---|
| 1 | Single source of pricing truth (`shared/billing/tier-pricing.ts` + Stripe nightly recon) | Without this every other number is fiction. Marisol's #1, Tegan's #1, every Series-A diligence question. |
| 2 | Fix R1, R2, R4 (founder-leak, doc-mutability, 2FA-unwired) | One real-estate-deed lawsuit and the company is gone. Sam §1, Marguerite §2, Phineas §2.1. |
| 3 | Wire client `Idempotency-Key` (Stripe + e-sign + campaign + signing) | Single 502 = double-charge today. Ines §1, Hessam §2.1. |
| 4 | Encrypt skip-trace results jsonb + make `FIELD_ENCRYPTION_KEY` required in prod | Sam R3 — owner phones/relatives plaintext at rest. One DB-replica leak = front-page story (Phineas #5). |
| 5 | Kill persona leaks (Atlas/Sophie/Forge/Sovereign on customer surfaces) + add ESLint guard | Brand belief = "no black boxes, three named coworkers." Today the customer sees four codenames and "AI action queue." Asher §3, Vesna P0-1/P0-2, Mira §4.7. |
| 6 | Replace `mutations.retry: true` default + `error-utils.ts` substring classifier | Brittle today; the day server messages change, the client signs everyone out on a `Validation failed: 401-555-0100` lead phone. Hiroko §4.5. |
| 7 | Migrate top-10 direct-OpenAI bypass services to `routeAITask` + per-org AI cost cap | At 100 customers AI bill is $18-24K/mo today; 60% recoverable. One runaway customer = $400/day silently. Sandeep §2-§4, Theo §1. |
| 8 | Stripe Tax (`automatic_tax: { enabled: true }`) + `tax_id_collection` | Multi-state nexus exposure today; every invoice is an accruing liability. Hana §2, Vikram §2. |
| 9 | Cut `/settings` 17→7 tabs + collapse duplicate routes (`/pipeline`, `/money`, `/dashboard`) with redirects | Holm + Karri + Joaquín all the same root cause: customer's mental model has 7 concepts; product has 28 sidebar destinations + 166 routes. |
| 10 | Eval harness v0 (golden sets + Sonnet-judge + CI gate) on Pax inbox-draft + compliance disclosures | Today every prompt change is YOLO. Compliance-disclosure runs `gpt-4-turbo-preview` (deprecated) with zero post-validator on legally-binding text. Theo §2, Sayuri §2, Yusuf §1, Nadia-AI §2. |

---

## What the team got RIGHT (5 things to protect)

These showed up across multiple audits as genuinely strong. Future change must not break them.

1. **The founder voice at `landing/copy.ts`, `pages/why.tsx`, and finance.tsx toast block.** Specific, falsifiable, founder's email on the homepage. *"For years, my operation ran on a spreadsheet, a dozen browser tabs..."* Asher 5/5, Eden 5/5. **Protect; propagate, never sand.**
2. **Persona architecture (Pax for customers; Atlas/Sophie/Forge/etc. for founder).** Real product decision; "no black boxes, three named coworkers, the operator decides" is the brand belief. Asher §1-§2, Ana §1. **Lint it; don't let it leak.**
3. **The HMAC-link public e-sign signing flow (`signingTokens.ts` + `routes-public-sign.ts`).** Per-signer HMAC, timing-safe compare, 410 Gone after expiry. *"Better than DocuSign"* per Hiroko §3.2 + Wendell §6. **Protect, then close R5 (token IAT) and R2 (immutable post-sign).**
4. **The token-disciplined design system + reduced-motion handling.** 32 `--acr-*` tokens per theme×mode, zero drift across 10 blocks. `MotionConfig reducedMotion="user"` + `[data-motion=reduced]` CSS sweep. Vesna §2, Tessa §2, Devereux §2 ("textbook layered support — better than most enterprise SaaS ships in 2026"). **Adoption is the gap; the system itself is exemplary.**
5. **Reliability + DB foundation: webhook idempotency claim (Stripe atomic via `ON CONFLICT DO NOTHING`), `withJobLock`, `withTransaction`, idempotency middleware infrastructure, field-encryption key rotation script, Sentry consent gate, CSP per-request nonce, Helmet-equivalent, HSTS preload.** Ines, Sam, Aravind, Adriana, Bjorn, Hessam — all said variations of *"better than I expected for this stage."* The bones are real. **The gap is invocation-site coverage, not architecture.**

---

*— Master synthesis · 2026-05-01 · derived from 86 audits in `elite-team-2026-05-01/` (12) + `elite-team-deep-2026-05-01/` (74).*
