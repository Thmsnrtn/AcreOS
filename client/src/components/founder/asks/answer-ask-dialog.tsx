/**
 * Answer drawer for /founder/asks. Renders a form whose shape depends on the
 * ask's `answer_format` (free_text / multi_choice / yes_no / numeric).
 *
 * Extracted verbatim from client/src/pages/founder/asks.tsx (W3-5
 * decomposition) — behavior unchanged.
 */

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { getErrorMessage, getErrorTitle } from "@/lib/error-utils";
import { URGENCY_TONE, agentClass, type FounderAsk } from "./ask-shared";

interface AnswerAskDialogProps {
  ask: FounderAsk | null;
  onClose: () => void;
  onSubmitted: () => void;
}

export function AnswerAskDialog({ ask, onClose, onSubmitted }: AnswerAskDialogProps) {
  const { toast } = useToast();
  const [answerText, setAnswerText] = useState("");
  const [chosenOptionId, setChosenOptionId] = useState<string>("");

  // Reset state whenever the ask changes.
  // Using inline useState resets requires effect; do it via a key prop on
  // the form below.

  const mutation = useMutation({
    mutationFn: async (input: {
      askId: number;
      answerText?: string;
      chosenOptionId?: string;
    }) => {
      const res = await apiRequest(
        "POST",
        `/api/founder/asks/${input.askId}/answer`,
        {
          answerText: input.answerText,
          chosenOptionId: input.chosenOptionId,
        },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          message?: string;
        };
        throw new Error(body.message || `Answer failed (${res.status})`);
      }
      return res.json();
    },
    onSuccess: (_data, vars) => {
      toast({ title: `Ask #${vars.askId} answered` });
      onSubmitted();
    },
    onError: (error) => {
      toast({
        title: getErrorTitle(error),
        description: getErrorMessage(error),
        variant: "destructive",
      });
    },
  });

  if (!ask) return null;

  const submit = () => {
    if (ask.answerFormat === "multi_choice") {
      if (!chosenOptionId) {
        toast({
          title: "Choose an option",
          description: "Please select one of the offered options.",
          variant: "destructive",
        });
        return;
      }
      mutation.mutate({ askId: ask.id, chosenOptionId });
      return;
    }
    if (ask.answerFormat === "yes_no") {
      // Submitted via the dedicated Yes/No buttons below.
      // This codepath is only hit if the user pressed an explicit Submit
      // before clicking yes/no — guard against empty text.
      if (!answerText) {
        toast({
          title: "Choose yes or no",
          variant: "destructive",
        });
        return;
      }
      mutation.mutate({ askId: ask.id, answerText });
      return;
    }
    if (ask.answerFormat === "numeric") {
      const trimmed = answerText.trim();
      if (!trimmed || !Number.isFinite(Number(trimmed))) {
        toast({
          title: "Enter a number",
          description: "The numeric answer must parse as a number.",
          variant: "destructive",
        });
        return;
      }
      mutation.mutate({ askId: ask.id, answerText: trimmed });
      return;
    }
    // free_text
    if (!answerText.trim()) {
      toast({
        title: "Answer cannot be empty",
        variant: "destructive",
      });
      return;
    }
    mutation.mutate({ askId: ask.id, answerText: answerText.trim() });
  };

  return (
    <Dialog
      open={ask !== null}
      onOpenChange={(o) => {
        if (!o) {
          setAnswerText("");
          setChosenOptionId("");
          onClose();
        }
      }}
    >
      <DialogContent
        className="max-w-2xl"
        aria-labelledby={`answer-ask-${ask.id}-title`}
        aria-describedby={`answer-ask-${ask.id}-desc`}
        data-testid={`dialog-answer-${ask.id}`}
      >
        <DialogHeader>
          <DialogTitle
            id={`answer-ask-${ask.id}-title`}
            className="flex items-center gap-2"
          >
            <Badge
              variant="outline"
              className={`text-micro font-mono ${agentClass(ask.askingAgentRole)}`}
            >
              {ask.askingAgentRole}
            </Badge>
            <span>asks</span>
            <Badge variant={URGENCY_TONE[ask.urgency]} className="text-micro">
              {ask.urgency}
            </Badge>
          </DialogTitle>
          <DialogDescription
            id={`answer-ask-${ask.id}-desc`}
            className="font-medium text-foreground"
          >
            {ask.questionSummary}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Full body — rendered as markdown-friendly preformatted text.
              We don't render full markdown here to keep the surface secure
              and dependency-light; pre-wrap handles line breaks + lists. */}
          <div>
            <div className="uppercase tracking-wide text-muted-foreground text-xs mb-1">
              Context
            </div>
            <pre className="text-xs font-mono bg-muted/40 rounded p-3 max-h-64 overflow-auto whitespace-pre-wrap">
              {ask.questionBody}
            </pre>
          </div>

          {/* Form, switched on answer_format */}
          {ask.answerFormat === "free_text" && (
            <div className="space-y-1">
              <Label htmlFor={`answer-text-${ask.id}`}>Your answer</Label>
              <Textarea
                id={`answer-text-${ask.id}`}
                value={answerText}
                onChange={(e) => setAnswerText(e.target.value)}
                rows={5}
                placeholder="Type your answer…"
                data-testid={`textarea-answer-${ask.id}`}
              />
              <div className="text-micro text-muted-foreground text-right">
                {answerText.length} character{answerText.length === 1 ? "" : "s"}
              </div>
            </div>
          )}

          {ask.answerFormat === "multi_choice" && (ask.options ?? []).length > 0 && (
            <div className="space-y-2">
              <Label>Choose one</Label>
              <RadioGroup
                value={chosenOptionId}
                onValueChange={setChosenOptionId}
                aria-label="Answer options"
                data-testid={`radio-options-${ask.id}`}
              >
                {(ask.options ?? []).map((o) => (
                  <div key={o.id} className="flex items-start gap-2">
                    <RadioGroupItem
                      value={o.id}
                      id={`opt-${ask.id}-${o.id}`}
                      data-testid={`radio-option-${o.id}`}
                    />
                    <Label
                      htmlFor={`opt-${ask.id}-${o.id}`}
                      className="font-normal cursor-pointer leading-snug"
                    >
                      <div className="font-medium">{o.label}</div>
                      {o.description && (
                        <div className="text-xs text-muted-foreground">
                          {o.description}
                        </div>
                      )}
                    </Label>
                  </div>
                ))}
              </RadioGroup>
            </div>
          )}

          {ask.answerFormat === "yes_no" && (
            <div className="space-y-1">
              <Label>Your answer</Label>
              <div className="flex gap-2">
                <Button
                  variant={answerText === "yes" ? "default" : "outline"}
                  onClick={() => setAnswerText("yes")}
                  data-testid={`button-yes-${ask.id}`}
                  aria-label="Answer yes"
                  aria-pressed={answerText === "yes"}
                >
                  Yes
                </Button>
                <Button
                  variant={answerText === "no" ? "default" : "outline"}
                  onClick={() => setAnswerText("no")}
                  data-testid={`button-no-${ask.id}`}
                  aria-label="Answer no"
                  aria-pressed={answerText === "no"}
                >
                  No
                </Button>
              </div>
            </div>
          )}

          {ask.answerFormat === "numeric" && (
            <div className="space-y-1">
              <Label htmlFor={`answer-num-${ask.id}`}>Your answer (number)</Label>
              <Input
                id={`answer-num-${ask.id}`}
                type="number"
                inputMode="decimal"
                value={answerText}
                onChange={(e) => setAnswerText(e.target.value)}
                placeholder="e.g. 1500"
                data-testid={`input-numeric-${ask.id}`}
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => {
              setAnswerText("");
              setChosenOptionId("");
              onClose();
            }}
            data-testid="button-answer-cancel"
            aria-label="Cancel answering"
          >
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={mutation.isPending}
            data-testid={`button-answer-submit-${ask.id}`}
            aria-label="Submit answer"
          >
            {mutation.isPending ? "Submitting…" : "Submit answer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
