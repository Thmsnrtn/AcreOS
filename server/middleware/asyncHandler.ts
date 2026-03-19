import type { Request, Response, NextFunction, RequestHandler } from "express";

/**
 * Wraps an async Express route handler so that any unhandled rejection is
 * forwarded to the Express error-handling middleware via next(err) instead of
 * crashing the process or returning a hung response.
 *
 * Usage:
 *   app.get("/api/thing", asyncHandler(async (req, res) => { ... }));
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
