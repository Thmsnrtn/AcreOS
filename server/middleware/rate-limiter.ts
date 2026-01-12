import { Request, Response, NextFunction } from "express";

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();

// Clean up expired entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore.entries()) {
    if (entry.resetTime < now) {
      rateLimitStore.delete(key);
    }
  }
}, 60000); // Clean every minute

interface RateLimitOptions {
  windowMs?: number;  // Time window in milliseconds
  max?: number;       // Max requests per window
  keyGenerator?: (req: Request) => string;
  skipFailedRequests?: boolean;
}

export function rateLimit(options: RateLimitOptions = {}) {
  const {
    windowMs = 60000,  // 1 minute default
    max = 100,         // 100 requests per minute default
    keyGenerator = (req) => req.ip || 'unknown',
  } = options;

  return (req: Request, res: Response, next: NextFunction) => {
    const key = keyGenerator(req);
    const now = Date.now();
    
    let entry = rateLimitStore.get(key);
    
    if (!entry || entry.resetTime < now) {
      entry = { count: 0, resetTime: now + windowMs };
      rateLimitStore.set(key, entry);
    }
    
    entry.count++;
    
    // Set rate limit headers
    res.setHeader('X-RateLimit-Limit', max);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, max - entry.count));
    res.setHeader('X-RateLimit-Reset', Math.ceil(entry.resetTime / 1000));
    
    if (entry.count > max) {
      return res.status(429).json({
        error: 'Too many requests',
        message: 'Please slow down and try again in a moment.',
        retryAfter: Math.ceil((entry.resetTime - now) / 1000)
      });
    }
    
    next();
  };
}

// Stricter limit for sensitive endpoints (AI endpoints - expensive operations)
export const strictRateLimit = rateLimit({ windowMs: 60000, max: 10 });

// Standard API limit
export const apiRateLimit = rateLimit({ windowMs: 60000, max: 100 });

// Very strict for auth endpoints
export const authRateLimit = rateLimit({ windowMs: 300000, max: 5 }); // 5 per 5 minutes
