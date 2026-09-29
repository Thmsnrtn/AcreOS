# Founder decisions — 2026-09-29

*Taken through the decision picker after approving
`docs/company/public-readiness-plan-2026-09-29.md`. Each ruling below is the
founder's and stands until the founder rescinds it explicitly. "Executed"
records what the repository does about it; anything that needs production
access or a purchase is marked 🔑 and stays with the founder.*

| # | Decision | Ruling | Registry |
|---|---|---|---|
| 1 | Document storage backend | **AWS S3.** One AWS account and credential set serves documents, database backups (`server/jobs/dbBackup.ts`) and SES. | DEFECT-0143, 0046 |
| 2 | Parcel data for the list builder | **All sources, layered.** Regrid is the primary parcel and owner layer once its licence is bought (🔑, a spend over $500). ATTOM (already live) and free county assessor data sit behind it, and an honest CSV import path is polished meanwhile. | founder-decisions-2026-07-28 #14 |
| 3 | Borrower servicing after a lender's subscription ends | **90-day wind-down.** Autopay, the borrower portal and periodic statements continue for 90 days while the lender is told to export or move the book. After that, new debits stop and borrowers are told to pay the lender directly. | DEFECT-0106 |
| 4 | Seller life-event motivation signals | **Remove "health" and "retirement" now** (disability and age proxies). **Hold "divorce"** until counsel rules on seller-side marital-status use. | DEFECT-0178 |
| 5 | Where background jobs run | **Worker only.** The app process no longer runs the scheduler in production. | DEFECT-0049 |
| 6 | Late fees on serviced notes | **Build an assessed-fee ledger.** A fee is recorded when grace passes on a missed installment, and payoff quotes and statements include what is owed. | DEFECT-0099 |
| 7 | Win-back sequence | **Dormant until G1.** It is revisited at 25 paying customers, with copy the founder approves. | DEFECT-0150 |
| 8 | List pricing at general availability | **Memo prices (Pro $79, Scale $149, Starter $20) at GA, only if G1's measured gross margin (≥70%) and CAC support them.** Founding members keep their price. | memo 2026-07-08 |
| 9 | Legacy data deletions | **All four authorized:** (a) drop the legacy `payoff_quotes` table after exporting its rows; (b) null plain-text vendor secrets left in `system_api_keys` (and rotate those keys at each vendor 🔑); (c) delete the polluted `market_metrics` rows; (d) delete orphan photo and vision rows once S3 storage lands. | DEFECT-0100, 0155, 0046 |
| 10 | Money columns without precision | **Read-only report first.** A query of max scale and magnitude per column shows what a migration would round. The per-table migration is approved from that report. | DEFECT-0052 |
| 11 | Cross-customer data (data co-op, credit benchmarks, cross-org learnings) | **Opt-in, plus a 5-distinct-operator floor** on every published figure. Consent is wired through `sophiePrivacyGuard`. | DEFECT-0159 |

## How the data rulings are executed

AcreOS's agents have no production database access. Every deletion or
rewrite in #9 and #10 ships as a script under `scripts/data/`. Each script:

- is **dry-run by default** and prints what it would touch;
- exports affected rows before deleting them;
- runs against production only when the founder executes it with
  `--apply`.

A deletion in a deploy migration would run on every environment
unattended. A script runs once, on purpose, with its output in hand.

## Standing constraints these rulings replace

Earlier sessions carried these as "leave to the founder". They are now
decided as above:

- Do not flip `DISABLE_BACKGROUND_JOBS` → **#5**
- Do not drop `payoff_quotes` → **#9a**
- Do not null stored plain-text secrets → **#9b**
- Leave the polluted market rows → **#9c**
- Leave the photo and vision rows → **#9d**
- Do not run the numeric ALTER → **#10**, report first
- DEFECT-0106 → **#3**
- DEFECT-0099 → **#6**
- DEFECT-0150 → **#7**
- `sophiePrivacyGuard` consent → **#11**
- Document storage (0143/0046) → **#1**

`trust_ledger` was not part of these rulings and stays as it is.
