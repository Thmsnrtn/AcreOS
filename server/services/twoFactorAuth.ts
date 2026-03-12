/**
 * T11 — Two-Factor Authentication (TOTP) Service
 *
 * Implements RFC 6238 TOTP (Time-based One-Time Password) compatible with
 * Google Authenticator, Authy, 1Password, and similar apps.
 *
 * Flow:
 *   1. User goes to Settings → Security → Enable 2FA
 *   2. POST /api/auth/2fa/setup → returns { qrCode, secret }
 *   3. User scans QR code with authenticator app
 *   4. POST /api/auth/2fa/verify-setup { code } → activates 2FA
 *   5. On subsequent logins with 2FA enabled:
 *      POST /api/auth/login succeeds → session.pendingTwoFactor = true
 *      POST /api/auth/2fa/verify { code } → completes login
 *   6. POST /api/auth/2fa/disable { code } → disables 2FA (requires valid TOTP)
 *
 * Backup codes: 8 single-use backup codes generated at setup. Stored as
 * bcrypt hashes in DB. Each code consumed on use.
 *
 * Storage requirements (add these columns to the users table via migration):
 *   twoFactorSecret     TEXT (encrypted TOTP secret)
 *   twoFactorEnabled    BOOLEAN DEFAULT false
 *   twoFactorBackupCodes TEXT[] (hashed backup codes)
 */

import crypto from "crypto";

// TOTP parameters
const TOTP_ALGORITHM = "SHA1";
const TOTP_DIGITS = 6;
const TOTP_PERIOD = 30; // seconds
const TOTP_WINDOW = 1;  // accept 1 period before/after current

// ─── Core TOTP implementation (no external dependencies) ─────────────────────

function base32Decode(input: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = input.toUpperCase().replace(/=+$/, "");
  let bits = 0;
  let value = 0;
  const output: number[] = [];
  for (const char of clean) {
    const idx = alphabet.indexOf(char);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      output.push((value >> bits) & 0xff);
    }
  }
  return Buffer.from(output);
}

function base32Encode(buf: Buffer): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      output += alphabet[(value >> bits) & 31];
    }
  }
  if (bits > 0) {
    output += alphabet[(value << (5 - bits)) & 31];
  }
  const padding = (8 - (output.length % 8)) % 8;
  return output + "=".repeat(padding);
}

function generateTOTP(secret: string, timestamp: number): string {
  const keyBytes = base32Decode(secret);
  const counter = Math.floor(timestamp / TOTP_PERIOD);
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigInt64BE(BigInt(counter));
  const hmac = crypto.createHmac(TOTP_ALGORITHM, keyBytes).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(code % Math.pow(10, TOTP_DIGITS)).padStart(TOTP_DIGITS, "0");
}

// ─── Public API ──────────────────────────────────────────────────────────────

export interface TwoFactorSetup {
  secret: string;     // base32 encoded TOTP secret
  otpauthUrl: string; // for QR code generation
  backupCodes: string[]; // 8 plaintext backup codes (shown once)
}

export const twoFactorAuth = {
  /**
   * Generate a new TOTP secret and backup codes for a user.
   * Returns the setup data to be shown to the user (QR + backup codes).
   * MUST store secret in DB after user verifies a valid code.
   */
  generateSetup(userEmail: string, appName = "AcreOS"): TwoFactorSetup {
    const secretBytes = crypto.randomBytes(20);
    const secret = base32Encode(secretBytes);
    const issuer = encodeURIComponent(appName);
    const label = encodeURIComponent(`${appName}:${userEmail}`);
    const otpauthUrl = `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}&algorithm=${TOTP_ALGORITHM}&digits=${TOTP_DIGITS}&period=${TOTP_PERIOD}`;

    const backupCodes = Array.from({ length: 8 }, () =>
      crypto.randomBytes(5).toString("hex").toUpperCase()
    );

    return { secret, otpauthUrl, backupCodes };
  },

  /**
   * Verify a 6-digit TOTP code against a secret.
   * Accepts codes within a ±1 period window to account for clock skew.
   */
  verifyCode(secret: string, code: string): boolean {
    const now = Math.floor(Date.now() / 1000);
    const normalizedCode = code.replace(/\s/g, "");
    for (let i = -TOTP_WINDOW; i <= TOTP_WINDOW; i++) {
      const expected = generateTOTP(secret, now + i * TOTP_PERIOD);
      if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(normalizedCode.padStart(6, "0")))) {
        return true;
      }
    }
    return false;
  },

  /**
   * Hash a backup code for storage (bcrypt-equivalent using SHA-256 + salt).
   * Returns the hash string to store in DB.
   */
  async hashBackupCode(code: string): Promise<string> {
    const bcrypt = await import("bcrypt");
    return bcrypt.hash(code.toUpperCase(), 10);
  },

  /**
   * Verify a backup code against stored hashes.
   * Returns the index of the matched hash (to remove it from DB), or -1 if invalid.
   */
  async verifyBackupCode(code: string, hashes: string[]): Promise<number> {
    const bcrypt = await import("bcrypt");
    const normalized = code.toUpperCase();
    for (let i = 0; i < hashes.length; i++) {
      const match = await bcrypt.compare(normalized, hashes[i]);
      if (match) return i;
    }
    return -1;
  },

  /**
   * Generate a QR code data URL (SVG) for display in the UI.
   * Uses the otpauth URL directly — client renders with a QR library or
   * we return the raw URL and let the client use a QR component.
   */
  getQrUrl(otpauthUrl: string): string {
    // Use Google Charts API as a zero-dependency QR generator
    const encoded = encodeURIComponent(otpauthUrl);
    return `https://chart.googleapis.com/chart?chs=200x200&chld=M|0&cht=qr&chl=${encoded}`;
  },
};
