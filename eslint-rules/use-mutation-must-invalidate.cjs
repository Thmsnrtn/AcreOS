/**
 * use-mutation-must-invalidate
 *
 * Every `useMutation({ ... })` callsite should, in one of its success
 * callbacks (`onSuccess`, `onSettled`, `onMutate`), invalidate or
 * otherwise touch the query cache via `queryClient.invalidateQueries`,
 * `setQueryData`, `removeQueries`, or `cancelQueries`. Mutations that
 * skip this step leave stale UI behind — the 2026-05-12 bug
 * "deleted 17 sample leads still showed on dashboard" was a direct
 * result of `useDeleteLead` failing to invalidate the dashboard's
 * KPI/intelligence/today-priorities queries.
 *
 * What this rule flags:
 *   - Any `useMutation(...)` (called bare or as `*.useMutation(...)`)
 *     whose options object has at least one of `onSuccess` /
 *     `onSettled` / `onMutate`, but where none of those callbacks
 *     contain a call to `invalidateQueries`, `setQueryData`,
 *     `removeQueries`, `cancelQueries`, or the local
 *     `invalidateRelated` helper from `lib/query-keys`.
 *   - Any `useMutation(...)` that has NO success-side callback at all.
 *
 * Opt-out:
 *   Place a comment `// allow-no-invalidation: <reason>` on the line
 *   immediately above the `useMutation` call.
 *
 * Severity recommendation: warn. The check is heuristic — some
 * mutations are intentionally fire-and-forget (logging, telemetry).
 * The opt-out comment exists for those cases.
 */

"use strict";

const INVALIDATING_CALLS = new Set([
  "invalidateQueries",
  "setQueryData",
  "removeQueries",
  "cancelQueries",
  "resetQueries",
  "refetchQueries",
  "invalidateRelated",
]);

const SUCCESS_CALLBACK_KEYS = new Set(["onSuccess", "onSettled", "onMutate"]);

function isUseMutationCallee(callee) {
  if (!callee) return false;
  if (callee.type === "Identifier" && callee.name === "useMutation") return true;
  if (
    callee.type === "MemberExpression" &&
    callee.property &&
    callee.property.type === "Identifier" &&
    callee.property.name === "useMutation"
  ) {
    return true;
  }
  return false;
}

function findCallbackProperty(objExpr, key) {
  if (!objExpr || objExpr.type !== "ObjectExpression") return null;
  for (const prop of objExpr.properties) {
    if (prop.type !== "Property") continue;
    const name =
      prop.key.type === "Identifier"
        ? prop.key.name
        : prop.key.type === "Literal"
          ? prop.key.value
          : null;
    if (name === key) return prop;
  }
  return null;
}

function callbackContainsInvalidation(callbackNode) {
  if (!callbackNode) return false;
  // Support both arrow expressions and function declarations passed inline.
  const body = callbackNode.body;
  if (!body) return false;

  let found = false;

  function visit(node) {
    if (found || !node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
      return;
    }
    if (node.type === "CallExpression") {
      const callee = node.callee;
      let name = null;
      if (callee.type === "Identifier") name = callee.name;
      else if (
        callee.type === "MemberExpression" &&
        callee.property &&
        callee.property.type === "Identifier"
      ) {
        name = callee.property.name;
      }
      if (name && INVALIDATING_CALLS.has(name)) {
        found = true;
        return;
      }
    }
    for (const key of Object.keys(node)) {
      if (key === "parent" || key === "loc" || key === "range" || key === "type")
        continue;
      const v = node[key];
      if (v && typeof v === "object") visit(v);
    }
  }

  visit(body);
  return found;
}

function hasOptOutComment(node, context) {
  const sourceCode = context.getSourceCode();
  // Check the CallExpression AND its enclosing statement. The documented
  // placement ("line immediately above the useMutation call") puts the
  // comment before `return useMutation({…})` / `const m = useMutation({…})`,
  // where ESLint attaches it to the ReturnStatement / VariableDeclaration —
  // getCommentsBefore(call) alone never saw it there.
  let stmt = node;
  while (stmt.parent && !/Statement$|Declaration$/.test(stmt.type)) {
    stmt = stmt.parent;
  }
  const comments = [
    ...sourceCode.getCommentsBefore(node),
    ...(stmt !== node ? sourceCode.getCommentsBefore(stmt) : []),
  ];
  for (const c of comments) {
    if (/allow-no-invalidation\s*:/.test(c.value)) return true;
  }
  return false;
}

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "useMutation must invalidate, set, or otherwise touch the query cache in one of its success callbacks.",
      recommended: true,
    },
    schema: [],
    messages: {
      missingCallback:
        "useMutation has no onSuccess/onSettled/onMutate — mutated data is likely to leave stale UI. Add a callback that calls invalidateRelated(...) or queryClient.invalidateQueries(...), or annotate with `// allow-no-invalidation: <reason>`.",
      missingInvalidation:
        "useMutation has a success callback but never calls invalidateQueries / setQueryData / removeQueries / cancelQueries / invalidateRelated. Stale UI is likely. Annotate with `// allow-no-invalidation: <reason>` if intentional.",
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        if (!isUseMutationCallee(node.callee)) return;
        if (hasOptOutComment(node, context)) return;

        // Options object is typically the first argument (TanStack v4/v5).
        const optionsArg = node.arguments[0];
        if (!optionsArg || optionsArg.type !== "ObjectExpression") {
          // Either a bare `useMutation()` with no options (unusable) or
          // options come from a variable — out of scope for static check.
          return;
        }

        let foundAny = false;
        let foundInvalidation = false;
        for (const key of SUCCESS_CALLBACK_KEYS) {
          const prop = findCallbackProperty(optionsArg, key);
          if (!prop) continue;
          foundAny = true;
          if (callbackContainsInvalidation(prop.value)) {
            foundInvalidation = true;
            break;
          }
        }

        if (!foundAny) {
          context.report({ node, messageId: "missingCallback" });
          return;
        }
        if (!foundInvalidation) {
          context.report({ node, messageId: "missingInvalidation" });
        }
      },
    };
  },
};
