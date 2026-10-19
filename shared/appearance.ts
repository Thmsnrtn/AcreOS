/**
 * The personal appearance contract — the ONE list of colorways and display
 * modes. Both pickers (Settings → Appearance and the quick dialog), the client
 * theme provider, the server preference route and the tests read it from here,
 * so a colorway cannot exist in one place and be missing in another (the
 * pre-Fieldstone pickers carried different theme lists, and Settings omitted
 * the runtime default entirely).
 *
 * Founder decision 2026-10-18 (Fieldstone redesign): exactly three curated
 * colorways — Fieldstone (default), Bedrock, Meridian — that share every
 * layout, type, spacing and interaction rule. A colorway changes the palette,
 * never the structure or the font personality. Each supports Light, Dark and
 * Match device (stored as `auto`). Font pairing, density and motion are no
 * longer personal-appearance choices: type is one system (Fraunces display +
 * Inter interface), and motion/reading comfort live under Accessibility &
 * comfort (client/src/contexts/accessibility-context.tsx).
 *
 * Browser-safe: no imports, no Node APIs.
 */

export const COLORWAY_IDS = ["fieldstone", "bedrock", "meridian"] as const;
export type ColorwayId = (typeof COLORWAY_IDS)[number];

export const DISPLAY_MODES = ["light", "dark", "auto"] as const;
export type DisplayMode = (typeof DISPLAY_MODES)[number];

export const DEFAULT_COLORWAY: ColorwayId = "fieldstone";
export const DEFAULT_DISPLAY_MODE: DisplayMode = "auto";

export interface ColorwaySwatch {
  /** Page background. */
  page: string;
  /** Content surface. */
  surface: string;
  /** Primary action colour. */
  primary: string;
  /** Navigation rail. */
  rail: string;
  /** Decorative accent (brass / rust-gold / copper). */
  accent: string;
}

export interface ColorwayDef {
  id: ColorwayId;
  name: string;
  description: string;
  light: ColorwaySwatch;
  dark: ColorwaySwatch;
}

/** Display metadata. Swatch hexes mirror the `--acr-*` tokens in index.css
 *  (pinned by tests/unit/appearanceContract.test.ts). */
export const COLORWAYS: readonly ColorwayDef[] = [
  {
    id: "fieldstone",
    name: "Fieldstone",
    description: "Forest, limestone and sage, with restrained brass",
    light: { page: "#F8F8F3", surface: "#FFFFFF", primary: "#174B40", rail: "#123B32", accent: "#B79A5B" },
    dark: { page: "#111B18", surface: "#192823", primary: "#B6D3BA", rail: "#0C1512", accent: "#D2B77C" },
  },
  {
    id: "bedrock",
    name: "Bedrock",
    description: "Rust, bone and moss — the familiar warm finish",
    light: { page: "#EDE3D0", surface: "#F7F0DD", primary: "#A04428", rail: "#2B2017", accent: "#B8842E" },
    dark: { page: "#13100B", surface: "#1F1A12", primary: "#C2604A", rail: "#0A0805", accent: "#D9A24A" },
  },
  {
    id: "meridian",
    name: "Meridian",
    description: "Aubergine, porcelain and lavender, with copper",
    light: { page: "#FAF8F7", surface: "#FFFFFF", primary: "#35283F", rail: "#2D2235", accent: "#B36E4D" },
    dark: { page: "#1B161F", surface: "#241D2A", primary: "#DDC5E3", rail: "#140F18", accent: "#DBA486" },
  },
];

export const DISPLAY_MODE_LABELS: Record<DisplayMode, string> = {
  light: "Light",
  dark: "Dark",
  auto: "Match device",
};

/**
 * Retired colorway ids → their successor. Homestead (and the older
 * `dirtpass`) were warm finishes; their people land on Bedrock, the familiar
 * warm alternative. The experimental finishes land on the Fieldstone default.
 * The display mode is never inferred from an old colorway name (Nocturne was
 * "operator dark", but a stored mode stays what it was).
 */
export const LEGACY_COLORWAY_MIGRATION: Readonly<Record<string, ColorwayId>> = {
  homestead: "bedrock",
  dirtpass: "bedrock",
  quarry: "fieldstone",
  nocturne: "fieldstone",
  meadow: "fieldstone",
  slate: "fieldstone",
};

/** Appearance fields that were once personal choices and are now retired.
 *  Older clients may still send them; the server accepts and discards them. */
export const RETIRED_APPEARANCE_FIELDS = ["fontPairing", "density", "motion"] as const;

function isColorwayId(v: unknown): v is ColorwayId {
  return typeof v === "string" && (COLORWAY_IDS as readonly string[]).includes(v);
}

/** A stored colorway value → a current colorway, or `undefined` when the value
 *  is absent, malformed or unknown (the caller keeps its own fallback). */
export function normalizeColorway(v: unknown): ColorwayId | undefined {
  if (typeof v !== "string") return undefined;
  if (isColorwayId(v)) return v;
  // Own keys only — `__proto__` / `constructor` must not resolve to a prototype.
  return Object.prototype.hasOwnProperty.call(LEGACY_COLORWAY_MIGRATION, v) ? LEGACY_COLORWAY_MIGRATION[v] : undefined;
}

/** A stored display-mode value → a current mode, or `undefined`. The legacy
 *  `system` value is Match device. */
export function normalizeDisplayMode(v: unknown): DisplayMode | undefined {
  if (v === "system") return "auto";
  if (typeof v === "string" && (DISPLAY_MODES as readonly string[]).includes(v)) return v as DisplayMode;
  return undefined;
}

export interface AppearanceSelection {
  theme: ColorwayId;
  mode: DisplayMode;
}

/** Any stored blob (localStorage JSON, server JSONB, a PATCH body) → a valid
 *  selection, filling defaults for whatever is missing or unusable. Never
 *  throws. */
export function normalizeAppearance(raw: unknown): AppearanceSelection {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    theme: normalizeColorway(r.theme) ?? DEFAULT_COLORWAY,
    mode: normalizeDisplayMode(r.mode) ?? DEFAULT_DISPLAY_MODE,
  };
}

/** `light` / `dark` for a mode, given whether the device currently prefers dark. */
export function resolveDisplayMode(mode: DisplayMode, deviceDark: boolean): "light" | "dark" {
  if (mode === "auto") return deviceDark ? "dark" : "light";
  return mode;
}
