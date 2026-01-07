import { createContext, useContext, useState, type ReactNode } from "react";

interface SoundContextValue {
  isSoundEnabled: boolean;
  setSoundEnabled: (enabled: boolean) => void;
  toggleSound: () => void;
}

const SoundContext = createContext<SoundContextValue | undefined>(undefined);

export function SoundProvider({ children }: { children: ReactNode }) {
  const [isSoundEnabled, setIsSoundEnabled] = useState<boolean>(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("acreos-sound");
      return stored === "true";
    }
    return false;
  });

  const setSoundEnabled = (enabled: boolean) => {
    setIsSoundEnabled(enabled);
    localStorage.setItem("acreos-sound", String(enabled));
  };

  const toggleSound = () => {
    setIsSoundEnabled((prev) => {
      const next = !prev;
      localStorage.setItem("acreos-sound", String(next));
      return next;
    });
  };

  return (
    <SoundContext.Provider value={{ isSoundEnabled, setSoundEnabled, toggleSound }}>
      {children}
    </SoundContext.Provider>
  );
}

export function useSound() {
  const context = useContext(SoundContext);
  if (context === undefined) {
    throw new Error("useSound must be used within a SoundProvider");
  }
  return context;
}
