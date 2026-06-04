/**
 * ApprovalPrompt — inline panel that appears when the turn runner pauses
 * for founder approval of a sensitive tool call.
 *
 * Shows the tool name + JSON input + Approve / Reject buttons. Disappears
 * after a decision is sent.
 */
import React, { useState } from "react";
import { Shield, Check, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PendingApproval } from "@/hooks/useSoleneChat";

interface ApprovalPromptProps {
  approval: PendingApproval;
  onResolve: (token: string, decision: "approve" | "reject") => Promise<void>;
}

export function ApprovalPrompt({ approval, onResolve }: ApprovalPromptProps) {
  const [submitting, setSubmitting] = useState<"approve" | "reject" | null>(
    null,
  );

  const handleClick = async (decision: "approve" | "reject") => {
    if (submitting) return;
    setSubmitting(decision);
    try {
      await onResolve(approval.token, decision);
    } finally {
      setSubmitting(null);
    }
  };

  const inputJson = (() => {
    try {
      return JSON.stringify(approval.toolInput, null, 2);
    } catch {
      return "[unserializable]";
    }
  })();

  return (
    <div
      role="alertdialog"
      aria-labelledby="approval-prompt-title"
      className="mx-3 md:mx-4 my-3 rounded-lg border border-amber-500/40 bg-amber-50/40 dark:bg-amber-950/20 p-4"
      data-testid="approval-prompt"
    >
      <div className="flex items-start gap-3">
        <Shield className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" aria-hidden="true" />
        <div className="min-w-0 flex-1 space-y-2">
          <h3
            id="approval-prompt-title"
            className="text-sm font-semibold text-foreground"
          >
            Approval requested
          </h3>
          <p className="text-xs text-muted-foreground">
            Solene wants to call{" "}
            <code className="font-mono text-foreground bg-muted px-1 py-0.5 rounded">
              {approval.toolName}
            </code>
            . Review the input and approve or reject.
          </p>
          <pre className="text-xs overflow-x-auto font-mono text-muted-foreground bg-background/60 border border-border rounded p-2 max-h-40">
            <code>{inputJson}</code>
          </pre>
          <div className="flex items-center gap-2 pt-1">
            <Button
              type="button"
              size="sm"
              onClick={() => handleClick("approve")}
              disabled={submitting !== null}
              aria-label="Approve tool call"
              data-testid="button-approve-tool"
            >
              {submitting === "approve" ? (
                <Loader2 className="h-3 w-3 mr-1.5 animate-spin" aria-hidden="true" />
              ) : (
                <Check className="h-3 w-3 mr-1.5" aria-hidden="true" />
              )}
              Approve
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => handleClick("reject")}
              disabled={submitting !== null}
              aria-label="Reject tool call"
              data-testid="button-reject-tool"
            >
              {submitting === "reject" ? (
                <Loader2 className="h-3 w-3 mr-1.5 animate-spin" aria-hidden="true" />
              ) : (
                <X className="h-3 w-3 mr-1.5" aria-hidden="true" />
              )}
              Reject
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
