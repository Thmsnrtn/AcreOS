/**
 * T17 — File Upload Security Middleware
 *
 * Provides server-side validation for all file uploads:
 *   - MIME type validation from file content (not just extension)
 *   - File size limits
 *   - SSRF protection for URL-fetched content
 *   - Filename sanitization
 *
 * Usage with multer:
 *   import multer from "multer";
 *   import { createUploadMiddleware, validateFileMiddleware } from "../middleware/fileUploadSecurity";
 *
 *   const upload = createUploadMiddleware({ maxSizeMB: 10, allowedTypes: ["image", "pdf"] });
 *   router.post("/upload", upload.single("file"), validateFileMiddleware, handler);
 *
 * SSRF protection:
 *   await validateUrl(urlFromUser);  // throws if URL is internal/private
 */

import type { Request, Response, NextFunction } from "express";
import multer from "multer";
import path from "path";
import crypto from "crypto";
import { Errors } from "../utils/errors";

// ─── MIME type signatures (magic bytes) ──────────────────────────────────────

const MAGIC_BYTES: Array<{ bytes: number[]; mime: string; category: string }> = [
  { bytes: [0xff, 0xd8, 0xff], mime: "image/jpeg", category: "image" },
  { bytes: [0x89, 0x50, 0x4e, 0x47], mime: "image/png", category: "image" },
  { bytes: [0x47, 0x49, 0x46], mime: "image/gif", category: "image" },
  { bytes: [0x52, 0x49, 0x46, 0x46], mime: "image/webp", category: "image" },
  { bytes: [0x25, 0x50, 0x44, 0x46], mime: "application/pdf", category: "pdf" },
  { bytes: [0x50, 0x4b, 0x03, 0x04], mime: "application/zip", category: "zip" }, // Also docx/xlsx
  { bytes: [0xd0, 0xcf, 0x11, 0xe0], mime: "application/msword", category: "document" }, // doc
  { bytes: [0x42, 0x4d], mime: "image/bmp", category: "image" },
];

function detectMimeFromBuffer(buffer: Buffer): { mime: string; category: string } | null {
  for (const sig of MAGIC_BYTES) {
    if (sig.bytes.every((b, i) => buffer[i] === b)) {
      return { mime: sig.mime, category: sig.category };
    }
  }
  // Check if it's likely text (CSV, TXT)
  const firstBytes = buffer.slice(0, 512).toString("utf8");
  if (/^[\x09\x0a\x0d\x20-\x7e]*$/.test(firstBytes)) {
    return { mime: "text/plain", category: "text" };
  }
  return null;
}

// ─── Allowed categories by use case ──────────────────────────────────────────

export type AllowedCategory =
  | "image"
  | "pdf"
  | "document"
  | "text"
  | "zip"
  | "any";

const DEFAULT_MAX_SIZE_MB = 10;

// ─── Multer configuration ─────────────────────────────────────────────────────

interface UploadOptions {
  maxSizeMB?: number;
  allowedTypes?: AllowedCategory[];
}

export function createUploadMiddleware(options: UploadOptions = {}) {
  const maxSize = (options.maxSizeMB ?? DEFAULT_MAX_SIZE_MB) * 1024 * 1024;

  return multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: maxSize,
      files: 5, // max 5 files per request
    },
    fileFilter: (_req, file, cb) => {
      // Sanitize filename
      file.originalname = path
        .basename(file.originalname)
        .replace(/[^a-zA-Z0-9._-]/g, "_");

      // Block known dangerous extensions regardless of MIME type claimed by client.
      // Macro-enabled Office formats (.docm, .xlsm, .pptm, .ppam, .docb, .xlam,
      // .xltm, .potm, .ppsm) embed VBA — when a victim opens a downloaded copy
      // and "Enables Content," macros run with full local user privilege.
      // These are functionally executables wearing a document MIME, so they
      // get the same treatment as .exe / .sh. (Lens 23 finding — the original
      // blocklist covered scripts + binaries but missed the Office macro line.)
      const dangerousExtensions = [
        ".exe", ".sh", ".bat", ".cmd", ".ps1", ".php", ".py",
        ".rb", ".pl", ".js", ".ts", ".jar", ".com", ".vbs",
        // Macro-enabled Microsoft Office formats — all run VBA on "Enable Content"
        ".docm", ".xlsm", ".pptm", ".ppam", ".docb", ".xlam",
        ".xltm", ".potm", ".ppsm",
        // Windows scripting hosts + shortcuts that can spawn arbitrary commands
        ".lnk", ".scr", ".hta", ".cpl", ".msi", ".msp", ".reg",
        ".wsf", ".wsh",
      ];
      const ext = path.extname(file.originalname).toLowerCase();
      if (dangerousExtensions.includes(ext)) {
        return cb(new Error(`Disallowed file type: ${ext}`));
      }
      cb(null, true);
    },
  });
}

/**
 * Post-upload middleware that validates the actual file content
 * against the allowed categories using magic byte detection.
 */
export function validateFileMiddleware(
  allowedCategories: AllowedCategory[] = ["image", "pdf", "document", "text"]
) {
  return (req: Request, res: Response, next: NextFunction) => {
    const files: Express.Multer.File[] = [];

    if (req.file) files.push(req.file);
    if (req.files) {
      const f = req.files;
      if (Array.isArray(f)) files.push(...f);
      else Object.values(f).forEach((arr: any) => files.push(...arr));
    }

    for (const file of files) {
      if (!file.buffer || file.buffer.length === 0) {
        return Errors.badRequest(res, "Empty file rejected");
      }

      const detected = detectMimeFromBuffer(file.buffer);

      if (!detected) {
        return Errors.badRequest(res, `Unable to determine file type for: ${file.originalname}`);
      }

      const allowed =
        allowedCategories.includes("any") ||
        allowedCategories.includes(detected.category as AllowedCategory);

      if (!allowed) {
        return Errors.badRequest(res, `File type not allowed: ${detected.mime}. Allowed: ${allowedCategories.join(", ")}`);
      }

      // Attach validated MIME to file object
      (file as any).detectedMime = detected.mime;
      (file as any).detectedCategory = detected.category;

      // T19: Strip EXIF and other metadata from image uploads
      if (detected.category === "image") {
        file.buffer = stripImageMetadata(file.buffer, detected.mime);
      }
    }

    next();
  };
}

// ─── EXIF / metadata stripping ───────────────────────────────────────────────

/**
 * Strip EXIF and other metadata segments from a JPEG buffer.
 *
 * JPEG files are a sequence of markers: 0xFF <marker-byte> [0x00 | length...].
 * We preserve SOI (0xD8), EOI (0xD9), and all markers except APP1–APP15
 * (0xE1–0xEF) which carry EXIF, XMP, ICC profiles, and other metadata.
 * APP0 (0xE0 = JFIF) is intentionally retained — it is required for valid
 * JFIF and carries no personally-identifying information.
 *
 * Returns the original buffer unchanged if it is not a valid JPEG.
 */
function stripJpegExif(input: Buffer): Buffer {
  // Verify JPEG SOI marker
  if (input.length < 4 || input[0] !== 0xff || input[1] !== 0xd8) {
    return input;
  }

  const chunks: Buffer[] = [];
  let offset = 0;

  // Write the SOI marker
  chunks.push(input.slice(0, 2));
  offset = 2;

  while (offset < input.length - 1) {
    if (input[offset] !== 0xff) {
      // Not a marker — stop parsing, copy remainder as-is
      chunks.push(input.slice(offset));
      break;
    }

    // Skip padding 0xFF bytes
    while (offset < input.length && input[offset] === 0xff) {
      offset++;
    }

    if (offset >= input.length) break;

    const marker = input[offset];
    offset++;

    // Standalone markers (no length field): SOI=0xD8, EOI=0xD9, RST0-RST7=0xD0-0xD7, TEM=0x01
    if (
      marker === 0xd8 || // SOI (already written)
      marker === 0xd9 || // EOI
      (marker >= 0xd0 && marker <= 0xd7) || // RST0-7
      marker === 0x01    // TEM
    ) {
      chunks.push(Buffer.from([0xff, marker]));
      if (marker === 0xd9) break; // End of image
      continue;
    }

    // Markers with a 2-byte length field (length includes the 2 length bytes)
    if (offset + 1 >= input.length) break;
    const length = (input[offset] << 8) | input[offset + 1];
    if (length < 2 || offset + length > input.length) break;

    const segmentEnd = offset + length;

    // APP1–APP15 (0xE1–0xEF): skip — these carry EXIF, XMP, ICC, etc.
    // APP0 (0xE0) is kept because JFIF headers live there.
    const isMetadataApp = marker >= 0xe1 && marker <= 0xef;

    if (!isMetadataApp) {
      // Write marker + segment (including length bytes)
      chunks.push(Buffer.from([0xff, marker]));
      chunks.push(input.slice(offset, segmentEnd));
    }

    offset = segmentEnd;

    // SOS (0xDA) = start of scan — entropy-coded data follows, no more markers to parse
    if (marker === 0xda) {
      chunks.push(input.slice(offset));
      break;
    }
  }

  return Buffer.concat(chunks);
}

/**
 * Strip metadata from an image buffer based on its detected MIME type.
 * Currently handles JPEG (strips EXIF/XMP/ICC APP segments).
 * PNG, GIF, WebP are returned unchanged — they do not embed EXIF by default
 * and stripping requires format-specific parsing beyond scope here.
 */
export function stripImageMetadata(buffer: Buffer, mime: string): Buffer {
  if (mime === "image/jpeg") {
    return stripJpegExif(buffer);
  }
  return buffer;
}

// ─── SSRF Protection ──────────────────────────────────────────────────────────
//
// F1 (Felix audit): All outbound user-supplied URL fetches must run through
// validateUrl() before contacting the network. This blocks:
//   - non-http/https schemes (file://, gopher://, javascript:, data:)
//   - private IPv4 ranges (10/8, 172.16/12, 192.168/16, 127/8, 169.254/16, 0/8)
//   - IPv6 link-local (fe80::/10), loopback (::1), ULA (fc00::/7)
//   - localhost / 0.0.0.0 hostnames
//   - cloud metadata endpoints (169.254.169.254, metadata.google.internal,
//     metadata.azure.com, fd00:ec2::254)
//   - DNS rebinding (the resolved IP is also checked, not just the hostname)

const PRIVATE_HOSTNAME_PATTERNS = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^::1$/,
  /^fc00:/i,
  /^fd[0-9a-f]{2}:/i,
  /^fe80:/i,                       // IPv6 link-local
  /^169\.254\./,                   // Link-local / AWS IMDS
  /^0\./,                          // "this network"
  /^0\.0\.0\.0$/,
  /^localhost$/i,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, // CGNAT 100.64.0.0/10
  /^metadata\.google\.internal$/i,            // GCP metadata
  /^metadata\.azure\.com$/i,                  // Azure metadata
];

const BLOCKED_EXACT_IPS = new Set([
  "169.254.169.254",      // AWS / OpenStack / DO IMDS
  "fd00:ec2::254",        // AWS IMDSv6
  "100.100.100.200",      // Alibaba Cloud metadata
]);

export class SSRFBlockedError extends Error {
  public readonly code = "SSRF_BLOCKED";
  public readonly statusCode = 422;
  constructor(message: string) {
    super(message);
    this.name = "SSRFBlockedError";
  }
}

function isPrivateIPv4(ip: string): boolean {
  if (BLOCKED_EXACT_IPS.has(ip)) return true;
  return PRIVATE_HOSTNAME_PATTERNS.some((re) => re.test(ip));
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (BLOCKED_EXACT_IPS.has(lower)) return true;
  if (lower === "::1" || lower === "::") return true;
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // ULA fc00::/7
  if (lower.startsWith("fe80") || lower.startsWith("fe9") ||
      lower.startsWith("fea") || lower.startsWith("feb")) return true; // link-local fe80::/10
  // IPv4-mapped IPv6 (::ffff:a.b.c.d)
  const mapped = lower.match(/^::ffff:([0-9.]+)$/);
  if (mapped) return isPrivateIPv4(mapped[1]);
  return false;
}

/**
 * Validate that a user-provided URL is safe to fetch.
 * Throws SSRFBlockedError if the URL targets a private/internal address,
 * uses a non-http(s) scheme, or resolves (via DNS) to a private IP.
 *
 * The DNS lookup defends against DNS-rebinding attacks where a public
 * hostname resolves to a private address at request time.
 */
export async function validateUrl(url: string): Promise<URL> {
  if (typeof url !== "string" || url.trim().length === 0) {
    throw new SSRFBlockedError("URL is required");
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new SSRFBlockedError("Invalid URL");
  }

  // Only allow HTTP/HTTPS — explicitly reject file://, javascript:, data:, gopher:, etc.
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new SSRFBlockedError(
      `Disallowed URL scheme: ${parsed.protocol} (only http/https permitted)`
    );
  }

  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");

  // Block private/loopback hostnames + cloud metadata endpoints
  for (const range of PRIVATE_HOSTNAME_PATTERNS) {
    if (range.test(host)) {
      throw new SSRFBlockedError("URL points to a private or internal address");
    }
  }
  if (BLOCKED_EXACT_IPS.has(host)) {
    throw new SSRFBlockedError("URL points to a cloud metadata endpoint");
  }

  // DNS resolution check — defends against DNS rebinding by validating the
  // actual address(es) the hostname resolves to right now. Skipped if the
  // hostname is already a literal IP (those were checked above).
  const isLiteralIPv4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
  const isLiteralIPv6 = host.includes(":");
  if (!isLiteralIPv4 && !isLiteralIPv6) {
    try {
      const dns = await import("node:dns/promises");
      const records = await dns.lookup(host, { all: true, verbatim: true });
      for (const r of records) {
        if (r.family === 4 && isPrivateIPv4(r.address)) {
          throw new SSRFBlockedError(
            `Hostname ${host} resolves to private IP ${r.address}`
          );
        }
        if (r.family === 6 && isPrivateIPv6(r.address)) {
          throw new SSRFBlockedError(
            `Hostname ${host} resolves to private IPv6 ${r.address}`
          );
        }
      }
    } catch (err) {
      if (err instanceof SSRFBlockedError) throw err;
      // DNS lookup itself failed (NXDOMAIN, etc). Let the caller's fetch surface
      // the network error rather than masking it as an SSRF block.
    }
  }

  return parsed;
}
