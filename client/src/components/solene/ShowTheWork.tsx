/**
 * ShowTheWork — collapsed-by-default disclosure wrapping a turn's tool
 * activity (experience-legibility F3b). The transcript stays a readable
 * conversation; the tool-call log is one tap away. Expanded, it renders the
 * existing ToolUseBlock / ToolResultBlock cards unchanged.
 */
import React, { useId, useState } from "react";
import { ChevronDown, ChevronRight, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";
import { ToolUseBlock } from "./ToolUseBlock";
import { ToolResultBlock } from "./ToolResultBlock";
import type { WorkStep } from "./chatWork";

interface ShowTheWorkProps {
  steps: WorkStep[];
  /** True while the turn is still streaming — unfinished calls show "running…". */
  streaming?: boolean;
}

export function ShowTheWork({ steps, streaming }: ShowTheWorkProps) {
  const [open, setOpen] = useState(false);
  const regionId = useId();
  const n = steps.length;
  if (n === 0) return null;

  return (
    <div className="px-2 md:px-4" data-testid="show-the-work">
      <div className="max-w-[88%] md:max-w-[78%]">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={regionId}
          className="flex items-center gap-2 rounded-md px-2 py-2 min-h-[44px] text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-testid="show-the-work-toggle"
        >
          {open ? (
            <ChevronDown className="h-3 w-3 shrink-0" aria-hidden="true" />
          ) : (
            <ChevronRight className="h-3 w-3 shrink-0" aria-hidden="true" />
          )}
          <Wrench className="h-3 w-3 shrink-0" aria-hidden="true" />
          <span>
            Show the work ({n} {n === 1 ? "step" : "steps"})
          </span>
        </button>
        <div id={regionId} className={cn(open ? "block" : "hidden")}>
          {steps.map((step, i) => (
            <div key={step.toolUse?.id ?? `step-${i}`}>
              {step.toolUse ? (
                <ToolUseBlock
                  block={step.toolUse}
                  pending={Boolean(streaming) && !step.result}
                />
              ) : null}
              {step.result ? <ToolResultBlock block={step.result} /> : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
