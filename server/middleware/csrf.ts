import type { Request, Response, NextFunction } from "express";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Double-submit cookie CSRF protection.
 *
 * For mutating requests (POST, PUT, PATCH, DELETE) the middleware verifies
 * that the `x-csrf-token` request header matches the `csrf_token` cookie and
 * that neither value is empty.  Webhooks and other paths that opt out of CSRF
 * protection should be mounted before this middleware.
 */
export function csrfProtection(req: Request, res: Response, next: NextFunction): void {
  if (SAFE_METHODS.has(req.method)) {
    next();
    return;
  }

  const cookieToken: string = (req as any).cookies?.csrf_token ?? "";
  const headerToken: string = (req.headers["x-csrf-token"] as string) ?? "";

  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    res.status(403).json({ message: "CSRF token validation failed" });
    return;
  }

  next();
}
