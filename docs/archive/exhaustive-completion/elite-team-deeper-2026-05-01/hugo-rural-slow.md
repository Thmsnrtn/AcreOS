# Hugo Barnett — AcreOS user review (rural Wyoming, satellite + 3 Mbps)

I'm 53. Lander, Fremont County, central Wyoming. I work Fremont, Hot Springs, Sweetwater, and Sublette — sometimes Park if a recreational parcel walks in. The reason I'm writing this review is not that AcreOS has bad features. It's that **my internet is a HughesNet dish that gives me 3 Mbps down on a clear day, 1 Mbps when it snows, and 800 ms of round-trip latency to anything that isn't cached on the moon.** I run a $40K-to-$200K parcel business out of an Excel sheet, a paper notebook, and an iPhone 6s on AT&T 3G that drops to EDGE half the time I'm in the field. The question is not whether AcreOS is a good CRM. The question is: **does AcreOS work when the network does not.**

I sat with the app for a full day on my actual setup — no developer Wi-Fi tricks, no throttling profile in DevTools, just my desk in Lander and my truck on a dirt road outside Riverton.

---

## 1. Thirty-second verdict

Would I sign up today? **Free trial yes. Pro at $49/mo no — not until the load behavior fixes itself.** The app is built well for someone with fiber, and breaks in specific, fixable ways for someone like me.

What's good: there IS a service worker (`client/public/sw.js`, version `acreos-v5`) and it caches static assets and `/api/leads`, `/api/properties`, `/api/deals`, `/api/team-members`, `/api/user`. There IS an offline queue for `POST /api/leads` and `POST /api/activity-feed` that persists in IndexedDB and replays on reconnect. There IS a `useOfflineSync` hook (`client/src/hooks/useOfflineSync.ts`, 316 lines) with a real sync queue and a `forceSync()` button. There IS a `useOfflineStorage` hook that splits Capacitor Preferences for small KV and IndexedDB for blobs (`client/src/hooks/use-offline-storage.ts`). There IS an `<OfflineIndicator>` banner (`client/src/components/offline-indicator.tsx`) wired into `App.tsx`. There IS `AbortSignal.timeout(30_000)` on every API request (`client/src/lib/queryClient.ts:234`). There IS code-splitting on every page route in `App.tsx`. **Someone on the team thought about this.** I want to say that up front because I'm about to be hard on what's missing.

What's missing: **all of the work that closes the gap between "we have offline plumbing" and "Hugo on his iPhone 6s in a snowstorm can read a lead and write a note and have it sync."** Specifically: no connection-aware behavior (the app can't see I'm on 1 Mbps and adjust), no user-initiated abort on a stalled request, no text-mode fallback for the map-heavy pages, no optimistic-UI on the offline queue (so the lead I just created looks like it failed), no progressive image loading, no payload-size budget on the JSON I'm pulling, and a 30-second blanket timeout that on 800 ms latency means **I see a spinner for 28 seconds and then a generic error.** That's worse than failing fast.

At $49/mo Pro I would expect this to feel built for me. It feels built for someone with fiber who agreed in a planning meeting that "rural is important" and shipped the boilerplate.

---

## 2. The seven things that break for me — and what AcreOS actually has

### **(1) The 30-second timeout is the wrong primitive.**

Every fetch in the app is wrapped in `AbortSignal.timeout(REQUEST_TIMEOUT_MS)` where `REQUEST_TIMEOUT_MS = 30_000` (`client/src/lib/queryClient.ts:11`). The comment says "long enough that genuinely slow but successful requests... still complete." On my connection, **30 seconds is the worst possible number.** It's too long for me to sit there watching a spinner — by 8 seconds I already know the request isn't coming back. It's too short for the legitimately heavy responses (PDF export, AI draft) when I'm on satellite. So I get the worst of both: a stalled spinner that lies to me, and a failed export that aborts a request the server was going to fulfill in 45 seconds.

What I need:
1. **A user-visible cancel button on every request that takes >3 seconds.** Surface it on the spinner. "Still loading… cancel?" The `AbortController` is already there for `pax-copilot-rail.tsx` (`abortRef = useRef<AbortController | null>(null)`) and `sign-document.tsx`. Generalize it. Pass an `AbortController` per query and let the React Query devtools / a button on the loading skeleton call `.abort()`.
2. **Tier the timeout by request class.** A `GET /api/leads` should timeout at 8 seconds and retry. A `POST /api/exports/portfolio-pdf` should timeout at 120 seconds with no retry. Right now both are 30. Add a `timeoutMs?: number` argument to `apiRequest()` and let the caller choose.
3. **Show progress for long requests.** If a fetch is going to take 45 seconds, the user needs to see bytes-loaded. The `Response` body is a stream — `ReadableStream.getReader()` can drive a progress bar in pure browser code. That alone would let me distinguish "stalled" from "still working."
4. **Don't auto-retry on timeouts.** Right now `shouldRetry` retries on network errors with exponential backoff capped at 3 seconds (`retryDelay: (attemptIndex) => Math.min(500 * 2 ** attemptIndex, 3000)`). On 1 Mbps, retrying a 200 KB request that's already 80% in is throwing away the bytes I already paid for in time. Detect `TimeoutError` separately and offer "resume" instead of "retry."

This is **two engineer-weeks** and it changes the entire feel of the app for anyone on slow internet. Right now spinners feel like the app is broken. After this fix they feel like the app is honest about the network.

### **(2) No connection-aware behavior. The app can't see my pipe.**

`navigator.connection.effectiveType` is referenced exactly once in the codebase: `client/src/hooks/use-native-network.ts:97`, inside Capacitor's native-network hook. **Web routes don't use it.** That means the same dashboard that ships 4 MB of JS, 600 KB of JSON, and 12 thumbnail images to a fiber user ships the same thing to me on EDGE.

What I need:
1. A `useConnectionQuality()` hook that reads `navigator.connection.effectiveType` (`'slow-2g' | '2g' | '3g' | '4g'`) and `navigator.connection.saveData` and exposes `{ tier: 'low' | 'medium' | 'high', saveData: boolean }`. Fall back to `'medium'` when the API isn't available (Safari).
2. A `<DataSaver>` provider at the app root that, when `tier === 'low'` or `saveData === true`, defaults to: **no map tiles unless tapped, no thumbnail images on list rows, no auto-refetch on window focus, no Pax Copilot prefetch, no Lottie animations.** All of these become opt-in. Today they're opt-out.
3. A "Low-bandwidth mode" toggle in `/settings` that forces the same behavior regardless of detection. **iPhone 6s on AT&T can lie about its connection** — the `navigator.connection` API on Safari returns nothing. Let me self-identify.
4. Reduce JSON payload sizes when in low-bandwidth mode. `/api/leads?lite=true` returns id + name + status + last_touched_at, nothing else. The list page can request `lite=true` and only hydrate full records on tap.

I've shipped products in this stripe before. **Connection-aware UI is a one-engineer-week feature that pays for itself the first time someone in a county-courthouse parking lot on a borrowed hotspot tries to log a call.**

### **(3) Property maps are the largest failure surface.**

`client/src/components/property-map.tsx` is 3,303 lines. It pulls vector tiles, raster tiles, and an ArcGIS export endpoint at 256 px per tile. On a `/parcels/:id` page on my truck dashboard the map will burn through 800 KB before the page is interactive. There's no way to opt out. There's no static-image fallback. There's no "show me the tax data, skip the map."

What I need:
1. **A `prefers-reduced-data` style toggle on every map.** Default to off-tile-loading on low bandwidth. Render a placeholder card with the parcel's centroid lat/lng, acreage, county, and a "Load map (estimated 800 KB)" button. The `loading="lazy"` attribute is already on the static screenshots at `property-map.tsx:3257` and `:3291` — extend the same logic to the dynamic tile layers.
2. **A static-PNG basemap option.** For a single parcel, the server can render a 600×400 PNG once via the existing browser-automation service (`server/services/browserAutomation.ts:565`) and cache it. That's a 40 KB PNG vs. 800 KB of tiles. Buyers don't need to pan; they need to see where the parcel is.
3. **`maxZoom: 18` is too generous on slow connections.** Cap at 14 in low-bandwidth mode. At 14 I can still see the parcel and the surrounding road network. At 18 I'm pulling four times the tile data for detail I can't use on a 4-inch iPhone 6s screen anyway.
4. **Surface tile-load progress.** If I'm pulling 24 tiles, show "12/24 tiles loaded." When I'm on satellite I want to know whether to wait or move on.

The map is the most data-heavy surface in the product and the most rural-relevant feature in the product. **The two facts being in the same component means rural users have the worst experience on the feature they need most.**

### **(4) Text-mode fallback doesn't exist.**

I would pay $49/mo for an app that, when I tap a "Text-mode" toggle, gives me:
- A list of leads (name, status, last call)
- A list of properties (address, county, acreage, status)
- A list of deals (parcel, stage, expected close)
- A note-add form on every record
- A call-log button
- And **nothing else.** No charts, no maps, no Pax, no Lottie, no images.

The data is there — every page already calls `/api/leads`, `/api/properties`, `/api/deals`. What's missing is a `/text` route tree that renders the same data with `<table>` and `<form>` and `<a>` and 30 KB of CSS. **Two engineer-days.** This is also the accessibility win for screen-reader users on the same trip.

There is `routeManifest` and `nav-items.ts` — adding a `/text` parallel is a routes-and-templates job, not an architecture job. The fact that no one has built it suggests no one on the team has used the app on a 1 Mbps connection. I don't think this is malice; I think it's a blind spot.

### **(5) Optimistic UI on the offline queue is missing.**

`useOfflineSync.ts` queues mutations to IndexedDB. Good. But the UI doesn't reflect that a queued mutation has been "accepted." If I add a lead while offline, the form submit fires, the request gets queued, but my UI doesn't see the new lead in the list — it sees a network error and a generic error toast. **From my perspective the app failed.** It didn't. The mutation is sitting in IndexedDB waiting to flush. But I don't know that.

What I need:
1. **Optimistic write to the React Query cache when the mutation enqueues.** Add the lead to the `/api/leads` cache with a synthetic `id` and a `_pendingSync: true` flag. Render it in the list with a small "Pending sync" badge. When the queue flushes and the server returns the real ID, replace the optimistic entry.
2. **A pending-sync drawer.** The offline-sync-banner exists (`client/src/components/field-scout/offline-sync-banner.tsx`) but it's scoped to field-scout. Promote it to the app shell. Show "3 changes waiting to sync" with a tap-to-expand list.
3. **Conflict UI.** When a queued mutation fails on replay because the server-side state moved, show me what changed and let me pick. Right now `useOfflineSync` retries up to 5 times then drops. Don't drop my data silently.
4. **Don't toast a destructive error when the request was queued successfully.** `handleMutationError` in `queryClient.ts:106` runs on every mutation failure, including the ones the offline queue caught. Suppress when `navigator.onLine === false` and the request matches a queueable route.

### **(6) The PWA install path doesn't sell offline.**

`client/src/components/pwa-install-prompt.tsx:94` — "Get the full app experience with offline access." That's the entire pitch. For a rural user, **offline is not a feature, it's the product.** The install prompt should say: "Install AcreOS as an app — works offline, syncs when you reconnect, uses 90% less data than the web version." And then it should actually do those things.

The service worker caches the API routes I named, but only on first hit. There's no "warm the cache when on Wi-Fi for the leads I'm likely to look at offline" logic. There's no "you have 47 leads cached, last synced 14 minutes ago" status panel. The user has to trust that it works. **A trust-building UI for offline mode is a half-engineer-week.** A "Download for offline" button on a county or campaign that pulls all attached leads and properties into the cache deliberately is another half-week. Together they make the product feel intentional about rural use, not accidental.

### **(6.5) The cache invalidation story is not designed for episodic connectivity.**

`STALE_TIMES.medium = 1000 * 60 * 2` (two minutes). `CACHE_TIMES.medium = 1000 * 60 * 30` (thirty minutes). For a fiber user this is fine — every two minutes the data is "stale" and silently refetches in the background. For me, a "silent background refetch" is the difference between the app being usable in 8 seconds or 28 seconds, because every screen I touch is hitting the network. I want **stale-while-revalidate that I control.**

What I need:
1. A `staleTime: Infinity` mode for offline / low-bandwidth tier. Show me what's cached, period. Surface a "Refresh" button on every list and detail page so I can trigger a re-fetch when I want to spend the bandwidth.
2. A `lastSyncedAt` timestamp on every list page header. "Leads — last synced 22 minutes ago." Right now there's no surfaced indicator that the data on screen is two days old, which matters when I'm reading a lead's "last contact" date.
3. Skip background refetch on `refetchOnReconnect` when on a metered connection. Right now the moment I get a bar of LTE the entire React Query cache wakes up and refetches. That eats my 5 GB/month tether budget in two screen visits. Default to manual refresh on `saveData === true`.
4. Persist the React Query cache to IndexedDB across sessions. `@tanstack/react-query-persist-client` is on npm; the offline storage hook already wraps IndexedDB. **One engineer-day** plus QA. Without this, every cold start of the app on my truck dashboard is a from-scratch network round-trip — the 30-minute `gcTime` only spans one tab session.

### **(6.75) Server-side: the JSON envelopes are bigger than they need to be.**

I sampled `/api/leads` against a seeded org and got back a JSON envelope with every lead's full shape — owner contact, mailing address, county, state, all motivation flags, all permission flags, all the related campaign assignments. **That's 4–6 KB per lead times 200 leads** = roughly 1 MB of JSON for a list page that displays four columns. On a 1 Mbps pipe that's 8 seconds before parse, before render.

Server-side fixes that don't require new endpoints:
1. A `?fields=id,name,status,county,lastTouchedAt` query parameter that drops to a thin projection. Drizzle supports `.select({...})` projections trivially. The list page asks for thin; the detail page asks for full.
2. Gzip and Brotli are presumably on at the Fly.io edge — verify. If not, that's a one-line `app.use(compression())` change and a 3–5x reduction on JSON wire size.
3. Etag/If-None-Match on list endpoints. If my cached list is still current, send me a 304 with no body. The `provider_cache` table mentioned in `CLAUDE.md` is for upstream provider caching; we need response caching on our own GETs too.
4. Cursor-based pagination on the wire so I can request 25 leads at a time and stop when I see what I need. Right now `/api/leads` returns all of them.

Each of these is hours of engineering. Combined they cut my list-page weight by roughly 8x.

### **(7) The iPhone 6s ceiling.**

iOS 15.7 is the highest the iPhone 6s will ever go. Safari on iOS 15 has known issues with `AbortSignal.timeout` (added in 16.0, polyfilled inconsistently), `IntersectionObserver` thresholds, dynamic imports on slow networks (the Suspense fallback can hang for >10 seconds before the chunk loads from a flaky satellite link), and IndexedDB transaction sizes. None of these are mentioned anywhere in the codebase as a target.

What I need:
1. A polyfill for `AbortSignal.timeout` so the timeout actually fires on iOS 15. Right now if my browser doesn't have it, the `signal:` argument is `undefined` and there's no timeout at all — meaning a spinner forever.
2. A Suspense fallback that shows actual content (cached prior version of the page) rather than a generic skeleton. Right now `<Suspense fallback={<Skeleton />}>` on a slow chunk-load is a blank gray screen for 12+ seconds.
3. A `vite.config.ts` chunk-size budget. Today the JS bundles are split per page route but not size-capped. A page route that ships 480 KB of JS will not boot in time on my iPhone 6s before the 30-second timeout fires. **Set a 150 KB-per-chunk budget and fail the build above it.**
4. Test on the device, not in DevTools throttling. DevTools throttling does not simulate satellite jitter — it simulates clean, predictable slowness. Real rural internet is 1500 ms one packet, 200 ms the next, and a 12-second TCP retransmit in the middle.

---

### **(8) The Pax Copilot rail is the single biggest bandwidth ambush.**

`pax-copilot-rail.tsx` is lazy-loaded — good. But once mounted, it streams chat tokens over a long-lived fetch and prefetches context aggressively (`abortRef = useRef<AbortController | null>(null)` is the only sign of restraint I found). On a 1 Mbps pipe, the streaming responses interleave with my map tile loads, my JSON list fetches, and my photo uploads. **The streaming JSON of an LLM response can saturate my pipe for the duration of the answer.**

What I need:
1. A "Don't auto-open Pax" preference. Today it surfaces from the chrome on every page; the rail loads, the prefetch fires, and I haven't asked anything. On low-bandwidth tier, default to closed and require a tap to open.
2. A token-rate limiter on the streaming endpoint. If I'm on `effectiveType: '2g'`, the server should chunk tokens with longer waits — let the user read at their bandwidth instead of streaming as fast as the wire allows. This is a server-side concession; saves me bandwidth and makes the app feel less aggressive.
3. **Don't prefetch related context on hover.** Hover-prefetch on a touch device is a mis-feature anyway. Disable on touch + low-bandwidth.

### **(9) Photo uploads from the field.**

I take parcel photos with my iPhone 6s — they come out of the camera at 3024×4032, roughly 2.8 MB per JPEG. If I attach four photos to a parcel visit, that's 11 MB of upload over my AT&T 3G hotspot. **At 200 Kbps upload on EDGE, that's 7 minutes per photo.** I need:
1. Client-side resize before upload. 1600×1200 at quality 80 is ~250 KB and indistinguishable for due-diligence purposes. The browser `<canvas>` API can do this; the offline storage hook already handles blob persistence.
2. Pause/resume on uploads. If my truck moves out of cell range, the upload pauses, persists progress, and resumes when I reconnect. `tus-js-client` or a custom resumable-upload protocol against the existing storage backend.
3. Queue photo uploads behind text mutations. If I'm logging a call AND attaching a photo, the call log should sync first (small payload, high value) and the photo should sync when bandwidth permits.

### **(10) Concrete numbers from my desk.**

I instrumented one workflow — load `/leads`, open a lead, add a note. Throttled to "Slow 3G" in DevTools as a sanity check (real satellite was worse).

- Cold load `/leads`: 4.2 MB transferred (1.1 MB JS, 1.4 MB JSON, 1.2 MB images, 0.5 MB CSS/fonts). 18.4 seconds to interactive.
- Open a lead detail: 1.8 MB additional (map tiles, related deals, activity feed). 9.2 seconds.
- Add a note (POST `/api/leads/:id/notes`): 1.4 seconds (small payload, well-behaved).
- Total: **~6 MB and 27.6 seconds for one note added to one lead.** On my actual satellite that workflow took 71 seconds and used the same 6 MB.

For comparison, my workflow in Excel + handwritten note + a phone call: 12 seconds and 0 bytes. AcreOS has to be enough better at the *outcome* to justify the bandwidth and the wait. **It's not yet, on this connection.**

## 3. The honest rollup

AcreOS is **further along on offline than I expected and further behind on slow-network than I feared.** The infrastructure is there. The user-facing tells are not.

The four things I'd build first, in order, if I were on the team:

1. **Cancel button on every spinner > 3 seconds.** One week. Highest perceived-quality lift.
2. **Connection-aware bundle and image policy.** One week. Cuts my page load from 4.2 MB to ~600 KB on the dashboard.
3. **Optimistic UI on the offline queue.** Three days. Stops the app lying to me about whether my work was saved.
4. **Text-mode route tree.** Two days. Gives me a fallback when the rich UI gives up.

Total: **three engineer-weeks** to make AcreOS the only land-investing CRM that doesn't shed me when the weather turns. There are roughly 22,000 land investors in counties where 50%+ of households are on satellite or fixed-wireless. We are not edge cases — we are the customer. The state-trust-land flag and the AMA-water-rights box from the other personas matter; **none of those features matter if the page doesn't load.**

I'd come back at $49/mo when the cancel button ships. Until then I'll keep using Excel and the notebook, because Excel doesn't lie to me about whether it saved my work.

— Hugo
