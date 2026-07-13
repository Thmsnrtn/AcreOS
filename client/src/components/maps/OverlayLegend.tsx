/**
 * OverlayLegend
 *
 * A theme-aware key for the data overlays. A flood/soil/land-cover raster with
 * no legend is decoration, not intelligence — the legend is what makes a
 * customer say "oh, this is real data." It also fixes the color-only WCAG
 * failure: every swatch carries text, and the whole legend is screen-reader
 * legible.
 *
 * Color sourcing, honestly:
 * - The UI chrome (panel bg, border, text) uses design tokens only.
 * - The slope-gradient ramp is OUR OWN paint (the hillshade config in
 *   property-map.tsx), so its swatches are resolved from CSS vars and stay
 *   correct across all theme × mode combos.
 * - The FEMA NFHL and USGS NLCD palettes are FIXED data encodings published by
 *   the federal source — they are the literal colors the raster paints, not UI
 *   chrome. Re-coloring them would make the legend LIE about the map. They are
 *   defined as canonical data constants (the same way deal-status pin colors
 *   are), each paired with descriptive text so meaning never depends on color.
 *
 * The legend only lists overlays that are currently active.
 */
import { useState } from "react";
import { ChevronDown, ChevronUp, Map as MapIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface OverlayLegendActive {
  femaFloodZone?: boolean;
  zoningDistricts?: boolean; // USGS NLCD land cover
  slopeGradient?: boolean;
  nwiWetlands?: boolean; // USFWS National Wetlands Inventory
}

interface LegendBand {
  /** Inline color string. May be a CSS var() (our paint) or a fixed data hex. */
  color: string;
  label: string;
  /** Longer description for the accessible name. */
  desc?: string;
}

// FEMA NFHL flood-zone palette — fixed published data encoding.
const FEMA_BANDS: LegendBand[] = [
  { color: "#1d4ed8", label: "AE / A", desc: "1% annual chance flood (100-year)" },
  { color: "#38bdf8", label: "X (shaded)", desc: "0.2% annual chance (500-year)" },
  { color: "#a3a3a3", label: "X (unshaded)", desc: "Minimal flood hazard" },
  { color: "#7c3aed", label: "VE", desc: "Coastal high hazard (wave action)" },
];

// USGS NLCD land-cover classes — fixed published data encoding (abbreviated to
// the classes most relevant to land buyers).
const NLCD_BANDS: LegendBand[] = [
  { color: "#e8d1d1", label: "Developed", desc: "Built / impervious surfaces" },
  { color: "#38814e", label: "Forest", desc: "Deciduous, evergreen & mixed forest" },
  { color: "#fbf65d", label: "Cropland", desc: "Cultivated crops" },
  { color: "#dcca8f", label: "Pasture / hay", desc: "Grassland & managed pasture" },
  { color: "#5475a8", label: "Open water", desc: "Lakes, rivers, ponds" },
  { color: "#b8d9eb", label: "Wetlands", desc: "Woody & emergent herbaceous wetlands" },
];

// USFWS NWI wetlands palette — fixed published data encoding, read from the
// service's own renderer (Wetlands MapServer layer 0 drawingInfo, 2026-07-13).
// Abbreviated to the classes land buyers hit most.
const NWI_BANDS: LegendBand[] = [
  { color: "#7fc319", label: "Emergent", desc: "Freshwater emergent wetland (marsh, wet meadow)" },
  { color: "#008737", label: "Forested/shrub", desc: "Freshwater forested or shrub wetland" },
  { color: "#678bc0", label: "Pond", desc: "Freshwater pond" },
  { color: "#008fbf", label: "Riverine", desc: "River & stream channels" },
  { color: "#66c2a5", label: "Estuarine", desc: "Estuarine and marine wetland" },
];

// Slope gradient — OUR paint, so resolved from design tokens.
const SLOPE_BANDS: LegendBand[] = [
  { color: "var(--acr-heat-hot)", label: "Steep", desc: "Steep slope — harder to build / drain" },
  { color: "var(--acr-heat-warm)", label: "Moderate", desc: "Rolling / moderate slope" },
  { color: "var(--acr-pos)", label: "Flat", desc: "Near-level ground" },
];

function LegendSection({ title, source, bands }: { title: string; source: string; bands: LegendBand[] }) {
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-micro font-semibold text-foreground">{title}</p>
        <p className="text-[9px] text-muted-foreground">{source}</p>
      </div>
      <ul className="space-y-0.5 list-none m-0 p-0">
        {bands.map((b) => (
          <li
            key={b.label}
            className="flex items-center gap-1.5 text-micro text-muted-foreground"
            aria-label={b.desc ? `${b.label}: ${b.desc}` : b.label}
          >
            <span
              aria-hidden="true"
              className="inline-block w-2.5 h-2.5 rounded-sm shrink-0 border border-border/60"
              style={{ backgroundColor: b.color }}
            />
            <span aria-hidden="true">{b.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function OverlayLegend({ active }: { active: OverlayLegendActive }) {
  const [open, setOpen] = useState(true);

  const sections: { title: string; source: string; bands: LegendBand[] }[] = [];
  if (active.femaFloodZone) sections.push({ title: "Flood zones", source: "FEMA NFHL", bands: FEMA_BANDS });
  if (active.zoningDistricts) sections.push({ title: "Land cover", source: "USGS NLCD", bands: NLCD_BANDS });
  if (active.slopeGradient) sections.push({ title: "Slope", source: "USGS 3DEP", bands: SLOPE_BANDS });
  if (active.nwiWetlands) sections.push({ title: "Wetlands", source: "USFWS NWI", bands: NWI_BANDS });

  const count = sections.length;
  if (count === 0) return null;

  return (
    <div
      // Bold Tahoe re-skin (Wave R, §1.4 canvas-overlay chrome): this legend
      // floats OVER the map imagery, so it earns the canvas-overlay glass role —
      // `bg-surface-haze` (.90), the bold `backdrop-blur-lg` depth read, a
      // softened `border-border/50` edge-of-light hairline, `shadow-level-2`
      // (Track-1, theme-neutral — floats over content on all sides) and
      // `rounded-card`. Visual-only. See docs/design/reskin-treatment.md.
      className="bg-surface-haze backdrop-blur-lg rounded-card shadow-level-2 border border-border/50 overflow-hidden max-w-[200px]"
      data-testid="overlay-legend"
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={`Map legend, ${count} active overlay${count === 1 ? "" : "s"}. ${open ? "Collapse" : "Expand"}.`}
        className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <span className="flex items-center gap-1.5 text-micro font-medium text-foreground">
          <MapIcon className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
          Legend
          <span className="text-muted-foreground">({count})</span>
        </span>
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
        ) : (
          <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
        )}
      </button>
      {open && (
        <div className={cn("px-2.5 pb-2.5 space-y-2.5")}>
          {sections.map((s) => (
            <LegendSection key={s.title} title={s.title} source={s.source} bands={s.bands} />
          ))}
        </div>
      )}
    </div>
  );
}

export default OverlayLegend;
