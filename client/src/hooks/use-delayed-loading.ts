import { useEffect, useRef, useState } from "react";

export function useDelayedLoading(isLoading: boolean, minMs = 200) {
  const [showLoading, setShowLoading] = useState(isLoading);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (isLoading) {
      setShowLoading(true);
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => {
        // keep showing spinner; no-op here
      }, minMs);
    } else {
      // ensure skeleton shows at least minMs
      if (timerRef.current) {
        const id = timerRef.current;
        timerRef.current = null;
        window.clearTimeout(id);
      }
      const t = window.setTimeout(() => setShowLoading(false), minMs);
      return () => window.clearTimeout(t);
    }
  }, [isLoading, minMs]);

  return showLoading;
}