/**
 * PromptDiffViewer — side-by-side line diff between the current agent
 * prompt and the meta-agent's proposed revision. Used on the Prompt
 * Evolutions review page so the founder can see exactly what changed
 * before approving.
 *
 * Line-level LCS (longest common subsequence) — good enough for prompt
 * revisions (typically O(100) lines) without pulling in a diff library.
 */

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Columns2, AlignJustify } from "lucide-react";
import { cn } from "@/lib/utils";

type Op = { kind: "same" | "del" | "add"; line: string };

function lineDiff(a: string, b: string): Op[] {
  const A = a.split("\n");
  const B = b.split("\n");
  const n = A.length;
  const m = B.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) {
      ops.push({ kind: "same", line: A[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ kind: "del", line: A[i] });
      i++;
    } else {
      ops.push({ kind: "add", line: B[j] });
      j++;
    }
  }
  while (i < n) ops.push({ kind: "del", line: A[i++] });
  while (j < m) ops.push({ kind: "add", line: B[j++] });
  return ops;
}

function Stats({ ops }: { ops: Op[] }) {
  const added = ops.filter((o) => o.kind === "add").length;
  const removed = ops.filter((o) => o.kind === "del").length;
  return (
    <div className="flex items-center gap-3 text-caption font-mono">
      <span className="text-acr-pos dark:text-acr-pos">+{added}</span>
      <span className="text-acr-neg dark:text-acr-neg">−{removed}</span>
      <span className="text-muted-foreground">lines</span>
    </div>
  );
}

export function PromptDiffViewer({
  current,
  proposed,
  defaultMode = "unified",
}: {
  current: string;
  proposed: string;
  defaultMode?: "unified" | "split";
}) {
  const [mode, setMode] = useState<"unified" | "split">(defaultMode);
  const ops = useMemo(() => lineDiff(current, proposed), [current, proposed]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Stats ops={ops} />
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant={mode === "unified" ? "secondary" : "ghost"}
            onClick={() => setMode("unified")}
            className="h-7 px-2 text-xs"
            aria-pressed={mode === "unified"}
          >
            <AlignJustify className="h-3 w-3 mr-1" />
            Unified
          </Button>
          <Button
            size="sm"
            variant={mode === "split" ? "secondary" : "ghost"}
            onClick={() => setMode("split")}
            className="h-7 px-2 text-xs"
            aria-pressed={mode === "split"}
          >
            <Columns2 className="h-3 w-3 mr-1" />
            Split
          </Button>
        </div>
      </div>

      {mode === "unified" ? (
        <pre className="rounded-md border bg-muted/30 text-[11px] font-mono leading-5 max-h-[480px] overflow-auto">
          {ops.map((op, idx) => (
            <div
              key={idx}
              className={cn(
                "px-3 whitespace-pre-wrap",
                op.kind === "add" && "bg-acr-pos/10 text-acr-pos dark:text-acr-pos",
                op.kind === "del" && "bg-acr-neg/10 text-acr-neg dark:text-acr-neg",
              )}
            >
              <span className="inline-block w-4 select-none text-muted-foreground">
                {op.kind === "add" ? "+" : op.kind === "del" ? "−" : " "}
              </span>
              {op.line || "\u00A0"}
            </div>
          ))}
        </pre>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <SplitColumn ops={ops} side="left" label="Current" />
          <SplitColumn ops={ops} side="right" label="Proposed" />
        </div>
      )}
    </div>
  );
}

function SplitColumn({ ops, side, label }: { ops: Op[]; side: "left" | "right"; label: string }) {
  return (
    <div>
      <p className="text-micro uppercase tracking-wide text-muted-foreground mb-1">{label}</p>
      <pre className="rounded-md border bg-muted/30 text-[11px] font-mono leading-5 max-h-[480px] overflow-auto">
        {ops.map((op, idx) => {
          const show =
            op.kind === "same" ||
            (side === "left" && op.kind === "del") ||
            (side === "right" && op.kind === "add");
          const isGap =
            (side === "left" && op.kind === "add") || (side === "right" && op.kind === "del");
          return (
            <div
              key={idx}
              className={cn(
                "px-3 whitespace-pre-wrap",
                side === "left" && op.kind === "del" &&
                  "bg-acr-neg/10 text-acr-neg dark:text-acr-neg",
                side === "right" && op.kind === "add" &&
                  "bg-acr-pos/10 text-acr-pos dark:text-acr-pos",
                isGap && "opacity-40",
              )}
            >
              {show ? op.line || "\u00A0" : "\u00A0"}
            </div>
          );
        })}
      </pre>
    </div>
  );
}
