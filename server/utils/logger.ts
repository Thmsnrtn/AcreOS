import type { Request, Response, NextFunction } from "express";
import { captureException } from "./sentry";

export type LogLevel = "info" | "warn" | "error" | "debug";

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  source?: string;
  requestId?: string;
  userId?: string;
  organizationId?: number;
  /**
   * Alias for `organizationId`. Many callers use `orgId` as a shorthand;
   * accepting it here avoids forcing 50+ call sites to rename the key.
   * Both fields survive into the serialized log; downstream consumers
   * should prefer `organizationId` for canonical filtering.
   */
  orgId?: number;
  /**
   * Free-form structured tags. Routes/services pass arbitrary call-site
   * context (agent name, job key, ...) under the canonical fields and
   * also via top-level extras. The type is wide on purpose; downstream
   * serializers normalize before writing.
   */
  agent?: string;
  metadata?: Record<string, unknown>;
  /**
   * Error context. Accepted shapes:
   *   - { name, message, stack } — explicit Error-like context
   *   - string                   — coerced into { message: string }
   *   - Error                    — coerced via instanceof check
   * Logger functions normalize before serialization.
   */
  error?: { name: string; message: string; stack?: string } | string | Error;
  [key: string]: unknown;
}

interface RequestLogEntry extends LogEntry {
  method: string;
  path: string;
  statusCode?: number;
  duration?: number;
  userAgent?: string;
  ip?: string;
}

function formatTimestamp(): string {
  return new Date().toISOString();
}

// ─── Pillar D / D7 — PII redaction ─────────────────────────────────────────
//
// Every log line passes through `redactPII` before serialization. Patterns
// are deliberately conservative (precision > recall) so that legitimate
// debug output isn't mangled. To bypass for a specific call site, pass
// `metadata: { __pii_safe: true }` — the redactor honors the flag.
//
// Pillar D / D7. The same redactor is used by sentry.ts beforeSend.

const PII_PATTERNS: Array<[RegExp, string]> = [
  // SSN / TIN — 3-2-4 digit groups with optional dashes/spaces
  [/\b(?<!\d-)\d{3}[-\s]?\d{2}[-\s]?\d{4}(?!-\d)\b/g, "***-**-****"],
  // Visa / MC / Amex / Disc — 13-16 digit runs with reasonable structure
  [/\b(?:4\d{3}|5[1-5]\d{2}|3[47]\d{2}|6011)[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{1,4}\b/g, "****-****-****-****"],
  // Email — basic RFC-ish pattern
  [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, "[redacted-email]"],
  // E.164-ish + common US 10-digit phone
  [/\b\+?1?[-\s.]?\(?\d{3}\)?[-\s.]?\d{3}[-\s.]?\d{4}\b/g, "[redacted-phone]"],
];

export function redactPII(input: string): string {
  let out = input;
  for (const [pattern, replacement] of PII_PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

function redactValue(v: unknown): unknown {
  if (typeof v === "string") return redactPII(v);
  if (Array.isArray(v)) return v.map(redactValue);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      out[k] = redactValue(val);
    }
    return out;
  }
  return v;
}

function formatLogEntry(entry: LogEntry): string {
  const parts = [
    `[${entry.timestamp}]`,
    `[${entry.level.toUpperCase()}]`,
    entry.source ? `[${entry.source}]` : "",
    entry.requestId ? `[req:${entry.requestId}]` : "",
    entry.message,
  ].filter(Boolean);

  let logLine = parts.join(" ");

  if (entry.metadata && Object.keys(entry.metadata).length > 0) {
    logLine += ` :: ${JSON.stringify(entry.metadata)}`;
  }

  if (entry.error) {
    logLine += ` :: Error: ${entry.error.name}: ${entry.error.message}`;
  }

  return logLine;
}

// Task #155: In production, emit structured JSON for log aggregators (Datadog, Logtail, etc.)
// In development, use human-readable format for readability.
const IS_PRODUCTION = process.env.NODE_ENV === "production";

function serializeEntry(entry: LogEntry): string {
  if (IS_PRODUCTION) {
    // Structured JSON — one log line per entry for aggregator parsing
    return JSON.stringify(entry);
  }
  return formatLogEntry(entry);
}

function log(level: LogLevel, message: string, options: Partial<LogEntry> = {}): void {
  // Pillar D / D7 — strip PII unless explicitly waived. Callers can pass
  // `metadata: { __pii_safe: true }` for messages where the format guarantees
  // no PII leak (e.g. metric names + numeric values).
  const piiSafe = (options.metadata as Record<string, unknown> | undefined)?.__pii_safe === true;
  const safeMessage = piiSafe ? message : redactPII(message);
  const safeMetadata = piiSafe ? options.metadata : (redactValue(options.metadata) as Record<string, unknown> | undefined);

  const entry: LogEntry = {
    timestamp: formatTimestamp(),
    level,
    message: safeMessage,
    ...options,
    metadata: safeMetadata,
  };

  const line = serializeEntry(entry);

  switch (level) {
    case "error":
      console.error(line);
      if (!IS_PRODUCTION && options.error?.stack) {
        console.error(options.error.stack);
      }
      break;
    case "warn":
      console.warn(line);
      break;
    case "debug":
      if (!IS_PRODUCTION) {
        console.debug(line);
      }
      break;
    default:
      console.log(line);
  }
}

/**
 * Normalize whatever the caller passed as the second arg into a
 * Partial<LogEntry>. The legacy signature was `(message, options?)`
 * with `options` as a structured Partial<LogEntry>, but the actual call
 * sites pass a wide variety of shapes: Error, unknown (caught), strings.
 * Coerce them all here so info/warn/debug accept the same wide input as
 * error().
 */
function normalizeOptions(input?: unknown): Partial<LogEntry> | undefined {
  if (input == null) return undefined;
  if (input instanceof Error) {
    return { error: { name: input.name, message: input.message, stack: input.stack } };
  }
  if (typeof input === "string") return { error: input };
  if (typeof input === "object") return input as Partial<LogEntry>;
  return { error: String(input) };
}

export const logger = {
  info(message: string, options?: Partial<LogEntry> | Error | unknown): void {
    log("info", message, normalizeOptions(options));
  },

  warn(message: string, options?: Partial<LogEntry> | Error | unknown): void {
    log("warn", message, normalizeOptions(options));
  },

  error(message: string, error?: Error | unknown, options?: Partial<LogEntry>): void {
    const errorDetails = error instanceof Error
      ? {
          name: error.name,
          message: error.message,
          stack: error.stack,
        }
      : error
        ? { name: "UnknownError", message: String(error) }
        : undefined;

    log("error", message, { ...options, error: errorDetails });
  },

  debug(message: string, options?: Partial<LogEntry> | Error | unknown): void {
    log("debug", message, normalizeOptions(options));
  },

  request(req: Request, options?: Partial<RequestLogEntry>): void {
    const entry: RequestLogEntry = {
      timestamp: formatTimestamp(),
      level: "info",
      message: `${req.method} ${req.path}`,
      method: req.method,
      path: req.path,
      userAgent: req.get("user-agent"),
      ip: req.ip || req.socket.remoteAddress,
      source: "http",
      ...options,
    };

    if (req.user?.id) {
      entry.userId = req.user.id;
    }

    log("info", formatLogEntry(entry));
  },

  response(req: Request, res: Response, duration: number, options?: Partial<RequestLogEntry>): void {
    const level: LogLevel = res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info";
    
    const entry: RequestLogEntry = {
      timestamp: formatTimestamp(),
      level,
      message: `${req.method} ${req.path} ${res.statusCode} in ${duration}ms`,
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      duration,
      source: "http",
      ...options,
    };

    log(level, formatLogEntry(entry));
  },
};

let requestCounter = 0;

function generateRequestId(): string {
  requestCounter++;
  return `${Date.now()}-${requestCounter}`;
}

export function requestLoggingMiddleware(req: Request, res: Response, next: NextFunction): void {
  const startTime = Date.now();
  const requestId = generateRequestId();
  
  (req as Request & { requestId: string }).requestId = requestId;
  // Task #155: Propagate request ID to client for correlation with server logs
  res.setHeader("X-Request-Id", requestId);

  if (req.path.startsWith("/api")) {
    logger.debug(`Incoming request: ${req.method} ${req.path}`, {
      source: "http",
      requestId,
      metadata: {
        query: Object.keys(req.query).length > 0 ? req.query : undefined,
        contentType: req.get("content-type"),
      },
    });
  }

  res.on("finish", () => {
    const duration = Date.now() - startTime;
    
    if (req.path.startsWith("/api")) {
      logger.response(req, res, duration, { requestId });
    }
  });

  next();
}

export function errorLoggingMiddleware(err: Error, req: Request, res: Response, next: NextFunction): void {
  const requestId = (req as Request & { requestId?: string }).requestId;
  const status = (err as Error & { status?: number; statusCode?: number }).status ||
                 (err as Error & { status?: number; statusCode?: number }).statusCode || 500;

  logger.error(`Request error: ${req.method} ${req.path}`, err, {
    source: "http",
    requestId,
    metadata: { statusCode: status },
  });

  // Forward 5xx errors to Sentry; skip expected client errors
  if (status >= 500) {
    captureException(err, { requestId, method: req.method, path: req.path });
  }

  next(err);
}

export default logger;
