import { useEffect } from "react";

const GLASS_SELECTOR =
  ".liquid-glass, .liquid-glass-sm, .liquid-glass-subtle, .glass-panel";

/**
 * useCursorGlass — tracks the mouse position across all glass elements
 * and updates --cursor-x / --cursor-y CSS custom properties so the
 * ::after specular highlight follows the cursor (macOS Tahoe Liquid Glass).
 *
 * Mount once at the app root. Zero-cost when the user isn't hovering glass.
 */
export function useCursorGlass() {
  useEffect(() => {
    let rafId: number;
    let pendingX = 0;
    let pendingY = 0;

    const flush = () => {
      const elements = document.querySelectorAll<HTMLElement>(GLASS_SELECTOR);
      elements.forEach((el) => {
        const rect = el.getBoundingClientRect();
        const x = ((pendingX - rect.left) / rect.width) * 100;
        const y = ((pendingY - rect.top) / rect.height) * 100;
        el.style.setProperty("--cursor-x", `${x.toFixed(1)}%`);
        el.style.setProperty("--cursor-y", `${y.toFixed(1)}%`);
      });
    };

    const onMouseMove = (e: MouseEvent) => {
      pendingX = e.clientX;
      pendingY = e.clientY;
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(flush);
    };

    document.addEventListener("mousemove", onMouseMove, { passive: true });
    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      cancelAnimationFrame(rafId);
    };
  }, []);
}
