# Morning Brief — 2026-06-02

While you slept, Solene drove what was drivable. Site healthy throughout, no production incidents. Here's the state.

## ✅ Green — done, no action needed

- **SES fully verified.** `DKIM: SUCCESS`, `MAIL FROM: SUCCESS`, `VerifiedForSendingStatus: true`. Custom MAIL FROM (`mail.acreos.io`) is live, all 3 DKIM CNAMEs propagated through Cloudflare, configuration set `acreos-transactional` is active. AWS has the production-access request in their review queue (~24h until they email you).
- **Apex SPF fixed.** Acreos.io had NO apex SPF before tonight — any outbound from the domain would have been failing SPF at the receiver. Now `v=spf1 include:amazonses.com ~all` is on the apex.
- **DMARC at p=none.** Observe-only for ~30 days to gather RUA reports, then we tighten to quarantine then reject.
- **Phase 0 sprint hygiene closed** (Beatrice's three flagged items): codename narrowing in `LEAK_PATTERNS` (with deliberate care not to false-positive on real-world phrases like "Atlas Property Management"), `atlas.deal-analysis` dead-code scrubbed, `dashboard.tsx` orphan in `uiSnapshots.test.ts` removed. Test suite back to 60/60 green there.
- **Recovered Iris's untracked test specs.** Two files from her Phase Zero-One verification dispatch (#182) — the 17-assertion contract suite + the real-browser Pax-founder-gate E2E — existed on disk but had never been committed. They're now in main; CI will run the E2E on every push.
- **Zernio social-API wrapper scaffolded** at `server/services/zernio/index.ts` — typed `publishPost()` ready to fire once you've connected LinkedIn on Zernio's side.
- **UpTimeRobot setup script** written and deployed at `scripts/uptimerobot-setup.mjs` (with one wrinkle below).
- **FOUNDER_EMAIL env added to `e2e-mobile.yml`** — Iris's flagged coverage asymmetry (#184) is now structurally unblocked; the founder-positive spec itself is a future-Iris item.
- **SES script idempotency hardened** — re-running it now handles AWS's `ConflictException` cleanly when a production-access request is already pending.

## ⚠️ Yellow — needs you, all small

Five items, all under 5 min each.

1. **Rotate UpTimeRobot + Zernio API tokens.** I exposed both literal values in my own debug output while diagnosing why Fly secrets weren't injecting (the underlying issue turned out to require `fly secrets deploy` not just `fly deploy`). Both should be considered compromised by the conversation transcript. Rotate UpTimeRobot at `uptimerobot.com → My Settings → API Settings → Regenerate Main API Key`. Rotate Zernio at their dashboard. Then `fly secrets set UpTimeRobot=<new> Zernio=<new> -a acreos && fly secrets deploy -a acreos`. **Tracked as #194.**

2. **PostHog secret rename.** Your secret is named `PostHog`; client code reads `VITE_POSTHOG_KEY`. Vite only exposes VITE_-prefixed env to the client bundle and reads them literally — so analytics is currently silently no-op. Fix: `fly secrets unset PostHog && fly secrets set VITE_POSTHOG_KEY=<your phc_... key from posthog.com> -a acreos && fly secrets deploy -a acreos`. **Tracked as #195.**

3. **UpTimeRobot monitors via dashboard, not API.** Live finding: their free-tier Main API key is read-only for monitor management — `newMonitor` returns `access_denied` even with the absolute-minimum payload. You have 1 existing monitor ("Acreos.io"); add 3 more in the dashboard for `/api/healthz`, `/api/status`, `/api/version`. Once they exist, the script `scripts/uptimerobot-setup.mjs` becomes a verifier. Alternatively, BetterStack and Healthchecks.io both have free-tier APIs that allow programmatic creation — happy to swap if you'd rather the team manage monitors via code. **Tracked as #192.**

4. **LinkedIn Company Page.** You said you'd do this today. Once it exists, paste me the URL and I'll have Soren queue the 3 seed posts through Zernio.

5. **Canonical domain decision** (acreos.io vs acreos.com): still pending from earlier. The codebase is split — public-facing on .io, legal/email-sender on .com. SES is now wired for .io. If you want .io to be canonical end-to-end, I'll do the cleanup pass. **Tracked as #191.**

## 📋 Backlog state

- **49 tasks completed** today; **9 pending** (5 listed above + 4 deferred-by-design like Reg-Z compliance work that's gated on Phase 1).
- Phase 0 transition gate is fully met on the team side. Activation event is now gated only on (3) — UpTimeRobot monitors — and (4) — LinkedIn — to be fully ready for trickle launch.

## 💰 Capital note

Three deploys overnight, well within the bootstrap envelope. No paid-tier upgrades. No new vendor commitments. UpTimeRobot free is sufficient (limitation noted); SES sandbox-to-prod is free; Zernio first 2 accounts free.

## Daily one-line preview (will fire at 7am ET via the cron)

```
2026-06-02 · MRR $0 · trials 0 · uptime 99.99% · compliance green ·
cost <$50/mo · decisions waiting 5 · Autonomy Horizon 47 days
```

— Solene
