/**
 * <GlossaryTerm slug="yellow_letter">yellow letter</GlossaryTerm>
 *
 * Wraps domain vocabulary in a tooltip that surfaces the plain-English
 * definition from `client/src/lib/glossary.ts`. Underlines the term with a
 * subtle dashed style so it doesn't disrupt reading. Uses shadcn `Tooltip`
 * primitives — `TooltipProvider` is already mounted at the App root.
 *
 * Accessibility: the trigger gets `aria-describedby` pointing at a hidden
 * description element so screen readers read the definition alongside the
 * term. The visual tooltip is purely cosmetic; the description is the
 * source of truth.
 */

import * as React from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { getGlossaryEntry, type GlossarySlug } from "@/lib/glossary";
import { cn } from "@/lib/utils";

interface GlossaryTermProps {
  /** Registry key in `GLOSSARY`. Unknown slugs render children unwrapped. */
  slug: GlossarySlug | string;
  /** Optional: override the tooltip content with a custom node. */
  override?: React.ReactNode;
  /** Optional: extra classes on the trigger. */
  className?: string;
  /** The visible label — typically the inline term text. */
  children: React.ReactNode;
}

let nextId = 0;

export function GlossaryTerm({
  slug,
  override,
  className,
  children,
}: GlossaryTermProps) {
  const entry = getGlossaryEntry(slug);
  // Stable id for aria-describedby across re-renders.
  const idRef = React.useRef<string | null>(null);
  if (idRef.current === null) {
    idRef.current = `glossary-${slug}-${++nextId}`;
  }
  const descId = idRef.current;

  // Unknown slug → render children plainly so we never break the surface.
  if (!entry && !override) {
    return <>{children}</>;
  }

  const definition = override ?? entry?.definition;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          aria-describedby={descId}
          className={cn(
            // Subtle: dashed underline, decoration uses muted-foreground so it
            // doesn't disrupt reading flow. Hover/focus brightens slightly.
            "underline decoration-dashed decoration-muted-foreground/60 underline-offset-4 cursor-help",
            "hover:decoration-foreground focus-visible:decoration-foreground",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 rounded-sm",
            className,
          )}
          data-glossary-slug={slug}
        >
          {children}
          <span id={descId} className="sr-only">
            {entry?.term ? `${entry.term}: ` : ""}
            {definition}
          </span>
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs text-xs leading-relaxed">
        {entry?.term && (
          <span className="block font-semibold mb-1">{entry.term}</span>
        )}
        <span className="block text-muted-foreground">{definition}</span>
      </TooltipContent>
    </Tooltip>
  );
}

export default GlossaryTerm;
