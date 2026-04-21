# OCR fixture pack — Raj C01

Canonical test documents for the Compliance persona's
Document-OCR + anomaly-flag journey. Each entry pairs a text-extracted
document (JSON, not a binary scan) with the expected anomaly flags
the document-intelligence pipeline is required to surface.

Why JSON instead of PDFs:
- The persona-harness auditor (not the OCR model) is the thing we
  need to test deterministically. The OCR accuracy of a real
  scanned PDF is a separate question; using pre-extracted text lets
  us isolate the anomaly-detector regression tests from any model
  noise.
- If/when we want to also test OCR itself, drop the source PDFs
  next to each JSON file using the same basename (`deed-01.pdf`
  matches `deed-01.json`) and the harness will prefer the PDF if
  present.

Each fixture has the shape:

```json
{
  "id": "deed-01",
  "kind": "warranty_deed",
  "text": "...full extracted text...",
  "expected": {
    "anomalies": [
      { "type": "mineral_reservation", "severity": "high", "snippet": "...", "reason": "..." }
    ],
    "keyTerms": {
      "grantor": "John Smith",
      "grantee": "Jane Doe",
      "parcel": "...",
      "consideration": "$10,000"
    }
  }
}
```

## Fixture catalog

| id                     | kind               | anomalies exercised |
|------------------------|--------------------|---------------------|
| deed-01-mineral-sever  | warranty_deed      | mineral_reservation (high) |
| deed-02-easement       | warranty_deed      | utility_easement (medium) |
| title-01-hoa-lien      | title_commitment   | hoa_lien (high) |
| title-02-judgment      | title_commitment   | judgment_lien (high) |
| title-03-clean         | title_commitment   | (none — negative control) |
| tax-01-redemption-soon | tax_statement      | redemption_deadline (critical, <30 days) |
| tax-02-delinquent      | tax_statement      | tax_delinquent (high) |
| tax-03-paid            | tax_statement      | (none) |
| deed-03-access-unknown | warranty_deed      | legal_access_unclear (medium) |

Each anomaly type listed here must appear on the document's
`/api/document-intelligence/documents/:id/risks` response for the
journey rubric to score "pass" on that fixture.

## Using the fixtures in a harness run

```ts
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, "deed-01-mineral-sever.json"), "utf-8"));

// Upload as a document with a data: URL containing the text
const upload = await fetch("/api/document-intelligence/upload", {
  method: "POST",
  credentials: "include",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    name: `${fixture.id}.pdf`,
    fileUrl: `data:text/plain;base64,${Buffer.from(fixture.text).toString("base64")}`,
    fileType: "text/plain",
  }),
});

const { document } = await upload.json();
await fetch(`/api/document-intelligence/documents/${document.id}/process`, { method: "POST", credentials: "include" });
const risks = await fetch(`/api/document-intelligence/documents/${document.id}/risks`, { credentials: "include" }).then(r => r.json());

// Score: every fixture.expected.anomalies.type should appear in risks.flags
for (const expected of fixture.expected.anomalies) {
  const found = risks.flags?.some((f: any) => f.type === expected.type);
  if (!found) throw new Error(`Missing anomaly: ${expected.type} in ${fixture.id}`);
}
```
