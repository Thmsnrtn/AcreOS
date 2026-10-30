/**
 * Read one Express route parameter as the string it is.
 *
 * `@types/express` 5 types every route parameter as `string | string[]`,
 * because Express 5 delivers a wildcard segment (`/files/*path`,
 * `{*splat}`) as an ARRAY of path segments. A named `:param` is always a
 * single string at runtime; the wider type exists for the wildcard case.
 *
 * Every handler that reads a route parameter as a string goes through this
 * helper. A string comes back unchanged. An array is REFUSED: the helper logs
 * it and throws `RouteParamArrayError`, which the handler's own error path
 * (or the terminal error handler, via `statusCode`) turns into an error
 * response. It never picks the first segment, joins the segments, or coerces
 * the value in any other way — a caller that legitimately reads a wildcard
 * must handle the array itself, explicitly.
 *
 * A key the route does not declare reads as `undefined` and passes through
 * unchanged, exactly as the raw `req.params.<k>` read did before.
 */
import { logger } from "./logger";

class RouteParamArrayError extends Error {
  readonly statusCode = 400;
  readonly segments: number;

  constructor(segments: number) {
    super(
      `A route parameter arrived as an array of ${segments} path segment(s). ` +
        "This handler reads a single named parameter; wildcard parameters must be handled explicitly.",
    );
    this.name = "RouteParamArrayError";
    this.segments = segments;
  }
}

export function routeParam(value: string | string[]): string {
  if (Array.isArray(value)) {
    const err = new RouteParamArrayError(value.length);
    logger.error("[routeParam] refused an array-valued route parameter", err);
    throw err;
  }
  return value;
}
