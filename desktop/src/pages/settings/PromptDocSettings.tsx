import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { SelectField } from '@/components/ui/SelectField'
import {
  SettingsBlock,
  SettingsGroup,
  SettingsRow,
  SettingsSection,
} from '@/components/settings/SettingsSection'
import { useSessionStore } from '@/stores/sessionStore'
import { useTranslation } from '../../i18n'
import { promptsApi, type PromptDocId, type PromptDocMeta } from '../../api/prompts'

type PromptDocDraft = {
  content: string
  baseline: { updatedAt: string; bytes: number } | null
}

const DEFAULT_DOC_ID: PromptDocId = 'global'

/**
 * 系统提示词编辑，维护全局（~/.claude/CLAUDE.md）与项目（root 的
 * AGENTS.md、CLAUDE.md、.claude/CLAUDE.md）提示词文档。文档中的 @相对路径
 * 引用由 CLI 的内存导入机制在运行时解析，这里只保真编辑文本。
 */
export function PromptDocSettings() {
  const t = useTranslation()
  const sessions = useSessionStore((s) => s.sessions)
  const activeSessionId = useSessionStore((s) => s.activeSessionId)
  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId),
    [activeSessionId, sessions],
  )
  const cwd = activeSession?.workDir || activeSession?.projectPath || undefined

  const [docs, setDocs] = useState<PromptDocMeta[]>([])
  const [docId, setDocId] = useState<PromptDocId>(DEFAULT_DOC_ID)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<PromptDocDraft>({ content: '', baseline: null })
  const [reading, setReading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<number | null>(null)

  const readDoc = useCallback(async (id: PromptDocId, cwdValue: string) => {
    setReading(true)
    setError(null)
    try {
      const { doc } = await promptsApi.readDoc(id, cwdValue)
      setDraft({ content: doc.content, baseline: { updatedAt: doc.updatedAt, bytes: doc.bytes } })
    } catch {
      // 未创建（404）与读取失败都落到空稿，保存时以无基线创建
      setDraft({ content: '', baseline: null })
    } finally {
      setReading(false)
    }
  }, [])

  const loadDocs = useCallback(async (cwdValue: string) => {
    try {
      const { docs: entries } = await promptsApi.listDocs(cwdValue)
      setDocs(entries)
    } catch {
      setDocs([])
    }
  }, [])

  useEffect(() => {
    setEditing(false)
    setError(null)
    setSavedAt(null)
    setDocId(DEFAULT_DOC_ID)
    if (cwd) {
      void loadDocs(cwd)
      void readDoc(DEFAULT_DOC_ID, cwd)
    }
  }, [cwd, loadDocs, readDoc])

  const handleDocSelect = useCallback((id: PromptDocId) => {
    setDocId(id)
    setSavedAt(null)
    setError(null)
    if (cwd) void readDoc(id, cwd)
  }, [cwd, readDoc])

  const startEditing = useCallback(() => {
    setSavedAt(null)
    setError(null)
    setEditing(true)
  }, [])

  const cancelEditing = useCallback(() => {
    setEditing(false)
    setError(null)
    if (cwd) void readDoc(docId, cwd)
  }, [cwd, docId, readDoc])

  const save = useCallback(async () => {
    if (!cwd || saving) return
    setSaving(true)
    setError(null)
    try {
      const { doc } = await promptsApi.saveDoc({
        id: docId,
        cwd,
        content: draft.content,
        ...(draft.baseline && {
          expectedUpdatedAt: draft.baseline.updatedAt,
          expectedBytes: draft.baseline.bytes,
        }),
      })
      setDraft({ content: draft.content, baseline: { updatedAt: doc.updatedAt, bytes: doc.bytes } })
      setSavedAt(Date.now())
      void loadDocs(cwd)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(
        message.toLowerCase().includes('changed before it could be saved')
          ? t('settings.prompts.conflict')
          : message,
      )
    } finally {
      setSaving(false)
    }
  }, [cwd, docId, draft, loadDocs, saving, t])

  const docLabel = useCallback((meta: PromptDocMeta) => {
    const scopeLabel = meta.scope === 'global'
      ? t('settings.prompts.scopeGlobal')
      : t('settings.prompts.scopeProject')
    const missing = meta.exists ? '' : ` · ${t('settings.prompts.notCreated')}`
    return `${scopeLabel} · ${meta.name}${missing}`
  }, [t])

  // 项目文档在前，全局文档固定在列表末尾
  const orderedDocs = useMemo(() => [
    ...docs.filter((meta) => meta.scope === 'project'),
    ...docs.filter((meta) => meta.scope === 'global'),
  ], [docs])

  const selectedMeta = orderedDocs.find((meta) => meta.id === docId) ?? null

  return (
    <SettingsSection
      title={t('settings.prompts.title')}
      description={t('settings.prompts.description')}
    >
      <SettingsGroup>
        <SettingsRow
          title={t('settings.prompts.document')}
          description={cwd ? undefined : t('settings.prompts.noWorkspace')}
        >
          <div className="flex items-center gap-2">
            <SelectField<PromptDocId>
              label={t('settings.prompts.document')}
              labelHidden
              size="sm"
              value={docId}
              onChange={handleDocSelect}
              options={orderedDocs.map((meta) => ({ value: meta.id, label: docLabel(meta) }))}
              containerClassName="max-w-[300px]"
            />
            <Button
              size="sm"
              variant="secondary"
              disabled={!cwd}
              loading={reading}
              onClick={startEditing}
            >
              {editing ? t('settings.prompts.reload') : t('settings.prompts.edit')}
            </Button>
          </div>
        </SettingsRow>
        {editing && (
          <SettingsBlock>
            {selectedMeta && !selectedMeta.exists && (
              <p className="mb-2 text-xs text-[var(--color-text-tertiary)]">
                {t('settings.prompts.notCreated')}
              </p>
            )}
            <textarea
              value={draft.content}
              spellCheck={false}
              onChange={(event) => {
                const next = event.currentTarget.value
                setDraft((current) => ({ ...current, content: next }))
              }}
              className="min-h-[320px] w-full resize-y rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5 font-mono text-xs leading-5 text-[var(--color-text-primary)] outline-none transition-colors focus-visible:border-[var(--color-border-focus)]"
            />
            <div className="mt-2 flex items-center justify-end gap-2">
              {error ? (
                <p role="alert" className="mr-auto text-xs text-[var(--color-error)]">{error}</p>
              ) : savedAt !== null ? (
                <p role="status" className="mr-auto text-xs text-[var(--color-text-tertiary)]">
                  {t('settings.prompts.saved')}
                </p>
              ) : null}
              <Button size="sm" variant="ghost" onClick={cancelEditing} disabled={saving}>
                {t('settings.prompts.cancel')}
              </Button>
              <Button size="sm" onClick={() => void save()} loading={saving}>
                {t('settings.prompts.save')}
              </Button>
            </div>
            <p className="mt-2 text-[11px] leading-4 text-[var(--color-text-tertiary)]">
              {t('settings.prompts.refHint')}
            </p>
          </SettingsBlock>
        )}
      </SettingsGroup>
    </SettingsSection>
  )
}
