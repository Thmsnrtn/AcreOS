/**
 * ReceiptChips — small tappable receipts under a Solene reply
 * (experience-legibility F3b). When a turn's tool calls created something
 * real (a decision, a queued dispatch, an approval waiting on the founder),
 * each artifact gets a chip linking to the surface where it lives — no
 * number without a tappable source.
 */
import React from "react";
import { Link } from "wouter";
import { ArrowRight } from "lucide-react";
import type { Receipt } from "./chatWork";

export function ReceiptChips({ receipts }: { receipts: Receipt[] }) {
  if (receipts.length === 0) return null;
  return (
    <div
      className="px-2 md:px-4 flex flex-wrap items-center gap-1.5"
      data-testid="receipt-chips"
    >
      {receipts.map((r, i) => (
        <Link
          key={`${r.type}-${i}`}
          href={r.href}
          className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-testid={`receipt-chip-${r.type}`}
        >
          <span>{r.label}</span>
          <ArrowRight className="h-3 w-3 shrink-0" aria-hidden="true" />
        </Link>
      ))}
    </div>
  );
}
