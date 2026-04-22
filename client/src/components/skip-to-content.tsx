/**
 * SkipToContent — anchored link that jumps focus past nav chrome to the
 * first landmark. Visible only on keyboard focus, required for WCAG
 * 2.1 SC 2.4.1 "Bypass Blocks".
 *
 * Pair with `id="main-content"` on the first interactive / content
 * region on the page.
 */
export function SkipToContent({ href = "#main-content" }: { href?: string }) {
  return (
    <a
      href={href}
      className="sr-only focus:not-sr-only focus:absolute focus:z-[100] focus:top-2 focus:left-2 focus:px-4 focus:py-2 focus:bg-primary focus:text-primary-foreground focus:rounded-md focus:text-sm focus:font-medium"
    >
      Skip to content
    </a>
  );
}
