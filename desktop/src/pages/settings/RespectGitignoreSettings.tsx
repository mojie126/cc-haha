import { useEffect, useMemo, useState } from 'react'

import { settingsApi } from '@/api/settings'
import {
  SettingsBlock,
  SettingsGroup,
  SettingsRow,
  SettingsSection,
  SettingsSwitchRow,
} from '@/components/settings/SettingsSection'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { useTranslation } from '@/i18n'
import { useSessionStore } from '@/stores/sessionStore'
import { useSettingsStore } from '@/stores/settingsStore'

type ProjectRespectGitignore = 'inherit' | 'on' | 'off'

/**
 * 文件补全的 .gitignore 开关，全局值写入用户设置，项目值写入项目 `.claude/settings.json`
 * 并优先于全局值，选择“跟随全局”时删除项目键恢复继承
 */
export function RespectGitignoreSettings() {
  const t = useTranslation()
  const globalEnabled = useSettingsStore(state => state.respectGitignore)
  const setGlobalEnabled = useSettingsStore(state => state.setRespectGitignore)
  const sessions = useSessionStore(state => state.sessions)
  const activeSessionId = useSessionStore(state => state.activeSessionId)

  const projectRoot = useMemo(() => {
    const active = sessions.find(session => session.id === activeSessionId)
    return active?.projectRoot ?? active?.workDir ?? null
  }, [sessions, activeSessionId])

  const [globalSaving, setGlobalSaving] = useState(false)
  const [globalFailed, setGlobalFailed] = useState(false)
  const [projectValue, setProjectValue] = useState<ProjectRespectGitignore>('inherit')
  const [projectLoading, setProjectLoading] = useState(false)
  const [projectSaving, setProjectSaving] = useState(false)
  const [projectFailed, setProjectFailed] = useState(false)

  useEffect(() => {
    let active = true
    setProjectFailed(false)
    if (!projectRoot) {
      setProjectValue('inherit')
      setProjectLoading(false)
      return
    }
    setProjectLoading(true)
    setProjectValue('inherit')
    void settingsApi.getProject(projectRoot).then((settings) => {
      if (!active) return
      const value = settings.respectGitignore
      setProjectValue(value === true ? 'on' : value === false ? 'off' : 'inherit')
      setProjectLoading(false)
    }, () => {
      if (!active) return
      setProjectLoading(false)
      setProjectFailed(true)
    })
    return () => { active = false }
  }, [projectRoot])

  async function changeGlobalEnabled(next: boolean) {
    setGlobalFailed(false)
    setGlobalSaving(true)
    try {
      await setGlobalEnabled(next)
    } catch {
      setGlobalFailed(true)
    } finally {
      setGlobalSaving(false)
    }
  }

  async function changeProjectValue(next: ProjectRespectGitignore) {
    if (!projectRoot || projectSaving || next === projectValue) return
    const previous = projectValue
    setProjectValue(next)
    setProjectFailed(false)
    setProjectSaving(true)
    try {
      await settingsApi.updateProject(
        { respectGitignore: next === 'inherit' ? null : next === 'on' },
        projectRoot,
      )
    } catch {
      setProjectValue(previous)
      setProjectFailed(true)
    } finally {
      setProjectSaving(false)
    }
  }

  const effectiveScopeKey = projectValue === 'inherit'
    ? 'fileSearch.respectGitignoreEffectiveGlobal'
    : 'fileSearch.respectGitignoreEffectiveProject'
  const effectiveValueKey = (projectValue === 'inherit' ? globalEnabled : projectValue === 'on')
    ? 'fileSearch.respectGitignoreOn'
    : 'fileSearch.respectGitignoreOff'
  const projectDisabled = !projectRoot || projectLoading || projectSaving

  return (
    <SettingsSection
      title={t('settings.general.fileCompletionTitle')}
      description={t('settings.general.fileCompletionDescription')}
    >
      <SettingsGroup>
        <SettingsSwitchRow
          title={t('settings.general.respectGitignoreGlobal')}
          description={t('settings.general.respectGitignoreGlobalDescription')}
          checked={globalEnabled}
          disabled={globalSaving}
          onChange={(enabled) => void changeGlobalEnabled(enabled)}
          footer={globalFailed
            ? <span role="alert" className="text-xs text-[var(--color-error)]">{t('fileSearch.respectGitignoreSaveFailed')}</span>
            : undefined}
        />
        <SettingsRow
          title={t('settings.general.respectGitignoreProject')}
          description={projectRoot
            ? <span className="font-mono break-all">{projectRoot}</span>
            : t('fileSearch.respectGitignoreNoProject')}
          layout="inline"
          footer={projectFailed
            ? <span role="alert" className="text-xs text-[var(--color-error)]">{t('fileSearch.respectGitignoreSaveFailed')}</span>
            : undefined}
        >
          <SegmentedControl<ProjectRespectGitignore>
            label={t('settings.general.respectGitignoreProject')}
            size="sm"
            value={projectValue}
            onChange={(value) => void changeProjectValue(value)}
            items={[
              { value: 'inherit', label: t('fileSearch.respectGitignoreInherit'), disabled: projectDisabled },
              { value: 'on', label: t('fileSearch.respectGitignoreOn'), disabled: projectDisabled },
              { value: 'off', label: t('fileSearch.respectGitignoreOff'), disabled: projectDisabled },
            ]}
          />
        </SettingsRow>
        <SettingsBlock>
          <p className="text-xs leading-[1.5] text-[var(--color-text-tertiary)]" role="status" aria-live="polite">
            {t(effectiveScopeKey, { value: t(effectiveValueKey) })}
            <span className="ml-1">{t('fileSearch.respectGitignorePriorityHint')}</span>
          </p>
        </SettingsBlock>
      </SettingsGroup>
    </SettingsSection>
  )
}
