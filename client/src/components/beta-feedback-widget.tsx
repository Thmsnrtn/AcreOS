import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { MessageSquare, X, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";

export function BetaFeedbackWidget() {
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [location] = useLocation();
  const { toast } = useToast();

  const submitMutation = useMutation({
    mutationFn: async (text: string) => {
      const res = await apiRequest("POST", "/api/feedback", { page: location, feedback: text });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Thanks for your feedback!" });
      setFeedback("");
      setOpen(false);
    },
    onError: () => {
      toast({ title: "Couldn't submit feedback", description: "Your message is preserved in the form. Try again or check the system status.", variant: "destructive" });
    },
  });

  if (dismissed) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50">
      {open ? (
        <div className="bg-card border rounded-lg shadow-lg w-80 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-medium">Send Feedback</h4>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setOpen(false)} aria-label="Close feedback">
              <X className="h-4 w-4" />
            </Button>
          </div>
          <Textarea
            placeholder="What's on your mind? Bugs, ideas, confusion — all helpful."
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            rows={3}
            className="text-sm resize-none"
          />
          <div className="flex justify-end">
            <Button
              size="sm"
              disabled={!feedback.trim() || submitMutation.isPending}
              onClick={() => submitMutation.mutate(feedback.trim())}
            >
              <Send className="h-3 w-3 mr-1" />
              {submitMutation.isPending ? "Sending..." : "Send"}
            </Button>
          </div>
        </div>
      ) : (
        <Button
          variant="outline"
          size="sm"
          className="shadow-md"
          onClick={() => setOpen(true)}
        >
          <MessageSquare className="h-4 w-4 mr-1" />
          Feedback
        </Button>
      )}
    </div>
  );
}
