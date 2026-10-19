import * as React from "react";
import { cn } from "@/lib/utils";

interface AcreosLogoProps extends React.SVGAttributes<SVGSVGElement> {
  /** Mark only, mark + wordmark, or wordmark only. Defaults to mark + wordmark. */
  variant?: "mark" | "full" | "wordmark";
  /** Overall size in px (height). Width scales. Defaults to 32. */
  size?: number;
}

/**
 * The AcreOS mark — ONE geometry everywhere (Fieldstone redesign, 2026-10-18).
 *
 * An "A" drawn as land: an outer peaked parcel line (the boundary, flat at
 * the summit like a surveyed lot) and an inner chevron in the colorway's
 * accent (the horizon/aperture of the earlier mark). The same two paths are
 * in client/public/favicon.svg and favicon-maskable.svg, rasterized by
 * scripts/generate-icons.mjs, and in the landing nav — pinned by
 * tests/unit/brandMarkIsOne.test.ts.
 *
 * Theme-aware: the boundary uses currentColor (ink on light content, rail ink
 * on the dark navigation rail) and the chevron uses --acr-accent (brass,
 * dust-gold or copper by colorway), with the Fieldstone brass as fallback
 * for surfaces outside the token scope.
 */
export const ACREOS_MARK_PATHS = {
  boundary: "M3.5 27 L13.4 5 L18.6 5 L28.5 27",
  chevron: "M10.6 27 L17.3 12.6 L24 27",
} as const;

export function AcreosMark({ size = 32, ...rest }: { size?: number } & React.SVGAttributes<SVGSVGElement>) {
  return (
    <svg aria-hidden="true" viewBox="0 0 32 32" width={size} height={size} xmlns="http://www.w3.org/2000/svg" {...rest}>
      <path
        d={ACREOS_MARK_PATHS.boundary}
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinejoin="miter"
        strokeLinecap="square"
      />
      <path
        d={ACREOS_MARK_PATHS.chevron}
        fill="none"
        stroke="var(--acr-accent, #B79A5B)"
        strokeWidth="2.2"
        strokeLinejoin="miter"
        strokeLinecap="square"
      />
    </svg>
  );
}

export function AcreosLogo({
  variant = "full",
  size = 32,
  className,
  ...rest
}: AcreosLogoProps) {
  const showMark = variant !== "wordmark";
  const showWord = variant !== "mark";

  return (
    <span
      className={cn("inline-flex items-center gap-2 align-middle", className)}
      role="img"
      aria-label="AcreOS"
    >
      {showMark && <AcreosMark size={size} {...rest} />}
      {showWord && (
        <span
          aria-hidden="true"
          className="font-display font-semibold leading-none"
          style={{ fontSize: size * 0.72, letterSpacing: "-0.02em" }}
        >
          AcreOS
        </span>
      )}
    </span>
  );
}
