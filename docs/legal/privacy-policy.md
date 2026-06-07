# AcreOS Privacy Policy
**Version:** 1.0  
**Effective date:** 2026-06-01  
**Last updated:** 2026-05-31

*AcreOS ("AcreOS," "we," "us," or "our") is committed to protecting the privacy of our customers and their contacts. This Privacy Policy explains how we collect, use, disclose, and protect personal data in connection with our land investor platform ("Service").*

*We will never sell your data.*

---

## 1. Who This Policy Applies To

This Policy applies to:
- **Customers:** Registered users of the AcreOS platform (land investors, note investors, and their team members)
- **Leads and Contacts:** Property owners and other individuals whose information is entered into the Service by Customers
- **Visitors:** Anyone who visits acreos.io or the Service without a registered account

Customers are primarily **controllers** of data about their leads and contacts. AcreOS acts as a **processor** on behalf of Customers for that lead/contact data. See Section 13 (Data Processing Agreement) for more.

---

## 2. Data We Collect

### 2.1 Information You Provide Directly

- **Account data:** Name, email address, authentication credentials (managed by Clerk; we do not store passwords directly)
- **Organization data:** Business name, business type, target counties/markets, onboarding preferences
- **Lead and contact data:** Property owner names, mailing addresses, phone numbers, parcel identifiers, transaction records, notes, tags, and communication history you enter or import
- **Financial data:** Note terms, payment history, seller finance records (stored encrypted; payment card data processed by Stripe and not stored by AcreOS)
- **Campaign data:** Mail content, recipient lists, campaign settings
- **Support communications:** Messages submitted via support channels, feedback forms
- **User-generated content:** Documents, offer letters, contracts uploaded or generated in the Service

### 2.2 Data Collected Automatically

- **Usage data:** Features accessed, actions taken, time spent, page navigation
- **Device and browser data:** IP address, browser type, operating system, device identifiers, screen resolution
- **Log data:** Server logs including access times, HTTP methods, response codes
- **Cookies and similar technologies:** Session cookies (required for authentication), preference cookies, and analytics cookies (PostHog). See Section 9 for cookie details.
- **Signing audit data:** For e-signature events, IP address, browser fingerprint, and timestamp are logged per E-SIGN Act requirements

### 2.3 Data from Third-Party Sources

- **Parcel data:** Publicly available county assessor, recorder, and parcel database records obtained from Regrid and similar licensed data providers, used to populate property information
- **Skip-trace data:** Third-party skip-trace services used when Customer activates skip-tracing features (Customer is responsible for compliance with applicable laws when using this data)

---

## 3. How We Use Data

We use the data described above to:

- **Provide the Service:** Operate the platform, process transactions, service notes, generate AI-assisted outputs via Pax
- **Communicate with you:** Send transactional emails (receipts, alerts, signing notifications), account notifications, and — where you have consented — marketing communications
- **Improve the Service:** Analyze usage patterns, identify bugs, run A/B tests, train and evaluate internal AI models on aggregated, de-identified data
- **Ensure security and prevent fraud:** Detect anomalous behavior, verify identity, prevent abuse
- **Comply with legal obligations:** Respond to lawful requests from courts and regulators, maintain records required by law
- **Honor deletion requests:** Process data-subject requests as described in Section 7

**We do not use your lead/contact data or your customer business data to train AI models that benefit other customers or third parties without explicit consent.**

---

## 4. AI Processing and Pax

The Service uses AI systems, including **Pax** (our customer-facing AI assistant) and internal AI models. When you use Pax:

- Your prompts, uploaded documents, and the context of your account (lead data, property data, notes) may be sent to AI model providers (currently Anthropic) to generate responses
- AI providers process this data under their own privacy policies and data use agreements; see the subprocessor list in Section 8
- Pax outputs are suggestions for your review; AcreOS does not guarantee their accuracy
- You can reduce the data sent to Pax by limiting your queries and by using the autonomy controls in Settings (Pax > Controls)

---

## 5. Legal Bases for Processing (GDPR)

For customers in the European Economic Area (EEA), United Kingdom, or Switzerland, we process personal data on the following legal bases:

| Processing activity | Legal basis |
|---|---|
| Providing the contracted Service | Performance of contract (Art. 6(1)(b)) |
| Sending transactional communications | Performance of contract (Art. 6(1)(b)) |
| Security and fraud prevention | Legitimate interests (Art. 6(1)(f)) |
| Analytics and product improvement | Legitimate interests (Art. 6(1)(f)) |
| Marketing communications | Consent (Art. 6(1)(a)) |
| Compliance with legal obligations | Legal obligation (Art. 6(1)(c)) |
| E-signature audit trail | Legal obligation + legitimate interests |

Where we rely on legitimate interests, we have assessed that our interests are not overridden by your rights and interests. You may object to processing based on legitimate interests; see Section 7.

---

## 6. Data Retention

| Data type | Retention period |
|---|---|
| Account and organization data | Duration of active subscription + 90 days post-cancellation |
| Lead and contact data | Duration of active subscription + 90 days post-cancellation |
| Note and financial records | Duration of subscription + 7 years (legal/regulatory requirement for financial records) |
| E-signature audit logs | 7 years from date of signing (statute of limitations) |
| ATR determination records | 3 years from note origination date per 12 C.F.R. §1026.25(c)(3) |
| Server logs | 90 days rolling |
| Backup snapshots | Purged within 30 days of primary deletion |
| Billing records | 7 years (tax and accounting obligations) |

**Deletion requests:** Upon a verified deletion request, AcreOS will delete or anonymize your personal data within **7 days** of verification, except where retention is required by law (e.g., financial records, e-signature audit logs). See Section 7.

---

## 7. Your Rights

Depending on your jurisdiction, you have the following rights regarding your personal data:

| Right | What it means | How to exercise |
|---|---|---|
| **Access** | Obtain a copy of all personal data we hold about you | Data Subject Request via /privacy-settings |
| **Portability** | Receive your data in a machine-readable format (JSON, CSV) | Data export in account settings |
| **Correction** | Correct inaccurate or incomplete data | Edit in account settings or via support |
| **Deletion** | Permanent deletion of your personal data (subject to legal retention obligations) | Data Subject Request; honored within 7 days |
| **Restriction** | Limit our processing in certain circumstances | Data Subject Request |
| **Objection** | Object to processing based on legitimate interests | Data Subject Request |
| **Withdraw consent** | Withdraw any consent you have given (e.g., for marketing) | Email preferences or support |
| **Opt out of sale/sharing (CCPA)** | We do not sell or share personal data for cross-context behavioral advertising | N/A — this practice does not occur |

**To exercise any right:** Submit a request via /privacy-settings (Data Subject Requests) or email privacy@acreos.io. We will respond within 30 days for routine requests, or within the statutory deadline applicable to your jurisdiction (45 days for CCPA, 30 days for GDPR). We may need to verify your identity before processing certain requests.

**California residents (CCPA/CPRA):** In addition to the rights above, you have the right to know the categories of personal information we collect, the purposes for which it is used, and whether it is sold (it is not). You have the right to limit the use of sensitive personal information (as defined by CPRA). To exercise California rights: privacy@acreos.io or /privacy-settings.

---

## 8. Subprocessors

AcreOS uses the following third-party service providers ("subprocessors") who may process personal data on our behalf. This list is updated when subprocessors change; material changes will be notified per Section 16 of the Terms.

*Note: This list is provided as a transparency commitment. Exact subprocessor details (entity names, data transfer mechanisms, processing activities) will be confirmed and updated as vendor agreements are finalized.*

| Subprocessor | Category | Data processed | Location |
|---|---|---|---|
| **Anthropic** | AI model provider (Pax) | Prompt content, lead/property context sent to Pax | United States |
| **Stripe** | Payment processing | Subscription billing, payment card data | United States |
| **Fly.io** | Cloud hosting and compute | All Service data (hosted infrastructure) | United States (+ EU regions as applicable) |
| **Cloudflare** | CDN, DNS, DDoS protection | IP addresses, request metadata | United States |
| **Clerk** | Authentication | User identity, authentication tokens | United States |
| **AWS (Amazon Web Services)** | Email delivery (SES) | Email addresses, email content | United States |
| **Twilio** | SMS communications | Phone numbers, SMS content | United States |
| **Lob** | Direct mail fulfillment | Recipient names and postal addresses | United States |
| **Regrid** | Parcel data | Parcel identifiers, publicly-sourced property data | United States |
| **PostHog** | Product analytics | Usage events, session data, anonymized identifiers | United States / EU |
| **Mercury** | Business banking | Wire/ACH origination data (internal company use) | United States |
| **Sentry** | Error monitoring | Stack traces, anonymized user identifiers | United States |

For EU/EEA customers, transfers to US-based subprocessors are governed by Standard Contractual Clauses (SCCs) as required by GDPR Chapter V. AcreOS will provide copies of applicable SCCs upon written request.

---

## 9. Cookies and Tracking Technologies

We use the following cookie categories:

| Category | Purpose | Can be disabled? |
|---|---|---|
| **Strictly necessary** | Session management, authentication, CSRF protection | No — required for Service to function |
| **Functional** | Remembering preferences, onboarding state, dismissed banners | Partially — some preferences may reset |
| **Analytics** | PostHog usage analytics, product improvement (data is sampled and anonymized) | Yes — contact privacy@acreos.io |
| **Marketing** | None — we do not run retargeting or behavioral advertising cookies | N/A |

You can manage cookies through your browser settings. Disabling strictly necessary cookies will prevent you from logging in to the Service. A cookie consent banner is displayed to users in jurisdictions requiring explicit consent (EU/EEA, UK).

---

## 10. Data Security

AcreOS implements technical and organizational measures to protect personal data:

- Encryption in transit: TLS 1.3 for all connections
- Encryption at rest: AES-256 for database storage
- API key encryption: Customer BYOK keys are encrypted at rest and decrypted only for authorized API calls
- Access controls: Role-based access; principle of least privilege
- Audit logging: Sensitive actions (data access, deletions, ATR determinations, e-signatures) are logged immutably
- Vulnerability management: Automated dependency scanning; security review on production deploys touching customer data

No system is 100% secure. We cannot guarantee absolute security. We will notify you of any breach affecting your personal data as described in Section 11.

---

## 11. Data Breach Notification

In the event of a personal data breach that poses a risk to the rights and freedoms of individuals:

- **GDPR:** We will notify the applicable supervisory authority within **72 hours** of becoming aware of the breach, where feasible.
- **CCPA / US state laws:** We will notify affected California residents (and residents of other states with applicable breach notification laws) without unreasonable delay, and no later than required by applicable state law (generally 30-45 days from discovery for most US states).
- **Customer notification:** We will notify affected Customers via email (to the account email address on file) within 72 hours of determining that a breach has occurred that is reasonably likely to affect their data.

Breach notification will describe: the nature of the breach, the categories of data involved, approximate number of records affected, likely consequences, and measures taken or proposed to address the breach.

---

## 12. Children's Privacy

The Service is not directed to individuals under the age of 18. We do not knowingly collect personal information from children under 18. If we learn that we have collected personal data from a child under 18 without verifiable parental consent, we will delete it promptly. We do not market to or target individuals under 18 or individuals identified as being in financial distress.

---

## 13. Data Processing Agreement (Controller/Processor Relationship)

Where Customers use AcreOS to process personal data about their leads and contacts on behalf of their own business:
- The Customer is the **data controller**
- AcreOS is the **data processor**
- AcreOS processes that data only on the Customer's documented instructions (i.e., to provide the Service)
- AcreOS does not use lead/contact data for any purpose other than providing the contracted Service to that Customer

Customers who require a formal Data Processing Agreement (DPA) — for example, EU-based customers subject to GDPR Art. 28 — may request one at legal@acreos.io. A template DPA is available at `docs/legal/data-processing-agreement.md` in AcreOS's public documentation.

---

## 14. International Transfers

AcreOS is based in the United States. If you access the Service from outside the United States, your data is transferred to and processed in the United States. Where we transfer personal data from the EEA, UK, or Switzerland to the US or other countries not deemed adequate by the European Commission, we use Standard Contractual Clauses (SCCs) as the transfer mechanism.

---

## 15. Changes to This Policy

We may update this Policy from time to time. For material changes, we will provide at least 30 days' notice via email to your account email address or by prominent notice in the Service. The updated Policy will be posted at acreos.io/privacy with the new effective date. Your continued use of the Service after the effective date constitutes acceptance of the updated Policy.

---

## 16. Contact

**Privacy inquiries and data subject requests:**  
privacy@acreos.io  
/privacy-settings (in-app data subject request portal)

**Legal inquiries:**  
legal@acreos.io

**Mailing address:** [Registered agent address — to be confirmed upon LLC formation]

For EU/EEA residents: If you believe we have processed your personal data in violation of applicable law, you have the right to lodge a complaint with your local supervisory authority (e.g., the UK ICO, Ireland DPC, or the supervisory authority in your EU member state).

---

*AcreOS · operated by Thomas Norton (sole proprietor, Massachusetts) · acreos.io*

*v1.0 — 2026-05-31 — Drafted by Beatrice Whitfield, CRO. Not yet reviewed by outside counsel. Counsel review required before public deployment. This document supersedes the Privacy Policy previously published at acreos.io/privacy (last updated March 2026).*
