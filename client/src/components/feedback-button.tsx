import { useState } from "react";
import { MessageSquarePlus } from "lucide-react";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function FeedbackButton() {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<string>("");
  const [message, setMessage] = useState("");
  const [allowFollowUp, setAllowFollowUp] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const { toast } = useToast();

  function resetForm() {
    setCategory("");
    setMessage("");
    setAllowFollowUp(true);
  }

  async function handleSubmit(e: React.FormEvent) {
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

      setOpen(false);
      resetForm();
      toast({
        title: "Feedback sent",
        description: "Thank you! We read every submission.",
      });
    } catch {
      toast({
        title: "Failed to send feedback",
        description: "Please try again in a moment.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="icon"
            variant="outline"
            onClick={() => setOpen(true)}
            className="fixed bottom-[304px] md:bottom-[248px] right-4 md:right-16 z-[47] rounded-full shadow-lg hover:shadow-xl transition-shadow bg-background safe-area-bottom"
            aria-label="Send feedback"
          >
            <MessageSquarePlus className="w-5 h-5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="left">
          <p>Send Feedback</p>
        </TooltipContent>
      </Tooltip>

      <FeedbackDialog
        open={open}
        onOpenChange={(v) => {
          setOpen(v);
          if (!v) resetForm();
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
    </>
  );
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

export function FeedbackDialog({
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
                <SelectItem value="bug">Bug Report</SelectItem>
                <SelectItem value="feature_request">Feature Request</SelectItem>
                <SelectItem value="confusion">Confusion</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="feedback-message">Message</Label>
            <Textarea
              id="feedback-message"
              placeholder="Tell us what happened, what you expected, or what you'd like to see..."
              value={message}
              onChange={(e) => onMessageChange(e.target.value)}
              rows={4}
              minLength={10}
              required
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
              {submitting ? "Sending..." : "Send Feedback"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
