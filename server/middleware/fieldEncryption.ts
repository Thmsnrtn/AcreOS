/**
 * Re-export of the canonical field-encryption module.
 *
 * The implementation lives at `server/services/fieldEncryption.ts` after the
 * encryption-consolidation refactor (Aravind audit §3.1). This file remains
 * so existing imports such as
 *
 *     import { rotateEncryption } from "../middleware/fieldEncryption";
 *
 * keep working. New code should import from `../services/fieldEncryption`
 * directly.
 *
 * @deprecated Prefer `server/services/fieldEncryption` for new code. This
 *             middleware-path re-export will be removed alongside the legacy
 *             services/encryption.ts module on or after 2026-06-02.
 */

export {
  encrypt,
  decrypt,
  isEncrypted,
  isAnyEncryptedEnvelope,
  encryptFields,
  decryptFields,
  encryptLandRecord,
  decryptLandRecord,
  encryptContactRecord,
  decryptContactRecord,
  encryptCredentials,
  decryptCredentials,
  encryptJsonCredentials,
  decryptJsonCredentials,
  maskApiKey,
  encryptionMiddleware,
  rotateEncryption,
  LAND_SENSITIVE_FIELDS,
  CONTACT_SENSITIVE_FIELDS,
} from "../services/fieldEncryption";
