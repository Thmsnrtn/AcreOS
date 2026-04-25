import { Camera, ScanLine, MapPin, Mic } from "lucide-react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { useMobile } from "@/hooks/use-mobile";
import { useToast } from "@/hooks/use-toast";

/**
 * FieldWorkToolbar — mobile-only bottom toolbar with 4 quick-action buttons
 * for field work: Quick Capture, Scan Property, Nearest Opportunity, Voice Note.
 * Only visible on mobile devices or when running inside Capacitor.
 */
export function FieldWorkToolbar() {
  const isMobile = useMobile();
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const isCapacitor =
    typeof window !== "undefined" &&
    typeof (window as any).Capacitor !== "undefined";

  // Only render on mobile or Capacitor
  if (!isMobile && !isCapacitor) {
    return null;
  }

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 border-t bg-background px-2 py-2 flex items-center justify-around gap-1 safe-area-bottom">
      <Button
        variant="ghost"
        size="sm"
        className="flex flex-col items-center gap-1 h-auto py-2 px-3"
        aria-label="Quick Capture"
        onClick={() => navigate("/quick-capture")}
      >
        <Camera className="h-5 w-5" />
        <span className="text-xs text-muted-foreground">Capture</span>
      </Button>

      <Button
        variant="ghost"
        size="sm"
        className="flex flex-col items-center gap-1 h-auto py-2 px-3"
        aria-label="Scan Property"
        onClick={() => navigate("/field-scanner")}
      >
        <ScanLine className="h-5 w-5" />
        <span className="text-xs text-muted-foreground">Scan</span>
      </Button>

      <Button
        variant="ghost"
        size="sm"
        className="flex flex-col items-center gap-1 h-auto py-2 px-3"
        aria-label="Nearest Opportunity"
        onClick={() => navigate("/deal-feed")}
      >
        <MapPin className="h-5 w-5" />
        <span className="text-xs text-muted-foreground">Nearby</span>
      </Button>

      <Button
        variant="ghost"
        size="sm"
        className="flex flex-col items-center gap-1 h-auto py-2 px-3"
        aria-label="Voice note"
        onClick={() => toast({ title: "Voice notes coming soon", description: "We're shipping in-field voice memos in an upcoming release." })}
      >
        <Mic className="h-5 w-5" />
        <span className="text-xs text-muted-foreground">Voice</span>
      </Button>
    </div>
  );
}
