/**
 * 权限规则设置面板：读写用户 settings.json 的 permissions.allow / deny / ask
 *
 * 规则形如 `Bash(git status:*)`、`WebFetch(domain:example.com)` 或裸工具名，
 * 校验在输入侧做轻量形态检查（权威校验在 sidecar 写入时把关），
 * 保存走 settingsApi.updateUser 的整体 permissions 对象替换
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Plus, RotateCw, X } from 'lucide-react'
import { SettingsBlock, SettingsGroup, SettingsSection } from '@/components/settings/SettingsSection'
import { Button } from '@/components/ui/Button'
import { IconButton } from '@/components/ui/IconButton'
import { useTranslation } from '@/i18n'
import { settingsApi } from '@/api/settings'
import type { UserSettings } from '@/types/settings'

type RuleBucket = 'allow' | 'deny' | 'ask'

const BUCKETS: readonly RuleBucket[] = ['allow', 'deny', 'ask']

type BucketState = Record<RuleBucket, string[]>

const EMPTY_BUCKETS: BucketState = { allow: [], deny: [], ask: [] }

/** 输入侧轻量校验：非空、括号配对、工具名非空（括号形态时）。返回 i18n 键的 error 段或 null */
function validateRuleDraft(draft: string): 'error.empty' | 'error.parens' | 'error.missingTool' | null {
  const trimmed = draft.trim()
  if (!trimmed) return 'error.empty'
  const openCount = (trimmed.match(/(?<!\\)\(/g) ?? []).length
  const closeCount = (trimmed.match(/(?<!\\)\)/g) ?? []).length
  if (openCount !== closeCount) return 'error.parens'
  const openIndex = trimmed.search(/(?<!\\)\(/)
  if (openIndex === 0) return 'error.missingTool'
  return null
}

export function PermissionRulesSettings() {
  const t = useTranslation()
  const [buckets, setBuckets] = useState<BucketState>(EMPTY_BUCKETS)
  const [drafts, setDrafts] = useState<Record<RuleBucket, string>>({ allow: '', deny: '', ask: '' })
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  const [saveFailed, setSaveFailed] = useState(false)
  /** 以服务器快照为基线做整体替换，避免并发期间其他键被本面板覆盖 */
  const snapshotRef = useRef<UserSettings | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setLoadFailed(false)
    try {
      const user = await settingsApi.getUser()
      snapshotRef.current = user
      const next = { ...EMPTY_BUCKETS }
      const permissions = user.permissions
      if (permissions && typeof permissions === 'object' && !Array.isArray(permissions)) {
        for (const bucket of BUCKETS) {
          const rules = (permissions as Record<string, unknown>)[bucket]
          if (Array.isArray(rules)) {
            next[bucket] = rules.filter((rule): rule is string => typeof rule === 'string')
          }
        }
      }
      setBuckets(next)
    } catch {
      setLoadFailed(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void refresh().catch(() => {}) }, [refresh])

  const persist = useCallback(async (next: BucketState) => {
    const snapshot = snapshotRef.current
    if (!snapshot) { setSaveFailed(true); return }
    setSaving(true)
    setSaveFailed(false)
    try {
      // settings.json 顶层浅合并：permissions 必须整对象下发，三个数组之外
      // 的既有键（defaultMode 等）原样保留
      const previous = snapshot.permissions
      const previousExtra = previous && typeof previous === 'object' && !Array.isArray(previous)
        ? Object.fromEntries(Object.entries(previous as Record<string, unknown>)
            .filter(([key]) => key !== 'allow' && key !== 'deny' && key !== 'ask'))
        : {}
      const permissions = {
        ...previousExtra,
        allow: next.allow,
        deny: next.deny,
        ask: next.ask,
      }
      await settingsApi.updateUser({ permissions })
      // 下发值就是权威状态，直接以它为新的快照基线；不再回读覆盖——
      // 回读拿到的是发出前的旧文件，会把刚保存的行吞掉
      snapshotRef.current = { ...snapshot, permissions }
      setBuckets(next)
      setDrafts({ allow: '', deny: '', ask: '' })
    } catch {
      setSaveFailed(true)
    } finally {
      setSaving(false)
    }
  }, [])

  const removeRule = (bucket: RuleBucket, index: number) => {
    const next = { ...buckets, [bucket]: buckets[bucket].filter((_, i) => i !== index) }
    setBuckets(next)
    void persist(next)
  }

  const addRule = (bucket: RuleBucket) => {
    const draft = drafts[bucket].trim()
    if (validateRuleDraft(draft)) return
    // 同一规则重复添加没有信息量，也避免同串出现两行难以区分
    if (buckets[bucket].some(rule => rule === draft)) {
      setDrafts(current => ({ ...current, [bucket]: '' }))
      return
    }
    const next = { ...buckets, [bucket]: [...buckets[bucket], draft] }
    setBuckets(next)
    setDrafts(current => ({ ...current, [bucket]: '' }))
    void persist(next)
  }

  const hasAnyRule = BUCKETS.some(bucket => buckets[bucket].length > 0)

  return (
    <SettingsSection
      title={t('settings.permissionRules.title')}
      description={t('settings.permissionRules.description')}
      action={(
        <Button
          variant="ghost"
          size="sm"
          icon={<RotateCw size={14} strokeWidth={1.75} aria-hidden="true" />}
          loading={loading}
          disabled={saving}
          onClick={() => void refresh().catch(() => {})}
        >
          {t('settings.permissionRules.refresh')}
        </Button>
      )}
    >
      {loadFailed && (
        <p role="alert" className="mt-2 text-xs text-[var(--color-error)]">{t('settings.permissionRules.loadFailed')}</p>
      )}
      {saveFailed && (
        <p role="alert" className="mt-2 text-xs text-[var(--color-error)]">{t('settings.permissionRules.saveFailed')}</p>
      )}
      {!loadFailed && !hasAnyRule && !loading && (
        <p className="mt-2 text-xs text-[var(--color-text-tertiary)]">{t('settings.permissionRules.empty')}</p>
      )}
      {BUCKETS.map(bucket => (
        <SettingsGroup key={bucket}>
          <SettingsBlock>
            <div className="mb-2 flex items-baseline justify-between gap-2">
              <span className="text-[13px] font-medium text-[var(--color-text-primary)]">
                {t(`settings.permissionRules.${bucket}`)}
              </span>
              <span className="text-xs text-[var(--color-text-tertiary)]">
                {t(`settings.permissionRules.${bucket}Hint`)}
              </span>
            </div>
            {buckets[bucket].length > 0 && (
              <ul className="mb-2 space-y-1" aria-label={t(`settings.permissionRules.${bucket}`)}>
                {buckets[bucket].map((rule, index) => (
                  <li key={`${rule}:${index}`} className="flex items-center gap-2">
                    <code className="min-w-0 flex-1 truncate rounded-[var(--radius-xs)] bg-[var(--color-surface-code)] px-2 py-1 font-mono text-xs text-[var(--color-text-primary)]">
                      {rule}
                    </code>
                    <IconButton
                      icon={<X size={12} strokeWidth={1.75} aria-hidden="true" />}
                      label={t('settings.permissionRules.remove', { rule })}
                      size="2xs"
                      tone="danger"
                      disabled={saving}
                      onClick={() => removeRule(bucket, index)}
                    />
                  </li>
                ))}
              </ul>
            )}
            <RuleAddRow
              bucket={bucket}
              draft={drafts[bucket]}
              saving={saving}
              onDraftChange={value => setDrafts(current => ({ ...current, [bucket]: value }))}
              onAdd={() => addRule(bucket)}
            />
          </SettingsBlock>
        </SettingsGroup>
      ))}
    </SettingsSection>
  )
}

function RuleAddRow({ bucket, draft, saving, onDraftChange, onAdd }: {
  bucket: RuleBucket
  draft: string
  saving: boolean
  onDraftChange: (value: string) => void
  onAdd: () => void
}) {
  const t = useTranslation()
  const inputId = `permission-rule-${bucket}`
  const error = useMemo(() => validateRuleDraft(draft.trim()), [draft])
  const showError = error !== null && draft.trim() !== ''
  return (
    <div className="flex items-start gap-2">
      <div className="min-w-0 flex-1">
        <label htmlFor={inputId} className="sr-only">{t('settings.permissionRules.addLabel')}</label>
        <input
          id={inputId}
          type="text"
          value={draft}
          spellCheck={false}
          autoComplete="off"
          placeholder={t(`settings.permissionRules.${bucket}Placeholder`)}
          aria-invalid={showError}
          aria-describedby={showError ? `${inputId}-error` : undefined}
          disabled={saving}
          onChange={event => onDraftChange(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter') {
              event.preventDefault()
              onAdd()
            }
          }}
          className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 font-mono text-xs text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-border-focus)]"
        />
        {showError && (
          <p id={`${inputId}-error`} role="alert" className="mt-1 text-xs text-[var(--color-error)]">
            {t(`settings.permissionRules.${error}`)}
          </p>
        )}
      </div>
      <Button
        variant="secondary"
        size="base"
        icon={<Plus size={14} strokeWidth={1.75} aria-hidden="true" />}
        aria-label={t('settings.permissionRules.add')}
        disabled={saving || draft.trim() === '' || error !== null}
        onClick={onAdd}
      >
        {t('settings.permissionRules.add')}
      </Button>
    </div>
  )
}
