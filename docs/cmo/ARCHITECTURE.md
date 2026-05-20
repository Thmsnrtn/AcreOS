# AcreOS CMO Ad Engine — Architecture

Native ad generation, approval, and broadcast. Replaces Creatify with an
owned pipeline that costs $0.20–0.40 per ad fully loaded and gets
measurably better with every founder rejection and every CTR/ROAS data
point it ingests.

## Pillars

1. Generate — script (OpenRouter Haiku) → pre-render score → voice (ElevenLabs cloned founder) → stock B-roll (Pexels + Pixabay, deduped) → Remotion render in three aspect ratios
2. Approve — every broadcastable artifact stops at `decisions_inbox_items` for founder review at `/founder/cmo`
3. Broadcast — approved bundles ship to Meta + TikTok via durable, idempotent `outbox` jobs
4. Learn — daily performance ingest writes day-grain `cmo_ad_performance` rows; the archetype scorer reweights generation toward winners

## Data model

```
brand_profiles          ← the load-bearing artifact
  ↓
cmo_scripts             ← every script, with archetype + score + cost
  ↓                       (status: draft → scored → rejected_pre_render | queued_for_render → rendered)
cmo_ad_renders          ← 3 rows per script (one per aspect ratio)
  ↓                       (status: queued → rendering → ready → approved → broadcasting → live | error)
cmo_ad_performance      ← daily snapshots, (render_id, platform, date) unique
cmo_hook_archetypes     ← rolling 30d CTR/ROAS, generation_weight feeds back into generator
cmo_asset_usage         ← dedup window so we don't reuse Pexels clips inside 30d
cmo_rejection_notes     ← founder feedback that flows into next-batch context
cmo_budget              ← daily/weekly/monthly caps, enforced before any external spend
```

## Module map

```
server/services/cmo/
  brandProfiles.ts        — seed + read/write brand profile
  archetypes.ts           — 12-archetype taxonomy + seeder
  scriptGenerator.ts      — OpenRouter Haiku JSON generator
  scriptScorer.ts         — Haiku classifier (brandVoice + hookStrength + compliance + novelty)
  storage.ts              — Local-FS driver in v1; R2 stub for v2 swap
  costTracker.ts          — per-call estimates + budget gates
  renderOrchestrator.ts   — script → 3 MP4s + manifest + approval queue item
  archetypeScorer.ts      — rolling 30d weighting reapplied after each ingest

server/integrations/
  elevenLabs.ts           — voice (caches by content hash)
  stockAssets.ts          — Pexels + Pixabay, deduped against usage history
  metaAdsVideo.ts         — video upload + creative attach to Meta
  tiktokAds.ts            — TikTok Marketing API video upload + ad creation

server/jobs/
  cmoVideoRender.ts       — outbox handler for 'cmo.render-script'
  cmoBroadcast.ts         — outbox handler for 'cmo.broadcast'
  cmoPerformanceIngest.ts — daily worker job (scheduled)

server/services/agents/
  cmoAgent.ts             — generateBundle() shared by manual / reactive / scheduled triggers

apps/remotion/
  src/index.ts            — three compositions: ad-9x16, ad-1x1, ad-16x9
  src/templates/HookOverlayBroll.tsx — hook overlay → B-roll cycle → end card

scripts/
  cmo-seed.ts             — seed brand profile + archetypes
  cmo-generate-script.ts  — CLI for script generation + scoring (--dry-run supported)
  cmo-render-ad.ts        — CLI to render a scored script

client/src/pages/founder/
  cmo.tsx                 — the single review + approval + intelligence surface

server/routes-cmo.ts      — founder-only API:
  GET    /api/founder/cmo/dashboard
  GET    /api/founder/cmo/brand-profile
  PATCH  /api/founder/cmo/brand-profile
  GET    /api/founder/cmo/budget
  PATCH  /api/founder/cmo/budget
  POST   /api/founder/cmo/generate
  POST   /api/founder/cmo/approve
  POST   /api/founder/cmo/reject
  GET    /api/founder/cmo/asset
  GET    /api/founder/cmo/archetypes
```

## Outbox event types

| event_type | producer | consumer | purpose |
|---|---|---|---|
| `cmo.manual-generate` | `/api/founder/cmo/generate` | `cmoAgent.handleCmoGenerateEvent` | founder-initiated batch |
| `cmo.render-script` | `cmoAgent.generateBundle` (per passed script) | `cmoVideoRender.handleCmoRender` | render the 3 MP4s |
| `cmo.broadcast` | `/api/founder/cmo/approve` (per render per platform) | `cmoBroadcast.handleCmoBroadcast` | upload to Meta or TikTok |
| `cmo.weekly-refresh` | scheduler at Mon 09:00 ET | `cmoAgent.runWeeklyRefresh` | 3 cold + 2 retargeting variants for review |

## Environment + secrets

| Secret | Required for | Source |
|---|---|---|
| `AI_INTEGRATIONS_OPENROUTER_API_KEY` | all script generation + scoring | openrouter.ai dashboard |
| `ELEVENLABS_API_KEY` | voiceover | elevenlabs.io Pro plan |
| `ELEVENLABS_FOUNDER_VOICE_ID` | cloned founder voice | output of one-time voice clone in ElevenLabs |
| `PEXELS_API_KEY` | B-roll primary | pexels.com/api |
| `PIXABAY_API_KEY` | B-roll fallback | pixabay.com/api/docs |
| `CMO_STORAGE_ROOT` | local FS path for renders (defaults `/data/cmo`) | Fly machine volume mount |
| `META_PAGE_ID` | Meta video creative attach | facebook.com/.../settings (your Page ID) |
| `TIKTOK_IDENTITY_ID` | TikTok ad creative | TikTok Business Center |
| `TIKTOK_DEFAULT_ADGROUP_ID` | TikTok ad attach | TikTok Ads Manager existing ad group |

Plus `founder_ad_accounts` rows for `platform='meta'` and `platform='tiktok'`
with their respective `accessToken` and `adAccountId`.

## Founder review UX

`/founder/cmo` is the single screen. Responsive parity:
- Phone (≤640px): single column. Tap a bundle to expand inline preview + manifest. Approve and Reject are full-width buttons.
- Desktop (≥1024px): same IA. Manifest sits next to the preview. Keyboard shortcuts: `j/k` to navigate bundles, `a` to approve, `r` to reject.

Approval is always two-step (Approve → Confirm with platforms checked) so no accidental broadcasts. Rejections take 4 suggested tags plus an optional free-form note; both stored to `cmo_rejection_notes` and read into the next generation's system prompt.

## Cost model (v1 budget)

- Script generation: ~0.5–1¢ per script (Haiku at ~300 prompt + 300 completion tokens)
- Pre-render scoring: ~0.5¢ per script
- Voiceover: 0¢ inside ElevenLabs Pro plan (~30 ads/mo headroom); $0.18 per 30-sec marginal
- Stock B-roll: 0¢ (Pexels + Pixabay both free)
- Render: ~2¢ per aspect ratio (Fly worker compute)

Per-ad fully loaded: $0.20–0.40. Monthly at 30 ads: ~$10 + ElevenLabs base.
Compared to Creatify Starter ($39 for ~5 quality ads), the engine pays for
itself in week one.

Budget caps live in `cmo_budget`: $20/day, $100/week, $350/month default.
Agent stops generating when any cap is hit, surfaces a notification, founder
can lift caps from `/founder/cmo`.

## Learning loop (what makes it compound)

Three feedback channels:
1. Founder rejection notes → loaded into next-batch system prompt as "the founder consistently rejected variants for these reasons; avoid these patterns."
2. Performance attribution → archetype scorer reweights `generation_weight` every day after ingest. Top-performing archetypes get up to 2× selection probability; demoted archetypes get min 0.25× (still get exploration weight to avoid lock-in).
3. Brand profile evolution → once a quarter, the agent proposes brand profile updates based on 90 days of rejections and performance. Founder approves via `/founder/cmo`.

The first month is Creatify-replacement. By month three, the engine knows AcreOS's marketing better than any agency could.

## Pre-flight checklist before first ad ships

- [ ] `AI_INTEGRATIONS_OPENROUTER_API_KEY` set on Fly ✅ (already live)
- [ ] `ELEVENLABS_API_KEY` set on Fly
- [ ] Founder voice cloned in ElevenLabs; `ELEVENLABS_FOUNDER_VOICE_ID` set on Fly
- [ ] `PEXELS_API_KEY` and `PIXABAY_API_KEY` set on Fly
- [ ] `META_PAGE_ID` set on Fly
- [ ] `founder_ad_accounts` row exists for `platform='meta'` with valid access token + ad account ID
- [ ] `founder_ad_accounts` row exists for `platform='tiktok'` if shipping to TikTok
- [ ] `TIKTOK_IDENTITY_ID` and `TIKTOK_DEFAULT_ADGROUP_ID` set on Fly
- [ ] Fly worker volume mounted for `/data/cmo` (or set `CMO_STORAGE_ROOT` to a path with persistent storage)
- [ ] Remotion deps installed in `apps/remotion/` (`npm install` inside that dir on the worker once on first deploy)

## Phases shipped

- ✅ Phase 0 — Schema + brand profile + AcreOS seed
- ✅ Phase 1 — Script generator + scorer + CLI (`npm run cmo:generate-script`)
- ✅ Phase 2 — ElevenLabs + Pexels + Pixabay integrations
- ✅ Phase 3 — Remotion render pipeline (3 aspect ratios)
- ✅ Phase 4 — `/founder/cmo` responsive review surface
- ✅ Phase 5 — Meta + TikTok broadcast jobs
- ✅ Phase 6 — Performance ingest + archetype scoring
- ✅ Phase 7 — Autonomous CMO agent + weekly refresh

## Out of scope for v1 → v7

- Avatar / talking-head generation (HeyGen / D-ID)
- Generative B-roll (Runway / Veo / Sora)
- Multi-language ads
- Self-hosted TTS
- Foundry-side multi-tenant abstraction
- Image-only ad regeneration (the existing `adCreativeService` handles that)

See `FUTURE.md` for items captured during build.
