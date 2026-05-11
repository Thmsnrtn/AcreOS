/**
 * Section: Meet Pax — the customer-facing AI operations partner.
 *
 * Per persona-architecture (see CLAUDE.md / MEMORY): customers see
 * Pax only. Other internal agents (Atlas/Sophie/Forge/etc.) are
 * founder-side and don't appear in marketing. This section presents
 * Pax's capabilities as three tabs (Analysis / Communication /
 * Servicing) — these are surfaces *within* Pax, not separate agents.
 *
 * Tab visual: letter avatar + tab label + role. Active tab gets a
 * colored 1px ring (Pax brand teal) + shadow. Panel below: tagline +
 * bullets on the left, sample card on the right. Mobile <880px
 * collapses to single column.
 */

import { useState } from "react";
import { LANDING_COPY } from "./copy";

const PAX_COLOR = "#4C7B80";

const SURFACES = [
  {
    id: "analysis",
    name: "Analysis",
    role: "Comps + parcel intel",
    letter: "A",
    tagline: "Pulls comps. Spots flaws. Prices parcels.",
    bullets: [
      "Pulls 10–20 comparables for any APN",
      "Calculates $/acre, road frontage, slope",
      "Flags wetlands, easements, access issues",
      "Suggests an offer band with confidence",
    ],
    sample: {
      title: "Pax just finished APN 304-12-456",
      rows: [
        ["Median comp", "$2,840 / acre"],
        ["Suggested offer", "$11,200 – $14,800"],
        ["Confidence", "High · 87%"],
        ["Flagged", "Easement on south boundary"],
      ],
    },
  },
  {
    id: "communication",
    name: "Communication",
    role: "Drafts + follow-ups",
    letter: "C",
    tagline: "Drafts replies. Books calls. Handles objections.",
    bullets: [
      "Drafts SMS, email, and voicemail replies",
      "Tone-matches each seller",
      "Schedules follow-ups across time zones",
      "Hands off when human judgment is needed",
    ],
    sample: {
      title: "Pax has 4 drafts ready for review",
      rows: [
        ["Janet R. · price negotiation", "Reviewed"],
        ["Marcus T. · objection (taxes)", "Awaiting"],
        ["Diane K. · scheduling call", "Awaiting"],
        ["Roy G. · sent contract", "Awaiting"],
      ],
    },
  },
  {
    id: "servicing",
    name: "Servicing",
    role: "Notes + ledger",
    letter: "S",
    tagline: "Watches title. Services notes. Keeps the books.",
    bullets: [
      "Tracks loan payments + sends receipts",
      "Monitors title status across counties",
      "Files 1098s and year-end statements",
      "Catches missed payments before the operator does",
    ],
    sample: {
      title: "Pax ledger · this week",
      rows: [
        ["Payments collected", "$14,820"],
        ["Notes serviced", "37 of 37"],
        ["Receipts sent", "37"],
        ["Late notices", "2 (auto-sent Mon)"],
      ],
    },
  },
] as const;

export function Agents() {
  const c = LANDING_COPY.agents;
  const [activeIdx, setActiveIdx] = useState(0);
  const a = SURFACES[activeIdx];

  return (
    <section className="lp-section" id="agents">
      <div className="lp-eyebrow lp-eyebrow-brand">{c.eyebrow}</div>
      <h2 className="lp-section-title">{c.title}</h2>
      <p className="lp-section-sub">{c.sub}</p>

      <div className="lp-agents-tabs" role="tablist">
        {SURFACES.map((s, i) => (
          <button
            key={s.id}
            role="tab"
            aria-selected={activeIdx === i}
            aria-controls={`agent-panel-${s.id}`}
            id={`agent-tab-${s.id}`}
            className={`lp-agent-tab ${activeIdx === i ? "lp-agent-tab-active" : ""}`}
            onClick={() => setActiveIdx(i)}
            style={
              activeIdx === i
                ? ({ "--tab-color": PAX_COLOR } as React.CSSProperties)
                : undefined
            }
          >
            <span className="lp-agent-tab-letter" style={{ background: PAX_COLOR }}>
              {s.letter}
            </span>
            <span>
              <span className="lp-agent-tab-name">{s.name}</span>
              <span className="lp-agent-tab-role">{s.role}</span>
            </span>
          </button>
        ))}
      </div>

      <div
        className="lp-agent-panel"
        key={a.id}
        role="tabpanel"
        id={`agent-panel-${a.id}`}
        aria-labelledby={`agent-tab-${a.id}`}
      >
        <div>
          <h3 className="lp-agent-tagline">{a.tagline}</h3>
          <ul className="lp-agent-bullets">
            {a.bullets.map((b, i) => (
              <li key={i}>
                <span className="lp-agent-check" style={{ color: PAX_COLOR }}>
                  ✓
                </span>
                {b}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <div className="lp-agent-sample" style={{ borderColor: PAX_COLOR + "33" }}>
            <div className="lp-agent-sample-head">
              <span
                className="lp-agent-sample-avatar"
                style={{ background: PAX_COLOR }}
              >
                P
              </span>
              <div className="lp-agent-sample-title">{a.sample.title}</div>
            </div>
            <div>
              {a.sample.rows.map((r, i) => (
                <div key={i} className="lp-agent-sample-row">
                  <span>{r[0]}</span>
                  <b>{r[1]}</b>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
