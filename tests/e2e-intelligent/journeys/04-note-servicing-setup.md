---
id: note-servicing-setup
name: Note Servicing Setup
title: Note Servicing Setup
goal: Configure a seller-financed note with correct amortization terms and verify the borrower portal is functional.
description: Set up a seller-financed note, verify amortization math, and confirm borrower portal access.
start_url: /
max_steps: 140
timeout_minutes: 30
estimated_duration_minutes: 25
starting_state: Authenticated user with at least one closed deal in the pipeline that was sold on seller-finance terms.
success_criteria:
  - User creates a new note with principal, interest rate, term length, and down payment
  - Amortization schedule is generated and mathematically correct
  - Monthly payment amount matches standard amortization formula
  - Borrower portal at /portal is accessible and displays the note details
  - Payment schedule, balance, and payoff amount are visible in the borrower portal
  - Late-fee configuration and default threshold are set correctly
success_conditions:
  - Note record created with all required financial fields
  - Amortization schedule visible with correct payment breakdown
  - Monthly payment matches manual calculation within $0.01
  - Borrower portal renders note details
abandonment_criteria:
  - Note creation form is missing critical fields like interest rate or term length
  - Amortization calculation is visibly wrong (payments do not sum to principal + interest)
  - Borrower portal returns a 404 or authentication error
  - Down payment is not deducted before amortization begins
  - No way to set late-fee terms or default thresholds
common_failure_modes:
  - Amortization formula uses simple interest instead of compound, producing wrong totals
  - Down payment field accepts negative values or values exceeding the principal
  - Borrower portal link generation fails if the buyer has no email address on file
  - Interest rate field accepts values like "12" but treats it as 12x (1200%) instead of 12%
  - Note maturity date is calculated incorrectly for terms not evenly divisible by 12
---

# Journey Context

Seller financing is where land investing becomes a recurring-income business. Instead of selling a parcel for a lump sum, the investor sells on terms: the buyer makes a down payment and then monthly installment payments over 2-10 years, with interest. This transforms a one-time profit into a stream of monthly cash flow. For many real estate professionals, the note portfolio is the endgame — it is the asset that generates passive income.

This journey tests the complete note-setup workflow. The persona has already closed an acquisition and found a buyer willing to purchase on terms. Now they need to formalize the arrangement in AcreOS: create the note, define the terms, generate the amortization schedule, and give the buyer access to a portal where they can view their balance and make payments.

The persona navigates to the Notes section (under Finance or CRM, depending on the navigation path). They create a new note and fill in the terms: sale price ($19,900), down payment ($2,990 — 15%), financed amount ($16,910), interest rate (10% annual), term (60 months). The system should calculate the monthly payment automatically using the standard amortization formula. For these inputs, the correct monthly payment is $359.01. If the system shows a different number, the persona — especially a financially sophisticated one — will notice immediately and lose trust.

Once the note is created, the persona reviews the amortization schedule. This is a month-by-month table showing: payment number, payment amount, principal portion, interest portion, and remaining balance. The first payment should show a high interest component that decreases over time as the principal is paid down. The final payment should bring the balance to exactly $0.00. The total of all payments should equal the financed amount plus total interest.

Late-fee configuration is next. The persona sets a grace period (typically 10-15 days), a late-fee amount ($25-50 flat or 5% of payment), and a default threshold (typically 60 days past due). These parameters drive automated notifications and, eventually, the collections workflow.

The borrower portal is the buyer-facing component. The persona navigates to /portal (or generates a portal link to share with the buyer) and verifies that it displays: current balance, next payment due date and amount, payment history, and a payoff request option. The portal must be functional and correctly reflect the note terms the persona just configured.

What "good" looks like: the persona sets up a note in under 5 minutes, the amortization math is demonstrably correct, the borrower portal works on the first try, and the persona feels confident that the system will accurately track payments over the life of the note. The persona might mentally compare the experience to using a spreadsheet — AcreOS should be faster, more reliable, and less error-prone than the Excel amortization template they have been using.

Variations include: the persona creates a note with an unusual term (e.g., 36 months or 84 months), the persona sets a 0% interest rate (some investors offer interest-free terms), or the persona needs to adjust the note terms after creation because the buyer negotiated a lower interest rate.
