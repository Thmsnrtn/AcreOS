import { AlertTriangle } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";

export function DevBanner() {
  const { user } = useAuth();
  if (!import.meta.env.DEV) return null;
  return (
    <div className="w-full bg-amber-500/15 border-b border-amber-500/40 text-amber-900 dark:text-amber-200 text-xs px-3 py-1 flex items-center gap-2">
      <AlertTriangle className="w-3.5 h-3.5" />
      <span className="font-medium">DEV MODE</span>
      <span className="opacity-70">— impersonating</span>
      <span className="ml-1 truncate">{user?.email || "dev@example.com"}</span>
    </div>
  );
}
