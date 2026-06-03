# Krieger — role evolution log

_Append-only ledger. Newest at the top._

## 2026-06-02 — Baseline tranche 1 development shipped

Krieger's role evolved from "audits mobile-feel periodically" to
"enforces mobile-feel contracts in CI on every PR." The foundational
pieces:

- **Cross-device matrix expansion** — iPhone SE + iPhone Pro Max +
  iPad-mini added to `playwright.mobile.config.ts` (previously
  iPhone-14 + Pixel-5 alone).
- **Mobile-feel contract spec** — `tests/e2e-mobile/mobile-feel-
  contracts.spec.ts` covers touch-target sizing, `active:` companion
  states, and `dvh` viewport units. CI workflow gates merges.
- **Krieger discipline doc** — `docs/design/krieger-mobile-feel-
  contracts.md` formalizes the contract bar.

What this *does not* yet close (queued for tranche 2): typed `useHaptic`
primitive, PWA-specific standalone-mode surfaces, automated mobile-
accessibility scan via axe-core.
