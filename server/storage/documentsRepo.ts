// Documents data layer: document templates (incl. the system-template
// seeder), generated documents, native e-signatures, document version
// history (create/list/restore), and document packages. Extracted from the
// god-class server/storage.ts in the storage refactor. Methods are merged
// into DatabaseStorage.prototype at construction time; `this` refers to the
// full DatabaseStorage instance (the in-cluster self-calls — versioning ->
// this.getGeneratedDocument, restore -> this.updateGeneratedDocument —
// resolve against the composed prototype).

import { and, desc, eq, max, or, sql } from "drizzle-orm";
import { db } from "../db";
import { forOrg } from "../utils/orgScopedDb";
import {
  documentTemplates,
  generatedDocuments,
  signatures,
  documentVersions,
  documentPackages,
  type InsertDocumentTemplate,
  type InsertGeneratedDocument,
  type InsertSignature,
  type InsertDocumentVersion,
  type InsertDocumentPackage,
} from "@shared/schema";
import type { DatabaseStorage } from "../storage";

export const documentsRepo = {
  // Document Templates
  async getDocumentTemplates(this: DatabaseStorage, orgId: number) {
    return db.select().from(documentTemplates)
      .where(and(
        or(
          eq(documentTemplates.organizationId, orgId),
          sql`${documentTemplates.organizationId} IS NULL`
        ),
        eq(documentTemplates.isActive, true)
      ))
      .orderBy(documentTemplates.isSystemTemplate, documentTemplates.name);
  },

  // Tier 1F: org-scoped by construction. System templates (isSystemTemplate)
  // are platform-shared and stay readable by every org; everything else is
  // pinned to the caller's tenant.
  async getDocumentTemplate(this: DatabaseStorage, organizationId: number, id: number) {
    const [template] = await db.select().from(documentTemplates)
      .where(and(
        eq(documentTemplates.id, id),
        or(
          eq(documentTemplates.organizationId, organizationId),
          eq(documentTemplates.isSystemTemplate, true),
        ),
      ));
    return template;
  },

  async createDocumentTemplate(this: DatabaseStorage, template: InsertDocumentTemplate) {
    const [created] = await db.insert(documentTemplates).values(template).returning();
    return created;
  },

  // Tier 1F: organizationId is now REQUIRED — bare-id updates no longer typecheck.
  async updateDocumentTemplate(this: DatabaseStorage, organizationId: number, id: number, updates: Partial<InsertDocumentTemplate>) {
    const existing = await this.getDocumentTemplate(organizationId, id);
    const currentVersion = existing?.version || 1;

    const conditions = [eq(documentTemplates.id, id), eq(documentTemplates.organizationId, organizationId)];
    const [updated] = await db.update(documentTemplates)
      .set({
        ...updates,
        version: currentVersion + 1,
        updatedAt: new Date()
      })
      .where(and(...conditions))
      .returning();
    return updated;
  },

  async deleteDocumentTemplate(this: DatabaseStorage, id: number, organizationId?: number): Promise<void> {
    const conditions = [eq(documentTemplates.id, id)];
    if (organizationId) conditions.push(eq(documentTemplates.organizationId, organizationId));
    await db.update(documentTemplates)
      .set({ isActive: false, updatedAt: new Date() })
      .where(and(...conditions));
  },

  async seedSystemTemplates(this: DatabaseStorage) {
    const existing = await db.select().from(documentTemplates)
      .where(eq(documentTemplates.isSystemTemplate, true));
    
    if (existing.length > 0) return;

    const systemTemplates: InsertDocumentTemplate[] = [
      {
        name: "Purchase Agreement",
        type: "purchase_agreement",
        category: "closing",
        isSystemTemplate: true,
        isActive: true,
        content: `<h1>REAL ESTATE PURCHASE AGREEMENT</h1>

<p>This Purchase Agreement ("Agreement") is entered into as of <strong>{{closing_date}}</strong>, by and between:</p>

<p><strong>SELLER:</strong> {{seller_name}}<br/>
<strong>BUYER:</strong> {{buyer_name}}</p>

<h2>1. PROPERTY DESCRIPTION</h2>
<p>The Seller agrees to sell, and the Buyer agrees to purchase, the following described real property:</p>
<p><strong>Property Address:</strong> {{property_address}}<br/>
<strong>Parcel Number:</strong> {{parcel_number}}<br/>
<strong>County:</strong> {{county}}, <strong>State:</strong> {{state}}</p>

<h2>2. PURCHASE PRICE</h2>
<p>The total purchase price for the Property shall be <strong>{{purchase_price}}</strong> ("Purchase Price"), payable as follows:</p>
<ul>
<li>Down Payment: {{down_payment}}</li>
<li>Balance due at closing or per financing terms</li>
</ul>

<h2>3. CLOSING</h2>
<p>The closing of this transaction shall take place on or before <strong>{{closing_date}}</strong>.</p>

<h2>4. SIGNATURES</h2>
<p>IN WITNESS WHEREOF, the parties have executed this Agreement as of the date first written above.</p>

<p>____________________________<br/>
Seller: {{seller_name}}<br/>
Date: _____________</p>

<p>____________________________<br/>
Buyer: {{buyer_name}}<br/>
Date: _____________</p>`,
        variables: [
          { name: "buyer_name", description: "Full legal name of the buyer", type: "text", required: true },
          { name: "seller_name", description: "Full legal name of the seller", type: "text", required: true },
          { name: "property_address", description: "Full street address of the property", type: "text", required: true },
          { name: "parcel_number", description: "APN/Parcel number", type: "text", required: true },
          { name: "county", description: "County where property is located", type: "text", required: true },
          { name: "state", description: "State where property is located", type: "text", required: true },
          { name: "purchase_price", description: "Total purchase price", type: "currency", required: true },
          { name: "down_payment", description: "Down payment amount", type: "currency", required: false, defaultValue: "$0" },
          { name: "closing_date", description: "Expected closing date", type: "date", required: true },
        ],
      },
      {
        name: "Quit Claim Deed",
        type: "quit_claim_deed",
        category: "closing",
        isSystemTemplate: true,
        isActive: true,
        content: `<h1>QUIT CLAIM DEED</h1>

<p><strong>Recording Requested By:</strong><br/>
{{buyer_name}}</p>

<p><strong>When Recorded Mail To:</strong><br/>
{{buyer_name}}<br/>
{{buyer_address}}</p>

<hr/>

<p>FOR VALUABLE CONSIDERATION, the receipt of which is hereby acknowledged,</p>

<p><strong>{{seller_name}}</strong> ("Grantor")</p>

<p>does hereby REMISE, RELEASE, and QUIT CLAIM to</p>

<p><strong>{{buyer_name}}</strong> ("Grantee")</p>

<p>the following described real property situated in <strong>{{county}}</strong> County, State of <strong>{{state}}</strong>:</p>

<p><strong>Property Address:</strong> {{property_address}}<br/>
<strong>Parcel Number:</strong> {{parcel_number}}</p>

<p><strong>Legal Description:</strong><br/>
{{legal_description}}</p>

<p>Dated: {{closing_date}}</p>

<p>____________________________<br/>
{{seller_name}}, Grantor</p>

<p><strong>STATE OF {{state}}</strong><br/>
<strong>COUNTY OF {{county}}</strong></p>

<p>On {{closing_date}}, before me, a Notary Public, personally appeared {{seller_name}}, who proved to me on the basis of satisfactory evidence to be the person(s) whose name(s) is/are subscribed to the within instrument and acknowledged to me that he/she/they executed the same in his/her/their authorized capacity(ies), and that by his/her/their signature(s) on the instrument the person(s), or the entity upon behalf of which the person(s) acted, executed the instrument.</p>

<p>____________________________<br/>
Notary Public</p>`,
        variables: [
          { name: "buyer_name", description: "Full legal name of the grantee (buyer)", type: "text", required: true },
          { name: "buyer_address", description: "Mailing address of the grantee", type: "text", required: true },
          { name: "seller_name", description: "Full legal name of the grantor (seller)", type: "text", required: true },
          { name: "property_address", description: "Full street address of the property", type: "text", required: true },
          { name: "parcel_number", description: "APN/Parcel number", type: "text", required: true },
          { name: "legal_description", description: "Full legal description from deed", type: "text", required: true },
          { name: "county", description: "County where property is located", type: "text", required: true },
          { name: "state", description: "State where property is located", type: "text", required: true },
          { name: "closing_date", description: "Date of execution", type: "date", required: true },
        ],
      },
      {
        name: "Assignment Contract",
        type: "assignment",
        category: "closing",
        isSystemTemplate: true,
        isActive: true,
        content: `<h1>ASSIGNMENT OF REAL ESTATE CONTRACT</h1>

<p>This Assignment of Real Estate Contract ("Assignment") is made and entered into as of <strong>{{closing_date}}</strong>, by and between:</p>

<p><strong>ASSIGNOR:</strong> {{seller_name}}<br/>
<strong>ASSIGNEE:</strong> {{buyer_name}}</p>

<h2>RECITALS</h2>

<p>WHEREAS, Assignor entered into a Real Estate Purchase Agreement dated {{original_contract_date}} ("Original Contract") for the purchase of real property located at:</p>

<p><strong>Property Address:</strong> {{property_address}}<br/>
<strong>Parcel Number:</strong> {{parcel_number}}<br/>
<strong>County:</strong> {{county}}, <strong>State:</strong> {{state}}</p>

<p>WHEREAS, Assignor desires to assign all of Assignor's right, title, and interest in the Original Contract to Assignee;</p>

<h2>ASSIGNMENT</h2>

<p>NOW, THEREFORE, in consideration of the sum of <strong>{{assignment_fee}}</strong> ("Assignment Fee") and other good and valuable consideration, the receipt and sufficiency of which is hereby acknowledged, Assignor hereby assigns, transfers, and conveys to Assignee all of Assignor's right, title, and interest in and to the Original Contract.</p>

<h2>PURCHASE PRICE</h2>
<p>The original purchase price under the Contract is <strong>{{purchase_price}}</strong>.</p>

<h2>SIGNATURES</h2>

<p>____________________________<br/>
Assignor: {{seller_name}}<br/>
Date: _____________</p>

<p>____________________________<br/>
Assignee: {{buyer_name}}<br/>
Date: _____________</p>`,
        variables: [
          { name: "buyer_name", description: "Full legal name of the assignee", type: "text", required: true },
          { name: "seller_name", description: "Full legal name of the assignor", type: "text", required: true },
          { name: "property_address", description: "Full street address of the property", type: "text", required: true },
          { name: "parcel_number", description: "APN/Parcel number", type: "text", required: true },
          { name: "county", description: "County where property is located", type: "text", required: true },
          { name: "state", description: "State where property is located", type: "text", required: true },
          { name: "purchase_price", description: "Original purchase price", type: "currency", required: true },
          { name: "assignment_fee", description: "Assignment fee amount", type: "currency", required: true },
          { name: "closing_date", description: "Date of assignment", type: "date", required: true },
          { name: "original_contract_date", description: "Date of original purchase contract", type: "date", required: true },
        ],
      },
      {
        name: "Promissory Note",
        type: "promissory_note",
        category: "financing",
        isSystemTemplate: true,
        isActive: true,
        content: `<h1>PROMISSORY NOTE</h1>

<p><strong>Principal Amount:</strong> {{principal_amount}}<br/>
<strong>Date:</strong> {{note_date}}<br/>
<strong>Maturity Date:</strong> {{maturity_date}}</p>

<hr/>

<p>FOR VALUE RECEIVED, the undersigned <strong>{{borrower_name}}</strong> ("Borrower"), whose address is {{borrower_address}}, hereby promises to pay to the order of <strong>{{lender_name}}</strong> ("Lender"), or assigns, at {{lender_address}}, or such other place as the holder hereof may designate in writing, the principal sum of <strong>{{principal_amount}}</strong>, together with interest thereon at the rate of <strong>{{interest_rate}}</strong> percent per annum, in lawful money of the United States of America.</p>

<h2>PAYMENT TERMS</h2>

<p>This Note shall be payable as follows:</p>
<ul>
<li><strong>Down Payment:</strong> {{down_payment}} paid upon execution of this Note</li>
<li><strong>Monthly Payments:</strong> {{monthly_payment}} due on the {{payment_day}} day of each month</li>
<li><strong>First Payment Due:</strong> {{first_payment_date}}</li>
<li><strong>Number of Payments:</strong> {{term_months}} monthly payments</li>
<li><strong>Final Payment Due:</strong> {{maturity_date}}</li>
</ul>

<h2>SECURITY</h2>

<p>This Note is secured by a deed of trust or mortgage on the following real property:</p>
<p><strong>Property Address:</strong> {{property_address}}<br/>
<strong>Parcel Number:</strong> {{parcel_number}}<br/>
<strong>County:</strong> {{county}}, <strong>State:</strong> {{state}}</p>

<h2>LATE CHARGES</h2>

<p>If any payment is not received within {{grace_period_days}} days after its due date, Borrower shall pay a late charge of {{late_fee_amount}} or {{late_fee_percentage}}% of the overdue payment, whichever is greater.</p>

<h2>PREPAYMENT</h2>

<p>Borrower may prepay this Note in whole or in part at any time without penalty.</p>

<h2>DEFAULT</h2>

<p>Upon default in the payment of any installment when due, or upon breach of any condition of the deed of trust or mortgage securing this Note, the entire unpaid principal balance, together with all accrued interest, shall, at the option of the holder, become immediately due and payable.</p>

<h2>SIGNATURES</h2>

<p>____________________________<br/>
Borrower: {{borrower_name}}<br/>
Date: _____________</p>

<p>____________________________<br/>
Lender: {{lender_name}}<br/>
Date: _____________</p>`,
        variables: [
          { name: "borrower_name", description: "Full legal name of the borrower", type: "text", required: true },
          { name: "borrower_address", description: "Mailing address of the borrower", type: "text", required: true },
          { name: "lender_name", description: "Full legal name of the lender", type: "text", required: true },
          { name: "lender_address", description: "Mailing address of the lender", type: "text", required: true },
          { name: "principal_amount", description: "Total loan amount", type: "currency", required: true },
          { name: "interest_rate", description: "Annual interest rate (e.g., 8.5)", type: "number", required: true },
          { name: "down_payment", description: "Down payment amount", type: "currency", required: false, defaultValue: "$0" },
          { name: "monthly_payment", description: "Monthly payment amount", type: "currency", required: true },
          { name: "payment_day", description: "Day of month payment is due", type: "number", required: true, defaultValue: "1" },
          { name: "term_months", description: "Total number of monthly payments", type: "number", required: true },
          { name: "note_date", description: "Date of the promissory note", type: "date", required: true },
          { name: "first_payment_date", description: "Date of first payment", type: "date", required: true },
          { name: "maturity_date", description: "Final payment due date", type: "date", required: true },
          { name: "property_address", description: "Full street address of the property", type: "text", required: true },
          { name: "parcel_number", description: "APN/Parcel number", type: "text", required: true },
          { name: "county", description: "County where property is located", type: "text", required: true },
          { name: "state", description: "State where property is located", type: "text", required: true },
          { name: "grace_period_days", description: "Number of grace period days", type: "number", required: false, defaultValue: "10" },
          { name: "late_fee_amount", description: "Late fee flat amount", type: "currency", required: false, defaultValue: "$25" },
          { name: "late_fee_percentage", description: "Late fee percentage", type: "number", required: false, defaultValue: "5" },
        ],
      },
      {
        name: "Warranty Deed",
        type: "warranty_deed",
        category: "closing",
        isSystemTemplate: true,
        isActive: true,
        content: `<h1>WARRANTY DEED</h1>

<p><strong>Recording Requested By:</strong><br/>
{{buyer_name}}</p>

<p><strong>When Recorded Mail To:</strong><br/>
{{buyer_name}}<br/>
{{buyer_address}}</p>

<p><strong>Mail Tax Statements To:</strong><br/>
{{buyer_name}}<br/>
{{buyer_address}}</p>

<hr/>

<p><strong>APN:</strong> {{parcel_number}}</p>

<h2>WARRANTY DEED</h2>

<p>FOR VALUABLE CONSIDERATION, receipt of which is hereby acknowledged,</p>

<p><strong>{{seller_name}}</strong>, Grantor(s),</p>

<p>hereby GRANT(S), BARGAIN(S), SELL(S), and CONVEY(S) to</p>

<p><strong>{{buyer_name}}</strong>, Grantee(s),</p>

<p>the following described real property in the County of <strong>{{county}}</strong>, State of <strong>{{state}}</strong>:</p>

<p><strong>Property Address:</strong> {{property_address}}</p>

<p><strong>Legal Description:</strong><br/>
{{legal_description}}</p>

<p>TOGETHER WITH all and singular the tenements, hereditaments, and appurtenances thereunto belonging or in anywise appertaining, and the reversion and reversions, remainder and remainders, rents, issues, and profits thereof.</p>

<p>TO HAVE AND TO HOLD the said premises unto the said Grantee(s), and Grantee's heirs and assigns forever.</p>

<p>AND THE SAID GRANTOR(S) hereby covenant(s) with the said Grantee(s), and Grantee's heirs and assigns, that Grantor(s) is/are seized of an indefeasible estate in fee simple in and to said premises; that Grantor(s) has/have good right to convey the same; that the premises are free from all encumbrances, except as noted herein; and that Grantor(s) will warrant and defend said premises against the lawful claims of all persons whomsoever.</p>

<p><strong>CONSIDERATION:</strong> {{purchase_price}}</p>

<p>Dated: {{closing_date}}</p>

<p>____________________________<br/>
{{seller_name}}, Grantor</p>

<h2>ACKNOWLEDGMENT</h2>

<p><strong>STATE OF {{state}}</strong><br/>
<strong>COUNTY OF {{county}}</strong></p>

<p>On {{closing_date}}, before me, a Notary Public in and for said State, personally appeared {{seller_name}}, known to me (or proved to me on the basis of satisfactory evidence) to be the person(s) whose name(s) is/are subscribed to the within instrument and acknowledged to me that he/she/they executed the same in his/her/their authorized capacity(ies), and that by his/her/their signature(s) on the instrument the person(s), or the entity upon behalf of which the person(s) acted, executed the instrument.</p>

<p>WITNESS my hand and official seal.</p>

<p>____________________________<br/>
Notary Public</p>

<p>My Commission Expires: _____________</p>`,
        variables: [
          { name: "buyer_name", description: "Full legal name of the grantee (buyer)", type: "text", required: true },
          { name: "buyer_address", description: "Mailing address of the grantee", type: "text", required: true },
          { name: "seller_name", description: "Full legal name of the grantor (seller)", type: "text", required: true },
          { name: "property_address", description: "Full street address of the property", type: "text", required: true },
          { name: "parcel_number", description: "APN/Parcel number", type: "text", required: true },
          { name: "legal_description", description: "Full legal description from deed", type: "text", required: true },
          { name: "county", description: "County where property is located", type: "text", required: true },
          { name: "state", description: "State where property is located", type: "text", required: true },
          { name: "purchase_price", description: "Purchase price/consideration", type: "currency", required: true },
          { name: "closing_date", description: "Date of execution", type: "date", required: true },
        ],
      },
      {
        name: "Offer Letter",
        type: "offer_letter",
        category: "acquisition",
        isSystemTemplate: true,
        isActive: true,
        content: `<h1>OFFER TO PURCHASE REAL PROPERTY</h1>

<p><strong>Date:</strong> {{offer_date}}</p>

<p><strong>To:</strong> {{seller_name}}</p>

<p><strong>From:</strong> {{buyer_name}}<br/>
{{buyer_address}}<br/>
{{buyer_phone}}<br/>
{{buyer_email}}</p>

<hr/>

<p>Dear {{seller_name}},</p>

<p>I am writing to express my interest in purchasing your property located at:</p>

<p><strong>Property Address:</strong> {{property_address}}<br/>
<strong>Parcel Number:</strong> {{parcel_number}}<br/>
<strong>County:</strong> {{county}}, <strong>State:</strong> {{state}}</p>

<h2>OFFER TERMS</h2>

<p>I am prepared to make the following offer for the above-referenced property:</p>

<ul>
<li><strong>Purchase Price:</strong> {{purchase_price}} (Cash offer)</li>
<li><strong>Earnest Money Deposit:</strong> {{earnest_money}}</li>
<li><strong>Proposed Closing Date:</strong> {{closing_date}}</li>
<li><strong>Offer Expiration:</strong> {{offer_expiration_date}}</li>
</ul>

<h2>CONDITIONS</h2>

<p>This offer is contingent upon:</p>
<ul>
<li>Clear and marketable title</li>
<li>Property inspection satisfactory to Buyer (if applicable)</li>
<li>Standard title insurance</li>
</ul>

<h2>BENEFITS OF THIS OFFER</h2>

<ul>
<li>All-cash offer with quick closing</li>
<li>No financing contingencies</li>
<li>Flexible closing date</li>
<li>Property purchased as-is</li>
</ul>

<p>I believe this offer represents fair value for your property and I am committed to a smooth, hassle-free transaction. Please feel free to contact me at {{buyer_phone}} or {{buyer_email}} to discuss this offer further.</p>

<p>I look forward to hearing from you.</p>

<p>Sincerely,</p>

<p>____________________________<br/>
{{buyer_name}}</p>

<p>This offer expires on {{offer_expiration_date}} at 11:59 PM local time.</p>`,
        variables: [
          { name: "buyer_name", description: "Full legal name of the buyer", type: "text", required: true },
          { name: "buyer_address", description: "Mailing address of the buyer", type: "text", required: true },
          { name: "buyer_phone", description: "Buyer's phone number", type: "text", required: true },
          { name: "buyer_email", description: "Buyer's email address", type: "text", required: true },
          { name: "seller_name", description: "Full legal name of the seller", type: "text", required: true },
          { name: "property_address", description: "Full street address of the property", type: "text", required: true },
          { name: "parcel_number", description: "APN/Parcel number", type: "text", required: true },
          { name: "county", description: "County where property is located", type: "text", required: true },
          { name: "state", description: "State where property is located", type: "text", required: true },
          { name: "purchase_price", description: "Offered purchase price", type: "currency", required: true },
          { name: "earnest_money", description: "Earnest money deposit amount", type: "currency", required: false, defaultValue: "$100" },
          { name: "offer_date", description: "Date of the offer letter", type: "date", required: true },
          { name: "closing_date", description: "Proposed closing date", type: "date", required: true },
          { name: "offer_expiration_date", description: "Date when offer expires", type: "date", required: true },
        ],
      },
    ];

    await db.insert(documentTemplates).values(systemTemplates);
  },

  // Generated Documents
  async getGeneratedDocuments(this: DatabaseStorage, orgId: number, filters?: { dealId?: number; propertyId?: number; status?: string }) {
    let conditions = [eq(generatedDocuments.organizationId, orgId)];
    
    if (filters?.dealId) {
      conditions.push(eq(generatedDocuments.dealId, filters.dealId));
    }
    if (filters?.propertyId) {
      conditions.push(eq(generatedDocuments.propertyId, filters.propertyId));
    }
    if (filters?.status) {
      conditions.push(eq(generatedDocuments.status, filters.status));
    }
    
    return db.select().from(generatedDocuments)
      .where(and(...conditions))
      .orderBy(desc(generatedDocuments.createdAt));
  },

  async getGeneratedDocument(this: DatabaseStorage, orgId: number, id: number) {
    const [doc] = await db.select().from(generatedDocuments)
      .where(and(eq(generatedDocuments.id, id), eq(generatedDocuments.organizationId, orgId)));
    return doc;
  },

  async createGeneratedDocument(this: DatabaseStorage, doc: InsertGeneratedDocument) {
    const [created] = await db.insert(generatedDocuments).values(doc).returning();
    return created;
  },

  async updateGeneratedDocument(this: DatabaseStorage, id: number, updates: Partial<InsertGeneratedDocument>, organizationId?: number) {
    const conditions = [eq(generatedDocuments.id, id)];
    if (organizationId) conditions.push(eq(generatedDocuments.organizationId, organizationId));
    const [updated] = await db.update(generatedDocuments)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(...conditions))
      .returning();
    return updated;
  },

  // Native E-Signatures
  async getSignatures(this: DatabaseStorage, orgId: number, documentId?: number) {
    let conditions = [eq(signatures.organizationId, orgId)];
    if (documentId) {
      conditions.push(eq(signatures.documentId, documentId));
    }
    return db.select().from(signatures)
      .where(and(...conditions))
      .orderBy(desc(signatures.signedAt));
  },

  async getSignature(this: DatabaseStorage, orgId: number, id: number) {
    const [sig] = await db.select().from(signatures)
      .where(and(eq(signatures.id, id), eq(signatures.organizationId, orgId)));
    return sig;
  },

  async createSignature(this: DatabaseStorage, signature: InsertSignature) {
    const [created] = await db.insert(signatures).values(signature).returning();
    return created;
  },

  async getDocumentSignatures(this: DatabaseStorage, documentId: number) {
    return db.select().from(signatures)
      .where(eq(signatures.documentId, documentId))
      .orderBy(signatures.signedAt);
  },

  // Document Version History
  async createDocumentVersion(this: DatabaseStorage, version: InsertDocumentVersion) {
    const [created] = await db.insert(documentVersions).values(version).returning();
    return created;
  },

  async getDocumentVersions(this: DatabaseStorage, orgId: number, documentId: number, documentType: string) {
    return db.select().from(documentVersions)
      .where(and(
        eq(documentVersions.organizationId, orgId),
        eq(documentVersions.documentId, documentId),
        eq(documentVersions.documentType, documentType)
      ))
      .orderBy(desc(documentVersions.version));
  },

  // Tier 1F: org-scoped by construction.
  async getDocumentVersion(this: DatabaseStorage, organizationId: number, id: number) {
    return await forOrg(organizationId).findById(documentVersions, id);
  },

  async restoreDocumentVersion(this: DatabaseStorage, orgId: number, versionId: number): Promise<{ success: boolean; message: string }> {
    // Tier 1F: the fetch itself is org-pinned — a cross-org versionId resolves
    // to "not found" by construction.
    const version = await this.getDocumentVersion(orgId, versionId);
    if (!version) {
      return { success: false, message: "Version not found" };
    }

    if (version.documentType === "template") {
      const template = await this.getDocumentTemplate(orgId, version.documentId);
      if (!template) {
        return { success: false, message: "Template not found" };
      }
      
      const currentVersion = template.version || 1;
      await this.createDocumentVersion({
        organizationId: orgId,
        documentId: template.id,
        documentType: "template",
        version: currentVersion,
        content: template.content,
        variables: template.variables,
        changes: `Auto-saved before restoring to version ${version.version}`,
        createdBy: version.createdBy,
      });
      
      await this.updateDocumentTemplate(orgId, template.id, {
        content: version.content,
        variables: version.variables as any,
        version: currentVersion + 1,
      });
      
      return { success: true, message: `Restored to version ${version.version}` };
    } else if (version.documentType === "generated") {
      const doc = await this.getGeneratedDocument(orgId, version.documentId);
      if (!doc) {
        return { success: false, message: "Document not found" };
      }
      
      const versions = await this.getDocumentVersions(orgId, doc.id, "generated");
      const currentVersionNum = versions.length > 0 ? Math.max(...versions.map(v => v.version)) : 0;
      
      await this.createDocumentVersion({
        organizationId: orgId,
        documentId: doc.id,
        documentType: "generated",
        version: currentVersionNum + 1,
        content: doc.content || "",
        changes: `Auto-saved before restoring to version ${version.version}`,
        createdBy: version.createdBy,
      });
      
      await this.updateGeneratedDocument(doc.id, {
        content: version.content,
      });
      
      return { success: true, message: `Restored to version ${version.version}` };
    }

    return { success: false, message: "Invalid document type" };
  },

  // Document Packages
  async getDocumentPackages(this: DatabaseStorage, orgId: number, filters?: { dealId?: number; propertyId?: number; status?: string }) {
    let conditions = [eq(documentPackages.organizationId, orgId)];
    
    if (filters?.dealId) {
      conditions.push(eq(documentPackages.dealId, filters.dealId));
    }
    if (filters?.propertyId) {
      conditions.push(eq(documentPackages.propertyId, filters.propertyId));
    }
    if (filters?.status) {
      conditions.push(eq(documentPackages.status, filters.status));
    }
    
    return db.select().from(documentPackages)
      .where(and(...conditions))
      .orderBy(desc(documentPackages.createdAt));
  },

  async getDocumentPackage(this: DatabaseStorage, orgId: number, id: number) {
    const [pkg] = await db.select().from(documentPackages)
      .where(and(eq(documentPackages.id, id), eq(documentPackages.organizationId, orgId)));
    return pkg;
  },

  async createDocumentPackage(this: DatabaseStorage, pkg: InsertDocumentPackage) {
    const [created] = await db.insert(documentPackages).values(pkg).returning();
    return created;
  },

  async updateDocumentPackage(this: DatabaseStorage, id: number, updates: Partial<InsertDocumentPackage>, organizationId?: number) {
    const conditions = [eq(documentPackages.id, id)];
    if (organizationId) conditions.push(eq(documentPackages.organizationId, organizationId));
    const [updated] = await db.update(documentPackages)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(...conditions))
      .returning();
    return updated;
  },

  async deleteDocumentPackage(this: DatabaseStorage, orgId: number, id: number) {
    const [deleted] = await db.delete(documentPackages)
      .where(and(eq(documentPackages.id, id), eq(documentPackages.organizationId, orgId)))
      .returning();
    return deleted;
  },

  async getPackagesByDeal(this: DatabaseStorage, orgId: number, dealId: number) {
    return db.select().from(documentPackages)
      .where(and(
        eq(documentPackages.organizationId, orgId),
        eq(documentPackages.dealId, dealId)
      ))
      .orderBy(desc(documentPackages.createdAt));
  },

  async getPackagesByProperty(this: DatabaseStorage, orgId: number, propertyId: number) {
    return db.select().from(documentPackages)
      .where(and(
        eq(documentPackages.organizationId, orgId),
        eq(documentPackages.propertyId, propertyId)
      ))
      .orderBy(desc(documentPackages.createdAt));
  },
};

export type DocumentsRepo = typeof documentsRepo;
