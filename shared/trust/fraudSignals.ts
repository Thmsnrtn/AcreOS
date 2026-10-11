/**
 * Fraud-check signals before purchase (W5a) — shown on a deal before an offer
 * or closing. SIGNALS, NEVER ACCUSATIONS: each says what was seen, where it
 * came from, and the one thing to do about it. Nothing here blocks anything.
 *
 * REFUSE, NOT DEFAULT: every signal has three states — "fired", "clear" and
 * "not_checked". A signal whose data is missing is "not_checked" with the
 * reason, never "clear" (that would certify a check that did not happen) and
 * never "fired" (that would accuse on a guess).
 * tests/unit/fraudSignals.test.ts proves no signal fires on missing data.
 *
 * Browser-safe and pure.
 */

export type FraudSignalId =
  | "mailing_address_changed"
  | "offer_far_below_value"
  | "signer_owner_mismatch"
  | "impersonation_profile"
  | "wire_account_change";

export type FraudSignalStatus = "fired" | "clear" | "not_checked";

export interface FraudSignal {
  id: FraudSignalId;
  status: FraudSignalStatus;
  title: string;
  /** What was seen (fired), what was checked (clear), or why not (not_checked). */
  detail: string;
  /** Where the data came from. Null only when not checked. */
  source: string | null;
  whatToDo: string;
}

export interface Dated<T> {
  value: T;
  source: string;
  /** ISO date the fact was observed / recorded. */
  observedAt: string;
}

export interface FraudCheckInput {
  now: string;
  /** Owner mailing address as recorded over time, newest first (distinct values). */
  ownerMailingHistory: Array<Dated<string>> | null;
  /** The offer or accepted amount on the deal, dollars. */
  offerAmount: number | null;
  /**
   * Parcel value from a fact that passed the W2 accuracy gate ONLY
   * (shared/landData/factAccuracyGate.ts). Null when no gated value exists.
   */
  gatedValue: Dated<number> | null;
  /** When the current owner took title (dated sale/deed observation). */
  ownerSince: Dated<string> | null;
  /** The person on the deal who will sign as seller. */
  signerName: string | null;
  /** Owner of record for the parcel. */
  ownerOfRecord: Dated<string> | null;
  /** True only when the property record says vacant land. Null = unknown. */
  isVacantLand: Dated<boolean> | null;
  parcelState: string | null;
  /** Two-letter state of the owner's mailing address. Null = unknown. */
  ownerMailingState: Dated<string> | null;
  /** True only when someone recorded "no liens" (free and clear). Null = unknown. */
  freeAndClear: Dated<boolean> | null;
  /** Reports, on this deal, of a request to wire money to a new or changed account. */
  wireChangeReports: Array<{ reportedAt: string; note: string | null }> | null;
}

const DAY_MS = 86_400_000;
const RECENT_ADDRESS_CHANGE_DAYS = 90;
const LONG_HELD_YEARS = 10;
/** An offer below this share of a gated value, on a long-held parcel, is a signal. */
const FAR_BELOW_VALUE_RATIO = 0.3;

const VERIFY_ID = "Verify the seller's identity through your title company before you sign or send money.";
const CALL_OWNER = "Call the owner at the phone number of record (from the county or your own earlier records), not a number the seller gave you.";

const ENTITY_WORDS = new Set(["llc", "inc", "corp", "co", "trust", "trustee", "family", "the", "et", "al", "etal", "estate", "of", "and", "lp", "ltd", "living", "revocable", "rev", "tr", "ttee"]);

function nameTokens(name: string): Set<string> {
  return new Set(
    name
      .toLowerCase()
      .replace(/[^a-z\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length >= 3 && !ENTITY_WORDS.has(t)),
  );
}

function isEntity(name: string): boolean {
  return /\b(llc|inc|corp|trust|ltd|lp|estate|company|partnership)\b/i.test(name);
}

function notChecked(id: FraudSignalId, title: string, why: string, whatToDo: string): FraudSignal {
  return { id, status: "not_checked", title, detail: `Not checked: ${why}`, source: null, whatToDo };
}

export function evaluateFraudSignals(input: FraudCheckInput): FraudSignal[] {
  const now = Date.parse(input.now);
  const out: FraudSignal[] = [];

  // 1. A recent change of the owner's mailing address.
  {
    const title = "Owner's mailing address changed recently";
    const h = input.ownerMailingHistory;
    if (!h || h.length === 0) {
      out.push(notChecked("mailing_address_changed", title, "no mailing-address history is on record for this parcel.", CALL_OWNER));
    } else if (h.length === 1) {
      out.push({
        id: "mailing_address_changed",
        status: "clear",
        title,
        detail: `One mailing address on record since ${h[0].observedAt.slice(0, 10)}; no change seen.`,
        source: h[0].source,
        whatToDo: CALL_OWNER,
      });
    } else {
      const latest = h[0];
      const ageDays = (now - Date.parse(latest.observedAt)) / DAY_MS;
      const recent = ageDays >= 0 && ageDays <= RECENT_ADDRESS_CHANGE_DAYS;
      out.push({
        id: "mailing_address_changed",
        status: recent ? "fired" : "clear",
        title,
        detail: recent
          ? `The owner's mailing address on record changed ${Math.round(ageDays)} days ago (seen ${latest.observedAt.slice(0, 10)}). Impostors often redirect the owner's mail before selling.`
          : `Last change seen ${latest.observedAt.slice(0, 10)}, more than ${RECENT_ADDRESS_CHANGE_DAYS} days ago.`,
        source: latest.source,
        whatToDo: CALL_OWNER,
      });
    }
  }

  // 2. An offer far below value on a long-held parcel — gated value only.
  {
    const title = "Offer far below value on a long-held parcel";
    const todo = "A real owner rarely sells far below value; confirm the seller is the owner before going further. " + VERIFY_ID;
    if (input.offerAmount == null || !(input.offerAmount > 0)) {
      out.push(notChecked("offer_far_below_value", title, "there is no offer amount on this deal yet.", todo));
    } else if (!input.gatedValue || !(input.gatedValue.value > 0)) {
      out.push(notChecked("offer_far_below_value", title, "no parcel value has passed AcreOS's accuracy check, so there is nothing reliable to compare the offer with.", todo));
    } else if (!input.ownerSince) {
      out.push(notChecked("offer_far_below_value", title, "the date the owner took title is not on record.", todo));
    } else {
      const years = (now - Date.parse(input.ownerSince.value)) / (365.25 * DAY_MS);
      const ratio = input.offerAmount / input.gatedValue.value;
      const fired = years >= LONG_HELD_YEARS && ratio < FAR_BELOW_VALUE_RATIO;
      out.push({
        id: "offer_far_below_value",
        status: fired ? "fired" : "clear",
        title,
        detail: fired
          ? `The offer is ${Math.round(ratio * 100)}% of the parcel's checked value, and the owner has held it about ${Math.floor(years)} years.`
          : `Offer is ${Math.round(ratio * 100)}% of the checked value; held about ${Math.floor(Math.max(0, years))} years.`,
        source: `${input.gatedValue.source}; ownership date: ${input.ownerSince.source}`,
        whatToDo: todo,
      });
    }
  }

  // 3. The signer is not the owner of record.
  {
    const title = "Signer's name differs from the owner of record";
    if (!input.signerName?.trim()) {
      out.push(notChecked("signer_owner_mismatch", title, "no seller name is on this deal.", VERIFY_ID));
    } else if (!input.ownerOfRecord?.value.trim()) {
      out.push(notChecked("signer_owner_mismatch", title, "the owner of record is not on file for this parcel.", VERIFY_ID));
    } else {
      const signer = nameTokens(input.signerName);
      const owner = nameTokens(input.ownerOfRecord.value);
      const overlap = Array.from(signer).some((t) => owner.has(t));
      if (signer.size === 0 || owner.size === 0) {
        out.push(notChecked("signer_owner_mismatch", title, "one of the two names has no comparable part.", VERIFY_ID));
      } else {
        out.push({
          id: "signer_owner_mismatch",
          status: overlap ? "clear" : "fired",
          title,
          detail: overlap
            ? `The seller "${input.signerName}" shares a name with the owner of record "${input.ownerOfRecord.value}".`
            : isEntity(input.ownerOfRecord.value)
              ? `The owner of record is "${input.ownerOfRecord.value}"; the seller on this deal is "${input.signerName}". Confirm they are authorized to sign for it.`
              : `The seller on this deal is "${input.signerName}", but the owner of record is "${input.ownerOfRecord.value}".`,
          source: input.ownerOfRecord.source,
          whatToDo: VERIFY_ID,
        });
      }
    }
  }

  // 4. Vacant land + out-of-state owner + free and clear: the classic
  //    seller-impersonation profile. Fires only when ALL THREE are known.
  {
    const title = "Vacant, out-of-state owner, free and clear";
    const todo = `This is the profile impostors target most. ${VERIFY_ID} ${CALL_OWNER}`;
    const missing: string[] = [];
    if (!input.isVacantLand) missing.push("whether the land is vacant");
    if (!input.ownerMailingState || !input.parcelState) missing.push("the owner's mailing state");
    if (!input.freeAndClear) missing.push("whether the parcel is free of liens");
    if (missing.length > 0) {
      out.push(notChecked("impersonation_profile", title, `${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} not on record.`, todo));
    } else {
      const outOfState = input.ownerMailingState!.value.toUpperCase() !== input.parcelState!.toUpperCase();
      const fired = input.isVacantLand!.value && outOfState && input.freeAndClear!.value;
      out.push({
        id: "impersonation_profile",
        status: fired ? "fired" : "clear",
        title,
        detail: fired
          ? `Vacant land in ${input.parcelState}, owner mails from ${input.ownerMailingState!.value}, and no liens are recorded.`
          : "The parcel does not match all three parts of this profile.",
        source: [input.isVacantLand!.source, input.ownerMailingState!.source, input.freeAndClear!.source].join("; "),
        whatToDo: todo,
      });
    }
  }

  // 5. A request to wire money to a new account.
  {
    const title = "Request to wire to a new account";
    const todo = "Do not send money to new wire instructions from an email or text. Call your title company at a number you already have and confirm the account by voice.";
    const reports = input.wireChangeReports;
    if (reports == null) {
      out.push(notChecked("wire_account_change", title, "wire-change reports could not be read for this deal.", todo));
    } else if (reports.length === 0) {
      out.push({ id: "wire_account_change", status: "clear", title, detail: "No one on your team has reported a wire-change request on this deal.", source: "Reports recorded on this deal", whatToDo: todo });
    } else {
      const last = reports[0];
      out.push({
        id: "wire_account_change",
        status: "fired",
        title,
        detail: `A request to wire to a new or changed account was reported ${last.reportedAt.slice(0, 10)}${last.note ? `: "${last.note}"` : "."}`,
        source: "Reported on this deal by your team",
        whatToDo: todo,
      });
    }
  }

  return out;
}

/** Two-letter state at the end of a US mailing address ("…, Austin, TX 78701"). */
export function stateFromMailingAddress(addr: string | null | undefined): string | null {
  const m = /,?\s([A-Z]{2})\s+\d{5}(?:-\d{4})?\s*$/.exec((addr ?? "").trim().toUpperCase());
  return m ? m[1] : null;
}
