"use client"

import * as React from "react"
import * as SelectPrimitive from "@radix-ui/react-select"
import { Check, ChevronDown, ChevronUp } from "lucide-react"

import { cn } from "@/lib/utils"

const Select = SelectPrimitive.Root

const SelectGroup = SelectPrimitive.Group

/** The id the enclosing trigger expects its value span to carry (see below). */
const SelectValueIdContext = React.createContext<string | undefined>(undefined)

const SelectValue = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Value>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Value>
>(({ id, ...props }, ref) => {
  const valueId = React.useContext(SelectValueIdContext)
  return <SelectPrimitive.Value ref={ref} id={id ?? valueId} {...props} />
})
SelectValue.displayName = SelectPrimitive.Value.displayName

/**
 * A select trigger always has an accessible name.
 *
 * Radix renders the trigger as `<button role="combobox">`, and a combobox does
 * NOT take its name from its content — the visible "All sources" inside it is
 * not its name. Every trigger with no <Label htmlFor>, wrapping <label>,
 * aria-label or aria-labelledby was announced as an unnamed control (axe
 * `button-name`, critical: 130 nodes on 9 routes in the 2026-10 crawl, every one
 * a filter select).
 *
 * When the caller supplies no label, the trigger points aria-labelledby at its
 * own <SelectValue> span, so it is named by the value it shows — labelledby is
 * the one path where that text counts. (Pointing at the trigger's OWN id is
 * not equivalent: axe, like several readers, ignores a self-reference.) A caller's label always
 * wins: an explicit aria-label/aria-labelledby is passed through untouched,
 * and an associated <label> (checked on the DOM via `labels`, the browser's
 * own association) suppresses the fallback so it can never override it.
 */
const SelectTrigger = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>
>(({ className, children, id, ...props }, ref) => {
  const valueId = `${React.useId()}-value`
  const innerRef = React.useRef<HTMLButtonElement | null>(null)
  const setRefs = React.useCallback(
    (node: HTMLButtonElement | null) => {
      innerRef.current = node
      if (typeof ref === "function") ref(node)
      else if (ref) (ref as React.MutableRefObject<HTMLButtonElement | null>).current = node
    },
    [ref],
  )
  const callerNamed = props["aria-label"] != null || props["aria-labelledby"] != null
  // Read from the DOM after commit: whether a <label> is associated, and
  // whether the value span rendered (a trigger with custom children has none,
  // and a labelledby pointing at nothing is its own ARIA defect).
  const [dom, setDom] = React.useState({ labelled: false, hasValue: false })
  React.useLayoutEffect(() => {
    const el = innerRef.current
    const valueEl = el?.ownerDocument.getElementById(valueId)
    const next = {
      labelled: (el?.labels?.length ?? 0) > 0,
      hasValue: !!el && !!valueEl && el.contains(valueEl),
    }
    if (next.labelled !== dom.labelled || next.hasValue !== dom.hasValue) setDom(next)
  })
  const selfName = !callerNamed && !dom.labelled && dom.hasValue
  return (
  <SelectPrimitive.Trigger
    ref={setRefs}
    id={id}
    {...(selfName ? { "aria-labelledby": valueId } : {})}
    className={cn(
      "flex h-9 max-sm:h-11 pointer-coarse:h-11 w-full items-center justify-between rounded-lg border border-input bg-background/70 px-3 py-2 text-sm ring-offset-background inset-input backdrop-blur-sm transition-all duration-150 data-[placeholder]:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:bg-background focus:border-ring/50 disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1",
      className
    )}
    {...props}
  >
    <SelectValueIdContext.Provider value={valueId}>{children}</SelectValueIdContext.Provider>
    <SelectPrimitive.Icon asChild>
      <ChevronDown className="h-4 w-4 opacity-50" aria-hidden="true" />
    </SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
  )
})
SelectTrigger.displayName = SelectPrimitive.Trigger.displayName

const SelectScrollUpButton = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.ScrollUpButton>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollUpButton>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollUpButton
    ref={ref}
    className={cn(
      "flex cursor-default items-center justify-center py-1",
      className
    )}
    {...props}
  >
    <ChevronUp className="h-4 w-4" />
  </SelectPrimitive.ScrollUpButton>
))
SelectScrollUpButton.displayName = SelectPrimitive.ScrollUpButton.displayName

const SelectScrollDownButton = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.ScrollDownButton>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollDownButton>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollDownButton
    ref={ref}
    className={cn(
      "flex cursor-default items-center justify-center py-1",
      className
    )}
    {...props}
  >
    <ChevronDown className="h-4 w-4" />
  </SelectPrimitive.ScrollDownButton>
))
SelectScrollDownButton.displayName =
  SelectPrimitive.ScrollDownButton.displayName

const SelectContent = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(({ className, children, position = "popper", ...props }, ref) => (
  <SelectPrimitive.Portal>
    <SelectPrimitive.Content
      ref={ref}
      className={cn(
        "relative z-floating max-h-[--radix-select-content-available-height] min-w-[8rem] overflow-y-auto overflow-x-hidden rounded-xl liquid-glass text-popover-foreground data-[state=open]:popover-spring data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 origin-[--radix-select-content-transform-origin]",
        position === "popper" &&
          "data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1",
        className
      )}
      position={position}
      {...props}
    >
      <SelectScrollUpButton />
      <SelectPrimitive.Viewport
        className={cn(
          "p-1",
          position === "popper" &&
            "h-[var(--radix-select-trigger-height)] w-full min-w-[var(--radix-select-trigger-width)]"
        )}
      >
        {children}
      </SelectPrimitive.Viewport>
      <SelectScrollDownButton />
    </SelectPrimitive.Content>
  </SelectPrimitive.Portal>
))
SelectContent.displayName = SelectPrimitive.Content.displayName

const SelectLabel = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Label>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Label
    ref={ref}
    className={cn("py-[6px] pl-8 pr-2 text-sm font-semibold", className)}
    {...props}
  />
))
SelectLabel.displayName = SelectPrimitive.Label.displayName

const SelectItem = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Item
    ref={ref}
    className={cn(
      "relative flex w-full cursor-default select-none items-center rounded-lg py-1.5 pl-8 pr-2 text-sm outline-none transition-colors duration-100 focus:bg-primary/10 focus:text-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      className
    )}
    {...props}
  >
    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <SelectPrimitive.ItemIndicator>
        <Check className="h-4 w-4" />
      </SelectPrimitive.ItemIndicator>
    </span>

    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
  </SelectPrimitive.Item>
))
SelectItem.displayName = SelectPrimitive.Item.displayName

const SelectSeparator = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Separator
    ref={ref}
    className={cn("-mx-1 my-1 h-px bg-muted", className)}
    {...props}
  />
))
SelectSeparator.displayName = SelectPrimitive.Separator.displayName

export {
  Select,
  SelectGroup,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectLabel,
  SelectItem,
  SelectSeparator,
  SelectScrollUpButton,
  SelectScrollDownButton,
}
