import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { pulseAnimation } from "@/lib/animations";

interface SkeletonTableProps {
  className?: string;
  rows?: number;
  columns?: number;
  showHeader?: boolean;
}

export function SkeletonTable({
  className,
  rows = 5,
  columns = 4,
  showHeader = true,
}: SkeletonTableProps) {
  return (
    <motion.div
      data-testid="skeleton-table"
      className={cn("rounded-xl border bg-card border-card-border overflow-hidden", className)}
      initial={{ opacity: 0.5 }}
      animate={pulseAnimation}
    >
      {showHeader && (
        <div className="border-b bg-muted/30 px-4 py-3 flex gap-4">
          {Array.from({ length: columns }).map((_, i) => (
            <div
              key={i}
              className="h-4 rounded bg-muted flex-1"
              style={{ maxWidth: i === 0 ? "150px" : "100px" }}
            />
          ))}
        </div>
      )}

      <div className="divide-y">
        {Array.from({ length: rows }).map((_, rowIdx) => (
          <div key={rowIdx} className="px-4 py-3 flex items-center gap-4">
            {Array.from({ length: columns }).map((_, colIdx) => (
              <div
                key={colIdx}
                className="h-4 rounded bg-muted flex-1"
                style={{ 
                  maxWidth: colIdx === 0 ? "180px" : colIdx === columns - 1 ? "80px" : "120px" 
                }}
              />
            ))}
          </div>
        ))}
      </div>
    </motion.div>
  );
}
