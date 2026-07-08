# Aurelio Mancini — Field-Mobile UX Audit

**Wave 2 · 87-Persona AcreOS Audit · 2026-05-01**
*5 yrs building field-tech for utility crews + ag co-ops. I've watched a substation tech in 110°F drop a tablet, curse, and abandon the workflow. AcreOS is being judged from a parking lot in Hays County, TX, in July, with one bar of LTE and dust on the screen.*

---

## 1. One-line verdict

**B-minus.** AcreOS is the rare CRM that wasn't designed entirely at a desk — there is real GPS, real compass, a real offline queue, real voice→Whisper — but the *physics* of the field (gloves, sun, 1-bar LTE, 4MB photos, a phone at 18% battery) are still being modeled like edge cases instead of the default case. Three weeks of work moves this to a solid A.

---

## 2. Touch-target audit (the 60px rule)

Apple HIG says 44px. **Field reality says 60px**, because gloves add ~8mm of imprecision and a moving truck adds another ~6mm. I traced every interactive element on `client/src/pages/field-scout.tsx` and the four `field-scout/*` components.

### What's already correct

- **Floating action buttons** (mic + add): `w-14 h-14` = **56px**. Close. Bump to `w-16 h-16` (64px) and we're field-grade.
- **One-tap action grid** (Call/Text/Note on selected lead): `h-14 flex-col` — **56px tall, full column-width**. Good intent, just needs +8px.
- **"Identify This Parcel"** primary CTA: `w-full` — width is fine, but it's the default `Button` height (40px). Should be `h-14` minimum on this page.
- **"Complete Visit"** CTA: `h-12` (48px). Borderline. Should match the FAB at 56–60.

### What's failing

| Element | Current | Field-grade |
|---|---|---|
| Tab-bar items (Scout/Leads/Map/Visits) | `py-3` ≈ 44px | **60px**, with hit-area expanding 8px above the visual bound |
| Recent-activity list rows (`<button>` per lead) | `p-2` ≈ 36–40px tall | **60px** + chevron-right affordance |
| Quick-Add form inputs (owner / APN / county / state) | `text-sm` default Input ≈ 36px | **52–56px** with `inputMode` hints (see §10) |
| Cancel / Add Lead pair (`size="sm"`) | 32px | **52px** — these are committal actions, never use `sm` in the field |
| Photo-gallery delete (X icon-only on thumbnails — see `photo-gallery.tsx`) | unknown but likely <44px | **48px** with 12px padding + `aria-label="Delete photo"` |
| Lead-card inline Call/Text in `leads` view | `h-7` = **28px** | **48px** — these are accidentally-tappable adjacent to a card-tap that opens the lead. This is the single worst target on the page. |

**The h-7 buttons are dangerous.** A user trying to tap a lead-card opens it; a user trying to call the lead misses and opens it. The discrimination between "open detail" and "fire `tel:` URI" is currently a 28px button inside a 100%-wide card that also captures clicks. Either grow the buttons to 48px and stop card-click propagation, or remove inline call/text from this view entirely and route through the detail card (which already has correctly-sized 56px buttons).

### Spacing — equally important as size

Touch targets need **8px of clearance** between adjacent tappable regions. The recent-activity rows currently have zero. A finger at 12mm wide will trigger two rows simultaneously. Add `space-y-2` minimum.

---

## 3. Offline mode design — the honest review

The codebase has more offline scaffolding than I expected:

- `OFFLINE_QUEUE_KEY = "acreos_offline_queue"` in localStorage, replayed on `online` event.
- Queue handles `create_lead`, `add_note`, `add_photo`, `update_status`, `save_visit`.
- Cached read-only data for `leads` and `visits` keyed by `acreos_cached_leads` / `acreos_cached_visits`.
- `OfflineSyncBanner` with `idle | syncing | success | error` states and progress %.
- Empathetic error copy: "Your draft is preserved … sync when you're back online."

**This is genuinely above bar.** Most CRM mobile views just throw a toast and lose the form.

### But — five field failures I'd still bet money on

1. **localStorage caps at ~5–10MB per origin.** The cached visits + cached leads + queued photo blobs will exceed this in a single afternoon of scouting. **Move the queue to IndexedDB** (use `idb-keyval`, ~700 bytes gzipped) and offload photo blobs there as `Blob` references rather than serialized base64.
2. **Photo blob serialization is broken on cold-start.** Look at the queue: `payload.photoBlob` is a `File`/`Blob`. localStorage will `JSON.stringify` it to `{}`. **The photo silently disappears** when the user closes the tab and reopens after coming back into signal. Test it: set airplane mode, capture photo, save, force-reload tab, restore signal. The sync will run with an empty Blob.
3. **No service-worker fallback for navigation.** I read `client/public/sw.js` (306 lines, 22 cache references). It caches the shell. It does **not** cache `/field-scout` route HTML behind a stale-while-revalidate strategy specifically. If the user opens the app in a dead zone *before* visiting field-scout, they get a white screen, not a cached app.
4. **The "online" event fires on captive-portal Wi-Fi networks** (truck-stop, gas-station). The browser thinks you're online; the API isn't reachable. Sync triggers, fails, marks queue items errored. **Add a heartbeat probe** to a tiny `/api/_ping` endpoint with a 3s timeout before triggering bulk sync.
5. **No conflict resolution.** If a user adds a note offline at 9:14 AM and a teammate edits the same lead at 9:30 AM, the offline replay will overwrite. **Add `If-Unmodified-Since` or a version field** on `PATCH /api/leads/:id` and surface conflicts in the OfflineSyncBanner instead of silently winning.

---

## 4. Photo + voice + GPS workflow

### Photo capture — the single biggest performance bug

Current implementation in `handleAddPhoto`:

```ts
input.type = "file";
input.accept = "image/*";
input.capture = "environment";
// ...
const url = URL.createObjectURL(file);
```

The file is **the raw 12MP iPhone HEIC/JPEG, 3–6 MB**. It's stored as an object URL (which is fine — that's just a pointer) but on upload it's posted as-is to `/api/leads/:id/photos`. On a 1-bar LTE link (~150 kbps real-world up), a 4MB photo takes **~3.5 minutes** to upload. Users will move out of signal, kill the app, drain battery.

**Fix — client-side compression before upload.** Pipe through a canvas:

```ts
async function compressPhoto(file: File, maxDim = 2048, quality = 0.82): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const canvas = new OffscreenCanvas(bitmap.width * scale, bitmap.height * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.convertToBlob({ type: "image/jpeg", quality });
}
```

This drops a 4MB photo to ~350KB with no perceptible quality loss for property documentation. Upload time on 1-bar LTE: ~18s instead of 3.5 min. **Battery savings alone justify this; data-plan savings are a feature you can market to investors on rural cell plans.**

Also: **strip EXIF** by re-encoding through canvas (the above does this implicitly), then re-attach only the fields you need (timestamp, lat, lng, bearing) into a sidecar JSON — never trust EXIF GPS that the iPhone wrote 90 seconds ago when the user was driving.

### GPS — actually well done

`useGPS()` in `field-scout.tsx` uses `watchPosition` with `enableHighAccuracy: true`, `maximumAge: 5000`, and a non-standard `desiredAccuracy: 5`. Compass via `webkitCompassHeading` with iOS 13+ permission flow. Bearing label rendered as 16-point compass rose. **This is field-engineer-quality work.**

Two refinements:

1. **Don't `watchPosition` continuously.** It's the #1 battery drain on iOS. Watch only while the Quick-Add form is open or the user is actively recording a visit. When the page is idle, fall back to `getCurrentPosition` on demand. Wire to `document.visibilitychange` and stop the watch when tab is backgrounded.
2. **Surface accuracy <25m as a blocker for "Identify This Parcel."** Right now, `gpsAccuracyInfo` is rendered but not gating. Under tree canopy, a phone will report ±80m and the parcel-lookup will return the wrong APN. Show a warning state: "GPS too imprecise — wait for trees to clear or step into open."

### Voice — the right architecture, with one omission

`MediaRecorder` → webm → POST to `/api/voice/transcribe` → Whisper → append to notes. Online-or-queue handling. Good.

**Missing: there's no playback before submission.** Users want to verify what they captured before it goes to Whisper, especially because Whisper hallucinates names. Add a play-back step with a "Re-record" affordance, and let users *edit the transcript* before it merges into `currentNote`.

Also — the voice memo is currently **discarded** if transcription fails offline. Save the raw `Blob` to IndexedDB keyed by visit-ID. This lets the user re-listen during a follow-up, even after sync.

### GPS + photo — already correct

Photos receive `latitude`, `longitude`, `bearing` at capture time from the GPS hook. Good. But the *parcel* the photo was taken on is inferred from the lead, not the GPS point. **Do a reverse-parcel lookup at photo capture time** (cached when offline) so a photo taken from across the road doesn't get filed under the road's parcel.

---

## 5. Battery + bandwidth

I count five concurrent battery drains when Field Scout is active:

1. `watchPosition` (high-accuracy GPS) — ~80 mA continuous
2. `deviceorientation` listener (compass) — ~15 mA continuous
3. Mapbox tiles (when `activeView === "map"`) — ~120 mA peak
4. Camera preview during photo capture — ~200 mA peak
5. Active LTE radio holding session for sync — variable but high

**Realistic budget:** an iPhone 14 with Field Scout open continuously will drain ~22% per hour. A four-county scout day kills the phone before noon.

### What to fix

- **Pause `watchPosition` when `document.hidden`** — single biggest win
- **Stop Mapbox tile prefetch** outside the active viewport
- **Use `Network Information API`** (`navigator.connection.effectiveType`) to suppress photo upload on `slow-2g`/`2g` and queue instead. The user shouldn't have to *think* about this.
- **`navigator.getBattery()`** check: if level < 0.2 and `!charging`, switch to "Battery Saver mode" — disable compass, drop GPS to `enableHighAccuracy: false`, suspend background sync. Surface this in the header bar.
- **Wake Lock API** (`navigator.wakeLock.request("screen")`) **only when actively recording voice or capturing visits**. Not page-wide. Right now I see no Wake Lock — which means iOS will lock the screen mid-voice-memo at 30s.

### Bandwidth budget

A typical scout visit currently posts: 1 visit JSON (~2KB) + 4 photos (uncompressed: 16MB) + 1 voice memo (~80KB) ≈ **16MB per parcel**. With compression: **~1.5MB per parcel**. Across 12 parcels in a day on a metered 5GB plan, that's the difference between *0.4% of monthly data* and *4% of monthly data*. Land Investors operating in rural counties run on cheap MVNO plans. They notice.

---

## 6. The "I'm at the parcel" quick-action UX

**The single moment that defines field-mobile quality.** A user is standing in a knee-high field of johnsongrass next to a faded "FOR SALE BY OWNER" sign, holding their phone in one hand, a coffee in the other, with diesel exhaust from a passing truck. They have ~12 seconds of attention before a horsefly distracts them.

Today's flow:

1. Open AcreOS → bottom nav → Field Scout (3 taps, ~6s with auth)
2. Tap "Identify This Parcel" → wait 1–4s for GPS → wait 0.5–3s for parcel API
3. Quick-Add form opens with prefilled fields → tap Photo → take photo → confirm → tap Voice Memo → record → stop → tap Add Lead

**Tap count: 8–10. Time: 35–60s.** Acceptable. Not great.

### What I'd ship — a single-button "Drop Pin" mode

```
[ HUGE BUTTON, 96px tall, full-width, emerald, with haptic ]
   ☰ DROP PARCEL PIN
   GPS · Compass · Photo · Voice · Note
```

One tap:

1. GPS captured (already watching)
2. Compass bearing snapshotted
3. Camera launched immediately (no form first)
4. After photo confirm, **screen flips to a single multi-line voice-memo recorder** with countdown 60s
5. Stops automatically; voice transcribes in background
6. Returns to a 1-tap "Save & Next Parcel" or "Add Notes" branch

**Tap count: 3. Time: ~20s.** And critically — the user never has to type a county name in the field.

The current Quick-Add form is correct for the *desk-followup* phase. It is wrong for the *moment-of-capture* phase. These should be two flows. Capture should be camera-first, form-last.

### Add a "rapid-fire" mode

For tax-sale runs where the user is hitting 30 parcels in 4 hours: lock to GPS + Photo only. No form. Each tap creates a stub lead with `status='unverified'`. Backend creates the lead, parcel-API enrichment happens server-side overnight, user reviews stubs the next morning at their desk. **This is how field-tech apps for utility line inspectors work.** AcreOS should steal this pattern wholesale.

---

## 7. The 2-week field-mobile sprint

A focused, shippable plan. No gold-plating. In priority order — kill them top-down.

### Week 1 — physics fixes

**Day 1–2: Touch targets**
- Promote all field-scout primary buttons to 56–60px
- Fix the `h-7` Call/Text dangerous targets in leads view
- Audit `inspection-checklist.tsx` and `photo-gallery.tsx` icon buttons (Trash2, X) — likely <44px today
- Add 8px clearance between recent-activity rows

**Day 3: Photo compression**
- Add `compressPhoto()` helper, integrate into `handleAddPhoto`
- Strip EXIF, re-attach sidecar metadata
- Verify 4MB→350KB on a real iPhone photo
- Surface "Compressed 4.2MB → 0.34MB" toast (transparency + flex)

**Day 4: Offline durability**
- Migrate `acreos_offline_queue` to IndexedDB via `idb-keyval`
- Persist photo Blobs by reference, not serialized
- Cold-reload test: airplane mode → capture → kill tab → reload → restore signal → verify sync replays photos
- Add `/api/_ping` heartbeat before sync trigger

**Day 5: Battery**
- Pause `watchPosition` on `visibilitychange`
- Add Battery Saver mode triggered at <20% / not charging
- Wake Lock during active voice recording
- Network Information API gate on photo upload

### Week 2 — UX redesign

**Day 6–7: Sun mode**
- Add `prefers-contrast: more` media query path with darker-darks, brighter-brights, +20% font weight on labels
- Add a manual "Sun Mode" toggle in the header (iOS users can't always invoke increase-contrast at the OS level)
- All text below `text-xs` (10px) — there are several `text-[10px]` and `text-[8px]` instances in the header — gets promoted to `text-sm` minimum. The compass-bearing label at `text-[8px]` is unreadable in sunlight.

**Day 8–9: Drop-Pin flow**
- New full-width `<DropPinButton>` at top of Scout view
- Camera-first capture flow
- Auto-recording voice memo step
- "Save & Next" affordance with haptic confirm

**Day 10: Rapid-fire mode**
- Toggle in settings or header
- Stub-lead creation with deferred enrichment
- Visit summary screen at end of session: "You captured 23 parcels in 2h 14m"

**Day 11: Captive-portal + conflict**
- Heartbeat-gated sync
- `If-Unmodified-Since` on lead PATCH
- Conflict surface in OfflineSyncBanner

**Day 12: Voice playback + edit**
- Pre-submit voice playback
- Editable Whisper transcript before merge into notes
- Raw audio Blob retained in IndexedDB

**Day 13: Real-device test day**
- iPhone 12 mini (smallest viewport in fleet) and Pixel 6a — outdoors, mid-day, sunny
- One 90-minute scout session each in real cell-spotty geography (I-35 corridor north of Austin works)
- Bug-bash, file shippable issues, fix what's blocker-grade

**Day 14: Ship + measure**
- Roll behind a `field_mobile_v2` flag
- Instrument: avg time-to-first-photo, avg taps-per-visit, sync-failure rate, photo-upload p95 latency
- Bake for 7 days before full rollout

---

## Appendix — files I read

- `/Users/user/AcreOS/AcreOS/client/src/pages/field-scout.tsx` — 1462 lines, dense, well-structured
- `/Users/user/AcreOS/AcreOS/client/src/components/field-scout/photo-gallery.tsx` — gallery + lightbox, no compression
- `/Users/user/AcreOS/AcreOS/client/src/components/field-scout/inspection-checklist.tsx` — has `h-14` textareas, good
- `/Users/user/AcreOS/AcreOS/server/routes-field-scout.ts` — heads-up: `parcel-lookup` returns **mocked seeded data**, not a real GIS lookup. Whoever shipped this knows. Field UX is great; field *truth* is mocked. That's a different audit (Hana / Brigid / parcel-data persona) but worth flagging to Thomas.
- `/Users/user/AcreOS/AcreOS/client/public/sw.js` — 306 lines, shell-cache only, no field-scout API caching strategy
- `package.json` — Capacitor 8 plugins are all installed (camera, geolocation, network, haptics, push). The web layer should detect Capacitor runtime and prefer native plugins over web APIs (especially camera — native gets you HEIC handling and direct file paths without object-URL lifecycle headaches).

---

*— Aurelio*
*The phone is the truck-bed of the field investor. Treat it like a tool, not a screen.*
