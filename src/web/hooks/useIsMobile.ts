import { useEffect, useState } from 'react'

/**
 * Width, not user agent: a phone and a desktop window dragged narrow get the
 * same layout, and rotating a phone to landscape can hand back the board.
 */
export const MOBILE_QUERY = '(max-width: 767px)'

export function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(() => window.matchMedia(MOBILE_QUERY).matches)
  useEffect(() => {
    const media = window.matchMedia(MOBILE_QUERY)
    const onChange = () => setMobile(media.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])
  return mobile
}

/**
 * The height actually left for content: on a phone the soft keyboard shrinks
 * the visual viewport but not the layout one, so a terminal sized to 100vh
 * puts its prompt underneath the keyboard.
 */
export function useVisualViewportHeight(): number {
  const read = () => Math.round(window.visualViewport?.height ?? window.innerHeight)
  const [height, setHeight] = useState(read)
  useEffect(() => {
    const vv = window.visualViewport
    const onResize = () => setHeight(read())
    vv?.addEventListener('resize', onResize)
    window.addEventListener('resize', onResize)
    return () => {
      vv?.removeEventListener('resize', onResize)
      window.removeEventListener('resize', onResize)
    }
  }, [])
  return height
}
