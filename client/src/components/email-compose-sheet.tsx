import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Mail, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";

interface EmailTemplate {
  label: string;
  subject: string;
  body: string;
}

interface EmailComposeSheetProps {
  /** Pre-filled recipient email */
  toEmail?: string;
  /** Context-aware default subject */
  defaultSubject?: string;
  /** Entity context for template suggestions */
  entityType: "lead" | "deal" | "property";
  entityId: number;
  /** Optional lead ID for thread storage */
  leadId?: number;
  /** Display name for context */
  entityLabel?: string;
  /** Trigger button variant */
  triggerVariant?: "default" | "outline" | "ghost";
  /** Trigger size */
  triggerSize?: "default" | "sm" | "icon";
  children?: React.ReactNode;
}

const TEMPLATES: Record<string, EmailTemplate[]> = {
  lead: [
    { label: "Initial contact", subject: "Regarding your property", body: "Hello,\n\nI'm reaching out regarding your property. I'm an active land investor in the area and would love to discuss a potential opportunity with you.\n\nWould you be open to a brief conversation?\n\nBest regards" },
    { label: "Follow-up", subject: "Following up on your property", body: "Hello,\n\nI wanted to follow up on my previous message about your property. I'm still very interested and would love to connect when you have a moment.\n\nBest regards" },
    { label: "Offer letter", subject: "Purchase Offer for Your Property", body: "Hello,\n\nThank you for speaking with me about your property. I'd like to present a purchase offer for your consideration.\n\nPlease find the details below and let me know if you have any questions.\n\nBest regards" },
  ],
  deal: [
    { label: "Closing coordination", subject: "Closing Coordination", body: "Hello,\n\nI'm writing to coordinate the closing details for our transaction. Please let me know your availability and any documents you still need from me.\n\nBest regards" },
    { label: "Document request", subject: "Document Request", body: "Hello,\n\nCould you please provide the following documents at your earliest convenience?\n\n1. \n2. \n3. \n\nThank you for your prompt attention to this.\n\nBest regards" },
    { label: "Status update", subject: "Transaction Status Update", body: "Hello,\n\nI wanted to provide a quick update on where we stand with the transaction.\n\nCurrent status: \nNext steps: \nExpected timeline: \n\nPlease let me know if you have any questions.\n\nBest regards" },
  ],
  property: [
    { label: "Property inquiry", subject: "Inquiry About Your Property", body: "Hello,\n\nI'm interested in learning more about your property. Could you share some additional details?\n\nBest regards" },
    { label: "Listing info", subject: "Property Listing Information", body: "Hello,\n\nI'm sharing the details for this property listing. Please review and let me know if you'd like to schedule a viewing or have any questions.\n\nBest regards" },
  ],
};

export function EmailComposeSheet({
  toEmail,
  defaultSubject,
  entityType,
  entityId,
  leadId,
  entityLabel,
  triggerVariant = "outline",
  triggerSize = "sm",
  children,
}: EmailComposeSheetProps) {
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState(toEmail || "");
  const [cc, setCc] = useState("");
  const [bcc, setBcc] = useState("");
  const [subject, setSubject] = useState(defaultSubject || "");
  const [body, setBody] = useState("");
  const [showCcBcc, setShowCcBcc] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const templates = TEMPLATES[entityType] || [];

  const sendMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/email/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to,
          cc: cc || undefined,
          bcc: bcc || undefined,
          subject,
          text: body,
          entityType,
          entityId,
          leadId,
        }),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to send email");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Email sent", description: `Email sent to ${to}` });
      setOpen(false);
      resetForm();
      if (leadId) {
        queryClient.invalidateQueries({ queryKey: [`/api/leads/${leadId}/emails`] });
      }
    },
    onError: () => {
      toast({ title: "Couldn't send email", description: "Your draft is preserved. Try sending again.", variant: "destructive" });
    },
  });

  const resetForm = () => {
    setTo(toEmail || "");
    setCc("");
    setBcc("");
    setSubject(defaultSubject || "");
    setBody("");
    setShowCcBcc(false);
  };

  const applyTemplate = (template: EmailTemplate) => {
    setSubject(template.subject);
    setBody(template.body);
  };

  return (
    <Sheet open={open} onOpenChange={(v) => { setOpen(v); if (v) resetForm(); }}>
      <SheetTrigger asChild>
        {children || (
          <Button variant={triggerVariant} size={triggerSize} aria-label="Send email">
            <Mail className="h-4 w-4 mr-1" />
            Send Email
          </Button>
        )}
      </SheetTrigger>
      <SheetContent side="bottom" className="max-h-[70vh] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>
            Compose Email {entityLabel ? `— ${entityLabel}` : ""}
          </SheetTitle>
        </SheetHeader>

        <div className="space-y-4 mt-4">
          {/* Template suggestions */}
          {templates.length > 0 && (
            <div className="flex flex-wrap gap-2">
              <span className="text-xs text-muted-foreground self-center">Templates:</span>
              {templates.map((t) => (
                <Badge
                  key={t.label}
                  variant="outline"
                  className="cursor-pointer hover:bg-muted transition-colors"
                  onClick={() => applyTemplate(t)}
                >
                  {t.label}
                </Badge>
              ))}
            </div>
          )}

          <div>
            <label htmlFor="compose-to" className="text-sm font-medium">To</label>
            <Input
              id="compose-to"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              type="email"
              inputMode="email"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              autoComplete="email"
              placeholder="recipient@example.com"
            />
          </div>

          <Collapsible open={showCcBcc} onOpenChange={setShowCcBcc}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="text-xs text-muted-foreground">
                {showCcBcc ? "Hide" : "Show"} CC/BCC
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-3 mt-2">
              <div>
                <label htmlFor="compose-cc" className="text-sm font-medium">CC</label>
                <Input id="compose-cc" value={cc} onChange={(e) => setCc(e.target.value)} type="email" inputMode="email" autoCapitalize="off" autoCorrect="off" spellCheck={false} autoComplete="email" />
              </div>
              <div>
                <label htmlFor="compose-bcc" className="text-sm font-medium">BCC</label>
                <Input id="compose-bcc" value={bcc} onChange={(e) => setBcc(e.target.value)} type="email" inputMode="email" autoCapitalize="off" autoCorrect="off" spellCheck={false} autoComplete="email" />
              </div>
            </CollapsibleContent>
          </Collapsible>

          <div>
            <label htmlFor="compose-subject" className="text-sm font-medium">Subject</label>
            <Input
              id="compose-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Email subject"
            />
          </div>

          <div>
            <label htmlFor="compose-body" className="text-sm font-medium">Message</label>
            <Textarea
              id="compose-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={10}
              placeholder="Write your message..."
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              onClick={() => sendMutation.mutate()}
              disabled={sendMutation.isPending || !to || !subject || !body}
            >
              <Send className="h-4 w-4 mr-1" />
              {sendMutation.isPending ? "Sending..." : "Send Email"}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
