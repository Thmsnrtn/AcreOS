import type { Request, Response, NextFunction } from "express";

export function securityHeaders(req: Request, res: Response, next: NextFunction) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
  
  if (process.env.NODE_ENV === "production") {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  
  next();
}

const ALLOWED_ORIGINS = [
  /^https:\/\/.*\.replit\.dev$/,
  /^https:\/\/.*\.replit\.app$/,
  /^https:\/\/.*\.repl\.co$/,
  "http://localhost:5000",
  "http://127.0.0.1:5000",
];

export function corsMiddleware(req: Request, res: Response, next: NextFunction) {
  const origin = req.headers.origin;
  
  if (origin) {
    const isAllowed = ALLOWED_ORIGINS.some((allowed) => {
      if (typeof allowed === "string") {
        return allowed === origin;
      }
      return allowed.test(origin);
    });
    
    if (isAllowed) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Credentials", "true");
    }
  }
  
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");
  res.setHeader("Access-Control-Max-Age", "86400");
  
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }
  
  next();
}

const REQUEST_TIMEOUT_MS = 30000;

export function requestTimeout(req: Request, res: Response, next: NextFunction) {
  const timeout = setTimeout(() => {
    if (!res.headersSent) {
      res.status(408).json({ message: "Request timeout" });
    }
  }, REQUEST_TIMEOUT_MS);
  
  res.on("finish", () => clearTimeout(timeout));
  res.on("close", () => clearTimeout(timeout));
  
  next();
}

export function validateContentType(req: Request, res: Response, next: NextFunction) {
  if (["POST", "PUT", "PATCH"].includes(req.method)) {
    const contentType = req.headers["content-type"];
    
    if (req.path.includes("/webhook")) {
      return next();
    }
    
    if (contentType && !contentType.includes("application/json") && 
        !contentType.includes("application/x-www-form-urlencoded") &&
        !contentType.includes("multipart/form-data")) {
      return res.status(415).json({ message: "Unsupported Media Type" });
    }
  }
  
  next();
}

export function sanitizeQueryParams(req: Request, res: Response, next: NextFunction) {
  for (const key of Object.keys(req.query)) {
    const value = req.query[key];
    if (typeof value === "string") {
      if (value.includes("<script") || value.includes("javascript:")) {
        return res.status(400).json({ message: "Invalid query parameter" });
      }
    }
  }
  next();
}
