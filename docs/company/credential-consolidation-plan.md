# Credential-System Consolidation — staged migration plan

_Founder-approved planning doc, 2026-07-15 ("Plan the migration"). Companion
to `home-base-reshape.md` and `cohesive-os.md`. This is a PLAN, not a cutover:
every stage below is reviewed and the destructive final stage is a founder
hard-stop. No code moves until each stage's exit criteria are green._

## Why there are two systems

Building the connectors hub (R1) surfaced that AcreOS stores per-org provider
credentials in **two** places, both load-bearing:

1. **`organizationIntegrations`** (legacy) — `storage.getOrganizationIntegration(orgId, provider)`,
   JSON creds encrypted via `decryptJsonCredentials`. Read directly by ~30
   server modules. Holds: `twilio`, `sendgrid`, `lob`, `aws_ses`, `regrid`,
   `rapidapi`, and **`stripe_connect`**.
2. **`byokCredentials` vault** (canonical) — `key-vault.ts`, AES-256-GCM,
   one row per (org, channel), the surface the credit-pool bypass, `aiByok`,
   and `dataByok` (R1d) already read. Holds the 14 BYOK channels.

The customer-facing connectors hub is built over the **canonical vault**, so
what a customer connects today is what drives the platform-COGS-$0 bypass.
The legacy system keeps working underneath for the modules that still read it.

## The load-bearing distinction: keys vs. tokens

**`stripe_connect` is NOT a migration target.** It does not hold a pasteable
API key — it holds **OAuth Connect account linkage / tokens** with their own
refresh lifecycle, and it is money-critical (7 read sites incl. billing,
payouts, `stripeConnect.ts`). It stays in `organizationIntegrations`. Moving
it would conflate two different credential lifecycles and put payouts at risk
for zero reshape benefit. **Out of scope, permanently.**

The genuine duplication — the same provider connectable in *both* systems — is
the **API-key providers**: `twilio`, `sendgrid`, `lob`, `aws_ses`, `regrid`.
Plus `rapidapi`, which is legacy-only (see Stage 4).

## Consumer inventory (legacy readers, 2026-07-15)

Routes: `routes-integrations`, `routes-misc`, `routes-billing`,
`routes-core-ai`, `routes-properties`, `routes-admin`, `routes-elite-features`,
`routes-epic-services`.
Services: `comps`, `parcel`, `directMail`, `directMailService`, `mailProvider`,
`emailService`, `smsService`, `smsProvider`, `comms/providers/twilio`,
`regrid-provider`, `commissionService`, `dealHandoffService`,
`developerApiService`, `territoryService`, `stripeConnect`, `webhookDispatcher`,
`healthCheck`.
Infra: `storage/integrationsRepo`, `fieldEncryption`, `encryption`,
`middleware/fieldEncryption`, `mcp-server`, `jobs/indexAnalyzer`.

## The migration, staged (each stage independently shippable + reversible)

**Stage 0 — Freeze legacy as write-once (no reader change).**
New connections for the API-key providers already land in the vault (the R1
hub writes there). Confirm no *new* code writes `organizationIntegrations` for
the API-key providers. `stripe_connect` and `rapidapi` writers untouched.
_Exit: grep proves no new legacy writes for the five API-key providers._

**Stage 1 — One resolver, vault-first, legacy-fallback.**
Introduce a single `resolveProviderCredential(orgId, provider)` that checks the
canonical vault first and falls back to `organizationIntegrations`. Point the
five API-key providers' read sites at it, one provider at a time (twilio →
sendgrid → lob → ses → regrid). Behaviour is identical when only one system
has the cred; vault wins when both do. `regrid-provider` already has a partial
legacy path — fold it into the resolver.
_Exit per provider: tsc + full suite green; the provider's sends/lookups work
with the cred in either store (covered by a resolver unit test with both
fixtures)._

**Stage 2 — Backfill.**
One-time, idempotent, dry-run-first job: for each org+API-key-provider with a
legacy row and no active vault row, copy the secret into the vault (re-encrypt
under the vault's envelope), leave the legacy row intact. Log a per-row report;
never overwrite an existing vault credential.
_Exit: dry-run report reviewed; post-run, every legacy API-key cred has a vault
twin; zero overwrites._

**Stage 3 — Flip to vault-only reads.**
Remove the legacy fallback from the resolver for the five providers (vault
becomes the sole read path). Legacy rows remain as cold backup for one release.
_Exit: full suite green; a release soak with no "fell back to legacy" logs._

**Stage 4 — `rapidapi` decision + legacy retirement (FOUNDER HARD-STOP).**
`rapidapi` (property-lines, legacy-only) either gets a vault channel + hub row
(promote) or is retired if unused. Then drop the API-key providers from
`organizationIntegrations`, keeping only `stripe_connect`. Dropping columns/
rows is destructive → **founder approves this stage explicitly**; it does not
run on green alone.
_Exit: founder GO; migration `0xxx` reviewed; rollback snapshot taken first._

## Guardrails
- `stripe_connect` never moves. Payouts are untouched by this program.
- No stage deletes data except Stage 4, which is a founder hard-stop with a
  snapshot first.
- Each stage is its own PR through the full gate suite; each is reversible
  until Stage 4.
- The compliance/consent machinery that reads these creds (quiet hours, STOP,
  DNC-when-keyed) is re-pointed at the resolver, never weakened.
