import { H5Settings } from './settings/H5Settings'
import { getDesktopHost } from '@/lib/desktopHost'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback } from 'react'
import {
  BookOpen,
  Bot,
  Box,
  ChartNoAxesColumn,
  HeartPulse,
  Info,
  MessageSquare,
  Mic,
  MousePointer2,
  PawPrint,
  Plug,
  Puzzle,
  QrCode,
  Server,
  SlidersHorizontal,
  SquareTerminal,
  type LucideIcon,
} from 'lucide-react'
import { useTranslation, getTranslationDictionary, type TranslationKey } from '../i18n'
import { SearchField } from '@/components/ui/SearchField'
import {
  buildSettingsSearchEntries,
  searchSettings,
  type SettingsSearchEntry,
} from '../lib/settingsSearch'
import { useSettingsStore } from '../stores/settingsStore'
import { SettingsPageHeader } from '@/components/settings/SettingsSection'
import { AdapterSettings } from './AdapterSettings'
import { useSkillStore } from '../stores/skillStore'
import { SkillList } from '../components/skills/SkillList'
import { SkillDetail } from '../components/skills/SkillDetail'
import { usePluginStore } from '../stores/pluginStore'
import { PluginList } from '../components/plugins/PluginList'
import { PluginDetail } from '../components/plugins/PluginDetail'
import { ComputerUseSettings } from './ComputerUseSettings'
import { McpSettings } from './McpSettings'
import { TerminalSettings } from './TerminalSettings'
import { DiagnosticsSettings } from './DiagnosticsSettings'
import { ActivitySettings } from './ActivitySettings'
import { MemorySettings } from './MemorySettings'
import { PetSettings } from '../features/pets/PetSettings'
import { useUIStore, type SettingsTab } from '../stores/uiStore'
import { AgentManager } from '../components/settings/AgentManager'
import { H5AccessSettings } from './settings/H5AccessSettings'
import { GeneralSettings } from './settings/GeneralSettings'
import { VoiceInputSettings } from './settings/VoiceInputSettings'
import { AboutSettings } from './settings/AboutSettings'
import { ProviderSettings } from './settings/ProviderSettings'

export function Settings() {
  return getDesktopHost().isDesktop ? <DesktopSettings /> : <H5Settings />
}

type SettingsNavEntry = { tab: SettingsTab; icon: LucideIcon; label: TranslationKey }

const SETTINGS_NAV: SettingsNavEntry[] = [
  { tab: 'providers', icon: Server, label: 'settings.tab.providers' },
  { tab: 'general', icon: SlidersHorizontal, label: 'settings.tab.general' },
  { tab: 'voice', icon: Mic, label: 'settings.tab.voice' },
  { tab: 'h5Access', icon: QrCode, label: 'settings.tab.h5Access' },
  { tab: 'adapters', icon: MessageSquare, label: 'settings.tab.adapters' },
  { tab: 'terminal', icon: SquareTerminal, label: 'settings.tab.terminal' },
  { tab: 'mcp', icon: Plug, label: 'settings.tab.mcp' },
  { tab: 'agents', icon: Bot, label: 'settings.tab.agents' },
  { tab: 'skills', icon: Box, label: 'settings.tab.skills' },
  { tab: 'memory', icon: BookOpen, label: 'settings.tab.memory' },
  { tab: 'plugins', icon: Puzzle, label: 'settings.tab.plugins' },
  { tab: 'pets', icon: PawPrint, label: 'settings.tab.pets' },
  { tab: 'computerUse', icon: MousePointer2, label: 'settings.tab.computerUse' },
  { tab: 'activity', icon: ChartNoAxesColumn, label: 'settings.tab.activity' },
  { tab: 'diagnostics', icon: HeartPulse, label: 'settings.tab.diagnostics' },
]

/** Set apart below a rule, the way the reference rail ends. */
const SETTINGS_NAV_ABOUT: SettingsNavEntry = { tab: 'about', icon: Info, label: 'settings.tab.about' }

const SETTINGS_TAB_LABELS = new Map<SettingsTab, TranslationKey>(
  [...SETTINGS_NAV, SETTINGS_NAV_ABOUT].map(({ tab, label }) => [tab, label]),
)

/**
 * Scroll offsets survive a pane unmount/remount within one app session. They
 * are deliberately not persisted: a restart is a new reading session, and the
 * pane a stored offset belonged to may have a different height.
 */
const settingsScrollPositions: Partial<Record<SettingsTab, number>> = {}

const SETTINGS_SEARCH_LIST_ID = 'settings-search-results'

export function DesktopSettings() {
  const activeTab = useUIStore((s) => s.activeSettingsTab)
  const setActiveTab = useUIStore((s) => s.setActiveSettingsTab)
  const pendingSettingsTab = useUIStore((s) => s.pendingSettingsTab)
  const locale = useSettingsStore((s) => s.locale)
  const contentRef = useRef<HTMLDivElement>(null)
  const highlightedRowRef = useRef<HTMLElement | null>(null)
  const t = useTranslation()

  const clearSearchHighlight = useCallback(() => {
    highlightedRowRef.current?.classList.remove('settings-search-target')
    highlightedRowRef.current = null
  }, [])

  const [searchQuery, setSearchQuery] = useState('')
  const [activeResultIndex, setActiveResultIndex] = useState(0)
  const [pendingScrollTarget, setPendingScrollTarget] = useState<string | null>(null)

  const searchEntries = useMemo(
    () => buildSettingsSearchEntries(getTranslationDictionary(locale)),
    [locale],
  )
  const searchResults = useMemo(
    () => searchSettings(searchEntries, searchQuery),
    [searchEntries, searchQuery],
  )
  const activeResult = searchResults.length > 0
    ? Math.min(activeResultIndex, searchResults.length - 1)
    : 0

  const rememberScrollPosition = () => {
    const element = contentRef.current
    if (element) settingsScrollPositions[activeTab] = element.scrollTop
  }

  useEffect(() => {
    if (!pendingSettingsTab) return
    // A request names a destination, not a reading position: it always lands
    // at the top even when the pane was already open and scrolled.
    settingsScrollPositions[pendingSettingsTab] = 0
    setActiveTab(pendingSettingsTab)
    if (contentRef.current) contentRef.current.scrollTop = 0
    useUIStore.getState().setPendingSettingsTab(null)
  }, [pendingSettingsTab, setActiveTab])

  useLayoutEffect(() => {
    const element = contentRef.current
    if (!element) return
    // A different pane has different rows; the previous mark no longer names
    // anything the reader can see.
    clearSearchHighlight()
    element.scrollTop = settingsScrollPositions[activeTab] ?? 0
  }, [activeTab, clearSearchHighlight])

  useEffect(() => {
    const element = contentRef.current
    if (!element) return
    const handleScroll = () => rememberScrollPosition()
    element.addEventListener('scroll', handleScroll, { passive: true })
    return () => {
      element.removeEventListener('scroll', handleScroll)
    }
  }, [activeTab])

  // The search mark belongs to the row until the reader acts on it, opens
  // another pane, or starts a new search. Touching any control in the pane is
  // "acted on": the setting has now been used, so the marker has done its job.
  useEffect(() => {
    const element = contentRef.current
    if (!element) return
    const handleInteraction = () => clearSearchHighlight()
    element.addEventListener('pointerdown', handleInteraction, { passive: true })
    element.addEventListener('change', handleInteraction)
    element.addEventListener('input', handleInteraction)
    return () => {
      element.removeEventListener('pointerdown', handleInteraction)
      element.removeEventListener('change', handleInteraction)
      element.removeEventListener('input', handleInteraction)
    }
  }, [clearSearchHighlight])

  // Settings panes render lazily, so a result's row may not exist on the first
  // frame after the tab switches. Retry a bounded number of frames.
  useEffect(() => {
    if (!pendingScrollTarget) return
    let cancelled = false
    let frame = 0
    let attempts = 0
    const reveal = () => {
      if (cancelled) return
      const root = contentRef.current
      const target = root ? findSettingsTextTarget(root, pendingScrollTarget) : null
      if (!target) {
        if (attempts < 12) {
          attempts += 1
          frame = window.requestAnimationFrame(reveal)
        }
        return
      }
      target.scrollIntoView?.({ block: 'center' })
      clearSearchHighlight()
      highlightedRowRef.current = target
      target.classList.add('settings-search-target')
      setPendingScrollTarget(null)
    }
    frame = window.requestAnimationFrame(reveal)
    return () => {
      cancelled = true
      window.cancelAnimationFrame(frame)
    }
  }, [pendingScrollTarget, activeTab, clearSearchHighlight])

  const chooseResult = (entry: SettingsSearchEntry) => {
    setActiveTab(entry.tab)
    setPendingScrollTarget(entry.label)
    setSearchQuery('')
    setActiveResultIndex(0)
  }

  const navItem = ({ tab, icon, label }: SettingsNavEntry) => (
    <TabButton key={tab} icon={icon} label={t(label)} active={activeTab === tab} onClick={() => setActiveTab(tab)} />
  )

  const searching = searchQuery.trim().length > 0

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-[var(--color-surface)]">
      <div className="flex-1 flex overflow-hidden">
        {/* The rail sits on the page's own paper, separated by the rule, the
            way every other secondary panel in the app is (the workbench, the
            diff split). The Settings tab is filled with paper so its bottom
            edge runs unbroken into the view it opens onto; a grey rail here
            made it the one tab whose paper met a different colour. */}
        <nav
          data-testid="settings-navigation"
          aria-label={t('settings.title')}
          className="w-[216px] flex-shrink-0 flex flex-col overflow-y-auto border-r border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-[18px]"
        >
          <div className="px-2.5 pb-2 text-xs font-semibold text-[var(--color-text-tertiary)]">{t('settings.title')}</div>
          <div className="shrink-0 px-0.5 pb-2">
            <SearchField
              size="sm"
              label={t('settings.search.placeholder')}
              placeholder={t('settings.search.placeholder')}
              clearLabel={t('settings.search.clear')}
              value={searchQuery}
              onChange={(value) => {
                clearSearchHighlight()
                setSearchQuery(value)
                setActiveResultIndex(0)
              }}
              controlsId={searching && searchResults.length > 0 ? SETTINGS_SEARCH_LIST_ID : undefined}
              activeDescendantId={searching && searchResults.length > 0 ? `${SETTINGS_SEARCH_LIST_ID}-${activeResult}` : undefined}
              onNavigate={(direction) => {
                if (searchResults.length === 0) return
                setActiveResultIndex((current) => {
                  const next = current + (direction === 'down' ? 1 : -1)
                  return (next + searchResults.length) % searchResults.length
                })
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && searchResults[activeResult]) {
                  event.preventDefault()
                  chooseResult(searchResults[activeResult]!)
                }
                if (event.key === 'Escape' && searching) {
                  event.preventDefault()
                  setSearchQuery('')
                }
              }}
            />
          </div>
          {searching ? (
            searchResults.length > 0 ? (
              <div
                id={SETTINGS_SEARCH_LIST_ID}
                role="listbox"
                aria-label={t('settings.search.results')}
                className="flex flex-col gap-px"
              >
                {searchResults.map((entry, index) => (
                  <div
                    key={entry.key}
                    id={`${SETTINGS_SEARCH_LIST_ID}-${index}`}
                    role="option"
                    aria-selected={index === activeResult}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => chooseResult(entry)}
                    className={`flex w-full cursor-pointer flex-col rounded-[var(--radius-sm)] px-2.5 py-1.5 text-left transition-colors ${
                      index === activeResult
                        ? 'bg-[var(--color-surface-selected)]'
                        : 'hover:bg-[var(--color-surface-hover)]'
                    }`}
                  >
                    <span className="min-w-0 truncate text-[13px] text-[var(--color-text-primary)]">{entry.label}</span>
                    <span className="min-w-0 truncate text-[11px] text-[var(--color-text-tertiary)]">
                      {t(SETTINGS_TAB_LABELS.get(entry.tab) ?? 'settings.tab.general')}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="px-2.5 py-2 text-xs text-[var(--color-text-tertiary)]">
                {t('settings.search.noResults')}
              </p>
            )
          ) : (
            <>
              <div className="flex flex-col gap-px">
                {SETTINGS_NAV.map(navItem)}
              </div>
              <div aria-hidden="true" className="mx-2.5 my-2 h-px shrink-0 bg-[var(--color-border)]" />
              {navItem(SETTINGS_NAV_ABOUT)}
            </>
          )}
        </nav>

        {/* The page frame every pane shares — one width, one set of gutters —
            so a pane never sets its own max-width. It is fluid up to 1120px:
            at the common 1440px window it fills the column, and on a large
            display it stops before rows stretch past reading distance. The old
            700px cap left explorer-style panes (memory, skills) cramped in the
            middle of an empty page. One width for every pane, so switching
            panes never moves the header. */}
        <div ref={contentRef} className="flex-1 min-w-0 overflow-y-auto [scrollbar-gutter:stable]">
          <div
            data-testid="settings-page-frame"
            className="mx-auto w-full px-10 pt-9 pb-[72px]"
            style={{ maxWidth: 'var(--settings-page-width, 1120px)' }}
          >
            {activeTab === 'providers' && <ProviderSettings />}
            {activeTab === 'activity' && <ActivitySettings />}
            {activeTab === 'general' && <GeneralSettings />}
            {activeTab === 'voice' && <VoiceInputSettings />}
            {activeTab === 'h5Access' && <H5AccessSettings />}
            {activeTab === 'adapters' && <AdapterSettings />}
            {activeTab === 'terminal' && <TerminalSettings showPreferences />}
            {activeTab === 'mcp' && <McpSettings />}
            {activeTab === 'agents' && <AgentManager />}
            {activeTab === 'skills' && <SkillSettings />}
            {activeTab === 'memory' && <MemorySettings />}
            {activeTab === 'plugins' && <PluginSettings />}
            {activeTab === 'pets' && <PetSettings />}
            {activeTab === 'computerUse' && <ComputerUseSettings />}
            {activeTab === 'diagnostics' && <DiagnosticsSettings />}
            {activeTab === 'about' && <AboutSettings />}
          </div>
        </div>
      </div>
    </div>
  )
}

function findSettingsTextTarget(root: HTMLElement, label: string): HTMLElement | null {
  const wanted = label.trim()
  if (!wanted) return null
  let best: HTMLElement | null = null
  for (const element of root.querySelectorAll<HTMLElement>('h2,h3,label,button,span,div,p')) {
    const text = element.textContent?.trim()
    if (!text || text.length > 400) continue
    if (text !== wanted && !text.includes(wanted)) continue
    if (!best || text.length < (best.textContent?.trim().length ?? Number.POSITIVE_INFINITY)) {
      best = element
    }
  }
  if (!best) return null
  // Mark the whole setting, not just the label that matched: a row's control
  // and description belong to the same result.
  return best.closest<HTMLElement>('[data-settings-row]') ?? best.closest<HTMLElement>('section') ?? best
}

function TabButton({ icon: Icon, label, active, onClick }: { icon: LucideIcon; label: string; active: boolean; onClick: () => void }) {
  const ref = useRef<HTMLButtonElement>(null)

  // The rail is taller than its viewport, and Settings remounts whenever the
  // tab is re-entered — from a trace tab's "back to list", say — with the
  // scroll position reset to the top. Without this the selected section can be
  // highlighted somewhere off-screen. `nearest` is a no-op when already visible.
  useEffect(() => {
    if (!active) return
    ref.current?.scrollIntoView?.({ block: 'nearest' })
  }, [active])

  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={`flex h-[30px] w-full shrink-0 items-center gap-2.5 rounded-[var(--radius-sm)] px-2.5 text-left text-[13px] transition-[background-color,color] duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)] ${
        active
          ? 'bg-[var(--color-surface-selected)] font-medium text-[var(--color-text-primary)]'
          : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]'
      }`}
    >
      <Icon
        size={15}
        strokeWidth={1.75}
        aria-hidden="true"
        className={`shrink-0 ${active ? 'text-[var(--color-brand)]' : 'text-[var(--color-text-tertiary)]'}`}
      />
      <span className="min-w-0 truncate">{label}</span>
    </button>
  )
}

// ─── Skill Settings ──────────────────────────────────────

function SkillSettings() {
  const selectedSkill = useSkillStore((s) => s.selectedSkill)
  const t = useTranslation()

  if (selectedSkill) {
    return (
      <div className="w-full min-w-0">
        <SkillDetail />
      </div>
    )
  }

  return (
    <div className="w-full min-w-0">
      <SettingsPageHeader
        title={t('settings.tab.skills')}
        description={t('settings.skills.description')}
        className="mb-5"
      />
      <SkillList />
    </div>
  )
}

function PluginSettings() {
  const selectedPlugin = usePluginStore((s) => s.selectedPlugin)
  const t = useTranslation()

  if (selectedPlugin) {
    return (
      <div className="w-full min-w-0">
        <PluginDetail />
      </div>
    )
  }

  return (
    <div className="w-full min-w-0">
      <SettingsPageHeader
        title={t('settings.tab.plugins')}
        description={t('settings.plugins.description')}
        className="mb-5"
      />
      <PluginList />
    </div>
  )
}
