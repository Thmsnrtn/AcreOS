/**
 * prefer-verbs-canon
 *
 * Encourages contributors to use the canonical action-verb constants
 * exported from `client/src/lib/labels.ts` instead of inline string
 * literals. This keeps button copy, menu items, and toast messages
 * aligned across the app and makes future tone/localization sweeps
 * mechanical rather than archaeological.
 *
 * What it flags
 *   <Button>Save</Button>          -> use {Verbs.SAVE}
 *   <Button>Cancel</Button>        -> use {Verbs.CANCEL}
 *   <button>Delete</button>        -> use {Verbs.DELETE}
 *   <DropdownMenuItem>Archive</…>  -> use {Verbs.ARCHIVE}
 *
 * What it does NOT flag
 *   - Strings that aren't direct children of a button-ish JSX element.
 *   - The `lib/labels.ts` file itself.
 *   - Verbs not in the canon (so contributors aren't blocked from
 *     writing one-off labels).
 *   - JSXExpressionContainer children (e.g. {label}) — already dynamic.
 *
 * The rule is informational; reviewers are still the source of truth.
 * Set the rule to "warn" to surface drift without blocking commits.
 */

"use strict";

// Mirror of the values exported by client/src/lib/labels.ts. Keep in
// sync if new generic verbs are added to the canon. We intentionally
// only list the *generic* verbs here — object-specific verbs like
// "Add lead" tend to be wrapped in icons + helper text and are better
// caught at code review time.
const CANONICAL_GENERIC_VERBS = new Set([
  "Save",
  "Cancel",
  "Confirm",
  "Delete",
  "Edit",
  "Create",
  "Submit",
  "Enable",
  "Disable",
  "Retry",
  "Export",
  "Import",
  "Copy",
  "Share",
  "Archive",
  "Restore",
]);

const BUTTON_LIKE = new Set([
  "Button",
  "button",
  "DropdownMenuItem",
  "MenuItem",
  "CommandItem",
  "ContextMenuItem",
]);

function isButtonLike(node) {
  if (!node) return false;
  if (node.type !== "JSXElement") return false;
  const opening = node.openingElement;
  if (!opening || !opening.name) return false;
  if (opening.name.type === "JSXIdentifier") {
    return BUTTON_LIKE.has(opening.name.name);
  }
  return false;
}

module.exports = {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Prefer Verbs.* constants from @/lib/labels for canonical action verbs.",
    },
    schema: [],
    messages: {
      preferVerb:
        'Use the canonical Verbs.{{key}} constant from "@/lib/labels" instead of the inline literal "{{verb}}".',
    },
  },

  create(context) {
    const filename = context.getFilename();
    if (filename.includes("lib/labels.ts")) return {};

    return {
      JSXText(node) {
        const text = node.value.trim();
        if (!CANONICAL_GENERIC_VERBS.has(text)) return;
        if (!isButtonLike(node.parent)) return;
        context.report({
          node,
          messageId: "preferVerb",
          data: {
            verb: text,
            key: text.toUpperCase(),
          },
        });
      },
    };
  },
};
