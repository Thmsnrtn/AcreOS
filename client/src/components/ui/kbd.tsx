import * as React from "react";
import { cn } from "@/lib/utils";

interface KbdProps extends React.HTMLAttributes<HTMLElement> {
  /** "sm" is used inline in prose; "md" is the default chip style. */
  size?: "sm" | "md";
}

/**
 * Canonical keyboard hint chip. Use for shortcut hints anywhere in the UI
 * — replaces ad-hoc `<kbd className="...">` styling.
 *
 *   <Kbd>⌘ K</Kbd>
 *   <Kbd size="sm">?</Kbd>
 */
export const Kbd = React.forwardRef<HTMLElement, KbdProps>(
  ({ size = "md", className, ...rest }, ref) => (
    <kbd
      ref={ref}
      className={cn(
        "inline-flex items-center font-mono border rounded bg-muted text-muted-foreground",
        size === "sm"
          ? "px-[6px] py-0.5 text-micro min-w-[18px]"
          : "px-2 py-1 text-xs min-w-[24px] shadow-sm",
        "justify-center",
        className,
      )}
      {...rest}
    />
  ),
);
Kbd.displayName = "Kbd";
