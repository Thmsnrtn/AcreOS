import { Pencil, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface PaxEditDiffProps {
  toolName: string;
  entityLabel: string;
  before: Record<string, any>;
  after: Record<string, any>;
}

function humanizeKey(key: string): string {
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/_/g, " ")
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ")
    .trim();
}

function displayValue(value: any): string {
  if (value === null || value === undefined) return "—";
  return String(value);
}

export function PaxEditDiff({ entityLabel, before, after }: PaxEditDiffProps) {
  const changedKeys = Object.keys(after).filter(
    (k) => displayValue(after[k]) !== displayValue(before[k])
  );

  return (
    <div className="rounded-md border bg-green-500/5 border-green-500/30 text-xs overflow-hidden my-1">
      {/* Header */}
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 border-b border-green-500/20">
        <Pencil className="w-3 h-3 text-green-600 dark:text-green-400 flex-shrink-0" />
        <span className="font-medium text-foreground flex-1 truncate">
          Pax edited {entityLabel}
        </span>
        <span className="inline-flex items-center gap-1 text-[10px] text-green-600 dark:text-green-400 font-medium">
          <CheckCircle2 className="w-2.5 h-2.5" />
          Applied
        </span>
      </div>

      {/* Diff body */}
      <div className="px-2.5 py-1.5 space-y-1">
        {changedKeys.length === 0 ? (
          <p className="text-muted-foreground text-[10px]">No changes detected</p>
        ) : (
          changedKeys.map((key) => (
            <div key={key} className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[10px] text-muted-foreground w-16 shrink-0">
                {humanizeKey(key)}
              </span>
              {before[key] !== undefined && before[key] !== null && (
                <span className={cn(
                  "text-[11px] line-through text-red-500 dark:text-red-400 bg-red-500/10 px-1 rounded"
                )}>
                  {displayValue(before[key])}
                </span>
              )}
              <span className="text-[10px] text-muted-foreground">→</span>
              <span className="text-[11px] text-green-600 dark:text-green-400 bg-green-500/10 px-1 rounded font-medium">
                {displayValue(after[key])}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
