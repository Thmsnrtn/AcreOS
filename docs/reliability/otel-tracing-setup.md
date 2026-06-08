# OpenTelemetry tracing — lighting it up for first customers (Tess #4)

> **Status:** code is ready; the exporter is a no-op until the Fly secrets below
> are set. This doc is the runbook for turning real traces on. It does **not**
> set secrets — that is a founder action (it costs nothing on the free tier, but
> it routes our request data to a third party, so it's a conscious call).

## Why

`server/tracing.ts` is a beautiful no-op in production: `OTEL_EXPORTER` is unset,
so every span is discarded. We have p95 aggregates but **no per-request
waterfall**. When a first customer says "the parcel lookup spun for 8 seconds,"
we can't see whether it was the county provider, a cache miss, the AI grounding
call, or the DB.

With <50 customers, trace volume is trivial. **Honeycomb's free tier (20M
events/month) covers us with headroom**, and the SDK + auto-instrumentation
(HTTP + Express) plus the explicit spans below are already wired.

## What's already instrumented

- **Auto:** every inbound HTTP request + Express route (via
  `HttpInstrumentation` + `ExpressInstrumentation` in `server/tracing.ts`).
- **Explicit (the high-variance path):** the parcel resolution front door
  (`server/services/parcel/resolveParcel.ts`) now wraps its two slowest segments
  in spans:
  - `resolveParcel.registry.enrichAll` — the provider-registry lookup (county
    provider / cache / circuit breaker / credit metering). This is the
    highest-variance customer call.
  - `resolveParcel.broker.lookupMultiple` — the broker fallback path.
  Both carry `parcel.categories`, `parcel.category_count`, `parcel.tier`, and
  `parcel.input_type` attributes so a slow trace is legible at a glance.
- **Every span** created via `traceAsync` is auto-tagged with `git.sha`
  (`VITE_GIT_SHA` → falls back to `SENTRY_RELEASE`), so a latency/error
  regression is one query from "which deploy introduced it" — and it matches the
  release tag Sentry uses (`server/utils/sentry.ts`), so traces and errors
  cross-reference.

## Turning it on (Honeycomb free tier)

1. Create a free Honeycomb account → an environment → grab the **ingest API
   key** (Environment Settings → API Keys).
2. Set the Fly secrets on **both** the `app` and `worker` process groups (traces
   originate from both):

   ```sh
   fly secrets set \
     OTEL_EXPORTER=otlp \
     OTEL_EXPORTER_OTLP_ENDPOINT=https://api.honeycomb.io \
     OTEL_EXPORTER_OTLP_HEADERS="x-honeycomb-team=<INGEST_API_KEY>" \
     --app acreos   # repeat for the worker app/process group if separate
   ```

   - `OTEL_EXPORTER=otlp` flips `server/tracing.ts:buildExporter()` from no-op to
     the OTLP HTTP exporter.
   - The endpoint is the base URL; the code appends `/v1/traces`.
   - `OTEL_EXPORTER_OTLP_HEADERS` is a comma-separated `k=v` list; the parser in
     `buildExporter()` splits on `,` then `=`. For Honeycomb the only required
     header is `x-honeycomb-team`. (If you split telemetry into a separate
     dataset, add `x-honeycomb-dataset=<name>` as a second comma-separated pair.)

3. Redeploy (or `fly machines restart`) so the process re-reads env and
   `initTracing()` builds the real exporter. Confirm in logs:
   `[Tracing] Using OTLP exporter → https://api.honeycomb.io` and
   `[Tracing] OpenTelemetry tracing initialized (service: acreos-server)`.

## Verifying

- Hit any authed route, then in Honeycomb query `service.name = acreos-server`.
- For a parcel lookup, you should see the auto HTTP/Express spans with a child
  `resolveParcel.registry.enrichAll` (and/or `.broker.lookupMultiple`) span,
  each tagged with `git.sha` and the `parcel.*` attributes.
- Filter by `git.sha = <deployed sha>` to scope to the current release.

## Cost / volume guardrails

- Free tier: 20M events/month. At <50 customers and the cold-start topology
  (`min_machines_running=0`), real trace volume is far under this.
- `SENTRY_TRACES_SAMPLE_RATE` (Sentry) and OTel are independent; this doc only
  governs OTel. If volume ever approaches the cap, add a
  `BatchSpanProcessor`-level sampler — `server/tracing.ts` already uses
  `BatchSpanProcessor` for the OTLP path, so a `ParentBasedSampler` /
  `TraceIdRatioBasedSampler` slots in there without touching call sites.

## Turning it off

`fly secrets unset OTEL_EXPORTER OTEL_EXPORTER_OTLP_ENDPOINT OTEL_EXPORTER_OTLP_HEADERS`
then restart. `buildExporter()` returns `null` and tracing is a no-op again — no
code change, no redeploy of the image.

---

*Owner: Tess (SRE). Cross-refs: `server/tracing.ts`,
`server/services/parcel/resolveParcel.ts`, `server/utils/sentry.ts`,
`docs/reliability/capacity-and-uptime-notes.md`.*
