/**
 * Prototype reference: /acreos-landing/sections-2.jsx → Features (lines 76-133)
 *
 * 12-feature grid in 4 columns (3 at <1080px, 2 at <720px, 1 at <480px).
 * Each card: tiny uppercase category label, brand-color SVG glyph,
 * 16px sans bold title, 13px description. Hover: lift + shadow + brand
 * border tint.
 *
 * SVG glyphs (12 designs, line-style at 28px) are inlined per the
 * prototype's FeatureGlyph helper. Brand-color stroke matches the
 * homestead palette.
 */

import { LANDING_COPY } from "./copy";

type GlyphKind =
  | "box" | "list" | "scale" | "satellite" | "mail" | "inbox"
  | "doc" | "pen" | "ledger" | "flow" | "audit" | "team";

const FEATURES: { cat: string; t: string; d: string; i: GlyphKind }[] = [
  { cat: "Find", t: "Buy-box agent", d: "Define your criteria once. AcreOS watches every parcel listing in your counties — forever.", i: "box" },
  { cat: "Find", t: "Pulled lists", d: "Skip-traced, deduped, sorted by likelihood. Ready every Monday morning.", i: "list" },
  { cat: "Analyze", t: "Atlas comps", d: "Real comparable sales, not Zillow guesses. With confidence scores.", i: "scale" },
  { cat: "Analyze", t: "Parcel intel", d: "Wetlands, easements, access, soil, slope. All on one screen.", i: "satellite" },
  { cat: "Reach", t: "Mail platform", d: "Multi-touch campaigns. Tracked. A/B tested. Full creative control.", i: "mail" },
  { cat: "Reach", t: "Pax Inbox", d: "SMS, email, voicemail in one thread. Drafts ready for every reply.", i: "inbox" },
  { cat: "Close", t: "Offer composer", d: "Generate written offers in 30 seconds. Atlas defends the price.", i: "doc" },
  { cat: "Close", t: "E-sign + escrow", d: "Send contracts, track signatures, hand off to title — without leaving the app.", i: "pen" },
  { cat: "Service", t: "Sophie ledger", d: "Auto-pay, receipts, late notices, 1098s. Your seller-finance back office.", i: "ledger" },
  { cat: "Operate", t: "Automation builder", d: "No-code workflows. Trigger anything off any event. Pause anything in one click.", i: "flow" },
  { cat: "Operate", t: "Audit log", d: "Every agent action — what, when, why, what data it used. Full transparency.", i: "audit" },
  { cat: "Operate", t: "Team + roles", d: "Bring on a VA, a partner, or your spouse. Granular permissions.", i: "team" },
];

function FeatureGlyph({ kind }: { kind: GlyphKind }) {
  const stroke = "#C2531C";
  const props = {
    width: 28,
    height: 28,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke,
    strokeWidth: 1.5,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className: "lp-feature-glyph",
    "aria-hidden": true,
  };
  switch (kind) {
    case "box":
      return (
        <svg {...props}>
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M3 9h18M9 3v18" />
        </svg>
      );
    case "list":
      return (
        <svg {...props}>
          <path d="M4 6h16M4 12h16M4 18h10" />
          <circle cx="20" cy="18" r="1.5" fill={stroke} />
        </svg>
      );
    case "scale":
      return (
        <svg {...props}>
          <path d="M12 3v18M5 8h14M5 8l-2 6a3 3 0 006 0l-2-6M19 8l-2 6a3 3 0 006 0l-2-6" />
        </svg>
      );
    case "satellite":
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="8" />
          <path d="M4 12h16M12 4c2.5 3 2.5 13 0 16M12 4c-2.5 3-2.5 13 0 16" />
        </svg>
      );
    case "mail":
      return (
        <svg {...props}>
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="M3 7l9 6 9-6" />
        </svg>
      );
    case "inbox":
      return (
        <svg {...props}>
          <path d="M3 13h5l2 3h4l2-3h5" />
          <path d="M3 13l3-8h12l3 8v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6z" />
        </svg>
      );
    case "doc":
      return (
        <svg {...props}>
          <path d="M14 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V9z" />
          <path d="M14 3v6h6M9 14h6M9 17h4" />
        </svg>
      );
    case "pen":
      return (
        <svg {...props}>
          <path d="M12 19l7-7 3 3-7 7-3-3z" />
          <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18M2 2l7.586 7.586" />
          <circle cx="11" cy="11" r="2" />
        </svg>
      );
    case "ledger":
      return (
        <svg {...props}>
          <rect x="4" y="3" width="16" height="18" rx="1" />
          <path d="M8 7h8M8 11h8M8 15h5" />
        </svg>
      );
    case "flow":
      return (
        <svg {...props}>
          <circle cx="6" cy="6" r="2" />
          <circle cx="18" cy="6" r="2" />
          <circle cx="6" cy="18" r="2" />
          <circle cx="18" cy="18" r="2" />
          <path d="M8 6h8M6 8v8M18 8v8" />
        </svg>
      );
    case "audit":
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
      );
    case "team":
      return (
        <svg {...props}>
          <circle cx="9" cy="8" r="3" />
          <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" />
          <circle cx="17" cy="9" r="2.5" />
          <path d="M14 20c0-2.7 1.3-5 3-5s3 2 3 5" />
        </svg>
      );
  }
}

export function Features() {
  const c = LANDING_COPY.features;
  return (
    <section className="lp-section" id="features">
      <div className="lp-eyebrow">{c.eyebrow}</div>
      <h2 className="lp-section-title">{c.title}</h2>
      <p className="lp-section-sub">{c.sub}</p>

      <div className="lp-features-grid">
        {FEATURES.map((f, i) => (
          <div key={i} className="lp-feature-card">
            <div className="lp-feature-cat">{f.cat}</div>
            <FeatureGlyph kind={f.i} />
            <h3 className="lp-feature-title">{f.t}</h3>
            <p className="lp-feature-desc">{f.d}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
