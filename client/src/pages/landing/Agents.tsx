/**
 * Prototype reference: /acreos-landing/sections-1.jsx → Agents (lines 142-272)
 *
 * Tabbed three-agent showcase. Tabs are letter avatars + name + role.
 * Active tab gets a colored 1px ring (the agent's identity color) +
 * shadow. Panel below: tagline + bullets on the left, sample card with
 * label/value rows on the right. Mobile <880px collapses to single
 * column for both tabs and panel.
 *
 * Per-agent identity colors are not theme tokens — they're agent
 * branding that stays consistent regardless of light/dark theme.
 * Atlas = brand terracotta (matches --acr-brand). Pax = teal.
 * Sophie = warm tan-brown.
 *
 * Per persona-architecture saved memory: customers see all three
 * named agents on the public landing (this is marketing of the AI
 * workforce). The "customers see Pax only" rule applies to the
 * primary in-app conversational interface, not to background-agent
 * surfacing or marketing.
 */

import { useState } from "react";
import { LANDING_COPY } from "./copy";

const AGENTS = [
  {
    id: "atlas",
    name: "Atlas",
    role: "Analysis",
    tagline: "Pulls comps. Spots flaws. Prices parcels.",
    color: "#C2531C",
    bullets: [
      "Pulls 10–20 comparables for any APN",
      "Calculates $/acre, road frontage, slope",
      "Flags wetlands, easements, access issues",
      "Suggests an offer band with confidence",
    ],
    sample: {
      title: "Atlas just finished APN 304-12-456",
      rows: [
        ["Median comp", "$2,840 / acre"],
        ["Suggested offer", "$11,200 – $14,800"],
        ["Confidence", "High · 87%"],
        ["Flagged", "Easement on south boundary"],
      ],
    },
  },
  {
    id: "pax",
    name: "Pax",
    role: "Communication",
    tagline: "Drafts replies. Books calls. Handles objections.",
    color: "#4C7B80",
    bullets: [
      "Drafts SMS, email, and voicemail replies",
      "Tone-matches each seller",
      "Schedules follow-ups across time zones",
      "Hands off to you when judgment is needed",
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
    id: "sophie",
    name: "Sophie",
    role: "Servicing",
    tagline: "Watches title. Services notes. Keeps the books.",
    color: "#8B5A2B",
    bullets: [
      "Tracks loan payments + sends receipts",
      "Monitors title status across counties",
      "Files 1098s and year-end statements",
      "Catches missed payments before you do",
    ],
    sample: {
      title: "Sophie's ledger · this week",
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
  const a = AGENTS[activeIdx];

  return (
    <section className="lp-section" id="agents">
      <div className="lp-eyebrow lp-eyebrow-brand">{c.eyebrow}</div>
      <h2 className="lp-section-title">{c.title}</h2>
      <p className="lp-section-sub">{c.sub}</p>

      <div className="lp-agents-tabs" role="tablist">
        {AGENTS.map((ag, i) => (
          <button
            key={ag.id}
            role="tab"
            aria-selected={activeIdx === i}
            aria-controls={`agent-panel-${ag.id}`}
            id={`agent-tab-${ag.id}`}
            className={`lp-agent-tab ${activeIdx === i ? "lp-agent-tab-active" : ""}`}
            onClick={() => setActiveIdx(i)}
            style={
              activeIdx === i
                ? ({ "--tab-color": ag.color } as React.CSSProperties)
                : undefined
            }
          >
            <span className="lp-agent-tab-letter" style={{ background: ag.color }}>
              {ag.name[0]}
            </span>
            <span>
              <span className="lp-agent-tab-name">{ag.name}</span>
              <span className="lp-agent-tab-role">{ag.role}</span>
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
                <span className="lp-agent-check" style={{ color: a.color }}>
                  ✓
                </span>
                {b}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <div className="lp-agent-sample" style={{ borderColor: a.color + "33" }}>
            <div className="lp-agent-sample-head">
              <span
                className="lp-agent-sample-avatar"
                style={{ background: a.color }}
              >
                {a.name[0]}
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
