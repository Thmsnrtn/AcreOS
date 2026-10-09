/**
 * scripts/lib/next-guard.mjs — does an earlier handler that calls next() let
 * THIS later request through?
 *
 * check-route-shadowing.mjs treated any handler containing `next(` as falling
 * through for every request. A handler can call next() only for some values of
 * its own path parameter:
 *
 *   app.get("/api/health/:service", …, (req, res, next) => {
 *     if (req.params.service === "deep" || req.params.service === "replica") return next();
 *     …answers every other value itself
 *
 * That passes /api/health/deep and /replica on, and ANSWERS
 * /api/health/worker-heartbeat — which the gate scored as reachable.
 *
 * Rule: when EVERY `next(` in the handler sits on a line guarded by `if (` that
 * reads `req.params`, the string literals on those guard lines are the values
 * that fall through. The later request falls through only if one of its path
 * segments is one of them; otherwise the earlier handler answers it. Any other
 * next() shape keeps the old, conservative verdict (falls through).
 */
export function nextVerdict(handlerText, laterPath) {
  const calls = [...handlerText.matchAll(/\bnext\s*\(/g)];
  if (calls.length === 0) return "NO_NEXT";
  const literals = new Set();
  for (const m of calls) {
    const lineStart = handlerText.lastIndexOf("\n", m.index) + 1;
    const lineEnd = handlerText.indexOf("\n", m.index);
    const line = handlerText.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
    const before = handlerText.slice(lineStart, m.index);
    if (!/\bif\s*\(/.test(before) || !/\breq\.params\b/.test(before)) return "FALLS_THROUGH";
    for (const lit of line.matchAll(/["'`]([^"'`]+)["'`]/g)) literals.add(lit[1]);
  }
  if (literals.size === 0) return "FALLS_THROUGH";
  const segments = laterPath.split("/");
  return segments.some((s) => literals.has(s)) ? "FALLS_THROUGH" : "TERMINATES";
}
