/**
 * The ONE sub-processor list. /security, /legal/sub-processors and the
 * privacy policy's Section 8 table all render from this module — there is no
 * per-page copy to drift (A13-04: three pages used to name three different
 * sets of vendors, including a hosting provider and an email provider that
 * contradicted each other).
 *
 * Every row is backed by an integration that exists in code (the evidence
 * pointer is in `evidence`, kept for reviewers; it is not rendered). A vendor
 * with no code behind it does not belong here:
 *   - SendGrid is NOT listed: platform email is sent through AWS SES
 *     (server/services/emailService.ts). SendGrid code exists only to register
 *     an organisation's own sending domain (orgEmailIdentity.ts — domain names
 *     and DKIM selectors, no message content) and to test a customer's own
 *     key, which is the customer's processor, not ours.
 *   - Mercury (business banking) is NOT listed: it processes no customer data
 *     and has no code reference.
 *
 * Fields with no verifiable value are left undefined and render as "—";
 * nothing is invented to fill a column.
 */

export interface SubProcessor {
  vendor: string;
  purpose: string;
  dataCategories: string[];
  region: string;
  /** Vendor's published DPA / terms. Omitted when not on file. */
  dpaUrl?: string;
  /** ISO date the vendor was engaged. Omitted when not on file. */
  effectiveDate?: string;
  /** Used only when the operator enables the feature / connects the account. */
  optional?: boolean;
  /** Code that proves the integration exists (reviewer aid; not rendered). */
  evidence: string;
}

export const SUB_PROCESSORS_LAST_UPDATED = "2026-11-25";

export const SUB_PROCESSORS: readonly SubProcessor[] = [
  {
    vendor: "Clerk",
    purpose: "Authentication, session management, multi-factor authentication",
    dataCategories: ["email", "authentication factors", "session metadata"],
    region: "United States",
    dpaUrl: "https://clerk.com/legal/dpa",
    effectiveDate: "2025-09-01",
    evidence: "@clerk/express + @clerk/react; server/middleware/requireClerkMFA.ts",
  },
  {
    vendor: "Stripe",
    purpose: "Payment processing and subscription billing",
    dataCategories: ["billing email", "payment method (tokenized)", "tax IDs"],
    region: "United States, EU",
    dpaUrl: "https://stripe.com/legal/dpa",
    effectiveDate: "2025-09-01",
    evidence: "stripe package; server/routes-billing.ts",
  },
  {
    vendor: "Fly.io",
    purpose: "Application hosting and Postgres",
    dataCategories: ["all customer data at rest"],
    region: "United States",
    dpaUrl: "https://fly.io/legal/dpa",
    effectiveDate: "2025-09-01",
    evidence: "fly.toml (app acreos, primary_region iad); fly.pgbouncer.toml",
  },
  {
    vendor: "Cloudflare",
    purpose: "DNS, CDN and DDoS protection in front of the application",
    dataCategories: ["IP addresses", "request metadata"],
    region: "Global",
    dpaUrl: "https://www.cloudflare.com/cloudflare-customer-dpa/",
    effectiveDate: "2025-09-01",
    evidence: "server/index.ts trust-proxy handling of CF-Connecting-IP (traffic traverses Cloudflare before Fly)",
  },
  {
    vendor: "Amazon Web Services",
    purpose:
      "Transactional email delivery (SES); document storage (S3) where document storage is configured",
    dataCategories: [
      "recipient email",
      "message body",
      "delivery metadata",
      "uploaded documents (where S3 document storage is configured)",
    ],
    region: "United States",
    dpaUrl: "https://aws.amazon.com/service-terms/",
    effectiveDate: "2025-09-01",
    evidence:
      "@aws-sdk/client-ses in server/services/emailService.ts; @aws-sdk/client-s3 in server/services/documentStore.ts (DOCUMENTS_S3_BUCKET)",
  },
  {
    vendor: "Anthropic",
    purpose: "AI features (Pax)",
    dataCategories: ["prompt content and context you submit"],
    region: "United States",
    dpaUrl: "https://www.anthropic.com/legal/dpa",
    effectiveDate: "2025-12-01",
    optional: true,
    evidence: "@anthropic-ai/sdk; ANTHROPIC_API_KEY",
  },
  {
    vendor: "OpenAI",
    purpose: "AI features (model fallback)",
    dataCategories: ["prompt content and context you submit"],
    region: "United States",
    dpaUrl: "https://openai.com/policies/data-processing-addendum",
    effectiveDate: "2025-09-01",
    optional: true,
    evidence: "openai package; AI_INTEGRATIONS_OPENAI_API_KEY / OPENAI_API_KEY",
  },
  {
    vendor: "OpenRouter",
    purpose: "AI model routing and failover gateway",
    dataCategories: ["prompt content and context you submit (routed to the underlying model provider)"],
    region: "United States",
    optional: true,
    evidence: "OPENROUTER usage across server/ai and server/routes-*",
  },
  {
    vendor: "Voyage AI",
    purpose: "Semantic-search embeddings",
    dataCategories: ["text of notes, leads and documents (embedded as vectors for retrieval)"],
    region: "United States",
    optional: true,
    evidence: "server/services/embeddings/voyageClient.ts (VOYAGE_API_KEY)",
  },
  {
    vendor: "Twilio",
    purpose: "SMS and voice",
    dataCategories: ["recipient phone", "message body", "call metadata"],
    region: "United States",
    dpaUrl: "https://www.twilio.com/legal/data-protection-addendum",
    effectiveDate: "2025-10-01",
    optional: true,
    evidence: "server/services/smsService.ts; api.twilio.com",
  },
  {
    vendor: "Lob",
    purpose: "Direct mail (postcards and letters)",
    dataCategories: ["recipient name and mailing address", "mail content"],
    region: "United States",
    dpaUrl: "https://www.lob.com/legal/data-protection-agreement",
    effectiveDate: "2025-10-01",
    optional: true,
    evidence: "lob package; server/services/mail/mailLane.ts",
  },
  {
    vendor: "Sentry",
    purpose: "Error monitoring",
    dataCategories: ["stack traces", "redacted request context"],
    region: "United States",
    dpaUrl: "https://sentry.io/legal/dpa/",
    effectiveDate: "2025-09-01",
    evidence: "server/utils/sentry.ts, client/src/lib/sentry.ts (Sentry.init)",
  },
  {
    vendor: "PostHog",
    purpose: "Product analytics",
    dataCategories: ["usage events", "session data", "identifiers"],
    region: "United States",
    evidence: "client/src/lib/analytics.ts (posthog-js; no-op when VITE_POSTHOG_KEY is unset)",
  },
  {
    vendor: "Regrid",
    purpose: "Parcel data enrichment",
    dataCategories: ["public-record parcel queries"],
    region: "United States",
    dpaUrl: "https://regrid.com/dpa",
    effectiveDate: "2025-12-01",
    optional: true,
    evidence: "server/services/configManager.ts REGRID_API_KEY; parcel lookup providers",
  },
];

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);

/**
 * The <tr> rows of the privacy policy's Section 8 table, same markup the
 * asset's rows had. The asset carries {{SUBPROCESSOR_ROWS}}; privacy.tsx
 * substitutes this in, so the policy renders from the shared list.
 *
 * The list is a REQUIRED argument, deliberately: a default of
 * SUB_PROCESSORS would make every importer of this function retain the
 * whole list in its bundle chunk, and the list now ships as served
 * data (/sub-processors.json — client/src/lib/sub-processors.ts), so
 * the one client caller passes the loaded list in.
 */
export function subProcessorRowsHtml(list: readonly SubProcessor[]): string {
  return list
    .map(
      (sp) =>
        `<tr><td class="py-2 pr-4 font-medium">${esc(sp.vendor)}</td>` +
        `<td class="py-2 pr-4">${esc(sp.purpose)}</td>` +
        `<td class="py-2 pr-4">${esc(sp.dataCategories.join(", "))}</td>` +
        `<td class="py-2">${esc(sp.region)}</td></tr>`,
    )
    .join("\n");
}
