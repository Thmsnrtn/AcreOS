/**
 * Tax-sale calendar and delinquency-list SOURCE registry (W2 task 5).
 *
 * Where a county publishes its delinquent-tax lists and sale notices — not
 * the dates themselves. A sale date is shown to a customer only when it is
 * read from the cited page in the same run (a future sync), never typed in
 * here, because sale dates move and stale ones cost buyers money.
 *
 * Sourced entries only: each was fetched on `checkedOn`, and `pageSays`
 * records what the page itself shows. A page that refused an automated
 * request is listed with reachable: false rather than dropped, so the gap is
 * visible. Browser-safe.
 */

export interface TaxSaleSource {
  state: string;
  county: string;
  office: string;
  kind: "delinquent_list" | "sale_notice" | "delinquent_inquiry" | "process_page";
  url: string;
  checkedOn: string;
  reachable: boolean;
  /** What the page showed when checked — quoted or closely paraphrased. */
  pageSays: string;
}

export const TAX_SALE_SOURCES: readonly TaxSaleSource[] = [
  {
    state: "TN",
    county: "Hamilton",
    office: "Hamilton County Clerk & Master",
    kind: "delinquent_inquiry",
    url: "https://cmpti.hamiltontn.gov",
    checkedOn: "2026-10-10",
    reachable: true,
    pageSays:
      "\"Hamilton County Clerk & Master Delinquent Property Tax Inquiry\" — search by map/group/parcel, last name, bill number or property address.",
  },
  {
    state: "TN",
    county: "Knox",
    office: "Knox County Trustee",
    kind: "process_page",
    url: "https://www.knoxcounty.org/trustee/tax_sale_info.php",
    checkedOn: "2026-10-10",
    reachable: true,
    pageSays: "Trustee \"Tax Sale\" information page; the sale itself is run through the Clerk and Master.",
  },
  {
    state: "TN",
    county: "Shelby",
    office: "Shelby County Chancery Court Clerk & Master",
    kind: "process_page",
    url: "https://www.shelbycountytn.gov/330/Tax-Sale-Information",
    checkedOn: "2026-10-10",
    reachable: false,
    pageSays: "Returned HTTP 403 to an automated request; a person must read it.",
  },
];

export function taxSaleSourcesFor(state: string, county: string): TaxSaleSource[] {
  const c = county.toLowerCase().replace(/ county$/, "").trim();
  return TAX_SALE_SOURCES.filter((s) => s.state === state.toUpperCase() && s.county.toLowerCase() === c);
}
