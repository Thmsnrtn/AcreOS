import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { pulseAnimation } from "@/lib/animations";

interface SkeletonCardProps {
  className?: string;
  showHeader?: boolean;
  showFooter?: boolean;
  lines?: number;
}

export function SkeletonCard({
  className,
  showHeader = true,
  showFooter = false,
  lines = 3,
}: SkeletonCardProps) {
  return (
    <motion.div
      data-testid="skeleton-card"
      className={cn(
        "rounded-xl border bg-card border-card-border p-6 space-y-4",
        className
      )}
      initial={{ opacity: 0.5 }}
      animate={pulseAnimation}
    >
      {showHeader && (
        <div className="space-y-2">
          <div className="h-5 w-1/3 rounded-md bg-muted" />
          <div className="h-3 w-1/2 rounded-md bg-muted" />
        </div>
      )}

      <div className="space-y-3">
        {Array.from({ length: lines }).map((_, i) => (
          <div
            key={i}
            className="h-4 rounded-md bg-muted"
            style={{ width: `${85 - i * 15}%` }}
          />
        ))}
      </div>

      {showFooter && (
        <div className="flex items-center gap-3 pt-2">
          <div className="h-8 w-20 rounded-md bg-muted" />
          <div className="h-8 w-20 rounded-md bg-muted" />
        </div>
      )}
    </motion.div>
  );
}
