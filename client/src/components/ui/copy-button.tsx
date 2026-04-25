import * as React from "react";
import { Copy, Check } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { useCopy } from "@/hooks/use-copy";
import { cn } from "@/lib/utils";

type CopyButtonProps = Omit<ButtonProps, "onClick" | "children"> & {
  value: string | null | undefined;
  /** Toast title shown on success. Defaults to "Copied". */
  successMessage?: string;
  /** Optional label rendered next to the icon. Icon-only if omitted. */
  label?: React.ReactNode;
  /** Accessible label when icon-only. Defaults to "Copy". */
  srLabel?: string;
};

/**
 * Canonical copy-to-clipboard button. Swaps Copy ↔ Check on success and
 * emits a toast. Icon-only by default (supply `label` for a text button).
 */
export function CopyButton({
  value,
  successMessage = "Copied",
  label,
  srLabel = "Copy",
  size,
  variant = "ghost",
  className,
  ...rest
}: CopyButtonProps) {
  const { copy, copied } = useCopy();
  const Icon = copied ? Check : Copy;
  const iconOnly = !label;

  return (
    <Button
      type="button"
      variant={variant}
      size={size ?? (iconOnly ? "icon" : "sm")}
      className={cn(className)}
      onClick={() => copy(value, successMessage)}
      aria-label={iconOnly ? srLabel : undefined}
      disabled={!value || rest.disabled}
      {...rest}
    >
      <Icon className={copied ? "text-emerald-500" : undefined} aria-hidden="true" />
      {label}
      {copied && <span className="sr-only" role="status">{successMessage}</span>}
    </Button>
  );
}
