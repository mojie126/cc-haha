import { forwardRef, useImperativeHandle, useRef, type HTMLAttributes, type ReactNode } from 'react'

import { cx } from '@/lib/cx'
import { useScrollEdgeFade } from '@/hooks/useScrollEdgeFade'

export type ScrollAreaOrientation = 'vertical' | 'horizontal' | 'both'

export type ScrollAreaProps = HTMLAttributes<HTMLDivElement> & {
  orientation?: ScrollAreaOrientation
  /** Applies auto-hiding 6px pill scrollbars that appear on hover or focus. */
  autohide?: boolean
  /** Soft 16px top scroll-edge mask, shown only while content is scrolled away above. */
  fadeTop?: boolean
  /** Soft 16px bottom scroll-edge mask, shown only while content continues below. */
  fadeBottom?: boolean
  /**
   * Uses the 7-stop `.topbar-scroll-fade` mask for scroll views gliding under
   * a translucent titlebar. Takes precedence over `fadeTop` / `fadeBottom`.
   */
  topbarFade?: boolean
  children: ReactNode
}

const ORIENTATION_CLASSES: Record<ScrollAreaOrientation, string> = {
  vertical: 'overflow-y-auto overflow-x-hidden',
  horizontal: 'overflow-x-auto overflow-y-hidden',
  both: 'overflow-auto',
}

/**
 * Lightweight single-node scrollable container with auto-hiding 6px pill
 * scrollbars and optional edge fades. Renders a single `<div>` with a
 * forwarded ref so virtualizers and scroll-position hooks can attach directly
 * without wrapper indirection.
 *
 * The edge masks follow the scroll position: at either end the adjacent first
 * or last line stays fully legible instead of being painted over by a
 * permanently applied gradient.
 */
export const ScrollArea = forwardRef<HTMLDivElement, ScrollAreaProps>(function ScrollArea({
  orientation = 'vertical',
  autohide = true,
  fadeTop = false,
  fadeBottom = false,
  topbarFade = false,
  className,
  children,
  ...props
}, ref) {
  const innerRef = useRef<HTMLDivElement>(null)
  useImperativeHandle(ref, () => innerRef.current!, [])
  const useEdgeFade = !topbarFade && (fadeTop || fadeBottom)
  const fade = useScrollEdgeFade(innerRef, useEdgeFade)

  return (
    <div
      ref={innerRef}
      data-fade-top={useEdgeFade ? (fade.top ? 'true' : 'false') : undefined}
      data-fade-bottom={useEdgeFade ? (fade.bottom ? 'true' : 'false') : undefined}
      className={cx(
        ORIENTATION_CLASSES[orientation],
        autohide && 'scrollbar-autohide',
        topbarFade && 'topbar-scroll-fade',
        useEdgeFade && 'scroll-edge-fade',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  )
})