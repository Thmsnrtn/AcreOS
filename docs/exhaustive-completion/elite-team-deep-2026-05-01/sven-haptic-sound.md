# Sven Ostrowski — Haptic & Audio Audit

> The cheapest "Apple-grade" upgrade isn't a new typeface or a hero animation — it's a 10ms tap on the engine mount when the gear engages. Haptic and audio feedback are software's tactile confirmation that something *happened*. Most products either skip them entirely (and feel weightless) or smear them across every interaction (and feel like a slot machine). Almost none get it right.

Kade audited motion. Motion is what you *see*. I'm here for what you *feel* and what you *hear*. They're the same problem — confirmation that a gesture had consequence — solved on different sensory channels. AcreOS today has the bones for both and the discipline of neither.

---

## 1. Verdict (one line)

**Yes, but constrained:** ship a 4-event haptic vocabulary on web today (free, ~120 LoC) and a 0-event audio vocabulary at launch (every chime is a brief-§13 risk and AcreOS hasn't earned the right to make sound yet). Revisit audio only after Capacitor wraps the iOS app.

---

## 2. What exists today (honest read)

I traced every haptic and sound surface in the codebase before writing recommendations.

**Haptics — three call sites, three different contracts:**

| File | Mechanism | Pattern |
| --- | --- | --- |
| `client/src/components/founder/SwipeDecisionCard.tsx:27-33` | `navigator.vibrate(...)` direct | local `triggerHaptic()` helper, light/medium/heavy mapped to `10` / `[10,50,10]` / `[30,30,30]` |
| `client/src/components/mobile/PullToRefresh.tsx:50-56` | `@capacitor/haptics` `Haptics.impact({ style: ImpactStyle.Medium })` | wrapped in try/catch — "Haptics not available (web or unsupported device)" |
| (everywhere else) | nothing | swipes, button taps, deal close, drag-to-reorder, kanban moves, command palette — all silent to the touch |

This is exactly the inconsistency Kade called out for motion vocabulary, manifesting one layer below: the founder's swipe deck speaks one haptic dialect (web vibrate API only), the customer's pull-to-refresh speaks another (Capacitor only — silent on web), and 95% of the app speaks none.

**Audio — one stub, zero playback:**

- `client/src/hooks/use-sound.ts` is a placeholder. `play(_kind)` is a no-op with a comment: *"Stub: actual audio playback wires up alongside the audio asset bundle in Phase 2 Shell."* The shape (`tick | chime | pop | success | error`) is locked, the assets don't exist.
- `client/src/components/modals/deal-closed-modal.tsx:33` dispatches `window.dispatchEvent(new CustomEvent("acreos:sound", { detail: { kind: "deal-closed" } }))` — but nothing listens to that event. It's a hopeful broadcast into a void.
- `PreferencesCard` (Settings → Appearance) already exposes the sound toggle, off by default, disabled when `prefers-reduced-motion` is set, with this user-facing copy: *"Soft clicks on key actions and a chime when a deal closes."* That promise is currently a lie — there are no clicks and no chime. **Either ship the chimes or rewrite the copy.** Shipping nothing is the worst of the two options because the user toggles it on, hears nothing, and concludes the feature is broken.
- `@capacitor/haptics` is in `package.json` (line 53). No corresponding audio Capacitor plugin is installed.

**Reduced-motion respect:** `use-sound.ts:36-43` correctly disables sound when `prefers-reduced-motion: reduce` matches. This is, per Kade's audit, the *only* runtime usage of reduced-motion in the entire app. The hook does the right thing; the hook is just unused.

---

## 3. The haptic vocabulary proposal — 4 events, no more

The discipline question is the whole question. Most apps fail at haptics by mapping every interaction to a buzz. iOS Mail does six: tap selection (light), pull-to-refresh trigger (medium), swipe-action commit (medium), error (notification-error pattern), send-success (light tick), delete-confirm (heavy). That's the ceiling AcreOS should aim *under*.

Four events earn their place. Names matter — pick them now so the codebase doesn't drift:

| # | Event name | Web (`navigator.vibrate`) | iOS Capacitor (`@capacitor/haptics`) | When it fires |
| --- | --- | --- | --- | --- |
| **1** | `tick` (selection) | `10`ms | `Haptics.selectionStart()` + `selectionEnd()` | Long-press begins, segmented-control snap, swipe-action threshold crossed (the "you've now armed delete" moment) |
| **2** | `confirm` (light impact) | `[8, 30, 8]` | `Haptics.impact({ style: ImpactStyle.Light })` | Action committed: deal stage moved, lead archived, swipe action released past threshold, pull-to-refresh trigger |
| **3** | `success` (notification) | `[10, 50, 10, 50, 20]` | `Haptics.notification({ type: NotificationType.Success })` | Deal closed (first close per session), goal hit 100%, decision-queue resolved with no errors |
| **4** | `error` (notification) | `[30, 30, 30, 30, 30]` | `Haptics.notification({ type: NotificationType.Error })` | Form validation rejection, network failure on critical action (offer submit, deal close), undo expired |

**What did *not* make the list (and why):**

- A "page transition" haptic — Kade argues page transitions shouldn't even animate. They certainly shouldn't buzz.
- A "hover" haptic — hover doesn't exist on touch; on desktop trackpads it would feel intrusive and macOS doesn't expose it through web APIs anyway.
- A separate "drag-start" vs "drag-end" pair — `tick` covers both; using one signal for two events teaches the user a richer grammar with one less buzz.
- A "warning" between success and error — three notification levels feels like a slot machine. Two is enough; if it's not success, it's an error.
- A keystroke haptic in the command palette — typing in a text field with each keystroke buzzing is the single fastest way to make a user reach for the off switch.

**The grammar rule:** every haptic in the app is one of these four. If a new interaction needs a fifth, the answer is "no" — figure out which of the four it actually is.

---

## 4. The audio vocabulary proposal — 0 events at launch, 1-2 max ever

I am skeptical of audio. Here is why:

1. **AcreOS is workplace software.** Land Investors run this in shared offices, on mobile during property visits, in cars on Bluetooth. A chime that fires while someone's on a Zoom call about a $200K deal is not a moment of polish — it's a moment of cringe.
2. **Brief §13 explicitly forbids confetti.** A "cha-ching" deal-close sound is the audio equivalent of confetti. Same dopamine, different channel. If §13 forbids the visual, the auditory is forbidden by extension.
3. **Sound off by default in `useSound` (`use-sound.ts:32`) is correct.** But "off by default" plus "muted at OS level for reduce-motion" plus "muted when in a meeting" plus "muted when the tab is backgrounded" means the actual hearing rate is ~5%. So every minute spent on sound design is amortized over 1 in 20 sessions. Bad ROI.
4. **The settings copy already promises "soft clicks on key actions and a chime when a deal closes."** Either keep that promise with two carefully chosen sounds, or change the copy. **My recommendation: change the copy.** Replace with *"Replay guided tour."* Move sound to a future toggle when there's actually audio behind it.

**If sound *must* ship at launch, the entire vocabulary is two:**

| # | Sound | When | Spec |
| --- | --- | --- | --- |
| **1** | `tick` | Command palette open / close | 40ms, ~2kHz, -18 dBFS, single decay, no pitch ramp. Should be *quieter than typing on a MacBook keyboard.* |
| **2** | `success` | Deal closed (first close in session) | 350ms, two-note ascending interval (C5→G5), warm bell timbre, decay tail to silence. Apple Mail's *whoosh* is the reference — confirmation, not celebration. **No "cha-ching." No coin. No fanfare.** |

What's explicitly excluded:
- Notification sound (the OS handles this; layering app sound on top is a category error)
- Error sound (a haptic + visual shake + toast is sufficient and doesn't shame the user audibly in a coffee shop)
- Hover/click sounds (this is not a 1998 Geocities site)
- Onboarding completion fanfare (brief §13)
- "First lead added" celebration (operational moment, not earned)

**If you ship one sound only, ship `tick` (command palette).** Power users hit ⌘K thirty times a day; a 40ms tick is the closest software gets to feeling like a mechanical keyboard. It's the sound that earns its keep through frequency, not occasion.

---

## 5. Per-surface recommendations

Mapping the 4 haptic events to surfaces. Asterisk means web-haptics-only today, native-only via Capacitor later.

| Surface | File | Event | Notes |
| --- | --- | --- | --- |
| Pull-to-refresh trigger | `components/mobile/PullToRefresh.tsx` | `confirm` | Already wired to Capacitor. Add `navigator.vibrate` fallback for Android Chrome web. |
| Swipe-action threshold (arming) | `<SwipeRow>` (Kade Day 7) | `tick` | The instant the row crosses the commit threshold *during the drag*, not on release. This is the single biggest "wow this feels native" win. |
| Swipe-action commit (release) | `<SwipeRow>` | `confirm` | On release past threshold. |
| Long-press start | `<TouchContextMenu>` (Kade Day 8) | `tick` | At the 500ms hold mark — this *is* the affordance saying "press is registered." Without it, long-press feels broken. |
| Deal stage move (kanban drop) | `pipeline.tsx` | `confirm` | On successful drop to a new column. Not on cancel-drop. |
| Deal close (first per session) | `deal-closed-modal.tsx` | `success` | Already has the broadcast; just add the listener. Throttle to once-per-session — second close of the day reuses `confirm`. |
| Goal hit 100% | `goals` celebration (Kade Hero #2) | `success` | One-time only, per `goals.completed_celebrated_at`. |
| Form validation reject (Submit clicked, errors found) | every form | `error` | Pair with the existing shake animation; don't double-up haptic on per-field blur. |
| Undo-expired toast | toast surface | `error` | Subtle — informs the user the safety net just retracted. |
| Command palette open | `command-palette.tsx` | (none — desktop-primary surface) | Haptic on a MacBook trackpad via web is unsupported; skip. The audio `tick` (if shipped) covers this. |
| Button tap | `ui/button.tsx` | (none) | Tempting but wrong. Buttons fire dozens of times per session; per-tap haptic = noise. Reserve haptic budget for *committed state changes*, not every press. |
| Switch / checkbox toggle | `ui/switch.tsx` | (none) | Same reasoning. The visual is sufficient. |
| Modal open / close | (any) | (none) | Modals are visual events. Haptic them and the user trains to expect haptics on every visual change. |
| Page navigation | `App.tsx` | (none) | Per Kade — pages shouldn't even animate. Definitely shouldn't buzz. |

The shape of this table is the discipline: **way more "(none)" entries than haptic entries.** That's correct. Restraint is the product.

---

## 6. Settings + accessibility

Today's controls (`PreferencesCard`):
- Sound effects: single boolean toggle, off by default. No haptic toggle.
- `prefers-reduced-motion` disables sound and disables the toggle entirely.

What needs to change:

**Add a haptic toggle.** Sibling to sound, same Card, same off-by-default? **No — haptics should be on by default.** Reasoning:
1. Haptics are physical-channel only — they don't disturb anyone but the holder.
2. The OS already provides a system-level "system haptics" toggle (iOS: Settings → Sounds & Haptics → System Haptics). Users who hate haptics turn that off and we inherit the setting via `Haptics` failing silently.
3. Browser-level `navigator.vibrate` requires HTTPS and a user gesture; if unsupported, our calls are no-ops. So the "off" path is automatic for unsupported devices.
4. On by default, opt-out for the rare user who wants total silence on a fully-supported device.

**Respect chain (in priority order):**

```
1. window.matchMedia("(prefers-reduced-motion: reduce)") → both off, both disabled in UI
2. user preference stored in `acreos-haptics-enabled` / `acreos-sound-enabled` (localStorage now, server later)
3. capability detection — if !("vibrate" in navigator) and !Capacitor, both no-op silently
4. environmental gates — sound suppressed when document.hidden or document.visibilityState === "hidden"
```

`use-sound.ts` does step 1 and step 2. It does **not** do step 4 (sound that fires while the tab is backgrounded is a horror). Add a `document.visibilityState` gate before any audio playback.

**Suggested rename:** `useSound` → `useFeedback`. Expose `play(kind: HapticKind | SoundKind)` as a unified API. Today the codebase has `triggerHaptic` in one component, the unimplemented `useSound`, and a `window.dispatchEvent("acreos:sound")` in another. Three contracts for one concept. Unify.

**Settings copy (rewrite):**

```
Sound effects        [toggle, off]    Soft tick when the command palette opens.
Haptic feedback      [toggle, on]     A subtle tap on key gestures — pull to refresh, swipe to archive, deal close.
                                       Disabled by your "reduce motion" setting.
```

Honest, narrow, deliverable.

---

## 7. Implementation cost — web today vs Capacitor later

**Phase A — web haptics + cleanup (1 day, free).**

1. Replace the local `triggerHaptic` in `SwipeDecisionCard.tsx:27-33` with a centralized `useFeedback().haptic(kind)` hook that wraps `navigator.vibrate` with the four-pattern table above.
2. Add the same hook as the haptic source in `PullToRefresh.tsx` so web users (Android Chrome) get a buzz alongside Capacitor users.
3. Add the haptic toggle to `PreferencesCard` (sibling to sound).
4. Wire haptic into the existing swipe surfaces — at minimum `SwipeDecisionCard`, `MorningBriefing` pull-to-refresh, and (when Kade's Day 7 ships) `<SwipeRow>` and `<TouchContextMenu>`.
5. Delete the dead `acreos:sound` `CustomEvent` dispatch in `deal-closed-modal.tsx:33` or wire it through `useFeedback` — don't leave broadcast-into-void code in the tree.
6. Rewrite the `PreferencesCard` sound copy to match what's actually shipping (zero sounds, or one tick).

Total: ~120 LoC, 1 PR, no new deps (the Capacitor haptics dep is already installed).

**Phase B — Capacitor wrap (deferred, 2–4 weeks when iOS shell is built).**

The haptic story gets meaningfully better in a wrapped iOS app:

- `Haptics.notification()` on iOS plays the system success/error patterns — these are the ones users *recognize* from native apps. Web `vibrate` can only approximate them.
- `Haptics.selectionChanged()` (the segmented-control / picker tick) is genuinely impossible to replicate on web — it's a precise 1-2ms tap that the iPhone Taptic Engine produces, far cleaner than any vibrate-ms-pattern.
- Capacitor adds capability for a wrapped haptic preference UI that mirrors iOS Settings → Sounds & Haptics layout. Power-user gesture.

If/when Capacitor ships, the `useFeedback` hook abstracts the difference — `haptic('success')` dispatches `Haptics.notification({ type: NotificationType.Success })` on native, `navigator.vibrate([10,50,10,50,20])` on web, and the four-event vocabulary stays identical. **This is why naming the events generically (tick / confirm / success / error) instead of platform-specifically (light-impact / medium-impact) matters now.** The investment is portable.

**Phase C — audio (deferred indefinitely).**

Don't ship sound at launch. If Phase B ships and feedback says "AcreOS feels great on iOS but silent — we want a confirm sound," then ship the two-sound vocabulary. Until then, sound is a Brief §13 trap waiting to happen.

If audio *does* ship later: use the Web Audio API directly (no `<audio>` tag), pre-decode at app boot, gate every playback through `document.visibilityState === "visible"` and `useFeedback().soundEnabled`, and cap volume at -18 dBFS. Loud sounds are an instant uninstall.

---

## 8. Brief-§13 discipline — what to NOT add

Pinning these explicitly so a future PR doesn't sleepwalk into them:

| Tempting | Why not |
| --- | --- |
| "Cha-ching" coin sound on deal close | Brief §13 audio equivalent; gambling-app energy. Apple Mail's whoosh is the ceiling, not the floor. |
| Confetti haptic burst (multiple impacts in rapid succession) | Same §13 violation, different channel. One `success` notification, done. |
| Per-keystroke haptic in command palette | Slot machine. |
| Per-character haptic in numeric input (price entry) | Calculator-app feel; AcreOS is a CRM, not a calculator. |
| "Achievement unlocked" sound when checklist item completes | §13. Operational moment, not earned. |
| Notification sound layered on top of OS push notification | OS handles this; double-sound is a bug. |
| Drag-while-dragging continuous haptic rumble | Cute on iOS Maps, exhausting in a CRM. |
| "Welcome to AcreOS" voice greeting on first login | Land Investors do not need their property software to talk to them. |
| Per-tab-focus tick when window regains focus | The user already knows they refocused. |
| Error sound that plays during form-field validation as the user types | Public shaming. The visual + haptic on submit is sufficient. |

**The §13 test for any new haptic or sound:** *would I be embarrassed if a Land Investor's spouse, sitting next to them on the couch, heard or felt this 30 times in an evening?* If yes, it doesn't ship.

---

## 9. The discipline summary

Four haptics. Zero sounds at launch (one if you must, two ever). One unified `useFeedback` hook. Off-by-default sound, on-by-default haptics, both gated on `prefers-reduced-motion`. Same vocabulary on web today and Capacitor tomorrow.

The instrument metaphor: a piano has 88 keys and Glenn Gould only used the same dozen patterns. A great app has thousands of possible interactions and only four haptic phrases. The user learns those four — *tick is selection, confirm is committed, success is earned, error is wrong* — and then every gesture in AcreOS speaks the same four-word language.

That's what makes software feel like an instrument. Not the haptic itself. The *grammar* of the haptic.

— Sven
