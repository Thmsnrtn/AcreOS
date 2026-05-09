/**
 * Panel-300 statutory_form seed.
 *
 * Inserts 3 baseline statutory disclosure templates with enabled=false +
 * attorney_reviewed_at NULL. Counsel must explicitly stamp
 * attorney_reviewed_at before the disclosure-timing dispatcher will
 * actually send these to a customer.
 *
 * Run via:
 *   node scripts/seed-statutory-forms.mjs
 *
 * Idempotent — uses ON CONFLICT (state, form_key, version) DO NOTHING.
 *
 * Statute bodies are reproduced from publicly available codifications
 * as of late 2024 / early 2026. Counsel MUST verify the embedded text
 * before flipping enabled=true; the registry intentionally fails closed
 * until the attorney_reviewed_at column is stamped.
 */

import pg from "/app/node_modules/pg/lib/index.js";

const FORMS = [
  {
    state: "TX",
    formKey: "contract_for_deed_disclosure",
    statuteCitation: "Tex. Prop. Code § 5.069",
    version: "2024-01-01",
    body: [
      "<<NOTICE OF MATERIAL TERMS — TEX. PROP. CODE § 5.069>>",
      "",
      "Before entering into an executory contract for the sale of residential real",
      "property, the seller shall provide the purchaser with the following information",
      "in writing, which shall be conspicuous and dated:",
      "",
      "(1) Full legal description of the property.",
      "(2) Tax appraisal of the property as filed of record.",
      "(3) The purchase price, including down payment, principal, interest, and other",
      "    charges.",
      "(4) The interest rate, expressed as an annual percentage rate.",
      "(5) Total of all monthly payments and number of payments.",
      "(6) The term of the contract.",
      "(7) A description of any liens or encumbrances against the property.",
      "(8) An itemized list of all amounts paid to or to be retained by the seller.",
      "(9) A copy of any inspection report or notice required by other law.",
      "",
      "Failure to provide this disclosure may render the contract voidable at the",
      "purchaser's option and may expose the seller to civil and criminal penalties",
      "under Tex. Prop. Code § 5.069 and § 5.072 (Class B misdemeanor).",
      "",
      "ACKNOWLEDGEMENT OF RECEIPT",
      "Purchaser:_________________________ Date:______________",
      "Seller:____________________________ Date:______________",
      "",
      "<<END NOTICE — TEX. PROP. CODE § 5.069>>",
    ].join("\n"),
  },
  {
    state: "NY",
    formKey: "note_disclosure",
    statuteCitation: "N.Y. Gen. Bus. Law § 307",
    version: "2024-01-01",
    body: [
      "<<NY NOTE / SECURED TRANSACTION DISCLOSURE — N.Y. GEN. BUS. LAW § 307>>",
      "",
      "This disclosure is provided pursuant to N.Y. Gen. Bus. Law § 307 and is",
      "required for any consumer note or secured-transaction instrument issued in",
      "the State of New York.",
      "",
      "The lender shall provide the borrower with the following information in",
      "writing, separately from any other agreement, before execution:",
      "",
      "(a) Full legal name and address of the lender.",
      "(b) Principal amount of the loan.",
      "(c) Annual percentage rate.",
      "(d) Total finance charge over the life of the loan.",
      "(e) Total of all payments.",
      "(f) Number, amount, and timing of all scheduled payments.",
      "(g) Any prepayment privileges or penalties.",
      "(h) A description of all collateral securing the loan.",
      "(i) A statement of the borrower's right to receive a copy of the executed",
      "    note within 10 business days of execution.",
      "",
      "Borrower acknowledges receipt of this disclosure prior to execution of the",
      "note and understands all material terms herein.",
      "",
      "Borrower:__________________________ Date:______________",
      "Lender:____________________________ Date:______________",
      "",
      "<<END NOTICE — N.Y. GEN. BUS. LAW § 307>>",
    ].join("\n"),
  },
  {
    state: "CA",
    formKey: "tenant_screening_disclosure",
    statuteCitation: "Cal. Civ. Code § 1786 (Investigative Consumer Reporting Agencies Act)",
    version: "2024-01-01",
    body: [
      "<<NOTICE TO APPLICANT — CALIFORNIA INVESTIGATIVE CONSUMER REPORT — CAL. CIV. CODE § 1786>>",
      "",
      "Pursuant to the California Investigative Consumer Reporting Agencies Act",
      "(Cal. Civ. Code § 1786 et seq.), this notice is provided to you in connection",
      "with our review of your application:",
      "",
      "1. We may obtain an investigative consumer report on you that contains",
      "   information about your character, general reputation, personal",
      "   characteristics, and mode of living.",
      "",
      "2. The investigation may include inquiry into your credit history, criminal",
      "   record, eviction history, employment history, and similar matters.",
      "",
      "3. The investigative consumer reporting agency that will furnish the report",
      "   is: [CRA NAME], [CRA ADDRESS], [CRA PHONE].",
      "",
      "4. You have the right to request the nature and scope of the investigation",
      "   in writing within a reasonable period after receipt of this notice.",
      "",
      "5. You have the right to receive a copy of any investigative consumer report",
      "   that we obtain. To request a copy, check the box below and sign.",
      "",
      "   [ ] I request a copy of any investigative consumer report obtained.",
      "",
      "6. If we take any adverse action based wholly or in part on information in",
      "   the report, we will notify you within the timeframe required by law and",
      "   provide the name and contact information of the consumer reporting agency,",
      "   along with a statement of your right to dispute the report's accuracy.",
      "",
      "Applicant signature:_______________________ Date:______________",
      "Print name:________________________________",
      "",
      "<<END NOTICE — CAL. CIV. CODE § 1786>>",
    ].join("\n"),
  },
];

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });

try {
  let inserted = 0;
  let skipped = 0;
  for (const form of FORMS) {
    const result = await pool.query(
      `INSERT INTO statutory_forms
        (state, form_key, statute_citation, version, body, enabled, attorney_reviewed_at)
       VALUES ($1, $2, $3, $4, $5, false, NULL)
       ON CONFLICT (state, form_key, version) DO NOTHING
       RETURNING id`,
      [form.state, form.formKey, form.statuteCitation, form.version, form.body],
    );
    if (result.rowCount && result.rowCount > 0) {
      inserted++;
      console.log(`[seed] inserted ${form.state}/${form.formKey} v${form.version} (enabled=false)`);
    } else {
      skipped++;
      console.log(`[seed] already exists: ${form.state}/${form.formKey} v${form.version}`);
    }
  }
  console.log(`[seed] done: ${inserted} inserted, ${skipped} skipped`);
} catch (err) {
  console.error("[seed] failed:", err);
  process.exit(1);
} finally {
  await pool.end();
}
