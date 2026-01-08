import { useRef, useEffect, useCallback } from "react";
import { useLocation } from "wouter";

interface SwipeConfig {
  threshold?: number;
  allowedRoutes?: string[];
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
}

const defaultRoutes = ["/", "/leads", "/properties", "/deals", "/finance", "/settings"];

export function useSwipeNavigation(config: SwipeConfig = {}) {
  const { 
    threshold = 150, // Increased from 80 for less sensitivity
    allowedRoutes = defaultRoutes,
    onSwipeLeft,
    onSwipeRight 
  } = config;
  
  const [location, setLocation] = useLocation();
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);
  const touchMoved = useRef(false);
  const isScrollingContainer = useRef(false);

  const getCurrentIndex = useCallback(() => {
    return allowedRoutes.indexOf(location);
  }, [location, allowedRoutes]);

  const navigateLeft = useCallback(() => {
    if (onSwipeLeft) {
      onSwipeLeft();
      return;
    }
    const currentIndex = getCurrentIndex();
    if (currentIndex > 0) {
      setLocation(allowedRoutes[currentIndex - 1]);
    }
  }, [getCurrentIndex, setLocation, allowedRoutes, onSwipeLeft]);

  const navigateRight = useCallback(() => {
    if (onSwipeRight) {
      onSwipeRight();
      return;
    }
    const currentIndex = getCurrentIndex();
    if (currentIndex < allowedRoutes.length - 1 && currentIndex !== -1) {
      setLocation(allowedRoutes[currentIndex + 1]);
    }
  }, [getCurrentIndex, setLocation, allowedRoutes, onSwipeRight]);

  useEffect(() => {
    // Check if element or any parent is horizontally scrollable
    const isInScrollableContainer = (element: HTMLElement | null): boolean => {
      while (element) {
        const style = window.getComputedStyle(element);
        const overflowX = style.overflowX;
        const isScrollable = (overflowX === 'auto' || overflowX === 'scroll') && 
                            element.scrollWidth > element.clientWidth;
        if (isScrollable) return true;
        element = element.parentElement;
      }
      return false;
    };

    const handleTouchStart = (e: TouchEvent) => {
      const target = e.target as HTMLElement;
      // Exclude inputs, textareas, elements with data-no-swipe, tables, and scrollable containers
      if (target.closest("input, textarea, [data-no-swipe], table, .overflow-x-auto, .overflow-x-scroll")) {
        isScrollingContainer.current = true;
        return;
      }
      // Check if inside a horizontally scrollable container
      if (isInScrollableContainer(target)) {
        isScrollingContainer.current = true;
        return;
      }
      isScrollingContainer.current = false;
      touchStartX.current = e.touches[0].clientX;
      touchStartY.current = e.touches[0].clientY;
      touchMoved.current = false;
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (touchStartX.current === null || touchStartY.current === null || isScrollingContainer.current) return;
      
      const deltaX = Math.abs(e.touches[0].clientX - touchStartX.current);
      const deltaY = Math.abs(e.touches[0].clientY - touchStartY.current);
      
      // Require 3:1 horizontal to vertical ratio and minimum 50px horizontal movement
      // This ensures the gesture is deliberate, not accidental during scrolling
      if (deltaX > deltaY * 3 && deltaX > 50) {
        touchMoved.current = true;
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (touchStartX.current === null || !touchMoved.current || isScrollingContainer.current) {
        touchStartX.current = null;
        touchStartY.current = null;
        isScrollingContainer.current = false;
        return;
      }

      const touchEndX = e.changedTouches[0].clientX;
      const deltaX = touchEndX - touchStartX.current;

      if (Math.abs(deltaX) >= threshold) {
        if (deltaX > 0) {
          navigateLeft();
        } else {
          navigateRight();
        }
      }

      touchStartX.current = null;
      touchStartY.current = null;
      touchMoved.current = false;
      isScrollingContainer.current = false;
    };

    document.addEventListener("touchstart", handleTouchStart, { passive: true });
    document.addEventListener("touchmove", handleTouchMove, { passive: true });
    document.addEventListener("touchend", handleTouchEnd, { passive: true });

    return () => {
      document.removeEventListener("touchstart", handleTouchStart);
      document.removeEventListener("touchmove", handleTouchMove);
      document.removeEventListener("touchend", handleTouchEnd);
    };
  }, [threshold, navigateLeft, navigateRight]);

  return { navigateLeft, navigateRight, currentRoute: location };
}
