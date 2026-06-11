/**
 * ReceiptsStrip — "what got done while you were away" (Tier 3C).
 *
 * Renders the receipts the server derived from REAL rows (pax_sends through
 * the approval kernel, completed payments, successful scheduled-task runs).
 * Every chip is traceable to rows and deep-links to the door where the
 * evidence lives. When there are no receipts the component renders NOTHING —
 * no padding, no placeholder.
 */
import { Link } from "wouter";
import { motion } from "framer-motion";
import { CheckCircle2, ArrowRight } from "lucide-react";
import { formatRelative } from "@/lib/format";
import { staggerContainer, staggerItem } from "@/lib/animations";

export interface ReceiptItem {
  id: string;
  label: string;
  count: number;
  latestAt: string | null;
  href: string;
}

interface ReceiptsStripProps {
  receipts: ReceiptItem[];
}

export function ReceiptsStrip({ receipts }: ReceiptsStripProps) {
  if (receipts.length === 0) return null;
  return (
    <section aria-label="Handled while you were away" data-testid="section-receipts-strip">
      <motion.ul
        role="list"
        className="flex flex-wrap gap-2"
        variants={staggerContainer}
        initial="hidden"
        animate="visible"
      >
        {receipts.map((r) => (
          <motion.li key={r.id} role="listitem" variants={staggerItem}>
            <Link
              href={r.href}
              data-testid={`receipt-${r.id}`}
              className="inline-flex items-center gap-1.5 min-h-11 pointer-fine:sm:min-h-9 px-3 py-1.5 rounded-full border border-[color:var(--acr-line-soft)] bg-acr-surface text-sm md:text-xs text-acr-ink-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:opacity-70 [@media(hover:hover)]:hover:border-[color:var(--acr-brand)]/40"
            >
              <CheckCircle2 className="w-3.5 h-3.5 text-acr-pos shrink-0" aria-hidden="true" />
              <span>{r.label}</span>
              {r.latestAt && (
                <span className="text-acr-ink-3 tabular-nums">
                  · {formatRelative(r.latestAt)}
                </span>
              )}
              <ArrowRight className="w-3 h-3 text-acr-ink-3 shrink-0" aria-hidden="true" />
            </Link>
          </motion.li>
        ))}
      </motion.ul>
    </section>
  );
}
