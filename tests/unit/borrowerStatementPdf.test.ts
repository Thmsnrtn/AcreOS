/**
 * BD-1 — borrower statement PDFs render on the server; content parity pins.
 *
 * Until BD-1 the borrower portal rendered its Form 1098 and account
 * statement in the browser with jsPDF (the customer bundle's 331 KB
 * jspdf chunk, one consumer). The layout code moved verbatim to
 * server/services/borrower/statementPdf.ts; these tests are the parity
 * proof, P3-4-style: render off a paid-cycle fixture and compare the
 * document's content strings against exactly what the client renderer
 * produced (same library, same calls — every string below is one the
 * old `generatePDF` in borrower-portal.tsx emitted for this fixture).
 *
 * jsPDF writes uncompressed content streams, so the rendered text is
 * recoverable from the buffer: extract, unescape jsPDF's literal-string
 * escapes, and compare.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  renderBorrowerStatementPdf,
  borrowerStatementPdfFilename,
  type Borrower1098StatementData,
  type BorrowerAccountStatementData,
} from "../../server/services/borrower/statementPdf";

function pdfText(buf: Buffer): string {
  return buf.toString("latin1").replace(/\\([()\\])/g, "$1");
}

const form1098: Borrower1098StatementData = {
  type: "1098",
  taxYear: 2025,
  borrowerName: "Casey Borrower",
  borrowerAddress: "12 Meadow Lane",
  borrowerCity: "Framingham",
  borrowerState: "MA",
  borrowerZip: "01701",
  lenderName: "Linnea Lending LLC",
  lenderAddress: "1 Main St, Framingham, MA 01701",
  interestPaid: 1234.56,
  principalBalance: 11980,
  refundOfOverpaidInterest: 25.5,
  loanOriginationDate: "2024-03-15",
};

const statement: BorrowerAccountStatementData = {
  type: "statement",
  generatedDate: "2026-11-17T15:00:00.000Z",
  borrowerName: "Casey Borrower",
  noteId: 42,
  originalPrincipal: 12000,
  currentBalance: 11980,
  interestRate: 10,
  monthlyPayment: 100,
  nextPaymentDate: "2026-12-01T12:00:00.000Z",
  autopayEnabled: true,
  payments: [
    { date: "2026-10-01T12:00:00.000Z", amount: 100, principal: 20, interest: 80, method: "ACH" },
    { date: "2026-11-01T12:00:00.000Z", amount: 100, principal: 20.5, interest: 79.5, method: "ACH" },
  ],
  summary: { totalPaid: 200, totalPrincipal: 40.5, totalInterest: 159.5, paymentsCount: 2 },
};

describe("Form 1098 rendering (server-side, BD-1)", () => {
  const text = pdfText(renderBorrowerStatementPdf(form1098));

  it("produces a real PDF", () => {
    const buf = renderBorrowerStatementPdf(form1098);
    expect(buf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(buf.length).toBeGreaterThan(1000);
  });

  it.each([
    "Form 1098 - Mortgage Interest Statement",
    "Tax Year: 2025",
    "LENDER INFORMATION:",
    "Linnea Lending LLC",
    "1 Main St, Framingham, MA 01701",
    "BORROWER INFORMATION:",
    "Casey Borrower",
    "12 Meadow Lane",
    "Framingham, MA 01701",
    "Box 1 - Mortgage Interest Received:",
    "$1,234.56",
    "Box 2 - Outstanding Principal (Jan 1):",
    "$11,980.00",
    "Box 4 - Refund of Overpaid Interest:",
    "$25.50",
    "Loan Origination Date:",
    "Mar 15, 2024",
    "This is for informational purposes. Please consult your tax advisor.",
  ])("contains %s", (s) => {
    expect(text).toContain(s);
  });

  it("omits Box 4 when there is no refund of overpaid interest", () => {
    const noRefund = pdfText(renderBorrowerStatementPdf({ ...form1098, refundOfOverpaidInterest: 0 }));
    expect(noRefund).not.toContain("Box 4");
    expect(noRefund).toContain("Box 1 - Mortgage Interest Received:");
  });

  it("renders without lender/borrower addresses", () => {
    const bare = pdfText(
      renderBorrowerStatementPdf({ ...form1098, lenderAddress: undefined, borrowerAddress: null }),
    );
    expect(bare).toContain("Linnea Lending LLC");
    expect(bare).toContain("Casey Borrower");
  });

  it("names the download 1098_<year>.pdf, as doc.save did", () => {
    expect(borrowerStatementPdfFilename(form1098)).toBe("1098_2025.pdf");
  });
});

describe("Account statement rendering (server-side, BD-1)", () => {
  const text = pdfText(renderBorrowerStatementPdf(statement));

  it.each([
    "Account Statement",
    "Generated: November 17, 2026",
    "ACCOUNT SUMMARY",
    "Borrower:",
    "Casey Borrower",
    "Loan Number:",
    "#42",
    "Original Principal:",
    "$12,000.00",
    "Current Balance:",
    "$11,980.00",
    "Interest Rate:",
    "10% APR",
    "Monthly Payment:",
    "$100.00",
    "Next Payment Due:",
    "Dec 1, 2026",
    "Autopay Status:",
    "Enabled",
    "PAYMENT SUMMARY",
    "Total Payments:",
    "Total Paid:",
    "$200.00",
    "Principal Paid:",
    "$40.50",
    "Interest Paid:",
    "$159.50",
    "PAYMENT HISTORY",
    "10/01/26",
    "11/01/26",
    "$20.00",
    "$80.00",
    "$20.50",
    "$79.50",
    "ACH",
  ])("contains %s", (s) => {
    expect(text).toContain(s);
  });

  it("renders an empty payment history without the history section", () => {
    const empty = pdfText(
      renderBorrowerStatementPdf({
        ...statement,
        payments: [],
        summary: { totalPaid: 0, totalPrincipal: 0, totalInterest: 0, paymentsCount: 0 },
      }),
    );
    expect(empty).toContain("Account Statement");
    expect(empty).not.toContain("PAYMENT HISTORY");
  });

  it("caps the payment history at 20 rows, as the client renderer did", () => {
    const many: BorrowerAccountStatementData = {
      ...statement,
      payments: Array.from({ length: 25 }, (_, i) => ({
        date: "2026-10-01T12:00:00.000Z",
        amount: 101 + i,
        principal: 1,
        interest: 1,
        method: "ACH",
      })),
      summary: { totalPaid: 2825, totalPrincipal: 25, totalInterest: 25, paymentsCount: 25 },
    };
    const t = pdfText(renderBorrowerStatementPdf(many));
    expect(t).toContain("$101.00"); // first row renders
    expect(t).toContain("$120.00"); // 20th row renders
    expect(t).not.toContain("$121.00"); // 21st row is cut, as before
    expect(t).not.toContain("$125.00"); // 25th row is cut, as before
  });

  it("names the download statement_<generated date>.pdf", () => {
    expect(borrowerStatementPdfFilename(statement)).toBe("statement_2026-11-17.pdf");
  });
});

describe("BD-1 wiring — jsPDF no longer reaches the portal", () => {
  const ROOT = path.join(__dirname, "../..");
  const portal = readFileSync(path.join(ROOT, "client/src/pages/borrower-portal.tsx"), "utf8");
  const route = readFileSync(path.join(ROOT, "server/routes-borrower.ts"), "utf8");

  it("the portal imports no jsPDF in any form", () => {
    expect(portal).not.toMatch(/\bfrom\s*["']jspdf["']|\bimport\(\s*["']jspdf["']\s*\)/);
    expect(portal).not.toContain("generatePDF");
  });

  it("the portal asks the endpoint for the PDF and downloads the blob", () => {
    expect(portal).toContain("format: 'pdf'");
    expect(portal).toContain("createObjectURL");
    expect(portal).toContain("Content-Disposition");
  });

  it("the endpoint renders the PDF server-side when format=pdf", () => {
    expect(route).toContain("renderBorrowerStatementPdf");
    expect(route).toContain("req.query.format === 'pdf'");
    expect(route).toContain('"application/pdf"');
  });
});
