# Market simulation: the first 90 days with customers

This simulation drives a LOCAL production build (`dist/`) through its real API under the E2E test-auth bypass. It never runs against a deployed instance. The aim is to measure what the owner's first 30, 60 and 90 days with 3, 10 and 25 customers would cost him in time, money and legal exposure.

It reuses `../client.ts` (auth and CSRF) and `../ledger.ts` (findings, metrics, skips), and it loads `../idor-sweep.ts`'s population and row-forger in-process instead of copying them.

## Files

| file | what it measures |
|---|---|
| `common.ts` | Shared code: DB pool, org provisioning (one client IP per org), the burden rubric (`RUBRIC_MINUTES`), signed webhook helpers, and model stand-in control. |
| `cohort-90-days.ts` | 25 orgs × 13 tenure weeks of realistic work: import, skip trace, SMS, email and mail, seller replies (STOP, natural opt-out, wrong number, angry, interested), offers, deals, notes, VAs, upgrades, downgrades, cancellations, export and deletion. The arrival curves for the 3, 10 and 25 bands are `ARRIVAL_3`, `ARRIVAL_10` and `ARRIVAL_25`. |
| `burden.ts` | Audits the provider log (SMS after opt-out, quiet hours by recipient zone, opt-out language). It then places every burden event on each band's calendar and reports owner-hours per week for weeks 1–13, the top issues, and unit economics from the app's own metering (`financial_ledger`, `ai_telemetry_events`, `credit_transactions`). |
| `csv-imports.ts` | Six messy land-list CSVs (BOM, CRLF, `LAST FIRST` owner names, mailing vs situs addresses, `1.23E+11` APNs, a 5,000-row file). Each goes through the client's own `parseCsv`/`suggestField` and the server import paths. Reported vs persisted rows, field mapping, and what the customer is told. |
| `write-path-sweep.ts` | Org B sends POST/PUT/PATCH/DELETE by id against org A's rows. Detection reads the DB (row diff, child rows), never the status code. A positive control on B's own row must show a detectable effect before a route counts as `isolated`. Also runs a synthetic-breach self-test, enforces a population floor (`WRITE_SWEEP_FLOOR`), and fails if any verb has zero proven controls. |
| `time-edges.ts` | Product functions run in-process with an explicit clock: SMS quiet hours across the 2026 DST weekends for 10 area codes, late-fee grace for evening payments on the last grace day, and the campaign "Schedule" date round-trip in 5 time zones. |
| `deliverability.ts` | Sends every opt-out signal (SMS STOP signed with the customer's token and with the platform token, natural-language opt-out, signed SendGrid bounce and complaint, List-Unsubscribe one-click, customer DNC), then re-sends on every channel and counts sends that still reach the provider. Includes positive controls per channel and for the inbound detector. |
| `pax-questions.ts` | 40 customer questions plus their rubrics. The rubrics feed the later "needs oracle" judging pass. |
| `pax-run.ts` | Asks the 40 questions one at a time in `script` mode. Measures status, latency, model calls, tools offered, metering (reply vs telemetry vs credits), prompt data scope, and the model-down cases (`fail:500`, `hang`). |
| `pax-tools.ts` | Deterministic tool calls answered from the stand-in's queue (a scripted caller, not a judge). Covers an own read (positive control), foreign-id read, foreign-org argument, foreign write, injection via lead notes, and a send to a DNC lead. |
| `notes-money-push.ts` | Note, payments, late fees (the daily job's pass with an explicit `now`), payoff quote, money views and month-end due dates. Runs only on the drizzle-push-built DB. |
| `provider-standin.mjs` | Local SES, Twilio, Lob and SendGrid. Every call is logged with recipient, sender and body. Never contacts a real provider. |
| `fetch-redirect.cjs` | `node --require` preload that sends api.twilio.com, api.lob.com and api.sendgrid.com to the provider stand-in. Model hosts that some code paths call directly go to the model stand-in. Every other outbound host is counted. |
| `prompt-tap.mjs` | Pass-through in front of the model stand-in. It logs full request bodies so the Pax scope checks can read whole prompts. |

## Running

You need two servers built from the same `dist/`, each started from a copy directory outside the repo with an empty `HOME`:

- web and worker on the migration-built DB (`scripts/ci/build-schema-from-repo.sh`);
- one web server on a drizzle-push-built DB, used only by `notes-money-push.ts`.

Start the model stand-in in `script` mode behind `prompt-tap.mjs`, and start `provider-standin.mjs`.

```
SIM_BASE_URL=http://localhost:<port> DATABASE_URL=… MARKET_OUT=<results dir> CAMPAIGN_OUT=<results dir>/ledger \
PROVIDER_DIR=<provider stand-in dir> STANDIN_DIR=<model stand-in dir> SG_EVENT_PRIVATE_KEY_FILE=<ed25519 pem> \
npx tsx tests/simulation/campaign/market/<file>.ts
```

`burden.ts` reads `MARKET_OUT/cohort`, so run it after the cohort.

For the deliverability run, configure the local build's `SENDGRID_EVENT_WEBHOOK_PUBLIC_KEY` with the public half of a key pair generated for the run.

## Honesty rules this simulation keeps

- **Time is compressed.** Behaviour that depends on elapsed time is only claimed where it was triggered:
  - the contact-frequency ledger (`lead_activities.created_at`) is aged 7 days per tenure week;
  - sequence enrollments are made due, and the running worker is waited for;
  - the late-fee job is invoked with an explicit `now`;
  - quiet hours and grace are evaluated at stated instants.
- **The trial is not advanced.** The 14-day trial's $5 spend cap runs on the real clock, so every "Insufficient credits" 402 after tenure week 2 is excluded from the burden (`burden.ts` prints the count).
- **Bypasses are recorded, never hidden.** Stripe is unconfigured locally, so tier changes and credit packs are applied by SQL and logged to `cohort-env-gaps.jsonl`. The one email identity that delivers has no UI path and needs DNS. It was provisioned through the API and verified by SQL, and the run says so.
- **Security.** Any breach specifics go only to the results directory (`private-write-sweep.jsonl`). Repo files say "see private report".
