import { useEffect, useId, useState } from 'react'

import { Input } from '@/components/ui/Input'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { SelectField } from '@/components/ui/SelectField'
import { SettingsGroup, SettingsRow, SettingsSection } from '@/components/settings/SettingsSection'
import { useTranslation } from '@/i18n'
import {
  applySettingsPageWidth,
  normalizeSettingsPageWidth,
  persistSettingsPageWidth,
  readSettingsPageWidth,
  type SettingsPageWidthMode,
  type SettingsPageWidthPreference,
} from '@/lib/settingsPageWidth'

/**
 * The Settings frame's width, in the same preset/custom shape as the chat
 * width: a wide display should not leave two thirds of the pane empty, and a
 * narrow one should not force long descriptions into wraps.
 */
export function SettingsPageWidthSettings() {
  const t = useTranslation()
  const unitId = useId()
  const [preference, setPreference] = useState<SettingsPageWidthPreference>(() => readSettingsPageWidth())
  const initialMatch = /^(\d+(?:\.\d+)?)(px|%)$/.exec(preference.customWidth)
  const [customAmount, setCustomAmount] = useState(initialMatch?.[1] ?? '1600')
  const [customUnit, setCustomUnit] = useState<'px' | '%'>((initialMatch?.[2] as 'px' | '%') ?? 'px')

  useEffect(() => {
    applySettingsPageWidth(preference)
  }, [preference])

  const updatePreference = (patch: Partial<SettingsPageWidthPreference>) => {
    const next = normalizeSettingsPageWidth({ ...preference, ...patch })
    persistSettingsPageWidth(next)
    applySettingsPageWidth(next)
    setPreference(next)
  }

  const applyCustomWidth = (unit: 'px' | '%' = customUnit) => {
    updatePreference({ mode: 'custom', customWidth: `${customAmount.trim()}${unit}` })
  }

  return (
    <SettingsSection
      title={t('settings.pageWidth.title')}
      description={t('settings.pageWidth.description')}
    >
      <SettingsGroup>
        <SettingsRow title={t('settings.pageWidth.title')}>
          <SegmentedControl<SettingsPageWidthMode>
            label={t('settings.pageWidth.title')}
            size="sm"
            value={preference.mode}
            onChange={(mode) => updatePreference({ mode })}
            items={[
              { value: 'standard', label: t('settings.pageWidth.standard') },
              { value: 'wide', label: t('settings.pageWidth.wide') },
              { value: 'full', label: t('settings.pageWidth.full') },
              { value: 'custom', label: t('settings.pageWidth.custom') },
            ]}
          />
        </SettingsRow>
        {preference.mode === 'custom' && (
          <SettingsRow title={t('settings.pageWidth.custom')} layout="inline">
            <Input
              id={unitId}
              size="sm"
              inputMode="decimal"
              value={customAmount}
              spellCheck={false}
              aria-label={t('settings.pageWidth.custom')}
              placeholder={customUnit === '%' ? '90' : '1600'}
              onChange={(event) => setCustomAmount(event.currentTarget.value)}
              onBlur={() => applyCustomWidth()}
              onKeyDown={(event) => {
                if (event.key === 'Enter') applyCustomWidth()
              }}
              className="w-[110px]"
            />
            <SelectField<'px' | '%'>
              label={t('settings.pageWidth.unit')}
              labelHidden
              size="sm"
              value={customUnit}
              onChange={(unit) => {
                setCustomUnit(unit)
                applyCustomWidth(unit)
              }}
              options={[
                { value: 'px', label: 'px' },
                { value: '%', label: '%' },
              ]}
              containerClassName="w-[76px]"
            />
            <span className="text-xs text-[var(--color-text-tertiary)]">
              {t('settings.pageWidth.customHint')}
            </span>
          </SettingsRow>
        )}
      </SettingsGroup>
    </SettingsSection>
  )
}
