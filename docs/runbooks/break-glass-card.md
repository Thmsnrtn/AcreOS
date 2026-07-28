# If AcreOS is dark — the break-glass card

> **KEEP A COPY OF THIS CARD OUTSIDE THE APP.** If AcreOS is down, you cannot
> read this inside AcreOS. Print this page, or keep the emailed copy (Controls →
> "Email me the break-glass card") somewhere you can find it from your phone.

Written for a non-technical reader, during an outage, possibly on a phone.
No step here needs a terminal unless it says so.

---

## 1. First: is it down, or is it just you?

- **Did this morning's one-liner arrive?** The daily pulse pushes one line to
  your phone (via ntfy) at ~7:07am Eastern every day, from GitHub's computers —
  completely outside AcreOS. If it arrived on time, the site was up this
  morning and GitHub's side is healthy.
- **Try the site from your phone on cellular** (turn wifi OFF first):
  open `https://acreos.io/api/healthz` in the phone's browser.
  - If you see a short "ok"-style response → the site is up; the problem is
    your network or your laptop.
  - If it spins or errors → it's really down. Keep reading.
- Ask one other person to try `https://acreos.io` before declaring an outage.

## 2. Who hosts what (and where to log in)

| Piece | Who runs it | Where to log in |
|---|---|---|
| The app + database | **Fly.io** (app and Postgres live here) | https://fly.io/dashboard |
| The code + external watchdogs | **GitHub** (repo `Thmsnrtn/AcreOS`; the watchdogs are Actions workflows) | https://github.com/Thmsnrtn/AcreOS — watchdogs under the **Actions** tab: https://github.com/Thmsnrtn/AcreOS/actions |
| Billing / customer payments | **Stripe** | https://dashboard.stripe.com |
| Phone paging | **ntfy** (the push app on your phone; pages fall back to your email if push fails) | https://ntfy.sh + the ntfy app on your phone |

An outage of the app does **not** touch Stripe: customer billing keeps
running on Stripe's side even while the app is dark.

## 3. The three first steps, in plain words

1. **Prove it's really down** (step 1 above: pulse arrived? healthz from
   cellular?). Don't skip this — half of "outages" are the founder's wifi.
2. **Look at GitHub Actions**: https://github.com/Thmsnrtn/AcreOS/actions.
   Red runs on "Deploy" mean a deploy broke the site; red runs on
   "Release Watchdog" mean the live site is stale or unreachable and the
   watchdog noticed. The newest red run's page says what it saw.
3. **Look at Fly.io**: https://fly.io/dashboard → the AcreOS app. If a machine
   shows stopped or unhealthy, use **Restart** on the machine. If Fly itself
   is having an incident, https://status.flyio.net will say so — then it's
   wait, not fix.

## 4. When to call which vendor

- **Site down, Fly dashboard shows machine trouble or won't restart** →
  Fly.io support: https://fly.io/docs/about/support/ (check
  https://status.flyio.net first — if they're down, they know).
- **Deploys or watchdogs won't run, GitHub pages erroring** →
  check https://www.githubstatus.com, then https://support.github.com.
- **Payments/billing questions or Stripe dashboard trouble** →
  check https://status.stripe.com, then https://support.stripe.com.
- **Pages not reaching your phone** → open the ntfy app and confirm you're
  still subscribed to your private topic; remember every page also falls back
  to your email, so search your inbox before assuming silence meant nothing
  happened.

---

## 5. Arming the dormant external watchdogs (one-time setup)

Three watchdogs live in GitHub Actions, outside AcreOS. The **daily pulse**
(needs `NTFY_TOPIC`) is the one that texts you each morning. The other two are
**dormant until you set their secrets** — they run, but no-op or cannot alert:

- **uptime-probe** (`.github/workflows/uptime-probe.yml`) — pings the site
  from GitHub every ~5 minutes and records real outside-in uptime.
  Dormant until BOTH secrets exist: `UPTIME_PROBE_URL` and `UPTIME_PROBE_TOKEN`.
- **release-watchdog** (`.github/workflows/release-watchdog.yml`) — hourly,
  checks the live site is actually running the latest code and pings your
  phone if not. It cannot alert until `DEPLOY_ALERT_WEBHOOK` exists (its runs
  deliberately FAIL red until then — a watchdog that can't bark is a lie).

The exact secret names, verbatim (capitalization matters):

- `UPTIME_PROBE_URL` — the site's address, no trailing slash: `https://acreos.io`
- `UPTIME_PROBE_TOKEN` — a long random string; the SAME value must also be set
  on the server (Fly secret named `UPTIME_PROBE_TOKEN`), or the site refuses
  the probe's check-ins.
- `DEPLOY_ALERT_WEBHOOK` — where the alarm goes: `https://ntfy.sh/<your-private-topic>`
  (or a Slack/Discord incoming-webhook URL).
- `NTFY_TOPIC` — (daily pulse) the ntfy topic name your phone subscribes to.
- `PULSE_SHARED_SECRET` — (daily pulse, optional) lets the pulse include the
  month's spend line; the pulse works without it.

### Path A — GitHub website (no terminal)

1. Go to https://github.com/Thmsnrtn/AcreOS
2. **Settings** (top tab of the repo) → **Secrets and variables** → **Actions**
3. Click **New repository secret**
4. Name: exactly `UPTIME_PROBE_URL` · Secret: `https://acreos.io` → **Add secret**
5. Repeat for `UPTIME_PROBE_TOKEN` (paste the long random string) and
   `DEPLOY_ALERT_WEBHOOK` (paste your ntfy topic URL) — and `NTFY_TOPIC` if
   the morning pulse isn't arriving yet.

### Path B — gh CLI (terminal)

```sh
gh secret set UPTIME_PROBE_URL --body "https://acreos.io"
gh secret set UPTIME_PROBE_TOKEN --body "<long-random-string>"
gh secret set DEPLOY_ALERT_WEBHOOK --body "https://ntfy.sh/<your-private-topic>"
gh secret set NTFY_TOPIC --body "<your-private-topic>"
```

And the server-side half of the probe token (Fly):

```sh
fly secrets set UPTIME_PROBE_TOKEN="<the same long-random-string>"
```

### Prove it worked

Actions tab → pick the workflow (uptime-probe / Release Watchdog) → **Run
workflow** → watch the run go green and read its log. The uptime-probe log
should say it recorded a sample (not "probe dormant"); the release-watchdog
run should end green with "Alert spine wired". Until you SEE that, treat the
watchdog as dormant — the app never claims otherwise.
