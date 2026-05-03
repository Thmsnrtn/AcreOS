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
    <div className="rounded-md border bg-acr-pos/5 border-acr-pos/30 text-xs overflow-hidden my-1">
      {/* Header */}
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 border-b border-acr-pos/20">
        <Pencil className="w-3 h-3 text-acr-pos dark:text-acr-pos flex-shrink-0" />
        <span className="font-medium text-foreground flex-1 truncate">
          Pax edited {entityLabel}
        </span>
        <span className="inline-flex items-center gap-1 text-[10px] text-acr-pos dark:text-acr-pos font-medium">
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
                  "text-[11px] line-through text-acr-neg dark:text-acr-neg bg-acr-neg/10 px-1 rounded"
                )}>
                  {displayValue(before[key])}
                </span>
              )}
              <span className="text-[10px] text-muted-foreground">→</span>
              <span className="text-[11px] text-acr-pos dark:text-acr-pos bg-acr-pos/10 px-1 rounded font-medium">
                {displayValue(after[key])}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
