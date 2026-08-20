# E-signature: what AcreOS owns, and what it must not

**Status:** founder decision, 2026-08-20 — *orchestrate, not build*.
**Supersedes:** nothing. This is the first statement of the boundary.

---

## The decision

> AcreOS should own document intelligence, canonical deal/document state,
> preparation, workflow, authority checks, provider orchestration,
> receipts/reconciliation and sealed-artifact references. The actual signing
> ceremony, signer-authentication/signature capture and provider-specific
> signing mechanics should remain with a customer-controlled specialist e-sign
> rail.

This is the Minimum Necessary Responsibility hypothesis applied to one
subsystem. It is not a criticism of the code that exists — it is a statement
about which failures AcreOS should be in a position to cause.

| AcreOS owns | The rail owns |
|---|---|
| Which document, for which deal, in which state | The signing ceremony itself |
| Preparing the document and its variables | Authenticating the signer |
| The signer roster, and the authority to send it | Capturing the signature |
| Workflow: sent → partially signed → executed | Provider-specific envelope mechanics |
| Receipts, reconciliation, audit trail | The legal weight of the ceremony |
| A reference to the sealed artifact | Storing and sealing that artifact |

---

## What the repository actually contained (verified 2026-08-20)

Everything below was read out of the code, not carried over from a previous
summary. Where a previously-recorded finding did not survive contact with the
source, that is stated — an inherited list is a hypothesis like any other.

### 1. Multi-signer documents could not be completed — CONFIRMED, FIXED

Both capture paths recorded progress by rewriting
`generated_documents.signers`. `acreos_block_signed_doc_mutation_trigger`
(`scripts/migrate.mjs`) raises on any UPDATE that changes `content`,
`variables` or `signers` once the document is `signed` | `partially_signed` |
`final`.

* signer 1 → document is still `draft` → allowed → status becomes
  `partially_signed`
* signer 2 → `OLD.status = 'partially_signed'` and `signers` changed →
  **trigger raises → 500**

Live, on the counterparty-facing public signing page. `allSigned` could never
become true, so no multi-signer document ever reached `signed` or got a
`completedAt`.

**Fixed** by deriving progress from the `signatures` table
(`server/services/esign/signingProgress.ts`) and sending a status-only patch.
The trigger was deliberately *not* loosened: changing the roster after somebody
has signed is precisely the tamper vector it exists to stop. The defect was two
different things sharing one column — the roster is document *substance*; who
signed is *evidence*, and evidence already had a home.

Pinned by `multiSignerDocumentsComplete.test.ts`, which reads the protected
column list out of the migration rather than restating it, so widening the
trigger cannot leave the test pinning a rule the database no longer has.

### 2. An operator could mint a counterparty's signature — CONFIRMED, FIXED

`POST /api/signatures` took `signerName`, `signerEmail` and `signatureData`
from the request body behind nothing but `isAuthenticated`. It then stored
`req.ip` and the request's user-agent on that row as the *signer's* audit
trail. The evidentiary record did not merely fail to prove the counterparty
acted — it asserted the operator's device and network were theirs.

**Fixed**: the route now records only the signed-in user's own signature, and
refuses anything else with a pointer to the signer-request flow, where
`/api/public/sign/:docId` captures the signer's own IP, device and E-SIGN
§101(c) consent. This is the boundary in miniature: attesting that a
counterparty signed, when the only party present was an operator, is a
responsibility AcreOS cannot discharge.

The route has no client caller, so nothing in the product regressed.

### 3. "No content hash on the external rail" — REFUTED AS STATED

There is no external rail, so the finding cannot be true of one. On the native
rail the hash *does* exist: `signatures.document_content_hash` (migration
`0033_signature_document_content_hash.sql`) is a SHA-256 of the document
content captured at the moment of signing, and the immutability trigger plus
the route-level guard on `PUT /api/generated-documents/:id` keep the content
from drifting away from it.

Recorded rather than quietly dropped, because a finding list that only ever
grows is not being checked.

### 4. The DocuSign connector — CONFIRMED, and worse than "unwired"

The owner's instruction was to use the existing DocuSign connector as the first
real adapter **if current repository evidence supports it**. It does not.

`send_docusign_envelope` and `get_docusign_status` occur at exactly one place
in the entire repository: the `tools:` array that declares them. There is no
adapter, no API client, and nothing anywhere makes an HTTP call to a DocuSign
endpoint.

Two consequences made this more than a stale catalog row:

* `GET /api/ai/connectors` returns the whole definition to the client, so
  customers saw present-tense capabilities — *"Send offer letters for
  signature", "Check signature status"* — for an integration that does nothing.
* `POST /api/ai/connectors/:id/connect` accepted, **encrypted and stored**
  credentials for any id in the registry and answered `status: "connected"`.
  A customer could hand AcreOS their DocuSign secret and be told it was live.

A survey of the whole registry — the population, not just the entry that
prompted the question — found the same shape in four more places: `quickbooks`,
`dropbox` and `batch_leads` advertise capabilities no tool can deliver, and
`google_drive` declared one tool (`upload_drive_file`) that does not exist.

**Fixed**: `ConnectorDef.availability` now distinguishes an intended entry from
a working one; the connect route refuses a `planned` connector *before* the
credential is encrypted or stored; `google_drive`'s tool list was narrowed to
what it has; and `POST /api/ai/connectors/:id/test` — which was commented
"attempt to load credentials", loaded nothing and returned `success: true` —
now reports that it cannot verify, because there is no adapter to probe.

`connectorCatalogIsHonest.test.ts` derives correctness from whether each
declared tool resolves to a dispatch case, so `availability` cannot be set by
assertion in either direction.

---

## Why no DocuSign adapter was written

The instruction also said: *do not build speculative adapters.*

Writing a DocuSign HTTP client here would mean shipping an integration that has
never once been executed against the provider — no account, no OAuth app, no
credentials, no round trip. That is the precise failure this whole workstream
has been removing: code that reports a capability nobody has exercised. An
untested envelope client would be a larger version of
`send_docusign_envelope` — a name that promises a thing.

So the seam is defined and the adapter is not faked.

### What is needed to make it real — owner/provider actions

1. A DocuSign developer account and an OAuth integration key, owned by AcreOS
   for development, and **per-org connected accounts in production** — the rail
   is customer-controlled, so the envelope must be created under the customer's
   DocuSign account, not AcreOS's. This is the same rule as the money-custody
   and send-rail rulings: AcreOS is the orchestrator, never the principal.
2. A sandbox envelope round trip to validate the adapter against.
3. A decision on whether the org's DocuSign credential lives in the BYOK vault
   alongside the Lob and email credentials.

Until (1) exists, the honest state is `availability: "planned"`, which is what
the code now says.

---

## The shape the adapter must land in

Not DocuSign-specific. The canonical model stays provider-agnostic, and the
internal rail is one adapter behind it rather than the definition of the
interface — otherwise the first adapter silently becomes the contract.

* **Canonical status vocabulary** is AcreOS's, not any provider's. A rail
  reports into `sent | partially_signed | signed | declined | expired |
  voided`; the mapping from a provider's own vocabulary belongs in that
  provider's adapter and nowhere else.
* **The roster is AcreOS's.** Who must sign, in what role and order, is deal
  state. A rail is told; it does not decide.
* **The sealed artifact is referenced, not re-created.** When a rail seals a
  document, AcreOS stores the reference and the provider's own tamper evidence.
  It does not re-seal, re-hash and claim its own version is authoritative —
  that would be AcreOS asserting a fact about a ceremony it did not run.
* **Consent and identity evidence stay with the rail** and are referenced.
  The native rail's `signing_consent_audit` rows remain valid for signatures
  captured natively; they are not retro-fitted onto rail-captured ones.

### Why there is no `SigningRail` interface in the code yet

Deliberate, and it follows from the same rule as everything else here. CLAUDE.md:
*a canonical function with zero production callers is not canonical.* An
interface with one implementation is not an abstraction — it is a description of
that implementation, and the first adapter written against it silently becomes
the contract. Shipping a `SigningRail` port now would mean shipping a shape
derived from the only rail that exists, then discovering on contact with
DocuSign that the shape was wrong.

The boundary above is the specification. The interface gets written when the
second implementation arrives to constrain it — which is also the moment it
first has a caller.

## Cutover, and why the internal rail is not being retired yet

The owner asked to *shadow, compare, cut over, and retire redundant internal
signing machinery where safe.* There is nothing to shadow against: the DocuSign
adapter does not exist, so there is no second rail to compare with. Retiring
the internal ceremony now would leave customers with no signing at all.

So the order is:

1. **(done)** Fix the internal rail's live defects, so the rail customers are
   on today actually works while it is still the only one.
2. **(done)** Make the catalog honest, so nobody hands AcreOS a credential for
   a capability that does not exist.
3. **(blocked on owner)** Build the DocuSign adapter behind the port, against a
   real sandbox.
4. **(then)** Shadow: run both, compare outcomes on real envelopes.
5. **(then)** Cut over per-org, and only then retire the internal ceremony —
   keeping the `signatures` table and its rows intact.

## Historical evidence is preserved, not rewritten

Explicit owner instruction, and it constrains every step above.

* Existing `signatures` rows are untouched. They are truthful records of
  signatures that really were captured, under the rules in force at the time.
* Documents partly signed under the old roster scheme keep their `signedAt`
  markers, and `loadSigningProgress` reads them as evidence, so no historical
  document regresses to "unsigned" to make the new model tidy.
* Nothing about the old behaviour is deleted from the record. The defects are
  described in the deletion ledger and the cross-pollination ledger with what
  they did and why, rather than edited out.
* When the internal ceremony is eventually retired, its rows stay. A signature
  does not become less true because the mechanism that captured it was replaced.
