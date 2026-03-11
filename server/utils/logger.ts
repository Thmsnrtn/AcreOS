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
  metadata?: Record<string, unknown>;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
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
  const entry: LogEntry = {
    timestamp: formatTimestamp(),
    level,
    message,
    ...options,
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

export const logger = {
  info(message: string, options?: Partial<LogEntry>): void {
    log("info", message, options);
  },

  warn(message: string, options?: Partial<LogEntry>): void {
    log("warn", message, options);
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

  debug(message: string, options?: Partial<LogEntry>): void {
    log("debug", message, options);
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

    const user = req.user as { claims?: { sub?: string } } | undefined;
    if (user?.claims?.sub) {
      entry.userId = user.claims.sub;
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
