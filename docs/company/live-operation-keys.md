# Master key list — what AcreOS needs to operate live

_Prepared 2026-07-15 in answer to "what's the new master list to run live?"
Grounded in `server/utils/validateEnv.ts` (hard-boot gate),
`server/services/integrationReadiness.ts` (customer-critical catalog), and a
sweep of `process.env` usage. The reshape (Clerk owns auth; customers bring
the rails) shrinks this list hard — most of the old platform service keys are
now droppable._

## Tier 0 — the app WON'T BOOT without these (3)

Enforced by `validateEnv.ts`; every process (web, worker, migrate) exits
without them.

| Key | What it is |
|---|---|
| `DATABASE_URL` | Postgres connection string |
| `CLERK_SECRET_KEY` + `VITE_CLERK_PUBLISHABLE_KEY` (+ `CLERK_PUBLISHABLE_KEY`) | Auth — Clerk owns login + OAuth |
| `FIELD_ENCRYPTION_KEY` | AES-256-GCM key for all secrets/PII/BYOK (`openssl rand -hex 32`) |

## Tier 1 — required to run the CORE product live (4)

The platform boots without these but the core experience is dark.

| Key | Lights up | If missing |
|---|---|---|
| `ANTHROPIC_API_KEY` (or `OPENROUTER_API_KEY`) | Pax + Solene + all AI analysis | no AI features work |
| `VOYAGE_API_KEY` | embeddings — semantic search + Solene memory | search/memory degraded |
| `STRIPE_SECRET_KEY` + `STRIPE_PUBLISHABLE_KEY` + `STRIPE_WEBHOOK_SECRET` | billing / checkout / subscriptions | no plan can be bought (use `sk_test_…` first) |
| `VITE_MAPBOX_ACCESS_TOKEN` | the Map door + reverse-geocode | map surface shows "unavailable" |

Plus `APP_URL` (your canonical https origin) — used for OAuth callbacks and
canonical links. Strongly recommended.

## Tier 2 — platform capabilities you PROVIDE (add when you're ready)

These are the moat AcreOS keeps — but the founder plan defers paid data
"until MRR clears," so they're optional at launch.

| Key(s) | Capability | Note |
|---|---|---|
| `REGRID_API_KEY` / `ATTOM_API_KEY` / `BATCHDATA_API_KEY` / `RAPIDAPI_KEY` | paid parcel / owner / comps data | free open-data (FEMA/USDA/USGS/Census) works with NO key; add these when volume justifies |
| `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` (or Cloudflare R2 S3 creds) | file storage — uploads, PDFs, reports | needed once document features are used |
| `AWS_SES_FROM_EMAIL` (+ AWS creds) | the platform's OWN notification/briefing email | Clerk sends the AUTH emails; SES only for platform-originated notices |
| `VITE_SENTRY_DSN` | error monitoring | pure ops hygiene |

## Tier 3 — DISCONNECT these (the reshape moved them to the customer)

Every one of these was a platform rail carrying COGS + liability. Under
BYO-rails they belong to the customer's own connected account (the BYOK vault
/ connectors hub). **You do not need them as platform keys** — unless you keep
"platform rails as a convenience" (pricing proposal Option A/C), in which case
keep only the ones you want to front.

- **SMS:** `TWILIO_*` / `TELNYX_*` — customer BYO.
- **Outreach email:** `SENDGRID_API_KEY` — customer BYO.
- **Physical mail:** `LOB_*` / `POSTGRID_*` — customer BYO.
- **Skip-trace as a platform rail:** `BATCH_SKIP_TRACING_API_KEY` — customer BYO.
- **DNC/litigator vendor** — optional compliance enhancement, not required.
- **Syndication portal keys** — customer BYO where applicable.

That's roughly a dozen platform secrets you can stop holding — each one was a
liability + COGS line the reshape retired.

## The native inbox rides Clerk — NO AcreOS OAuth key (done 2026-07-15)

The native inbox is wired to Clerk's OAuth token vending: the customer links
their Gmail/Outlook through Clerk (`createExternalAccount` with mail scopes),
**Clerk holds the tokens**, and AcreOS reads a fresh one on-demand. There is
**no `GOOGLE_CLIENT_ID` / `MICROSOFT_CLIENT_ID` in AcreOS env** and AcreOS
stores zero mailbox tokens.

To turn the inbox on, do it entirely in the **Clerk dashboard**:
- Enable the **Google** and **Microsoft** social connections.
- Add the mail scopes: Google `gmail.readonly` + `gmail.send`; Microsoft
  `Mail.Read` + `Mail.Send`.

The legacy standalone Google/Microsoft **login** OAuth (`server/auth/oauth.ts`)
was retired the same day — Clerk owns login, so those routes were redundant.

## The short version

**To go live you need exactly:** DATABASE_URL · Clerk (secret + publishable) ·
FIELD_ENCRYPTION_KEY · a platform AI key (Anthropic) · Voyage · Stripe (start
test) · Mapbox. Everything else is either a capability you add when scaling
(data, storage, platform email) or a rail you've handed to the customer and
can disconnect.
