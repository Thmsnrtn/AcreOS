import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

/**
 * @deprecated FeedbackButton no longer renders its own floating
 * button. Feedback is now accessed through:
 *   - Help sheet (⌘? or the help button in the dock)
 *   - Settings page
 *   - Command palette search
 * The component still exists as a no-op shim so existing imports
 * don't break; safe to remove once callers are updated.
 */
export function FeedbackButton() {
  return null;
}

interface FeedbackDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  category: string;
  onCategoryChange: (value: string) => void;
  message: string;
  onMessageChange: (value: string) => void;
  allowFollowUp: boolean;
  onAllowFollowUpChange: (value: boolean) => void;
  submitting: boolean;
  onSubmit: (e: React.FormEvent) => void;
}

/**
 * Self-contained feedback dialog — manages its own state and submit
 * logic. Use this from any surface (help sheet, settings, etc.)
 * where you want a feedback trigger without wiring up 6 props.
 */
export function FeedbackDialog({
  open: openProp,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [category, setCategory] = useState<string>("");
  const [message, setMessage] = useState("");
  const [allowFollowUp, setAllowFollowUp] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const { toast } = useToast();

  const reset = () => {
    setCategory("");
    setMessage("");
    setAllowFollowUp(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!category) {
      toast({ title: "Please select a category", variant: "destructive" });
      return;
    }
    if (message.trim().length < 10) {
      toast({
        title: "Message too short",
        description: "Please provide at least 10 characters of detail.",
        variant: "destructive",
      });
      return;
    }
    setSubmitting(true);
    try {
      await apiRequest("POST", "/api/feedback", {
        category,
        message: message.trim(),
        allowFollowUp,
      });
      onOpenChange(false);
      reset();
      toast({ title: "Feedback sent", description: "Thank you! We read every submission." });
    } catch {
      toast({
        title: "Couldn't send feedback",
        description: "Your message is preserved in the form. Try again in a moment.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <FeedbackDialogInner
      open={openProp}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) reset();
      }}
      category={category}
      onCategoryChange={setCategory}
      message={message}
      onMessageChange={setMessage}
      allowFollowUp={allowFollowUp}
      onAllowFollowUpChange={setAllowFollowUp}
      submitting={submitting}
      onSubmit={handleSubmit}
    />
  );
}

function FeedbackDialogInner({
  open,
  onOpenChange,
  category,
  onCategoryChange,
  message,
  onMessageChange,
  allowFollowUp,
  onAllowFollowUpChange,
  submitting,
  onSubmit,
}: FeedbackDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>What's on your mind?</DialogTitle>
          <DialogDescription>
            Your feedback shapes AcreOS. We read everything.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4 mt-2">
          <div className="space-y-2">
            <Label htmlFor="feedback-category">Category</Label>
            <Select value={category} onValueChange={onCategoryChange}>
              <SelectTrigger id="feedback-category">
                <SelectValue placeholder="Select a category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="bug">Bug report</SelectItem>
                <SelectItem value="feature_request">Feature request</SelectItem>
                <SelectItem value="confusion">Confusion</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="feedback-message">Message</Label>
            <Textarea
              id="feedback-message"
              placeholder="Tell us what happened, what you expected, or what you'd like to see…"
              value={message}
              onChange={(e) => onMessageChange(e.target.value)}
              rows={4}
              minLength={10}
              required
              autoCapitalize="sentences"
            />
            {message.length > 0 && message.trim().length < 10 && (
              <p className="text-xs text-muted-foreground">
                {10 - message.trim().length} more characters needed
              </p>
            )}
          </div>

          <div className="flex items-center space-x-2">
            <Checkbox
              id="feedback-followup"
              checked={allowFollowUp}
              onCheckedChange={(checked) =>
                onAllowFollowUpChange(checked === true)
              }
            />
            <Label htmlFor="feedback-followup" className="text-sm font-normal cursor-pointer">
              Can we follow up with you about this?
            </Label>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Sending…" : "Send feedback"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
