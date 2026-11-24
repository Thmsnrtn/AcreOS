/**
 * Borrower statement PDFs, rendered on the server (BD-1, bundle diet).
 *
 * Until BD-1 the borrower portal rendered these two documents in the
 * browser with jsPDF, which put the 331 KB `jspdf.es.min` chunk in the
 * customer bundle for exactly one consumer. The layout code below is the
 * portal's former `generatePDF` moved verbatim — same library (jsPDF was
 * already a server dependency), same fonts, sizes, positions and strings —
 * so the document a borrower downloads is the document they always got;
 * only the machine that renders it changed. The portal already had to
 * fetch the statement payload from `/api/borrower/statements/generate`
 * before any PDF could exist, so no offline capability is lost.
 *
 * Parity discipline: `tests/unit/borrowerStatementPdf.test.ts` renders
 * both document types off fixtures and pins every content string. Any
 * layout change here is a money-paper change — update the pins in the
 * same commit and say so.
 *
 * The one deliberate difference from the client renderer: the statement
 * download filename is derived from the payload's `generatedDate` (the
 * instant the payload was minted, in the same request) where the client
 * used the download instant for the filename's date. Same day in
 * practice; the document content is identical either way.
 */
import { jsPDF } from "jspdf";
import { format, parseISO } from "date-fns";

export interface Borrower1098StatementData {
  type: "1098";
  taxYear: number;
  borrowerName: string;
  borrowerAddress?: string | null;
  borrowerCity?: string | null;
  borrowerState?: string | null;
  borrowerZip?: string | null;
  lenderName: string;
  lenderAddress?: string;
  interestPaid: number;
  principalBalance: number;
  refundOfOverpaidInterest?: number;
  loanOriginationDate: string;
}

export interface BorrowerAccountStatementPayment {
  date: string | Date;
  amount: number;
  principal: number;
  interest: number;
  method?: string | null;
}

export interface BorrowerAccountStatementData {
  type: "statement";
  generatedDate: string;
  borrowerName: string;
  borrowerAddress?: string;
  borrowerEmail?: string;
  lenderName?: string;
  lenderPhone?: string;
  lenderEmail?: string;
  noteId: number;
  originalPrincipal: number;
  currentBalance: number;
  interestRate: number;
  termMonths?: number | null;
  monthlyPayment: number;
  startDate?: string | Date | null;
  maturityDate?: string | Date | null;
  nextPaymentDate?: string | Date | null;
  nextPaymentAmount?: number;
  autopayEnabled: boolean;
  payments: BorrowerAccountStatementPayment[];
  summary: {
    totalPaid: number;
    totalPrincipal: number;
    totalInterest: number;
    paymentsCount: number;
  };
}

export type BorrowerStatementData = Borrower1098StatementData | BorrowerAccountStatementData;

/**
 * The client portal's `usd` (client/src/lib/format.ts) on its default
 * options path — the only path the PDF renderer ever called. Copied so
 * the rendered strings stay byte-identical; client/src/lib/format.ts is
 * the canonical source if the default formatting ever changes.
 */
function usd(amount: number | string | null | undefined): string {
  if (amount == null || amount === "") return "—";
  const n = typeof amount === "string" ? Number(amount) : amount;
  if (!Number.isFinite(n)) return "—";
  const formatted = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.abs(n));
  if (n < 0) return `−${formatted}`;
  return formatted;
}

/** The download filename the portal's `doc.save(...)` calls used. */
export function borrowerStatementPdfFilename(data: BorrowerStatementData): string {
  if (data.type === "1098") {
    return `1098_${data.taxYear}.pdf`;
  }
  return `statement_${format(new Date(data.generatedDate), "yyyy-MM-dd")}.pdf`;
}

/**
 * Render one statement payload (the exact JSON shape
 * `/api/borrower/statements/generate` builds) to a PDF buffer.
 * Layout calls are the portal's former client renderer, verbatim.
 */
export function renderBorrowerStatementPdf(data: BorrowerStatementData): Buffer {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  let y = 20;

  if (data.type === "1098") {
    doc.setFontSize(18);
    doc.text("Form 1098 - Mortgage Interest Statement", pageWidth / 2, y, { align: "center" });
    y += 10;

    doc.setFontSize(12);
    doc.text(`Tax Year: ${data.taxYear}`, pageWidth / 2, y, { align: "center" });
    y += 20;

    doc.setFontSize(10);
    doc.text("LENDER INFORMATION:", 14, y);
    y += 6;
    doc.text(data.lenderName, 14, y);
    y += 5;
    if (data.lenderAddress) {
      doc.text(data.lenderAddress, 14, y);
      y += 5;
    }
    y += 10;

    doc.text("BORROWER INFORMATION:", 14, y);
    y += 6;
    doc.text(data.borrowerName, 14, y);
    y += 5;
    if (data.borrowerAddress) {
      doc.text(`${data.borrowerAddress}`, 14, y);
      y += 5;
      doc.text(`${data.borrowerCity || ""}, ${data.borrowerState || ""} ${data.borrowerZip || ""}`, 14, y);
      y += 5;
    }
    y += 15;

    doc.setFontSize(12);
    doc.text("Box 1 - Mortgage Interest Received:", 14, y);
    doc.setFontSize(14);
    doc.text(`$${data.interestPaid.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, 100, y);
    y += 10;

    doc.setFontSize(12);
    doc.text("Box 2 - Outstanding Principal (Jan 1):", 14, y);
    doc.setFontSize(14);
    doc.text(`$${data.principalBalance.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, 100, y);
    y += 10;

    if (typeof data.refundOfOverpaidInterest === "number" && data.refundOfOverpaidInterest > 0) {
      doc.setFontSize(12);
      doc.text("Box 4 - Refund of Overpaid Interest:", 14, y);
      doc.setFontSize(14);
      doc.text(`$${data.refundOfOverpaidInterest.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, 100, y);
      y += 10;
    }

    doc.setFontSize(12);
    doc.text("Loan Origination Date:", 14, y);
    doc.text(format(parseISO(data.loanOriginationDate), "MMM d, yyyy"), 100, y);
    y += 20;

    doc.setFontSize(8);
    doc.text("This is for informational purposes. Please consult your tax advisor.", 14, y);
  } else {
    doc.setFontSize(18);
    doc.text("Account Statement", pageWidth / 2, y, { align: "center" });
    y += 10;

    doc.setFontSize(10);
    doc.text(`Generated: ${format(new Date(data.generatedDate), "MMMM d, yyyy")}`, pageWidth / 2, y, { align: "center" });
    y += 15;

    doc.line(14, y, pageWidth - 14, y);
    y += 10;

    doc.setFontSize(12);
    doc.text("ACCOUNT SUMMARY", 14, y);
    y += 8;

    doc.setFontSize(10);
    const summaryData = [
      ["Borrower:", data.borrowerName],
      ["Loan Number:", `#${data.noteId}`],
      ["Original Principal:", usd(data.originalPrincipal)],
      ["Current Balance:", usd(data.currentBalance)],
      ["Interest Rate:", `${data.interestRate}% APR`],
      ["Monthly Payment:", usd(data.monthlyPayment)],
      ["Next Payment Due:", data.nextPaymentDate ? format(new Date(data.nextPaymentDate), "MMM d, yyyy") : "N/A"],
      ["Autopay Status:", data.autopayEnabled ? "Enabled" : "Disabled"],
    ];

    summaryData.forEach(([label, value]) => {
      doc.text(label, 14, y);
      doc.text(value, 80, y);
      y += 6;
    });

    y += 10;
    doc.line(14, y, pageWidth - 14, y);
    y += 10;

    doc.setFontSize(12);
    doc.text("PAYMENT SUMMARY", 14, y);
    y += 8;

    doc.setFontSize(10);
    doc.text("Total Payments:", 14, y);
    doc.text(data.summary.paymentsCount.toString(), 80, y);
    y += 6;
    doc.text("Total Paid:", 14, y);
    doc.text(usd(data.summary.totalPaid), 80, y);
    y += 6;
    doc.text("Principal Paid:", 14, y);
    doc.text(usd(data.summary.totalPrincipal), 80, y);
    y += 6;
    doc.text("Interest Paid:", 14, y);
    doc.text(usd(data.summary.totalInterest), 80, y);
    y += 15;

    if (data.payments && data.payments.length > 0) {
      doc.setFontSize(12);
      doc.text("PAYMENT HISTORY", 14, y);
      y += 8;

      doc.setFontSize(9);
      doc.text("Date", 14, y);
      doc.text("Amount", 50, y);
      doc.text("Principal", 80, y);
      doc.text("Interest", 110, y);
      doc.text("Method", 140, y);
      y += 6;

      doc.line(14, y, pageWidth - 14, y);
      y += 4;

      data.payments.slice(0, 20).forEach((p) => {
        if (y > 270) {
          doc.addPage();
          y = 20;
        }
        doc.text(format(new Date(p.date), "MM/dd/yy"), 14, y);
        doc.text(usd(p.amount), 50, y);
        doc.text(usd(p.principal), 80, y);
        doc.text(usd(p.interest), 110, y);
        doc.text(p.method || "N/A", 140, y);
        y += 5;
      });
    }
  }

  return Buffer.from(doc.output("arraybuffer"));
}
