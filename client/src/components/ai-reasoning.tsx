/**
 * AI Reasoning Transparency — shows users why AI made a decision.
 * Collapsible by default, expands to show inputs and reasoning.
 */

import { useState } from "react";
import { ChevronDown, Brain } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { motion, AnimatePresence } from "framer-motion";
import { collapsibleContent } from "@/lib/animations";

interface AIReasoningProps {
  feature: string;
  decision: string;
  reasoning: string;
  confidence: number;
  inputs?: Record<string, any>;
  className?: string;
}

export function AIReasoning({ feature, decision, reasoning, confidence, inputs, className }: AIReasoningProps) {
  const [expanded, setExpanded] = useState(false);

  const confidenceColor = confidence >= 80 ? "text-acr-pos" : confidence >= 60 ? "text-acr-warn" : "text-acr-neg";

  return (
    <div className={cn("border rounded-card overflow-hidden", className)}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted/50 transition-colors"
        aria-expanded={expanded}
        aria-label={`AI reasoning for ${feature}`}
      >
        <Brain className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="text-xs text-muted-foreground flex-1">
          Why this {feature.replace(/_/g, " ")}?
        </span>
        <Badge variant="outline" className={cn("text-micro", confidenceColor)}>
          {confidence}% confident
        </Badge>
        <ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform", expanded && "rotate-180")} />
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            variants={collapsibleContent}
            initial="hidden"
            animate="visible"
            exit="hidden"
            className="px-3 pb-3 space-y-2 border-t"
          >
            <div className="pt-2">
              <p className="text-xs font-medium">{decision}</p>
              <p className="text-xs text-muted-foreground mt-1">{reasoning}</p>
            </div>

            {inputs && Object.keys(inputs).length > 0 && (
              <div className="space-y-1">
                <p className="text-micro font-medium text-muted-foreground uppercase tracking-wider">Inputs</p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
                  {Object.entries(inputs).slice(0, 8).map(([key, value]) => (
                    <div key={key} className="text-xs flex justify-between">
                      <span className="text-muted-foreground">{key.replace(/([A-Z])/g, " $1").trim()}:</span>
                      <span className="font-medium">{typeof value === "number" ? value.toLocaleString() : String(value)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <p className="text-micro text-muted-foreground">
              AcreOS AI is advisory — always verify with independent analysis.
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
