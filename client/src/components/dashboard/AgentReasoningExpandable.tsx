/**
 * AgentReasoningExpandable — Lens 46 trust-loop legibility for the founder.
 *
 * Expandable surface on a DecisionsInbox item that hits
 * /api/founder/intelligence/audit-log/explain-by-decision/:decisionId and
 * renders the joined record: the action_log row, the LLM trace, the
 * upstream observation, and the alternatives the model weighed.
 *
 * Hidden by default — the inbox card stays scannable. Tom expands when
 * he wants to spot-check the call.
 */

import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { Brain, ChevronDown, ChevronUp, RotateCcw } from "lucide-react";
import { useState } from "react";

interface ActionExplanation {
  action: {
    id: number;
    agentCodename: string;
    actionName: string;
    actionType: string;
    outcome: string;
    reasoning: string | null;
    confidence: number | null;
    durationMs: number | null;
    createdAt: string | null;
  };
  inputs: Record<string, unknown> | null;
  output: Record<string, unknown> | null;
  alternativesConsidered:
    | Array<{ action: string; rejectedBecause: string; confidence?: number }>
    | null;
  tiersTried: Array<"haiku" | "sonnet" | "opus"> | null;
  modelUsed: string | null;
  llmTrace: {
    id: number;
    purpose: string;
    model: string;
    systemPrompt: string | null;
    userPrompt: string;
    response: string;
    latencyMs: number | null;
    inputTokens: number | null;
    outputTokens: number | null;
    costCents: number | null;
    error: string | null;
  } | null;
  inboxItem: {
    id: number;
    itemType: string;
    sophieAnalysis: string;
    sophieConfidenceScore: number | null;
    recommendedAction: string;
    urgencyScore: number;
    riskLevel: string;
    estimatedImpactCents: number | null;
  } | null;
  triggerObservation: {
    id: number;
    type: string;
    title: string;
    description: string;
    severity: string;
    detectedAt: string | null;
  } | null;
  failureMode: {
    outcome: "success" | "failure" | "escalated" | "pending";
    error: string | null;
  };
  reversal: {
    available: boolean;
    note: string;
  };
}

interface Props {
  decisionId: number;
}

export function AgentReasoningExpandable({ decisionId }: Props) {
  const [expanded, setExpanded] = useState(false);

  const { data, isLoading, isError } = useQuery<{
    explanation: ActionExplanation | null;
    message?: string;
  }>({
    queryKey: [
      "/api/founder/intelligence/audit-log/explain-by-decision",
      decisionId,
    ],
    queryFn: async () => {
      const r = await fetch(
        `/api/founder/intelligence/audit-log/explain-by-decision/${decisionId}`,
        { credentials: "include" },
      );
      if (!r.ok) throw new Error("Failed to load reasoning");
      return r.json();
    },
    enabled: expanded,
    staleTime: 60_000,
  });

  return (
    <div className="border-t border-border/50 pt-2 mt-2 text-xs">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
        aria-expanded={expanded}
        aria-label={expanded ? "Hide agent reasoning" : "Show agent reasoning"}
      >
        <Brain className="h-3 w-3" aria-hidden="true" />
        Agent reasoning
        {expanded ? (
          <ChevronUp className="h-3 w-3" aria-hidden="true" />
        ) : (
          <ChevronDown className="h-3 w-3" aria-hidden="true" />
        )}
      </button>

      {expanded && (
        <div className="mt-2 space-y-2.5">
          {isLoading && (
            <div className="space-y-1.5">
              <Skeleton className="h-3 w-40" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-5/6" />
            </div>
          )}

          {isError && (
            <p className="text-muted-foreground" role="alert">
              Couldn't load the agent reasoning.
            </p>
          )}

          {data && !data.explanation && (
            <p className="text-muted-foreground italic">
              {data.message ??
                "No agent action has resolved this decision yet."}
            </p>
          )}

          {data?.explanation && (
            <>
              {/* Headline row — agent, action, outcome */}
              <div className="flex items-center gap-2 flex-wrap text-muted-foreground">
                <span className="font-medium text-foreground">
                  {data.explanation.action.agentCodename}
                </span>
                <span aria-hidden="true">·</span>
                <span>{data.explanation.action.actionName}</span>
                <span aria-hidden="true">·</span>
                <span
                  className={
                    data.explanation.action.outcome === "success"
                      ? "text-acr-pos"
                      : data.explanation.action.outcome === "failure"
                        ? "text-acr-neg"
                        : "text-acr-warn"
                  }
                >
                  {data.explanation.action.outcome}
                </span>
                {data.explanation.action.confidence != null && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="tabular-nums">
                      {data.explanation.action.confidence}% confident
                    </span>
                  </>
                )}
              </div>

              {/* Model trail */}
              {(data.explanation.tiersTried?.length ||
                data.explanation.modelUsed) && (
                <div className="text-muted-foreground">
                  Model tier:{" "}
                  {data.explanation.tiersTried?.length ? (
                    <span className="font-mono">
                      {data.explanation.tiersTried.join(" → ")}
                    </span>
                  ) : (
                    <span className="font-mono">
                      {data.explanation.modelUsed}
                    </span>
                  )}
                </div>
              )}

              {/* Stated reasoning */}
              {data.explanation.action.reasoning && (
                <div>
                  <p className="font-medium text-foreground mb-0.5">Reasoning</p>
                  <p className="text-foreground leading-snug">
                    {data.explanation.action.reasoning}
                  </p>
                </div>
              )}

              {/* Alternatives weighed */}
              {data.explanation.alternativesConsidered &&
                data.explanation.alternativesConsidered.length > 0 && (
                  <div>
                    <p className="font-medium text-foreground mb-0.5">
                      Alternatives considered
                    </p>
                    <ul className="space-y-0.5 list-none p-0 m-0">
                      {data.explanation.alternativesConsidered.map((alt, i) => (
                        <li key={i} className="text-muted-foreground">
                          <span className="font-medium text-foreground">
                            {alt.action}
                          </span>
                          {" — "}
                          {alt.rejectedBecause}
                          {alt.confidence != null && (
                            <span className="tabular-nums ml-1 text-micro">
                              ({alt.confidence}%)
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

              {/* Trigger observation */}
              {data.explanation.triggerObservation && (
                <div>
                  <p className="font-medium text-foreground mb-0.5">
                    Triggered by observation
                  </p>
                  <p className="text-muted-foreground">
                    <span className="font-medium text-foreground">
                      {data.explanation.triggerObservation.title}
                    </span>
                    {" — "}
                    {data.explanation.triggerObservation.description}
                  </p>
                </div>
              )}

              {/* Failure detail */}
              {data.explanation.failureMode.outcome === "failure" &&
                data.explanation.failureMode.error && (
                  <div className="rounded-md bg-acr-neg-soft/30 px-2 py-1.5">
                    <p className="font-medium text-acr-neg mb-0.5">
                      Failure detail
                    </p>
                    <p className="text-foreground leading-snug">
                      {data.explanation.failureMode.error}
                    </p>
                  </div>
                )}

              {/* Reversal path */}
              <div className="flex items-start gap-1.5 text-muted-foreground">
                <RotateCcw
                  className="h-3 w-3 flex-shrink-0 mt-0.5"
                  aria-hidden="true"
                />
                <p>{data.explanation.reversal.note}</p>
              </div>

              {/* LLM trace (collapsed by default) */}
              {data.explanation.llmTrace && (
                <details className="text-muted-foreground">
                  <summary className="cursor-pointer hover:text-foreground">
                    LLM trace ({data.explanation.llmTrace.model})
                    {data.explanation.llmTrace.latencyMs != null && (
                      <span className="tabular-nums ml-1">
                        · {data.explanation.llmTrace.latencyMs}ms
                      </span>
                    )}
                    {data.explanation.llmTrace.costCents != null && (
                      <span className="tabular-nums ml-1">
                        · ${(data.explanation.llmTrace.costCents / 100).toFixed(4)}
                      </span>
                    )}
                  </summary>
                  <div className="mt-1 space-y-1.5">
                    {data.explanation.llmTrace.systemPrompt && (
                      <div>
                        <p className="font-medium text-foreground text-micro">
                          System
                        </p>
                        <pre className="bg-muted/50 rounded p-1.5 overflow-auto max-h-24 text-micro">
                          {data.explanation.llmTrace.systemPrompt}
                        </pre>
                      </div>
                    )}
                    <div>
                      <p className="font-medium text-foreground text-micro">
                        Prompt
                      </p>
                      <pre className="bg-muted/50 rounded p-1.5 overflow-auto max-h-24 text-micro">
                        {data.explanation.llmTrace.userPrompt}
                      </pre>
                    </div>
                    <div>
                      <p className="font-medium text-foreground text-micro">
                        Response
                      </p>
                      <pre className="bg-muted/50 rounded p-1.5 overflow-auto max-h-24 text-micro">
                        {data.explanation.llmTrace.response}
                      </pre>
                    </div>
                  </div>
                </details>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
