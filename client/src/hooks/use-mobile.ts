import * as React from "react"

const MOBILE_BREAKPOINT = 768
const TABLET_BREAKPOINT = 1024

export function useIsMobile() {
  // Initialize synchronously from the real viewport — the previous
  // useState(false) + mounted dance made EVERY consumer render one frame
  // in desktop mode on phones (bottom nav absent, desktop page-transition
  // variant with x-translate, copilot rail mounted). That first wrong frame
  // is what mobile WebKit/Blink use to lock shrink-to-fit zoom when the
  // desktop variant's translateX widens the document. CSR app — no SSR
  // hydration to protect, so reading window here is safe.
  const [isMobile, setIsMobile] = React.useState<boolean>(
    () => typeof window !== "undefined" && window.innerWidth < MOBILE_BREAKPOINT,
  )
  const [isTablet, setIsTablet] = React.useState<boolean>(
    () =>
      typeof window !== "undefined" &&
      window.innerWidth >= MOBILE_BREAKPOINT &&
      window.innerWidth < TABLET_BREAKPOINT,
  )
  const [isKeyboardOpen, setIsKeyboardOpen] = React.useState<boolean>(false)

  React.useEffect(() => {

    const updateScreenSize = () => {
      const width = window.innerWidth
      setIsMobile(width < MOBILE_BREAKPOINT)
      setIsTablet(width >= MOBILE_BREAKPOINT && width < TABLET_BREAKPOINT)
    }

    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    mql.addEventListener("change", updateScreenSize)
    updateScreenSize()

    const handleResize = () => {
      if (window.visualViewport) {
        const viewportHeight = window.visualViewport.height
        const windowHeight = window.innerHeight
        setIsKeyboardOpen(viewportHeight < windowHeight * 0.75)
      }
    }

    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', handleResize)
    }

    return () => {
      mql.removeEventListener("change", updateScreenSize)
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', handleResize)
      }
    }
  }, [])

  return {
    isMobile,
    isTablet,
    isKeyboardOpen,
    isDesktop: !isMobile && !isTablet,
  }
}

export { useIsMobile as useMobile }
