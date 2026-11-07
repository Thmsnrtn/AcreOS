# Founder decisions — 2026-11-05 (1099-NEC output gate)

Made by Tom in session on 2026-11-05, after a read-only inventory found the
1099-NEC generator (`POST /api/contractors/1099-nec-batch`) live with no
qualified-output gate, while its 1099-INT sibling refuses (DEFECT-0101).

## 1. Gate 1099-NEC like 1099-INT, behind its own determination

**Decision:** the NEC batch generator refuses until a qualified tax reviewer
(K13) confirms the 1099-NEC reporting threshold. It uses the SAME gate as
1099-INT (`requireQualified1099Output` in `server/services/form1099Refusal.ts`),
parameterized by form, with its own ladder flag
`tax.1099nec.threshold_confirmed`.

- Same founder bypass, same fail-closed 422 `not_qualified_filing_output`.
- The NEC refusal states the NEC reason (the unconfirmed threshold), never the
  INT direction problem.
- An INT determination never opens NEC; an NEC determination never opens INT.
- The threshold value (`NEC_THRESHOLD_CENTS`, $600) is NOT changed. The figure
  is the reviewer's determination, exactly like INT.
- Gated action: the POST batch generation. The GET preview is not gated by this
  decision.

**Options that were offered.**
- A — one gate parameterized by form, a separate NEC flag: **chosen**
  (recommended).
- B — one shared "1099 review" flag for both forms: rejected; one sign-off would
  open both forms, so an INT-only review would open NEC on an unconfirmed figure.
- C — mount the INT gate verbatim on NEC: rejected; NEC customers would receive
  the INT direction refusal text, which is false for NEC.
