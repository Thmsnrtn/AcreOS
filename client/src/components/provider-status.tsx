import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";

interface ProviderInfo {
  ai: { openai: boolean; openrouter?: boolean; defaultTier?: string };
  sms: { available: boolean; default?: string; costs?: any };
  mail: { available: boolean; default?: string; costs?: any };
}

export function ProviderStatusBadges() {
  const [data, setData] = useState<ProviderInfo | null>(null);

  useEffect(() => {
    let mounted = true;
    fetch("/api/organization/providers", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => mounted && setData(j))
      .catch(() => {});
    return () => { mounted = false; };
  }, []);

  if (!data) return null;

  const dot = (ok: boolean) => (
    <span
      className={`inline-block w-2 h-2 rounded-full mr-1 ${ok ? 'bg-emerald-500' : 'bg-amber-500'}`}
      aria-hidden="true"
    />
  );

  const status = (ok: boolean) => (ok ? "available" : "unavailable");

  return (
    <div className="flex items-center gap-2" role="group" aria-label="Provider status">
      <Badge variant="outline" className="text-xs" aria-label={`AI ${status(!!data.ai?.openai)}`}>
        {dot(!!data.ai?.openai)} AI
      </Badge>
      <Badge variant="outline" className="text-xs" aria-label={`SMS ${status(!!data.sms?.available)}`}>
        {dot(!!data.sms?.available)} SMS
      </Badge>
      <Badge variant="outline" className="text-xs" aria-label={`Mail ${status(!!data.mail?.available)}`}>
        {dot(!!data.mail?.available)} Mail
      </Badge>
    </div>
  );
}