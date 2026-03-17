import React, { createContext, useCallback, useContext, useRef, useState } from "react";

export type IslandType = "default" | "success" | "warning" | "ai" | "alert" | "saving";

export interface IslandMessage {
  id: string;
  text: string;
  type: IslandType;
  /** Duration in ms before auto-dismissing. 0 = sticky until manually dismissed. */
  duration: number;
  icon?: React.ReactNode;
}

interface DynamicIslandContextValue {
  message: IslandMessage | null;
  show: (text: string, type?: IslandType, duration?: number, icon?: React.ReactNode) => void;
  dismiss: () => void;
}

const DynamicIslandContext = createContext<DynamicIslandContextValue | null>(null);

export function DynamicIslandProvider({ children }: { children: React.ReactNode }) {
  const [message, setMessage] = useState<IslandMessage | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dismiss = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setMessage(null);
  }, []);

  const show = useCallback(
    (text: string, type: IslandType = "default", duration = 3000, icon?: React.ReactNode) => {
      if (timerRef.current) clearTimeout(timerRef.current);

      const id = `island-${Date.now()}`;
      setMessage({ id, text, type, duration, icon });

      if (duration > 0) {
        timerRef.current = setTimeout(() => setMessage(null), duration);
      }
    },
    [],
  );

  return (
    <DynamicIslandContext.Provider value={{ message, show, dismiss }}>
      {children}
    </DynamicIslandContext.Provider>
  );
}

export function useDynamicIsland() {
  const ctx = useContext(DynamicIslandContext);
  if (!ctx) throw new Error("useDynamicIsland must be used inside DynamicIslandProvider");
  return ctx;
}
