/**
 * Finds clickable JSX controls whose visible content is only an icon — at
 * every width, or at SOME width (a label behind `hidden md:inline` with no
 * complementary short label) — and reports whether each carries an accessible
 * name.
 *
 * It walks a TypeScript parse, not the text, so a comment that mentions
 * `aria-label` can neither name a control nor hide one, and an `onClick={() =>
 * …}` arrow cannot end an opening tag early.
 *
 * Where it cannot decide, it errs toward "renders text" (a variable, a call, an
 * unknown self-closing component), which can only UNDER-report icon-only
 * controls, never invent one. Icon-only controls whose name could be arriving
 * through a `{...spread}` are reported separately as `opaque`, so a caller can
 * bound how many controls it could not read instead of silently passing them.
 */
import ts from "typescript";

export type ControlShape =
  | "size-icon" // <Button size="icon">…
  | "icon-children" // a control whose children are only icons
  | "conditional-icon" // {busy ? <Loader2/> : <Download/>}
  | "responsive-label" // its text is hidden at some breakpoint, with nothing in its place
  | "as-child" // <Button asChild><Link …><X/></Link></Button>
  | "trigger" // <DropdownMenuTrigger><MoreHorizontal/></DropdownMenuTrigger>
  | "link"; // <Link href…><Settings/></Link>

export interface Control {
  line: number;
  tag: string;
  shapes: ControlShape[];
  named: boolean;
  /** The literal aria-label, when it is one. */
  label?: string;
  /**
   * The label is a mechanical fill, not a name:
   *   - it is the name of a NON-icon component inside the control
   *     (`aria-label="Tooltip"` on a button wrapping <Tooltip>) — never right;
   *   - or it is the glyph's own name while the control's `title` says what it
   *     actually does (`aria-label="Clock"` + `title="Reset to current time"`).
   * A label that merely matches its icon is NOT junk on its own — "Home" on a
   * <Home/> link is the right name — so that case is left to review.
   */
  junkLabel: boolean;
}

export interface ScanResult {
  /** Every control-shaped element visited, icon-only or not. */
  visited: number;
  /** The icon-only ones (at some width), named or not. */
  iconOnly: Control[];
  /** Unnamed icon-only controls with a spread that MAY carry the name. */
  opaque: Control[];
}

const BUTTON_TAGS = new Set(["Button", "button", "IconButton", "Toggle", "ToggleGroupItem"]);
const LINK_TAGS = new Set(["a", "Link"]);
/** Radix triggers render a <button> unless asChild hands that to the child. */
const isTriggerTag = (t: string) => /Trigger$/.test(t) && t !== "SelectTrigger";
const isControlTag = (t: string) => BUTTON_TAGS.has(t) || LINK_TAGS.has(t) || isTriggerTag(t);
/** Rendered in a portal, never inside the control — contributes no content. */
const isPortalContent = (t: string) => /(Tooltip|Popover|HoverCard|DropdownMenu|ContextMenu)Content$/.test(t);
const NAME_ATTRS = new Set(["aria-label", "aria-labelledby"]);

/** Tailwind's breakpoints, smallest first. Bit i = visible at BPS[i]. */
const BPS = ["base", "sm", "md", "lg", "xl", "2xl"] as const;
const ALL = (1 << BPS.length) - 1;
const DISPLAY = /^(inline|block|flex|inline-flex|inline-block|grid|inline-grid|contents|table|table-cell)$/;

/** Breakpoints at which an element with these class tokens is displayed. */
export function visibleMask(tokens: string[]): number {
  let mask = 0;
  let on = !tokens.includes("hidden");
  for (let i = 0; i < BPS.length; i++) {
    const bp = BPS[i];
    if (i > 0) {
      if (tokens.includes(`${bp}:hidden`)) on = false;
      else if (tokens.some((t) => t.startsWith(`${bp}:`) && DISPLAY.test(t.slice(bp.length + 1)))) on = true;
    }
    if (on) mask |= 1 << i;
  }
  // max-<bp>:hidden hides every breakpoint BELOW <bp>.
  for (let i = 1; i < BPS.length; i++) {
    if (tokens.includes(`max-${BPS[i]}:hidden`)) for (let j = 0; j < i; j++) mask &= ~(1 << j);
  }
  if (tokens.includes("sr-only")) mask = 0;
  return mask;
}

/** icon: an icon is present; text: bitmask of widths with visible text; sr: screen-reader-only text. */
type Content = { icon: boolean; text: number; sr: boolean };
const EMPTY: Content = { icon: false, text: 0, sr: false };
const merge = (a: Content, b: Content): Content => ({ icon: a.icon || b.icon, text: a.text | b.text, sr: a.sr || b.sr });
const within = (c: Content, mask: number): Content => ({ ...c, text: c.text & mask });

export function scanSource(fileName: string, src: string): ScanResult {
  const sf = ts.createSourceFile(fileName, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

  // Icon components: named imports from an icon package, plus *Icon by name
  // (`const Icon = item.icon` is this codebase's idiom for a passed-in lucide).
  const icons = new Set<string>();
  for (const s of sf.statements) {
    if (!ts.isImportDeclaration(s) || !ts.isStringLiteral(s.moduleSpecifier)) continue;
    if (!/^(lucide-react|react-icons(\/.*)?|@radix-ui\/react-icons)$/.test(s.moduleSpecifier.text)) continue;
    const nb = s.importClause?.namedBindings;
    if (nb && ts.isNamedImports(nb)) for (const e of nb.elements) icons.add(e.name.text);
  }
  const isIconTag = (t: string) => icons.has(t) || /(^|\.)\w*Icon$/.test(t) || t === "svg";

  const tagOf = (el: ts.JsxOpeningLikeElement) => el.tagName.getText(sf);
  const attr = (el: ts.JsxOpeningLikeElement, name: string) =>
    el.attributes.properties.find((p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && p.name.getText(sf) === name);
  const hasAttr = (el: ts.JsxOpeningLikeElement, name: string) => !!attr(el, name);
  const hasSpread = (el: ts.JsxOpeningLikeElement) => el.attributes.properties.some(ts.isJsxSpreadAttribute);
  const isNamedBy = (el: ts.JsxOpeningLikeElement) => [...NAME_ATTRS].some((a) => hasAttr(el, a));
  const literalLabel = (el: ts.JsxOpeningLikeElement) => {
    const init = attr(el, "aria-label")?.initializer;
    if (init && ts.isStringLiteral(init)) return init.text;
    if (init && ts.isJsxExpression(init) && init.expression && ts.isStringLiteral(init.expression)) return init.expression.text;
    return undefined;
  };

  /** Every string-literal piece of className — "…", {cn("…", x && "…")}, {`…`}. */
  function classTokens(el: ts.JsxOpeningLikeElement): string[] {
    const a = attr(el, "className");
    if (!a?.initializer) return [];
    const out: string[] = [];
    const visit = (n: ts.Node) => {
      if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) out.push(n.text);
      else if (ts.isTemplateExpression(n)) {
        out.push(n.head.text);
        for (const sp of n.templateSpans) out.push(sp.literal.text);
      }
      ts.forEachChild(n, visit);
    };
    visit(a.initializer);
    return out.join(" ").split(/\s+/).filter(Boolean);
  }

  function contentOfExpr(e: ts.Expression | undefined): Content {
    if (!e) return EMPTY;
    if (ts.isParenthesizedExpression(e)) return contentOfExpr(e.expression);
    if (ts.isConditionalExpression(e)) return merge(contentOfExpr(e.whenTrue), contentOfExpr(e.whenFalse));
    if (ts.isBinaryExpression(e)) {
      const op = e.operatorToken.kind;
      if (op === ts.SyntaxKind.AmpersandAmpersandToken) return contentOfExpr(e.right);
      if (op === ts.SyntaxKind.BarBarToken || op === ts.SyntaxKind.QuestionQuestionToken) {
        return merge(contentOfExpr(e.left), contentOfExpr(e.right));
      }
    }
    if (e.kind === ts.SyntaxKind.NullKeyword || e.kind === ts.SyntaxKind.FalseKeyword) return EMPTY;
    if (ts.isIdentifier(e) && e.text === "undefined") return EMPTY;
    if (ts.isJsxElement(e) || ts.isJsxSelfClosingElement(e) || ts.isJsxFragment(e)) return contentOfNode(e);
    return { ...EMPTY, text: ALL };
  }

  function contentOfChildren(children: ts.NodeArray<ts.JsxChild>): Content {
    let c = EMPTY;
    for (const k of children) c = merge(c, contentOfNode(k));
    return c;
  }

  function contentOfNode(n: ts.JsxChild | ts.JsxFragment): Content {
    if (ts.isJsxText(n)) return n.text.trim() ? { ...EMPTY, text: ALL } : EMPTY;
    if (ts.isJsxExpression(n)) return contentOfExpr(n.expression);
    if (ts.isJsxFragment(n)) return contentOfChildren(n.children);
    const open = ts.isJsxElement(n) ? n.openingElement : n;
    const tag = tagOf(open);
    if (isIconTag(tag)) return { ...EMPTY, icon: true };
    if (isPortalContent(tag)) return EMPTY;
    if (!ts.isJsxElement(n)) return { ...EMPTY, text: ALL };
    const inner = contentOfChildren(n.children);
    const tok = classTokens(open);
    if (tok.includes("sr-only")) return { icon: inner.icon, text: 0, sr: inner.sr || inner.text !== 0 };
    return within(inner, visibleMask(tok));
  }

  const result: ScanResult = { visited: 0, iconOnly: [], opaque: [] };
  const handled = new Set<ts.JsxOpeningLikeElement>();

  function isJunk(label: string, n: ts.Node, ...els: ts.JsxOpeningLikeElement[]): boolean {
    const tags = tagsIn(n);
    tags.delete(tagOf(els[0]));
    if (!tags.has(label)) return false;
    if (!isIconTag(label)) return true;
    const title = els.map((e) => attr(e, "title")?.initializer).find(Boolean);
    const titleText = title && ts.isStringLiteral(title) ? title.text : undefined;
    return titleText !== undefined && titleText.trim().toLowerCase() !== label.toLowerCase();
  }

  /** Every JSX tag name in a subtree, the root's own included. */
  function tagsIn(n: ts.Node): Set<string> {
    const out = new Set<string>();
    const visit = (k: ts.Node) => {
      if (ts.isJsxOpeningElement(k) || ts.isJsxSelfClosingElement(k)) out.add(tagOf(k));
      ts.forEachChild(k, visit);
    };
    visit(n);
    return out;
  }

  function check(n: ts.JsxElement | ts.JsxSelfClosingElement) {
    const open = ts.isJsxElement(n) ? n.openingElement : n;
    const tag = tagOf(open);
    if (!isControlTag(tag) || handled.has(open)) return;
    const asChild = hasAttr(open, "asChild");

    // asChild: Radix's Slot renders the CHILD, merging this element's props
    // onto it — so content is the child's, and a name on either counts.
    let target = open;
    let content: Content;
    const shapes: ControlShape[] = [];
    if (asChild) {
      if (!ts.isJsxElement(n)) return;
      const kids = n.children.filter((k) => !(ts.isJsxText(k) && !k.text.trim()));
      const child = kids.length === 1 ? kids[0] : undefined;
      if (!child || !(ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child))) return;
      const childOpen = ts.isJsxElement(child) ? child.openingElement : child;
      const childTag = tagOf(childOpen);
      // A child that is itself a control (<Button asChild><Link>…) is read
      // HERE, with both elements' names, and skipped when the walk reaches
      // it — otherwise it would be judged without the name Slot gives it.
      // A trigger wrapping a <Button> is the Button's business. A trigger
      // wrapping a span or a bare icon renders no control at all — it is a
      // hover target, not a button.
      if (isTriggerTag(tag) && BUTTON_TAGS.has(childTag)) return;
      if (isControlTag(childTag)) handled.add(childOpen);
      else if (!/^[A-Z]/.test(childTag) || isIconTag(childTag)) return;
      shapes.push("as-child");
      target = childOpen;
      content = ts.isJsxElement(child) ? contentOfChildren(child.children) : { ...EMPTY, text: ALL };
    } else {
      content = ts.isJsxElement(n) ? contentOfChildren(n.children) : EMPTY;
    }
    result.visited += 1;

    const sizeAttr = attr(open, "size");
    const sizeIcon =
      !!sizeAttr?.initializer && ts.isStringLiteral(sizeAttr.initializer) && sizeAttr.initializer.text === "icon";
    const bareIconButton = sizeIcon && !ts.isJsxElement(n); // <Button size="icon" /> — content via props
    const iconOnlyAtSomeWidth = content.icon && content.text !== ALL;
    if (!iconOnlyAtSomeWidth && !bareIconButton) return;

    if (sizeIcon) shapes.push("size-icon");
    if (isTriggerTag(tag)) shapes.push("trigger");
    if (LINK_TAGS.has(tag) || LINK_TAGS.has(tagOf(target))) shapes.push("link");
    if (content.text !== 0) shapes.push("responsive-label");
    else if (!sizeIcon && !isTriggerTag(tag) && !LINK_TAGS.has(tag) && !asChild) shapes.push("icon-children");
    const body = asChild && ts.isJsxElement(n) ? n.children : ts.isJsxElement(n) ? n.children : undefined;
    const hasConditional = (kids: ts.NodeArray<ts.JsxChild> | undefined): boolean =>
      !!kids?.some(
        (k) =>
          (ts.isJsxExpression(k) && !!k.expression && ts.isConditionalExpression(k.expression)) ||
          (ts.isJsxElement(k) && hasConditional(k.children)),
      );
    if (hasConditional(body)) shapes.push("conditional-icon");

    const named = content.sr || isNamedBy(open) || isNamedBy(target);
    const label = literalLabel(open) ?? literalLabel(target);
    const control: Control = {
      line: sf.getLineAndCharacterOfPosition(open.getStart(sf)).line + 1,
      tag,
      shapes,
      named,
      label,
      junkLabel: label !== undefined && isJunk(label.trim(), n, open, target),
    };
    result.iconOnly.push(control);
    if (!named && (hasSpread(open) || hasSpread(target))) result.opaque.push(control);
  }

  const visit = (n: ts.Node) => {
    if (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n)) check(n);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return result;
}
