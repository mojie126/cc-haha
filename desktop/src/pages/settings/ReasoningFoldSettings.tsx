import { useState } from 'react'
import { SettingsBlock } from '@/components/settings/SettingsSection'
import { Switch } from '@/components/ui/Switch'
import { useTranslation } from '@/i18n'
import { useSettingsStore } from '@/stores/settingsStore'

export function ReasoningFoldSettings() {
  const t = useTranslation()
  const enabled = useSettingsStore(state => state.reasoningFoldEnabled)
  const setEnabled = useSettingsStore(state => state.setReasoningFoldEnabled)
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)

  async function changeEnabled(next: boolean) {
    setFailed(false)
    setSaving(true)
    try {
      await setEnabled(next)
    } catch {
      setFailed(true)
    } finally {
      setSaving(false)
    }
  }

  return (
    <SettingsBlock>
      <Switch
        label={t('settings.general.reasoningFoldEnabled')}
        checked={enabled}
        disabled={saving}
        onChange={next => void changeEnabled(next)}
        description={(
          <span className="block max-w-[68ch] space-y-1 leading-relaxed">
            <span className="block text-[var(--color-text-tertiary)]">
              {t('settings.general.reasoningFoldDescription')}
            </span>
            {failed && (
              <span role="alert" className="block text-[var(--color-error)]">
                {t('settings.general.reasoningFoldSaveFailed')}
              </span>
            )}
          </span>
        )}
      />
    </SettingsBlock>
  )
}
