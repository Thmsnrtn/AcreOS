/**
 * Object documents (autonomy gap §8 slice 5) — the ONE place that knows the
 * document key layout, the parent-resolution rule and the refusal message.
 *
 * Every exported function takes `organizationId` first: it is the scoping key
 * for every read and write here, and it is what keeps these units clean under
 * scripts/check-org-scoped-fetch.mjs.
 *
 * BYTES FIRST, THEN THE ROW. `putOrgObject` runs before the insert, because the
 * forbidden state is a row for bytes we did not keep (DEFECT-0164). A failure
 * after the put leaves an orphan object under org/<orgId>/documents/ with no
 * row — the safe direction, and `deleteAllOrgObjects` sweeps the whole org
 * prefix on erasure regardless of rows.
 */
import { randomUUID } from "crypto";
import { and, desc, eq } from "drizzle-orm";
import { db } from "../db";
import {
  acquiredNotes,
  deals,
  properties,
  uploadedDocuments,
  type UploadedDocument,
} from "@shared/schema";
import { activityLogger } from "./activityLogger";
import { documentStoreConfigured, getOrgObject, putOrgObject } from "./documentStore";

export const DOCUMENT_STORAGE_UNAVAILABLE_MESSAGE =
  "Document storage isn't connected yet, so this file was not saved. " +
  "Keep the original — re-upload it once storage is connected.";

export const DOCUMENT_DOWNLOAD_UNAVAILABLE_MESSAGE =
  "Document storage isn't connected, so this file can't be downloaded right now.";

export type DocumentObjectKind = "deal" | "property" | "note";

export interface DocumentObjectKindDef {
  readonly kind: DocumentObjectKind;
  readonly segment: "deals" | "properties" | "notes";
  readonly column: "dealId" | "propertyId" | "acquiredNoteId";
  /** The word the 404 names, so the endpoint never confirms another org's id exists. */
  readonly entityLabel: "Deal" | "Property" | "Note";
  readonly idType: "int" | "uuid";
  /** activity_events can only carry an INTEGER entity id — null for notes (§7). */
  readonly timelineEntityType: "deal" | "property" | null;
}

/**
 * The ENUMERATED population. A fourth kind must appear here — the routes are
 * generated from this list and the test iterates it, so a kind that is added
 * without a case, or dropped from the loop, fails rather than passing quietly.
 */
export const DOCUMENT_OBJECT_KINDS: readonly DocumentObjectKindDef[] = [
  { kind: "deal", segment: "deals", column: "dealId", entityLabel: "Deal", idType: "int", timelineEntityType: "deal" },
  { kind: "property", segment: "properties", column: "propertyId", entityLabel: "Property", idType: "int", timelineEntityType: "property" },
  { kind: "note", segment: "notes", column: "acquiredNoteId", entityLabel: "Note", idType: "uuid", timelineEntityType: null },
] as const;

function documentObjectKindDef(kind: DocumentObjectKind): DocumentObjectKindDef {
  const def = DOCUMENT_OBJECT_KINDS.find((d) => d.kind === kind);
  if (!def) throw new Error(`unknown document object kind '${kind}'`);
  return def;
}

/** Exactly one of the three is non-null — the shape the DB CHECK also enforces. */
export interface DocumentParent {
  dealId: number | null;
  propertyId: number | null;
  acquiredNoteId: string | null;
}

/** True only when DOCUMENTS_S3_BUCKET + AWS credentials are present. */
export function documentStorageAvailable(): boolean {
  return documentStoreConfigured();
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The id-shape rule, in one place: the route 400s on it before touching the DB. */
export function documentObjectIdLooksValid(kind: DocumentObjectKind, rawObjectId: string): boolean {
  if (documentObjectKindDef(kind).idType === "uuid") return UUID_RE.test(rawObjectId);
  const n = Number(rawObjectId);
  return Number.isInteger(n) && n > 0;
}

/** The parent id as it is spelled in the storage key and the timeline event. */
export function documentParentId(parent: DocumentParent): number | string {
  if (parent.dealId !== null) return parent.dealId;
  if (parent.propertyId !== null) return parent.propertyId;
  if (parent.acquiredNoteId !== null) return parent.acquiredNoteId;
  throw new Error("document parent names no object");
}

/**
 * Does this object exist IN THIS ORG? Returns the normalised parent id, or null
 * (→ the route answers 404). The ONLY place an object id from a caller is
 * trusted; nothing downstream re-reads req.params.
 */
export async function resolveDocumentParent(
  organizationId: number,
  kind: DocumentObjectKind,
  rawObjectId: string,
): Promise<DocumentParent | null> {
  if (!documentObjectIdLooksValid(kind, rawObjectId)) return null;

  if (kind === "note") {
    const [row] = await db
      .select({ id: acquiredNotes.id })
      .from(acquiredNotes)
      .where(and(eq(acquiredNotes.id, rawObjectId), eq(acquiredNotes.organizationId, organizationId)))
      .limit(1);
    return row ? { dealId: null, propertyId: null, acquiredNoteId: row.id } : null;
  }

  const numericId = Number(rawObjectId);

  if (kind === "deal") {
    const [row] = await db
      .select({ id: deals.id })
      .from(deals)
      .where(and(eq(deals.id, numericId), eq(deals.organizationId, organizationId)))
      .limit(1);
    return row ? { dealId: row.id, propertyId: null, acquiredNoteId: null } : null;
  }

  const [row] = await db
    .select({ id: properties.id })
    .from(properties)
    .where(and(eq(properties.id, numericId), eq(properties.organizationId, organizationId)))
    .limit(1);
  return row ? { dealId: null, propertyId: row.id, acquiredNoteId: null } : null;
}

/**
 * org AND parent. Org alone would let a caller reach their own org's document
 * through someone else's object id — a smaller leak, the same bug.
 */
function scopedToParent(organizationId: number, parent: DocumentParent) {
  const parentEq =
    parent.dealId !== null
      ? eq(uploadedDocuments.dealId, parent.dealId)
      : parent.propertyId !== null
        ? eq(uploadedDocuments.propertyId, parent.propertyId)
        : eq(uploadedDocuments.acquiredNoteId, parent.acquiredNoteId as string);
  return and(eq(uploadedDocuments.organizationId, organizationId), parentEq);
}

/**
 * Bytes first, then the row (§3.5). THROWS if storage is unconfigured — the
 * route checks `documentStorageAvailable()` before calling, so nothing can
 * record a row for bytes that were dropped.
 */
export async function storeObjectDocument(input: {
  organizationId: number;
  kind: DocumentObjectKind;
  parent: DocumentParent;
  fileName: string;
  contentType: string;
  bytes: Buffer;
  category: string | null;
  uploadedBy: string;
}): Promise<UploadedDocument> {
  const { organizationId, kind, parent, fileName, contentType, bytes, category, uploadedBy } = input;
  const def = documentObjectKindDef(kind);
  const parentId = documentParentId(parent);

  // The route generates the document id itself, so the key is known before
  // anything is written — no placeholder row, no post-write UPDATE.
  const documentId = randomUUID();
  const key = `documents/${def.segment}/${parentId}/${documentId}.pdf`;

  // BYTES FIRST. putOrgObject prefixes org/<orgId>/ and returns the full
  // s3://<bucket>/org/<orgId>/documents/... reference — the stored ref is never
  // the bare key, which is what makes the read path's prefix check meaningful.
  const storageRef = await putOrgObject(organizationId, key, bytes, contentType);

  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(uploadedDocuments)
      .values({
        id: documentId,
        organizationId,
        dealId: parent.dealId,
        propertyId: parent.propertyId,
        acquiredNoteId: parent.acquiredNoteId,
        fileName,
        contentType,
        byteSize: bytes.length,
        storageRef,
        category,
        uploadedBy,
      })
      .returning();

    // Deals and properties get a real activity_events row. `document_uploaded`
    // has existed in shared/constants/activity.ts with an icon and a colour and
    // NO production writer; this is what makes it real.
    //
    // Notes get none, deliberately (§7): activity_events.entity_id is an integer
    // and an acquired note's id is a uuid. Widening it would touch every reader
    // of a hot CRM table for one new row type.
    //
    // documentUrl carries the API download PATH, never a signed S3 URL: a signed
    // URL expires in 300s and a timeline is permanent.
    if (def.timelineEntityType !== null && typeof parentId === "number") {
      await activityLogger.logDocumentUploaded(
        organizationId,
        def.timelineEntityType,
        parentId,
        row.fileName,
        `/api/${def.segment}/${parentId}/documents/${row.id}/download`,
        uploadedBy,
      );
    }

    return row;
  });
}

/** Newest first. Org-scoped AND parent-scoped. */
export async function listObjectDocuments(
  organizationId: number,
  kind: DocumentObjectKind,
  parent: DocumentParent,
): Promise<UploadedDocument[]> {
  documentObjectKindDef(kind); // reject an unknown kind before it reaches a query
  return db
    .select()
    .from(uploadedDocuments)
    .where(scopedToParent(organizationId, parent))
    .orderBy(desc(uploadedDocuments.createdAt));
}

/**
 * The row, only if it is this org's AND hangs off this parent. null → 404.
 */
export async function getObjectDocument(
  organizationId: number,
  kind: DocumentObjectKind,
  parent: DocumentParent,
  documentId: string,
): Promise<UploadedDocument | null> {
  documentObjectKindDef(kind);
  if (!UUID_RE.test(documentId)) return null;
  const [row] = await db
    .select()
    .from(uploadedDocuments)
    .where(and(scopedToParent(organizationId, parent), eq(uploadedDocuments.id, documentId)))
    .limit(1);
  return row ?? null;
}

/** Bytes for a row this org owns. documentStore re-checks the org prefix in the key. */
export async function readObjectDocumentBytes(
  organizationId: number,
  doc: UploadedDocument,
): Promise<Buffer> {
  return getOrgObject(organizationId, doc.storageRef);
}
