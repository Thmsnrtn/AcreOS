import { Navigation } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useMobile } from "@/hooks/use-mobile";

interface NavigateToPropertyProps {
  latitude?: number | null;
  longitude?: number | null;
  variant?: "default" | "outline" | "ghost";
  size?: "default" | "sm" | "icon";
}

export function NavigateToProperty({
  latitude,
  longitude,
  variant = "outline",
  size = "sm",
}: NavigateToPropertyProps) {
  const { isMobile } = useMobile();
  const hasCoords = latitude != null && longitude != null;

  function handleNavigate() {
    if (!hasCoords) return;
    const lat = latitude!;
    const lng = longitude!;

    if (isMobile) {
      // iOS uses maps://, Android uses geo:
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
      const url = isIOS
        ? `maps://maps.apple.com/?daddr=${lat},${lng}`
        : `geo:${lat},${lng}?q=${lat},${lng}`;
      window.location.href = url;
    } else {
      window.open(
        `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`,
        "_blank",
        "noopener"
      );
    }
  }

  if (!hasCoords) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span>
            <Button
              variant={variant}
              size={size}
              disabled
              aria-label="Navigate to property"
            >
              <Navigation className="h-4 w-4 mr-1" />
              {size !== "icon" && "Navigate"}
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent>Coordinates needed for navigation.</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Button
      variant={variant}
      size={size}
      onClick={handleNavigate}
      aria-label="Navigate to property"
    >
      <Navigation className="h-4 w-4 mr-1" />
      {size !== "icon" && "Navigate"}
    </Button>
  );
}
