# Otis Carroll — AcreOS, the 2014-MacBook lens

I'm Otis. Sixty-seven, Bristol VA, retired from the freight terminal in 2018 and full-time on tax-delinquent land ever since. My machine is a 2014 MacBook Pro, the silver one with the chiclet keys and the fan that sounds like a hair dryer when it's working. 4GB of RAM. macOS Big Sur — that's the last one Apple lets me run. I cannot replace this laptop. I will not replace this laptop. My wife and I cleared $42K on land last year and that money has a job, and the job is not a $1,400 computer to do the same work the old one already does. So when I tell you AcreOS is the slowest piece of software I run all day, that is not me complaining about a luxury — that is me telling you the product is non-functional on the machine I actually own.

---

## 1. Thirty-second verdict

I open AcreOS in Safari, sign in, and within ninety seconds the bell-curve in Activity Monitor turns red, the fans spin up, and Safari throws me the **"This webpage is using significant memory. Closing it may improve the responsiveness of your Mac"** warning. I have learned to dismiss it before it dismisses me. I keep AcreOS in its own window with nothing else open. If I forget and have Mail and a county GIS tab in another window, the tab crashes inside ten minutes — Safari kills it, the page goes blank, "this webpage was reloaded because it was using significant memory." Imani's audit says the cold-cache cost is 2.0MB raw / 580KB gzipped on first paint. That sounds polite. On my machine, after twenty minutes on the founder dashboard, Safari reports the AcreOS tab consuming **1.4 to 1.8 GB of RAM by itself.** That is not a bundle problem. That is a *retain-everything-and-poll-forever* problem. Imani found the static weight; I'm here to tell you about the weight that grows over time, and the heat my MacBook radiates because of it.

The honest verdict: AcreOS is unusable on my hardware after thirty minutes of work, and I'm the customer who *has* the time to be on it for three hours at a stretch. Fix the schema leak. Then fix the memory leak. They are not the same thing.

---

## 2. Daily-use walkthrough — a Wednesday in February

**6:30 AM.** Coffee. I open the lid. AcreOS tab from yesterday is still pinned, Safari restored it. Within four seconds the fans are on. I haven't touched anything. The tab woke up, fired its react-query refetches (`refetchInterval: 30000` on `notification-center`, `60000` on `system-health`, `5000` on `AgentDebatePanel` — five seconds, on a *founder* panel I don't even have access to but the JS apparently still mounts), and the GPU started compositing the badgePulse animation that runs `2s ease-in-out infinite` whether or not the badge is visible. I haven't asked for anything yet. The product is already working harder than I am.

**6:45 AM.** I navigate to /properties. The page hangs for eleven seconds. Beachball. I time these now — I have a paper logbook because the browser console crashes if I leave it open. The hang is the **mapbox-gl chunk** loading. 1.7MB raw / ~470KB gzipped. Imani flagged it — `properties.tsx` statically imports `<PropertyMap>`, so even when I'm in list view I'm paying for the WebGL tile parser. My 2014 Iris Pro 5100 integrated graphics is not a WebGL renderer. It tries. The fan goes to 6,000 RPM and stays there. By the time the parcel list renders I've lost six minutes of battery to a map I haven't looked at.

**7:30 AM.** I'm reviewing a list of 14 tax-delinquent parcels in Sullivan and Washington counties. I open them in tabs, like a normal person reviews a list. By tab seven Safari starts swapping. The "memory pressure" line in Activity Monitor turns yellow. By tab nine it's red. By tab eleven Safari kills tabs one through four to save itself. I lose my position in the list. **Tab-count tolerance for AcreOS on my machine is six.** Six. A normal news site I can keep twenty open. Each AcreOS parcel-detail tab holds, per Safari's tab inspector: ~180MB. That's because every tab boots its own copy of: `index.js` (602KB), `schema.js` (489KB — Drizzle ORM in the *browser*, Imani's catch), `vendor-motion`, `vendor-ui`, `vendor-clerk`, the founder-dashboard chunk that loads even though I'm not the founder, framer-motion's full motion + AnimatePresence runtime, react-query's cache, Sentry's full session-replay buffer, and somewhere around 23 lucide icons that — per Imani — *might* be tree-shaking, but on my machine I can see the JS heap and they all look present.

**8:15 AM.** I want to compare two parcels side-by-side. I split the window. The split-view triggers `<PropertyMap>` to render twice. The fan, which had calmed down, comes back. Ten seconds later Safari shows me the memory warning. I close one of the panels. The fan does not calm down for another ninety seconds — the WebGL context doesn't release, the tile cache doesn't release, the framer-motion `LayoutGroup` keeps tracking elements that no longer exist. I can hear my MacBook trying to recover. It sounds tired.

**9:00 AM.** Ninety minutes in. I check Activity Monitor: Safari is at 3.2GB total across all processes, AcreOS tab alone is 1.6GB. My machine has 4GB total. macOS is swapping like crazy — 4.1GB of compressed memory, swap used 2.8GB. Every action is now waiting on disk. The original Apple SSD in this machine has done about 40TB of writes over its life, and the SMART data says it has maybe a year left. AcreOS, single-handedly, is *aging my SSD.* I am not making this up. The compressed-memory + swap thrash is writing constantly to the disk because the page won't stop allocating.

**10:30 AM.** I give up and reload the tab. Memory drops to 380MB. Within twenty minutes, back to 1.4GB. **The memory growth is monotonic.** Every parcel I view, every county switch, every panel toggle, the heap grows and never shrinks. This is not normal React. This is a leak — a real one, somewhere between the react-query cache, the framer-motion layout tracker, and the WebGL tile context. I cannot prove which without DevTools, and DevTools on my machine adds 600MB of overhead which makes the leak unprovable because the browser dies before I can measure it.

**1:00 PM.** Lunch. I have eaten my sandwich watching the spinning beachball on /campaigns. The campaigns page chunk is 120KB (per Imani) and pulls vendor-charts (434KB) for some reason. I do not run campaigns. I send postcards from a county absentee list to the county recorder. AcreOS has decided I need a charting library to do that.

**3:00 PM.** I close AcreOS for the day. My laptop is hot to the touch on the underside. The fans run for another four minutes after I close the tab — Safari is GC-ing the heap. My battery, which started at 100% at 6:30, is now at 41%. I have a 56-watt-hour battery (degraded to ~38Wh at this age). AcreOS is consuming **roughly 12-14 watts** sustained when active — about 3x what Mail.app draws on the same machine. I don't have an outlet at the kitchen table. By 4PM I'm tethered.

---

## 3. The RAM postmortem — what's actually in my heap at 1.6GB

I cannot run the Chrome heap profiler. I can run Safari's Web Inspector for about ninety seconds before it crashes the tab. In that window, here is what I have observed across multiple sessions, written in my logbook:

| Source (Safari heap snapshot) | Approx retained | Why I think it's there |
|---|---:|---|
| `mapbox-gl` GL context + tile cache | 280–420MB | WebGL framebuffers, vector-tile workers, geometry buffers, rendered tile bitmaps. Does not release on unmount. |
| react-query cache (default `gcTime: 5min`) | 180–260MB | Every `useQuery` I've touched in the session. The notification-center poll, the conversation-tray poll, the system-health poll, the trial-banner poll all keep accumulating responses. With `refetchInterval: 5000` on AgentDebatePanel and `10000` on conversation-tray, the cache is basically a write-only buffer for me — I never look at the data. |
| `@shared/schema` Drizzle entity classes | 60–80MB resident | Imani: 489KB chunk, but the *resident* cost includes the Symbol registry, the entity-kind metadata, and the locale dictionaries (25 of them) instantiated as JS objects. The download is 489KB; the runtime is bigger. |
| framer-motion `LayoutGroup` tracker | 120–180MB | 52 files import framer-motion. Page-level shells (PageTopbar, PaxCopilotRail) keep `motion.div` instances alive across navigations. Layout animations track measured rects in a Map keyed by node — the Map grows. |
| Sentry session replay | 80–140MB | I see `session-replay` in the network panel. Replay holds DOM mutations in a circular buffer. On a heavy app, the buffer is heavy. |
| Recharts retained virtual DOM | 40–80MB | Founder-dashboard StatCard sparklines (Imani §4b) — 12 instances on the dashboard alone, each with its own d3-scale instance and SVG path cache. They don't unmount when I navigate away because the route chunk stays warm. |
| Lucide icon SVGs (rendered + cached) | 30–60MB | 283 named imports across the client. After a full navigation pass I've touched maybe 80 of them. They render as inline SVG and React keeps the elements warm in the tree. |
| Misc: Clerk session cache, Tanstack Virtual rowCache, react-hook-form unmount-late forms, image data URLs | 100–200MB | The long tail. |

**Total at 90 minutes:** 1.4–1.8GB. macOS gives Safari a soft cap around 2GB before it starts killing tabs. I live in the last ~400MB of headroom and every navigation is a coin flip.

---

## 4. The polling problem — energy and heap together

Imani's report focused on bytes-on-the-wire. Let me focus on bytes-over-time. Here are the `refetchInterval` polls I found on a single session, in their actual cadences:

- `AgentDebatePanel` — every **5 seconds** (founder-only, but mounts even when I'm not founder if the route is reachable)
- `due-diligence-panel` — every **3 seconds** while a dossier is generating (no upper bound; I had one tab where this ran for 47 minutes because the dossier never finished)
- `conversation-tray` — every **10 seconds** (with `refetchIntervalInBackground: false`, mercifully — but only on one of two queries; the other polls in background)
- `team-general-channel` — every **10 seconds**
- `sms-conversation` — every **15 seconds**
- `notification-center` — every **30 seconds**
- `AbsenceMode`, `AgentGrowth`, `StrategicCompass` — every **30 seconds**
- `system-health` — every **60 seconds**
- `usage-limit-banner`, `monthly-checkin` — every **5 minutes**
- `OutcomeFeedback` — every **5 minutes**

At baseline, on a /today landing, I'm firing **~14 HTTP requests per minute** with no user interaction. Each one allocates a fetch promise, parses JSON, runs through react-query's cache, triggers a re-render, allocates a new `data` snapshot. None of those allocations are large alone. All of them together, monotonically, over ninety minutes, are how I get to 1.6GB.

**The cumulative effect is invisible to younger machines.** A 2024 M3 Pro returns those allocations to the heap in microseconds. Mine doesn't. Mine has compressed-memory pressure within twenty minutes and never recovers because the next poll fires before GC can settle.

**Ask:** every `refetchInterval` should be off by default and opt-in by user setting. Or at least gated behind `document.visibilityState === "visible"` AND `!matchMedia("(prefers-reduced-motion: reduce)")`. I keep my Mac on `prefers-reduced-motion` precisely so that animations don't run; that signal should also tell the app to stop polling when I'm not looking.

---

## 5. Animations that thrash my GPU

I counted in `client/src/index.css` and `client/src/lib/animations.ts`:

- **`badgePulse 2s ease-in-out infinite`** — runs forever on every notification badge, even when value is zero. Two of them on the topbar at all times.
- **`shimmer 1.6s ease-in-out infinite`** — every Skeleton component. On a list page with 30 skeletons during initial load, that's 30 GPU layers compositing simultaneously while the page is *also* parsing 2MB of JS.
- **`backdrop-filter: blur(32px) saturate(190%)`** — used on the topbar, sidebar, command palette, and four other surfaces. On Iris Pro 5100, `backdrop-filter` is the single most expensive CSS property I can paint. A 32px blur at saturate(190%) on a sticky header that scrolls *forces a fullscreen recomposite on every scroll frame.* My fans go to 6,000 RPM the moment I scroll a long list.
- **52 framer-motion call sites** — Imani flagged these for bundle size. For me they're CPU. Every `<motion.div>` registers a layout-effect callback, and on a route transition with 80 of them animating simultaneously, my main thread blocks for 400-700ms.
- **`pageEnter 0.3s cubic-bezier(...) forwards`** — wrapped around route transitions. Adds visible jank on top of the 11-second mapbox load. The animation runs *while* the page is still fetching.

**Ask:** honor `prefers-reduced-motion: reduce` — kill all `infinite` animations, drop `backdrop-filter` to a flat `rgba()` background, replace framer-motion `motion.div` with plain `div` via a wrapper that checks the media query. Right now `prefers-reduced-motion` does almost nothing in AcreOS. I checked. The reduce-motion CSS in `index.css` covers maybe 4 keyframes; it doesn't cover backdrop-filter, doesn't cover framer-motion, doesn't cover the sparkline animations, doesn't cover badgePulse.

---

## 6. Fonts — better than I expected, one quibble

`fonts.css` is well-built. Self-hosted variable fonts, latin subset only, `font-display: swap`, six faces total but only one pairing active at a time, and a `native` pairing that loads zero @font-face. Whoever wrote that comment block (B.3 / B.6 audit references) did the right work. My MacBook can chew through Inter Variable in about 80ms once it's local-cached.

**One quibble:** the Fraunces variable file is 280KB by itself (display weight 300-700), and the editorial pairing is the default. On first paint, my machine fetches Inter (350KB) + Fraunces (280KB) + JetBrains Mono (180KB) = ~810KB of font weight. None of that is critical for text-rendering — the system stack fallback is fine — but `font-display: swap` means the page paints in fallback then re-flows when the variable loads, and on my machine the re-flow costs a 200ms layout-thrash. A persuasive default for low-power devices is the **`native` pairing** (zero font load). The product detects `prefers-reduced-motion`; it should also detect `(prefers-reduced-data: reduce)` and `navigator.hardwareConcurrency <= 4` and auto-select `native` for those users.

That single switch would save me 810KB on first paint and one full layout reflow.

---

## 7. The "too much memory" warning — what triggers it on my machine

I have logged 47 instances of the Safari memory warning while using AcreOS over the last six weeks. The pattern:

| Trigger | Time-to-warning |
|---|---:|
| Open /maps from cold cache | 3-5 minutes |
| Open /properties + split view | 8-12 minutes |
| Open 6 parcel detail tabs | 4-7 minutes |
| Sit on /today (founder dashboard) idle | 22-35 minutes |
| Open /campaigns then /analytics back-to-back | 6-9 minutes |
| Leave any AcreOS tab in background while doing other work | 45-60 minutes (the polls keep going) |

Compare: I have a Wells Fargo banking tab open right now that's been alive for three days at 180MB. AcreOS hits that in ten minutes from a fresh load. The threshold for the warning, on Big Sur with 4GB RAM, is roughly 1.6-1.8GB per tab. AcreOS hits it because it never releases.

---

## 8. The fix list, ordered by what helps Otis most

I am not going to invent fixes Imani didn't already write down. I am going to **reorder her list by impact-on-old-laptop**, which is different from impact-on-bundle.

| Rank | Fix | Old-laptop benefit | Imani's bundle benefit |
|---|---|---|---|
| 1 | **Schema-leak split** (`@shared/schema` → db/types/forms) | −60-80MB resident on every tab, faster first paint, less GC churn | −440KB raw / −100KB gzipped |
| 2 | **Lazy-wrap `<PropertyMap>`** so /properties doesn't pull mapbox until I click the map tab | −280-420MB GL context never instantiated when I'm in list view | −180KB on /properties |
| 3 | **Gate every `refetchInterval` on `document.visibilityState === "visible"`** | −14 requests/min when I'm not looking; the heap finally has room to GC | (Imani didn't cover this) |
| 4 | **Honor `prefers-reduced-motion` for backdrop-filter and framer-motion**, not just keyframes | Drops fan from 6,000 RPM to 3,000 RPM on scroll; saves ~3W sustained | (Imani didn't cover this) |
| 5 | **LazyMotion + domAnimation** | −100MB framer-motion runtime over a session | −100KB raw / −25KB gzipped |
| 6 | **Replace `<AreaChart>` in `stat-card.tsx` with inline SVG sparkline** | −40-80MB recharts retention on founder-dashboard | −50KB |
| 7 | **Auto-select `native` font pairing** for `hardwareConcurrency <= 4` or `prefers-reduced-data` | −810KB first-paint, −1 layout reflow | (font work, not bundle) |
| 8 | **Add a "Low-power mode" toggle** in settings that turns 1, 3, 4, 7 on at once and disables Sentry replay client-side | The user with the old laptop opts in; the user with the M3 Pro is unaffected | (UX) |
| 9 | **Investigate the monotonic heap growth** — likely `LayoutGroup` + react-query `gcTime` interaction. Set `gcTime: 60_000` instead of the 5-minute default. | The single biggest win — caps the leak at the source | (none) |
| 10 | **Drop Sentry session-replay client-side** for free-tier users, or sample at 0.5% | −80-140MB resident, −2-4W sustained | (none, but install size) |

Items 3, 4, 8, 9, 10 are not in Imani's report and are not in Reza's bones audit. They are mine. They are the items that turn AcreOS from *unusable on a 2014 MacBook* to *usable for two-hour sessions before a manual reload.*

---

## 9. The ask — a "Low-Power Mode" SKU-or-toggle

I do not need a discount. I am happy to pay $49/mo. I need a **toggle in settings** that says:

> **Low-power mode** — for older laptops, low-RAM devices, or when battery is below 30%.
> - Disables auto-refresh polls (manual refresh only)
> - Disables session replay
> - Disables decorative animations and backdrop blur
> - Forces system fonts (no @font-face downloads)
> - Defers map and chart libraries until explicitly opened
> - Caps react-query cache at 60 seconds
> - Disables the founder-dashboard route entirely if not founder

Detect `navigator.hardwareConcurrency <= 4` OR `navigator.deviceMemory <= 4` OR `(prefers-reduced-data: reduce)` and **prompt the user to enable it on first sign-in**, with a one-line explanation. Don't force it. Offer it.

That toggle, plus the schema-leak fix, plus the visibility-gated polls, gets me from "AcreOS crashes my browser every 25 minutes" to "AcreOS runs for three hours without a reload." That is the entire delta between *I cancel after 30 days* and *I tell every land investor at the Bristol courthouse to sign up.* And there are seven of us at that courthouse every week, and four of us have laptops older than mine.

---

## 10. One sentence

The 2014 MacBook is not a fringe case — it's the median rural-investor's machine, and AcreOS today is a young person's app written for young people's laptops on young people's batteries.

— Otis
