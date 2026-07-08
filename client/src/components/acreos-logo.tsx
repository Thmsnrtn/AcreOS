import * as React from "react";
import { cn } from "@/lib/utils";

interface AcreosLogoProps extends React.SVGAttributes<SVGSVGElement> {
  /** Mark only, mark + wordmark, or wordmark only. Defaults to mark + wordmark. */
  variant?: "mark" | "full" | "wordmark";
  /** Overall size in px (height). Width scales. Defaults to 32. */
  size?: number;
}

/**
 * AcreOS brandmark.
 *
 * The mark is a parcel-outline geometry evoking aerial land boundaries
 * + a bold "A" aperture — the shape reads as land plot first, letter
 * second. Uses currentColor so it inherits text color from context.
 *
 * Replaces the placeholder `<span>A</span>` square that's been sitting
 * on the landing nav, emails, and auth surfaces since launch.
 */
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
      {showMark && (
        <svg
          aria-hidden="true"
          viewBox="0 0 32 32"
          width={size}
          height={size}
          xmlns="http://www.w3.org/2000/svg"
          {...rest}
        >
          {/* Parcel outline: slightly irregular to evoke real land lots */}
          <path
            d="M5 6 L27 4 L29 18 L24 27 L7 26 L3 14 Z"
            fill="url(#acreos-gradient)"
            stroke="currentColor"
            strokeOpacity="0.15"
            strokeWidth="0.75"
          />
          {/* "A" aperture cut — negative space reads as both letter and horizon */}
          <path
            d="M16 9 L22 22 L18.75 22 L17.5 19 L14 19 L12.75 22 L9.5 22 Z M15 17 L17 17 L16 14 Z"
            fill="white"
            fillOpacity="0.95"
          />
          <defs>
            <linearGradient id="acreos-gradient" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
              {/* brand primary → accent (Saddle Brown → Desert Sage) */}
              <stop offset="0%" stopColor="hsl(25 70% 35%)" />
              <stop offset="100%" stopColor="hsl(160 25% 40%)" />
            </linearGradient>
          </defs>
        </svg>
      )}
      {showWord && (
        <span className="font-bold tracking-tight leading-none" style={{ fontSize: size * 0.6 }}>
          AcreOS
        </span>
      )}
    </span>
  );
}
