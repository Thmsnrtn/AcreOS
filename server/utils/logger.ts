import type { Request, Response, NextFunction } from "express";

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

function log(level: LogLevel, message: string, options: Partial<LogEntry> = {}): void {
  const entry: LogEntry = {
    timestamp: formatTimestamp(),
    level,
    message,
    ...options,
  };

  const formattedLine = formatLogEntry(entry);

  switch (level) {
    case "error":
      console.error(formattedLine);
      if (options.error?.stack) {
        console.error(options.error.stack);
      }
      break;
    case "warn":
      console.warn(formattedLine);
      break;
    case "debug":
      if (process.env.NODE_ENV !== "production") {
        console.debug(formattedLine);
      }
      break;
    default:
      console.log(formattedLine);
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
  
  logger.error(`Request error: ${req.method} ${req.path}`, err, {
    source: "http",
    requestId,
    metadata: {
      statusCode: (err as Error & { status?: number; statusCode?: number }).status || 
                  (err as Error & { status?: number; statusCode?: number }).statusCode || 500,
    },
  });

  next(err);
}

export default logger;
