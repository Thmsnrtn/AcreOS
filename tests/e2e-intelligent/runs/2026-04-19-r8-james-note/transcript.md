# E2E Intelligent Test Transcript

- **Run ID**: 2026-04-19-r8-james-note
- **Persona**: 05-note-investor-seller-finance (James — seller-finance note investor)
- **Journey**: 04-note-servicing-setup
- **Date**: 2026-04-19T22:06:00Z
- **Target**: https://acreos.io
- **Protocol**: API-first
- **Steps**: 3

## Summary

Tested note creation, amortization math, and borrower portal endpoint surface.

## Steps

1. `POST /api/notes` with `{originalPrincipal: 20000, currentBalance: 20000, interestRate: 10, termMonths: 84, monthlyPayment: 332.14, downPayment: 5000, startDate: 2026-05-01, firstPaymentDate: 2026-06-01, status: pending}` → **201 Created**. Note id=1. `maturityDate` auto-calculated to 2033-05-01 (84 months from start). `nextPaymentDate` defaulted to `firstPaymentDate`. Tax escrow defaulted off. `gracePeriodDays: 10` default. **All core fields accepted and returned correctly.**
2. `POST /api/notes/amortize` with `{principal: 20000, annualRate: 10, termMonths: 84}` → **404 Not Found**. No standalone amortization endpoint.
3. Math spot-check: correct monthly payment for 20000@10%/84mo is $332.61. Client-supplied $332.14 was stored as-is. **Server does NOT validate or compute monthlyPayment.**

## Findings

### STR-020 (HIGH): Server accepts arbitrary `monthlyPayment` without validation

- James's journey includes "amortization schedule is mathematically correct" as a success criterion.
- Server trusts client-supplied `monthlyPayment`. A misconfigured UI or a malicious client could set `monthlyPayment: 10` and the server would store it, breaking the entire note's future cash-flow math.
- Recommended: compute `monthlyPayment` server-side from `principal + rate + term`, or at least validate it's within 1% of the amortization formula.

### STR-021 (MEDIUM): No amortization preview endpoint

- `/api/notes/amortize` 404. Real estate pros like James want to sketch terms BEFORE committing to a note — "what does 10% vs 12% look like on a $20k/84mo?" Currently no way to preview without creating a note.
- Recommended: route `POST /api/notes/amortize` to return the amortization schedule for given inputs without creating a record.

## Journey Verdict

- **Outcome**: **COMPLETED_UNSATISFIED**
- **Satisfaction**: 3/5
- **Would Recommend**: **not_yet**
- **Reasoning**: Note creation actually works end-to-end (unusual positive signal this session!). The response data has all expected fields, `maturityDate` is correctly computed, and the schema includes the tax-escrow and fallback-payment-cascade features James would want. BUT: trusting client-supplied `monthlyPayment` is a correctness hazard (STR-020), and the lack of a preview endpoint (STR-021) means you have to commit to terms before seeing the cash-flow shape. Both fixable, neither a launch blocker.

### Top fixes applied during this run

None inline — findings documented for a follow-up pass.
