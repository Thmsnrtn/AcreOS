# Master Handoff — progress ledger

*Maintained per the handoff's STATE & REPORTING rule. Any future session resumes
from this file, not from memory. Updated every working session.*

**Branch:** `claude/acreos-audit-2026-08-4l2rlu` · **Base at session start:** `016c619`
(Wave 5 merged — all 15 verticals core).

---

## ⚠️ Drift log (repo-at-HEAD vs. the handoff, which was written 2026-08-08/09)

| # | Drift | Consequence |
|---|---|---|
| D-1 | **RESOLVED 2026-08-09.** The master handoff document was absent from the repo at session start (not tracked or untracked anywhere). The founder supplied it in-session; it is now committed in full (§A–§G including all six reference parts) at `docs/handoffs/acreos-master-handoff.md`. | Wave 0 items 0.1–0.9, Waves 1–6, G/O/F/X are now enumerable. Program unblocked. |
| D-2 | **Item 0.2's headline premise is stale — the F-18-1 fix already shipped** in the remediation continuation batch (2026-08-06, `REMEDIATION.md` item 3): `server/services/vendorCredentialExpiry.ts` (registry seeded ATTOM `2026-08-28`), milestone paging in `sendDailyBriefing` (warn T-14/T-7, critical page ≤T-2 via `alertSpine`), and the `vendor_credentials` step-away readiness check. All verified wired at HEAD (scheduler → `runScheduledJobs.ts:1146`). | 0.2 re-scoped from "build it" to "verify at HEAD + close the enforcement gap" (below). |
| D-3 | The audit's F-18-1 **"Gate it"** (sole-source ⇒ expiry-row invariant) was NOT part of the shipped fix — no `vendor-expiry` ratchet existed and the unit test didn't derive from the sole-source allowlist. | Closed this session (see 0.2). Built as a **derived set-invariant test**, not a count ratchet — per `99-master.md:228`'s over-build dissent and the repo's derived-test preference. |

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
### 0.7 — MCP server dark/per-org allowlist; hashed-key auth; shared-store rate limit — pending
### 0.8 — Mail lanes (`lobService` → `resolveProviderCredential`, purpose lanes, wedge cap, `mailProviderLanes.test`) — pending · **SEND LANE: propose-don't-merge (§A rule 5) — goes to founder approval queue before merge**
### 0.9 — Critical-job-failure pages (F-13-1 shipped — verify) + pager-matrix-as-data ratchet + external watchdogs armed (F-18-2) — pending

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
5. *(anticipated)* **0.8 mail lanes** will enter this queue when built — it is a
   send-lane change (§A rule 5: propose, don't merge).

## Next item up

- **0.7**: MCP server hardening — founder-flag dark or per-org allowlist,
  migrate auth onto the hashed Data-API key infra (retire the slug-derived
  token fallback), shared-store rate limiting (in-memory dies per-machine on
  the 2-node deploy). Verify premises at HEAD first (`server/mcp-server.ts`).
  Then 0.8 (build but do NOT merge — founder queue) → 0.9.
