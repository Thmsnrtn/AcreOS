import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0" +
  " transition-all duration-150 ease-out active:scale-[0.96]",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground border border-primary-border hover:brightness-105 hover:-translate-y-px",
        destructive:
          "bg-destructive text-destructive-foreground border border-destructive-border",
        outline:
          " border [border-color:var(--button-outline)]  shadow-xs active:shadow-none ",
        secondary: "border bg-secondary text-secondary-foreground border border-secondary-border ",
        ghost: "border border-transparent",
        glass: "liquid-glass-sm text-foreground hover:-translate-y-px hover:shadow-level-2",
      },
      size: {
        // WCAG 2.1 SC 2.5.5 + Apple HIG call for 44px min touch target.
        // Desktop stays dense (h-9 / 36px) but mobile (<640px) bumps to
        // h-11 (44px) and icon buttons bump to 44x44.
        //
        // Radius locked to the two-value system (§0.2): `rounded-card`
        // for standard surfaces and `rounded-full` only when the variant
        // is explicitly pill (lg). Prior values (rounded-lg / rounded-md
        // / rounded-full mixed across sizes) created three shapes inside
        // the same primitive.
        default: "min-h-9 sm:min-h-9 max-sm:min-h-11 rounded-card px-4 py-2",
        // max-sm:min-h-11 = 44px on mobile — Apple HIG / WCAG 2.5.5 minimum.
        // Previously min-h-10 (40px), 4px below the HIG threshold.
        sm: "min-h-8 max-sm:min-h-11 rounded-card px-3 text-xs",
        lg: "min-h-10 max-sm:min-h-12 rounded-full px-8",
        icon: "h-9 w-9 max-sm:h-11 max-sm:w-11 rounded-card",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  },
)
Button.displayName = "Button"

export { Button, buttonVariants }
