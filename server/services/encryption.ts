/**
 * @deprecated SINCE 2026-05-03 — DELETE ON OR AFTER 2026-06-02.
 *
 * This module is the legacy "credentials" encryption path. It has been
 * superseded by the canonical implementation at
 * `server/services/fieldEncryption.ts`, which:
 *
 *   • Emits a self-describing envelope (`enc:v1:<base64>`).
 *   • Decrypts BOTH the new envelope AND the legacy 3-/4-segment shapes
 *     produced by this module, so already-encrypted rows continue to work.
 *
 * All exports here now delegate to the canonical module. New ciphertexts
 * written through this module use the new envelope format. Reads tolerate
 * any legacy shape transparently. The natural-drain plan: leave this in
 * place for ~30 days while traffic re-encrypts on touch, then delete.
 *
 * Migration path:
 *   - Replace:  import { ... } from "./services/encryption";
 *   - With:     import { ... } from "./services/fieldEncryption";
 *
 * TODO(2026-06-02): Delete this file and its dynamic-import call-sites in
 *                   routes-ai.ts, routes-integrations.ts, comps.ts,
 *                   directMail.ts, directMailService.ts, emailService.ts,
 *                   providers/regrid-provider.ts, connectors/executor.ts.
 */

import { logger } from "../utils/logger";

// One-time import-time deprecation warning. Wrapped in NODE_ENV check so
// production doesn't spam logs during the deprecation window.
if (process.env.NODE_ENV !== "test") {
  // W7 console hygiene: the structured logger carries this warning; the
  // duplicate raw console.warn is gone.
  logger.warn?.(
    "[encryption.ts] DEPRECATED (removal on/after 2026-06-02) — migrate imports to server/services/fieldEncryption"
  );
}

export {
  encryptCredentials,
  decryptCredentials,
  encryptJsonCredentials,
  decryptJsonCredentials,
  maskApiKey,
} from "./fieldEncryption";
