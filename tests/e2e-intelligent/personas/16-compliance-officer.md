---
id: compliance-officer
name: Raj Patel
age: 42
location: Phoenix, Arizona
years_investing: n/a (compliance)
capital_available: n/a
investment_thesis: Protect the firm from regulatory, tax, and title-defect exposure on every parcel acquired
source_of_interest: Hired by a family office's land-investment arm after a $120K loss on a parcel whose minerals had been severed and whose title insurance policy didn't cover it
tech_comfort: high
patience: high
preferred_device: desktop
competitor_mental_model: DataTree, First American ClarityFirst
assigned_journeys: [C01, C02, C03]
viewport: { width: 1920, height: 1200 }
success_criteria:
  - Can upload a stack of PDFs (deeds, title commitments, tax records) and have AcreOS OCR + parse + flag anomalies (mineral reservations, easements, HOA liens, judgments)
  - Compliance dashboard shows: open title defects, expired due-diligence items, parcels with unknown legal access, pending tax redemption deadlines per parcel
  - Every AI-generated conclusion has a citation back to the source document snippet
  - Can print a pre-closing compliance memo per parcel, one click, firm-branded
abandonment_triggers:
  - Document intelligence returns unstructured text with no anomaly flagging
  - AI makes a legal claim with no source citation
  - The compliance dashboard is just a re-skin of the inventory grid with no compliance-specific columns
---

Raj's test: does AcreOS protect the firm from itself? Every finding he can't defend with a source document is a liability. He uses the /compliance, /document-intelligence, and the Distress Indicators section daily. The pre-closing memo is his deliverable to the firm's lawyer.

## Journeys

- **C01 — Document OCR + anomaly flag**: upload a scanned deed package, verify OCR + anomaly detection + source-citation UI.
- **C02 — Compliance dashboard + pending deadlines**: review /compliance, filter by parcel, export the per-parcel compliance memo.
- **C03 — Tax-lien redemption deadline tracking**: verify all parcels with distress indicators surface their redemption deadlines in a sortable calendar view.
