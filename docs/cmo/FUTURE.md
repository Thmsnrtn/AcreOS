# CMO Engine — Future work captured during the v1 build

Things that came up while building v1 that don't block ship but are worth
the next pass.

## R2 storage swap (v2)

`server/services/cmo/storage.ts` already has a clean interface. The R2 driver
is a stub. When we're ready, swap by:
1. Stand up R2 bucket + access keys
2. Implement `R2Driver` (or use `@aws-sdk/client-s3` against R2's S3-compatible API)
3. Set `CMO_STORAGE_DRIVER=r2` on Fly secrets
4. Migrate existing local files via a one-time copy (or let them age out — local renders auto-expire as ads cycle)

Trigger: founder volume on the worker machine fills up or we want public signed URLs (e.g. for sharing previews outside the founder UI).

## Founder-proposed brand profile updates

The architecture mentions "once a quarter, the agent proposes brand profile
updates." That's a v6 feature; placeholder code lives in `cmoAgent.ts`. To
ship:
1. Add `brand_profile_proposals` table (proposed banned_phrase / tone additions, with rationale citing rejection notes)
2. New tab on `/founder/cmo` for review
3. Scheduled job at the 1st of every month

## Avatar mode

Brand profile already has `voice` as a jsonb with provider field. Adding
HeyGen requires:
1. Extend `voice.provider` enum to include `heygen`
2. Add `useAvatars: boolean` on the brand profile
3. New Remotion template `AvatarHookBroll.tsx` that composites the talking-head MP4 returned by HeyGen
4. Cost gates — avatars are 10-20x voiceover cost; route only `forcePremium` calls through

## Multi-format expansion

Static-image ads (1:1 / 1.91:1) already work via the existing
`adCreativeService`. The right move is to unify them under the same
`/founder/cmo` review surface — generate static + video bundles together,
review side-by-side. Schema is ready; needs UI work in `cmo.tsx`.

## Direct DALL-E / OpenRouter image gen for product screenshots

Pexels/Pixabay don't cover product screenshots. Two options:
1. Hand-curate a `/companies/acreos/assets/screenshots/` library
2. Generate product-realistic compositions via DALL-E in the existing
   `adCreativeService` and pipe them into the stock-asset fetcher

Pick (1) for v2 — agents producing product screenshots is a quality risk
we don't need to take on.

## Performance attribution past the platforms

CTR/CPM/ROAS from Meta + TikTok are necessary but not sufficient. Real
attribution is signups in the org table. Wire `signupAttribution` in
schema.ts to the `tracking_id` field on `cmo_ad_renders` — UTM round-trip
through landing → auth → org row. Schema already has UTM columns on
organizations.

## Scheduling without a cron job

`server/jobs/runScheduledJobs.ts` is the canonical scheduler. The weekly
refresh just needs an entry there (Monday 09:00 ET → emit
`cmo.weekly-refresh` outbox event). One-line add when we're ready to
turn autonomy on.

## Eval suite

The existing `evals/run-eval.ts` harness can be extended to evaluate the
script generator's output against golden test prompts (brand-voice match,
hook strength, compliance pass-through). This is the right way to
regression-test prompt changes before they ship.
