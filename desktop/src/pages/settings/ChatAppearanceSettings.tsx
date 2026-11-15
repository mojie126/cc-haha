import { useEffect, useId, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { SelectField } from '@/components/ui/SelectField'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import {
  SettingsBlock,
  SettingsGroup,
  SettingsRow,
  SettingsSection,
} from '@/components/settings/SettingsSection'
import { MarkdownRenderer } from '@/components/markdown/MarkdownRenderer'
import { useTranslation } from '@/i18n'
import { getChatAppearanceStyle, type ChatAppearance } from '@/lib/chatAppearance'
import { useChatAppearanceStore } from '@/stores/chatAppearanceStore'
import {
  type SelectionMenuPlacement,
  useSelectionMenuPlacementStore,
} from '@/stores/selectionMenuPlacementStore'

export function ChatAppearanceSettings() {
  const t = useTranslation()
  const { appearance, setAppearance, resetAppearance } = useChatAppearanceStore()
  const { placement, setPlacement } = useSelectionMenuPlacementStore()
  const sizeId = useId()
  const previewId = useId()
  const widthMatch = /^(\d+(?:\.\d+)?)(px|%)$/.exec(appearance.customWidth)
  const [customAmountDraft, setCustomAmountDraft] = useState(widthMatch?.[1] ?? '1200')
  const [customUnitDraft, setCustomUnitDraft] = useState<'px' | '%'>((widthMatch?.[2] as 'px' | '%') ?? 'px')
  useEffect(() => {
    const match = /^(\d+(?:\.\d+)?)(px|%)$/.exec(appearance.customWidth)
    if (match) {
      setCustomAmountDraft(match[1]!)
      setCustomUnitDraft(match[2] as 'px' | '%')
    }
  }, [appearance.customWidth, appearance.width])
  // 失焦或单位切换时才合成并应用，输入过程不做钳制回退
  const applyCustomWidthDraft = (unit?: 'px' | '%') => {
    const unitValue = unit ?? customUnitDraft
    setAppearance({ customWidth: `${customAmountDraft.trim()}${unitValue}` })
  }

  return (
    <SettingsSection
      title={t('settings.chatAppearance.title')}
      description={t('settings.chatAppearance.description')}
      action={(
        <Button size="sm" variant="ghost" onClick={resetAppearance}>
          {t('settings.chatAppearance.reset')}
        </Button>
      )}
    >
      <SettingsGroup>
        <SettingsRow title={t('settings.chatAppearance.font')}>
          <SegmentedControl<ChatAppearance['font']>
            label={t('settings.chatAppearance.font')}
            size="sm"
            value={appearance.font}
            onChange={(font) => setAppearance({ font })}
            items={[
              { value: 'system', label: t('settings.chatAppearance.fontSystem') },
              { value: 'sans', label: t('settings.chatAppearance.fontSans') },
              { value: 'serif', label: t('settings.chatAppearance.fontSerif') },
              { value: 'mono', label: t('settings.chatAppearance.fontMono') },
            ]}
          />
        </SettingsRow>
        <SettingsRow title={t('settings.chatAppearance.fontSize')} htmlFor={sizeId} description={t('settings.chatAppearance.hint')}>
          <div className="flex items-center gap-2.5">
            <input
              id={sizeId}
              type="range"
              min={12}
              max={24}
              step={1}
              value={appearance.fontSize}
              aria-valuetext={`${appearance.fontSize}px`}
              onChange={(event) => setAppearance({ fontSize: Number(event.currentTarget.value) })}
              className="w-[150px] cursor-pointer rounded-[var(--radius-sm)] accent-[var(--color-brand)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--color-border-focus)]"
            />
            <output htmlFor={sizeId} className="w-[38px] font-mono text-xs tabular-nums text-[var(--color-text-secondary)]">
              {appearance.fontSize}px
            </output>
          </div>
        </SettingsRow>
        <SettingsRow title={t('settings.chatAppearance.width')}>
          <SegmentedControl<ChatAppearance['width']>
            label={t('settings.chatAppearance.width')}
            size="sm"
            value={appearance.width}
            onChange={(width) => setAppearance({ width })}
            items={[
              { value: 'standard', label: t('settings.chatAppearance.widthStandard') },
              { value: 'wide', label: t('settings.chatAppearance.widthWide') },
              { value: 'full', label: t('settings.chatAppearance.widthFull') },
              { value: 'custom', label: t('settings.chatAppearance.widthCustom') },
            ]}
          />
          {appearance.width === 'custom' && (
            <>
              <Input
                size="sm"
                inputMode="decimal"
                value={customAmountDraft}
                spellCheck={false}
                aria-label={t('settings.chatAppearance.widthCustom')}
                placeholder="1200"
                onChange={(event) => setCustomAmountDraft(event.currentTarget.value)}
                onBlur={() => applyCustomWidthDraft()}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') applyCustomWidthDraft()
                }}
                className="w-[110px]"
              />
              <SelectField<'px' | '%'>
                label={t('settings.chatAppearance.widthUnit')}
                labelHidden
                size="sm"
                value={customUnitDraft}
                onChange={(unit) => {
                  setCustomUnitDraft(unit)
                  applyCustomWidthDraft(unit)
                }}
                options={[
                  { value: 'px', label: 'px' },
                  { value: '%', label: '%' },
                ]}
                containerClassName="w-[76px]"
              />
              <span className="text-xs text-[var(--color-text-tertiary)]">
                {t('settings.chatAppearance.widthCustomHint')}
              </span>
            </>
          )}
        </SettingsRow>
        <SettingsRow
          title={t('settings.chatAppearance.selectionMenuPlacement')}
          description={t('settings.chatAppearance.selectionMenuPlacementHint')}
        >
          <SegmentedControl<SelectionMenuPlacement>
            label={t('settings.chatAppearance.selectionMenuPlacement')}
            size="sm"
            value={placement}
            onChange={setPlacement}
            items={[
              { value: 'auto', label: t('settings.chatAppearance.selectionMenuPlacementAuto') },
              { value: 'above', label: t('settings.chatAppearance.selectionMenuPlacementAbove') },
            ]}
          />
        </SettingsRow>
        <SettingsBlock>
          <p id={previewId} className="mb-2 text-xs font-medium text-[var(--color-text-tertiary)]">{t('settings.chatAppearance.preview')}</p>
          <div
            role="region"
            aria-labelledby={previewId}
            className="min-w-0 overflow-hidden rounded-[var(--radius-md)] bg-[var(--color-surface-container)] px-4 py-3"
            style={getChatAppearanceStyle(appearance)}
          >
            <MarkdownRenderer className="chat-reading-markdown" content={t('settings.chatAppearance.previewMarkdown')} />
          </div>
        </SettingsBlock>
      </SettingsGroup>
    </SettingsSection>
  )
}
