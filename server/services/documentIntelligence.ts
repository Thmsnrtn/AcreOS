import { db } from "../db";
import {
  documentAnalysis,
  properties,
  deals,
  agentEvents,
  type DocumentAnalysis,
  type InsertDocumentAnalysis,
} from "@shared/schema";
import { eq, and, desc, ilike, or } from "drizzle-orm";
import { getOpenAIClient } from "../utils/openaiClient";

type DocumentType = "deed" | "contract" | "title_report" | "survey" | "note" | "mortgage" | "tax_bill" | "closing_statement";

interface UploadDocumentParams {
  documentType: DocumentType;
  documentName: string;
  fileUrl: string;
  propertyId?: number;
  dealId?: number;
}

interface ExtractedData {
  grantorName?: string;
  granteeName?: string;
  legalDescription?: string;
  recordingInfo?: { book?: string; page?: string; date?: string };
  considerationAmount?: number;
  buyerName?: string;
  sellerName?: string;
  purchasePrice?: number;
  closingDate?: string;
  contingencies?: string[];
  deadlines?: Array<{ name: string; date: string }>;
  principalAmount?: number;
  interestRate?: number;
  term?: number;
  paymentAmount?: number;
  maturityDate?: string;
  collateralDescription?: string;
  taxYear?: number;
  assessedValue?: number;
  taxAmount?: number;
  dueDate?: string;
  exemptions?: string[];
  parties?: Array<{ name: string; role: string }>;
  dates?: Array<{ label: string; date: string }>;
  amounts?: Array<{ label: string; amount: number }>;
  signatures?: string[];
}

interface KeyTerm {
  term: string;
  value: string;
  importance: string;
  pageNumber?: number;
}

interface RiskFlag {
  issue: string;
  severity: string;
  recommendation: string;
}

interface DocumentComparison {
  doc1Id: number;
  doc2Id: number;
  differences: Array<{
    field: string;
    doc1Value: any;
    doc2Value: any;
    significance: string;
  }>;
  summary: string;
}

export class DocumentIntelligenceService {

  async uploadDocument(
    organizationId: number,
    params: UploadDocumentParams
  ): Promise<DocumentAnalysis> {
    const { documentType, documentName, fileUrl, propertyId, dealId } = params;

    const docData: InsertDocumentAnalysis = {
      organizationId,
      documentType,
      documentName,
      fileUrl,
      propertyId: propertyId ?? null,
      dealId: dealId ?? null,
      status: "pending",
    };

    const [document] = await db.insert(documentAnalysis).values(docData).returning();

    await this.logEvent(organizationId, "document_uploaded", {
      documentId: document.id,
      documentType,
      documentName,
      propertyId,
      dealId,
    });

    return document;
  }

  async processDocument(documentId: number): Promise<DocumentAnalysis> {
    const [doc] = await db
      .select()
      .from(documentAnalysis)
      .where(eq(documentAnalysis.id, documentId))
      .limit(1);

    if (!doc) {
      throw new Error(`Document ${documentId} not found`);
    }

    await db
      .update(documentAnalysis)
      .set({ status: "processing", updatedAt: new Date() })
      .where(eq(documentAnalysis.id, documentId));

    await this.logEvent(doc.organizationId, "document_processing_started", {
      documentId,
      documentType: doc.documentType,
    });

    try {
      const rawText = await this.extractText(documentId, doc.fileUrl || "");

      await db
        .update(documentAnalysis)
        .set({ rawText, updatedAt: new Date() })
        .where(eq(documentAnalysis.id, documentId));

      const extractedData = await this.parseDocument(documentId);

      const keyTerms = await this.extractKeyTerms(documentId);

      const riskFlags = await this.analyzeRisks(documentId);

      const [updatedDoc] = await db
        .update(documentAnalysis)
        .set({
          extractedData,
          keyTerms,
          riskFlags,
          status: "completed",
          processedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(documentAnalysis.id, documentId))
        .returning();

      await this.logEvent(doc.organizationId, "document_processing_completed", {
        documentId,
        documentType: doc.documentType,
        keyTermsCount: keyTerms.length,
        riskFlagsCount: riskFlags.length,
      });

      return updatedDoc;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      await db
        .update(documentAnalysis)
        .set({ status: "failed", updatedAt: new Date() })
        .where(eq(documentAnalysis.id, documentId));

      await this.logEvent(doc.organizationId, "document_processing_failed", {
        documentId,
        error: errorMessage,
      });

      throw error;
    }
  }

  async extractText(documentId: number, fileUrl: string): Promise<string> {
    const [doc] = await db
      .select()
      .from(documentAnalysis)
      .where(eq(documentAnalysis.id, documentId))
      .limit(1);

    if (!doc) {
      throw new Error(`Document ${documentId} not found`);
    }

    const openai = getOpenAIClient();
    if (openai && fileUrl) {
      try {
        const response = await openai.chat.completions.create({
          model: "gpt-4o",
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: "Extract all text content from this document image. Return the raw text exactly as it appears.",
                },
                {
                  type: "image_url",
                  image_url: { url: fileUrl },
                },
              ],
            },
          ],
          max_tokens: 4000,
        });

        const extractedText = response.choices[0]?.message?.content || "";

        await db
          .update(documentAnalysis)
          .set({
            rawText: extractedText,
            ocrConfidence: "0.85",
            updatedAt: new Date(),
          })
          .where(eq(documentAnalysis.id, documentId));

        return extractedText;
      } catch (error) {
        console.error(`[document-intelligence] OCR extraction error:`, error);
      }
    }

    return `[Placeholder: Text extraction from ${fileUrl || "document"} pending. OpenAI Vision can be used for OCR.]`;
  }

  async parseDocument(documentId: number): Promise<ExtractedData> {
    const [doc] = await db
      .select()
      .from(documentAnalysis)
      .where(eq(documentAnalysis.id, documentId))
      .limit(1);

    if (!doc) {
      throw new Error(`Document ${documentId} not found`);
    }

    const rawText = doc.rawText || "";
    const documentType = doc.documentType as DocumentType;

    const openai = getOpenAIClient();
    if (!openai || !rawText) {
      return this.getDefaultExtractedData(documentType);
    }

    const prompt = this.getParsingPrompt(documentType);

    try {
      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: `You are a legal document parser specializing in real estate documents. ${prompt}
            
Return a JSON object with the extracted data. Be precise with amounts, dates, and names.`,
          },
          {
            role: "user",
            content: `Parse the following ${documentType} document and extract the relevant information:\n\n${rawText}`,
          },
        ],
        response_format: { type: "json_object" },
        max_tokens: 2000,
      });

      const content = response.choices[0]?.message?.content || "{}";
      const parsed = JSON.parse(content) as ExtractedData;

      return parsed;
    } catch (error) {
      console.error(`[document-intelligence] Parsing error for document ${documentId}:`, error);
      return this.getDefaultExtractedData(documentType);
    }
  }

  private getParsingPrompt(documentType: DocumentType): string {
    const prompts: Record<DocumentType, string> = {
      deed: `Extract: grantorName (seller), granteeName (buyer), legalDescription, recordingInfo (book, page, date), considerationAmount (purchase price).`,
      contract: `Extract: buyerName, sellerName, purchasePrice, closingDate, contingencies (array of conditions), deadlines (array of {name, date}).`,
      title_report: `Extract: parties involved, any liens or encumbrances, exceptions, legal description.`,
      survey: `Extract: legal description, acreage, boundary descriptions, easements, encroachments.`,
      note: `Extract: principalAmount, interestRate (as decimal), term (in months), paymentAmount, maturityDate.`,
      mortgage: `Extract: principalAmount, interestRate, term, paymentAmount, maturityDate, collateralDescription.`,
      tax_bill: `Extract: taxYear, assessedValue, taxAmount (amount due), dueDate, exemptions (array).`,
      closing_statement: `Extract: buyerName, sellerName, purchasePrice, all fees and adjustments with amounts, closing date.`,
    };

    return prompts[documentType] || "Extract all relevant parties, dates, and amounts from this document.";
  }

  private getDefaultExtractedData(documentType: DocumentType): ExtractedData {
    const defaults: Record<DocumentType, ExtractedData> = {
      deed: { grantorName: undefined, granteeName: undefined, legalDescription: undefined },
      contract: { buyerName: undefined, sellerName: undefined, purchasePrice: undefined },
      title_report: { parties: [] },
      survey: { legalDescription: undefined },
      note: { principalAmount: undefined, interestRate: undefined, term: undefined },
      mortgage: { principalAmount: undefined, interestRate: undefined, collateralDescription: undefined },
      tax_bill: { taxYear: undefined, assessedValue: undefined, taxAmount: undefined },
      closing_statement: { buyerName: undefined, sellerName: undefined, purchasePrice: undefined },
    };

    return defaults[documentType] || {};
  }

  async extractKeyTerms(documentId: number): Promise<KeyTerm[]> {
    const [doc] = await db
      .select()
      .from(documentAnalysis)
      .where(eq(documentAnalysis.id, documentId))
      .limit(1);

    if (!doc || !doc.rawText) {
      return [];
    }

    const openai = getOpenAIClient();
    if (!openai) {
      return [];
    }

    try {
      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: `You are a legal document analyzer. Extract key terms and clauses from real estate documents.
            
Return a JSON object with a "keyTerms" array containing objects with:
- term: the name/type of the term (e.g., "Purchase Price", "Closing Date", "Earnest Money")
- value: the actual value or text
- importance: "high", "medium", or "low"
- pageNumber: if identifiable, otherwise null`,
          },
          {
            role: "user",
            content: `Extract key terms from this ${doc.documentType} document:\n\n${doc.rawText}`,
          },
        ],
        response_format: { type: "json_object" },
        max_tokens: 1500,
      });

      const content = response.choices[0]?.message?.content || "{}";
      const parsed = JSON.parse(content);

      return parsed.keyTerms || [];
    } catch (error) {
      console.error(`[document-intelligence] Key terms extraction error:`, error);
      return [];
    }
  }

  async analyzeRisks(documentId: number): Promise<RiskFlag[]> {
    const [doc] = await db
      .select()
      .from(documentAnalysis)
      .where(eq(documentAnalysis.id, documentId))
      .limit(1);

    if (!doc || !doc.rawText) {
      return [];
    }

    const openai = getOpenAIClient();
    if (!openai) {
      return [];
    }

    try {
      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: `You are a legal risk analyst specializing in real estate documents. Identify potential issues, red flags, and concerns.
            
Return a JSON object with a "riskFlags" array containing objects with:
- issue: description of the potential problem
- severity: "low", "medium", "high", or "critical"
- recommendation: suggested action to address the issue

Look for: missing signatures, unclear terms, unusual clauses, title issues, lien concerns, deadline conflicts, ambiguous language, missing disclosures.`,
          },
          {
            role: "user",
            content: `Analyze this ${doc.documentType} for potential risks and red flags:\n\n${doc.rawText}`,
          },
        ],
        response_format: { type: "json_object" },
        max_tokens: 1500,
      });

      const content = response.choices[0]?.message?.content || "{}";
      const parsed = JSON.parse(content);

      return parsed.riskFlags || [];
    } catch (error) {
      console.error(`[document-intelligence] Risk analysis error:`, error);
      return [];
    }
  }

  async getDocumentsByProperty(
    organizationId: number,
    propertyId: number
  ): Promise<DocumentAnalysis[]> {
    return await db
      .select()
      .from(documentAnalysis)
      .where(
        and(
          eq(documentAnalysis.organizationId, organizationId),
          eq(documentAnalysis.propertyId, propertyId)
        )
      )
      .orderBy(desc(documentAnalysis.createdAt));
  }

  async getDocumentsByDeal(
    organizationId: number,
    dealId: number
  ): Promise<DocumentAnalysis[]> {
    return await db
      .select()
      .from(documentAnalysis)
      .where(
        and(
          eq(documentAnalysis.organizationId, organizationId),
          eq(documentAnalysis.dealId, dealId)
        )
      )
      .orderBy(desc(documentAnalysis.createdAt));
  }

  async compareDocumentVersions(
    docId1: number,
    docId2: number
  ): Promise<DocumentComparison> {
    const [doc1, doc2] = await Promise.all([
      db.select().from(documentAnalysis).where(eq(documentAnalysis.id, docId1)).limit(1),
      db.select().from(documentAnalysis).where(eq(documentAnalysis.id, docId2)).limit(1),
    ]);

    if (!doc1[0] || !doc2[0]) {
      throw new Error("One or both documents not found");
    }

    const differences: DocumentComparison["differences"] = [];

    const extracted1 = doc1[0].extractedData || {};
    const extracted2 = doc2[0].extractedData || {};

    const allKeys = Array.from(new Set([...Object.keys(extracted1), ...Object.keys(extracted2)]));

    for (const key of allKeys) {
      const val1 = (extracted1 as Record<string, any>)[key];
      const val2 = (extracted2 as Record<string, any>)[key];

      if (JSON.stringify(val1) !== JSON.stringify(val2)) {
        differences.push({
          field: key,
          doc1Value: val1,
          doc2Value: val2,
          significance: this.assessDifferenceSignificance(key, val1, val2),
        });
      }
    }

    const openai = getOpenAIClient();
    let summary = `Found ${differences.length} difference(s) between documents.`;

    if (openai && differences.length > 0) {
      try {
        const response = await openai.chat.completions.create({
          model: "gpt-4o",
          messages: [
            {
              role: "system",
              content: "Summarize the key differences between two versions of a real estate document in 2-3 sentences.",
            },
            {
              role: "user",
              content: `Document 1: ${doc1[0].documentName}\nDocument 2: ${doc2[0].documentName}\n\nDifferences:\n${JSON.stringify(differences, null, 2)}`,
            },
          ],
          max_tokens: 300,
        });

        summary = response.choices[0]?.message?.content || summary;
      } catch (error) {
        console.error(`[document-intelligence] Comparison summary error:`, error);
      }
    }

    return {
      doc1Id: docId1,
      doc2Id: docId2,
      differences,
      summary,
    };
  }

  private assessDifferenceSignificance(field: string, val1: any, val2: any): string {
    const highSignificanceFields = [
      "purchasePrice",
      "principalAmount",
      "closingDate",
      "maturityDate",
      "interestRate",
      "considerationAmount",
    ];

    const mediumSignificanceFields = [
      "contingencies",
      "deadlines",
      "parties",
      "legalDescription",
    ];

    if (highSignificanceFields.includes(field)) {
      return "high";
    }

    if (mediumSignificanceFields.includes(field)) {
      return "medium";
    }

    return "low";
  }

  async generateDocumentSummary(documentId: number): Promise<string> {
    const [doc] = await db
      .select()
      .from(documentAnalysis)
      .where(eq(documentAnalysis.id, documentId))
      .limit(1);

    if (!doc) {
      throw new Error(`Document ${documentId} not found`);
    }

    const openai = getOpenAIClient();
    if (!openai) {
      return `${doc.documentType} document: ${doc.documentName}. Process with AI for detailed summary.`;
    }

    const context = {
      type: doc.documentType,
      name: doc.documentName,
      extractedData: doc.extractedData,
      keyTerms: doc.keyTerms,
      riskFlags: doc.riskFlags,
      rawText: doc.rawText?.substring(0, 3000),
    };

    try {
      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: `You are a real estate document analyst. Provide a clear, concise executive summary of the document in 3-5 sentences. Highlight key terms, parties involved, important dates, and any notable concerns.`,
          },
          {
            role: "user",
            content: `Summarize this ${doc.documentType}:\n\n${JSON.stringify(context, null, 2)}`,
          },
        ],
        max_tokens: 500,
      });

      return response.choices[0]?.message?.content || "Unable to generate summary.";
    } catch (error) {
      console.error(`[document-intelligence] Summary generation error:`, error);
      return `${doc.documentType} document: ${doc.documentName}. Summary generation failed.`;
    }
  }

  async searchDocuments(
    organizationId: number,
    query: string
  ): Promise<DocumentAnalysis[]> {
    const searchPattern = `%${query}%`;

    const results = await db
      .select()
      .from(documentAnalysis)
      .where(
        and(
          eq(documentAnalysis.organizationId, organizationId),
          or(
            ilike(documentAnalysis.documentName, searchPattern),
            ilike(documentAnalysis.rawText, searchPattern)
          )
        )
      )
      .orderBy(desc(documentAnalysis.createdAt))
      .limit(50);

    return results;
  }

  private async logEvent(
    organizationId: number,
    eventType: string,
    payload: Record<string, any>
  ): Promise<void> {
    try {
      await db.insert(agentEvents).values({
        organizationId,
        eventType,
        eventSource: "document_intelligence",
        payload,
      });
    } catch (error) {
      console.error(`[document-intelligence] Failed to log event:`, error);
    }
  }
}

export const documentIntelligenceService = new DocumentIntelligenceService();
