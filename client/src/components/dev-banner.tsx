import { AlertTriangle } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";

export function DevBanner() {
  const { user } = useAuth();
  if (!import.meta.env.DEV) return null;
  return (
    <div className="w-full bg-acr-warn/15 border-b border-acr-warn/40 text-acr-warn dark:text-acr-warn text-xs px-3 py-1 flex items-center gap-2">
      <AlertTriangle className="w-3.5 h-3.5" />
      <span className="font-medium">DEV MODE</span>
      <span className="opacity-70">— impersonating</span>
      <span className="ml-1 truncate">{user?.email || "dev@example.com"}</span>
    </div>
  );
}
