# AcreOS Data Processing Agreement (DPA)
**Version:** 1.0  
**Effective date:** 2026-06-01  
**Last updated:** 2026-05-31

*This Data Processing Agreement ("DPA") is entered into by and between AcreOS — a sole proprietorship of Thomas Norton based in Massachusetts (a Massachusetts limited liability company is being formed) — ("Processor") and the Customer identified in the applicable AcreOS subscription agreement ("Controller"), and is incorporated into and governed by the AcreOS Terms of Service ("Agreement"). Capitalized terms not defined here have the meanings given in the Agreement and the Privacy Policy.*

*This DPA applies to the extent that AcreOS processes Personal Data on behalf of the Controller in connection with providing the Service, and the processing is subject to the General Data Protection Regulation (EU) 2016/679 ("GDPR"), the UK GDPR, the California Consumer Privacy Act as amended by the CPRA ("CCPA"), or any other applicable data protection law.*

---

## Article 1 — Definitions

For purposes of this DPA:

**"Controller"** means the Customer who determines the purposes and means of the processing of Personal Data (the land investor, note investor, or their organization using AcreOS).

**"Processor"** means AcreOS (a sole proprietorship of Thomas Norton, Massachusetts; a Massachusetts limited liability company is being formed), which processes Personal Data on behalf of the Controller pursuant to the Agreement.

**"Personal Data"** means any information relating to an identified or identifiable natural person, including but not limited to: lead names, email addresses, postal addresses, phone numbers, property-owner identifying information, and any other information within the Service that constitutes personal data under applicable law.

**"Processing"** has the meaning given in the GDPR (Art. 4(2)): any operation or set of operations performed on Personal Data, including collection, recording, storage, use, disclosure, and deletion.

**"Sub-processor"** means any third party engaged by the Processor to process Personal Data on behalf of the Controller.

**"Data Subject"** means the natural person to whom Personal Data relates (e.g., a property owner in the Controller's lead database).

**"GDPR"** means Regulation (EU) 2016/679 of the European Parliament and of the Council.

**"UK GDPR"** means the GDPR as retained in UK law by the European Union (Withdrawal) Act 2018, as amended.

**"Supervisory Authority"** means the competent data protection authority for the jurisdiction applicable to the Controller.

---

## Article 2 — Nature and Purpose of Processing

**2.1 Purpose.** The Processor processes Personal Data solely for the purpose of providing the AcreOS Service to the Controller as described in the Agreement, including:
- Storing and organizing lead and contact data entered by the Controller
- Enabling AI-assisted analysis of lead data via the Pax assistant
- Facilitating outreach communications (email, SMS, direct mail) authorized by the Controller
- Supporting note origination and servicing workflows
- Generating documents, offers, and e-signature workflows on the Controller's instruction

**2.2 Duration.** The Processor processes Personal Data for the duration of the Agreement and for such additional period as is necessary to fulfill legal retention obligations or to complete processing requested before termination.

**2.3 Categories of Personal Data processed:**
- Identification data: names, email addresses, postal addresses, phone numbers
- Financial data: note terms, payment history (where entered by Controller)
- Property data: parcel identifiers, assessed values, ownership records
- Communication data: content of messages sent or received through the Service
- E-signature data: signature images, signing timestamps, IP addresses, browser data

**2.4 Categories of Data Subjects:**
- The Controller's leads (property owners and sellers)
- The Controller's borrowers (seller-finance note obligors)
- The Controller's team members (employees, VAs, partners)

---

## Article 3 — Controller's Instructions

**3.1 Processing on instruction.** The Processor shall process Personal Data only on documented instructions from the Controller, as set forth in the Agreement, this DPA, and any additional written instructions the Controller provides via the Service's configuration, API calls, or support channels. The Agreement and this DPA constitute the Controller's complete documented instructions as of the effective date.

**3.2 Legal obligations.** If the Processor is required by applicable law to process Personal Data in a manner other than as instructed, the Processor will inform the Controller of that legal requirement before processing, unless prohibited by law.

**3.3 Out-of-scope instructions.** The Processor will promptly notify the Controller if it believes an instruction violates applicable data protection law.

---

## Article 4 — Confidentiality

The Processor ensures that personnel authorized to process Personal Data have committed themselves to confidentiality or are under an appropriate statutory obligation of confidentiality, and that access to Personal Data is limited to those who need it to fulfill the Processor's obligations under the Agreement.

---

## Article 5 — Security Measures

**5.1 Technical and organizational measures (TOMs).** The Processor implements and maintains the following security measures, consistent with the risk presented by the processing:

| Measure | Implementation |
|---|---|
| Encryption in transit | TLS 1.3 on all connections |
| Encryption at rest | AES-256 on database volumes |
| Access controls | Role-based access control; principle of least privilege; MFA for administrative access |
| Audit logging | Immutable audit logs for data access, modifications, deletions, and e-signature events |
| API key protection | BYOK keys encrypted at rest; decrypted only for authorized API calls |
| Vulnerability management | Automated dependency scanning; security review on production deploys touching Personal Data |
| Incident response | Documented breach response plan; 72-hour supervisory authority notification for qualifying breaches |
| Backup and recovery | Encrypted automated backups; RTO/RPO targets documented in Service Level documentation |
| Sub-processor oversight | Contractual data protection obligations imposed on all Sub-processors |

**5.2 Updates to TOMs.** Security technology evolves. The Processor may update the TOMs over time to maintain an equivalent or higher level of security. The Processor will notify the Controller of material reductions to the TOMs.

---

## Article 6 — Sub-processors

**6.1 Authorized sub-processors.** The Controller hereby provides general authorization for the Processor to engage the Sub-processors listed in the AcreOS Privacy Policy (Section 8, Subprocessor List) as of the date the Controller enters into the Agreement. The current list is available at acreos.io/sub-processors and in the Privacy Policy.

**6.2 New sub-processors.** The Processor will provide at least 14 days' advance notice of the addition or replacement of Sub-processors by publishing an update to the sub-processor list and notifying Customers via email or in-app notification. The Controller may object to a new Sub-processor by notifying the Processor in writing within 14 days of the notice. If the Processor cannot address the Controller's objection and the objection is based on a material data protection concern, the Controller may terminate the Agreement without penalty by providing 30 days' written notice.

**6.3 Sub-processor obligations.** The Processor shall impose data protection obligations on all Sub-processors that are equivalent to those in this DPA, specifically ensuring that Sub-processors implement appropriate technical and organizational security measures and process Personal Data only for the purposes specified in the Agreement.

**6.4 Liability.** The Processor remains fully liable to the Controller for the performance of the Sub-processors' data protection obligations to the extent those obligations are delegated to the Sub-processor.

---

## Article 7 — Assistance with Data Subject Rights

**7.1 Data Subject requests.** The Processor shall, to the extent technically feasible and consistent with applicable law, assist the Controller in responding to requests from Data Subjects exercising their rights under applicable data protection law (access, correction, deletion, portability, restriction, objection). Where a Data Subject contacts the Processor directly, the Processor will promptly redirect that request to the Controller, unless the Processor is legally required to respond directly.

**7.2 Deletion.** Upon receiving a verified deletion request routed by the Controller, the Processor will delete or anonymize the specified Personal Data within **7 days**, except where retention is required by law. Deletion from backup systems will occur within 30 days of deletion from primary systems.

**7.3 Controller tools.** The Service provides Controllers with tools to fulfill Data Subject rights independently, including data export (CSV/JSON), lead deletion, and contact suppression. The Controller is responsible for using these tools to fulfill requests from their Data Subjects.

---

## Article 8 — Assistance with Compliance

The Processor shall assist the Controller in ensuring compliance with obligations under applicable data protection law, including in relation to:
- Security of processing (Article 32 GDPR)
- Notification of personal data breaches to supervisory authorities and Data Subjects (Articles 33-34 GDPR)
- Data protection impact assessments (Article 35 GDPR), where applicable
- Prior consultation with supervisory authorities (Article 36 GDPR), where applicable

Such assistance will be provided at the Controller's reasonable cost where significant effort is required.

---

## Article 9 — Data Breach Notification

**9.1 Processor notification.** The Processor shall notify the Controller without undue delay — and in any event within **72 hours** of becoming aware — of any Personal Data breach affecting the Controller's data. Notification shall include, to the extent known at the time:
- The nature of the breach (categories and approximate number of records affected)
- Contact details for the Processor's point of contact
- Likely consequences of the breach
- Measures taken or proposed to address the breach

**9.2 Ongoing updates.** Where all information cannot be provided simultaneously, the Processor shall provide information in phases as it becomes available.

**9.3 Controller responsibility.** The Controller is responsible for notifying relevant Supervisory Authorities and affected Data Subjects of breaches, as required by applicable law, using the information provided by the Processor.

---

## Article 10 — Deletion or Return of Data upon Termination

Upon termination or expiration of the Agreement, the Processor shall, at the Controller's election:
- **Return:** Provide a complete export of the Controller's Personal Data in a portable format (CSV, JSON) within 30 days of termination; or
- **Delete:** Permanently delete all Personal Data (other than data required to be retained by law) within 90 days of termination

The Processor shall provide written confirmation of deletion upon request. Data required to be retained by law (e.g., e-signature audit logs for 7 years, financial records for 7 years) will be retained for the legally required period and then deleted.

---

## Article 11 — Audit Rights

**11.1 Audit right.** The Controller has the right to audit the Processor's compliance with this DPA. Audits may be conducted:
- By review of the Processor's most recent third-party security audit reports or certifications (SOC 2 Type II, ISO 27001, or equivalent), which the Processor will provide upon written request; or
- By on-site inspection (or remote audit) on at least 60 days' written notice, no more than once per 12-month period, during business hours, and subject to execution of a confidentiality agreement

**11.2 Cost.** The Controller bears its own costs for any audit. The Processor may charge for reasonable time and resources if the audit scope is excessive or the audit is requested more than once per year.

---

## Article 12 — International Data Transfers

**12.1 Transfer mechanisms.** Where the Processor transfers Personal Data from the EEA, UK, or Switzerland to countries not deemed adequate by the European Commission or the UK ICO, the Processor shall ensure such transfers are conducted pursuant to:
- EU Standard Contractual Clauses (Commission Implementing Decision (EU) 2021/914) — Controller-to-Processor clauses (Module 2) or Processor-to-Sub-processor clauses (Module 3), as applicable; or
- UK International Data Transfer Agreement (IDTA); or
- Another valid transfer mechanism under applicable law

**12.2 SCC incorporation.** To the extent that this DPA or the Agreement does not already incorporate EU SCCs or the UK IDTA by reference, those clauses are hereby incorporated and form part of this DPA for transfers subject to GDPR or UK GDPR. The parties agree that the SCCs are completed as follows:
- Module 2 (Controller to Processor) applies for transfers where the Controller transfers Personal Data to the Processor
- Module 3 (Processor to Sub-processor) applies for transfers from the Processor to Sub-processors
- Option 1 (mutual) applies for Clause 17 (Governing law): Irish law
- Option 1 applies for Clause 18 (Jurisdiction): Irish courts

---

## Article 13 — Conflict

In the event of a conflict between this DPA and the Agreement, this DPA governs with respect to data protection matters. In all other respects, the Agreement governs.

---

## Article 14 — Entire DPA Agreement

This DPA, together with the Agreement and the Privacy Policy, constitutes the entire agreement between the parties with respect to the processing of Personal Data under the Agreement. This DPA supersedes any prior data processing arrangements, side letters, or agreements relating to the same subject matter.

---

## Article 15 — Execution

This DPA becomes effective upon the Customer's acceptance of the AcreOS Terms of Service (by click-through acceptance or by continued use of the Service after the effective date). No separate physical signature is required; acceptance of the Terms of Service constitutes acceptance of this DPA for customers whose processing activities are subject to applicable data protection law.

Customers requiring a signed DPA for regulatory or procurement purposes may request a countersigned copy by contacting legal@acreos.io.

---

**Processor:**  
AcreOS (a sole proprietorship of Thomas Norton, Massachusetts; Massachusetts LLC formation pending)  
legal@acreos.io  
[Registered agent address — to be confirmed upon LLC formation]

---

*v1.0 — 2026-05-31 — Drafted by Beatrice Whitfield, CRO. Not yet reviewed by outside counsel. Counsel review required before this DPA is presented to EU/EEA customers or included in a vendor procurement process. EU SCC form details (governing law, competent courts, optional clauses) should be confirmed with licensed EU data protection counsel.*
