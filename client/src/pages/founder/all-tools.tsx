/**
 * FounderAllToolsPage — the categorized index of every founder deep-dive.
 *
 * The new founder surface collapses to 5 primary doors (Today / Team /
 * Customers / Money / Build) plus Settings. That keeps the daily-driver
 * nav clean, but it left ~70 deeper /founder/* surfaces reachable only via
 * Solene chat, ⌘K, or a typed URL. This page is the visible affordance:
 * the single place a founder can SEE and click into every secondary
 * surface — Life-Cockpit, Cost, Unit economics, Recourse, Appeals,
 * Readiness, Keys, and the rest — grouped by area.
 *
 * Source of truth is FOUNDER_NAV_DEEP_DIVES in lib/nav-items.ts, rendered
 * via founderDeepDivesGrouped() so this stays in sync automatically as the
 * catalog grows. No per-link maintenance here.
 */

import { Link } from "wouter";
import { motion } from "framer-motion";
import { FounderPageShell } from "@/components/founder/founder-page-shell";
import "../today.css";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { staggerContainer, staggerItem } from "@/lib/animations";
import { founderDeepDivesGrouped, FOUNDER_NAV_DEEP_DIVES } from "@/lib/nav-items";

export default function FounderAllToolsPage() {
  useDocumentTitle("All tools — Founder");
  const groups = founderDeepDivesGrouped();

  return (
    <FounderPageShell
      eyebrow="Founder · all tools"
      title="All tools"
      titleSoft={`${FOUNDER_NAV_DEEP_DIVES.length} deep-dives across ${groups.length} areas.`}
      pageTitle="All tools"
    >
      <div className="max-w-5xl mx-auto space-y-6">
        <p className="text-sm text-muted-foreground">
          Every founder surface beyond the five primary doors, grouped by
          area. The doors stay clean for the daily driver; this is where the
          rest lives. You can also reach any of these from the command palette
          (&#8984;K) or by asking Solene.
        </p>

        <motion.div
          variants={staggerContainer}
          initial="hidden"
          animate="show"
          className="space-y-6"
        >
          {groups.map((group) => (
            <motion.div key={group.category} variants={staggerItem}>
              <Card className="border-border/40 bg-card shadow-sm">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-semibold text-muted-foreground tracking-widest uppercase">
                    {group.label}
                    <span className="ml-2 tabular-nums font-normal normal-case tracking-normal text-xs">
                      {group.items.length}
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul
                    className="grid grid-cols-1 sm:grid-cols-2 gap-2"
                    aria-label={`${group.label} tools`}
                  >
                    {group.items.map((tool) => {
                      const Icon = tool.icon;
                      return (
                        <li key={tool.href}>
                          <Link
                            href={tool.href}
                            aria-label={tool.label}
                            className="flex items-center gap-3 rounded-xl px-3 py-2.5 min-h-[44px] hover:bg-muted transition-colors group focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                          >
                            <Icon
                              className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors shrink-0"
                              aria-hidden="true"
                            />
                            <span className="text-sm font-medium text-foreground group-hover:text-primary transition-colors truncate">
                              {tool.label}
                            </span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </FounderPageShell>
  );
}
