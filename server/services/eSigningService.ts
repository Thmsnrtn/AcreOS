/**
 * E-Signing Service — Dropbox Sign (formerly HelloSign) Integration
 *
 * Enables sending documents for e-signature directly from AcreOS:
 * - Promissory notes, purchase agreements, deeds, land contracts
 * - Multi-party signing (buyer + seller)
 * - Real-time status webhooks
 * - Signed document auto-saved to deal/note record
 * - No external DocuSign subscription needed ($0 additional cost)
 */

import { db } from "../db";
import { generatedDocuments, notes, leads, properties, organizations } from "@shared/schema";
import { eq, and } from "drizzle-orm";

const DROPBOX_SIGN_API_BASE = "https://api.hellosign.com/v3";

function getApiKey(): string {
  const key = process.env.DROPBOX_SIGN_API_KEY || process.env.HELLOSIGN_API_KEY;
  if (!key) throw new Error("DROPBOX_SIGN_API_KEY not configured");
  return key;
}

function buildAuthHeader(): string {
  return "Basic " + Buffer.from(getApiKey() + ":").toString("base64");
}

// ============================================
// TYPES
// ============================================

export interface SignatureRequestSigner {
  name: string;
  email: string;
  role: "buyer" | "seller" | "witness" | "notary" | "lender";
  order?: number; // Signing order (1 = first)
}

export interface SendForSignatureInput {
  documentId: number;
  organizationId: number;
  title: string;
  subject?: string;
  message?: string;
  signers: SignatureRequestSigner[];
  pdfBuffer?: Buffer; // If provided, use this PDF directly
  testMode?: boolean; // Use Dropbox Sign test mode (no actual signing)
  expiresAt?: Date;
}

export interface SignatureRequestResult {
  success: boolean;
  signatureRequestId: string;
  signingUrls: { email: string; signUrl: string }[];
  expiresAt: string;
  error?: string;
}

export interface SignatureRequestStatus {
  signatureRequestId: string;
  status: "pending" | "partially_signed" | "completed" | "declined" | "expired";
  signers: {
    email: string;
    name: string;
    status: "awaiting_signature" | "signed" | "declined";
    signedAt?: string;
  }[];
  completedAt?: string;
  signedDocumentUrl?: string;
}

// ============================================
// SEND FOR SIGNATURE
// ============================================

export async function sendDocumentForSignature(
  input: SendForSignatureInput
): Promise<SignatureRequestResult> {
  // Load the document record
  const [doc] = await db
    .select()
    .from(generatedDocuments)
    .where(eq(generatedDocuments.id, input.documentId));

  if (!doc) throw new Error("Document not found");

  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, input.organizationId));

  // Build multipart form data for Dropbox Sign API
  const formData = new FormData();
  formData.append("test_mode", input.testMode ? "1" : "0");
  formData.append("title", input.title);
  formData.append("subject", input.subject || `Please sign: ${input.title}`);
  formData.append(
    "message",
    input.message ||
      `${org?.name || "AcreOS"} has sent you a document to review and sign. Please click the link to view and sign the document.`
  );

  // Add signers
  input.signers.forEach((signer, i) => {
    formData.append(`signers[${i}][name]`, signer.name);
    formData.append(`signers[${i}][email_address]`, signer.email);
    if (signer.order !== undefined) {
      formData.append(`signers[${i}][order]`, String(signer.order));
    }
  });

  // Attach PDF
  if (input.pdfBuffer) {
    const blob = new Blob([input.pdfBuffer], { type: "application/pdf" });
    formData.append("file[0]", blob, `${input.title.replace(/\s+/g, "_")}.pdf`);
  } else if (doc.pdfUrl) {
    formData.append("file_url[0]", doc.pdfUrl);
  } else if (doc.content) {
    // Convert text content to a simple text file
    const blob = new Blob([doc.content], { type: "text/plain" });
    formData.append("file[0]", blob, `${input.title.replace(/\s+/g, "_")}.txt`);
  }

  if (input.expiresAt) {
    const unixTs = Math.floor(input.expiresAt.getTime() / 1000);
    formData.append("expires_at", String(unixTs));
  }

  // Call Dropbox Sign API
  let apiResult: any;
  try {
    const response = await fetch(`${DROPBOX_SIGN_API_BASE}/signature_request/send`, {
      method: "POST",
      headers: { Authorization: buildAuthHeader() },
      body: formData,
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      throw new Error(`Dropbox Sign API error ${response.status}: ${JSON.stringify(errorBody)}`);
    }

    apiResult = await response.json();
  } catch (err: any) {
    // If no API key configured, return a test mode result
    if (err.message?.includes("DROPBOX_SIGN_API_KEY not configured")) {
      return buildTestModeResult(input);
    }
    throw err;
  }

  const sigRequest = apiResult.signature_request;

  // Build signing URLs from signatures array
  const signingUrls = (sigRequest.signatures || []).map((sig: any) => ({
    email: sig.signer_email_address,
    signUrl: sig.sign_url || "",
  }));

  // Update document record with e-sign info
  await db
    .update(generatedDocuments)
    .set({
      esignProvider: "dropbox_sign",
      esignEnvelopeId: sigRequest.signature_request_id,
      esignStatus: "sent",
      status: "pending_signature",
      sentAt: new Date(),
      expiresAt: input.expiresAt,
      signers: input.signers.map((s, i) => ({
        id: sigRequest.signatures?.[i]?.signature_id || `sig_${i}`,
        name: s.name,
        email: s.email,
        role: s.role,
        order: s.order,
      })),
    })
    .where(eq(generatedDocuments.id, input.documentId));

  return {
    success: true,
    signatureRequestId: sigRequest.signature_request_id,
    signingUrls,
    expiresAt: sigRequest.expires_at || "",
  };
}

// ============================================
// GET SIGNING STATUS
// ============================================

export async function getSignatureRequestStatus(
  signatureRequestId: string
): Promise<SignatureRequestStatus> {
  let apiResult: any;
  try {
    const response = await fetch(
      `${DROPBOX_SIGN_API_BASE}/signature_request/${signatureRequestId}`,
      { headers: { Authorization: buildAuthHeader() } }
    );

    if (!response.ok) throw new Error(`API error ${response.status}`);
    apiResult = await response.json();
  } catch (err: any) {
    if (err.message?.includes("API_KEY")) {
      return { signatureRequestId, status: "pending", signers: [] };
    }
    throw err;
  }

  const req = apiResult.signature_request;
  const allSigned = req.signatures?.every((s: any) => s.status_code === "signed");
  const anySigned = req.signatures?.some((s: any) => s.status_code === "signed");
  const anyDeclined = req.signatures?.some((s: any) => s.status_code === "declined");

  let status: SignatureRequestStatus["status"] = "pending";
  if (req.is_complete) status = "completed";
  else if (anyDeclined) status = "declined";
  else if (anySigned) status = "partially_signed";

  return {
    signatureRequestId,
    status,
    signers: (req.signatures || []).map((s: any) => ({
      email: s.signer_email_address,
      name: s.signer_name,
      status:
        s.status_code === "signed"
          ? "signed"
          : s.status_code === "declined"
          ? "declined"
          : "awaiting_signature",
      signedAt: s.signed_at
        ? new Date(s.signed_at * 1000).toISOString()
        : undefined,
    })),
    completedAt: req.is_complete ? new Date().toISOString() : undefined,
    signedDocumentUrl: req.files_url || undefined,
  };
}

// ============================================
// WEBHOOK PROCESSOR — call from POST /api/webhooks/dropbox-sign
// ============================================

export async function processDropboxSignWebhook(payload: any): Promise<void> {
  const event = payload.event;
  const sigRequest = payload.signature_request;

  if (!sigRequest?.signature_request_id) return;

  // Find the document by envelope ID
  const [doc] = await db
    .select()
    .from(generatedDocuments)
    .where(eq(generatedDocuments.esignEnvelopeId, sigRequest.signature_request_id));

  if (!doc) return;

  const eventType = event?.event_type;

  if (eventType === "signature_request_signed") {
    // Check if all signers have signed
    const allSigned = sigRequest.signatures?.every((s: any) => s.status_code === "signed");
    await db
      .update(generatedDocuments)
      .set({
        esignStatus: allSigned ? "completed" : "partially_signed",
        status: allSigned ? "signed" : "pending_signature",
        signedAt: allSigned ? new Date() : undefined,
        completedAt: allSigned ? new Date() : undefined,
      })
      .where(eq(generatedDocuments.id, doc.id));
  } else if (eventType === "signature_request_all_signed" || eventType === "signature_request_completed") {
    await db
      .update(generatedDocuments)
      .set({
        esignStatus: "completed",
        status: "signed",
        signedAt: new Date(),
        completedAt: new Date(),
      })
      .where(eq(generatedDocuments.id, doc.id));
  } else if (eventType === "signature_request_declined") {
    await db
      .update(generatedDocuments)
      .set({ esignStatus: "declined", status: "archived" })
      .where(eq(generatedDocuments.id, doc.id));
  } else if (eventType === "signature_request_expired") {
    await db
      .update(generatedDocuments)
      .set({ esignStatus: "expired", status: "archived" })
      .where(eq(generatedDocuments.id, doc.id));
  }
}

// ============================================
// CANCEL SIGNATURE REQUEST
// ============================================

export async function cancelSignatureRequest(signatureRequestId: string): Promise<void> {
  try {
    await fetch(`${DROPBOX_SIGN_API_BASE}/signature_request/cancel/${signatureRequestId}`, {
      method: "POST",
      headers: { Authorization: buildAuthHeader() },
    });
  } catch {
    // Silently ignore if API key not configured
  }
}

// ============================================
// RESEND REMINDER
// ============================================

export async function resendSignatureReminder(
  signatureRequestId: string,
  signerEmail: string
): Promise<void> {
  const formData = new FormData();
  formData.append("email_address", signerEmail);

  try {
    await fetch(
      `${DROPBOX_SIGN_API_BASE}/signature_request/remind/${signatureRequestId}`,
      {
        method: "POST",
        headers: { Authorization: buildAuthHeader() },
        body: formData,
      }
    );
  } catch {
    // Silently ignore if API key not configured
  }
}

// ============================================
// TEST MODE HELPER
// ============================================

function buildTestModeResult(input: SendForSignatureInput): SignatureRequestResult {
  const fakeId = `test_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  return {
    success: true,
    signatureRequestId: fakeId,
    signingUrls: input.signers.map((s) => ({
      email: s.email,
      signUrl: `https://app.hellosign.com/sign/test_${fakeId}`,
    })),
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  };
}

// ============================================
// QUICK-SEND HELPERS (for common document types)
// ============================================

export async function sendPromissoryNoteForSignature(
  orgId: number,
  noteId: number,
  documentId: number,
  pdfBuffer: Buffer,
  testMode = false
): Promise<SignatureRequestResult> {
  // Load note, borrower info
  const [note] = await db
    .select({ note: notes, lead: leads, property: properties })
    .from(notes)
    .leftJoin(leads, eq(notes.borrowerId, leads.id))
    .leftJoin(properties, eq(notes.propertyId, properties.id))
    .where(and(eq(notes.id, noteId), eq(notes.organizationId, orgId)));

  if (!note) throw new Error("Note not found");

  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, orgId));

  const borrowerName = note.lead
    ? `${note.lead.firstName || ""} ${note.lead.lastName || ""}`.trim()
    : "Borrower";
  const borrowerEmail = note.lead?.email;
  const orgName = org?.name || "Land Investor";

  if (!borrowerEmail) throw new Error("Borrower email required for e-signing");

  const signers: SignatureRequestSigner[] = [
    { name: borrowerName, email: borrowerEmail, role: "buyer", order: 1 },
  ];

  return sendDocumentForSignature({
    documentId,
    organizationId: orgId,
    title: `Promissory Note — ${note.property?.address || "Land Property"}`,
    subject: "Please sign your Promissory Note",
    message: `${orgName} has prepared your promissory note for your land purchase. Please review and sign at your earliest convenience.`,
    signers,
    pdfBuffer,
    testMode,
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  });
}
