import type { Request, Response, NextFunction } from "express";

export function securityHeaders(req: Request, res: Response, next: NextFunction) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
  
  // CSP directives - Note: 'unsafe-inline'/'unsafe-eval' required for React/Vite apps
  // Consider nonce-based CSP in future for stricter policy
  const cspDirectives = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://js.stripe.com https://api.mapbox.com",
    "style-src 'self' 'unsafe-inline' https://api.mapbox.com https://fonts.googleapis.com",
    "img-src 'self' data: blob: https: http:",
    "font-src 'self' data: https://fonts.gstatic.com",
    "connect-src 'self' https://api.stripe.com https://api.mapbox.com https://events.mapbox.com wss: ws:",
    "frame-src 'self' https://js.stripe.com https://hooks.stripe.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'"
  ];
  
  // Only upgrade to HTTPS in production
  if (process.env.NODE_ENV === "production") {
    cspDirectives.push("upgrade-insecure-requests");
  }
  
  res.setHeader("Content-Security-Policy", cspDirectives.join("; "));
  
  if (process.env.NODE_ENV === "production") {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  
  next();
}

const ALLOWED_ORIGINS: (string | RegExp)[] = [
  "http://localhost:3000",
  "http://localhost:5000",
  "http://localhost:8080",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:5000",
  "http://127.0.0.1:8080",
];

// Add production domain from APP_URL env var
if (process.env.APP_URL) {
  try {
    const appOrigin = new URL(process.env.APP_URL).origin;
    ALLOWED_ORIGINS.push(appOrigin);
  } catch {
    // Invalid APP_URL, skip
  }
}

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
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With, X-CSRF-Token");
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
