# Solene → Tom page discipline

A way for Solene to page Tom between sessions. The transport is ntfy.sh
fanned out to Tom's iOS device; the wire is `POST /api/internal/solene/page`
with a shared-secret header.

The transport is cheap. The discipline is everything.

## Page-worthy (urgent or critical only)

A page interrupts Tom. The bar is items that **change what Tom would do
next** if he saw them in the morning pulse instead of right now.

- **Production 5xx spike** — ≥5% error rate over 5 minutes against
  `acreos.io/api/*`. Severity: `critical`.
- **AWS production-access approval / rejection** — the gate that unblocks
  (or blocks) the launch arc. Severity: `urgent`.
- **LLC formation status change** — formation confirmed, EIN issued,
  banking application accepted/rejected. Severity: `urgent`.
- **Customer-facing constitutional violation detected** — e.g. Pax
  generates non-compliant copy that lands in a customer-visible surface,
  or a credential value leaks to a customer response. Severity: `critical`.
- **Critical security finding** — active exploitation attempt, leaked
  credential observed in the wild, compromised dependency announced.
  Severity: `critical`.

That is the entire list. If a candidate page doesn't match one of these
patterns, it is not page-worthy.

## NOT page-worthy

- Routine work landing (agents shipping commits, tests passing,
  deploys completing).
- Agent dispatch completion reports.
- Anything that fits the daily-pulse one-liner format — it goes there.
- Anything Solene can resolve herself within her COO authority envelope.
- Anything Solene is uncertain about — when in doubt, do NOT page; queue
  it for the morning pulse and let Tom redirect from there.

## Severity → behaviour

| severity   | ntfy priority | ntfy tags        | iOS effect                       |
|------------|---------------|------------------|----------------------------------|
| `urgent`   | 4             | `warning`        | Sound + lock-screen notification |
| `critical` | 5             | `warning,siren`  | Max priority + siren tone        |

## Endpoint shape

```
POST /api/internal/solene/page
Headers:
  X-Solene-Page-Secret: <shared secret from SOLENE_PAGE_SECRET env>
  Content-Type: application/json
Body:
  {
    "severity": "urgent" | "critical",
    "subject": "string (≤200 chars)",
    "body": "string (≤2000 chars)"
  }
```

Response (200 OK on any outcome — the request was valid even if ntfy
fan-out failed):

```
{
  "eventId": 42,
  "deliveryStatus": "delivered" | "failed" | "skipped",
  "deliveryDetail": "ntfy HTTP 200" | "<error>" | null
}
```

## Persistence

Every page writes a `solene_page_events` row regardless of delivery
outcome. Tom audits the ledger weekly via `GET /api/founder/solene-page/
recent` (last 50). A pattern of pages on non-page-worthy items is a
discipline failure — surfaces in Solene's self-audit framework as the
audit catches up to this surface.

## Audit cadence

Solene reviews her own pages during the weekly retro pass at
`docs/company/retros/<week>.md`. If she paged Tom 3+ times in a week
on items that retroactively didn't meet the page-worthy bar, she records
it in the "What surprised me / patterns" section and tightens her own
threshold the following week.

## Tom — setup

Two pieces, done once:

1. **Set `SOLENE_PAGE_SECRET` on Fly.**

   ```
   flyctl secrets set SOLENE_PAGE_SECRET=$(openssl rand -hex 32) --app acreos
   ```

   Anything Solene-as-orchestrator uses to hit the endpoint must carry
   this exact value as `X-Solene-Page-Secret`. Don't store it in any
   user-visible config; it lives in Fly secrets only.

2. **Subscribe on the iOS ntfy app.**

   - Install [ntfy](https://apps.apple.com/app/ntfy/id1625396347) from
     the App Store.
   - Open the app → tap `+` (add subscription).
   - Topic name: `acreos-solene-urgent-norton-9k4m7q3z`
     (or whatever you set as `SOLENE_PAGE_TOPIC` on Fly if you rotate it
     — the env var overrides the built-in default at
     `server/services/solene/pagerService.ts:DEFAULT_TOPIC`).
   - Server: `ntfy.sh` (default).
   - Enable notifications. Critically — open iOS Settings → Notifications
     → ntfy and enable **Time-Sensitive Notifications** so siren-priority
     pages bypass Focus modes.

   You should immediately receive a "Solene: connection test" push if
   you fire `curl -X POST -d "test" "https://ntfy.sh/<topic>"` from any
   shell.

3. **(Optional, when rotating)** Set `SOLENE_PAGE_TOPIC` on Fly to point
   at a new opaque topic name and re-subscribe in the ntfy app. Topic
   names are non-discoverable — the only way to receive pages is to know
   the exact topic — but rotation is cheap if the topic leaks.

## TODO — capital tracker integration

When Solene records future dispatches via `recordSoleneDecision`, she
SHOULD also call `recordCapitalEvent` from `capitalTracker.ts` so each
page carries an implied cost-allocation. This integration is deferred —
don't refactor existing call sites to wire it up. New dispatch paths
that ship from here on out should record both. See
`feedback_solene_self_development.md` for the broader self-development
discipline this fits inside.

## Related

- `server/routes-solene-page.ts` — endpoint
- `server/services/solene/pagerService.ts` — ntfy transport + ledger write
- `shared/schema/solene-page.ts` — table definition
- `docs/internal/solene-team-state.md` — sibling discipline (team-state map)
- `docs/company/retros/<week>.md` — where pages get audited weekly
- `.github/workflows/daily-pulse.yml` — the non-urgent surface that absorbs
  everything NOT in the page-worthy list above
