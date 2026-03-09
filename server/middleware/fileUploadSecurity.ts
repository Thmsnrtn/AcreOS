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

      // Block known dangerous extensions regardless of MIME type claimed by client
      const dangerousExtensions = [
        ".exe", ".sh", ".bat", ".cmd", ".ps1", ".php", ".py",
        ".rb", ".pl", ".js", ".ts", ".jar", ".com", ".vbs",
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

    if ((req as any).file) files.push((req as any).file);
    if ((req as any).files) {
      const f = (req as any).files;
      if (Array.isArray(f)) files.push(...f);
      else Object.values(f).forEach((arr: any) => files.push(...arr));
    }

    for (const file of files) {
      if (!file.buffer || file.buffer.length === 0) {
        return res.status(400).json({ message: "Empty file rejected" });
      }

      const detected = detectMimeFromBuffer(file.buffer);

      if (!detected) {
        return res
          .status(400)
          .json({ message: `Unable to determine file type for: ${file.originalname}` });
      }

      const allowed =
        allowedCategories.includes("any") ||
        allowedCategories.includes(detected.category as AllowedCategory);

      if (!allowed) {
        return res.status(400).json({
          message: `File type not allowed: ${detected.mime}. Allowed: ${allowedCategories.join(", ")}`,
        });
      }

      // Attach validated MIME to file object
      (file as any).detectedMime = detected.mime;
      (file as any).detectedCategory = detected.category;
    }

    next();
  };
}

// ─── SSRF Protection ──────────────────────────────────────────────────────────

const PRIVATE_RANGES = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^::1$/,
  /^fc00:/i,
  /^fd[0-9a-f]{2}:/i,
  /^169\.254\./,  // Link-local
  /^0\./,         // This network
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,  // CGNAT
  /^metadata\.google\.internal/i,  // GCP metadata
  /^169\.254\.169\.254/,           // AWS metadata
];

/**
 * Validate that a user-provided URL is safe to fetch.
 * Throws an error if the URL is private/internal.
 */
export async function validateUrl(url: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Invalid URL");
  }

  // Only allow HTTP/HTTPS
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Only HTTP/HTTPS URLs are allowed");
  }

  const host = parsed.hostname;

  // Block private IP ranges
  for (const range of PRIVATE_RANGES) {
    if (range.test(host)) {
      throw new Error("URL points to a private/internal address");
    }
  }

  return parsed;
}
