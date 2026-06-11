import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  Pause, 
  Play, 
  Square, 
  FastForward,
  Rewind,
  X
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Action, ActionResult, ActionExecutor } from "@/lib/action-executor";

interface LiveDemoModeProps {
  actions: Action[];
  speed?: 0.5 | 1 | 2;
  onComplete?: (results: ActionResult[]) => void;
  onCancel?: () => void;
  onExecutorCreated?: (executor: ActionExecutor) => void;
  onSpeedChange?: (speed: 0.5 | 1 | 2) => void;
  isActive: boolean;
}

type SpeedOption = 0.5 | 1 | 2;

const SPEED_LABELS: Record<SpeedOption, string> = {
  0.5: "0.5x",
  1: "1x",
  2: "2x",
};

export function LiveDemoMode({ 
  actions, 
  speed: initialSpeed = 1,
  onComplete, 
  onCancel,
  onExecutorCreated,
  onSpeedChange,
  isActive 
}: LiveDemoModeProps) {
  const [currentActionIndex, setCurrentActionIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [speed, setSpeed] = useState<SpeedOption>(initialSpeed);
  const prevIsActiveRef = useRef(isActive);
  const [narration, setNarration] = useState<string>("");
  const [highlightedElement, setHighlightedElement] = useState<Element | null>(null);
  const [orbPosition, setOrbPosition] = useState({ x: 0, y: 0 });
  const [isOrbVisible, setIsOrbVisible] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  
  const executorRef = useRef<ActionExecutor | null>(null);
  const highlightOverlayRef = useRef<HTMLDivElement | null>(null);

  const updateOrbPosition = useCallback((element: Element | null) => {
    if (!element) {
      setIsOrbVisible(false);
      return;
    }

    const rect = element.getBoundingClientRect();
    setOrbPosition({
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    });
    setIsOrbVisible(true);
  }, []);

  const handleHighlight = useCallback((element: Element | null, _action: Action) => {
    setHighlightedElement(element);
    updateOrbPosition(element);
  }, [updateOrbPosition]);

  const handleNarration = useCallback((text: string) => {
    setNarration(text);
  }, []);

  const handleActionStart = useCallback((action: Action) => {
    const idx = actions.findIndex(a => a.id === action.id);
    if (idx !== -1) {
      setCurrentActionIndex(idx);
    }
  }, [actions]);

  const handleActionComplete = useCallback((_result: ActionResult) => {
  }, []);

  useEffect(() => {
    if (!isActive || actions.length === 0) return;

    const executor = new ActionExecutor({
      speed,
      onActionStart: handleActionStart,
      onActionComplete: handleActionComplete,
      onHighlight: handleHighlight,
      onNarration: handleNarration,
    });

    executorRef.current = executor;
    onExecutorCreated?.(executor);
    setIsExecuting(true);
    setCurrentActionIndex(0);

    executor.executeActions(actions).then((results) => {
      setIsExecuting(false);
      setIsOrbVisible(false);
      setHighlightedElement(null);
      setNarration("");
      onComplete?.(results);
    });

    return () => {
      executor.cancel();
    };
  }, [isActive, actions, handleActionStart, handleActionComplete, handleHighlight, handleNarration, onComplete, onExecutorCreated]);

  useEffect(() => {
    if (executorRef.current) {
      executorRef.current.setSpeed(speed);
    }
  }, [speed]);

  useEffect(() => {
    const wasActive = prevIsActiveRef.current;
    prevIsActiveRef.current = isActive;
    
    if (isActive && !wasActive) {
      setSpeed(initialSpeed);
    }
  }, [isActive, initialSpeed]);

  const handlePauseResume = () => {
    if (!executorRef.current) return;

    if (isPaused) {
      executorRef.current.resume();
      setIsPaused(false);
    } else {
      executorRef.current.pause();
      setIsPaused(true);
    }
  };

  const handleCancel = () => {
    if (executorRef.current) {
      executorRef.current.cancel();
    }
    setIsExecuting(false);
    setIsOrbVisible(false);
    setHighlightedElement(null);
    setNarration("");
    onCancel?.();
  };

  const cycleSpeed = () => {
    const speeds: SpeedOption[] = [0.5, 1, 2];
    const currentIdx = speeds.indexOf(speed);
    const nextIdx = (currentIdx + 1) % speeds.length;
    const newSpeed = speeds[nextIdx];
    setSpeed(newSpeed);
    onSpeedChange?.(newSpeed);
  };

  if (!isActive || !isExecuting) return null;

  const highlightRect = highlightedElement?.getBoundingClientRect();

  return (
    <>
      {isOrbVisible && (
        <div
          className="fixed pointer-events-none z-spotlight transition-all duration-300 ease-out"
          style={{
            left: orbPosition.x,
            top: orbPosition.y,
            transform: "translate(-50%, -50%)",
          }}
        >
          <div className="relative">
            <div
              className={cn(
                "w-8 h-8 rounded-full",
                "bg-gradient-to-br from-white via-white/90 to-white/70",
                "shadow-[0_0_30px_rgba(255,255,255,0.9),0_0_60px_rgba(255,255,255,0.5),0_0_90px_rgba(255,255,255,0.3)]",
                "border border-white/50"
              )}
            />
            <div
              className={cn(
                "absolute inset-0 rounded-full",
                "bg-white/30",
                "animate-ping opacity-50"
              )}
            />
            <div
              className={cn(
                "absolute inset-[-4px] rounded-full",
                "bg-white/20",
                "animate-pulse"
              )}
            />
          </div>
        </div>
      )}

      {highlightRect && (
        <div
          ref={highlightOverlayRef}
          className="fixed pointer-events-none z-island transition-all duration-200 ease-out"
          style={{
            left: highlightRect.left - 4,
            top: highlightRect.top - 4,
            width: highlightRect.width + 8,
            height: highlightRect.height + 8,
          }}
        >
          <div 
            className={cn(
              "absolute inset-0 rounded-card",
              "border-2 border-primary",
              "bg-primary/10",
              "animate-pulse"
            )}
          />
          <div 
            className={cn(
              "absolute inset-[-2px] rounded-card",
              "ring-4 ring-primary/30",
              "animate-pulse"
            )}
          />
        </div>
      )}

      <div
        className={cn(
          "fixed bottom-20 left-1/2 -translate-x-1/2 z-max",
          "bg-surface-chrome backdrop-blur-md",
          "border border-border rounded-2xl shadow-2xl",
          "p-4 min-w-[400px]"
        )}
      >
        <div className="flex items-center justify-between gap-4 mb-3">
          <div className="flex items-center gap-2">
            <div className="relative" aria-hidden="true">
              <div
                className={cn(
                  "w-3 h-3 rounded-full",
                  "bg-gradient-to-br from-white via-white/90 to-white/70",
                  "shadow-[0_0_10px_rgba(255,255,255,0.7)]"
                )}
              />
              <div
                className="absolute inset-0 rounded-full bg-white/50 animate-ping"
              />
            </div>
            <span className="font-semibold text-sm">Live demo mode</span>
          </div>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            onClick={handleCancel}
            aria-label="Cancel demo"
            data-testid="button-cancel-demo"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </Button>
        </div>

        <div
          role="status"
          aria-live="polite"
          className="bg-muted/50 rounded-card p-3 mb-3 min-h-[40px]"
        >
          <p className="text-sm text-foreground">
            {narration || "Preparing to execute…"}
          </p>
        </div>

        <div className="flex items-center justify-between gap-2 mb-3">
          <div
            className="flex items-center gap-1"
            role="img"
            aria-label={`Step ${currentActionIndex + 1} of ${actions.length}`}
          >
            {actions.map((_, idx) => (
              <div
                key={idx}
                aria-hidden="true"
                className={cn(
                  "w-2 h-2 rounded-full transition-all",
                  idx < currentActionIndex
                    ? "bg-primary"
                    : idx === currentActionIndex
                    ? "bg-primary animate-pulse scale-125"
                    : "bg-muted-foreground/30"
                )}
              />
            ))}
          </div>
          <Badge variant="secondary" className="text-xs tabular-nums">
            {currentActionIndex + 1} / {actions.length}
          </Badge>
        </div>

        <div className="flex items-center justify-center gap-2">
          <Button
            size="icon"
            variant="outline"
            onClick={cycleSpeed}
            className="h-9 w-12"
            aria-label={`Change playback speed (current: ${SPEED_LABELS[speed]})`}
            data-testid="button-speed-demo"
          >
            {speed < 1 ? (
              <Rewind className="w-4 h-4" aria-hidden="true" />
            ) : speed > 1 ? (
              <FastForward className="w-4 h-4" aria-hidden="true" />
            ) : (
              <span className="text-xs font-medium">{SPEED_LABELS[speed]}</span>
            )}
          </Button>

          <Button
            size="icon"
            variant={isPaused ? "default" : "outline"}
            onClick={handlePauseResume}
            className="h-10 w-10"
            aria-label={isPaused ? "Resume demo" : "Pause demo"}
            data-testid="button-pause-resume-demo"
          >
            {isPaused ? (
              <Play className="w-5 h-5" aria-hidden="true" />
            ) : (
              <Pause className="w-5 h-5" aria-hidden="true" />
            )}
          </Button>

          <Button
            size="icon"
            variant="destructive"
            onClick={handleCancel}
            className="h-9 w-9"
            aria-label="Stop demo"
            data-testid="button-stop-demo"
          >
            <Square className="w-4 h-4" aria-hidden="true" />
          </Button>
        </div>

        <div className="flex justify-center mt-3" role="status" aria-live="polite">
          <Badge
            variant="outline"
            className={cn(
              "text-xs",
              isPaused && "bg-acr-warn/10 text-acr-warn border-acr-warn/30"
            )}
          >
            {isPaused ? "Paused" : `Running at ${SPEED_LABELS[speed]}`}
          </Badge>
        </div>
      </div>

      <div 
        className="fixed inset-0 z-tour pointer-events-none"
        style={{
          background: "radial-gradient(circle at center, transparent 70%, rgba(0,0,0,0.1) 100%)",
        }}
      />
    </>
  );
}
