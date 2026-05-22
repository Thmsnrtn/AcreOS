# Phase 0 — Tom-Action Items

Most of Phase 0 is code I (Claude) can ship via PR. Three items need Tom to act in external dashboards because they involve account ownership, payment methods, or production data I can't access from the sandbox.

Each item is small but **all four are needed** to hit the <$20/mo target. Together they recover ~$151/mo on top of the ~$560/mo already shipped via the fly.toml change (commit `2bd89a52`).

## Action 1 — Drop Sentry plan to free tier (~$29/mo)

The code-side sample-rate work is already done (`server/utils/sentry.ts:76` reads `SENTRY_TRACES_SAMPLE_RATE` env, defaults to 0.05). Traces volume is already at 5%; errors stay at 100%.

What to do:
1. Sign in at https://sentry.io
2. Settings → Subscription → **Downgrade plan** → Developer (Free)
3. Confirm. Existing project + DSN keep working; just the quota tightens (free tier: 5k errors + 10k transactions/mo).

When to re-upgrade: revenue-trigger ladder says **$50 MRR**. Once you hit that, Pax surfaces a queue item to re-enable Starter ($29/mo). With the code's 5% trace sample rate, Starter quota should last comfortably even at moderate launch traffic.

## Action 2 — Migrate Postgres → Neon free tier (~$85/mo)

This is the trickiest Phase 0 action because it moves live data. **Do this on a quiet weekday morning** when you can watch.

What to do:
1. Sign up at https://neon.tech (free tier: 0.5 GB compute + 0.5 GB storage — enough for pre-launch).
2. Create a project named `acreos` in the `iad` region (match Fly).
3. From the Neon dashboard, copy the connection string. It looks like `postgresql://user:pass@ep-something.us-east-2.aws.neon.tech/acreos?sslmode=require`.
4. From your Mac terminal:
   ```bash
   # Snapshot current Fly Postgres
   fly proxy 5432:5432 -a <your-fly-postgres-app-name> &
   pg_dump postgresql://postgres:PASSWORD@localhost:5432/acreos > acreos-backup.sql
   kill %1
   
   # Restore to Neon
   psql "<neon-connection-string>" < acreos-backup.sql
   ```
5. Update the Fly secret:
   ```bash
   fly secrets set DATABASE_URL="<neon-connection-string>" -a acreos
   ```
6. Verify: hit `https://acreos.io/api/health` — `services.database.status` should be `healthy`.
7. After 24–48 hours of clean operation, destroy the old Fly Postgres app to fully realize the $85/mo savings:
   ```bash
   fly apps destroy <your-fly-postgres-app-name>
   ```

Rollback if Neon misbehaves: re-set `DATABASE_URL` back to the Fly Postgres string. Fly redeploys in ~9 min and the platform is back where it was. The data hasn't moved; we just changed which copy the app reads.

When to re-upgrade: revenue-trigger ladder says **$2k MRR**. At that point Neon paid tier or Fly Postgres restored — for the read-replica adoption.

## Action 3 — Cancel ElevenLabs Pro (~$22/mo)

What to do:
1. Sign in at https://elevenlabs.io
2. Subscription → Manage → **Cancel subscription**. Plan downgrades at end of billing cycle.
3. AcreOS already pays per-use beyond Pro credits, and the voice cache at `server/integrations/elevenLabs.ts:65-75` means repeat lines cost zero. No code changes needed.

When to re-upgrade: revenue-trigger ladder says **$1k MRR** if CMO scripts are actually ramping up. Pax surfaces this as a queue item.

## Action 4 — Release idle Twilio tracking numbers (~$15/mo)

What to do:
1. Sign in at https://console.twilio.com
2. Phone Numbers → Manage → Active Numbers
3. For each number, check the last-inbound-call timestamp. If no inbound in the last 30 days, release it (Twilio "Release this number" button).
4. After Pillar 5 (Communications Router) ships with the tracking-pool design, this becomes automatic. For now, manual once a month.

When to re-grow: tracking-pool design (Pillar 5) will auto-size based on concurrent active campaigns.

## After these four actions

Estimated monthly fixed burn drops from ~$735/mo → ~$15/mo. Platform survives indefinitely at zero customers. First customer dollar funds buckets per the allocation policy (25% tax / 10% refund / 5% profit / 5% draw / 55% opex) and the revenue-trigger ladder takes over.

## Verification once all four are done

Run this audit and forward to me / save for your records:

```bash
echo "=== Fly machines ==="
fly status -a acreos | grep "VERSION\|SIZE\|STATE"

echo "=== Fly secrets (counts only — never paste values) ==="
fly secrets list -a acreos | wc -l

echo "=== Sentry: should show 'Developer Plan' ==="
# Visual check at sentry.io

echo "=== Stripe: should show no ElevenLabs subscription ==="
# Visual check at elevenlabs.io subscription page

echo "=== Twilio active numbers count ==="
# Visual check at console.twilio.com phone numbers page
```

Once verified, mark tasks #119, #121, #122 complete in the local todo list, and Phase 0 is done.
