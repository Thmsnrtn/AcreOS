/**
 * LegalDocReadAloud — wraps ReadAloudButton for legal-document surfaces.
 *
 * Legal docs (terms, privacy, disclosures, borrower portal) are rendered
 * as nested JSX with sections, lists, and emphasis — not a single source
 * string. Rather than ask each page to assemble its full text, this
 * component pulls the rendered text from a ref and reads that. Perfect
 * for compliance docs where the on-screen content is the source of truth.
 *
 * Phase 2 may swap to streaming TTS (ElevenLabs / OpenAI tts-1) — same
 * surface; the implementation flips under the hood.
 */
import { useCallback, useEffect, useState, type RefObject } from "react";
import { Volume2, VolumeX } from "lucide-react";
import { useReadAloud } from "@/hooks/useReadAloud";
import { useReadAloudPrefs } from "@/hooks/useReadAloud.prefs";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface LegalDocReadAloudProps {
  /** Ref to the container whose innerText should be read aloud. */
  docRef: RefObject<HTMLElement | null>;
  className?: string;
  "data-testid"?: string;
  /** Optional override label — defaults to "Read this document aloud". */
  startLabel?: string;
  stopLabel?: string;
}

export function LegalDocReadAloud({
  docRef,
  className,
  "data-testid": testId = "legal-doc-read-aloud",
  startLabel = "Read this document aloud",
  stopLabel = "Stop reading document",
}: LegalDocReadAloudProps) {
  const { speak, stop, isSpeaking, isAvailable } = useReadAloud();
  const { showButtons } = useReadAloudPrefs();
  // Disable until we've confirmed the ref is mounted with content — avoids
  // flashing a working button before the document body has populated.
  const [hasContent, setHasContent] = useState(false);

  useEffect(() => {
    const el = docRef.current;
    if (!el) {
      setHasContent(false);
      return;
    }
    setHasContent((el.innerText ?? "").trim().length > 0);
  }, [docRef]);

  const onClick = useCallback(() => {
    if (isSpeaking) {
      stop();
      return;
    }
    const el = docRef.current;
    if (!el) return;
    const text = (el.innerText ?? "").replace(/\s+/g, " ").trim();
    if (text) speak(text);
  }, [isSpeaking, stop, speak, docRef]);

  if (!isAvailable || !showButtons) return null;
  if (!hasContent) return null;

  const Icon = isSpeaking ? VolumeX : Volume2;
  const label = isSpeaking ? stopLabel : startLabel;

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={onClick}
      aria-label={label}
      title={label}
      data-testid={testId}
      className={cn(
        "gap-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
        isSpeaking && "border-primary text-primary",
        className,
      )}
    >
      <Icon className="w-4 h-4" aria-hidden="true" />
      <span className="text-xs">{isSpeaking ? "Stop" : "Read aloud"}</span>
    </Button>
  );
}
