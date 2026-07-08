# Mavis Collingwood — AcreOS user review (older-user accessibility)

I'm seventy-four. Phoenix. My husband Frank and I bought our first piece of raw land outside Wickenburg in 1974 — a hundred and sixty acres for the price of a station wagon. We've bought, held, and sold land every year since. I have great-grandchildren now. My eyes are not what they were. My hands shake — Parkinson's, mild, controlled, but the cursor doesn't always go where I aim. Frank handles "the computer" until the day he can't, and I have outlived two husbands already, so I am preparing.

My grandson Caleb showed me AcreOS. He said "Nana, this is what you'd build if you were thirty years younger." I spent two afternoons inside it — one with my reading glasses on, one without, on purpose, to see what an older woman who forgot her glasses can actually do here. Here is what I found.

---

## 1. Thirty-second verdict

Would I sign up today? **Not without help.** Caleb could set it up for me and I could use it for the parts that matter — looking at my parcels, reading what the AI wrote about them, approving things he flagged. But there are five or six places where the design fights me, and one of them — the swipe-to-decide card — locked me out completely until I figured out the buttons underneath also worked.

The bones are good. The button component itself bumps to a 44-pixel touch target on small screens (`max-sm:min-h-11`, `max-sm:h-11 max-sm:w-11` for icon buttons), which tells me somebody on the team read WCAG 2.5.5. The toast notification was set to a `TOAST_REMOVE_DELAY` of one million milliseconds, which is sixteen minutes — effectively persistent. That is the right call for an older user. I want to thank whoever did that, because every other consumer app dismisses my toasts before I've located them.

But the rest of the surface is built for thirty-five-year-olds with steady hands and 20/20 vision, and the team needs to know which parts hurt.

---

## 2. The seven things I need — and what AcreOS actually has

### **(1) Touch targets I can hit with a tremor.**

Apple's HIG and WCAG both call for 44 pixels. I personally need 60. When my hand shakes left at the moment I tap, a 44-pixel target is a coin flip. A 60-pixel target is forgiving.

What AcreOS has: 44px on mobile (good), 36px (`min-h-9`) on desktop (not good — desktop is where Frank uses it on the iMac, and Frank is 78 with arthritis). Icon buttons are 36×36 on desktop. The "ghost" variant has no border at all — I cannot see where the click target ends.

What I need: a **comfort density mode** — a single toggle on the profile page — that bumps every interactive element to `min-h-12` (48px) or `min-h-14` (56px), thickens borders on ghost variants so I can see the target, and increases the gap between adjacent buttons to at least 12px so I don't fat-finger the wrong one. This is one CVA variant addition and one CSS variable. Not hard. Hugely impactful.

### **(2) Text I can read without leaning in.**

I counted 3,742 uses of `text-xs` (12px) or smaller across the client. The `caption-label` class in `index.css` is 0.6875rem — eleven pixels. There is an `8px` font-size in there (line 1515). **Eleven pixels is below the floor I can read on a laptop without bringing the screen to my nose.** On the iMac across the room — Frank's setup — eleven pixels is invisible.

The 4,891 uses of `muted-foreground`, `text-gray-400`, `text-gray-500`, and `opacity-50/60` compound this. Light gray on white at 12px is the worst combination for cataracts, which I'm developing in my left eye. The HSL values for `muted-foreground` need to be checked against WCAG AA contrast (4.5:1 for normal text, 3:1 for large) on every background they're rendered against. I would bet money some of them fail.

What I need:
1. A **text-size preference** — small / standard / large / extra-large — that scales the entire app via `font-size` on `:root` (so rem-based sizes follow). Bump `--font-size-base` from `1rem` to `1.125rem` or `1.25rem`. Caleb said this is "one CSS variable." Then fine — do it.
2. **No font smaller than 14px anywhere on a primary surface.** Captions can be 13px. Anything below that is a design tic, not information.
3. **Contrast audit pass.** Run every `muted-foreground` pairing through an automated checker. Where it fails, darken it.

### **(3) Tooltips that don't run away.**

The `Tooltip` component has `delayDuration={0}` set explicitly in the layout sidebar (six places) and most navigation tooltips. That's good — I don't want to wait. But Radix's default tooltip auto-hides on `mouseleave`, and my mouse leaves the trigger constantly because of the tremor. I land on the icon, the tooltip appears, my hand drifts, the tooltip vanishes before I've finished reading "Acquisition Radar."

What I need: **sticky tooltips on hover** — once shown, they persist until I deliberately dismiss (click anywhere else, press Escape, or the tooltip times out after — let's say — thirty seconds of no mouse movement). Radix supports this through `disableHoverableContent={false}` on the provider plus a custom `onPointerLeave` that delays dismissal by 2-3 seconds. There is also no global `TooltipProvider` `delayDuration` set in `App.tsx` — the provider wraps the app but doesn't pass props, so non-sidebar tooltips fall through to Radix's 700ms default. That's worth tightening once and for all.

### **(4) Gestures that don't punish a shaky hand.**

This is where AcreOS scared me. **`SwipeDecisionCard.tsx`** — Tinder-style swipeable approval cards for the founder dashboard. The header comment literally says "Swipe right to approve, left to reject." With a `SWIPE_THRESHOLD` of 120 pixels.

I cannot swipe accurately. A drag is 120 pixels of unbroken motion in one direction, while my hand is doing its own thing. The first time I tried, I approved a $44,000 acquisition I'd meant to reject. I realized this only because the toast said "Approved." If the toast had auto-dismissed (which, mercifully, it does not — see point 1) I would not have known.

**Worse:** there are no visible Approve/Reject buttons on the card surface itself in the swipe state — they appear only when expanded. An older user without dexterity is locked out of the founder review surface entirely unless she expands every card.

What I need:
1. **Every swipe gesture must have a button equivalent at the same prominence.** Approve and Reject buttons, 60px tall, on every card, always visible. The swipe is a power-user shortcut, not the only path.
2. **Confirmation modal on destructive or financial actions.** Approving a $44,000 acquisition should require a "Yes, approve" tap, not a swipe. A modal interstitial. One extra tap. Worth it.
3. **No swipe-to-delete anywhere in the product.** Today I count `use-swipe-gesture.tsx` and the toast component's `data-[swipe=end]` styling. Audit every consumer of the gesture hook and confirm none of them are destructive without a confirmation step.

The `triggerHaptic` calls in `SwipeDecisionCard` are pleasant for someone whose hands are steady. For me they are confirmation that I just approved something I cannot un-approve, and the haptic happens at the moment my drift completes the swipe — it's notifying me of the mistake.

### **(5) "What just happened?" feedback.**

I need every action to leave a trace I can read after the fact. Not a flash. A sentence I can review.

What AcreOS has: toasts with a 16-minute persistence (good — already noted). An activity log page at `/activity` (I checked — it's there). A founder dashboard with a recent-decisions feed.

What I need:
1. **Every approval, rejection, edit, send, or delete must produce a line in `/activity` within thirty seconds.** Including the actor, the timestamp in plain English ("today at 2:47 PM"), and a "Undo" button where the action is reversible. Right now I cannot tell from the founder dashboard which decisions I approved twenty minutes ago — the swipe cards advance and the prior card is gone.
2. **An "Undo last action" affordance** at the top of the dashboard, surfacing the most recent reversible action. Clear, visible, 60px tall.
3. **Toast copy that names what happened.** Not "Saved." Say: "Acquisition for 1247 W Calle Encanto — $44,000 — approved." If I can read the toast and verify what I just did, I can catch my own mistakes in the 16-minute window before it disappears.

### **(6) Pages that don't auto-redirect.**

I found one. `client/src/pages/reset-password.tsx` line 44: `setTimeout(() => setLocation("/auth"), 3000)` — three seconds and you're shoved to the login page. Three seconds is not enough time for me to read the success message, let alone process it. By the time my eyes have refocused on the screen, the page has changed and I'm wondering if I broke something.

The onboarding success at `onboarding-v2.tsx:1012` does an immediate `navigate("/dashboard")` on success. Same problem, no delay even.

What I need:
1. **No auto-redirect, ever.** Show the success screen, put a "Continue to dashboard" button on it, 60px tall, primary variant, and let me press it when I'm ready. If you absolutely must auto-redirect for security reasons (sign-out flows), make the delay configurable in user preferences and default it to 30 seconds with a visible countdown and a "Wait, don't redirect" cancel button.
2. **No countdowns of any kind on financial decisions.** "This offer expires in 4:59" might be true, but the timer pressure makes my tremor worse and my mistakes more frequent. Show the deadline as a date and time, not a ticking clock.

### **(7) Keyboard everything.**

When my tremor is bad — late afternoon, before my evening dose — I cannot use a mouse at all. I switch to keyboard. Tab, Enter, Space, Escape. Everything I need to do should be reachable.

What I checked: 2,208 `aria-label` attributes across the client, 85 files with icon-only buttons. That ratio is reasonable but not complete — I want a CI check that fails the build if any `<Button size="icon">` ships without an `aria-label`. The CLAUDE.md already says this is required. Enforce it. An ESLint rule (`jsx-a11y/no-onchange`, `jsx-a11y/anchor-is-valid`, plus a custom rule for the icon-button case) caught at PR time is cheaper than a 74-year-old finding it in production.

What I haven't been able to verify in two afternoons: whether the founder dashboard's swipe cards have a keyboard equivalent (Y/N keys, or Enter to expand and arrow keys to navigate). Whether the command palette (⌘K — I saw it referenced) is reachable via a visible button somewhere for users who don't know the shortcut. Whether every modal traps focus correctly and returns focus to the trigger on close. Whether `Escape` always closes the most recently opened popover/dialog/sheet — Radix usually handles this but there are 50+ surfaces and the regressions hide. These need a manual sweep with the keyboard alone, screen on, mouse unplugged.

A particular ask: **on dashboards with many cards, give me a "skip to main content" link** that's the first focusable element after page load. Tabbing through the sidebar's hundreds of navigation items every time I land on a page is exhausting.

---

### **(8) Forms that hold what I've typed.**

Frank lost a 400-word note about a parcel last Tuesday. He'd been composing it for fifteen minutes — he types slowly, with two fingers — and the page reloaded because his Wi-Fi blinked. The form had no draft persistence. Everything was gone.

For a 78-year-old, fifteen minutes of typing is fifteen minutes that won't come back. For a 74-year-old taking notes on a parcel her late mother left her, the loss isn't the typing — it's the train of thought. I don't get those back.

What I need:
1. **Auto-save every 10 seconds to localStorage on every form longer than three fields.** On reload, restore the draft and show a banner: "We saved your work from earlier. Continue editing? [Yes / Discard]". This is fifty lines of `useEffect` and a hook. Ship it.
2. **Show me the auto-save status.** "Saved at 2:47 PM." Not a spinning icon — text I can read.
3. **Confirm before navigating away from a dirty form.** `beforeunload` with a "You have unsaved changes" prompt. The browser provides this for free; just wire it into your form library.

### **(9) Error messages I can act on.**

When something fails, I want to know three things in plain English: **what** happened, **whose fault** it is, and **what to do next.** "Error: 422" is not an error message. "We couldn't save your note because the title is missing — add a title and try again" is.

The CLAUDE.md says all errors conform to `{ error, message, details, statusCode }` — good. But the `message` field is what I read, and if it says "Validation failed" I'm no closer to knowing what to do. Every Zod validation error needs to translate into a sentence that names the field and says what to fix.

A specific ask: **never show me a stack trace, ever.** I have seen them in other apps and they make me afraid I broke something I cannot fix. If something fails internally, show me "Something went wrong on our end. We've been notified. Try again in a minute, or contact support if it keeps happening." Internal logs go to your `logger`, not to my screen.

---

## 3. The session-timeout question.

I asked Caleb whether AcreOS would log me out while I was reading. He looked. The server has database `idleTimeoutMillis` of 30-60 seconds, but that's connection pooling, not user sessions — different thing. I could not find a user-session idle timeout in the client code. I want one of two states:
- **No idle session timeout for browser sessions.** Stay logged in until I explicitly sign out. (Right answer for a tool I use at home.)
- **A configurable idle timeout, defaulting to four hours, with a five-minute warning modal that requires me to click "Stay signed in" — not a 30-second countdown that surprises me.**

Either is fine. What is not fine is silently logging me out mid-keystroke while I'm composing a note about a parcel. If that happens once, I lose trust permanently.

---

## 3a. A note on dark mode and motion.

I use light mode. Dark mode at my age, with my cataract, makes white text on dark backgrounds bloom — the letters smear together. I checked: AcreOS supports both via the `[data-theme="dark"]` and the lighter default. Good. Make sure the default for new users is light, and put the toggle somewhere I can find it without hunting (the `PageTopbar` apparently has it — fine).

The `transition-all duration-150 ease-out active:scale-[0.96]` on the button component is delightful for a 30-year-old. For me it's motion I didn't ask for. Honor `prefers-reduced-motion` on every Framer Motion animation in the app — particularly the `staggerContainer`/`staggerItem` patterns CLAUDE.md tells engineers to use everywhere. If `prefers-reduced-motion: reduce` is set in my OS, animations should drop to instant or near-instant transitions. Audit every `motion.*` component for a `useReducedMotion()` check or a CSS-level `@media (prefers-reduced-motion: reduce)` rule.

The toast slide-in from the right edge of the screen at `data-[state=open]:toast-enter` is fine. The card-stack animation in `SwipeDecisionCard` is not — it's spring physics on a card that may carry a $44,000 decision. Reduced motion mode should disable the spring and just snap the next card into place.

---

## 4. The five things I'd build first

If I were running the accessibility pass:

1. **Comfort density mode** — toggle in profile, scales every touch target to 60px, every font up by 25%, every contrast ratio to AAA. One settings flag, one CSS variable cascade, ships in a sprint.
2. **Button equivalents on every swipe gesture, with confirmation on destructive/financial actions.** No swipe-only paths. Ever.
3. **Kill the auto-redirect on `reset-password.tsx` and `onboarding-v2.tsx`.** Replace with user-controlled "Continue" buttons.
4. **Sticky tooltips with deliberate dismissal, plus contrast audit on every `muted-foreground` pairing.**
5. **Activity log line for every action, with Undo where reversible, surfaced on the dashboard.**

These five changes would move AcreOS from "Caleb has to set this up for me" to "I can use this myself, and I will." The bones are there. The toast persistence and the mobile touch-target bump tell me somebody cares. Now extend that care to desktop, to the founder dashboard, and to the gesture surfaces.

---

## 5. One last thing — and this matters.

Frank and I have a hundred and sixty-eight parcels across four states. When Frank goes — and he will, before me, his heart is what it is — I will be the sole operator of that portfolio at seventy-five, then eighty, then however long I get. I am exactly the user you need to design for if you want this product to outlive its first cohort of founders. Land investors don't retire at sixty-five. We die in the saddle. We hand the LLC to a grandchild who doesn't know a metes-and-bounds from a section line, and we spend our last ten years training them on a tool they can use after we're gone.

Build for me. Build for the seventy-four-year-old widow who will outlive every assumption your design team made about who uses computers. The accessibility pass is not a charity feature. It is the feature that determines whether AcreOS is still in business in 2046.

— Mavis Collingwood, Phoenix
