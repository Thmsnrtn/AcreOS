import type { RequestHandler } from "express";
import { ZodSchema, ZodError } from "zod";
import { Errors } from "../utils/errors";

/**
 * Express middleware factory that validates req.body against a Zod schema.
 * On success, replaces req.body with the parsed (typed) data.
 * On failure, returns a 422 response with field-level error details.
 */
export function validateBody<T extends ZodSchema>(schema: T): RequestHandler {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return Errors.validationFailed(res, result.error.flatten());
    }
    req.body = result.data;
    next();
  };
}
