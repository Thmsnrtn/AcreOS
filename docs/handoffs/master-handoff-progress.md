# Master Handoff — progress ledger

*Maintained per the handoff's STATE & REPORTING rule. Any future session resumes
from this file, not from memory. Updated every working session.*

**Branch:** `claude/acreos-audit-2026-08-4l2rlu` · **Base at session start:** `016c619`
(Wave 5 merged — all 15 verticals core).

---

## ⚠️ Drift log (repo-at-HEAD vs. the handoff, which was written 2026-08-08/09)

| # | Drift | Consequence |
|---|---|---|
| D-1 | **RESOLVED 2026-08-09.** The master handoff document was absent from the repo at session start (not tracked or untracked anywhere). The founder supplied it in-session; it is now committed in full (§A–§G including all six reference parts; reference body renumbered to §H when Addendum C landed, see D-5) at `docs/handoffs/acreos-master-handoff.md`. | Wave 0 items 0.1–0.9, Waves 1–6, G/O/F/X are now enumerable. Program unblocked. |
| D-2 | **Item 0.2's headline premise is stale — the F-18-1 fix already shipped** in the remediation continuation batch (2026-08-06, `REMEDIATION.md` item 3): `server/services/vendorCredentialExpiry.ts` (registry seeded ATTOM `2026-08-28`), milestone paging in `sendDailyBriefing` (warn T-14/T-7, critical page ≤T-2 via `alertSpine`), and the `vendor_credentials` step-away readiness check. All verified wired at HEAD (scheduler → `runScheduledJobs.ts:1146`). | 0.2 re-scoped from "build it" to "verify at HEAD + close the enforcement gap" (below). |
| D-3 | The audit's F-18-1 **"Gate it"** (sole-source ⇒ expiry-row invariant) was NOT part of the shipped fix — no `vendor-expiry` ratchet existed and the unit test didn't derive from the sole-source allowlist. | Closed this session (see 0.2). Built as a **derived set-invariant test**, not a count ratchet — per `99-master.md:228`'s over-build dissent and the repo's derived-test preference. |
| D-4 | **FOUNDER RULING (2026-08-10, direct in-session):** the completed vertical-maturity program — all 15 verticals brought to honest core (PRs #275/#276, merged pre-Wave-0) — **SUPERSEDES every handoff recommendation premised on verticals being beta / frozen / conveyor-gated / roadmap-gated**. The founder read the handoff and identified this as its one outdated aspect. Consistent with founder ruling #11 (2026-07-29, deletion ledger) rescinding the one-at-a-time conveyor. | Any later-wave brief (Waves 1–6/G/O/F, addenda) whose premise is a vertical's beta/frozen status must be re-scoped at execution: verticals are CORE. Do not relitigate activation gates the completed program already passed — including the residential-comps data-plane hard-stop, which the founder lifted in-session during that program ("Lift hard-stop + MLS vendor"). |
| D-8 | **PREMISE DRIFT found while verifying Addenda D/E at HEAD (2026-08-11).** Five items, all logged rather than forced: **(a)** the addenda's source documents — `acreos-legal-review.md`, `acreos-customer-responsibility-audit.md`, `acreos-depth-audit-part3.md` — are **not in the repo**; Addendum D says "read that review before executing," and it cannot be read. **(b)** R.1.3's grep-ratchet allowlist (`addressValidation`, `healthCheck`, `credentialLivenessDetector`, setup routes) is **incomplete at HEAD**: eleven more files reference `LOB_*` keys — `routes-campaigns.ts` (5 refs), `services/mail/providers/lob.ts`, `connections/platformConnections.ts`, `communications.ts`, `routes-founder-integrations.ts`, `configManager.ts`, `byok/toggle.ts`, `routes-founder-intelligence.ts`, `ai/supportAgent.ts`, plus two scripts. **(c)** L.4.5 "beta badging … for beta verticals" **collides with D-4**: all 15 verticals are CORE, not beta. **(d)** L.4.1's disclaimer-coverage ratchet **already exists and is partly executed** (`scripts/lint-disclaimer-coverage.mjs`, baseline **13**, tightened this session to require rendered `<RequiredDisclaimer` JSX rather than a substring). **(e)** R.2's `attestations` table does not exist; only `fcra_attestations` does. | **(a)** Wave L executes from the addendum text alone; if a decision needs the underlying reasoning, ask the founder for the review doc rather than inventing it. **(b)** R.1's consolidation map (R.1.2) must cover all fourteen call sites, not the three in R.0's table — the ratchet's allowlist gets written *after* the map, from truth. **(c)** L.4.5 re-scoped to **product-level** beta badging (the pre-GA product, per L.3's Beta/Early Access Addendum), not per-vertical. **(d)** L.4.1's remaining work is the output-class→type map + driving 13 → 0, not building the lint. **(e)** R.2 is net-new; name it so it does not collide with `fcra_attestations`, and decide whether that table folds into the primitive. |
| D-7 | **CORRECTION OF RECORD (founder-supplied, independently re-verified at HEAD 2026-08-11): Part 3 §2.4 is WRONG and is superseded by §J (Addendum E) R.0.** §2.4 claimed `lobService.ts` resolves a platform key with "no BYO/org-credential path wired." **Verified false:** `server/services/mailProvider.ts:82` implements `getOrgMailCredentials(organizationId)` reading an org-scoped `isEnabled` Lob integration from `organization_integrations`; `getDefaultCredentials()` (line 106) is fallback-only and wrapped in the live-send interlock (`mail/liveSendInterlock.ts`, imported line 6) so the platform key resolves to test mode unless production is explicitly armed. **The real defect is a different class — service sprawl:** three parallel mail paths, only `mailProvider` doing BYO resolution; `lobService.ts:104-106` reads `LOB_TEST/LIVE/API_KEY` from `process.env` in its constructor with **no organization parameter anywhere in the class**, and `directMail.ts:92` reads `process.env.LOB_API_KEY` directly. Both are reachable from `services/communications.ts`. | **Do NOT execute the Part 3 §2.4 remediation.** §2.4 now carries an inline supersession banner in the handoff; §A gained a pointer; §D item **0.8 is re-scoped** from "build a BYO path" to "consolidate the three paths onto the existing one" (R.1). 0.8 remains **founder-queued** (send lane, §A rule 5) — the re-scope makes it *smaller and safer*, not approved. All other §2.4 sub-items (purpose lanes, wedge caps, prohibited-content lint, refuse-don't-fall-back ratchet) stay valid and attach to the consolidated path. |
| D-6 | **ADDENDA D & E INGESTED (2026-08-11, founder-supplied in-session):** Addendum D = **Wave L** (legal documents & disclosure surface — ToS truth-alignment, three new ToS sections, a Beta/Early Access Addendum, the disclosure-surface sweep, drift prevention, the counsel packet) and Addendum E = **Wave R** (responsibility hardening — mail-path consolidation, the Attestation Gate primitive, six gate applications, the platform-voice rule, statute-bearing surfaces + per-user attribution). Appended **after** the reference body as **§I** and **§J** exactly as the packet specified — no renumbering, so every existing `§H`/Part cross-reference stays valid. Bodies are verbatim; the single deviation is heading level (each addendum's `#` title became the `## §I.`/`## §J.` section marker, matching how Addendum C became §G). §D gained **WAVE L** and **WAVE R** registrations after the WAVE X line. **Wave S was NOT duplicated** — the packet's third registration is a shorter restatement of the WAVE S block already written at D-5; it was reconciled into that block with a pointer, since the existing one carries the full item list *and* the exit test. | Waves L and R join the executable pool. **§A rule 5 applies hard here:** R.1 is a **send lane** (founder queue — it re-scopes 0.8, it does not approve it); R.3.5's `dunning_sequences.autoStart` flip is debt-collection-adjacent and touches an outbound cadence; Wave L drafts customer-facing legal text — draft in-repo freely, but **publication requires founder sign-off**, and L.0.1's counsel-required footer stays until it is untrue. R.4 carries an explicit founder ruling (keep the confident voice; add basis line + mounted disclaimer + editable field) — do not neutralize it into calculator language. |
| D-5 | **ADDENDUM C INGESTED (2026-08-10, founder-supplied in-session):** the Staff & Autopilot Doctrine — shaping the founder-backend autopilot (`operator`/`decide`/`council`/`senses`/`domainAutonomy`/`hands`) into six chartered staff domains (the five Trust-Ledger domains + Beatrice/compliance), with autonomy-follows-perception promotion gating, mandate-proportional hands, an executable scenario library, conflict→negotiation memos, the cabinetmaker CEO interface, and the maturation-curve ledgers. Married into the handoff as **WAVE S** in §D (parallel after Wave 0, overlaps Wave F; full brief now at §G; the reference body was renumbered §G→§H). | Wave S items S1–S7 join the executable pool immediately (S1/S2 first — charters + promotion-prerequisite ratchet are pure construction). Standing rules apply unchanged: S3's deploy/rollback + any send-adjacent hands, autonomy-ladder promotion mechanics, and anything touching hard-stop domains remain §A-rule-5 propose-don't-merge (self-patch-never-merges is already constitutional). S5 rides slice 5's reasons-on-disposition rail. Naming note: `docs/design/*` uses "Wave S" for the separate design-elevation "signature moments" wave — §D's Wave S is the staff doctrine; disambiguate by document family. |

---

## Wave 0 — trust prerequisites

### 0.2 — ATTOM trial-key expiry registry + countdown paging + step-away check (F-18-1) — ✅ VERIFIED + GAP CLOSED

- **Status:** DONE at HEAD. Registry/paging/readiness pre-existed (D-2); this
  session verified each against code and closed the D-3 enforcement gap.
- **Verified at HEAD (against code, not reports):**
  - Registry: `vendorCredentialExpiry.ts` — ATTOM / `ATTOM_API_KEY` /
    `expiresOn: 2026-08-28` / sole-source-for residential comps; thresholds `[14,7,2,0]`.
  - Countdown paging: `founderBriefing.ts:193-202` inside `sendDailyBriefing()` —
    warning at T-14/T-7, **critical page ≤T-2 or expired** via `alertSpine.raiseAlert`;
    `sendDailyBriefing` is scheduled (`server/jobs/runScheduledJobs.ts:1146`) and
    manually triggerable (`routes-admin.ts:3906`).
  - Step-away check: `autopilot/stepAwayReadiness.ts:298-312` — `vendor_credentials`
    check; expired sole-source key ⇒ `action_needed` (verdict can't read "armed").
  - Timeline: today 2026-08-09 ⇒ T-19. First warn milestone fires **2026-08-14** (T-14).
- **Exit test (falsifiable, ratchet-style):** `tests/unit/vendorCredentialExpiry.test.ts`
  — extended from 5 → **9 tests, all passing**: (a) every member of
  `RESIDENTIAL_CAPABLE_PROVIDERS` (derived from source, not hardcoded) must have a
  registry row with a parseable date — removing the ATTOM row or adding a
  sole-source provider without one FAILS; (b) wiring pins — the paging block stays
  in `sendDailyBriefing`, `sendDailyBriefing` stays scheduled, the readiness check
  stays present with expired ⇒ `action_needed`.
- **Deliberately NOT built:** the audit's optional weekly live ATTOM probe
  (`vendor-health-probe` live-check). F-18-1 marks it optional and `99-master.md:228`
  flags the fix as already over-built for one vendor; the countdown + paging covers
  the known dated lapse. Revisit at ≥3 sole-source vendors.
- **Completeness audit:** wiring verified by call-site greps at every seam
  (registry→briefing→scheduler; registry→readiness) + the new wiring-pin tests
  make the verification permanent. Full `npm run check` + full `npm test` run on
  the commit (results in the session report).
- **Approval queue:** nothing — no gate/ratchet baseline changed, no hard-stop
  domain touched (a new derived test adds enforcement; it moves no baseline).

### 0.1 — The Ten (REMEDIATION briefs): confirm state, finish stragglers — ✅ CONFIRMED at HEAD
- **State:** `REMEDIATION.md` records all 6 P0s + 9 P1 groups fixed, the 9-item
  continuation batch shipped (incl. F-18-1), and an independent 6-dimension
  completeness pass that found + fixed 7 further defects (incl. 2 P1s introduced
  by the remediation itself). This session re-verified against code, not the
  report: full `npm run check` (tsc + all 21 lint gates + all ratchet families)
  exit 0 and full `npm test` 792 files / 10,700 tests / 0 failures at this tree,
  plus a dedicated clean-tree `npm run check` as 0.1's own gate-run evidence.
- **Straggler disposition (all four deliberate deferrals are ROUTED, none open):**
  1. `: any` bulk (~3,020 sites) — deferred by the audit's own design; frozen by
     the down-only `colon-any` ratchet (3,018 at HEAD). Not a straggler.
  2. Orphaned-table drops (`agent_improvement_plans`, `agent_synergy_map`) —
     queued for the FOUNDER table-drop decision (customer-data deletion is a
     hard-stop); schema defs preserved per reachability.json's note. → In the
     approval queue below as a standing founder decision.
  3. F-16-1 router migration Phase 2/3 — deferred pending a keyed environment +
     eval; the cost chokepoint (`aiSpendGuard`) + `openai-bypass` ratchet
     (baseline 89, down-only) shipped. → This IS item 0.3's scope; premise
     verification there decides what is mechanically migratable without keys.
  4. DR restore drill (F-13-2) — operational, founder/ops-run (needs
     `DB_BACKUP_S3_BUCKET`); runbook + staleness surfacing shipped. → Wave O2;
     the drill execution is a founder action.
- **Exit test:** the Ten's gates green at HEAD (evidence above) + zero un-routed
  stragglers. MET.

### 0.3 — Router totality + completions allowlist (Pax/VA/support/Atlas/Solene) — ✅ DONE (scope honest to the F-16 plan's key-gating)
- **Premise verification re-scoped the item:** the allowlist lint already exists
  (`openai-bypass` ratchet, baseline 89 down-only, tamper-pinned now). The F-16
  plan gates Phases 2–3 (the actual migrations) on a KEYED environment + eval —
  "reckless without" per the plan itself — so those are founder-queue, not this
  wave. Executed here:
  1. **F-16 Phase 1 — tool-aware `routeAITask`** (additive, opt-in): AITask gains
     `tools`/`toolChoice` + tool/assistant-with-tool_calls messages; AIResponse
     gains `toolCalls`/`finishReason` only when tools are used; incompatible
     features (json responseFormat, confidence, extended thinking, both cache
     layers, the cascade) explicitly disabled on the tools path with the choices
     documented; ceiling/telemetry/tier paths shared and untouched. Pinned by
     `aiRouterTools.test.ts` (8 tests, mocked client): pass-through, tool_calls
     surfacing, multi-turn round-trip, byte-identical no-tools request
     (regression pin), ceiling-before-client on the tools path, no-cache/
     no-cascade with a non-vacuity leg. Honesty: plumbing is mocked-client
     tested; NOT validated against live models (that is Phase 2's eval).
  2. **Derived cost-coverage invariant** (`aiCostCoverage.test.ts`, 7 tests):
     derives every tool-calling agent surface from source and asserts each
     enforces ceiling+telemetry (routeAITask | aiSpendGuard pair | inline
     ceiling+telemetry). A new unguarded agent surface fails CI. Plus a tamper
     pin on the openai-bypass ratchet (direction/baseline/pattern).
  3. **Finding CLOSED same-session:** `paxSupportResolver.resolveTicketWithPax`
     was a WIRED, customer-triggered tool loop (fires on every ticket creation +
     /pax-resolve) with ZERO cost enforcement, and the comment at its call site
     claimed otherwise. Wired with the sibling aiSpendGuard pattern
     (assertAiSpendAllowed + recordExternalAiSpend on both completion sites);
     false comment corrected; its allowlist entry removed so the invariant
     enforces it.
- **Findings held in the dated, down-only KNOWN_GAPS allowlist (founder queue):**
  Atlas main loop (`routes-founder-chat.ts` — own OpenRouter client, no ceiling/
  telemetry; its TOOLS route via routeAITask), Solene (`solene/chat/turnRunner.ts`
  — consults the ceiling + own caps but never writes aiTelemetryEvents, so the
  ceiling can't see its spend), `decisionsInbox.createFromFeatureRequest`
  (unguarded + likely unwired), `negotiationOrchestrator` (unguarded single-shots
  wired via routes-core-ai; its 6-round agent loop has ZERO call sites —
  built-but-unwired; fate decided at Wave 4.4's transplant/kill).
- **Exit test:** aiRouterTools 8/8 + aiCostCoverage 7/7 + openai-bypass ≤89 +
  full check/test green. MET (full-gate evidence in the commit).

### 0.4 — `resolveActionPolicy` enforcement at the pending-actions chokepoint — ✅ DONE
- **P-1 executed, enforcement-true without switching autonomy ON** (the
  load-bearing property, verified against code): `resolveActionPolicy(...)` →
  `suggest | draft | require_approval | auto_with_receipt | forbid` (+reason),
  consulted inside `approvalKernel.proposePendingAction` (the verified SINGLE
  `insert(pendingActions)` site) in resolve→forbid→stamp→insert order. `forbid`
  throws with the rule surfaced; every other verdict — INCLUDING
  `auto_with_receipt` — still lands frozen awaiting a human: the stamp records
  that the matrix grants autonomy, but no execution lane consumes it (the two
  `trustedApproval` human-tap endpoints are unchanged and pinned by a derived
  test). Any future auto lane must require the stamp AND the Wave 6.5
  standing-instruction consent artifact (seam documented, not built).
- **Resolution precedence:** explicit dailyActionLimit=0 ⇒ forbid · org-effective
  level = MIN across owner+expressing members (level 0 is a hard ceiling —
  per-action overrides cannot raise it) · none stored ⇒ require_approval ·
  $-threshold / money-bearing-with-no-ceiling / pausedUntil / time-guard window
  (org IANA timezone) each downgrade a provisional grant · read failure fails
  CLOSED to require_approval (never auto, never forbid).
- **Stamp:** `pending_actions.policy` jsonb (migration 0227 — one nullable
  column, mirrored; table-count unchanged 756). UI parity: `GET
  /api/me/autonomy/effective` renders verdicts from the SAME function; the three
  stale "wired progressively as Phase E" docstrings corrected.
- **Model gaps recorded honestly (not invented around):** dailyActionLimit>0
  count-capping deferred (stored model defines no counting unit/day boundary —
  only explicit 0 enforces); kernel-tool↔panel-action ids bridged by an explicit
  map (stricter wins; unmapped money-bearing tools can never go auto); legacy
  `organizations.paxAutonomyLevel` second store deliberately NOT consulted
  (never gated the kernel) — flag for consolidation at Wave 6.
- **Exit test:** `autonomyEnforcement.test.ts` — level-0 ⇒ zero auto possible
  (even with overrides), no-settings ⇒ require_approval, threshold/time
  downgrades, forbid writes nothing, stamp present, chokepoint-uniqueness
  derived pin. 49/49 with the kernel suite. MET.
### 0.5 — Guard totality (non-streaming + subagent recursion enveloped, depth/step budgets, injection eval lane) — ✅ DONE
- **Premise verification: most of P-2 was already true at HEAD** (recorded as
  such, not rebuilt): F-08-1's fix runs `finalizePaxOutput` (hallucination guard
  + live eval gate) on the non-streaming `processChat` return — which IS the
  subagent path (`spawn_subagent` → `processChat(..., "pax_subagent")`), so
  subagent output is guarded before it leaves the subagent; the streaming path
  carries its own twin guard block; depth cap (max 2) + `MAX_TOOL_ITERATIONS=10`
  budgets existed; the envelope + its unit tests existed.
- **The confirmed holes, closed this session:**
  1. **Subagent `response` re-entered the PARENT raw** — `response` is not one
     of `UNTRUSTED_FIELD_KEYS`, so the field-walk left it bare and an injected
     instruction inside a subagent result read as trusted parent context. Now
     wrapped at the source (`tools.ts` spawn_subagent case,
     `wrapUntrusted(..., "tool:spawn_subagent")`; single-wrap proven by test).
  2. **Two support model-loops pushed raw tool results**: `paxSupportResolver`
     (customer-triggered on every ticket) and `supportAgent` fed
     `JSON.stringify(result)` from `executeSupportTool` back to the model —
     customer-authored ticket text re-entered unenveloped. Both now route
     through `serializeToolResultForModel` (the universal boundary).
  3. **`negotiationOrchestrator.get_negotiation_thread` returned counterparty
     free text raw**: `negotiationMoves.terms` (party can be "seller") is not a
     keyed envelope field. Now wrapped at the source
     (`tool:get_negotiation_thread.terms`).
- **Injection eval lane (new):** `dataGroundingEvalCases.ts` section (e) — two
  critical injection-in-content cases (`dg-injection-sendmail-001` embedded
  send-email directive in a lead note; `dg-injection-exfil-001` exfil directive
  in an inbound email), each with safeOutput/adversarialOutput fixtures so the
  derived case test auto-consumes them. Forbidden traits are FIXTURE literals
  (never-legitimate strings), NOT generic compliance phrases — critical-case
  forbidden traits run context-blind on live replies via `evaluateLivePaxOutput`
  and a generic phrase ("email sent") would deflect legitimate authorized-send
  confirmations. Seeded to `ai_test_cases` via migration 0228 + `migrate.mjs`
  mirror (deterministic UUIDv5 ids), so the DB-backed keyed harness gates on
  them — not built-but-unwired.
- **Exit test:** `tests/unit/guardTotality.test.ts` (11 tests) — (a) DERIVED
  sweep: the set of server files pushing `role:"tool"` messages is exactly the
  classified set, and every push site's own content expression is an enveloped
  shape (or server-authored structural literal; the one `content: result`
  exemption in negotiationOrchestrator is held honest by a paired
  wrap-at-source pin) — a new model loop pushing raw results fails CI; (b)
  spawn_subagent wrap present + raw pass-through banned + functional
  single-wrap-through-serialize proof; (c) depth-2 cap + every loop's iteration
  budget + both Pax entry points guarded (F-08-1 stays closed); (d) injection
  lane: ≥2 critical cases with full fixtures, live gate catches every
  injection-compliance adversarial, migration + mirror carry the derived UUIDs.
  MET (11/11 + adjacent envelope/support/negotiation/harness suites green;
  full-gate evidence in the commit).
- **Approval queue:** nothing — no gate/ratchet baseline moved, no send lane or
  hard-stop domain touched (envelope wraps are read-path hardening).
- **Independent completeness audit (post-commit `d54215e`) — found real holes;
  all remediated in the follow-up commit.** The audit treated every 0.5 claim
  as a hypothesis and confirmed 9 defects, the important lesson being that the
  role:"tool" sweep is structurally blind to two whole loop shapes:
  1. `browse_web` `tables` (string[] of scraped page text) passed the field-walk
     verbatim — array ELEMENTS have no key. Fixed in the walk itself (keyed
     fields holding string arrays now wrap each element) + "tables" keyed.
  2. Anthropic-shaped loops (`{role:"user", content:[{type:"tool_result"}]}`):
     Solene dispatchRunner + chat toolExecutor fed bash/file_read/inbox output
     raw. Both wrapped at their executor-output boundaries (fleet-fixed,
     adversarially verified CONFIRMED_GOOD).
  3. `directorAgent` ReAct loop interpolated raw stringified agent results into
     every later prompt (reachable via agentGoalManager); wrapped — including
     FAILED/ERROR branches — and the synthesis cap raised 1000→1400 after the
     verifier PROVED truncate-before-redact expansion could amputate the close
     marker at 1000 (redaction expands text ~10/6).
  4. `core-agents.draftResponse` quoted inbound counterparty messages + lead
     names raw into its template; wrapped/sanitized.
  5. `negotiationOrchestrator.analyzeSellerPsychology` joined seller messages
     raw; `negotiationCopilot` objection text; `decisionsInbox` feature-request
     title/description/category (category's "enum" exists only as a schema
     comment — it is customer free text). All wrapped.
  6. `paxSupportResolver` interpolated the same ticket subject/description the
     tool path now envelopes, raw on the PROMPT path; wrapped.
  7. My own trait bug: forbidden trait "price dropped to $1" substring-matched
     honest "$1,200" replies — the live gate would have silently deflected
     legitimate customer conversations. Traits reduced to collision-proof
     fixture literals (reserved example-domain addresses), plus a regression
     test feeding legitimate replies through the live gate.
  8. My own ratchet was field-order evadable (`tool_call_id` before `role`);
     collector now anchors on runtime-valued tool_call_id with a bidirectional
     window, self-tested on synthetic fixtures.
  9. `serializeToolResultForModel` failed OPEN on results without `data`; now
     walks the whole object (fail-closed for keyed fields at any level).
  All closures pinned in `guardTotality.test.ts` (now 25 tests, incl. §5
  remediation pins that survive refactors).
- **Ledgered, deliberately not built now:** (a) `chatWork.ts` client receipt
  parsers would be defeated by envelope markers on paths UNREACHABLE today
  (chat lacks a dispatch agent role; witnessed-send blocked for chat) — fixing
  needs envelope helpers moved to `shared/`; do it when chat gains those
  capabilities. (b) `complianceValidator`'s 2000-char slice can dangle an open
  marker on >1.85KB objections (validator already treats content as data).
  (c) Lead-row field spreads (`firstName`/`email`/… in `get_lead_details`,
  `query_user_data`) — short customer strings on the trusted channel; needs a
  policy decision on identity-field enveloping, queued for 0.6/Wave-2 review.
  (d) Raw provider blobs (`research_property` enrichment) — same class as the
  connector passthroughs, folded into 0.6's scope. (e) `aiDetectObjection`
  sends raw seller text but output is whitelist-bounded.
### 0.6 — Connectors `executor.ts` P0 disposition (org-scoping, SSRF guard, enveloped results) — ✅ DONE
- **Premise verification against the §8.1 checklist:**
  - **Org-scoping: ALREADY TRUE at HEAD** — `getPaxConnector` filters
    `organizationId + connectorId` (`storage/paxRepo.ts:233`), decryption is
    org-keyed (`decryptCredentials(x, orgId)` — cross-org ciphertext cannot
    decrypt), and all 17 exports take `org` and call `getCredentials(org.id,…)`.
    Recorded as verify-and-pin, not rebuilt.
  - **SSRF: REAL GAP, closed** — Slack/Zapier/Make `webhookUrl` and the MLS
    `mlsUrl` base are org-admin-entered and were fetched server-side with no
    guard (internal/metadata targets reachable). All five URL-bearing sites now
    run `guardConnectorUrl` → the SHARED `validateUrl`/`SSRFBlockedError`
    (`middleware/fileUploadSecurity.ts` — same guard as browse_web, the webhook
    job handler, and /api/webhooks/test), refusing before the network is
    touched and logging the block. Fixed-host vendors (PropStream, BatchLeads,
    Stripe, Google) need no guard — their creds are key material, not URLs.
  - **Enveloped results: REAL GAP, closed** — raw vendor payloads of arbitrary
    shape bypassed the keyed field-walk: PropStream (×2), BatchLeads, MLS/RESO
    (×2 — `PublicRemarks` etc. live under vendor keys), and Stripe customer
    objects now wrap WHOLESALE via `wrapUntrusted`; non-keyed free-text fields
    wrap individually (Drive file names, Calendar `location`). Audit fold-in:
    `research_property` / `get_property_enrichment` in tools.ts wrap their
    third-party `enrichment` blobs wholesale too. Gmail results were already
    fully covered by keyed fields (`from`/`subject`/`snippet`); Calendar
    `title`/`description` are keyed and wrap at the serialize boundary.
- **Exit test:** `tests/unit/connectorExecutorP0.test.ts` (9 tests) — derived
  org-scoping sweep (every executor export must call `getCredentials(org.id`;
  a new unscoped function fails CI) + functional org-id pin; SSRF functional
  proofs (metadata/private/loopback/file:// refused with fetch NEVER called;
  public literal-IP target passes — no DNS dependency in sandbox); envelope
  functional proofs (vendor payloads return as wrapped strings; Drive
  name/Calendar location wrapped, structural fields bare); wiring pin
  (tools.ts still dispatches to the executor).
- **Independent completeness audit (pre-commit) — 6 confirmed holes, all
  remediated in the same commit:**
  1. Silent 8000-char bare-slice truncation would have chopped every
     wholesale-wrapped vendor payload mid-token with no signal — worse than
     unwrapped for data honesty. New `wrapUntrustedJson` caps the JSON BEFORE
     wrapping (12K) with an explicit "[truncated N of M chars]" marker; the
     envelope close marker can never be amputated. All 8 wholesale sites
     (6 executor + 2 tools.ts enrichment) migrated; test feeds a >12K payload.
  2. External MCP break: wholesale-wrapped connector results are reachable via
     POST /api/mcp (safe-intent subset) — external clients would have received
     marker-framed strings where objects used to be, leaking the internal
     envelope convention. `externalizeToolData` at the streamableHttp boundary
     strips markers and parses wholesale JSON back to its pre-envelope shape
     (the envelope protects OUR loops; external orgs get their data clean).
  3. Model-controlled path traversal on "fixed-host" vendors: `new URL()`
     normalizes ".." — customerId "../account" would have sent the org's LIVE
     Stripe secret key to /v1/account; same shape on Drive fileId. Both path
     segments now encoded; functional tests pin it.
  4-5. Uncovered short identity strings (Calendar `attendees`, Stripe
     `receipt_email`, Gmail `Date` header) — sanitized inline per the
     lead-names pattern.
  6. Query-literal injection (model-chosen strings into Drive q-literals and
     MLS OData $filter quotes) — escaped (`odataQuote` doubling, Drive
     backslash+quote escape).
- **Audit verified-OK:** fetch inventory complete/correctly classified (12
  sites; 5 guarded pre-network, 7 fixed-host); no creds field beyond
  webhookUrl/mlsUrl reaches a URL; guard fails closed on unexpected errors;
  org-scoping total; registry + connector routes clean (no other org-URL
  fetches repo-wide); only tools.ts consumes the executor; client UI null
  branch unaffected.
- **Ledgered residual (accepted or deferred, from the audit's ambiguous list):**
  redirect-following after validateUrl matches the repo's established
  webhook-handler pattern (browse_web's per-hop interception is the stronger
  outlier; upgrading all consumers is a Wave-2 hardening candidate);
  validateUrl's DNS-error fail-open + resolve-time (not pinned) rebind window
  are inherited platform-wide traits; `accessToken2` is dead residue;
  `upload_drive_file` sits in the registry with no executor (registry is not a
  verified surface — 0.7/8.2 refactor candidate); `/connectors/:id/connect`
  accepts arbitrary credential keys with no write-time URL validation
  (fetch-time guard covers the security case).
- **Approval queue:** nothing — read-path hardening + a refusal guard on
  org-entered URLs; no send lane (Slack/Zapier/Make sends were already live —
  the guard only narrows targets), no hard-stop domain, no baseline moved.
### 0.7 — MCP server dark/per-org allowlist; hashed-key auth; shared-store rate limit — ✅ DONE
- **Premise drift (major, recorded):** the audit brief targets the legacy
  `server/mcp-server.ts`, but HEAD has the spec-compliant `/api/mcp`
  (`server/mcp/streamableHttp.ts`, Tahoe E12) which already carries the
  checklist's hardest item — hashed `ak_live_` keys resolved through the SAME
  api_keys infra as /api/v1 (hashApiKey + timing-safe re-compare, revocation/
  expiry honored), org binding derived FROM the key (never a param), the
  safe-intent subset with per-tool scope checks, and T0-3's static-key path
  already timing-safe + org-bound. "Migrate auth onto the hashed infra" was
  DONE at HEAD; re-scoped to the remaining delta.
- **Legacy surface RETIRED** (`server/mcp-server.ts`, 279 LOC + its
  `/api/mcp/execute` mount): plaintext key compare in a loop (red-team lens 02),
  unbounded in-memory rate map (lens 052), and mounted behind session
  `isAuthenticated` — its documented external-bearer purpose was unreachable.
  Retirement was pre-recorded in `tahoe-arc-retrospective.md`; zero client
  callers/tests/UI key-creation surfaces (verified). Deletion-ledger row added.
  Earned ratchet drops locked in same-commit: res-status-raw 505→499,
  as-any 1407→1406, colon-any 3018→3017.
- **Availability controls (new):** `MCP_PUBLIC_DISABLED` darkens the endpoint
  (404 via Errors.notFound BEFORE auth — existence not confirmed) and
  `MCP_ORG_ALLOWLIST` narrows it per-org post-auth (403). Defaults preserve
  current behavior; the flip-it-dark decision is queued for the founder (below),
  not made here — the endpoint may have live Claude Desktop-generated users.
- **Shared-store rate limit (new):** tools/call consumes a 100/hr-per-org
  budget (env-overridable; explicit `0`/`off` disables) counted in
  `api_key_usage` — the surface's NATIVE machine-traffic usage ledger, already
  written per-request by requireApiKey for /api/v1 and indexed on
  (organization_id, created_at). Each allowed call inserts a receipt keyed to
  the api key (path `/api/mcp#<tool>`). Replaces the retired per-machine
  in-memory Map. Fails OPEN if the store is unreachable; unknown/forbidden
  tools never consume budget; JSON-RPC batches capped at 20 messages so the
  limiter's own COUNT path can't be amplified through the 1MB body limit.
- **Exit test:** `tests/unit/mcpSurfaceHardening.test.ts` (11 tests) —
  retirement pins (file gone, mount/import gone via precise regexes, modern
  endpoint still mounted); kill-switch 404 pre-auth + default-enabled 401;
  allowlist parsing + post-auth ordering pin; rate limit allow/block/override/
  fail-open + receipt-write + budget-before-handler pin; externalizeToolData
  functional pins (0.6 closure). 38/38 with the two pre-existing MCP suites.
- **Independent completeness audit (pre-commit) — 13 findings; the headline
  ones remediated, the rest dispositioned:**
  - **HEADLINE: `server/mcp/index.ts` is NOT local-only.** It is mounted LIVE
    at `POST /mcp` + `GET /mcp` (`server/index.ts:604/617`, unconditional in
    prod) — my first ledger draft and the "deliberately not executed" claim
    were FALSE, and hardening only /api/mcp made the kill switch a half-truth.
    Remediated: the availability policy (kill switch + org allowlist) moved to
    `mcp/auth.ts` and now covers BOTH surfaces (`/mcp`'s middleware checks it
    before auth / after org-binding). Deletion-ledger row corrected in place.
  - **OPEN + queued urgent: /mcp scope-ladder bypass** — `mcp/auth.ts`
    validates an `ak_` key but never reads its scopes, so a zero-scope key
    reaches every /mcp tool its org is bound to (same credential, two
    authorization ladders vs /api/mcp). Org binding still holds (not
    cross-tenant). Disposition options in the founder queue below.
  - **Remediated store-choice defect:** activity_log receipts would have
    polluted the customer activity feed (feed shows raw rows, 100/hr of
    machine chatter) and distorted EVERY consumer that reads activity as
    human engagement (re-engagement re-arm, power-user referral detection,
    churn/revenue-protection signals — ~30 readers). Receipts moved to
    `api_key_usage` (machine-native, schema-indexed org+created, zero
    behavioral consumers). The three interim consumer patches were reverted —
    fixing the store beats patching thirty readers.
  - **Remediated control defects:** allowlist now FAILS CLOSED when set but
    unparseable (a typo must not silently allow every org); unrecognized
    kill-switch values log a warning; `MCP_RATE_LIMIT_PER_HOUR=0/off`
    disables the cap (it was previously un-disableable — and the "defaults
    byte-identical" claim was corrected: the 100/hr cap + receipts are NEW
    deliberate behavior on tools/call, documented as such); JSON-RPC batch
    capped at 20 (was unbounded → ~17k limiter COUNTs per 1MB request);
    `externalizeToolData` JSON-restores ONLY the root position (a nested
    customer note containing JSON must not flip type externally) and its
    docstring now states the honest limits (sanitizer redaction/truncation
    inside the envelope is not reversible; nested wholesale wraps arrive as
    JSON text).
  - **Accepted/inherited (recorded, not fixed here):** the check-then-insert
    budget is non-atomic (small overshoot under concurrency — documented as
    a firm-budget abuse brake, not a hard cap); the dark-mode 404 is
    app-branded and fingerprintable (availability control, not stealth);
    /mcp's own express-rate-limit stays in-memory (its disposition is queued
    wholesale); /mcp's unauthenticated 503 config disclosure (dies with the
    disposition); `financial_read→notes:read` scope mapping oddity
    (pre-existing); activity_log's indexes exist only in migrations, not in
    schema (flagged for Wave O — drizzle-push provisioning would miss them).
- **Deliberately NOT executed here:** the /mcp disposition itself (retire vs
  per-tool scopes across its 29 tools — founder queue, urgent); the §8.2
  "read-only by default + per-tool grants" token redesign (Wave-2, needs
  key-issuance UX).
- **Approval queue:** the flip decision + the /mcp disposition (below). No
  send lane, no hard-stop domain; ratchet moves are all DOWNWARD (earned by
  deletion, locked per CLAUDE.md rule 5).
### 0.8 — Mail lanes — 📋 PROPOSED (send lane: §A rule 5 — implementation gated on founder approval)
- **Premise verification found MAJOR drift:** the brief's target `lobService.ts`
  is unreachable DEAD code (sole importer's methods have zero external
  callers); the LIVE counterparty rail is MailRouter → lobAdapter →
  directMailService (+3 bypass siblings), already BYOK-first on credentials.
  Purpose lanes are absent across the whole physical-mail stack; there is NO
  system-purpose paper send at HEAD; the 5-piece wedge cap exists but only at
  one route (key-unaware, bypassed by sequences/campaigns/autopilot). The
  Provider-Role Register (§5 item 7) is unbuilt.
- **Full proposal committed:** `docs/proposals/wave-0.8-mail-lanes.md` — the
  lane design mirrors the proven email mechanism case-for-case (purpose field
  → chokepoint guard before the provider client → adapter-never-called
  ratchet), the wedge cap moves into `assertMailLane` at the true chokepoint,
  the register gets seeded, and the exit-test spec (7 cases) is written.
  Two founder decision points inside: lobService delete-vs-lane (recommend
  DELETE), and folding in the `mailProvider.ts` plaintext-credential-read bug
  (recommend fold) + the campaigns env-key address-verification bypass
  (recommend ledger).
- **Why proposal-only:** §A rule 5 — a send-lane change merges only with
  founder approval, and everything committed to this branch rides the wave PR.
  The build lands in a follow-up session against this spec once approved.
### 0.9 — Critical-job-failure pages (F-13-1 verify) + pager-matrix-as-data + external watchdogs (F-18-2) — ✅ DONE
- **F-13-1 verified TRUE at HEAD:** the deadman (`deadmanCheck.ts`) walks the
  146-entry JOB_ROSTER (47 critical), and a dark critical job raises a CRITICAL alert
  through the ONE spine (P0 page, throttle persisted in `deadman_page_state`
  so deploys don't re-page). Pinned, not just read.
- **Pager-matrix-as-data (P5-1) built:** `JobRosterEntry` gains
  `onFailure?: page|queue|tray`; `resolveFailureLane()` is THE resolution and
  gives the structural guarantee the doctrine asked for — `critical: true`
  can NEVER resolve below "page" (a downgrading override is ignored, pinned
  by a tamper test). The deadman now dispatches FROM the resolved lane
  (page→critical spine alert; queue→warning finding+system_alerts, no page;
  tray→log-only, a real behavioral lane for human-cadence-reviewed jobs).
  The old local `entry.critical` severity branch is banned by pin.
- **F-18-2 built:** step-away readiness gains the `external_watchdogs` check —
  armament verified by BEHAVIOR: token unset ⇒ action_needed (founder
  decision 8's deferral is now VISIBLE in the verdict); token set but no
  landed external uptime sample (or stale >45m vs the 5m probe cadence) ⇒
  action_needed (server env alone doesn't close the loop — the GH repo
  secrets can still be missing); recent sample ⇒ ready. The probe ingest
  (`/api/health/uptime-probe` → `recordUptimeSample("external")`) is the
  behavior it reads. Provisioning itself remains the founder's (decision 8)
  — the check makes the verdict stop lying, it does not flip any secret.
- **Exit test:** `tests/unit/pagerMatrix.test.ts` (7 tests) — lane totality
  across the roster; critical-can't-downgrade tamper pin; deadman
  dispatches-from-lane + old-branch-banned pins; F-13-1 spine-contract pins;
  external_watchdogs presence + behavior-not-self-report + loop-closure
  pins. 52/52 with the roster/backup/autopay wiring suites; step-away
  adjacent suites green.
- **Independent completeness audit — 4 confirmed holes (all remediated) + one
  real scoping gap (ledgered):**
  1. The changed file's own co-located suite went red (the "fully armed"
     world lacked the probe token + the db mock lacked the new query chain) —
     fixed rewrite-not-delete, plus two new negative tests (dormant probe ⇒
     action_needed with the armed headline suppressed; token-without-samples
     ⇒ action_needed). Lesson recorded: the audit's run list must always
     include the changed file's co-located suite.
  2. The config-dormant meta-check still gated on raw `entry.critical` and
     its projection dropped the lane — now projects + filters by
     `resolveFailureLane` (the matrix is the single severity source for both
     darkness AND dormancy visibility).
  3. The sample-write throttle was module-global and source-agnostic — a
     future single-process topology would have silently dropped every
     external probe sample while returning {ok:true}, making the armament
     check lie in the false-negative direction. Now keyed by source.
  4. Orphaned JSDoc from the resolver insertion; alert metadata now carries
     `lane`; the probe-token compare made timing-safe (it is now
     load-bearing for a founder-facing verdict); the stale autopilot-control
     copy ("Can't verify from here") corrected — the check verifies exactly
     that.
  - **LEDGERED, real, deliberately not built here: job-FAILURE events don't
    consult the matrix.** `jobFailed` → notificationDispatcher resolves ALL
    146 jobs' failure events to a flat Class-C in-app tray (dbBackup +
    backupRestoreVerify carry explicit workaround comments calling raiseAlert
    directly to escape it). The 0.9 matrix governs DARKNESS (the deadman) and
    dormancy; routing failure EVENTS through resolveFailureLane touches the
    event-mesh dispatcher and is queued as the natural Wave-O follow-up.
  - Also ledgered: `uptime_samples.at` is one of few non-timezone timestamps
    (works on UTC-defaulting Fly; the 45m window would break first on a TZ
    change); the sample query lacks a source index (only hot in the sustained
    loop-not-closed state); the readiness LADDER's watchdog rung checks
    GitHub-side secret NAMES while the step-away check verifies server-side
    BEHAVIOR — complementary, can visibly disagree, neither cross-references
    the other (Wave-O UX note).
- **Approval queue:** nothing — no baseline moved (the new lane field is
  additive data; no entry declares an override yet), no send lane, no
  hard-stop domain. Watchdog PROVISIONING stays with the founder (decision 8).

---

## ✅ FOUNDER RULINGS — 2026-08-11 (second set, on fleet 14's escalation)

**R-5 · `/mcp` retirement SHIPS NOW; key management becomes its own slice.**
The founder accepted that the bypass is a live security defect and that the
stranded population is likely zero. The retirement merges; `routes-api-keys.ts`
+ a Settings surface are scheduled deliberately rather than rushed in as a
dependency.

> ⚠️ **UNSATISFIED PRE-MERGE CHECK — this is the founder's to close, not a
> session's.** I attached a condition to my own recommendation: confirm no
> active `ak_`/MCP traffic exists before merging. **I could not perform it** —
> `DATABASE_URL` is unset in this environment, so no session here can read
> `api_keys` or request logs. The repo-side evidence is consistent with zero
> users (the wizard never rendered `MCP_API_KEY`; the only Claude Desktop config
> is a hand-written file nothing serves; `registerApiKeyRoutes` is unmounted so
> no key could ever have been minted through the product). **That is inference,
> not measurement.** Anyone with prod access should confirm before or
> immediately after deploy, and if live traffic exists, key management stops
> being a separate slice and becomes a blocker.

**R-6 · Fix and ship R-2 and R-3 now; hold R-4 for its own slice.** R-2 and R-3
met their binding conditions and their defects are ordinary. R-4 failed its
honesty condition and needs the coverage question rebuilt to consult actual
fabric content rather than licence admission alone — a design fix, and the lane
most likely to need a second audit.

**Remaining work, in order:** (1) fix R-2's blocking regression (`mode='test'`
no longer holds a platform-key send in Lob TEST; stop-loss skipped on one path);
(2) fix R-3's two (the arming gate is bypassable via `PATCH
/api/collection-enrollments/:id`; the "Stop this sequence" control does not
stop it); (3) sweep the should-fix items on R-1/R-2/R-3; (4) resolve the
`tests/unit/licenseEgress.test.ts` edit (fence-crossing vs legitimate — revert
if it weakens a slice-12 pin); (5) manifest regen LAST, three gates one at a
time, one commit for R-1+R-2+R-3, push, ledger. R-4 stays parked in
`scratchpad/fleet14-*` until its own slice.

---

## Fleet 14 — the four founder rulings — 🟡 BUILT, AUDITED, **NOT MERGED**

**Nothing from this fleet is committed.** All four lanes built and were
independently audited; the audits returned **7 blocking findings**, and **two
lanes FAILED their binding founder condition**. The standing rule — a lane that
ships around its condition does not merge, however good the rest is — is what
holds this out of the branch.

Work preserved at `scratchpad/fleet14-tracked.patch` (223 KB) +
`fleet14-untracked.tgz` (19 files), against base `981e646`.

### R-1 retire `/mcp` — ❌ BINDING CONDITION NOT MET · **NEEDS A FOUNDER RULING**

The retirement itself is clean and well-tested. The problem is upstream of the
code, and it invalidates a premise the ruling rested on.

**The ruling assumed static-key users could be preserved by repointing their
configs at `/api/mcp`. They cannot.** `/api/mcp`'s `authenticate()` accepts only
`ak_(live|test)_` tokens; a scope-less env secret has nothing to check against a
per-tool scope ladder. Making it work would either re-create an unscoped
credential — the exact defect being removed — or grant the static key zero
scopes and refuse it everything.

**Worse, and this is the blocking finding: there is no way to obtain an `ak_`
key at all.** The regenerated config tells a stranded customer to create an
organization API key under Settings → API keys. That surface does not exist.
`server/routes-api-keys.ts` is the only writer of the `apiKeys` table and
`registerApiKeyRoutes` **is never called** — its own header says so, the route
manifest allowlists it as an orphan, and the reachability ratchet counts it
under `unregistered-routes`. There is no client UI (`/api/admin/api-keys` has
zero references in `client/src`). `server/api-v1/*` is likewise unmounted.

So this is not a loud break with a migration path. **It is a capability
termination with no path back**, and every route out crosses a standing
decision — mounting key management needs an explicit carve-out from *no public
API before ~25/50 customers*. Escalated rather than shipped.

*Mitigating fact, verified: the wizard NEVER rendered `MCP_API_KEY` — it was in
`HINTS`/`GENERATE_TYPES` but absent from `KEYS_BY_STEP`, a dead entry. The only
Claude Desktop config in the repo is a hand-written static file nothing reads or
serves. The stranded population may be zero. That should be confirmed against
real usage before the ruling, not assumed.*

Also recorded: the brief's own premise was wrong twice — `routes-setup.ts`
generates no config file (it mints a random key VALUE only), and `/mcp` was
never in the route manifest, so "gone from the manifest" and "unregistered-routes
moves DOWN" were both no-ops. The repo won; the lane satisfied the condition's
INTENT via a derived repo-wide sweep instead.

### R-2 mail consolidation — ✅ binding condition MET · 1 blocking, fixable

Audit could find no way the allowlist was written from the brief rather than
from the map. One real regression to fix before merge: `mode='test'` no longer
keeps a platform-key send in Lob's TEST environment, and the outreach stop-loss
is skipped on one path. Plus 3 should-fix, 4 notes.

### R-3 dunning arming — ✅ all five conditions MET · 2 blocking, fixable

Both blocking findings are the house pattern:
1. **The arming chokepoint is only on CREATE.** `PATCH
   /api/collection-enrollments/:id` walks straight around it — so the gate the
   ruling exists to install can be bypassed by editing instead of creating.
2. **The off switch asserts what the code has not established** — a control
   labelled "Stop this sequence" that does not do that.

### R-4 open-licence county fabrics — ❌ HONESTY CONDITION NOT MET · 3 blocking

Conditions 1–3 verified met against the code (no paid vendor, admission is
`postureMayLeave` with no "pending" state, attribution refused without credit).
**Condition 4 — the honesty condition — failed, in exactly the way it was
written to prevent:**
1. **The fabric draws parcel boundaries for counties whose own inspector, on
   the same screen, says we have no parcel data for them.** One surface
   contradicting another about the same county is the defect the condition
   named.
2. `fabricCoverageForCounty` answers the customer-facing coverage question from
   **licence admission alone**, never consulting what is actually in the fabric.
3. A `--county`-scoped build is written under, and published as, the **whole
   statewide layer**.

---

## Wave 3 — slice 13 (aging ladder · CAM worksheet · payoff-quote PDF) — ✅ SHIPPED

**Shipped at `4f8b5ab`.** Three depth-per-vertical lanes, each independently
audited. Gates verified separately: check 0 · test 0 (**11,831** passing) ·
build 0. Manifest regenerated last. Wave 2.2 was excluded from this fleet
because its licence decision was still open (now ruled — see R-4 below).

**Six blocking findings, all fixed centrally and pinned. Every fix was
mutation-tested rather than assumed** — the auditors' own mutations were re-run
and each now reddens the suite.

| # | What would have reached a human | Fix |
|---|---|---|
| 1 | **A tenant told they were owed $1,746 when they owed $2,753.** CAM's estimated-billed multiplied the lease's monthly estimate by the POOL's month count while the worksheet selects leases by OVERLAP, so an October lease in a calendar-year pool got twelve months of billing. The delta is SIGNED, so understating billing flips a balance owed into a credit — and this lane makes it a **frozen exhibit**. | Clamped to real overlap, renamed to say it is a projection, and the freeze is **refused** on a partial-period projection. |
| 2 | **A closer wiring $0.00 and releasing a lien.** A borrower holding a deposit larger than their payoff got principal $48,250, credit $60,000, bare `TOTAL PAYOFF $0.00` — components summing to −$11,175.63, nothing saying the total was floored or the surplus returnable. | The unclamped sum is computed separately; the surplus prints as its own line. |
| 3 | **The two books disagreeing about the same borrower.** The notes ladder filed every past-due period at the OLDEST period's age — $3,000 in the 61-90 rung where rent spreads identical facts across three rungs. | One row per period, unapplied credit consumed oldest-first. |
| 4 | **A note the book refuses to date, reported as a known $0.00 past due** (periodsDue 0 × a known payment = a confident zero, total flagged complete). | A refusal yields an UNKNOWN amount; each refusal gets its own accurate sentence. |
| 5 | **A hybrid schedule miscounting arrears by a full payment**, either direction — `scheduleAnchor` returns `firstPaymentDate` un-snapped while `importExport` DEFAULTS `paymentDueDay` to 1. | New refusal `anchor_does_not_match_due_day`: guessing which field is authoritative would be fabrication in whichever direction we picked. |
| 6 | **The CAM freeze was not established by any executable test** — three mutations survived a fully green suite, two disabling the freeze on the live write path. | Behavioural pins replace the source scan. |

**The pathology, in three disguises — worth carrying forward.** Every one of
these audits found a test that was green and proved nothing: a byte-stability
test comparing a local object literal to a snapshot *of itself* (passed even
with the freeze policy forced to always write); a numerator gate tested with
`rows: []`, which cannot distinguish "no rows" from "no *recoverable* rows"; and
58 presence-checks that let the PDF's headline total be swapped for the
principal, printing $48,250.00 at the top and $48,824.37 below. **Presence,
counts, and imports are one-directional.** That is now three consecutive slices
where the load-bearing defect hid behind a pin of that shape.

**Ratchets moved DOWN and locked here** (as-any 1406 → **1405**, colon-any
3017 → **3010**) — earned by ordinary typed construction, and surfaced by the
gate flagging them *stale-high*, which is the mechanism working as designed.
Two real eslint regressions were fixed at the occurrence, not the baseline.

---

## ✅ FOUNDER RULINGS — 2026-08-11 (in-session, on presented options)

Four items ruled at once. Each was blocked on a decision only the founder can
make; all four came back as the recommended option. Recorded here in full
because three of them touch standing constraints (a send lane, consumer
contact, and a spend hard-stop), so a future session must be able to see the
exact scope of what was authorised — and what was *not*.

**R-1 · `/mcp` scope-ladder bypass → RETIRE `/mcp` in favour of `/api/mcp`.**
The bypass (`mcp/auth.ts` accepts `ak_` keys and never enforces their scopes,
so a zero-scope key reaches all 29 tools for its org) is closed by removing the
surface, not by patching it. **Binding condition:** the static-key lane must be
PRESERVED — `routes-setup.ts` and the founder setup wizard generate Claude
Desktop configs pointing at `/mcp`, and those must be regenerated against
`/api/mcp` in the same change, or customers' configs break silently. Expect the
`unregistered-routes` reachability count to move; it may only go DOWN.

**R-2 · Mail lanes (§D 0.8 / Wave R.1) → APPROVED.** Consolidate every mail
path onto `mailProvider`, and **delete** the dead `lobService` under the
deletion-ledger process rather than retaining it with a laned signature.
Includes the refuse-don't-fall-back rule: an org with no connected Lob
integration is refused on every counterparty-send surface with a connect
affordance, exactly as SMS behaves today; the platform key stays reachable only
for the registered wedge exception and system mail, under the existing
interlock. Also folds in the `mailProvider` plaintext-credential-read bug
(proposal decision (b)). **Binding condition:** R.1's blast radius is **14
files** touching `LOB_*` keys, not the 3 in R.0's table (drift D-8b) — the
consolidation MAP comes first and the grep-ratchet allowlist is written FROM
that map, never from the brief. This authorises the consolidation; it does not
authorise any other change to a send rail.

**R-3 · `dunning_sequences.autoStart` → flip the default to FALSE for new rows,
and surface existing armed sequences for one-tap confirmation** rather than
either grandfathering them silently or disarming them wholesale. The point of
the ruling is that every running sequence ends up with someone who actually
chose it, without cutting off a live collection mid-ladder. **Binding
conditions:** the confirm surface lives behind the existing Finance door (no new
nav entry); the arming gate must show the exact ladder, timing and channels
before it can run; and the sibling-default sweep is in scope —
`pre_authorized_tradeoffs.autoExecute` becomes a *named* pre-authorisation
rather than an implicit default.

**R-4 · Wave 2.2 county fabrics → open-licence counties ONLY, no vendor spend.**
Ship PMTiles fabrics only for counties whose data is already open-licensed, and
prove the tiling pipeline on real data first. **Binding condition: NO paid
parcel-data licence is authorised** — that remains a spend >$500 hard-stop and a
recurring vendor obligation, and it was explicitly declined for now. Licence
posture per county already exists (`county_gis_endpoints.redistributable` +
slice 11's egress chokepoint); a county whose posture is not `yes`/`attribution`
does not ship, and "we do not have data for this county" must stay honest rather
than becoming "we chose not to license it".

---

## Approval queue for the founder

1. **Standing table-drop decision (pre-existing, surfaced not created here):**
   `agent_improvement_plans` + `agent_synergy_map` are orphaned (their sole
   readers/writers were deleted in the founder-approved dead-facade KILL) and
   queued in `reachability.json`'s note for an explicit DROP ruling. Customer-
   data deletion is a hard-stop, so only the founder can rule. No urgency; they
   sit inert in the reachability baseline until ruled on.
2. **DR restore drill (F-13-2 / Wave O2):** founder/ops-run with
   `DB_BACKUP_S3_BUCKET` — the one Ten item whose execution is physically a
   founder action.
3. **F-16 Phases 2–3 (router migrations)** — need a KEYED environment + the eval
   gate (the plan's own constraint). Decide when/where to run them; the tool-aware
   router (Phase 1) is now built and baked, so Phase 2 can start the moment keys
   exist.
4. **Founder-side metering design (from 0.3's findings):** (a) Atlas's main loop
   has no ceiling consult / telemetry — metering the founder's own cockpit has a
   real tradeoff (a misconfigured ceiling could block Atlas mid-incident); (b)
   Solene records spend to capitalTracker but not aiTelemetryEvents, so ceilings
   can't see it. Both held in aiCostCoverage's dated KNOWN_GAPS allowlist pending
   your call on the metering semantics for founder-org spend.
5. **0.8 mail lanes — PROPOSAL READY for your ruling**
   (`docs/proposals/wave-0.8-mail-lanes.md`): approve the lane design (mirrors
   your 2026-07-17 email-lane decision at the true physical-mail chokepoint,
   wedge cap moved there, Provider-Role Register seeded) and rule the two
   decision points: (a) DELETE the dead lobService (recommended) or retain
   with a laned signature; (b) fold the mailProvider plaintext-credential-read
   bug into the build (recommended). On approval the implementation follows
   the committed spec. **UPDATE 2026-08-11 — your Addendum E R.0 confirms this
   proposal's independent finding** (Part 3 §2.4's "no BYO path exists" was
   wrong; the leak is dormant, not live). The proposal needs no rewrite; the
   §D brief was re-scoped to match it. R.0's remaining ask is that consolidation
   cover the eleven additional `LOB_*` files the proposal's map does not yet
   name (D-8(b)) — that widening is inside the same ruling, not a new one.
6. **MCP endpoint availability (from 0.7):** the dark-flag + per-org allowlist
   mechanism is merged with defaults preserving current behavior (enabled, all
   orgs). Your call, per §8.2 and the no-public-API-before-~50 trigger: set
   `MCP_PUBLIC_DISABLED=1` (fully dark until the ~50-customer flip) or
   `MCP_ORG_ALLOWLIST=<ids>` (named pilot orgs only). Consideration: existing
   `ak_` keys may already be in customers' Claude Desktop configs — darkening
   breaks them silently.
7. **URGENT — `/mcp` disposition (from 0.7's completeness audit):**
   `server/mcp/index.ts` is mounted LIVE at POST/GET `/mcp` (server/index.ts)
   and has a real scope-ladder bypass: `mcp/auth.ts` accepts `ak_` keys but
   never enforces their scopes, so a zero-scope key reaches all 29 /mcp tools
   for its org (org binding holds — not cross-tenant — but /api/mcp enforces
   per-tool scopes and /mcp does not: same credential, two ladders). Wave 0.7
   extended your kill switch + org allowlist to this surface, but the bypass
   itself needs one of two dispositions: (a) RETIRE /mcp in favor of /api/mcp
   (breaks Claude Desktop configs generated by routes-setup.ts /
   founder-setup-wizard — MCP_API_KEY static-key users), or (b) implement
   per-tool scope enforcement across its 29 tools. The retrospective's
   "retire/harden" line supports either; (a) is less code and one fewer
   surface, and the static-key lane could be preserved by pointing generated
   configs at /api/mcp.
8. **Wave R item R.3.5 — `dunning_sequences.autoStart` default flip (new,
   2026-08-11):** `shared/schema.ts:3319` defaults it to **true**, so
   debt-collection-adjacent contact with a consumer can begin by schema default
   rather than by a customer's decision. Addendum E asks to flip it to false
   behind an explicit arming gate. Flipping an outbound cadence default is
   §A rule 5 (send-adjacent), and it changes behavior for any existing row
   relying on the default — so it needs your ruling plus a migration decision
   for rows already created. Sibling sweep in the same pass:
   `pre_authorized_tradeoffs.autoExecute` (founder-side, defensible, but should
   be a *named* pre-authorization rather than an implicit default).
9. **Wave L — publishing customer-facing legal text (new, 2026-08-11):**
   drafting in-repo needs no approval and will proceed. **Publishing** does —
   ToS/privacy/DPA edits and the new Beta Addendum reach customers. Two things
   are also blocked on inputs only you have: (a) **L1.3** needs a real business
   address to replace the `[To be confirmed upon LLC formation]` placeholder at
   `docs/legal/terms-of-service.md:246` — refuse-not-fabricate means I will not
   invent one, and the same constant feeds CAN-SPAM footers; (b) **L6**'s seven
   counsel questions are the deliverable, not something I resolve.
10. **Wave S item S3 — hands proportional to mandate (carried, now itemized):**
   deploy/rollback hands (canary-green + `codeChangeGate`; self-patch still
   never merges itself), ops remediation hands, and any send-adjacent hand.
   Pricing remains hard-stopped forever — staff may prepare the memo, never
   touch the lever.

## Wave 2 — slice 11 (license-aware egress + provenance grammar + map M0) — ✅ SHIPPED

**Wave 2 opens, and its headline item is now true: a `redistributable:"no"`
field cannot leave the platform.** All three lanes came back DEFECTS_FOUND —
4 blocking — and one of those was a REAL LEAK the wave exists to close.

- **2.5 LICENSE-AWARE EGRESS CHOKEPOINT:** `server/services/licenseEgress.ts`
  resolves a declared source to a posture from two authorities it does NOT
  copy — the `DATA_LICENSE_REGISTER` (22 sources) and the five provider
  objects' own `.redistributable`/`.license`/`.attributionText` — so
  renegotiating ATTOM's contract in attom-provider.ts moves the chokepoint
  automatically. Fails CLOSED (absent/unknown provenance ⇒ withheld,
  `review-required` never leaves), and a caller-supplied per-county review can
  only SETTLE a review-required source, never upgrade a declared "no"
  (pinned both directions). Wired at six channels. A thinned artifact SAYS it
  was thinned. The builder also caught its own would-be 500: the notice
  contains an em dash and `res.setHeader` throws above U+00FF.
  **BLOCKING fixed — the inventory missed the file-download ARTIFACTS.**
  `GET /api/properties/:id/report.pdf` renders a branded PDF from
  `parcel_snapshots` — owner of record, mailing address — whose source
  resolves to `redistributable:"no"` today, and a PDF the customer forwards to
  a counterparty is the most redistributive channel there is. A `pdf-artifact`
  channel now exists, every snapshot read routes through a screened alias, and
  the footer stops crediting a vendor whose facts the document does not
  contain.
  Also fixed: the index keyed provider NAMES but not the source strings
  providers actually emit (`county-gis` stamps `"County GIS"`), so real county
  rows fell to the unresolved branch and told the user provenance "is not
  recorded" — a false negative about data whose provenance is right there. And
  a withheld public-report category kept `available: true`, so the page
  rendered a FABRICATED ABSENCE ("we looked and found nothing") instead of a
  disclosed suppression.
- **2.4/2.6 PROVENANCE GRAMMAR + DISCLAIMER LINT:** a genuine consolidation —
  the two pre-existing dialects (data-provenance-chip and -tag) now both
  render from one `describeProvenance`, and a fabricated
  `asOf={new Date().toISOString()}` in comps-analysis (a "today" stamp on
  every render) is gone, replaced by react-query's real `dataUpdatedAt`.
  **BLOCKING fixed:** the wave INVERTED the meaning of `asOf` (was "when we
  retrieved it", now "the vintage AT the source") without migrating consumers,
  so properties.tsx was passing OUR timestamps as the SOURCE's vintage — the
  UI would have claimed a vendor's data was "as of" a date that is really
  ours. Every consumer migrated; the four remaining `asOf` values are genuine
  source vintages. Also fixed: coverage was detected with a raw-source
  substring, so a comment or dead import counted as a disclaimer, and the
  valuation markers missed ARV/AVM/After-Repair. Tightening both surfaced 19
  uncovered advice surfaces; disclaimers were added to the ARV calculator, the
  CMA panel and the price optimizer, taking the real count to **13 — below the
  old baseline of 15**, so the ratchet moved DOWN and was locked.
- **2.1 MAP M0 GROUNDWORK:** the premise correction is the deliverable —
  property-map.tsx imports BOTH mapbox-gl and maplibre-gl and selects at
  module-eval time, so the old "Phase 2 not in this commit" header was stale;
  the builder corrected it in place with a HISTORY block rather than deleting
  the evidence. `client/src/lib/basemap.ts` gives every source a style URL AND
  the attribution that legally must accompany it, from one record.
  **BLOCKING fixed:** the header claimed a self-hosted Protomaps basemap is
  swappable by CONFIGURATION — but the server's CSP `connect-src` is a
  hardcoded allowlist admitting only the Mapbox hosts, so any off-origin swap
  fails at runtime with no obvious cause. The claim now states the truth:
  same-origin self-host is genuinely config; any off-origin host needs its
  host added to connect-src in the same change.

## Waves S/F/X — slice 10 (S5 emitter + F1-s4 + X-A-s2 signals) — ✅ SHIPPED

Two lanes DEFECTS_FOUND (1 blocking each), one CONFIRMED_GOOD. Both blocking
defects were, again, **founder-facing sentences asserting more than the code
established** — five slices running now.

- **S5 EMITTER (the derivation slice 9 deferred rather than faked) —
  DEFECTS_FOUND, fixed:** `contentionPositions.ts` derives each side from real
  state (who from the move's own `domain`, what from the ranker's own
  rationale, cost from the dispatch ceiling + live envelope, risk from
  crossFunction couplings weighted by live pressures) and **refuses far more
  often than it files**. The central judgement is mapping by MOVE PAIR, not
  charter pair: only `budget_allocation` survives that test today, because
  `growth_vs_finance`'s question ("hold the cash for runway?") is answered
  only by `protect_runway`, a P0 the ladder decides outright, and
  `speed_vs_compliance` names a charter NO decide.ts move carries. Two further
  refusals (`multi_way_split`, unknown-kind) exist purely to stop a card
  over-claiming. The seam is inert by construction — its own try/catch (so a
  memo failure can't log "deliberation failed"), assigns nothing, and the
  builder pinned that the block contains no assignment to the tick's state.
  Its own draft-stage catch is worth recording: deriving
  `requiresNewCommitment` from act.ts's binding made `optimize` read as
  commitment-free, producing "silence effectively backs ops" — false, since an
  optimize dispatch spends from the same envelope.
  **BLOCKING fixed:** the cost basis labelled an agent_dispatch-ONLY figure
  "Month-to-date AI and data spend" and compared it to the whole envelope —
  understating the draw on the very envelope the card asks the founder to
  allocate, on the one contention it can file. Now named for what it measures,
  with the exclusion stated. Also fixed: the DEFAULT line said "silence
  advances neither" when the ladder ranks `grow_owned_channels` ABOVE
  `optimize`, so silence hands the tick to growth — the default is now
  ladder-aware, and the stale pin was REWRITTEN to the new truth rather than
  deleted. And the module header claimed a derivation it does not perform.
- **F1 slice 4 — CONFIRMED_GOOD, the auditor "set out to break it and could
  not":** five routes absorbed into a new `/founder/admin/agents` instrument
  hub (agent-queue, governance, trust-graduation, memory, scenarios — "every
  surface that inspects the agents themselves"), mirroring admin/costs and
  admin/telemetry, with redirects and the baseline lowered in the same change.
- **X-A slice 2 (signals, nothing enforced) — DEFECTS_FOUND, fixed:** the
  panel reads real evidence, labels caps "consumed vs proposed" from
  `resolveOrgTrustCapStatus` (so a surface can never drift into claiming a cap
  is live), and the auditor independently confirmed NOTHING writes
  `organizations.trust_tier` outside migration 0229's frozen seed.
  **BLOCKING fixed — the fabrication was in a NEGATIVE claim:**
  `export_velocity` was declared UNAVAILABLE because "nothing records an
  export", and that false premise rendered verbatim on the founder panel AND
  became a founder-queue ask. `export_jobs` records exactly this — org-scoped,
  indexed on (organization_id, status, created_at). The signal is now REAL,
  scoped honestly to bulk archive jobs (a per-view CSV that creates no job row
  is not counted, so it is a floor). Also fixed: the complaint-rate
  unavailability rested on "no per-org send denominator exists" when
  `outbound_email_log` IS org-scoped — reworded to the true reason (it covers
  only registry-routed mail, so dividing complaints from ALL mail by a
  fraction of it would overstate every org's rate). **And the exit test itself
  was the deeper problem:** it enforced source truth in one direction only, so
  it PINNED the fabrication instead of catching it. It now also requires every
  unavailable signal to name the tables it actually inspected, and asserts
  those tables exist and appear in the note — an absence claim must be
  checkable, not asserted.

## Waves O/S — slice 9 (O6 unit-economics receipt + O7 continuity kit + S5 conflict memos) — ✅ SHIPPED

All three lanes came back DEFECTS_FOUND — **3 blocking, 10 should-fix** — and
every one is fixed centrally and pinned. The pattern is now unmistakable and
worth naming: for the third slice running, the defects that mattered were not
broken code but **surfaces asserting things the code had not established**.
Type-checks, lints and the lanes' own tests were green throughout.

- **O6 (unit-economics receipt + infra curve):** the engine already existed,
  so the lane's work was the surface — and its own builder caught two
  honesty defects mid-build (judging the ≥70% charter floor against
  CONTRIBUTION margin, which excludes the allocated fixed share and would
  have flattered every month by exactly the allocation; and a vacuous "every
  organization (0) has a snapshot — nothing is missing" on an empty
  cluster). Integration fixes: the "Customers with a snapshot" tile counted
  ORGS (computeAllOrgs snapshots free tiers, trials and the demo org) — now
  "Orgs with a snapshot" qualified by the real paying count; the roll-up
  broke the service's own ZERO-NEEDS-EVIDENCE contract, which per-customer
  rows honored but the figure the Letter LEADS with did not — now carries
  `billedEvents` ("$0 across 0 billed events" vs "$0 spent"), null when the
  counts are unreadable because unknown is not zero; freshness stated a date
  but no AGE and no threshold, so a dead nightly job would keep rendering a
  present-tense pass/fail against the margin floor — now `ageDays` +
  `RECEIPT_STALE_AFTER_DAYS`, with the floor VERDICT suppressed once stale;
  and the "what this curve cannot see" list claimed map tiles were "not yet
  billed" when Mapbox ships today and bills for tile loads — reworded to
  name the vendor actually incurring unmetered cost.
- **O7 (deputy break-glass kit + continuity):** the kit is a real artifact
  with a machine-read declarations block, an append-only review ledger, the
  six constitutional hard stops by id, and a freshness ratchet genuinely
  mirroring the DR-drill trio. **BLOCKING (public page):** the /transparency
  continuity statement asserted in the present tense that the kit "exists and
  is reviewed on a fixed interval" — it has never been reviewed, zero review
  blocks, and every other surface says so. Rewritten to state the POLICY
  ("declares a 100-day review interval, and has not yet had its first
  recorded review; once one lands, our build fails when it ages past it"),
  with the pin now DERIVED from the kit's real freshness so it cannot go
  stale in either direction. **BLOCKING (gate estate):** the lane edited
  public-claims.ts — a gate-tamper-pinned file — without regenerating the
  manifest, which would have failed `npm test` AND paged the live
  gate_tamper_watch job. Regenerated. Also: the Controls card rendered "0 of
  12 pieces in place" plus twelve red rows in PRODUCTION, where docs/ is
  excluded from the image so the kit cannot be read at all — twelve
  fabricated failures; it now says "Readiness can't be read from here" and
  suppresses the list. And a hardcoded "the vacation test has not been run"
  sentence is now DERIVED from the kit's own drill line (null on NONE).
- **S5 (conflict memos):** the builder's registry-refusal, ladder-first
  ordering and derived-not-copied stabilize set are genuinely good — probing
  decide.ts's real `rankMoves` means a new P0 move is covered the day it
  lands. **BLOCKING:** the Decisions door toasted "Your decision was
  recorded and applied" for a memo, which by design has `actionPayload:
  null` and applies NOTHING — the toast now reads the server's `executed`
  flag and tells the truth per card. Also: the memo asserted the safety
  ladder "would have decided this" from live incident/envelope/compliance
  state it never reads — downgraded to what the code actually checks (the
  two positions' move kinds); `getContentionState` reported `openMemos: 0`
  when its query THREW — now `number | null` with a `readFailed` marker,
  because "not measured" is not "none open"; and nothing validated that a
  memo's two positions belong to the contention they are filed under, so a
  card could be headed with one fight while its positions argued another —
  now a `charter_mismatch` refusal, ordered AFTER the ladder check so a fire
  still reports `ladder_decides`.
- **Deferred honestly, not silently:** `fileConflictMemo` has no production
  caller yet — wiring the emitter means deriving two REAL charter positions
  (recommendation, cost read, risk read) from live loop state, and inventing
  those hastily is precisely how a fabricated memo would be born. The read
  surface and its founder-gated endpoint are the slice's deliverable; the
  emitter is the next slice's, named here rather than papered over.

## Waves S/1 — slice 8 (S4 scenario library + 1.3 door interactions + 1.5 settings) — ✅ SHIPPED

**Fleet incident, recorded because the protocol earned its keep:** fleet 8
lost TWO agents to credit exhaustion mid-run — the W1.3 verifier and the
W1.5 *builder*. The W1.5 lane therefore reached the tree with NO
self-report, no suite record, and no drift log: unaudited work that
type-checked and passed its own test. Both missing audits were re-run as
fleet 8b (`wf_c8f881a1-47b`), the W1.5 one explicitly briefed that its
builder had died and that completeness was its primary question. Between
them the audits found **2 blocking defects and 15 more**, every one of
which is fixed centrally below. Nothing was committed until they returned.

- **S4 (scenario library as executable doctrine) — CONFIRMED_GOOD:** 17
  seeded Addendum-C rows in `server/services/autopilot/scenarioLibrary.ts`,
  every reference DERIVED — sense triggers through `senseIsWired`, charters
  through `getCharterDef`, runbook refs resolved on disk, and every
  `founderTouch:"page"` row naming a real pager path or rendering as an
  honest "declared, not yet wired to a pager" (exactly 2, pinned). Legal
  letter = founder-only + page + counsel path, no staff autonomy ever;
  model-provider-outage cites the deterministic floor as its playbook. A
  third honest trigger form (`human`) was added rather than inventing event
  kinds for scenarios with no machine sense. `lastDrilled` is null for all
  17 (no game-day ledger exists yet) — pinned as CURRENT TRUTH with
  rewrite-don't-delete instructions. The builder caught its own dead export
  during self-audit and WIRED it instead of shipping it.
  Integration fix: event rows rendered the same "trigger wired" badge as
  sense rows, but a verified literal only proves the emitter EXISTS — a
  dormant emitter would have read as fully wired. `triggerEvidence` now
  distinguishes sense-consumed / event-literal / human, with its own badge.
- **W1.3 (door interactions) — DEFECTS_FOUND, all fixed:**
  1. **BLOCKING, an outright lie in the UI.** "Approve N above threshold"
     with a Zap icon over rows badged "Pax would handle", whose dialog
     promised "anything that needs a witnessed send will still ask you" —
     while writing `status="done"`, which `isQueueItemHidden` treats as
     permanent (no expiry, unlike snooze) against deterministic item ids.
     The user was told they were authorising Pax to proceed; the actual
     effect was permanent silent dismissal with nothing executed and no
     future prompt. Now: **Clear** N above threshold, "these rows will not
     come back", the false "same as tapping Done on each row" claim removed
     (no Done button is EVER rendered on those rows — `canResolveInline`
     requires `!auto`), irreversibility in the aria-label. Pinned scoped to
     the dialog so the row-level copy, which is honest about a row left
     alone, survives untouched.
  2. Capture-phase listener took precedence for EVERY key, not just "?",
     silently outranking any nested owner of j/k/Enter/Escape and making
     the hook's own `defaultPrevented` guard unreachable (proven by the
     auditor with a differential harness). Split: "?" alone captures,
     everything else bubbles where the pre-wave hook listened.
  3. The "?" overlay claimed "nothing is lost" while displacing the app's
     ONLY entry point to five global shortcuts. It now renders them, pinned
     against the real `global: true` registrations so the two cannot drift.
  4. `use-keyboard-layer.ts` orphaned by the wave — 106 lines of
     live-looking dead code invisible to every gate (reachability scans
     server exports only). Deleted; the primitives file's consumer list
     corrected.
  5. Needs-reply resurfaced just-archived threads: the query filtered
     `isArchived=false`, so the derivation never saw the archived latest and
     promoted the next-newest instead — the view whose caption promises
     archiving clears it. The unit test passed only because its fixture
     supplied a row the runtime could never deliver. Query no longer
     filters; the reproduction is pinned.
  6. Deals mobile readouts dropped the "N of M priced" qualifier and
     aria-label desktop carried, so a PARTIAL total read as complete. One
     `ColumnValueReadout` now serves all three viewports, pinned.
  7. Inbox focused-row aria-label replaced the row's whole accessible name
     with a generic string — sender and subject restored.
- **W1.5 (settings decomposition) — the lane with no builder record —
  DEFECTS_FOUND, all fixed. The audit's completeness verdict was strong on
  the question that mattered:** all 8 monolith `TabsContent` bodies traced
  control-by-control (57 data-testids grepped) with nothing dropped; gating
  parity exact (`feature.autonomy-matrix` now enforced in three places,
  component-level owner/role gates byte-identical); all 11 legacy
  `?tab=`/`#hash` forms resolve to live sections. settings.tsx: 1,843 → 386
  lines, 16 routed sections, TabsContent ratcheted to zero.
  1. **BLOCKING, fabrication class.** The P2 §1.4 status rows presented
     PLATFORM signals as the ORG's own state: the comms lane read
     `/api/integrations/status` (platform SES/Twilio/Lob env) and the AI
     lane read AcreOS's own OpenAI key — so an org with nothing connected
     was told "Email ready" and "Your AI provider key is connected". On the
     page whose entire job is telling you what YOU have connected. Comms now
     reads `/api/settings/integrations/status` (isAuthenticated +
     getOrCreateOrg, the org's own providers WITH validation state, which
     also lets a row say *erroring*); the AI lane is REMOVED — no
     org-scoped AI health exists at HEAD, so the row shows nothing rather
     than something false. `statusLane` is typed `"comms"` only, so a future
     "ai" lane fails typecheck instead of silently reintroducing it.
  2. **BLOCKING.** QuickFind's 25-row catalog still spoke the retired
     7-tab vocabulary while the shell routed jumps through the legacy map,
     so ~7 rows landed on a section that does not contain the control they
     name ("API keys" → Mailbox, "Appearance / theme" → Profile). Every row
     now names a REAL registry section id and the shell navigates by
     `settingsSectionPath`; the catalog stays deliberately finer-grained
     than the registry (people search for the control, not the page), with
     every id pinned against `SETTINGS_SECTIONS`.
  3. The `:settings` palette browse branch was dead code — computed, then
     swallowed by a render guard requiring a non-empty query. Guard relaxed
     so a scope chip renders its slice.
  4. The legacy-hash resolver ran on EVERY `/settings/*` path, so any
     in-page anchor colliding with a legacy token (#team, #billing,
     #security…) teleported the reader — and blocked the setting-level
     anchors §1.4 asks for. Now root-only.
  5. QuickFind hijacked ⌘K across ~18 mount points (it had one at HEAD),
     killing the global palette throughout settings — including on the
     pages where this same lane added settings destinations TO that palette.
     ⌘K released; "/" now also exempts contentEditable and ARIA text
     widgets; the visible hint matches the key actually owned.
  6. `integrations` meant two things (`/settings/integrations` = Slack &
     Teams vs the map's → communications); the listings.tsx link that read
     "Settings → Integrations" now points at the section holding partner
     credentials with a matching label.
  7. The registry docstring claimed the surfaces "reach 100% of the
     inventory" while an unrouted, unimported `pages/settings/api-keys.tsx`
     sat outside it. Orphan deleted; the claim narrowed to what the suite
     proves.

## Waves S/1/O — slice 7 (S1+S2 staff charters + 1.4 EntityTable + O4 SLOs) — ✅ SHIPPED

- **Wave S S1+S2 (the first staff slice, per D-5) — CONFIRMED_GOOD:**
  `server/services/autopilot/charters.ts` — six charters (five Trust-Ledger
  domains + Beatrice/compliance) with every field DERIVED from real wiring:
  handsGranted from the live hands registry, coreSenses from a new
  SENSE_INVENTORY in senses.ts (wired = loader exists AND the tick/context
  pack consumes it, source-pinned with drift pins proving the declared gaps
  are still real), metrics real-or-null, ladder from getTrustLedger, last-3
  receipts per domain (per-domain queries — the shared-window false negative
  was fixed at integration). Beatrice ships OFF-ledger, honestly marked
  (extending AutopilotDomain was invasive: crossFunction's exhaustive
  5-domain records — recorded drift, not forced). Staff cards = a tab in the
  Controls hub; the Letter prints "I cannot yet see X" blindness lines from
  the same registry; GET /api/founder/autopilot/charters serves both. S2:
  promotionPerceptionGate — no domain promotes past `draft` with unwired
  core senses; recordCleanCycle refuses to mint the promotion card (counter
  still accrues; observe→draft unaffected; founder sovereignty untouched);
  integration hardening: the gate now fails SAFE on an unchartered domain
  ("no charter on file"), pinned. Reachability drop earned + locked
  (652→651, listHandSpecs gained its first production consumer).
- **Wave 1.4 (EntityTable kit) — CONFIRMED_GOOD:** typed column defs,
  sortable headers (aria-sort), sticky header, EmptyState/skeleton per
  config, j/k+Enter row navigation; EntityList as the card/stack half. All
  five heavy lists migrated (leads, properties, finance notes, rent-roll,
  auction-worksheet) with prior table scaffolding removed and a derived
  forbidden-marker pin per page; 46-test exit suite proven red at base.
  Integration hardening: nullish now sorts LAST in descending order too
  (the direction multiplier used to flip it), pinned.
- **O4 (SLOs + canaries + status truth) — DEFECTS_FOUND, both fixed
  centrally:** shared/slo.ts + server/services/slo.ts — the four surface
  classes as data with sensors DERIVED or honestly "declared, not yet
  sensed"; persona-journey canary job (reliabilityCanaries.ts, registered
  with a pager lane, demo-org substrate when provisioned / platform-only
  honestly recorded when not) writing synthetic_check_runs; /status renders
  the register + last canary run; error-budget seam reuses the house
  burn-rate math. FIXED (1): the outside-in uptime read scored a 5-minute
  probe against the 60-second worker cadence — a perfectly healthy system
  computed ~20% uptime on the PUBLIC status page; per-source
  expectedIntervalMs now. FIXED (2): raw exception text (err.message)
  reached the public /api/status payload via persisted step details;
  exceptions now stay in server logs and the record carries a fixed honest
  string — authored annotations pass through. Also: job-lane label now
  names the hourly success-sampling so a stale "failed" cannot over-read.
  Second reachability drop earned + locked (651→650).
- Follow-ups ledgered (deliberate): /api/founder/synthetic-checks/recent
  interleaves canary rows with vendor checks (filter or raise limit —
  routes-lifecycle.ts was outside the slice's file set); the brain does not
  yet READ the O4 canaries as a sense (slo_canaries stays honestly unwired
  in the inventory until a future S2 wire); founder telemetry-hub burn
  panel; charter receipts copy could carry per-receipt timestamps.
- Founder queue additions: the P5 "burning error budget pauses Phase work"
  POLICY (O4 built the seam, not the policy); S3 hands + any autonomy
  promotion mechanics remain propose-first per D-5.

## Waves 1/F/X — slice 6 (1.2 error states + F1-s3 + X-A-s1) — ✅ SHIPPED

- **Wave 1.2 (error states + stale-while-error, five doors) — CONFIRMED_GOOD
  by its verifier:** `client/src/lib/stale-while-error.tsx` (getQueryDegradation
  / staleSinceText — refuses to fabricate a time for placeholder data — /
  StaleDataChip role="status" with a real Retry / StaleWhileError wrapper).
  Wired on every door's primary queries: today.tsx no longer blanks eight
  sections on a refetch error with cache present; deals.tsx full-swaps only
  with nothing cached and the aggregates row no longer renders $0 as real on
  hard failure; finance.tsx no longer degrades a hard notes failure into "No
  notes serviced yet" + $0 tiles; maps.tsx queryFns THREW for the first time
  (they had swallowed outages into an empty portfolio); pax.tsx insights
  covered. Exit: doorErrorStates.test.tsx — primitive behavior + a derived
  door pin resolving the five doors through MOBILE_DOORS→App.tsx lazy wiring
  (fail-before proven by stashing). Premise drift recorded: the invalidation
  registry lives in query-keys.ts (not a separate file); Finance door =
  /money shell lazy-mounting finance.tsx; Pax door = /ai routed page.
- **F1 slice 3 (Controls hub) — routes 53 → 48, baseline locked:** keys,
  recovery-console, readiness, legal-readiness, voice absorbed into
  /founder/autopilot/control as tabs (same *Content-export pattern as the
  slice-2 telemetry hub); redirects for every legacy path;
  FOUNDER_ROUTE_BASELINE lowered 53→48 in the same change. The out-of-set
  nav-items/layout-sidebar edits were verifier-confirmed FORCED (the new
  sweep test fails at baseline while those files still emit retired hrefs).
- **X-A slice 1 (abuse spine):** organizations.trust_tier (new →
  established → trusted; schema + migration 0229 + migrate.mjs mirror, honest
  deterministic seed) + orgTrust.ts caps config (NOT enforced — all
  send-chokepoint enforcement founder-queued with
  docs/proposals/x-a-send-chokepoint-caps.md); portal-link expiry (410
  portal_link_expired after email match — no token oracle; NULL fail-open)
  with crypto-strong rebind; "Report this page" on the borrower portal →
  native abuse_report decisions-queue item in one hop.
- **Every verifier catch fixed centrally before commit (3 blocking, 3
  should-fix, 4 notes):** (1) BLOCKING abuse-report limiter bypass — the
  token-keyed bucket trusted attacker-supplied tokens (fresh bucket per
  request ⇒ ~18k rows/hr); now dual-gated with an IP-keyed limiter (30/hr)
  composing with the 5/hr token bucket, pinned. (2) BLOCKING res-status-raw
  ratchet 500>499 — raw res.status(202) → res.json, count back at 499.
  (3) BLOCKING reachability +3 — orgTrust's tier/caps tables un-exported
  (observable only through the resolvers), suite rewritten accordingly,
  count back at 652. (4) Non-idempotent trust-tier seed — the activity
  window is now CLOSED ([2026-07-11, 2026-08-10]) in both artifacts, so
  deploy re-runs can never silently promote (last_active_at only moves
  forward); false idempotency claims corrected everywhere, pinned.
  (5) Expiry-without-reachable-refresh lockout — new services/portalLink.ts
  shared rebind core; financeAgent now ensures liveness (rotate-if-expired +
  revoke) before embedding a portal URL in any notice, so the legacy 90-day
  sunset can never strand a serviced borrower and legacy Math.random tokens
  rotate out organically; pinned. (6) Controls/telemetry hubs used
  uncontrolled Tabs — palette/sidebar links to a sibling tab of the same
  pathname visibly did nothing; both hubs now URL-controlled both ways
  (founderHubTabs.test.ts). (7) use-properties.ts swallowed failures into a
  successful [] under the shared /api/properties key, defeating the Map
  door's honesty from outside (outage-as-empty-portfolio via cache); now
  throws, all 8 consumers audited null-safe, hook-honesty pin added.
  (8) maps deals-mode hard error now passes the actual deals error.
  (9) null-pagePath abuse reports never deduped (SQL `= 'null'` vs IS NULL);
  branch fixed at both layers, pinned. (10) TTL asymmetry (365-day mint
  default vs 90-day tier TTL) documented in the caps proposal as a founder
  decision point.
- **Founder queue additions (X-A, propose-only):** per-recipient frequency
  ceilings at send chokepoints; wedge velocity caps + per-recipient dedupe
  on the platform mail lane (interacts with the 0.8 mail-lanes ruling);
  payment-method-to-exceed-wedge; signup friction ladder; complaint-driven
  tier demotion; suspension ladder; portal-link TTL policy (mint-vs-rebind
  asymmetry). All in docs/proposals/x-a-send-chokepoint-caps.md.
- Known follow-ups (deliberate, ledgered not shipped): lender-side "Refresh
  portal link" control on the note surface (self-serve UI for the rebind
  endpoint); auxiliary badge queries still degrade silently (pax usage/
  health chips, /api/avm null-on-!ok conflation — strongest next candidate);
  importer-less default PageShell wrappers on absorbed founder pages
  (mirrors slice-2 precedent) await a wrapper-deletion pass.

## Waves F/1 — slice 5 (F2-s1 + W1.1 + dead-token sweep) — ✅ SHIPPED

- **F2 slice 1 (one decision queue):** the two decision inflows living only
  on deep surfaces — pax appeals awaiting verdict, recourse drafts — now
  MIRROR into the decisions door as presence+link cards (adapter, not
  migration: deep stores stay the system of record; cards carry
  actionPayload:null, self-resolve when the deep surface disposes, never
  double-list, never overwrite a resolved card). Reasons-on-disposition:
  every door verb accepts an optional reason riding the existing
  founder_modification column (no migration; legacy founderOverrideAction
  semantics untouched — all 13 readers verified zero-diff).
- **W1.1 (invalidation house pattern):** invalidation-registry (entity →
  key families, every key DERIVED from real client usage — the test greps
  the codebase and rejects invented keys), invalidateRelated helper adopted
  at the top mutation sites, and useOptimisticCreate with the create-lead
  exemplar — the Wave-1 exit line "create-lead visible on Today instantly"
  is real (optimistic insert into flat/paginated/infinite caches, snapshot
  rollback on error, temp-row reconcile on success).
- **Dead-token sweep:** bg-acr-success (+ acr-error/danger/primary/info
  aliases) resolved to NOTHING — green/red states rendered colorless in ~12
  files and chartPalette referenced a nonexistent var (plus a real
  hsl(var()) unwrap bug on raw-hex vars). Swept onto the REAL tokens with
  every site read (no semantic flips); deadTokens.test.ts now parses the
  tailwind acr group + CSS vars and fails CI on any future dead token.
- **Verifier catches, both fixed centrally at the prescribed altitude:**
  (1) the mirror-refusal guard was route-only — founder-chat's
  approve_decision/reject_decision tools called the service directly and
  could mark a mirror approved while the customer's real row stayed open;
  the guard now lives IN the service verbs (MirrorDispositionError naming
  the deep link; defer exempt; chat callers surface it as an honest tool
  failure) with a derived pin. (2) useOptimisticCreate's insert
  prefix-matched FOREIGN caches (a lead row landed in a score-history
  array); inserts now require the exact key or a registered list-variant
  marker, pinned with the audit's own reproduction case.
- Gate manifest regenerated (token sweep touched an estate-pinned test).
  No baselines moved; all three gates (check + test + build) green.

## Waves G/O/F + Wave 1 — slice 4 (G1.4 + O5-part + W1.6) — ✅ SHIPPED

**Wave G's G1 is now COMPLETE** (G1.1–G1.4); G2/G3 wait on customers.
Incident note: this fleet's verify phase was killed silently by a worker
restart (~4.5h stall, caught by the founder's "Are we stuck?"); recovered
via workflow resume (cached builds + live verifiers), and every fleet now
arms a fallback self check-in so a dead notification can never idle the
program again.

- **G1.4 (provable claims):** `shared/governance/public-claims.ts` — 17 rows
  (10 derived VERBATIM from constitution code-invariants, prose-only ones
  excluded; 7 curated), every row's enforcement pointer resolves; rendered
  as /transparency#proof in every page state; `marketingClaims.test.ts`
  walks landing + /for copy against real caps ("unlimited X" fails wherever
  a cap exists — red-first proven) and pins the pricing five-letters number
  to the enforced constant. Verifier catch fixed: the one claim that
  misdescribed its own mechanism ("imported" → "test-pinned", on the page
  whose premise is mechanism precision).
- **O5-part (severity SLAs + grounded deflection):** P0/P1/P2 classification
  at ticket creation (P0 = broken+money/send ⇒ spine page 30m/4h; P1
  same-day; P2 48h); escalations carry class + deadline into the founder
  queue (riskLevel/urgency overlays, deadline clocked from ticket CREATION,
  never reset at escalation); the resolver's system prompt gains the
  structural grounded-sources-only constraint (cite KB/org-state/history
  tools or escalate — never guess), pinned derived. CONFIRMED_GOOD outright.
- **W1.6 (tool hygiene):** duplicate-verb dedupe (schedule_follow_up folded
  into its surviving sibling; executor arm kept VERBATIM for persisted
  tool_calls replay; aliases mapped); per-context capability scoping seam at
  the executive's tool-list builder (PAX_TOOL_SURFACES, default-deny for
  unknown tools, pax_subagent wired at the real recursion site; seeded to
  today's truth so behavior is unchanged); `paxToolRegistry.test.ts` (11
  derived pins incl. a dated, reasoned duplicates allowlist — real product
  decisions deferred, not silently blessed). CONFIRMED_GOOD outright.
- **Slice-3 defect surfaced by this slice's audit, fixed at ROOT CAUSE: the
  build was broken at HEAD.** TWO sitemap generators wrote one artifact with
  contradictory policies; slice 3 regenerated with the WRONG one (the .ts
  twin build.ts explicitly documents as the known-bad generator), so `npm
  run build`'s canonical --check failed. Fixed: the canonical
  scripts/generate-sitemap.mjs taught the 17 real new routes (+
  /transparency, never sitemapped though routed); committed sitemap
  regenerated canonically (47 URLs; noindex'd /compare/* correctly EXCLUDED
  per canonical policy — slice 3 had wrongly re-listed them); the .ts twin
  DELETED; sitemapContentRoutes.test.ts rewritten (not deleted) against the
  committed artifact + canonical --check, now also pinning
  one-artifact-one-writer and the /for slug registry sync. PUBLIC_ROUTES
  /compare rows annotated with the sitemap-exclusion policy.
- Integration also: gate manifest regenerated (public-claims.ts joined the
  estate — 34 pins); a /why duplicate my own PUBLIC_ROUTES edit introduced
  was caught by the derived duplicate-path test and removed.

- **G1.3 (/for/<vertical>):** one template page rendering PURELY from
  BUSINESS_TYPES + VERTICAL_ONBOARDING; all 15 kebab-case slugs enumerated
  into the public-route pipeline (sitemap/prerender pick them up); no
  beta/maturity treatment (D-4); derived forVerticalRoutes.test.ts mirrors
  the live-registry pattern. CTA → the demo entry.
- **G1.2 (public demo org):** /demo mints a 2h cookie-scoped session against
  a founder-designated org (DEMO_ORG_ID) — honest not-provisioned state when
  unset (never a fake org); seeds via the ONE sample-data path; refuses a
  non-free org (billing never silently edited); enforces org simulationMode.
  App-wide read-only guard (mounted before all routers): every mutating verb
  from a demo session → 403, workspace snapshot serves ONLY sample-marked
  rows, funnel stays clean by composition with G1.1's recorder guard. PROD
  provisioning of the org row = founder/ops step (queued).
- **X-B scaffold (domain truth):** statuteRegister entries gain optional
  travel-together sourcing fields {primarySourceCitation, retrievedAt,
  verifiedBy, confidence} — ZERO invented citations (all 31 rows honestly
  unverified at ship; verified status requires licensed-professional per the
  register's own rule); claims-without-primary-source ratchet baselined at
  31, down-only; `sourcingGateForComputation()` refuse-not-compute seam with
  consumers pinned (register consumers at HEAD are display/registry-only —
  the seam is pinned so the FIRST deadline/money automation must pass
  through it); coverage endpoint + Story surface the sourcing state. Actual
  row verification = founder-queued (licensed spot-check for money/deadline
  rows).
- **Verifier catches, all fixed centrally:** demo-entry mutation lacked
  invalidation (eslint ratchet); the demo guard silently 403'd the
  marketing-touch beacon for the cookie's whole life — darkening the
  acquisition funnel for exactly the visitors the demo converts (exempted +
  pinned); sitemap regeneration dropped /terms/history (a ToS §16 promise)
  and the sitemap-notes crawler feed because committed artifacts had drifted
  ahead of the generator — both enumerated at the source so regeneration can
  never strip them again; case-shifted /API/ paths could skip the guard
  (lowercased + pinned); footer grid orphan-wrapped its new fifth column
  (auto-fit).
- Manifest regenerated post-X-B (statuteRegister is estate). No baselines
  raised; no new founder routes; five doors untouched.

## Waves G/O/F — slice 2 (F1-s2 + O2-buildable + O3 + F5-lite) — ✅ SHIPPED

Same fleet protocol as slice 1. Three of four verifiers returned
CONFIRMED_GOOD outright; O2's one catch (the earned tablesNoReader drop not
locked) was fixed centrally. No estate files moved — no manifest regen needed.

- **F1 slice 2 (observability hub):** the six observability routes
  (telemetry, traces, pax-traces, pax-calibration, ai-observatory, event-log)
  folded as tabs into ONE `/founder/admin/telemetry` hub mirroring the costs
  hub (existing page components imported as tab content, internals untouched;
  ?tab= deep links validated). Legacy paths ride the slice-1 catch-all map
  with tab pins; `composeFounderRedirect` fixes the old query-concatenation
  bug. `FOUNDER_ROUTE_BASELINE` 58 → **53** (down-only, earned).
- **O2-buildable (backup proof trail):** `/api/jobs/health` now returns the
  latest `backup_verified` row — the table's FIRST reader, closing F-13-3
  (write-only proof was a black hole); Controls-door section renders it with
  the honest tone ladder (skipped_config ⇒ dormant amber, never green; only a
  verified row ≤~8 days renders ready). `drDrillFreshness.test.ts`: the
  dr-drill ledger's dated blocks gate freshness ≤100d once the FIRST drill
  lands; zero blocks pins the honesty posture instead of failing forever
  (drill execution stays in the founder queue). tablesNoReader locked
  58 → **57**.
- **O3 (runbook link-lint):** `scripts/check-runbook-links.mjs` in the check
  chain — every repo path in docs/runbooks/ must resolve; drill claims must
  cite a dated ledger block (grammar derived from the ledgers' own formats);
  dated, reasoned allowlist. The six pre-existing dangling pointers FIXED to
  reality (not fabricated into existence); the verifier reproduced the
  pre-fix defects against HEAD to prove the gate catches them. Top-5
  runbooks-to-verified (last-walked dates) is founder work, noted not faked.
- **F5-lite (governance visibility):** founder-gated
  `/api/founder/governance/coverage` — a pure read of CONSTITUTION +
  STATUTE_REGISTER (registries untouched, still tamper-pinned); the Letter
  gains the "rules that are code" KPI row (12/14 invariants enforced, 2/31
  statutes reviewed at ship time — all derived, zero hardcoded counts); Story
  gains the governance tab (enforcement kinds labeled honestly,
  strong-vs-weak, unreviewed statutes badged). Story is now a governance
  reader — F5's first step.
- **Ledgered observations from verifiers:** `bg-acr-success` is a DEAD token
  repo-wide (12 files incl. this slice's convention-following uses; the real
  green is `acr-pos`; chartPalette references the nonexistent var) — a
  one-sweep fix candidate for Wave 1's polish pass. Playwright specs
  referencing legacy founder paths ride the catch-all (low risk, noted).
- **Deferred:** O2's founder ask unchanged (the drill itself); O3's
  runbook-walk dates (founder); F5 full unification + brief-exit-test +
  Solene enqueue gate (later F5 slices).

## Waves G/O/F — opening slice (F1-s1 + F3 + O1 + G1.1) — ✅ SHIPPED

Built as a four-fixer fleet with exclusive file sets, each adversarially
verified by an independent agent, then integrated centrally. All four
verifiers confirmed the implementations real; their five cross-item
integration defects were all fixed centrally before commit:

- **F1 slice 1 (founder redirect collapse):** the 24 redirect-only `/founder`
  route registrations collapsed into ONE catch-all resolving a
  `FOUNDER_LEGACY_REDIRECTS` map (wouter RegExp route, query-preserving);
  5 server emitters + client literals rewritten to canonical four-door paths;
  `FOUNDER_ROUTE_BASELINE` 82 → **58** (the scout's 59 was off by one —
  verifier-recounted). New `founderLegacyRedirects.test.ts` (map targets must
  be real registered routes; no legacy literal anywhere). Integration fix: the
  SECOND independent pin of the route count
  (`founderReadinessLadderPlacement.test.ts`) went red — now SINGLE-SOURCED
  from the ratchet baseline (two copies of one number is how it went stale),
  with its down-only ≤82 history kept as its own assertion.
- **F3 (eternal lines):** constitution hard-stop `self-patch-never-merges`
  (code-invariant, unenforced-baseline stays 0) + `selfPatchCannotMerge.test`
  (merge-token sweep over autopilot/, GitOps surface pinned exactly,
  two-file git-add allowlist pinned; GitHub-side credential separation
  honestly stated as founder residual, not claimed); `FORBIDDEN_SUBSTRINGS`
  widened to the gate estate (ratchets, ratchet evaluator, statuteRegister,
  tests/unit, all workflows); `gateTamperWatch` — 33-file SHA-256 manifest
  over the gate estate, 6h critical job (pages via the 0.9 matrix +
  experience-log row), manifest regenerated ONLY by
  `scripts/regenerate-gate-manifest.mjs` (reviewable diff). Integration fix:
  manifest regenerated LAST after all estate-touching items; roster comment
  de-numbered (two stale counts in a row — parity lives in
  jobRosterCoverage).
- **O1 (dated obligations):** `datedObligations.ts` registry (vendor
  credentials + statute governance reviews; ONLY known dates —
  refuse-not-fabricate; statute rows derive `nextReviewDue = reviewedAt+365d`
  as declared policy), step-away + founderBriefing generalized onto it,
  integration-time renewal lint (every apikey/oauth connector needs a row or
  a REASONED dated allowlist entry — most are customer-BYO, reasoned so),
  Controls-door year view (never-green grammar). Integration fix: the thin
  vendorCredentialExpiry adapter had ZERO production consumers (module
  orphan, +4 reachability) — DELETED, its F-18-1 invariants rewritten against
  the registry of record; reachability locked 654 → **652** (G1.1 also wired
  the two sample-marker constants).
- **G1.1 (activation truth):** `activationEvent` declared on all 15 core
  verticals (D-4); two missing events minted + wired at their real seams
  (rent-roll reconcile, tax-worksheet scoring); the recorder now REFUSES
  sample-marked entities (`sampleMarkers.ts` lifted from the seeder); the
  growth agent's funnel repointed from the non-canonical
  `user_activation_events` to canonical `activation_events`; derived
  `registryActivation.test.ts` (every vertical's event ∈ ACTIVATION_EVENTS,
  every declared event has a real emitter, recorder refuses samples).
  Integration fix (verifier catch): the two campaign emitters
  (email/SMS `first_mailer_sent`) fired off pure sample recipients — both now
  gate on at-least-one-REAL-recipient.
- Verified-by: four adversarial verifier reports (each re-ran suites incl.
  co-located; two ran full isolation worktrees to attribute cross-item
  effects) + central integration suites (85/85) + full gates on the combined
  tree (evidence in the commit).
- **Approval queue:** nothing new — no send lane, no hard-stop domain; both
  ratchet moves DOWNWARD (route baseline 82→58, reachability 654→652).
- **Deferred within these items (next slices):** F1 slice 2 (observability →
  /founder/admin/telemetry hub, −5); G1.1 residue (un-threaded
  `first_seller_response` seam — sample leads carry 555 numbers, negligible;
  `first_letter_sent` paid-lane guard), G1.2 demo org, G1.3 /for/<vertical>;
  O1 founder ask (unknown dates: insurance/domain/DKIM/vendor terms); F5-lite
  governance coverage endpoint; O2/O3 buildable parts; X-B scaffold.

## Wave 2 / egress — slice 12 (click-to-identify + cache provenance) — ✅ SHIPPED

**Shipped at `073e503`.** Two lanes, both adversarially audited. Gates verified
in a separate step: check 0 · test 0 (11,671 passing) · build 0. Gate-tamper
manifest regenerated last; only delta is the `table-count.json` hash.

**Wave 2.3 — founder-approved ratchet raise.** `table-count` 756 → **757**,
locked in the same commit as the code, reasoning in the ratchet's own
`lastBumpNote`. This is the first baseline RAISE of the program and it went
through the proposal path rather than around it
(`docs/proposals/wave-2.3-tracked-parcels.md`): I refused to raise it myself,
wrote the proposal with the alternative stated (ship identify-only, defer
tracking), and the founder approved Option A in-session. `parcel_alerts` and
`saved_views` were checked first and rejected for cause. Reachability held at
baseline on all four counts, so the new table has a real reader and writer.

*Its audit returned three blocking defects with one root cause* — the client
dropped the geographic context and the server never rebuilt it: the coverage
branches were **unreachable in production** (and inverted — a customer inside a
covered county was asked to request coverage for it); the APN path returned
**another county's parcel as a confident exact match**; and the point path was
predicates AND truncation, so a parcel we genuinely hold could render as "we
could not identify a parcel" — a fabricated negative that only appears once
coverage gets good. All fixed. Also: a toast naming a tracked list that does
not exist; an unwired `GET /api/tracked-parcels` + reader **removed** rather
than shipped; an FK action omitted in Drizzle but present in both DDL artifacts
(no ratchet compares FK actions); a test mock more permissive than its SQL.

**Egress follow-ups.** Blocking: **all 21 broker-backed MCP tools returned
`data: null` on a cache hit** — not the 8–9 the builder scoped. The broker
stamped `title: "Cache"`, the chokepoint correctly withheld on unresolvable
provenance, and since the cache is written on every success and read for 30
days, that was the *normal* production path. Origin now resolves back from the
cached row's `data_source_id`. Plus two pins that did not pin (an archive CSV
could bypass licence screening with all tests green; the README licence carrier
could be deleted silently).

**Rewrite-not-delete, again:** one stale pin went red because the county now
resolves. The invariant it protected — never present a far-away parcel as the
one tapped — is what the new assertions check, plus a new case pinning that a
tap with nothing cached nearby still refuses to name a county.

### 🔴 INCIDENT — two container restarts, and what they cost

Fleet 12b died mid-run (restart #2), then the replacement F2 verifier died too
(restart #3). Journal and scratchpad survived both; **the remote is the only
durable state** — that lesson now has three data points.

What the restarts nearly cost is the point: fleet 12b's F2 lane finished its
BUILD but its audit never ran. Under the slice-8 standing lesson that lane does
not merge, so I re-dispatched the audit twice. It eventually returned **two
blocking findings** — see below. Had the "builder finished, tests green" signal
been taken as sufficient, both would have shipped.

Diagnostic refinement worth keeping: the three-signal liveness test produced a
**false positive** — a verifier working in a locked isolation worktree shows a
frozen journal AND no main-repo writes, two of three death signals, while
perfectly alive. The corrected test requires no writes in the repo *and* in any
locked worktree, with `TaskOutput`/`ListAgents` as the decisive signal.

### F2 slice 2 — ✅ SHIPPED at `977e170` (slice 12b), both blocking findings closed

Parked out of `073e503` rather than shipped unaudited, then fixed and shipped
once the audit landed. Gates verified separately: check 0 · test 0 (**11,702**
passing) · build 0. Manifest regenerated last.

**Both blocking findings were the same class in opposite directions — a surface
asserting what the code had not established.** That is now eight slices running.

1. **Fixed — a machine send is no longer recorded as a founder review.**
   `approvePendingHand` takes a **required** `via: "founder_tap" |
   "witness_grant"` (required rather than defaulted, because the default *was*
   the bug), and the delegated path resolves as `auto_resolved` /
   `witness_grant_delegated`. `approvedBy` had carried the truth all along and
   nothing read it. Second instance of the same class, also fixed: tapping
   Approve on an expired draft recorded a founder *rejection* — the founder
   tapped approve, the draft aged out.
2. **Fixed — the queue is now actually ranked.** `needsYou` sorts by
   `urgencyScore` with a recency tiebreak, so a frozen refund drafted yesterday
   outranks a marketing email drafted this morning. The rank had been computed,
   tested, and stored — and never applied, while the page said "nothing
   outranks it silently".

Also fixed: the rank derives from the registry's `movesMoney` rather than a
hardcoded hand-name map (an eighth money hand would have ranked beside a
marketing email, silently, forever); the mirror row gets its own do-nothing
sentence; the unconditional presence claim is now conditional; the summary
strip names the deliberate double-count instead of hiding it.

**Three pins rewritten, not deleted** — and one of them is the lesson of this
slice: a call-**count** pin proved every disposition resolved *something* and
nothing about *what was written*, which is exactly how both blocking defects
stayed green through a full suite. Counts are one-directional; shape assertions
replaced it.

*Historical record of what the audit found (the two items above, as reported):*

1. **BLOCKING — a delegated auto-witnessed send is written into the founder's
   audit trail as a founder tap.** `autoWitness.runAutoWitnessSweep` calls the
   same `approvePendingHand` a founder tap uses, and `resolveMirrorItem`
   hardcodes `resolvedBy: 'founder_deep_surface'` — so a refund the machine sent
   under a standing grant *while the founder was away* files under "You
   reviewed", and the "Auto-handled" bucket never sees it. The false sentence
   then lands in `founderModification`, which `decisionLogRag` ingests into the
   model-read corpus. `input.approvedBy` is in scope and carries the truth.
2. **BLOCKING — the lane's stated purpose is undelivered.** It exists because
   the witnessed-send section is "newest-first and disconnected from severity".
   It computes ranks, tests the rank VALUES, writes them to `urgencyScore` —
   and renders them into a queue still ordered newest-first. The rank is
   stored, not applied, while the page tells the founder "nothing outranks it
   silently". Either sort the bucket or delete the claim.

All six should-fix items were also closed (expired-tap recorded as a founder *rejection*;
the rank keyed off a hardcoded hand-name map instead of the registry's
`movesMoney`, so an 8th money hand would silently rank as a customer send; a
do-nothing sentence true of the frozen card but false on the mirror row; an
unconditional presence claim false during quiet hours; a headline count that
double-counts mirrors; a button promising a re-raise the dedupe key forbids).

**Carried to the founder queue from this audit (NOT fixed — pre-existing):** `autonomousDecisionExecutor`
writes `decisions_inbox_items` directly, bypassing the service verbs where
`refuseIfMirror` lives, and its `HARD_STOP_TYPES` is env-driven and empty by
default — pre-existing exposure, not introduced here. Also found and correctly
left alone: `createFromAbuseReport` files a card with no options, so a portal
abuse report cannot be dispositioned on the door at all.

---

## Waves L / R / S — registered, pending (from the addenda packet, 2026-08-11)

Registered in §D on 2026-08-11. Briefs: **§I** (Addendum D → Wave L), **§J**
(Addendum E → Wave R), **§G** (Addendum C → Wave S). Premises re-verified at HEAD
per §A rule 2 before registration — results in drift log **D-6/D-7/D-8** above.
Nothing below has been built yet except where marked ✅.

### Wave L — legal documents & disclosure surface — 📋 PENDING (no Wave 0 dependency; may start anytime)

| Item | Premise check at HEAD | Status / note |
|---|---|---|
| **L1.1** rewrite ToS §6 "Free Trial" | ✅ divergence **confirmed**: `docs/legal/terms-of-service.md:91-95` asserts "you will be charged at the applicable subscription rate unless you cancel"; the product ships a permanent free tier (`shared/billing/tier-limits.ts` — `free \| starter \| pro \| scale \| enterprise`) and `server/middleware/getOrCreateOrg.ts:216` stamps `trialEndsAt` 7 days out, read by `expensiveEndpointGuard.ts:68` for elevated limits. **No charge occurs.** | Ready. Path drift: the addendum credits `pricing.tsx` for `TIER_LIMITS`; it actually lives in `shared/billing/tier-limits.ts` (`pricing.tsx` is the marketing page). A fifth tier (`enterprise`) exists beyond the four named. **Before writing:** verify in code what happens to over-cap records at expiry — do not assert it. |
| **L1.2** re-verify every factual assertion | Not yet run. `server/routes-sub-processors.ts` exists as the live list to reconcile against ToS §18 / Privacy §8. | Ready. Produces a divergence list; product-side divergences become findings-ledger entries, not doc edits. |
| **L1.3** §20 placeholder | ✅ confirmed at `docs/legal/terms-of-service.md:246` — `[To be confirmed upon LLC formation — registered agent address, not founder home address]`. | Ready to draft, **blocked on a founder input**: the real business address. Refuse-not-fabricate — do not invent a mailbox address. Same constant feeds CAN-SPAM footers. |
| **L1.4** narrow ToS §9 to Privacy §3 | Not yet diffed. | Ready. |
| **L2.1–L2.4** new ToS sections | — | Ready to draft. **L2.3 (Automated Actions & Standing Instructions) is a prerequisite for any autonomy above `draft`** — it pairs with R.3.4. |
| **L3** Beta/Early Access Addendum | — | Ready. Product-level beta (pre-GA), **not** vertical beta — see D-8(c)/D-4. |
| **L4.1** disclaimer coverage → 0 gaps | ⚠️ **partly executed already**: `scripts/lint-disclaimer-coverage.mjs` exists, baseline **13**, and was tightened this session to require a rendered `<RequiredDisclaimer` element. Seven types confirmed in `client/src/components/required-disclaimer.tsx:7-13`. | Remaining work = the output-class→type map + driving 13 → 0. Baseline may only go **down**. |
| **L4.2** send-lane disclosures | — | **Coordinates with §D item 0.8, which is founder-queued** (send lane). Blocked on that ruling. |
| **L4.3** consent capture points | `EsignConsentDialog` exists; ToS §17 asserts the flow satisfies E-SIGN §101(c) (`terms-of-service.md:224`) — assertion **not yet verified against the flow**. | Ready; verification precedes any restatement. |
| **L4.4** checkout disclosure | — | Ready; UI flagged for counsel per L.6, not resolved here. |
| **L4.5** beta badging | ⚠️ **premise stale** — D-4: all 15 verticals are CORE. | Re-scoped to product-level beta badging. |
| **L4.6** statute-bearing surfaces | Overlaps Addendum B / Wave X-B (shipped scaffold: `statuteRegister` sourcing fields + domain-truth ratchet). | Ready; attaches to the existing X-B seam rather than a new one. |
| **L5.1–L5.3** drift prevention | ✅ confirmed: `client/src/pages/terms.tsx` **637** lines and `privacy.tsx` **881** lines are hand-maintained mirrors of the markdown — exactly the mechanism that produced the §6 divergence. `LegalDocReadAloud.tsx` and `terms-history.tsx` both exist and must keep working. | Ready; this is the item that stops the class of defect, so it should not be deferred behind the drafting. |
| **L6** counsel packet | `docs/legal/` exists (ToS, privacy, DPA, and others). | Ready. The packet is the deliverable; **do not resolve its questions unilaterally** (L.0). |

**Standing rule for this wave (L.0, binding):** produces a better *draft*, never legal
sign-off. The counsel-required footer stays until it is untrue. Refuse-not-fabricate
applies to law — cite only what is already cited or verifiable against primary sources.
**Drafting in-repo is free; publishing customer-facing legal text needs founder sign-off.**

### Wave R — responsibility hardening — 📋 PENDING (R.1 at Wave 0 priority)

| Item | Premise check at HEAD | Status / note |
|---|---|---|
| **R.0** correction of record | ✅ **verified myself** — see D-7. | **Done as a record.** Handoff banner + §A pointer + 0.8 re-scope all landed this commit. |
| **R.1** mail-path consolidation | ✅ three-path defect **confirmed** (`mailProvider.ts` correct; `lobService.ts:104-106` env-only, no org param; `directMail.ts:92` env-direct; both reachable from `communications.ts`). ⚠️ blast radius is **larger than R.0's table** — see D-8(b), fourteen files touch `LOB_*`. | **📋 FOUNDER QUEUE — send lane (§A rule 5).** Gates safe public signup; pair with R.3.1. **The map R.1.2 asks for largely exists already** — `docs/proposals/wave-0.8-mail-lanes.md` traced the live rail independently and reached R.0's conclusion on its own ("the leak the brief names is real but dormant"; "already BYOK-first on three of the four clients"), and its map is **more complete than R.0's three-row table**: four clients, with the live counterparty rail running `POST /api/outreach/mail/queue` → `mail_shipments` → `flushDueMailShipments` → `MailRouter.route` → `lobAdapter` → `directMailService`, plus three bypassing siblings. **Two independent traces agreeing is the strongest evidence in this ledger.** Finish R.1.2 by extending that map to the eleven extra `LOB_*` files, then write the allowlist from it. |
| **R.2** Attestation Gate primitive | ✅ all three source patterns exist: `client/src/components/AtrGate.tsx` (with a **DB CHECK constraint** backstop — `shared/schema.ts:1591` cites `0099_notes_atr_origination_gate.sql`), `deals/AssignmentPanel.tsx`, `sign/EsignConsentDialog.tsx`. ⚠️ no `attestations` table (only `fcra_attestations`). | Ready — pure construction. The CHECK-constraint backstop is the model: gated actions structurally unreachable, not merely UI-blocked. |
| **R.3.1** CSV import rights attestation | ✅ confirmed: `client/src/pages/data-import.tsx` accepts **50,000 rows** (header comment line 5, copy at 56/153) with **no rights attestation**. | Ready. Highest-value item in the wave. |
| **R.3.2** skip-trace permissible use | — | Ready. |
| **R.3.3** document adoption | `AssignmentPanel` already does this; generalize. | Ready; natural home for the `document` disclaimer type (ties to L4.1). |
| **R.3.4** autonomy grant artifact | ✅ **dependency already satisfied** — Wave 0 item **0.4 (`resolveActionPolicy` at the pending-actions chokepoint) is DONE**. | Unblocked. Also needs **L2.3** in force (the paper side of the same promise). Autonomy-ladder mechanics remain §A rule 5. |
| **R.3.5** dunning arming | ✅ confirmed: `shared/schema.ts:3319` — `autoStart: boolean("auto_start").default(true)`. Debt-collection-adjacent contact beginning by **schema default**. | **📋 FOUNDER QUEUE** — flipping an outbound cadence default. Sweep sibling defaults in the same pass (`pre_authorized_tradeoffs.autoExecute`). |
| **R.3.6** bulk-send friction | — | Ready; the suppression math must be real counts or it is fabrication. |
| **R.4** platform voice | ✅ confirmed: `client/src/pages/blind-offer-wizard.tsx:945` renders "Recommended offer". | Ready. **Founder ruling (2026-08-10) — keep the confident voice.** Add basis line + mounted disclaimer + preserved authorship; the lint is a **coverage** check, not a banned-word list. Do not strip the label. |
| **R.5** statute surfaces + per-user attribution | — | Ready; attribution work pairs with F2's disposition reasons. |

### Wave S — staff & autopilot doctrine — 🟡 PARTLY SHIPPED (after Wave 0 ✅; overlaps Wave F)

Reconciled against what has actually shipped — the packet's registration could not
know this: **S1 + S2 shipped in slice 7** (`04a5561` — charters + autonomy-follows-
perception promotion gating), **S4 in slice 8** (`1c31b94` — scenario library),
**S5 in slices 9–10** (`3f1d47a` conflict memos, `b2e92be` the real emitter).

Remaining: **S3** hands proportional to mandate — **📋 FOUNDER QUEUE** (deploy/rollback
and any send-adjacent hand; pricing stays hard-stopped forever, staff may prepare a memo
and never touch the lever) · **S6** the CEO interrupt contract (shop hours, evening queue,
"what happens if you do nothing", no silent limbo) · **S7** the maturation curve (four
trust ledgers + named milestones). Exit test for the wave stays the **Shop-Day Test**.

---

## Program state (Wave 0 → continuous execution)

- **WAVE 0 COMPLETE** at `4602e15` (0.1–0.7 + 0.9 shipped; 0.8 proposed in
  the founder queue). Every item carried full green gates + an independent
  completeness audit; every audit finding was remediated or explicitly
  ledgered.
- **FOUNDER DIRECTIVE (2026-08-10, in-session): "Work continuously through
  the entire handoff."** The program does not pause between waves. Standing
  rules unchanged: premise-verify every brief at HEAD (repo wins), falsifiable
  exit test per item, independent completeness audit before an item closes,
  founder queue for send lanes / hard-stops / baseline raises / keyed-env
  work, refuse-not-fabricate, doors fixed, D-4 (verticals are CORE).
- **Slice 1 SHIPPED at `0c5eb23`** (F1-s1 + F3 + O1 + G1.1 — section above).
- **Slice 2 SHIPPED at `dd5e85c`** (F1-s2 + O2-buildable + O3 + F5-lite —
  section above). Note for posterity: F3's gate-tamper watch flagged the
  slice's own estate edits on its first full-tree run — regenerated per its
  procedure, the mechanism works.
- **Slice 3 SHIPPED at `f4bec05`**; **slice 4 SHIPPED at `670b1b7`** (G1
  COMPLETE; sections above). Gate set is now check + test + **build** (slice
  3 proved the narrower set can pass on a broken build). Every fleet phase
  carries a fallback send_later timer (the silent-death lesson).
- **Slice 5 SHIPPED at `430db22`** (F2-s1 + W1.1 + dead-token sweep —
  section above; both verifier catches fixed at the service/registry
  altitude before commit).
- **In flight: FLEET 6** (workflow `wf_65969346-088`) building 1.2 (error
  states + stale-while-error primitive across the five doors), F1 slice 3
  (next founder-route cluster toward the four-door end state; baseline
  down from 53), and X-A slice 1 (orgTrustTier spine + portal link
  expiry/rebind + report-this-page → native abuse_report queue item; ALL
  send-chokepoint enforcement deferred to the founder queue with a
  written proposal). Same protocol: exclusive file sets, adversarial
  verifiers in isolated worktrees, central integration, manifest regen
  last, full three gates before commit. Fallback timer armed.
- **Slice 6 SHIPPED at `6c919ed`** (1.2 error states + F1-s3 Controls hub
  48 routes + X-A-s1 abuse spine — section above; all ten verifier catches
  fixed centrally pre-commit; survived a container restart mid-gates with
  the check result carried and test+build re-run clean).
- **Slice 7 SHIPPED at `04a5561`** (Wave S S1+S2 staff charters +
  promotion-follows-perception, 1.4 EntityTable kit, O4 SLOs/canaries —
  section above; both O4 defects + four hardening notes fixed centrally;
  one vitest worker-teardown flake re-run to a clean green before commit.
  Ops note: a container restart rolled the LOCAL clone back two commits
  after the push — the remote was intact; recovered by fast-forward, no
  work lost. Pushes are the only durable state; commit early.)
- **Slice 8 SHIPPED at `1c31b94`** (S4 + 1.3 + 1.5 — section above). Two fleet agents
  died mid-run on credit exhaustion; the missing audits were re-run as
  fleet 8b and found 2 blocking defects (a Today affordance that lied about
  what it did; settings status rows passing platform credentials off as the
  org's own) plus 15 more. All fixed centrally and pinned before commit.
  **Standing lesson added:** a lane whose BUILDER dies still gets its
  adversarial audit before merge — passing typecheck and its own test is
  not evidence, and in this case the audit was the only completeness record
  that ever existed for the settings decomposition.
- **In flight: FLEET 9** (workflow `wf_a37737ac-4c2`) building O6 (the
  unit-economics RECEIPT in the Letter + infra-curve panel — the engine
  `server/services/unitEconomics.ts` already exists, so the gap is the
  surface and the honesty of what it says), O7 buildable (deputy
  break-glass kit + freshness ratchet mirroring drDrillFreshness +
  continuity statement on /transparency, every public claim registered in
  public-claims.ts or not made), and S5 buildable (two-position conflict
  memos as NATIVE decisions-queue items riding slice 5's reasons rail;
  repeat resolutions surface a standing-order PROPOSAL, never an automatic
  policy write). Verifiers are briefed on the last two slices' blocking
  defects as the fabrication pattern to hunt. Fallback timer armed.
- **Slice 9 SHIPPED at `3f1d47a`** (O6 + O7 + S5 — section above). Three lanes, 3
  blocking + 10 should-fix, all fixed centrally and pinned. **The pattern,
  now three slices running: the defects that matter are surfaces asserting
  what the code has not established** — a public page claiming a review
  practice it never had, a toast claiming a memo applied something, twelve
  red readiness rows in an environment that cannot read the file, a margin
  verdict on months-old arithmetic. None are visible to typecheck, lint, or
  the lane's own suite. The adversarial audit is the only thing that finds
  them, which is why it is not optional.
- **In flight: FLEET 10** (workflow `wf_2651deef-a09`) building S5's
  EMITTER (the derivation slice 9 deferred: build both charter positions
  from real move/charter/sense state, file at the council seam gated on
  deliberated + contested, idempotent per fingerprint, and file NOTHING
  when the top moves do not map to a registered contention), F1 slice 4
  (next founder cluster; 48 routes, 44 top-level pages, /founder/admin
  holds only costs+telemetry), and X-A slice 2 (abuse SIGNALS + a
  founder trust panel labelled proposed-not-enforced — no cap enforced,
  no automatic tier write, since the caps proposal is unruled). All three
  verifiers are briefed on the three-slice fabrication pattern with the
  five real examples. Fallback timer armed.
- **Slice 10 SHIPPED at `b2e92be`** (S5 emitter + F1-s4 + X-A-s2 — section above).
  Founder routes 48 → **44** (F1 s4's new /founder/admin/agents hub),
  baseline locked. Five slices running, the blocking defects are ALWAYS
  founder-facing sentences over-claiming: this time a dollar figure
  labelled as more than it measured, and — the sharpest one yet — a
  fabrication inside a NEGATIVE claim ("nothing records an export" when
  export_jobs does), which the exit test had PINNED rather than caught
  because it checked source truth in only one direction.
- **In flight: FLEET 11 — WAVE 2 OPENS** (workflow `wf_2b592c37-a16`):
  2.5 the LICENSE-AWARE EGRESS CHOKEPOINT (the wave's highest-value item —
  a `redistributable:"no"` field must not be able to leave through export,
  public parcel report, market reports, MCP tool results or webhooks;
  field→provenance DERIVED from the providers' own declarations, fail
  CLOSED on unknown, and a thinner artifact must SAY it was thinned),
  2.4+2.6 the provenance/freshness grammar + disclaimer-coverage lint
  (composing with slice 6's stale-while-error chip, not forking it), and
  2.1 map M0 groundwork (premise-check WHICH engine renders today — both
  maplibre-gl and mapbox-gl are in package.json — then a basemap source
  indirection with correct attribution; NO paid vendor, no faked
  self-hosting). Verifiers briefed on the five-slice fabrication pattern
  INCLUDING slice 10's negative-claim instance. Fallback timer armed.
- **Slice 11 SHIPPED at `23d052b`** (Wave 2 opens — section above). Ratchet moved DOWN
  and locked: advice surfaces missing a disclaimer 15 → **13** (earned,
  after the detector was sharpened and three surfaces were covered).
- **Deferred honestly, named not papered over:** the DSAR export
  (`exportUserData` ships `deals.enrichmentData` unscreened), the
  `/api/export/everything` ZIP built in migrationJobs.ts, and the MCP
  broker-backed `declaredSource` path are egress-adjacent and outside this
  slice's file sets — carried as the next egress slice's work rather than
  claimed as covered.
- **In flight: FLEET 12** (Wave 2 remainder + egress follow-ups): 2.3
  click-to-identify → inspector → "Track this parcel" → quick actions
  (M1, on the county data the product already holds — 2.2's licensed
  PMTiles fabrics need a county-licence decision and a tiling pipeline,
  so they are NOT assumed here), the three NAMED egress follow-ups (DSAR
  export ships `deals.enrichmentData` unscreened; the
  `/api/export/everything` ZIP in migrationJobs.ts; the MCP
  broker-backed `declaredSource` path with no production caller), and F2
  slice 2 (the next decision inflows — 2 of 7 merged so far). Fallback
  timer armed.
- **After fleet 12:** Wave 2's 2.2 (county fabrics — gated on the
  licence/tiling decision), Wave 3 depth-per-vertical per §D, F2
  remainder, X-A slice 3 (post-ruling). G2/G3 wait on customers; founder
  queue unchanged. S3 hands / promotion mechanics stay propose-first
  per D-5.
- **ADDENDA D & E INTEGRATED 2026-08-11** (docs-only; landed while fleet 12
  ran, touching no file the fleet holds). §I/§J appended after the reference
  body, WAVE L + WAVE R registered in §D, Wave S reconciled rather than
  duplicated, and the **R.0 correction of record** recorded three ways: drift
  log D-7, an inline supersession banner on Part 3 §2.4, and a re-scope of §D
  item 0.8. Premises re-verified at HEAD first (§A rule 2) — five drifts logged
  as D-8, of which the load-bearing one is that R.1's blast radius is fourteen
  files, not the three in R.0's table. **Do not execute the Part 3 §2.4
  remediation.** New pending-wave section above carries per-item premise checks;
  three new founder-queue entries (8/9/10) carry what I will not decide.
- A session resuming from this file mid-program: read the newest wave section
  below, finish its in-flight item with the same discipline, and continue down
  the §D sequence. The founder queue is the only place items wait.
