# AcreOS Data Privacy

## What We Collect

**Account information:** Name, email address, organization name, subscription tier, billing information (processed by Stripe — we don't store card numbers).

**Property data:** Parcel information you import or create — addresses, APNs, county/state, acreage, assessed values, and enrichment data from government sources.

**Deal data:** Transaction records including purchase/sale prices, dates, parties, and associated documents.

**Note payment data:** For seller-financed deals — payment amounts, dates, balances, and borrower contact information.

**Communication history:** Emails sent and received through AcreOS, SMS messages, campaign records, and team messages.

**Usage analytics:** Feature usage, page views, session duration, and interaction patterns (used to improve the product, never sold).

## What We Never Share

**Personal data is never shared between organizations. Period.**

Your leads, contacts, property details, deal terms, financial information, and communications are visible only to your organization's members. No exceptions.

## Cross-Organization Data

AcreOS aggregates anonymized deal data to power market intelligence features (county price trends, days-on-market averages, demand indicators). Here's exactly how this works:

**What's contributed:** County name, acreage range (bucketed, not exact), price range (bucketed, not exact), deal type, and close date.

**What's never contributed:** Names, addresses, APNs, email addresses, phone numbers, contact information, exact prices, or any document content.

**Minimum cohort:** Data is only served when at least 5 organizations have contributed data for a given county. Below that threshold, no aggregated data is shown.

**Sophie Privacy Guard:** All cross-org data passes through the Sophie PII redaction system, which strips any personally identifiable information before aggregation. This is an automated process — not a policy, but a code-level enforcement.

**Opt-out available:** You can disable cross-org data contribution in Settings → Privacy. Your market intelligence features will still work using only your own data and public sources.

## Data Export

Full data export is available at any time via Settings → Data → Export All.

Exported data includes:
- All leads with full field history
- All properties with enrichment data
- All deals with transaction details
- All notes with payment history
- All documents (as file downloads)
- Full activity log
- Campaign records and analytics

Export format: JSON (structured) or CSV (tabular). Processing time depends on data volume — most exports complete within minutes.

## Data Deletion

**Account deletion** can be requested via Settings → Account → Delete Account, or by emailing support.

When you delete your account:
- All personal data (name, email, account info) is removed within 30 days
- All organization data (leads, deals, properties, notes, documents) is permanently deleted within 30 days
- Anonymized market contributions are not reversible — but they contain no identifying information (county + bucketed ranges only)
- Stripe billing data is handled per Stripe's retention policy
- Backup copies are purged within 90 days

## Third-Party Data Processors

| Service | Purpose | Data Shared | Training on Data? |
|---------|---------|-------------|-------------------|
| Stripe | Payment processing | Billing info, subscription status | No |
| AWS SES | Email delivery | Recipient email, email content | No |
| OpenAI / OpenRouter | AI processing | Prompt context (property data, user messages) | No — opted out of training |
| Twilio / Telnyx | SMS delivery | Phone numbers, message content | No |
| Sentry | Error monitoring | Error context (no PII) | No |
| Fly.io | Hosting | Application data (encrypted at rest) | No |

**AI data handling:** All AI requests are made with training opt-out enabled. OpenAI and OpenRouter do not use AcreOS user data to train their models. Prompt content is processed and discarded — not stored by the AI provider beyond the minimum required for abuse monitoring (typically 30 days, then deleted).

## Questions

If you have questions about how your data is handled, email privacy@acreos.com or reply to any email from AcreOS. We'll give you a straight answer.
