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
    <span className={`inline-block w-2 h-2 rounded-full mr-1 ${ok ? 'bg-emerald-500' : 'bg-amber-500'}`} />
  );

  return (
    <div className="flex items-center gap-2">
      <Badge variant="outline" className="text-xs">
        {dot(!!data.ai?.openai)} AI
      </Badge>
      <Badge variant="outline" className="text-xs">
        {dot(!!data.sms?.available)} SMS
      </Badge>
      <Badge variant="outline" className="text-xs">
        {dot(!!data.mail?.available)} Mail
      </Badge>
    </div>
  );
}