# Founder Tax Draft-Return Engine (FOUNDER-SIDE ONLY)

Lena (CFO/CIO) + Beatrice (CRO). This documents the prep + self-file-package
engine that lives behind the Life-Cockpit **Taxes** tab. It is **self-prepared
draft software** — it is **not** tax advice and it does **not** e-file (no IRS
MeF). Every figure it produces carries an "estimate — verify before filing"
disclaimer and shows its basis.

## Pieces

| Concern | File |
| --- | --- |
| Year-stamped, citable rule tables (federal + MA) | `server/services/founder/taxRules.ts` |
| Pure computation engine (1040 + MA Form 1, line-by-line basis) | `server/services/founder/taxEngine.ts` |
| Self-file package generator (transcription-ready markdown) | `server/services/founder/taxPackage.ts` |
| Persistence + encryption (compute/store/read draft versions) | `server/services/founder/lifeCockpit.ts` |
| API | `server/routes-founder-life-cockpit.ts` (`/api/founder/life-cockpit/tax/*`) |
| UI | `client/src/pages/founder/life-cockpit.tsx` (Taxes tab) |
| Schema | `shared/schema/founder-life-cockpit.ts` (`founderTaxReturns`, income withholding cols) |
| Migration | `migrations/0126_founder_tax_returns.sql` + `scripts/migrate.mjs` |
| Tests | `tests/unit/founderTaxEngine.test.ts`, `tests/unit/founderLifeCockpit.test.ts` |

## Maintaining the rule tables (the only thing that goes stale)

All tax constants live in `taxRules.ts`, one block per `{jurisdiction, year}`.
Each block is stamped with `taxYear`, a `source` citation, and a `provisional`
flag. **When the IRS / MA DOR publishes a new year:**

1. Add a new `FEDERAL_<year>` / `MA_<year>` constant transcribed from the
   official Rev. Proc. (federal) and Form 1 instructions (MA). Cite it in
   `source`.
2. Set `provisional: false` once the figures are **final**; keep `true` while a
   year is announced-but-not-yet-filed (a 2026 return is filed in 2027).
3. Register it in `FEDERAL_BY_YEAR` / `MA_BY_YEAR` and add the year to
   `SUPPORTED_TAX_YEARS`. Bump `LATEST_FINAL_FEDERAL_YEAR` when a year becomes
   final.
4. Add a hand-verified bracket test to `founderTaxEngine.test.ts` (known income
   → known figure) so a future drift PR can't silently move Tom's numbers.

Years without a table fall back to the latest encoded year and are flagged
`exactYearMatch: false` so the UI says so out loud.

## What the engine models (and what it does NOT)

Models: MFJ/single/HOH/etc., W-2 wages (self + spouse), 1099/side income,
standard deduction, ordinary-income brackets, a flagged self-employment-tax
estimate (½ SE deduction above the line), MA flat tax + personal exemption +
Fair Share surtax, and refund-vs-balance-due from withholding boxes.

Does NOT model (enumerated in `notModeled` and shown to the founder): itemized
deductions, capital-gains preferential rates, AMT, QBI, the credit catalog,
Schedule C expense detail, non-MA state returns, and underpayment-penalty /
safe-harbor analysis.

## Security contract

- Income amounts and the W-2/1099 withholding boxes are **encrypted at rest**
  (`vaultEncryption.encryptAmount`, AES-256-GCM `enc:v1:`).
- Stored drafts (`founder_tax_returns`) store the **entire computed payload** and
  every headline figure **encrypted** — the DB never sees a plaintext tax figure.
- No tax figure is ever logged (route logs carry only year/version/provisional).
- Founder-scoped (`founder_user_id`), gated behind `requireFounder`, never on a
  customer surface, never used to train/shape any customer feature (Quinn's rule).

## API quick reference

- `GET  /tax/draft?taxYear=` — compute from current data, **no** new version saved.
- `POST /tax/draft` — compute **and** persist a new version (the "Generate" button).
- `GET  /tax/returns?taxYear=` — version history (metadata only, never decrypts).
- `GET  /tax/returns/:id/package` — download the self-file package (`.md`).
- `PATCH /tax/returns/:id` — set status `draft | reviewed | filed`.
- `POST/PATCH /income` — accept `federalWithheld` / `stateWithheld` box values.
