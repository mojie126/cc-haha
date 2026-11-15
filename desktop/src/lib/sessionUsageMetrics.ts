/**
 * Session-level token accounting for the context panel.
 *
 * The four buckets the CLI reports are disjoint: `input_tokens` never includes cached tokens, so
 * summing them counts each token exactly once. (Providers whose wire format folds cache hits into
 * the prompt total are adapted on the way in — see `src/server/proxy/transform/usage.ts`.)
 *
 * The headline number is *new* tokens (uncached input + output), not every cache hit replayed
 * across a long agent loop. Counting cache reads as spend made a 270k-window session look like
 * 40M "total tokens" — the same prompt billed once per tool round.
 */

export type SessionUsageLike = {
  totalInputTokens: number
  totalOutputTokens: number
  totalCacheReadInputTokens: number
  totalCacheCreationInputTokens: number
  totalDecodeDuration?: number
  totalAPIDuration?: number
  /** 网关侧（CLI 进程）计算好传回的速率；缺省时才回退到本地推导。 */
  tokensPerSecond?: number | null
  cacheHitRate?: number | null
}

export type SessionUsageMetrics = {
  /**
   * Uncached input + output. Cache hits are not spend — they are the same prompt seen again —
   * so they stay out of this number.
   */
  totalTokens: number
  /** Prompt-side tokens only: the denominator a cache hit rate is meaningful against. */
  promptTokens: number
  cachedTokens: number
  /** `null` when the session has sent no prompt tokens yet. */
  cacheHitRate: number | null
  /**
   * Output tokens over API wall-clock. `null` when no API duration was reported.
   * Decode-only spans exclude TTFT and read as a peak the user never felt.
   */
  tokensPerSecond: number | null
}

function finite(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

/**
 * Derives the panel's headline numbers.
 *
 * 速率与命中率优先采用网关侧快照传回的值（`tokensPerSecond`、`cacheHitRate`），
 * 两者口径与这里的推导完全一致；仅在快照缺省（旧版本 CLI、transcript 重放）时
 * 回退到本地推导。`tokensPerSecond` 除以含预填充的 API 时长，transcript 来源
 * 没有 API 时长时得到 `null`，而不是拿含 Bash 的墙钟时间硬算。
 */
export function deriveSessionUsageMetrics(usage: SessionUsageLike): SessionUsageMetrics {
  const input = finite(usage.totalInputTokens)
  const output = finite(usage.totalOutputTokens)
  const cacheRead = finite(usage.totalCacheReadInputTokens)
  const cacheWrite = finite(usage.totalCacheCreationInputTokens)
  const apiMs = finite(usage.totalAPIDuration)

  const promptTokens = input + cacheRead + cacheWrite
  return {
    totalTokens: input + output,
    promptTokens,
    cachedTokens: cacheRead,
    cacheHitRate: usage.cacheHitRate ?? (promptTokens > 0 ? cacheRead / promptTokens : null),
    tokensPerSecond: usage.tokensPerSecond ?? (apiMs > 0 && output > 0 ? output / (apiMs / 1000) : null),
  }
}

/**
 * Formats a cache hit rate without ever rounding a partial hit up to a flat 100%.
 *
 * A session at 99.96% is *not* fully cached, and printing "100%" would tell the user something
 * false about both their bill and their prompt stability. Widening the precision is the honest
 * fix; only a rate that is exactly 1 renders as 100%.
 */
export function formatCacheHitRate(rate: number): string {
  if (!Number.isFinite(rate) || rate <= 0) return '0%'
  if (rate >= 1) return '100%'
  const percent = rate * 100
  const twoDecimals = percent.toFixed(2)
  // 保留两位小数；99.995% 及以上四舍五入到 100.00 时封顶 99.99%，
  // 显示 100% 会对账单与提示词稳定性说谎。
  return twoDecimals === '100.00' ? '99.99%' : `${twoDecimals}%`
}

/** `100`, `42`, `9.4` — one decimal only while the number is small enough to need it. */
export function formatTokensPerSecond(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '--'
  return value >= 10 ? `${Math.round(value)}` : `${value.toFixed(1)}`
}

/** `1.2m`, `375k`, `812` — 单位统一为 k/m，紧凑到足够放进状态行。 */
export function formatCompactTokens(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0'
  if (value < 1_000) return `${Math.round(value)}`
  const thousands = value / 1_000
  const decimals = thousands >= 100 ? 0 : 1
  // 单位统一为 k：百万级上下文窗口显示为 1048.6k，不再引入 m 档
  return `${thousands.toFixed(decimals)}k`
}
