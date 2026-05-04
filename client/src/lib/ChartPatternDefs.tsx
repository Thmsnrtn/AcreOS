import { CHART_PATTERN_IDS } from "./chartPalette";

/**
 * SVG <defs> registering hatching patterns referenced by `getPatternUrl(idx)`.
 *
 * Mount once inside any Recharts <ResponsiveContainer> via:
 *
 *   <ResponsiveContainer ...>
 *     <AreaChart ...>
 *       <ChartPatternDefs color="#0072B2" />
 *       ...
 *     </AreaChart>
 *   </ResponsiveContainer>
 *
 * Patterns inherit the supplied `color` so each series can register its own
 * defs block scoped under a unique id-prefix when needed.
 *
 * WCAG 2.2 SC 1.4.11: combining color + pattern ensures a series remains
 * distinguishable when the page is rendered in grayscale or simulated under
 * deuteranopia.
 */
export function ChartPatternDefs({
  color = "currentColor",
  prefix = "",
  opacity = 0.7,
}: {
  color?: string;
  prefix?: string;
  opacity?: number;
}) {
  const id = (i: number) => `${prefix}${CHART_PATTERN_IDS[i]}`;
  return (
    <defs>
      {/* 0 — diagonal stripes */}
      <pattern id={id(0)} patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
        <line x1="0" y1="0" x2="0" y2="6" stroke={color} strokeWidth="2" opacity={opacity} />
      </pattern>
      {/* 1 — dots */}
      <pattern id={id(1)} patternUnits="userSpaceOnUse" width="6" height="6">
        <circle cx="3" cy="3" r="1.2" fill={color} opacity={opacity} />
      </pattern>
      {/* 2 — square grid */}
      <pattern id={id(2)} patternUnits="userSpaceOnUse" width="8" height="8">
        <path d="M 8 0 L 0 0 0 8" fill="none" stroke={color} strokeWidth="1" opacity={opacity} />
      </pattern>
      {/* 3 — crosshatch */}
      <pattern id={id(3)} patternUnits="userSpaceOnUse" width="8" height="8" patternTransform="rotate(45)">
        <line x1="0" y1="0" x2="0" y2="8" stroke={color} strokeWidth="1.5" opacity={opacity} />
        <line x1="0" y1="0" x2="8" y2="0" stroke={color} strokeWidth="1.5" opacity={opacity} />
      </pattern>
      {/* 4 — vertical stripes */}
      <pattern id={id(4)} patternUnits="userSpaceOnUse" width="6" height="6">
        <line x1="0" y1="0" x2="0" y2="6" stroke={color} strokeWidth="2" opacity={opacity} />
      </pattern>
      {/* 5 — horizontal stripes */}
      <pattern id={id(5)} patternUnits="userSpaceOnUse" width="6" height="6">
        <line x1="0" y1="0" x2="6" y2="0" stroke={color} strokeWidth="2" opacity={opacity} />
      </pattern>
      {/* 6 — zigzag */}
      <pattern id={id(6)} patternUnits="userSpaceOnUse" width="8" height="6">
        <path d="M 0 3 L 2 0 L 4 3 L 6 0 L 8 3" fill="none" stroke={color} strokeWidth="1.2" opacity={opacity} />
      </pattern>
      {/* 7 — checker */}
      <pattern id={id(7)} patternUnits="userSpaceOnUse" width="8" height="8">
        <rect x="0" y="0" width="4" height="4" fill={color} opacity={opacity} />
        <rect x="4" y="4" width="4" height="4" fill={color} opacity={opacity} />
      </pattern>
    </defs>
  );
}
