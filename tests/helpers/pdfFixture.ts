/** A real PDF with exactly `pages` pages (pdfkit), for tests that count pages. */
import PDFDocument from "pdfkit";

export function makePdf(pages: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ autoFirstPage: false });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    for (let i = 0; i < pages; i++) {
      doc.addPage();
      doc.text(`Page ${i + 1}`);
    }
    doc.end();
  });
}
