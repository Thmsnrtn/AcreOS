/**
 * Expandable row for the "Recent terminal asks" table on /founder/asks.
 * Extracted verbatim from client/src/pages/founder/asks.tsx (W3-5
 * decomposition) — behavior unchanged.
 */

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { formatRelative } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  STATUS_TONE,
  agentClass,
  truncate,
  type FounderAsk,
} from "./ask-shared";

export function TerminalAskRow({ ask: a }: { ask: FounderAsk }) {
  const [open, setOpen] = useState(false);
  const tone = STATUS_TONE[a.status];
  const resolvedAt = a.answeredAt ?? a.timeoutAt ?? null;

  const chosenLabel = useMemo(() => {
    if (!a.answerChosenOptionId) return null;
    const opt = (a.options ?? []).find((o) => o.id === a.answerChosenOptionId);
    return opt?.label ?? a.answerChosenOptionId;
  }, [a]);

  const answerSummary =
    a.status === "answered"
      ? chosenLabel ?? a.answerText ?? "—"
      : a.status === "timed_out"
      ? "no answer recorded"
      : a.status === "superseded"
      ? (a.answerText ?? "marked no-longer-relevant")
      : "—";

  return (
    <>
      <tr
        className="border-b border-border/40 cursor-pointer hover:bg-muted/30"
        onClick={() => setOpen((v) => !v)}
        data-testid={`row-terminal-${a.id}`}
      >
        <td className="px-3 py-2 align-top">
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6"
            aria-label={open ? `Collapse ask ${a.id}` : `Expand ask ${a.id}`}
            aria-expanded={open}
            onClick={(e) => {
              e.stopPropagation();
              setOpen((v) => !v);
            }}
          >
            {open ? (
              <ChevronDown className="w-3 h-3" aria-hidden="true" />
            ) : (
              <ChevronRight className="w-3 h-3" aria-hidden="true" />
            )}
          </Button>
        </td>
        <td className="px-3 py-2 align-top">
          <Badge
            variant="outline"
            className={`text-micro font-mono ${agentClass(a.askingAgentRole)}`}
          >
            {a.askingAgentRole}
          </Badge>
        </td>
        <td
          className="px-3 py-2 max-w-md align-top"
          title={a.questionSummary}
        >
          {truncate(a.questionSummary, 80)}
        </td>
        <td className="px-3 py-2 align-top">
          <Badge variant={tone} className="text-micro">
            {a.status}
          </Badge>
        </td>
        <td className="px-3 py-2 text-muted-foreground align-top">
          {formatRelative(resolvedAt)}
        </td>
        <td
          className="px-3 py-2 max-w-md text-foreground/80 align-top"
          title={answerSummary}
        >
          {truncate(answerSummary, 80)}
        </td>
      </tr>
      {open && (
        <tr className="bg-muted/20" data-testid={`row-terminal-expanded-${a.id}`}>
          <td />
          <td colSpan={5} className="px-3 py-3 space-y-3">
            <div>
              <div className="uppercase tracking-wide text-muted-foreground text-xs mb-1">
                Question
              </div>
              <pre className="text-xs font-mono bg-muted/40 rounded p-2 max-h-64 overflow-auto whitespace-pre-wrap">
                {a.questionBody}
              </pre>
            </div>

            {a.options && a.options.length > 0 && (
              <div>
                <div className="uppercase tracking-wide text-muted-foreground text-xs mb-1">
                  Options offered
                </div>
                <ul className="text-xs space-y-1">
                  {a.options.map((o) => (
                    <li
                      key={o.id}
                      className={
                        o.id === a.answerChosenOptionId
                          ? "font-semibold text-acr-pos"
                          : "text-muted-foreground"
                      }
                    >
                      • {o.label}
                      {o.description ? (
                        <span className="text-muted-foreground/80">
                          {" "}
                          — {o.description}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {a.answerText && (
              <div>
                <div className="uppercase tracking-wide text-muted-foreground text-xs mb-1">
                  {a.status === "superseded" ? "Supersede reason" : "Your answer"}
                </div>
                <pre className="text-xs font-mono bg-muted/40 rounded p-2 max-h-64 overflow-auto whitespace-pre-wrap">
                  {a.answerText}
                </pre>
              </div>
            )}

            <div className="grid sm:grid-cols-2 gap-3 text-xs">
              <div>
                <div className="uppercase tracking-wide text-muted-foreground mb-1">
                  Asked / Resolved
                </div>
                <div className="text-muted-foreground">
                  {formatRelative(a.askedAt)} · {formatRelative(resolvedAt)}
                </div>
              </div>
              <div>
                <div className="uppercase tracking-wide text-muted-foreground mb-1">
                  Answer format · Urgency
                </div>
                <div className="font-mono text-muted-foreground">
                  {a.answerFormat} · {a.urgency}
                </div>
              </div>
              {a.askingDispatchId != null && (
                <div>
                  <div className="uppercase tracking-wide text-muted-foreground mb-1">
                    Dispatch
                  </div>
                  <div className="font-mono">#{a.askingDispatchId}</div>
                </div>
              )}
              {a.pagerEventId != null && (
                <div>
                  <div className="uppercase tracking-wide text-muted-foreground mb-1">
                    Pager event
                  </div>
                  <div className="font-mono">#{a.pagerEventId}</div>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
