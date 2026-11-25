// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'

import { computeScrollEdges } from './useScrollEdgeFade'

describe('computeScrollEdges', () => {
  it('leaves both ends clear when the content fits without scrolling', () => {
    expect(computeScrollEdges({ scrollTop: 0, clientHeight: 200, scrollHeight: 200 })).toEqual({ top: false, bottom: false })
    expect(computeScrollEdges({ scrollTop: 0, clientHeight: 200, scrollHeight: 120 })).toEqual({ top: false, bottom: false })
  })

  it('does not fade the top while sitting at the first line', () => {
    // 首行必须完全清晰，否则读者看不清第一句
    expect(computeScrollEdges({ scrollTop: 0, clientHeight: 200, scrollHeight: 600 })).toEqual({ top: false, bottom: true })
  })

  it('fades both ends once scrolled into the middle', () => {
    expect(computeScrollEdges({ scrollTop: 200, clientHeight: 200, scrollHeight: 600 })).toEqual({ top: true, bottom: true })
  })

  it('does not fade the bottom once the last line is reached', () => {
    expect(computeScrollEdges({ scrollTop: 400, clientHeight: 200, scrollHeight: 600 })).toEqual({ top: true, bottom: false })
  })

  it('ignores sub-pixel offsets so fractional DPI does not flicker the mask', () => {
    // Windows 分数缩放会让 scrollTop 落在 0.5 这类值上
    expect(computeScrollEdges({ scrollTop: 1, clientHeight: 200, scrollHeight: 600 })).toEqual({ top: false, bottom: true })
    expect(computeScrollEdges({ scrollTop: 399, clientHeight: 200, scrollHeight: 600 })).toEqual({ top: true, bottom: false })
  })
})