# Wave 0.8 proposal — physical-mail purpose lanes (SEND LANE: founder approval required before implementation merges)

*Status: PROPOSED (§A rule 5 — send-lane changes are proposed, never merged
unilaterally). Premises verified against HEAD `6aa2fc4` on 2026-08-10; the
verification was independent (a fresh agent, claims-as-hypotheses) and its
full report is condensed here. Implementation follows this spec in a
follow-up session once the founder rules on the two decision points below.*

## Premise drift — the brief targets dead code

The handoff (§D 0.8, Part 3 §2.4 "the one send rail still re-fronted") names
`lobService.ts` → `resolveProviderCredential`. At HEAD:

- **`lobService.ts` is unreachable dead code.** Its only importer is
  `communications.ts`, whose two direct-mail methods have zero external
  callers (`sendToLead` dispatches email/sms only). It is also the ONE Lob
  client with no org-credential path (env-key singletons, no organizationId
  anywhere) — the leak the brief names is real but dormant.
- **The LIVE counterparty rail** is `POST /api/outreach/mail/queue` →
  `mail_shipments` → `flushDueMailShipments` → `MailRouter.route` →
  `lobAdapter` → `directMailService`, plus three siblings that bypass the
  route: `sequenceProcessor.sendDirectMail`, `POST
  /api/campaigns/:id/send-direct-mail` (via `directMail.ts`), and the
  autopilot `send_letter` hand (via `mailProvider.ts`). Credentials are
  already BYOK-first on three of the four clients.
- **Purpose lanes are entirely absent** across the physical-mail stack (zero
  `purpose` fields), and there is NO system-purpose physical send at HEAD —
  every real Lob send is counterparty-facing, so the paper `system` lane
  starts empty (unlike email).
- **The wedge cap exists but at the wrong layer:** `FREE_TIER_LIFETIME_PIECES
  = 5` is enforced only inside `routes-outreach-mail.ts` (tier-gated, not
  key-aware) — the sequence processor, campaign blast, and autopilot hand
  bypass it entirely, a paid org on the platform key is uncapped, and a free
  org on its OWN key is capped for no reason.
- `resolveProviderCredential` exists (`providers/resolveProviderCredential.ts`,
  vault-first + legacy fallback; `lob` is already a valid ByokChannel); the
  Provider-Role Register (§5 item 7) does NOT exist yet.

## The design (mirrors the email lane mechanism exactly)

The proven pattern is `emailService.ts` (founder decision 2026-07-17):
an optional `purpose?: 'system' | 'counterparty'` field on the send options →
a guard block at the top of the ONE send function, before the provider client
is constructed, returning an honest `{success:false, retryable:false}` refusal
naming the remediation surface → a ratchet test asserting the provider SDK was
NEVER touched on every refusal path (`emailPurposeEnforcement.test.ts`).

**New files:** `server/services/mail/mailLanes.ts` — `MailPurpose` type;
`resolveMailCredential(orgId)` (wraps resolveProviderCredential, returns
`{apiKey, source: 'organization'|'platform', isTestKey}`, collapsing the four
divergent resolvers); `assertMailLane({orgId, purpose, pieceCount,
credentialSource})` — counterparty-on-platform-key is allowed ONLY within the
free-tier 5-piece lifetime wedge; otherwise refuse naming Settings →
Connections. `shared/governance/provider-roles.ts` — the register, seeded
with the wedge exception (scope, mitigations, exit trigger "BYO-Lob shipped +
wedge conversion measured", enforcement pointer to assertMailLane).
`tests/unit/mailProviderLanes.test.ts` — seven cases mirroring the email
ratchet: wedge-exhausted refusal (adapter never called), wedge-remaining
allow, partial-batch refusal, BYO-key allow (platform key never resolved),
system-purpose allow, no-orgId refusal, interlock-disarmed regression pin.

**Touched:** `mail/router.ts` (required `purpose` on MailShipment; assertMailLane
before adapter.send), `mail/providers/lob.ts` + `directMailService.getLobClient`
(delegate to resolveMailCredential), the wedge cap moves from
`routes-outreach-mail.ts` into assertMailLane (route keeps its limitExceeded
rendering; lifetime non-cancelled semantics preserved), and the four
counterparty entry points get tagged.

## Founder decision points

1. **`lobService.ts` disposition:** delete it + the two unreachable
   `communications.ts` methods (cheapest honest option; deletion ledger row +
   same-commit ratchet locks), or retain with an orgId+purpose signature
   routed through mailLanes. Recommend DELETE.
2. **Fold in two adjacent defects found during verification, or ledger them:**
   (a) `mailProvider.ts:95-99` reads `credentials.apiKey` WITHOUT
   `decryptJsonCredentials` while every sibling decrypts — likely a real bug
   on the autopilot send-letter path; (b) `routes-campaigns.ts:1525/:1566`
   read `process.env.LOB_*` directly for address verification, bypassing
   BYOK. Recommend folding (a) into 0.8 (it is a credential-resolution bug on
   the exact seam being rebuilt) and ledgering (b) (verification, not a send).

Post-0.8 (Addendum A, explicitly sequenced after this): per-cohort velocity
caps and cross-org per-recipient dedupe on the platform lane.
