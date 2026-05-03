/**
 * ReadAloudButton — small icon button that toggles browser-native TTS for
 * a given block of text.
 *
 * Phase 1 of read-aloud (browser speechSynthesis). Wire this onto every
 * Pax response and every legal document so users can hear content read
 * back without leaving the page. If the browser doesn't expose
 * speechSynthesis (or the user disabled the feature in settings), the
 * button quietly returns null.
 *
 * Beck §2, Tobias §2, Mavis §2, Tariq §1 flagged this as the minimum
 * accessibility bar before launch.
 *
 *   <ReadAloudButton text={message.content} />
 */
import { Volume2, VolumeX } from "lucide-react";
import { useReadAloud } from "@/hooks/useReadAloud";
import { useReadAloudPrefs } from "@/hooks/useReadAloud.prefs";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface ReadAloudButtonProps {
  /** The text to read aloud. Markdown is fine — speechSynthesis will read */
  /** the raw characters; we strip common markdown noise before speaking. */
  text: string;
  className?: string;
  /** Optional override for the visible size — defaults to "sm". */
  size?: "sm" | "icon";
  /** Optional data-testid for tests. */
  "data-testid"?: string;
}

/**
 * Strip markdown formatting that would be read aloud as literal punctuation.
 * Keeps sentence structure intact so prosody remains natural.
 */
function plainSpoken(text: string): string {
  return text
    // Code fences and inline code
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    // Headings (#, ##, ###)
    .replace(/^#{1,6}\s+/gm, "")
    // Bold / italic markers
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    // Links: [label](url) → label
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    // Bullet markers
    .replace(/^[\s]*[-*+]\s+/gm, "")
    // Blockquote markers
    .replace(/^>\s+/gm, "")
    // Collapse whitespace
    .replace(/\s+/g, " ")
    .trim();
}

export function ReadAloudButton({
  text,
  className,
  size = "sm",
  "data-testid": testId = "read-aloud-button",
}: ReadAloudButtonProps) {
  const { speak, stop, isSpeaking, isAvailable } = useReadAloud();
  const { showButtons } = useReadAloudPrefs();

  // Hide the button entirely if the browser doesn't support TTS, the user
  // disabled it in accessibility settings, or there's no text yet.
  if (!isAvailable || !showButtons) return null;
  if (!text || !text.trim()) return null;

  const Icon = isSpeaking ? VolumeX : Volume2;
  const label = isSpeaking ? "Stop reading" : "Read this aloud";

  return (
    <Button
      type="button"
      variant="ghost"
      size={size === "icon" ? "icon" : "sm"}
      onClick={() => {
        if (isSpeaking) stop();
        else speak(plainSpoken(text));
      }}
      aria-label={label}
      title={label}
      data-testid={testId}
      className={cn(
        // Visible focus state — CLAUDE.md a11y bar.
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
        size === "sm" && "h-7 w-7 p-0",
        isSpeaking && "text-primary",
        className,
      )}
    >
      <Icon className="w-3.5 h-3.5" aria-hidden="true" />
    </Button>
  );
}
