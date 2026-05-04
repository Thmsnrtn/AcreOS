/**
 * icon-button-needs-aria-label
 *
 * WCAG 2.2 SC 4.1.2 (Name, Role, Value) requires every interactive control
 * to expose an accessible name. An icon-only `<Button>` with no visible text
 * fails this criterion unless it carries `aria-label` or `aria-labelledby`.
 *
 * This rule flags any `<Button …>` (or lowercase `<button …>`) whose only
 * children are JSX elements rendering Lucide / Heroicons / svg icons and
 * which has neither `aria-label` nor `aria-labelledby`. The fix is mechanical:
 * add `aria-label="…"` describing the action ("Close", "Edit", "Delete", etc.).
 *
 * Heuristics:
 *   • If the button has a visible text child (string, JSXText with non-blank
 *     content, or `{stringExpression}`), the rule passes — the text already
 *     names the control.
 *   • If the only child is a single PascalCase JSX element matching common
 *     icon naming (Pascal short-name with Capital first letter), the button
 *     is treated as icon-only.
 *   • `asChild` Buttons that delegate to a child `<a>`/`<Link>` carrying
 *     `aria-label` are also accepted, because Radix copies attrs to the
 *     rendered slot — but flagging false-positives there is rare enough that
 *     authors can add aria-label on the Button itself for clarity.
 *
 * Allowed contexts:
 *   - components/ui/**            (shadcn primitives; not user-authored)
 *   - **\/*.test.tsx              (test fixtures)
 *   - **\/*.stories.tsx           (storybook examples)
 *
 * Severity: error. Pairs with the codemod that bulk-applied 25+ aria-labels
 * during the WCAG 2.2 AA full pass; this rule prevents regressions.
 */

"use strict";

function isIconChild(node) {
  if (!node) return false;
  if (node.type !== "JSXElement" && node.type !== "JSXSelfClosingElement") return false;
  const opening = node.openingElement || node;
  if (!opening || !opening.name) return false;
  if (opening.name.type !== "JSXIdentifier") return false;
  const name = opening.name.name;
  // Heuristic: lucide/heroicons icon names are PascalCase, single-word or
  // multi-word, e.g. ChevronLeft, Plus, MoreHorizontal, Wand2, Sparkles.
  return /^[A-Z][A-Za-z0-9]*$/.test(name);
}

function hasVisibleText(children) {
  for (const c of children || []) {
    if (c.type === "JSXText") {
      if (c.value && c.value.trim().length > 0) return true;
    } else if (c.type === "Literal" && typeof c.value === "string") {
      if (c.value.trim().length > 0) return true;
    } else if (c.type === "JSXExpressionContainer") {
      const expr = c.expression;
      if (!expr) continue;
      // Conservative: any string literal / template inside an expression
      // counts as visible text. Identifiers / call expressions also count
      // because they likely render text.
      if (expr.type === "Literal" && typeof expr.value === "string" && expr.value.trim().length > 0) return true;
      if (expr.type === "TemplateLiteral") return true;
      if (expr.type === "Identifier") return true;
      if (expr.type === "MemberExpression") return true;
      if (expr.type === "CallExpression") return true;
      if (expr.type === "ConditionalExpression") return true;
      if (expr.type === "LogicalExpression") return true;
      if (expr.type === "BinaryExpression") return true;
    }
  }
  return false;
}

function hasIconOnlyChildren(children) {
  // Exactly one icon-shaped element, possibly surrounded by whitespace JSXText.
  let icons = 0;
  for (const c of children || []) {
    if (c.type === "JSXText") {
      if (c.value && c.value.trim().length > 0) return false;
    } else if (isIconChild(c)) {
      icons++;
    } else if (c.type === "JSXExpressionContainer") {
      // Probably a dynamic value — not icon-only
      return false;
    } else if (c.type === "JSXElement" || c.type === "JSXSelfClosingElement") {
      // non-icon JSX child — not icon-only
      return false;
    }
  }
  return icons >= 1;
}

function attrNames(opening) {
  const names = new Set();
  for (const a of opening.attributes || []) {
    if (a.type === "JSXAttribute" && a.name && a.name.name) {
      names.add(a.name.name);
    } else if (a.type === "JSXSpreadAttribute") {
      names.add("__spread__");
    }
  }
  return names;
}

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Icon-only <Button> / <button> elements must have aria-label or aria-labelledby (WCAG 2.2 SC 4.1.2).",
      recommended: true,
    },
    schema: [],
    messages: {
      missing:
        "Icon-only <{{ tag }}> is missing an accessible name. Add aria-label=\"…\" describing the action (e.g. \"Close\", \"Edit\").",
    },
  },
  create(context) {
    const filename = context.getFilename();
    if (
      /\/components\/ui\//.test(filename) ||
      /\.test\.tsx?$/.test(filename) ||
      /\.stories\.tsx?$/.test(filename)
    ) {
      return {};
    }

    return {
      JSXElement(node) {
        const opening = node.openingElement;
        if (!opening || !opening.name) return;
        if (opening.name.type !== "JSXIdentifier") return;
        const tag = opening.name.name;
        if (tag !== "Button" && tag !== "button" && tag !== "IconButton") return;

        const attrs = attrNames(opening);
        if (attrs.has("aria-label") || attrs.has("aria-labelledby")) return;
        // If author spreads props in, assume the spread carries the label.
        if (attrs.has("__spread__")) return;

        // asChild — Radix delegates props onto the child element. If that
        // child carries aria-label / aria-labelledby OR has visible text,
        // the rendered element is named correctly.
        if (attrs.has("asChild")) {
          for (const c of node.children || []) {
            if (c.type === "JSXElement" && c.openingElement) {
              const childAttrs = attrNames(c.openingElement);
              if (childAttrs.has("aria-label") || childAttrs.has("aria-labelledby")) return;
              if (hasVisibleText(c.children)) return;
            }
          }
        }

        if (hasVisibleText(node.children)) return;
        if (!hasIconOnlyChildren(node.children)) return;

        context.report({
          node: opening,
          messageId: "missing",
          data: { tag },
        });
      },
    };
  },
};
