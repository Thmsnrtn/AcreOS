"use client"

import * as React from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { useIsMobile } from "@/hooks/use-mobile"
import { cn } from "@/lib/utils"

/**
 * Responsive modal that renders a bottom Sheet on mobile and a centered
 * Dialog on tablet+. Drop-in replacement for Dialog: same trigger / content /
 * header / footer / title / description API. Mobile audit found 7+ Dialog
 * instances on form-heavy surfaces (/properties /deals /tasks /leads /settings)
 * where the centered desktop modal is painful at 375×812.
 *
 * Both Dialog and Sheet primitives wrap @radix-ui/react-dialog, so the trigger
 * + state semantics are identical. Children compose normally.
 *
 * Usage:
 *   <ResponsiveModal open={open} onOpenChange={setOpen}>
 *     <ResponsiveModalContent>
 *       <ResponsiveModalHeader>
 *         <ResponsiveModalTitle>...</ResponsiveModalTitle>
 *         <ResponsiveModalDescription>...</ResponsiveModalDescription>
 *       </ResponsiveModalHeader>
 *       ...
 *       <ResponsiveModalFooter>...</ResponsiveModalFooter>
 *     </ResponsiveModalContent>
 *   </ResponsiveModal>
 */

const ResponsiveModalContext = React.createContext<{ isMobile: boolean }>({
  isMobile: false,
})

interface ResponsiveModalProps {
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  children: React.ReactNode
}

export function ResponsiveModal({ open, defaultOpen, onOpenChange, children }: ResponsiveModalProps) {
  const { isMobile } = useIsMobile()
  const Root = isMobile ? Sheet : Dialog
  return (
    <ResponsiveModalContext.Provider value={{ isMobile }}>
      <Root open={open} defaultOpen={defaultOpen} onOpenChange={onOpenChange}>
        {children}
      </Root>
    </ResponsiveModalContext.Provider>
  )
}

interface ResponsiveModalTriggerProps extends React.ComponentPropsWithoutRef<typeof DialogTrigger> {}

export const ResponsiveModalTrigger = React.forwardRef<
  React.ElementRef<typeof DialogTrigger>,
  ResponsiveModalTriggerProps
>((props, ref) => {
  const { isMobile } = React.useContext(ResponsiveModalContext)
  const Trigger = isMobile ? SheetTrigger : DialogTrigger
  return <Trigger ref={ref} {...props} />
})
ResponsiveModalTrigger.displayName = "ResponsiveModalTrigger"

interface ResponsiveModalContentProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Max height for the bottom sheet on mobile. Default: 85vh. */
  mobileMaxHeight?: string
}

export const ResponsiveModalContent = React.forwardRef<HTMLDivElement, ResponsiveModalContentProps>(
  ({ className, children, mobileMaxHeight = "85vh", ...props }, ref) => {
    const { isMobile } = React.useContext(ResponsiveModalContext)
    if (isMobile) {
      return (
        <SheetContent
          ref={ref}
          side="bottom"
          className={cn(
            "rounded-t-card border-t",
            // Bottom-sheet height; allow scrolling within when content overflows.
            "max-h-[var(--rmm)] overflow-y-auto",
            className
          )}
          style={{ "--rmm": mobileMaxHeight } as React.CSSProperties}
          {...props}
        >
          {children}
        </SheetContent>
      )
    }
    return (
      <DialogContent ref={ref} className={className} {...props}>
        {children}
      </DialogContent>
    )
  }
)
ResponsiveModalContent.displayName = "ResponsiveModalContent"

export const ResponsiveModalHeader: React.FC<React.HTMLAttributes<HTMLDivElement>> = (props) => {
  const { isMobile } = React.useContext(ResponsiveModalContext)
  return isMobile ? <SheetHeader {...props} /> : <DialogHeader {...props} />
}

export const ResponsiveModalFooter: React.FC<React.HTMLAttributes<HTMLDivElement>> = (props) => {
  const { isMobile } = React.useContext(ResponsiveModalContext)
  return isMobile ? <SheetFooter {...props} /> : <DialogFooter {...props} />
}

export const ResponsiveModalTitle = React.forwardRef<
  React.ElementRef<typeof DialogTitle>,
  React.ComponentPropsWithoutRef<typeof DialogTitle>
>((props, ref) => {
  const { isMobile } = React.useContext(ResponsiveModalContext)
  return isMobile ? <SheetTitle ref={ref} {...props} /> : <DialogTitle ref={ref} {...props} />
})
ResponsiveModalTitle.displayName = "ResponsiveModalTitle"

export const ResponsiveModalDescription = React.forwardRef<
  React.ElementRef<typeof DialogDescription>,
  React.ComponentPropsWithoutRef<typeof DialogDescription>
>((props, ref) => {
  const { isMobile } = React.useContext(ResponsiveModalContext)
  return isMobile ? <SheetDescription ref={ref} {...props} /> : <DialogDescription ref={ref} {...props} />
})
ResponsiveModalDescription.displayName = "ResponsiveModalDescription"
