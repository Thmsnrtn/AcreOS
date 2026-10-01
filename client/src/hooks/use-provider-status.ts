import { okOrThrow } from "@/lib/fetch-honesty";
import { clientLogger } from "@/lib/clientLogger";
import { useEffect, useState } from "react";

type ProviderInfo = {
  ai: { openai: boolean; openrouter?: boolean; defaultTier?: string } | null;
  sms: { available: boolean } | null;
  mail: { available: boolean } | null;
};

export function useProviderStatus() {
  const [info, setInfo] = useState<ProviderInfo | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let mounted = true;
    fetch("/api/organization/providers", { credentials: "include" })
      .then(okOrThrow)
      .then((r) => r.json())
      .then((j) => { if (mounted) setInfo(j); })
      .catch((err) => {
        clientLogger.warn("[provider-status] could not read provider status", err);
        if (mounted) setFailed(true);
      });
    return () => { mounted = false; };
  }, []);
  // Conservative by design: a capability is offered only once the server has
  // said it is available. Until then — loading, or a failed read — isAvailable
  // is false and `known` is false, so a caller can say "checking" (or, when
  // `failed`, "couldn't check") rather than "not configured" (W10.1: a failed
  // read is not an answer).
  const isAvailable = (key: 'ai' | 'sms' | 'mail') => {
    if (!info) return false;
    if (key === 'ai') return !!info.ai?.openai;
    if (key === 'sms') return !!info.sms?.available;
    if (key === 'mail') return !!info.mail?.available;
    return false;
  };
  return { info, known: info !== null, failed, isAvailable };
}