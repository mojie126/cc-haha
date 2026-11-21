/**
 * 历史索引维护行：显示历史可见性索引（含旧机制在 TEMP 的孤儿）的占用，
 * 提供一键清空。索引是可再生缓存，删除安全——下次打开会话自动重建。
 */
import { useCallback, useEffect, useState } from 'react'
import { HardDriveDownload, LoaderCircle } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useTranslation } from '@/i18n'
import { settingsApi } from '@/api/settings'
import type { HistoryIndexUsage } from '@/types/settings'

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

export function HistoryIndexMaintenance() {
  const t = useTranslation()
  const [usage, setUsage] = useState<HistoryIndexUsage | null>(null)
  const [loading, setLoading] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [cleared, setCleared] = useState(false)
  const [failed, setFailed] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    setFailed(false)
    try {
      setUsage(await settingsApi.getHistoryIndexUsage())
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void refresh().catch(() => {}) }, [refresh])

  const clear = useCallback(async () => {
    setClearing(true)
    setFailed(false)
    try {
      await settingsApi.clearHistoryIndexes()
      setCleared(true)
      await refresh()
    } catch {
      setFailed(true)
    } finally {
      setClearing(false)
    }
  }, [refresh])

  const totalBytes = usage ? usage.indexBytes + usage.legacyTempBytes : 0

  return (
    <div className="flex min-h-[52px] items-center gap-x-6 gap-y-2.5 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="block text-[13px] font-medium leading-5 text-[var(--color-text-primary)]">
          {t('settings.general.historyIndexTitle')}
        </div>
        <div className="mt-0.5 text-xs leading-[1.5] text-[var(--color-text-tertiary)]">
          {failed
            ? <span className="text-[var(--color-error)]">{t('settings.general.historyIndexLoadFailed')}</span>
            : loading && !usage
              ? <span>{t('settings.general.historyIndexLoading')}</span>
              : (
                <>
                  <span>
                    {t('settings.general.historyIndexUsage', {
                      size: formatBytes(totalBytes),
                      count: String(usage?.indexCount ?? 0),
                    })}
                  </span>
                  {(usage?.legacyTempCount ?? 0) > 0 && (
                    <span>
                      {' · '}
                      {t('settings.general.historyIndexLegacy', {
                        size: formatBytes(usage?.legacyTempBytes ?? 0),
                        count: String(usage?.legacyTempCount ?? 0),
                      })}
                    </span>
                  )}
                  {cleared && <span className="text-[var(--color-success)]"> · {t('settings.general.historyIndexCleared')}</span>}
                </>
              )}
        </div>
      </div>
      <Button
        size="base"
        variant="secondary"
        className="whitespace-nowrap"
        icon={clearing ? <LoaderCircle size={14} strokeWidth={1.75} className="animate-spin" aria-hidden="true" /> : <HardDriveDownload size={14} strokeWidth={1.75} aria-hidden="true" />}
        disabled={loading || clearing || totalBytes === 0}
        onClick={() => void clear().catch(() => {})}
      >
        {t('settings.general.historyIndexClear')}
      </Button>
    </div>
  )
}
