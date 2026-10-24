/**
 * T29 — Title Search Automation
 *
 * Integrates PropStream / DataTree API for title due diligence.
 * Primary: PropStream API (https://api.propstream.com)
 * Fallback: ATTOM Property API (https://api.attomdata.com)
 * No provider configured: returns a refusal (nulls + "unverified"), never data
 *
 * Returns: lien details, deed chain, encumbrances, HOA status, owner info
 *
 * Required env:
 *   PROPSTREAM_EMAIL      — PropStream account email
 *   PROPSTREAM_PASSWORD   — PropStream account password
 *   ATTOM_API_KEY         — ATTOM fallback key
 */

import { clock } from "../utils/clock";
export interface LienRecord {
  type: "mortgage" | "tax_lien" | "mechanic_lien" | "judgment" | "hoa" | "other";
  amount: number;
  lender?: string;
  recordedDate?: string;
  maturityDate?: string;
  position: number; // 1 = first lien, 2 = second, etc.
  status: "open" | "satisfied" | "unknown";
}

export interface DeedRecord {
  /** Null when the provider did not report the party. Never a placeholder. */
  grantee: string | null;
  grantor: string | null;
  deedType: "warranty" | "quitclaim" | "grant" | "trustee" | "other";
  recordedDate: string;
  documentNumber?: string;
  saleAmount?: number;
}

export interface TitleSearchResult {
  apn: string;
  address?: string;

  // Ownership
  //
  // NULLABLE ON PURPOSE. These were `string` and `boolean`, which left no way to
  // say "not observed" — so the mock fallback returned the NAME "Owner on
  // Record" and the boolean `false`, and a customer read an invented owner and
  // an occupancy fact for a real parcel. A default may help a calculation
  // continue; it may not impersonate observed property reality. `null` is the
  // honest value, and `dueDiligence.ts` (currentOwner: string | null) and
  // `redemptionClockRefresh.ts` (ownerOccupiedAtSale: boolean | null) already
  // model it that way — this file was the outlier.
  currentOwner: string | null;
  ownerOccupied: boolean | null;
  vestingType?: string; // "Joint Tenancy", "LLC", "Trust", etc.
  ownerMailingAddress?: string;

  // Liens and encumbrances
  //
  // `hasOpenLiens` is `true` only when a provider REPORTED an open lien. When
  // none was reported it is `null`, never `false`: a provider's silence about
  // liens is not an observation that there are none (the record may be
  // incomplete, the call may not cover judgments / mechanic's liens, etc.).
  liens: LienRecord[];
  totalLienAmount: number;
  hasOpenLiens: true | null;

  // Deed chain (most recent first)
  deedChain: DeedRecord[];
  lastSaleDate?: string;
  lastSalePrice?: number;

  // HOA — `null` unless the provider explicitly reported HOA presence.
  hasHoa: boolean | null;
  hoaName?: string;
  hoaFeeMonthly?: number;

  // Title clarity
  //
  // There is deliberately NO "clear" value. This is a public-records
  // PRE-SCREEN; it cannot certify clear title, and it used to say "clear"
  // whenever a provider simply returned no mortgage — asserting a negative
  // from silence. "encumbered" = a provider reported an open lien / tax
  // delinquency; everything else is "unverified" until a title commitment
  // from a licensed underwriter says otherwise.
  titleClearStatus: "encumbered" | "unverified";
  redFlags: string[]; // list of issues

  // Metadata
  source: "propstream" | "attom" | "mock";
  confidence: number; // 0–1
  searchedAt: string;
}

// ─── PropStream Auth ────────────────────────────────────────────────────────

let propstreamToken: string | null = null;
let propstreamTokenExpiry = 0;

async function getPropstreamToken(): Promise<string | null> {
  const email = process.env.PROPSTREAM_EMAIL;
  const password = process.env.PROPSTREAM_PASSWORD;
  if (!email || !password) return null;

  if (propstreamToken && clock.nowMs() < propstreamTokenExpiry) {
    return propstreamToken;
  }

  try {
    const res = await fetch("https://api.propstream.com/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: email, password }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const data = await res.json() as any;
    propstreamToken = data.access_token || data.token || null;
    propstreamTokenExpiry = clock.nowMs() + 55 * 60 * 1000; // 55 min
    return propstreamToken;
  } catch {
    return null;
  }
}

// ─── PropStream Search ──────────────────────────────────────────────────────

async function fetchFromPropstream(apn: string, state: string): Promise<TitleSearchResult | null> {
  const token = await getPropstreamToken();
  if (!token) return null;

  try {
    const res = await fetch(`https://api.propstream.com/property/detail`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ apn, state }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const data = await res.json() as any;
    const prop = data?.property;
    if (!prop) return null;

    const liens: LienRecord[] = (prop.loans || []).map((loan: any, idx: number) => ({
      type: "mortgage",
      amount: loan.loanAmount || 0,
      lender: loan.lenderName,
      recordedDate: loan.recordingDate,
      maturityDate: loan.maturityDate,
      position: idx + 1,
      status: loan.openLien ? "open" : "satisfied",
    }));

    if (prop.taxDelinquent) {
      liens.push({
        type: "tax_lien",
        amount: prop.taxDelinquentAmount || 0,
        recordedDate: prop.taxDelinquentYear?.toString(),
        position: liens.length + 1,
        status: "open",
      });
    }

    const deedChain: DeedRecord[] = (prop.salesHistory || []).slice(0, 5).map((sale: any) => ({
      grantee: sale.buyerName || null,
      grantor: sale.sellerName || null,
      deedType: "warranty",
      recordedDate: sale.saleDate || "",
      saleAmount: sale.saleAmount,
    }));

    const openLiens = liens.filter(l => l.status === "open");
    const redFlags: string[] = [];
    if (openLiens.length > 0) redFlags.push(`${openLiens.length} open lien(s) totaling $${openLiens.reduce((s, l) => s + l.amount, 0).toLocaleString()}`);
    if (prop.taxDelinquent) redFlags.push("Tax delinquent status");
    if (prop.corporateOwned) redFlags.push("Corporate/LLC ownership — contact may be difficult");

    return {
      apn,
      address: [prop.addressLine1, prop.city, prop.state].filter(Boolean).join(", "),
      currentOwner: prop.ownerName || null,
      // `?? false` asserted "not owner-occupied" whenever PropStream omitted the
      // field. Absence is not a negative observation.
      ownerOccupied: prop.ownerOccupied ?? null,
      vestingType: prop.vestingType,
      ownerMailingAddress: prop.ownerMailingAddress,
      liens,
      totalLienAmount: liens.filter(l => l.status === "open").reduce((s, l) => s + l.amount, 0),
      hasOpenLiens: openLiens.length > 0 ? true : null,
      deedChain,
      lastSaleDate: prop.lastSaleDate,
      lastSalePrice: prop.lastSaleAmount,
      // Only an explicit boolean from the provider is an observation.
      hasHoa: typeof prop.hoaPresent === "boolean" ? prop.hoaPresent : null,
      hoaName: prop.hoaName,
      hoaFeeMonthly: prop.hoaFee,
      titleClearStatus: openLiens.length > 0 || prop.taxDelinquent ? "encumbered" : "unverified",
      redFlags,
      source: "propstream",
      confidence: 0.9,
      searchedAt: clock.now().toISOString(),
    };
  } catch {
    return null;
  }
}

// ─── ATTOM Fallback ─────────────────────────────────────────────────────────

async function fetchFromAttom(apn: string, fips?: string): Promise<TitleSearchResult | null> {
  const apiKey = process.env.ATTOM_API_KEY;
  if (!apiKey) return null;
  // ATTOM keys a parcel by APN + county FIPS. This used to send the APN as
  // `attomId` — ATTOM's own internal property id — so a numeric APN could
  // resolve to an UNRELATED property and its owner/liens were shown for the
  // customer's parcel. Without a FIPS code there is no correct ATTOM query
  // for an APN, so we do not make one.
  if (!fips) return null;

  try {
    const res = await fetch(
      `https://api.attomdata.com/propertyapi/v1.0.0/property/detail?apn=${encodeURIComponent(apn)}&fips=${encodeURIComponent(fips)}`,
      {
        headers: { apikey: apiKey, Accept: "application/json" },
        signal: AbortSignal.timeout(12000),
      }
    );
    if (!res.ok) return null;
    const data = await res.json() as any;
    const prop = data?.property?.[0];
    if (!prop) return null;

    const mort = prop.mortgage;
    const liens: LienRecord[] = [];
    if (mort?.lenderName) {
      liens.push({
        type: "mortgage",
        amount: mort.amount || 0,
        lender: mort.lenderName,
        recordedDate: mort.recordingDate,
        position: 1,
        status: "open",
      });
    }

    const deedChain: DeedRecord[] = [];
    if (prop.sale?.saleTransDate) {
      deedChain.push({
        grantee: prop.owner?.owner1?.fullName || null,
        // "Previous Owner" was a manufactured party name in a chain of title.
        // ATTOM's sale record does not carry the grantor; null says so.
        grantor: null,
        deedType: prop.sale?.deedType?.toLowerCase().includes("quit") ? "quitclaim" : "warranty",
        recordedDate: prop.sale.saleTransDate,
        saleAmount: prop.sale.saleAmt,
      });
    }

    return {
      apn,
      address: prop.address?.oneLine,
      currentOwner: prop.owner?.owner1?.fullName || null,
      // WAS `prop.assessment?.assessed?.assdTtlValue ? false : false` — both
      // branches false, so occupancy was asserted `false` for every parcel even
      // with a live provider. An assessed total value says nothing about who
      // lives there; ATTOM does not report occupancy on this call.
      ownerOccupied: null,
      liens,
      totalLienAmount: liens.reduce((s, l) => s + l.amount, 0),
      hasOpenLiens: liens.length > 0 ? true : null,
      deedChain,
      lastSaleDate: prop.sale?.saleTransDate,
      lastSalePrice: prop.sale?.saleAmt,
      // ATTOM's property/detail call does not report HOA presence.
      hasHoa: null,
      // No mortgage on this record is not "clear title" — it is silence.
      titleClearStatus: liens.length > 0 ? "encumbered" : "unverified",
      redFlags: liens.length > 0 ? ["Open mortgage found — verify payoff amount"] : [],
      source: "attom",
      confidence: 0.65,
      searchedAt: clock.now().toISOString(),
    };
  } catch {
    return null;
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────

export const titleSearchService = {
  /**
   * Perform a title search for a given APN.
   * Tries PropStream → ATTOM → mock.
   */
  async search(apn: string, state = "", fips?: string): Promise<TitleSearchResult> {
    const ps = await fetchFromPropstream(apn, state);
    if (ps) return ps;

    const attom = await fetchFromAttom(apn, fips);
    if (attom) return attom;

    // NO PROVIDER CONFIGURED — REFUSE, DO NOT INVENT.
    //
    // This returned `currentOwner: "Owner on Record"` and `ownerOccupied: false`
    // for a real parcel, to an authenticated customer, through a mounted route.
    // `source: "mock"` and `confidence: 0` were already honest; the two ownership
    // fields were not, and they are the ones a consumer renders.
    return {
      apn,
      currentOwner: null,
      ownerOccupied: null,
      liens: [],
      totalLienAmount: 0,
      // Nothing was searched, so nothing is asserted: null, not false.
      hasOpenLiens: null,
      deedChain: [],
      hasHoa: null,
      titleClearStatus: "unverified",
      redFlags: ["Title data unavailable — manual search required"],
      source: "mock",
      confidence: 0,
      searchedAt: clock.now().toISOString(),
    };
  },

  isConfigured(): boolean {
    return !!(
      (process.env.PROPSTREAM_EMAIL && process.env.PROPSTREAM_PASSWORD) ||
      process.env.ATTOM_API_KEY
    );
  },
};
