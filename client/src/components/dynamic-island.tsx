import React, { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  CheckCircle2,
  AlertTriangle,
  Bot,
  BellRing,
  Loader2,
  Save,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { type IslandType, useDynamicIsland } from "@/contexts/dynamic-island-context";

/* ── Icon map ──────────────────────────────────────────────────────── */
const TYPE_ICONS: Record<IslandType, React.ReactNode> = {
  default: null,
  success: <CheckCircle2 className="h-3.5 w-3.5" />,
  warning: <AlertTriangle className="h-3.5 w-3.5" />,
  ai:      <Bot className="h-3.5 w-3.5 animate-pulse" />,
  alert:   <BellRing className="h-3.5 w-3.5" />,
  saving:  <Loader2 className="h-3.5 w-3.5 animate-spin" />,
};

const TYPE_COLORS: Record<IslandType, string> = {
  default: "text-foreground",
  success: "text-emerald-400",
  warning: "text-amber-400",
  ai:      "text-[hsl(var(--primary))]",
  alert:   "text-rose-400",
  saving:  "text-[hsl(var(--accent))]",
};

/* ── Spring variants ───────────────────────────────────────────────── */
const islandVariants: any = {
  hidden: {
    opacity: 0,
    scale: 0.6,
    y: -20,
    filter: "blur(6px)",
  },
  visible: {
    opacity: 1,
    scale: 1,
    y: 0,
    filter: "blur(0px)",
    transition: {
      type: "spring",
      stiffness: 500,
      damping: 30,
      mass: 0.8,
    },
  },
  exit: {
    opacity: 0,
    scale: 0.8,
    y: -12,
    filter: "blur(4px)",
    transition: { duration: 0.22, ease: [0.4, 0, 1, 1] },
  },
};

const contentVariants: any = {
  hidden: { opacity: 0, width: 0, x: -4 },
  visible: {
    opacity: 1,
    width: "auto",
    x: 0,
    transition: { delay: 0.08, duration: 0.2, ease: [0.16, 1, 0.3, 1] },
  },
  exit: { opacity: 0, width: 0, x: -4, transition: { duration: 0.12 } },
};

/**
 * DynamicIsland — macOS / iPhone Dynamic Island–style floating status pill.
 *
 * Mounts at the top-center of the viewport and shows contextual system
 * messages: AI thinking, save confirmations, deal alerts, etc.
 *
 * Driven by DynamicIslandContext — call `useDynamicIsland().show()` from
 * anywhere in the app.
 */
export function DynamicIsland() {
  const { message, dismiss } = useDynamicIsland();

  return (
    <div
      aria-live="polite"
      aria-atomic="true"
      className="pointer-events-none fixed inset-x-0 top-4 z-[9998] flex justify-center"
    >
      <AnimatePresence mode="wait">
        {message && (
          <motion.button
            key={message.id}
            type="button"
            variants={islandVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            onClick={dismiss}
            className={cn(
              "pointer-events-auto",
              "flex items-center gap-2 rounded-full px-4 py-2",
              "min-w-[2.5rem] max-w-[22rem]",
              "cursor-pointer select-none",
              // Glass material
              "backdrop-blur-2xl backdrop-saturate-[190%]",
              "bg-black/80 dark:bg-black/85",
              "border border-white/10",
              "shadow-[0_0_0_0.5px_rgba(255,255,255,0.06),0_8px_32px_rgba(0,0,0,0.5),0_2px_8px_rgba(0,0,0,0.3)]",
              // Specular top edge
              "before:absolute before:inset-x-0 before:top-0 before:h-px before:rounded-t-full",
              "before:bg-gradient-to-r before:from-transparent before:via-white/20 before:to-transparent",
              "relative overflow-hidden",
            )}
            aria-label={message.text}
          >
            {/* Icon */}
            <AnimatePresence mode="wait">
              <motion.span
                key={`icon-${message.type}`}
                initial={{ opacity: 0, scale: 0.5, rotate: -15 }}
                animate={{ opacity: 1, scale: 1, rotate: 0, transition: { type: "spring", stiffness: 600, damping: 25 } }}
                exit={{ opacity: 0, scale: 0.5, rotate: 15, transition: { duration: 0.1 } }}
                className={cn("flex-shrink-0", TYPE_COLORS[message.type])}
              >
                {message.icon ?? TYPE_ICONS[message.type]}
              </motion.span>
            </AnimatePresence>

            {/* Text */}
            <motion.span
              variants={contentVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
              className="overflow-hidden whitespace-nowrap text-[13px] font-medium leading-none text-white/90"
            >
              {message.text}
            </motion.span>
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}
