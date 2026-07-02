/**
 * Support / feedback / question modal.
 *
 * Replaces the dead `thomas@acreos.io` mailto links across landing
 * surfaces (FinalCTA, Footer). Submissions land in /founder/feedback
 * for triage.
 *
 * Render anywhere with controlled state:
 *
 *   const [open, setOpen] = useState(false);
 *   <button onClick={() => setOpen(true)}>Contact us</button>
 *   <SupportFeedbackModal
 *     open={open}
 *     onOpenChange={setOpen}
 *     source="landing_footer"
 *     defaultCategory="support"
 *   />
 */

import { useState, useEffect, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  ResponsiveModal,
  ResponsiveModalContent,
  ResponsiveModalHeader,
  ResponsiveModalTitle,
  ResponsiveModalDescription,
  ResponsiveModalFooter,
} from "@/components/ui/responsive-modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Loader2, Send } from "lucide-react";

type Category = "support" | "feedback" | "question";

const CATEGORY_OPTIONS: Array<{
  value: Category;
  label: string;
  blurb: string;
}> = [
  { value: "support", label: "Support", blurb: "Something's broken or I'm stuck" },
  { value: "feedback", label: "Feedback", blurb: "An idea, suggestion, or critique" },
  { value: "question", label: "Question", blurb: "I want to know something" },
];

interface SupportFeedbackModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Label baked into the submission for funnel attribution. */
  source?: string;
  /** Initial category — useful when the trigger semantically maps to one. */
  defaultCategory?: Category;
}

export function SupportFeedbackModal({
  open,
  onOpenChange,
  source,
  defaultCategory = "support",
}: SupportFeedbackModalProps) {
  const { toast } = useToast();
  const [category, setCategory] = useState<Category>(defaultCategory);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");

  // Reset on open so each session is fresh.
  useEffect(() => {
    if (open) {
      setCategory(defaultCategory);
      setName("");
      setEmail("");
      setMessage("");
    }
  }, [open, defaultCategory]);

  // allow-no-invalidation: feedback submission — no cached query reads it
  const mutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/feedback", {
        category,
        name: name.trim() || undefined,
        email: email.trim() || undefined,
        message: message.trim(),
        source,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || "Submission failed");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "Thanks — we'll review and get back to you",
        description: email.trim()
          ? "If a reply makes sense, we'll send it to the email you provided."
          : "Anonymous submission received.",
      });
      onOpenChange(false);
    },
    onError: (err: Error) => {
      toast({
        title: "Couldn't send your message",
        description: err.message || "Try again in a moment.",
        variant: "destructive",
      });
    },
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!message.trim()) return;
    mutation.mutate();
  }

  const canSubmit = message.trim().length > 0 && !mutation.isPending;

  return (
    <ResponsiveModal open={open} onOpenChange={onOpenChange}>
      <ResponsiveModalContent
        className="sm:max-w-lg"
        data-testid="support-feedback-modal"
      >
        <ResponsiveModalHeader>
          <ResponsiveModalTitle>Get in touch</ResponsiveModalTitle>
          <ResponsiveModalDescription>
            Support, feedback, or a question — it all reaches the founder.
          </ResponsiveModalDescription>
        </ResponsiveModalHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">What's this about?</legend>
            <div
              role="radiogroup"
              aria-label="Category"
              className="grid grid-cols-1 sm:grid-cols-3 gap-2"
            >
              {CATEGORY_OPTIONS.map((opt) => {
                const selected = category === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setCategory(opt.value)}
                    className={`text-left rounded-md border px-3 py-2 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                      selected
                        ? "border-primary bg-primary/5"
                        : "border-input hover:bg-muted/50"
                    }`}
                    data-testid={`feedback-category-${opt.value}`}
                  >
                    <div className="text-sm font-medium">{opt.label}</div>
                    <div className="text-xs text-muted-foreground">
                      {opt.blurb}
                    </div>
                  </button>
                );
              })}
            </div>
          </fieldset>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="feedback-name">Name (optional)</Label>
              <Input
                id="feedback-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
                maxLength={120}
                data-testid="feedback-name"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="feedback-email">Email (optional)</Label>
              <Input
                id="feedback-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                maxLength={254}
                data-testid="feedback-email"
              />
              <p className="text-xs text-muted-foreground">
                We can only reply if you provide it.
              </p>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="feedback-message">Message</Label>
            <Textarea
              id="feedback-message"
              required
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Tell us what's on your mind…"
              rows={5}
              maxLength={5000}
              data-testid="feedback-message"
            />
            <p className="text-xs text-muted-foreground text-right">
              {message.length}/5000
            </p>
          </div>

          <ResponsiveModalFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={mutation.isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!canSubmit}
              data-testid="feedback-submit"
            >
              {mutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Sending…
                </>
              ) : (
                <>
                  <Send className="h-4 w-4 mr-2" />
                  Send
                </>
              )}
            </Button>
          </ResponsiveModalFooter>
        </form>
      </ResponsiveModalContent>
    </ResponsiveModal>
  );
}
