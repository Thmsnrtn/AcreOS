"use client"

import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"

import { cn } from "@/lib/utils"

const Dialog = DialogPrimitive.Root

const DialogTrigger = DialogPrimitive.Trigger

const DialogPortal = DialogPrimitive.Portal

const DialogClose = DialogPrimitive.Close

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      // Tahoe-style: blurred glass scrim instead of opaque black.
      // z-modal (60) sits above MobileBottomNav (z-floating/50) so the nav
      // doesn't paint over modal scrims on mobile.
      "fixed inset-0 z-modal",
      "bg-surface-scrim backdrop-blur-[6px] backdrop-saturate-150",
      "data-[state=open]:animate-in data-[state=closed]:animate-out",
      "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className
    )}
    {...props}
  />
))
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        // Position — z-modal (60) paired with the overlay so dialog content
        // also sits above MobileBottomNav.
        //
        // Sizing default — explicit viewport-relative width with a
        // mobile-safe minimum. Hardened 2026-06-02 after Tom flagged the
        // Pax Settings dialog rendering effectively-blank on a 390px
        // iPhone — the prior `w-full max-w-lg` relied on the portal's
        // parent sizing which can collapse if the consumer overrides
        // `max-w` only at the `sm:` breakpoint. `w-[calc(100vw-2rem)]`
        // is viewport-relative + leaves a 1rem gutter each side;
        // `min-w-[280px]` is the safety floor — no dialog renders
        // narrower than this even if a consumer or downstream JSX
        // tries to collapse it.
        "fixed left-[50%] top-[50%] z-modal grid w-[calc(100vw-2rem)] min-w-[280px] max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4",
        // Tahoe material, modal grade: the overlay beneath already blurs
        // the page, and stacking a second backdrop-filter on the panel is
        // the WebKit combination that left dialog panels unpainted on
        // iOS (frosted page, invisible dialog). modal-surface keeps the
        // glass look with a near-opaque fill and no backdrop-filter.
        // BOUNDED AND SCROLLABLE — a centred panel taller than the viewport
        // loses its TOP, not its bottom.
        //
        // `top-[50%] translate-y-[-50%]` centres the panel on the viewport, so
        // content taller than the screen overflows in BOTH directions and the
        // half above the fold is unreachable: the title, and the close control
        // at `top-4`. There was no max-height and no overflow container, so
        // there was also no way to scroll to it.
        //
        // `dvh`, not `vh`, is the load-bearing detail on the surface this repo
        // cares most about: on iOS Safari `100vh` is the height WITHOUT the
        // browser chrome, so a vh-based bound is itself taller than the visible
        // area and the panel still overflows. `dvh` tracks the actual visible
        // viewport as the URL bar shows and hides.
        //
        // `overscroll-contain` stops a scroll that reaches the panel's end from
        // chaining to the page behind it, which on a phone reads as the dialog
        // dragging the background around under your finger.
        "max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain",
        "modal-surface rounded-2xl p-6",
        // Spring animation
        "duration-200",
        "data-[state=open]:animate-in data-[state=closed]:animate-out",
        "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
        "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
        "data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%]",
        "data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%]",
        className
      )}
      {...props}
    >
      {children}
      {/* macOS traffic-light close button */}
      <DialogPrimitive.Close
        className="traffic-light-group traffic-light-close absolute left-4 top-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded-full"
        aria-label="Close"
      >
        <span className="tl-symbol" aria-hidden="true">✕</span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPortal>
))
DialogContent.displayName = DialogPrimitive.Content.displayName

const DialogHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col space-y-1.5 text-center sm:text-left",
      className
    )}
    {...props}
  />
)
DialogHeader.displayName = "DialogHeader"

const DialogFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2",
      className
    )}
    {...props}
  />
)
DialogFooter.displayName = "DialogFooter"

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn(
      "text-lg font-semibold leading-none tracking-tight",
      className
    )}
    {...props}
  />
))
DialogTitle.displayName = DialogPrimitive.Title.displayName

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
))
DialogDescription.displayName = DialogPrimitive.Description.displayName

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogClose,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
}
