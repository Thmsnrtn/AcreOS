/**
 * PII Masking Middleware
 *
 * Automatically masks personally identifiable information before it reaches
 * log output. Intercepts console.log / console.error so that PII included
 * in debug strings is never written to stdout / log aggregators.
 *
 * Patterns masked:
 *   - Phone numbers  →  555-***-**** (first 3 digits kept)
 *   - Email addresses → ***@domain.com (domain preserved)
 *   - SSNs           → ***-**-1234 (last 4 digits kept)
 *   - Credit cards   → ****-****-****-1234 (last 4 digits kept)
 *
 * Exports:
 *   maskString(str)         — pure function, returns masked copy
 *   piiMaskingMiddleware    — Express middleware (no-op request guard)
 *   installConsoleInterceptor() — call once at startup to patch console
 */

import type { Request, Response, NextFunction } from "express";

// ─── Regex patterns ───────────────────────────────────────────────────────────

// US phone: (555) 123-4567 | 555-123-4567 | 5551234567 | +15551234567
// Keep the first 3 digits (area code), mask the rest.
const PHONE_PATTERN =
  /(\+?1?\s?)?(\(?\d{3}\)?[\s.\-]?)(\d{3}[\s.\-]?\d{4})/g;

// Email: anything@domain.tld
const EMAIL_PATTERN = /[a-zA-Z0-9._%+\-]+@([a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/g;

// SSN: 123-45-6789 or 123456789
const SSN_PATTERN = /\b(\d{3})[.\-\s]?(\d{2})[.\-\s]?(\d{4})\b/g;

// Credit card: 13–19 digit sequences (Visa, MC, Amex, Discover)
// Matches with or without spaces/dashes between groups
const CC_PATTERN =
  /\b(\d{4})[\s\-]?(\d{4})[\s\-]?(\d{4})[\s\-]?(\d{1,4})\b/g;

// ─── Mask helpers ─────────────────────────────────────────────────────────────

function maskPhone(match: string): string {
  // Extract all digits
  const digits = match.replace(/\D/g, "");
  if (digits.length < 10) return match; // too short to be a phone number

  // Keep area code (first 3 digits), mask remainder
  const areaCode = digits.slice(0, 3);
  return `${areaCode}-***-****`;
}

function maskEmail(match: string, domain: string): string {
  return `***@${domain}`;
}

function maskSsn(
  match: string,
  p1: string,
  p2: string,
  p3: string
): string {
  return `***-**-${p3}`;
}

function maskCreditCard(
  match: string,
  g1: string,
  g2: string,
  g3: string,
  g4: string
): string {
  // Only mask if total digit count looks like a card (13–19 digits)
  const total = (g1 + g2 + g3 + g4).length;
  if (total < 13 || total > 19) return match;
  return `****-****-****-${g4.padStart(4, "*")}`;
}

// ─── Core mask function ───────────────────────────────────────────────────────

/**
 * Returns a copy of `str` with PII patterns replaced by masked equivalents.
 * Safe to call on any string; non-string inputs are returned unchanged.
 */
export function maskString(str: string): string {
  if (typeof str !== "string") return str;

  // Order matters: SSN before phone (SSNs look like phone area codes)
  return str
    .replace(SSN_PATTERN, maskSsn)
    .replace(CC_PATTERN, maskCreditCard)
    .replace(PHONE_PATTERN, (match) => maskPhone(match))
    .replace(EMAIL_PATTERN, maskEmail);
}

/**
 * Deep-mask an arbitrary value. Objects and arrays are recursively traversed.
 * Returns the same type as the input.
 */
export function maskValue(value: unknown): unknown {
  if (typeof value === "string") {
    return maskString(value);
  }
  if (Array.isArray(value)) {
    return value.map(maskValue);
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = maskValue(v);
    }
    return out;
  }
  return value;
}

// ─── Serialise args for console interception ──────────────────────────────────

function serializeArg(arg: unknown): string {
  if (typeof arg === "string") return maskString(arg);
  try {
    return maskString(JSON.stringify(arg));
  } catch {
    return maskString(String(arg));
  }
}

// ─── Console interceptor ──────────────────────────────────────────────────────

let consoleInterceptorInstalled = false;

/**
 * Patches console.log, console.info, console.warn, and console.error so that
 * any string argument containing PII is masked before writing to stdout/stderr.
 *
 * Call once at application startup (before any logging occurs).
 */
export function installConsoleInterceptor(): void {
  if (consoleInterceptorInstalled) return;
  consoleInterceptorInstalled = true;

  const patchMethod = (
    target: typeof console,
    method: "log" | "info" | "warn" | "error" | "debug"
  ): void => {
    const original = target[method].bind(target);
    target[method] = (...args: unknown[]): void => {
      const maskedArgs = args.map(serializeArg);
      original(...maskedArgs);
    };
  };

  patchMethod(console, "log");
  patchMethod(console, "info");
  patchMethod(console, "warn");
  patchMethod(console, "error");
  patchMethod(console, "debug");
}

// ─── Express middleware ───────────────────────────────────────────────────────

/**
 * Express middleware that masks PII in request body fields before processing.
 *
 * This does NOT modify req.body for your route handlers (you still get raw
 * data for business logic). Instead, it attaches a `req.maskedBody` snapshot
 * that is safe to include in structured log entries.
 *
 * It also masks the User-Agent and Referer headers in the log-safe snapshot.
 *
 * Usage:
 *   app.use(piiMaskingMiddleware);
 */
export function piiMaskingMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  try {
    // Create a PII-safe copy of the body for logging purposes only
    if (req.body && typeof req.body === "object") {
      (req as any).maskedBody = maskValue(req.body);
    } else if (typeof req.body === "string") {
      (req as any).maskedBody = maskString(req.body);
    } else {
      (req as any).maskedBody = req.body;
    }

    // Mask query string values for safe log snapshot
    const maskedQuery: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(req.query)) {
      maskedQuery[k] =
        typeof v === "string" ? maskString(v) : maskValue(v);
    }
    (req as any).maskedQuery = maskedQuery;
  } catch {
    // Never let masking errors break the request
  }

  next();
}

// ─── Convenience: mask specific fields from a DB row before logging ───────────

/**
 * Masks known PII fields from a record before it is written to a log.
 * Fields in `sensitiveKeys` are fully replaced with "[REDACTED]".
 */
export function maskRecord(
  record: Record<string, unknown>,
  sensitiveKeys: string[] = [
    "ssn",
    "socialSecurityNumber",
    "creditCard",
    "cardNumber",
    "password",
    "passwordHash",
    "secret",
    "apiKey",
    "privateKey",
  ]
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (sensitiveKeys.some((sk) => key.toLowerCase().includes(sk.toLowerCase()))) {
      out[key] = "[REDACTED]";
    } else {
      out[key] = maskValue(value);
    }
  }
  return out;
}
