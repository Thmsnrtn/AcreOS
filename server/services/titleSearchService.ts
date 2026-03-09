/**
 * T29 — Title Search Automation
 *
 * Integrates PropStream / DataTree API for title due diligence.
 * Primary: PropStream API (https://api.propstream.com)
 * Fallback: ATTOM Property API (https://api.attomdata.com)
 * Development: returns mock data with realistic structure
 *
 * Returns: lien details, deed chain, encumbrances, HOA status, owner info
 *
 * Required env:
 *   PROPSTREAM_EMAIL      — PropStream account email
 *   PROPSTREAM_PASSWORD   — PropStream account password
 *   ATTOM_API_KEY         — ATTOM fallback key
 */

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
  grantee: string;
  grantor: string;
  deedType: "warranty" | "quitclaim" | "grant" | "trustee" | "other";
  recordedDate: string;
  documentNumber?: string;
  saleAmount?: number;
}

export interface TitleSearchResult {
  apn: string;
  address?: string;

  // Ownership
  currentOwner: string;
  ownerOccupied: boolean;
  vestingType?: string; // "Joint Tenancy", "LLC", "Trust", etc.
  ownerMailingAddress?: string;

  // Liens and encumbrances
  liens: LienRecord[];
  totalLienAmount: number;
  hasOpenLiens: boolean;

  // Deed chain (most recent first)
  deedChain: DeedRecord[];
  lastSaleDate?: string;
  lastSalePrice?: number;

  // HOA
  hasHoa: boolean;
  hoaName?: string;
  hoaFeeMonthly?: number;

  // Title clarity
  titleClearStatus: "clear" | "encumbered" | "unknown";
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

  if (propstreamToken && Date.now() < propstreamTokenExpiry) {
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
    propstreamTokenExpiry = Date.now() + 55 * 60 * 1000; // 55 min
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
      grantee: sale.buyerName || "Unknown",
      grantor: sale.sellerName || "Unknown",
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
      currentOwner: prop.ownerName || "Unknown",
      ownerOccupied: prop.ownerOccupied ?? false,
      vestingType: prop.vestingType,
      ownerMailingAddress: prop.ownerMailingAddress,
      liens,
      totalLienAmount: liens.filter(l => l.status === "open").reduce((s, l) => s + l.amount, 0),
      hasOpenLiens: openLiens.length > 0,
      deedChain,
      lastSaleDate: prop.lastSaleDate,
      lastSalePrice: prop.lastSaleAmount,
      hasHoa: prop.hoaPresent ?? false,
      hoaName: prop.hoaName,
      hoaFeeMonthly: prop.hoaFee,
      titleClearStatus: openLiens.length === 0 && !prop.taxDelinquent ? "clear" : "encumbered",
      redFlags,
      source: "propstream",
      confidence: 0.9,
      searchedAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

// ─── ATTOM Fallback ─────────────────────────────────────────────────────────

async function fetchFromAttom(apn: string): Promise<TitleSearchResult | null> {
  const apiKey = process.env.ATTOM_API_KEY;
  if (!apiKey) return null;

  try {
    const res = await fetch(
      `https://api.attomdata.com/propertyapi/v1.0.0/property/detail?attomId=${encodeURIComponent(apn)}`,
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
        grantee: prop.owner?.owner1?.fullName || "Unknown",
        grantor: "Previous Owner",
        deedType: prop.sale?.deedType?.toLowerCase().includes("quit") ? "quitclaim" : "warranty",
        recordedDate: prop.sale.saleTransDate,
        saleAmount: prop.sale.saleAmt,
      });
    }

    return {
      apn,
      address: prop.address?.oneLine,
      currentOwner: prop.owner?.owner1?.fullName || "Unknown",
      ownerOccupied: prop.assessment?.assessed?.assdTtlValue ? false : false,
      liens,
      totalLienAmount: liens.reduce((s, l) => s + l.amount, 0),
      hasOpenLiens: liens.length > 0,
      deedChain,
      lastSaleDate: prop.sale?.saleTransDate,
      lastSalePrice: prop.sale?.saleAmt,
      hasHoa: false,
      titleClearStatus: liens.length === 0 ? "clear" : "encumbered",
      redFlags: liens.length > 0 ? ["Open mortgage found — verify payoff amount"] : [],
      source: "attom",
      confidence: 0.65,
      searchedAt: new Date().toISOString(),
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
  async search(apn: string, state = ""): Promise<TitleSearchResult> {
    const ps = await fetchFromPropstream(apn, state);
    if (ps) return ps;

    const attom = await fetchFromAttom(apn);
    if (attom) return attom;

    // Mock / development fallback
    return {
      apn,
      currentOwner: "Owner on Record",
      ownerOccupied: false,
      liens: [],
      totalLienAmount: 0,
      hasOpenLiens: false,
      deedChain: [],
      hasHoa: false,
      titleClearStatus: "unknown",
      redFlags: ["Title data unavailable — manual search required"],
      source: "mock",
      confidence: 0,
      searchedAt: new Date().toISOString(),
    };
  },

  isConfigured(): boolean {
    return !!(
      (process.env.PROPSTREAM_EMAIL && process.env.PROPSTREAM_PASSWORD) ||
      process.env.ATTOM_API_KEY
    );
  },
};
