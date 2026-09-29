/**
 * Can an uploaded image actually be KEPT? (DEFECT-0164, founder ruling
 * 2026-09-29 #1)
 *
 * Two upload routes once accepted photos, wrote a row pointing at a key or URL
 * nothing served, dropped the bytes and answered success: rehab photos (lender
 * draw and tax-basis evidence) and DriveMode field photos. They were made to
 * refuse. The founder has since chosen AWS S3, and this is now the check that
 * the store is configured (`documentStoreConfigured`) plus the write that puts
 * the bytes in it BEFORE the row that points at them.
 *
 * Until DOCUMENTS_S3_BUCKET and AWS credentials are provisioned the answer is
 * still "no", and both routes still refuse with the message below.
 */
import { documentStoreConfigured, putOrgObject, type StoredObjectRef } from "./documentStore";

export function photoStorageAvailable(): boolean {
  return documentStoreConfigured();
}

/**
 * Write a photo's bytes into the org's namespace and return the reference to
 * record on the row. THROWS when storage isn't configured — inside the
 * caller's transaction — so nothing records a row for bytes that were dropped.
 */
export async function persistPhotoBytes(
  organizationId: number,
  key: string,
  bytes: Buffer,
  contentType?: string,
): Promise<StoredObjectRef> {
  return putOrgObject(organizationId, key, bytes, contentType);
}

export const PHOTO_STORAGE_UNAVAILABLE_MESSAGE =
  "Photo storage isn't connected yet, so this photo was not saved. For a photo you need to keep, use your phone's camera app for now.";
