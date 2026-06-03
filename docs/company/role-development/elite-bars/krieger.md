# Krieger — elite-bar tracker

_Last reviewed: 2026-06-02 (baseline seed)._

_Reports through Iris; mobile-feel + interaction-craft scope._

## Current elite bar (2026-06-02)

From single-tap-audit work shipped to date:

- iOS sticky-hover discipline (no `hover:` rules without
  `@media (hover:hover)` guard).
- Safe-area-inset discipline on every fixed/sticky surface.
- Touch-target sizing ≥44pt per Apple HIG (`min-h-[44px]` / equivalent
  on every interactive element).
- Contract tests preserve mobile-feel invariants across refactors.
- Active-companion states (`active:` Tailwind) match Linear's tactile
  feel — every tap acknowledged within a frame.

## Aspirational elite bar

**Apple Human Interface Guidelines + Linear's mobile-feel discipline.**
Specifically:

- **Cross-device matrix is comprehensive**, not iPhone-14 + Pixel-5
  alone. SE / Pro Max / iPad-mini all verified in CI (expansion shipped
  in tranche 1 — bar = the matrix stays current as Apple/Google ship).
- **Mobile-feel contract tests live in CI**, not in periodic audits.
  Contract spec shipped 2026-06-02 (touch-target + active:companion +
  dvh). Bar = every PR runs the contracts.
- **Haptics are a typed primitive**, not ad-hoc. `useHaptic('confirm' |
  'destructive' | 'success' | 'error')` with platform-correct intensity
  per primitive, calibrated against Linear's tactile vocabulary.
- **PWA-specific surfaces polished.** Standalone-mode detection drives
  UI shifts (no-Safari-chrome navigation bar, home-indicator-aware
  bottom-nav padding, install-banner sequencing).
- **Mobile accessibility scanned automatically.** axe-core integration
  in mobile E2E catches VoiceOver/TalkBack regressions in PR review,
  not in user reports.

## Closed this period

_(Empty initially — populated by monthly reviews.)_

## Remaining gaps (from `feedback_team_development_arc.md` baseline)

- ~~No continuous mobile-feel CI gate~~ — **closed 2026-06-02** (cross-
  device matrix + contract spec shipped). Bar going forward: contracts
  stay green on every PR.
- ~~Cross-device matrix narrow~~ — **closed 2026-06-02** (SE + Pro Max
  + iPad-mini added).
- **Haptics ad-hoc** — open. Tranche-2 target: typed `useHaptic`
  primitive replacing every ad-hoc `navigator.vibrate` call.
- **No PWA-specific surfaces** — open. Tranche-2 target: standalone-mode
  detection + standalone-correct UI shifts (no-chrome nav,
  home-indicator-aware padding).
- **No automated mobile-accessibility scan** — open. Tranche-2 target:
  axe-core integration in mobile E2E with VoiceOver/TalkBack-relevant
  rule subset.
