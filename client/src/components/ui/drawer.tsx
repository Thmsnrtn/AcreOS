"use client"

import * as React from "react"
import * as DrawerPrimitive from "@radix-ui/react-dialog"
import { motion, type PanInfo } from "framer-motion"

import { cn } from "@/lib/utils"
import { useReducedMotionPreference } from "@/lib/motion-tokens"

/**
 * Drawer — the bottom-sheet drawer on the repo's Radix Dialog path
 * (BD-3, 2026-11-20). This file was the vaul wrapper until BD-3; vaul was
 * 77,328 B rendered = 89% of the MobileCommandDrawer chunk and had exactly
 * one consumer chain (this file ← MobileCommandDrawer), so the engine swap
 * happens here and the consumer is untouched.
 *
 * Behaviour parity with the vaul build, point by point:
 * - Open/close, overlay-tap dismissal, Escape dismissal, focus trap and
 *   the dialog ARIA wiring are Radix Dialog's — the same primitives
 *   ui/sheet.tsx and ui/dialog.tsx already ship.
 * - Drag-to-dismiss: framer-motion drag with the SAME commit thresholds
 *   as the bottom Sheet path (offset.y > 100 || velocity.y > 500, see
 *   ui/sheet.tsx), closing through a hidden Radix Close so the open-state
 *   owner is unchanged for controlled and uncontrolled consumers alike.
 * - `handleOnly` is preserved: with it, only the grab handle is draggable,
 *   so taps on content children (links/buttons) fire on the FIRST tap
 *   instead of being swallowed by drag detection — the reason the vaul
 *   build opted into it. Without it, the whole panel drags (vaul's
 *   default), matching Sheet's whole-panel bottom drag.
 * - Snap points: the vaul build configured NONE (no snap-point prop
 *   anywhere), so there is nothing to port.
 * - Reduced motion: drag-to-dismiss is disabled when the user prefers
 *   reduced motion (the Sheet path's rule); overlay tap, Escape and
 *   explicit close still dismiss.
 *
 * Named non-parity (deliberate, cosmetic only): vaul's
 * `shouldScaleBackground` shrank the page behind the open drawer. The
 * Radix path does not scale the background, and this wrapper no longer
 * accepts the prop — the scrim + slide-up panel carry the same visual
 * hierarchy without the background transform.
 */

interface DrawerContextValue {
  handleOnly: boolean
  dragEnabled: boolean
}

const DrawerContext = React.createContext<DrawerContextValue>({
  handleOnly: false,
  dragEnabled: false,
})

const Drawer = ({
  handleOnly = false,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Root> & {
  handleOnly?: boolean
}) => {
  const reduced = useReducedMotionPreference()
  const reducedByAttr =
    typeof document !== "undefined" &&
    document.documentElement.getAttribute("data-motion") === "reduced"
  const dragEnabled = !reduced && !reducedByAttr
  return (
    <DrawerContext.Provider value={{ handleOnly, dragEnabled }}>
      <DrawerPrimitive.Root {...props} />
    </DrawerContext.Provider>
  )
}
Drawer.displayName = "Drawer"

const DrawerTrigger = DrawerPrimitive.Trigger

const DrawerPortal = DrawerPrimitive.Portal

const DrawerClose = DrawerPrimitive.Close

const DrawerOverlay = React.forwardRef<
  React.ElementRef<typeof DrawerPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DrawerPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-floating bg-surface-scrim-strong data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className
    )}
    {...props}
  />
))
DrawerOverlay.displayName = DrawerPrimitive.Overlay.displayName

const DrawerContent = React.forwardRef<
  React.ElementRef<typeof DrawerPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Content>
>(({ className, children, ...props }, ref) => {
  const { handleOnly, dragEnabled } = React.useContext(DrawerContext)
  const closeButtonRef = React.useRef<HTMLButtonElement | null>(null)

  const handleDragEnd = (_event: unknown, info: PanInfo) => {
    if (info.offset.y > 100 || info.velocity.y > 500) {
      // Defer to the Radix Close button — it owns the open-state mutation,
      // matching both controlled and uncontrolled <Drawer> consumers
      // (the ui/sheet.tsx bottom-sheet pattern).
      closeButtonRef.current?.click()
    }
  }

  // The grab handle keeps vaul's exact pill geometry. Under `handleOnly`
  // it is the ONLY draggable surface; otherwise it is a static visual
  // affordance and the whole panel carries the drag (below).
  const handlePill = (
    <div className="mx-auto mt-4 h-2 w-[100px] rounded-full bg-muted" />
  )
  const handle = dragEnabled && handleOnly ? (
    <motion.div
      drag="y"
      dragConstraints={{ top: 0, bottom: 0 }}
      dragElastic={0.2}
      onDragEnd={handleDragEnd}
      data-testid="drawer-drag-handle"
      className="shrink-0 cursor-grab active:cursor-grabbing"
    >
      {handlePill}
    </motion.div>
  ) : (
    handlePill
  )

  const wholePanelDrag = dragEnabled && !handleOnly

  return (
    <DrawerPortal>
      <DrawerOverlay />
      <DrawerPrimitive.Content
        ref={ref}
        className={cn(
          "fixed inset-x-0 bottom-0 z-floating mt-24 flex h-auto flex-col rounded-t-[10px] border bg-background data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom data-[state=closed]:duration-300 data-[state=open]:duration-500",
          className
        )}
        {...props}
      >
        {handle}
        {wholePanelDrag ? (
          <motion.div
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={0.2}
            onDragEnd={handleDragEnd}
            className="flex min-h-0 flex-col"
          >
            {children}
          </motion.div>
        ) : (
          children
        )}
        <DrawerPrimitive.Close
          ref={closeButtonRef}
          className="hidden"
          aria-hidden="true"
          tabIndex={-1}
        >
          Close
        </DrawerPrimitive.Close>
      </DrawerPrimitive.Content>
    </DrawerPortal>
  )
})
DrawerContent.displayName = "DrawerContent"

const DrawerHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn("grid gap-1.5 p-4 text-center sm:text-left", className)}
    {...props}
  />
)
DrawerHeader.displayName = "DrawerHeader"

const DrawerFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn("mt-auto flex flex-col gap-2 p-4", className)}
    {...props}
  />
)
DrawerFooter.displayName = "DrawerFooter"

const DrawerTitle = React.forwardRef<
  React.ElementRef<typeof DrawerPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DrawerPrimitive.Title
    ref={ref}
    className={cn(
      "text-lg font-semibold leading-none tracking-tight",
      className
    )}
    {...props}
  />
))
DrawerTitle.displayName = DrawerPrimitive.Title.displayName

const DrawerDescription = React.forwardRef<
  React.ElementRef<typeof DrawerPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DrawerPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
))
DrawerDescription.displayName = DrawerPrimitive.Description.displayName

export {
  Drawer,
  DrawerPortal,
  DrawerOverlay,
  DrawerTrigger,
  DrawerClose,
  DrawerContent,
  DrawerHeader,
  DrawerFooter,
  DrawerTitle,
  DrawerDescription,
}
