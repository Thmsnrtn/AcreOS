import * as React from "react"
import * as TabsPrimitive from "@radix-ui/react-tabs"

import { cn } from "@/lib/utils"

/**
 * Which tab values have a <TabsContent> declared under this <Tabs>.
 *
 * Radix's trigger always emits `aria-controls` pointing at its panel's id. Many
 * surfaces here use <Tabs> as a segmented FILTER over one shared list and
 * declare no <TabsContent> at all (inbox, tasks), so the selected trigger
 * announced "controls panel X" for an id that is not in the document — axe
 * `aria-valid-attr-value`, critical. The wrapper below records which values
 * really have a panel, and a trigger without one omits `aria-controls`
 * instead of pointing at nothing. A trigger whose panel IS declared keeps the
 * Radix id exactly as before.
 *
 * Registration happens in the wrapper's own effect, which runs for every
 * declared <TabsContent> whether or not Radix mounts its DOM (inactive panels
 * are unmounted), so an inactive-but-real panel still counts as present.
 */
type PanelRegistry = {
  has: (value: string) => boolean
  register: (value: string) => () => void
}
const TabsPanelRegistry = React.createContext<PanelRegistry | null>(null)

const Tabs = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Root>
>((props, ref) => {
  const [panels, setPanels] = React.useState<ReadonlyMap<string, number>>(
    () => new Map(),
  )
  // `register` must keep one identity for the life of the root: a panel's
  // effect depends on it, and a new identity per registration would
  // unregister + re-register forever.
  const register = React.useCallback((value: string) => {
    setPanels((prev) => {
      const next = new Map(prev)
      next.set(value, (next.get(value) ?? 0) + 1)
      return next
    })
    return () =>
      setPanels((prev) => {
        const next = new Map(prev)
        const n = (next.get(value) ?? 0) - 1
        if (n > 0) next.set(value, n)
        else next.delete(value)
        return next
      })
  }, [])
  const registry = React.useMemo<PanelRegistry>(
    () => ({ has: (value) => (panels.get(value) ?? 0) > 0, register }),
    [panels, register],
  )
  return (
    <TabsPanelRegistry.Provider value={registry}>
      <TabsPrimitive.Root ref={ref} {...props} />
    </TabsPanelRegistry.Provider>
  )
})
Tabs.displayName = TabsPrimitive.Root.displayName

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      // justify-start + tab-strip-scroll (not justify-center): a centered
      // flex container that overflows clips its FIRST items unreachably,
      // and an overflowing strip previously hard-cut the last tab with no
      // hint it scrolls ("Foreca…" on the Finance door). The strip now
      // scrolls with a right-edge fade affordance on touch devices; when
      // everything fits, it renders exactly as before.
      "inline-flex h-10 max-sm:h-auto pointer-coarse:h-auto items-center justify-start rounded-xl liquid-glass-subtle p-1 text-muted-foreground tab-strip-scroll",
      className
    )}
    {...props}
  />
))
TabsList.displayName = TabsPrimitive.List.displayName

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => {
  const registry = React.useContext(TabsPanelRegistry)
  // No registry means a bare TabsPrimitive.Root above us — leave Radix's
  // behaviour alone rather than guess. With one, a value that has no declared
  // panel gets no aria-controls (an explicit caller value still wins).
  const noPanel = registry !== null && !registry.has(props.value)
  return (
  <TabsPrimitive.Trigger
    ref={ref}
    {...(noPanel ? { "aria-controls": undefined } : {})}
    className={cn(
      // max-sm/pointer-coarse min-h-11: the 44px touch floor every other
      // interactive primitive holds (button.tsx). Tab strips were 32px on
      // phones — the most common under-44 control in the 2026-10 crawl.
      "inline-flex max-sm:min-h-11 pointer-coarse:min-h-11 items-center justify-center whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium ring-offset-background transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:liquid-glass-sm data-[state=active]:text-foreground data-[state=active]:shadow-sm",
      className
    )}
    {...props}
  />
  )
})
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => {
  const registry = React.useContext(TabsPanelRegistry)
  const register = registry?.register
  React.useEffect(() => register?.(props.value), [register, props.value])
  return (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      "mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
      className
    )}
    {...props}
  />
  )
})
TabsContent.displayName = TabsPrimitive.Content.displayName

export { Tabs, TabsList, TabsTrigger, TabsContent }
