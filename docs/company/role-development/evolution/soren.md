# Soren — role evolution log

_Append-only ledger. Newest at the top._

## 2026-06-02 — Baseline tranche 1 development shipped

Soren's role evolved from "writes content that ships" to "writes
content with a continuous-monitoring tracker on the downstream signal."
The foundational piece:

- **SEO ranking tracker for the 10 `/learn` pages** — SERP scrape with
  honest constraint about Google API costs. Soren now sees per-keyword
  per-week ranking movements rather than guessing whether the `/learn`
  push moved the needle.

What this *does not* yet close (queued for tranche 2): per-piece
conversion attribution dashboard, A/B testing framework via PostHog
flags, competitor monitoring, voice-drift detector for shipped
landing/blog/email content.
