import { useState } from "react";
import { motion } from "framer-motion";
import {
  RefreshCw,
  AlertTriangle,
  Clock,
  Database,
  ChevronDown,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataProvenanceChip } from "@/components/data-provenance-chip";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { staggerContainer, staggerItem } from "@/lib/animations";

interface SourceAttributionPanelProps {
  propertyId: number;
  fields: Array<{
    label: string;
    value: string | number | null;
    source: string;
    fetchedAt: string;
    category: "real-time" | "annual";
  }>;
  onRefreshAll?: () => void;
  onRefreshField?: (label: string) => void;
  isRefreshing?: boolean;
}

function getRelativeTime(isoDate: string): string {
  const now = new Date();
  const date = new Date(isoDate);
  const diffMs = now.getTime() - date.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);
  const diffMonths = Math.floor(diffDays / 30);
  const diffYears = Math.floor(diffDays / 365);

  if (diffSeconds < 60) return "just now";
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 30) return `${diffDays}d ago`;
  if (diffMonths < 12) return `${diffMonths}mo ago`;
  return `${diffYears}y ago`;
}

function getDaysSince(isoDate: string): number {
  const now = new Date();
  const date = new Date(isoDate);
  return Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
}

type StalenessLevel = "fresh" | "amber" | "red";

function getStalenessLevel(
  fetchedAt: string,
  category: "real-time" | "annual"
): StalenessLevel {
  const days = getDaysSince(fetchedAt);

  if (category === "real-time" && days > 30) return "amber";
  if (category === "annual" && days > 400) return "red";

  return "fresh";
}

function StalenessIndicator({
  level,
  category,
}: {
  level: StalenessLevel;
  category: "real-time" | "annual";
}) {
  if (level === "fresh") return null;

  const isAmber = level === "amber";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs font-medium",
        isAmber ? "text-acr-warn dark:text-acr-warn" : "text-acr-neg dark:text-acr-neg"
      )}
      title={
        isAmber
          ? "Real-time data is over 30 days old"
          : "Annual data is over 400 days old"
      }
    >
      <AlertTriangle className="h-3 w-3" />
      {isAmber ? "Stale" : "Outdated"}
    </span>
  );
}

export function SourceAttributionPanel({
  propertyId,
  fields,
  onRefreshAll,
  onRefreshField,
  isRefreshing = false,
}: SourceAttributionPanelProps) {
  const [isOpen, setIsOpen] = useState(false);

  const staleCount = fields.filter(
    (f) => getStalenessLevel(f.fetchedAt, f.category) !== "fresh"
  ).length;

  return (
    <Card className="w-full">
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CollapsibleTrigger className="flex items-center gap-2 hover:opacity-80 transition-opacity">
              <Database className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-sm font-semibold">
                Data Provenance
              </CardTitle>
              {staleCount > 0 && (
                <Badge
                  variant="destructive"
                  className="ml-1 px-1.5 py-0 text-micro"
                >
                  {staleCount} stale
                </Badge>
              )}
              <ChevronDown
                className={cn(
                  "h-4 w-4 text-muted-foreground transition-transform duration-200",
                  isOpen && "rotate-180"
                )}
              />
            </CollapsibleTrigger>

            {onRefreshAll && (
              <Button
                variant="outline"
                size="sm"
                onClick={onRefreshAll}
                disabled={isRefreshing}
                className="h-7 text-xs gap-1.5"
              >
                <RefreshCw
                  className={cn(
                    "h-3 w-3",
                    isRefreshing && "animate-spin"
                  )}
                />
                Refresh All
              </Button>
            )}
          </div>
        </CardHeader>

        <CollapsibleContent>
          <CardContent className="pt-0">
            <motion.div
              className="divide-y divide-border rounded-md border"
              variants={staggerContainer}
              initial="hidden"
              animate="visible"
            >
              {fields.map((field) => {
                const staleness = getStalenessLevel(
                  field.fetchedAt,
                  field.category
                );

                return (
                  <motion.div
                    key={field.label}
                    variants={staggerItem}
                    className={cn(
                      "flex items-center justify-between gap-4 px-3 py-2.5",
                      staleness === "amber" &&
                        "bg-acr-warn-soft/50 dark:bg-acr-warn-soft/20",
                      staleness === "red" &&
                        "bg-acr-neg-soft/50 dark:bg-acr-neg-soft/20"
                    )}
                  >
                    <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium truncate">
                          {field.label}
                        </span>
                        <StalenessIndicator
                          level={staleness}
                          category={field.category}
                        />
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span className="truncate font-mono">
                          {field.value !== null && field.value !== undefined
                            ? String(field.value)
                            : "N/A"}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                      <div className="flex flex-col items-end gap-0.5">
                        {/* Canonical source attribution. No sourceAsOf: this
                            panel only knows fetchedAt (when WE fetched), and
                            the chip's sourceAsOf is when the SOURCE last
                            updated — do not pass fetch time as source time. */}
                        <DataProvenanceChip source={field.source} />
                        <span className="flex items-center gap-1 text-micro text-muted-foreground">
                          <Clock className="h-2.5 w-2.5" />
                          {getRelativeTime(field.fetchedAt)}
                        </span>
                      </div>

                      {onRefreshField && (
                        <Button aria-label="Refresh"
                          variant="ghost"
                          size="sm"
                          onClick={() => onRefreshField(field.label)}
                          disabled={isRefreshing}
                          className="h-6 w-6 p-0"
                          title={`Refresh ${field.label}`}
                        >
                          <RefreshCw
                            className={cn(
                              "h-3 w-3",
                              isRefreshing && "animate-spin"
                            )}
                          />
                        </Button>
                      )}
                    </div>
                  </motion.div>
                );
              })}
            </motion.div>

            <p className="mt-2 text-micro text-muted-foreground">
              Showing {fields.length} tracked field{fields.length !== 1 && "s"}{" "}
              for property #{propertyId}
            </p>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
