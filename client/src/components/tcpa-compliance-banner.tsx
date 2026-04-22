import * as React from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ShieldAlert, Info } from "lucide-react";

interface TcpaBannerProps {
  /**
   * "compose" — rendered above SMS composers to remind the sender of
   * consent + opt-out duties before they send.
   * "bulk"    — stronger call-out for bulk sends (campaigns, sequences).
   */
  variant?: "compose" | "bulk";
  className?: string;
}

/**
 * TCPA / A2P 10DLC compliance reminder. Renders above outbound SMS
 * surfaces so every operator sees the obligations before they send:
 *   - prior express written consent required
 *   - opt-out honored on "STOP"
 *   - identify sender, purpose, and provide help instructions
 *
 * Copy is intentionally plain-spoken — the goal is behavioral, not
 * legal indemnity (that's in /terms). Sentence-case per the house
 * style guide.
 */
export function TcpaComplianceBanner({
  variant = "compose",
  className,
}: TcpaBannerProps) {
  if (variant === "bulk") {
    return (
      <Alert className={className}>
        <ShieldAlert className="h-4 w-4" />
        <AlertDescription className="text-xs leading-relaxed">
          <strong>Before you bulk-send:</strong> every recipient must have given
          prior express written consent to receive text messages from you. Include
          your business name, an opt-out instruction (&ldquo;Reply STOP to
          unsubscribe&rdquo;), and help instructions (&ldquo;Reply HELP&rdquo;)
          in the first message. AcreOS automatically suppresses contacts who
          have replied STOP or are on the do-not-contact list — do not remove
          those guards.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div
      className={
        "flex items-start gap-2 rounded-md border border-muted bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground " +
        (className ?? "")
      }
    >
      <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
      <span>
        By sending, you confirm you have the recipient&rsquo;s prior express
        consent. Recipients who reply <span className="font-mono">STOP</span>{" "}
        are auto-suppressed; <span className="font-mono">HELP</span> returns
        your business name.
      </span>
    </div>
  );
}
