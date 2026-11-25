import { useLayoutEffect, useState, type RefObject } from 'react'

export type ScrollEdgeMetrics = {
  scrollTop: number
  clientHeight: number
  scrollHeight: number
}

export type ScrollEdgeFade = {
  top: boolean
  bottom: boolean
}

/** 小于该像素的偏移不算「已滚开」，避免分数 DPI 抖动让渐隐闪动。 */
const EDGE_EPSILON = 2

/**
 * @brief 按滚动位置判定首尾是否还有被遮住的内容
 * @details 只有真正滚开的一端才出渐隐，停在顶部或底部的那一侧保持完全清晰
 * @param metrics 滚动容器的三项尺寸
 * @param epsilon 判定阈值，默认 2 像素
 * @return 两端是否应启用渐隐
 */
export function computeScrollEdges(metrics: ScrollEdgeMetrics, epsilon = EDGE_EPSILON): ScrollEdgeFade {
  const maxScroll = Math.max(0, metrics.scrollHeight - metrics.clientHeight)
  return {
    top: metrics.scrollTop > epsilon,
    bottom: maxScroll - metrics.scrollTop > epsilon,
  }
}

/**
 * @brief 给滚动容器提供首尾渐隐状态，配合 `.scroll-edge-fade` 的 data 属性使用
 * @details 监听滚动与尺寸变化，内容高度增长（流式正文）时也会重新判定
 * @param ref 滚动容器引用
 * @param enabled 为 false 时两端都不启用
 * @return 两端是否应启用渐隐
 */
export function useScrollEdgeFade(
  ref: RefObject<HTMLElement | null>,
  enabled = true,
): ScrollEdgeFade {
  const [fade, setFade] = useState<ScrollEdgeFade>({ top: false, bottom: false })

  useLayoutEffect(() => {
    const element = ref.current
    if (!enabled || !element) {
      setFade((current) => (current.top || current.bottom ? { top: false, bottom: false } : current))
      return
    }

    const update = () => {
      const next = computeScrollEdges({
        scrollTop: element.scrollTop,
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
      })
      setFade((current) => (current.top === next.top && current.bottom === next.bottom ? current : next))
    }

    update()
    element.addEventListener('scroll', update, { passive: true })
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    observer?.observe(element)
    // 元素自身高度不变、内容长高时也要重判，流式正文属于这种情况
    if (element.firstElementChild) observer?.observe(element.firstElementChild)

    return () => {
      element.removeEventListener('scroll', update)
      observer?.disconnect()
    }
  }, [enabled, ref])

  return fade
}