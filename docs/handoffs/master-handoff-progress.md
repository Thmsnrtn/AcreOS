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
   the committed spec.
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
- **In flight: FLEET 7** building Wave S S1+S2 (charter registry derived
  from the REAL trust ledger/senses/hands wiring + charter cards in the
  Controls hub + promotion-follows-perception gate + Letter blindness
  lines), Wave 1.4 (EntityTable kit + the five list migrations), and O4
  (SLOs per surface class + synthetic canaries wired into the EXISTING
  /status page). Same protocol; fallback timer armed.
- **After fleet 7:** S4 scenario-library matrix, 1.3/1.5, F1 slice 4+,
  O6/O7 buildable parts, X-A slice 2 (post-ruling), then Wave 2 per §D.
  G2/G3 wait on customers; founder queue unchanged. S3 hands / promotion
  mechanics stay propose-first per D-5.
- A session resuming from this file mid-program: read the newest wave section
  below, finish its in-flight item with the same discipline, and continue down
  the §D sequence. The founder queue is the only place items wait.
