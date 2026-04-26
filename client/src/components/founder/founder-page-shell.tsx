/**
 * Founder Page Shell — single shared chassis for every /founder/*
 * dashboard, per HANDOFF "founder mode" tier and GAPS Tier 2
 * recommendation: "treat all of these as founder dashboards with one
 * shared layout. Don't design them individually unless one becomes
 * daily-driver — design the founder-page chassis and let developers
 * fit each one in."
 *
 * Slots:
 * - eyebrow + title + actions: editorial header (matches the homestead
 *   pattern used across the rest of the app)
 * - filters: optional chip / tab row below the header
 * - children: the dashboard's main content (caller composes Cards /
 *   tables / charts using shadcn primitives + acr-* tokens)
 *
 * Voice notes for founder pages: terser than customer-facing copy.
 * The reader is operating the platform, not learning it. Use
 * data-dense headlines (counts, deltas) over editorial flourish.
 */
import * as React from "react";
import { PageShell } from "@/components/page-shell";

interface FounderPageShellProps {
  /** Required short label above the title (e.g. "Founder · Tenants") */
  eyebrow: string;
  /** Required main h1 — keep it data-dense ("12 active tenants · $14.4K MRR") */
  title: React.ReactNode;
  /** Optional soft trailing clause shown inline with title in muted ink */
  titleSoft?: React.ReactNode;
  /** Right-aligned action buttons */
  actions?: React.ReactNode;
  /** Optional filter / tab row */
  filters?: React.ReactNode;
  /** Document title (defaults to the eyebrow) */
  pageTitle?: string;
  /** Body content */
  children: React.ReactNode;
}

export function FounderPageShell({
  eyebrow,
  title,
  titleSoft,
  actions,
  filters,
  pageTitle,
  children,
}: FounderPageShellProps) {
  return (
    <PageShell label={pageTitle ?? eyebrow}>
      <div className="acr-cc-hero" style={{ marginTop: 0 }}>
        <div>
          <div className="acr-eyebrow">{eyebrow}</div>
          <h1 className="acr-cc-greeting">
            {title}
            {titleSoft && <span className="acr-cc-greeting-soft"> {titleSoft}</span>}
          </h1>
        </div>
        {actions && <div className="acr-cc-hero-actions">{actions}</div>}
      </div>
      {filters && <div className="mt-4 mb-2">{filters}</div>}
      <div className="space-y-6 mt-4">{children}</div>
    </PageShell>
  );
}
