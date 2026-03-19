import { useEffect, useState } from "react";

type ProviderInfo = {
  ai: { openai: boolean; openrouter?: boolean; defaultTier?: string } | null;
  sms: { available: boolean } | null;
  mail: { available: boolean } | null;
};

export function useProviderStatus() {
  const [info, setInfo] = useState<ProviderInfo | null>(null);
  useEffect(() => {
    let mounted = true;
    fetch("/api/organization/providers", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (mounted) setInfo(j); })
      .catch(() => {});
    return () => { mounted = false; };
  }, []);
  const isAvailable = (key: 'ai' | 'sms' | 'mail') => {
    if (!info) return false;
    if (key === 'ai') return !!info.ai?.openai;
    if (key === 'sms') return !!info.sms?.available;
    if (key === 'mail') return !!info.mail?.available;
    return false;
  };
  return { info, isAvailable };
}