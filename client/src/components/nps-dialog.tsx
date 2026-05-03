import React, { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useBrandName } from "@/hooks/use-white-label";

interface NpsDialogProps {
  open: boolean;
  trigger: string;
  onClose: () => void;
}

const SCORE_COLORS: Record<number, string> = {
  0: "bg-acr-neg hover:bg-acr-neg text-white",
  1: "bg-acr-neg hover:bg-acr-neg text-white",
  2: "bg-acr-warn hover:bg-acr-warn text-white",
  3: "bg-acr-warn hover:bg-acr-warn text-white",
  4: "bg-acr-warn hover:bg-acr-warn text-white",
  5: "bg-acr-warn hover:bg-acr-warn text-white",
  6: "bg-acr-warn hover:bg-acr-warn text-black",
  7: "bg-lime-400 hover:bg-lime-500 text-black",
  8: "bg-acr-pos hover:bg-acr-pos text-white",
  9: "bg-acr-pos hover:bg-acr-pos text-white",
  10: "bg-acr-pos hover:bg-acr-pos text-white",
};

export function NpsDialog({ open, trigger, onClose }: NpsDialogProps) {
  const [selectedScore, setSelectedScore] = useState<number | null>(null);
  const [feedback, setFeedback] = useState("");
  const [step, setStep] = useState<"score" | "feedback" | "thanks">("score");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const brandName = useBrandName();

  const submitMutation = useMutation({
    mutationFn: async (data: { score: number; feedback?: string; trigger: string }) => {
      await apiRequest("POST", "/api/nps", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/nps/pending"] });
      setStep("thanks");
    },
    onError: () => {
      toast({
        title: "Couldn't submit feedback",
        description: "Your score and comment are still in the form. Try again in a moment.",
        variant: "destructive",
      });
    },
  });

  const handleScoreSelect = (score: number) => {
    setSelectedScore(score);
    setStep("feedback");
  };

  const handleSubmit = () => {
    if (selectedScore === null) return;
    submitMutation.mutate({
      score: selectedScore,
      feedback: feedback.trim() || undefined,
      trigger,
    });
  };

  const handleDismiss = () => {
    // Store dismiss timestamp in localStorage so we can suppress for 7 days
    localStorage.setItem("nps_dismissed_at", new Date().toISOString());
    onClose();
  };

  const handleClose = () => {
    setSelectedScore(null);
    setFeedback("");
    setStep("score");
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) handleDismiss(); }}>
      <DialogContent className="sm:max-w-md">
        {step === "score" && (
          <>
            <DialogHeader>
              <DialogTitle id="nps-score-title">How likely are you to recommend {brandName} to a colleague?</DialogTitle>
              <DialogDescription>
                On a scale of 0 to 10, where 0 is not at all likely and 10 is extremely likely.
              </DialogDescription>
            </DialogHeader>
            <div
              role="radiogroup"
              aria-labelledby="nps-score-title"
              className="flex flex-wrap justify-center gap-2 py-4"
            >
              {Array.from({ length: 11 }, (_, i) => (
                <Button
                  key={i}
                  type="button"
                  role="radio"
                  aria-checked={selectedScore === i}
                  variant="outline"
                  size="sm"
                  className={`w-10 h-10 p-0 font-semibold text-sm ${SCORE_COLORS[i]} border-0`}
                  onClick={() => handleScoreSelect(i)}
                  aria-label={`Score ${i} out of 10`}
                >
                  {i}
                </Button>
              ))}
            </div>
            <div className="flex justify-between text-xs text-muted-foreground px-1">
              <span>Not likely</span>
              <span>Extremely likely</span>
            </div>
            <div className="flex justify-end pt-2">
              <Button variant="ghost" size="sm" onClick={handleDismiss}>
                Not now
              </Button>
            </div>
          </>
        )}

        {step === "feedback" && (
          <>
            <DialogHeader>
              <DialogTitle>
                You selected {selectedScore}/10
                {selectedScore !== null && selectedScore >= 9
                  ? " — glad to hear it!"
                  : selectedScore !== null && selectedScore >= 7
                  ? " — thanks!"
                  : " — we appreciate your honesty."}
              </DialogTitle>
              <DialogDescription>
                Any additional feedback? This is optional but helps us improve.
              </DialogDescription>
            </DialogHeader>
            <Textarea
              placeholder="What could we do better? What do you like most?"
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              className="min-h-[80px]"
              autoCapitalize="sentences"
              aria-label="Additional feedback"
            />
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="ghost" size="sm" onClick={handleSubmit}>
                Skip
              </Button>
              <Button
                type="button"
                onClick={handleSubmit}
                disabled={submitMutation.isPending}
              >
                {submitMutation.isPending ? "Submitting…" : "Submit feedback"}
              </Button>
            </div>
          </>
        )}

        {step === "thanks" && (
          <>
            <DialogHeader>
              <DialogTitle>Thank you for your feedback!</DialogTitle>
              <DialogDescription>
                Your input helps us build a better product for land investors like you.
              </DialogDescription>
            </DialogHeader>
            <div className="flex justify-end pt-4">
              <Button onClick={handleClose}>Close</Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
