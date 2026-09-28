/**
 * Can an uploaded image actually be KEPT? (DEFECT-0164)
 *
 * There is no blob store yet — choosing one is the founder's storage
 * decision recorded on DEFECT-0046. Until then, two upload routes accepted
 * photos, wrote a row pointing at a key or URL nothing serves, dropped the
 * bytes and answered success: rehab photos ("N photo(s) uploaded" — lender
 * draw and tax-basis evidence) and DriveMode field photos ("Saved to the
 * lead."). Both now ask this first and refuse before writing anything, so
 * the customer keeps the only copy on their device instead of trusting a
 * record with no file behind it.
 *
 * When a driver lands, this becomes the check that it is configured, and
 * each route writes the bytes BEFORE it reports success. The nearest
 * existing candidate is the StorageDriver in server/services/cmo/storage.ts
 * (local FS + R2, founder-only CMO assets today).
 */
export function photoStorageAvailable(): boolean {
  return false;
}

/**
 * Write a photo's bytes. THROWS until a driver exists — so flipping the
 * switch above without wiring storage fails loudly, inside the caller's
 * transaction, instead of recording a row for bytes that were dropped.
 */
export async function persistPhotoBytes(key: string, bytes: Buffer): Promise<void> {
  throw new Error(`No photo storage driver: refusing to record ${key} (${bytes.length} bytes) as stored`);
}

export const PHOTO_STORAGE_UNAVAILABLE_MESSAGE =
  "Photo storage isn't connected yet, so this photo was not saved. For a photo you need to keep, use your phone's camera app for now.";
