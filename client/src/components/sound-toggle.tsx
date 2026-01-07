import { Volume2, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSound } from "@/contexts/sound-context";

export function SoundToggle() {
  const { isSoundEnabled, toggleSound } = useSound();

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggleSound}
      aria-label={isSoundEnabled ? "Mute ambient sound" : "Unmute ambient sound"}
      data-testid="button-sound-toggle"
    >
      {isSoundEnabled ? (
        <Volume2 className="w-5 h-5" />
      ) : (
        <VolumeX className="w-5 h-5" />
      )}
    </Button>
  );
}
