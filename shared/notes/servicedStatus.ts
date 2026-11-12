// ============================================================================
// SHARED/NOTES/SERVICEDSTATUS.TS — the status a payment leaves an originated
// (`notes`) row in.
// ----------------------------------------------------------------------------
// Pure and browser-safe: no I/O, no clock, no imports.
//
// WHY ONE FUNCTION. Three payment paths write `notes.status` after money
// lands, each with its own inline expression (Notes V2 Leg 3 Step 0 §8.2,
// rows 9–11):
//
//   row 9   noteRepo.createPayment          server/storage/noteRepo.ts:301
//           status: newBalance <= 0 ? "paid_off" : "active"
//   row 10  achAutopay settlement           server/services/achAutopay.ts:1311
//           status: remainingBalanceCents <= 0 ? "paid_off"
//                 : locked.status === "defaulted" ? "defaulted" : "active"
//   row 11  postServicedNotePayment         server/services/borrower/portalPaymentPosting.ts:451
//           status: newBalanceCents <= 0 ? "paid_off"
//                 : lockedNote.status === "defaulted" ? "defaulted" : "active"
//
// None of them is gated by the origination chokepoint (noteRepo.createNote /
// updateNote), so each was a door from `pending` to `active` guarded only by
// the 0099 DB CHECK — a payment could consummate a note the Reg Z gate never
// saw. Row 9 also re-activated a DEFAULTED note on any partial payment, which
// rows 10 and 11 had already stopped doing (a payment on a defaulted note is
// money toward a cure; reinstatement is the lender's call).
//
// BEHAVIOUR TABLE (prior status × balance after the payment):
//
//   prior                        balance ≤ 0     balance > 0   change vs rows 9 / 10–11
//   ---------------------------  --------------  ------------  ------------------------
//   pending                      pending         pending       CHANGED (all three): a
//                                                              payment never consummates
//                                                              a note, nor moves it on
//   defaulted                    paid_off        defaulted     CHANGED row 9 only (was
//                                                              active); rows 10–11 same
//   active|late|delinquent|      paid_off        active        unchanged (the cure)
//   suspended
//   anything else (paid_off,     paid_off        active        unchanged — PRESERVED as
//   foreclosed, unknown text)                                  the three paths behave
//                                                              today; see the residual
//
// A balance that is not a number compares false against `<= 0` and lands in the
// "balance > 0" column, exactly as the three inline expressions do.
//
// The `pending` row stays `pending` even at a zero balance: `paid_off` would
// still be a status move on a note that was never consummated, and the
// consummation fact (Leg 3's activation record) cannot exist for it.
//
// RESIDUAL, NAMED NOT FIXED: a note that went `pending` → `paid_off` /
// `foreclosed` by PUT without ever activating (Step 0 §8.1) would still be
// flipped to `active` by a payment with a positive balance, as it is today.
// This stage was fenced to change only the pending→active and defaulted→active
// doors; the integration stage should decide whether non-live priors keep
// their status.
// ============================================================================

export function nextServicedStatus(prior: string, balanceCents: number): string {
  if (prior === "pending") return "pending";
  if (balanceCents <= 0) return "paid_off";
  if (prior === "defaulted") return "defaulted";
  return "active";
}
