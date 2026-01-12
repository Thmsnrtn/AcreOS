import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { pulseAnimation } from "@/lib/animations";

interface SkeletonListProps {
  className?: string;
  items?: number;
  showAvatar?: boolean;
  showBadge?: boolean;
}

export function SkeletonList({
  className,
  items = 5,
  showAvatar = true,
  showBadge = false,
}: SkeletonListProps) {
  return (
    <motion.div
      data-testid="skeleton-list"
      className={cn("space-y-3", className)}
      initial={{ opacity: 0.5 }}
      animate={pulseAnimation}
    >
      {Array.from({ length: items }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 p-3 rounded-lg bg-muted/30"
        >
          {showAvatar && (
            <div className="h-10 w-10 rounded-full bg-muted shrink-0" />
          )}

          <div className="flex-1 space-y-2">
            <div className="h-4 w-2/3 rounded bg-muted" />
            <div className="h-3 w-1/2 rounded bg-muted" />
          </div>

          {showBadge && (
            <div className="h-6 w-16 rounded-full bg-muted shrink-0" />
          )}
        </div>
      ))}
    </motion.div>
  );
}
