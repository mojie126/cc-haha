/**
 * Saved providers' discovered model catalogs — the model list each provider
 * publishes on its Base URL, probed through providerModelCatalog and cached
 * here so the session catalog can merge it without touching the network.
 */

import { fetchProviderModels } from './providerModelCatalog.js'
import { isMagpieProvider } from './magpieGateway.js'
import { getPresetDefaultEnv, resolveProviderApiKey } from './providerRuntimeEnv.js'
import type { ProviderModelInfo, SavedProvider } from '../types/provider.js'

// Same window as Magpie's catalog cache: a picker open refreshes, and the
// session catalog between two opens stays a pure cache read.
const DISCOVERY_TTL_MS = 30_000

type CacheEntry = {
  models: ProviderModelInfo[]
  at: number
}

const cache = new Map<string, CacheEntry>()
const inFlight = new Map<string, Promise<ProviderModelInfo[]>>()

/**
 * Saved API providers whose catalog is discovered from their Base URL. Account
 * sign-ins (OpenAI/Grok/DeepSeek) have fixed catalogs and Magpie's catalog is
 * served by the local gateway itself, so neither is probed here.
 */
export function isDiscoveredModelsCandidate(provider: SavedProvider): boolean {
  return (provider.runtimeKind ?? 'anthropic_compatible') === 'anthropic_compatible'
    && !isMagpieProvider(provider)
}

export function clearDiscoveredModelsCache(): void {
  cache.clear()
}

/** The last discovered catalog for a provider, without probing (empty before the first fetch). */
export function getCachedDiscoveredModels(providerId: string): ProviderModelInfo[] {
  return cache.get(providerId)?.models ?? []
}

/**
 * One provider's catalog, refetched at most every 30s; a failure caches an
 * empty list for the same window so a down upstream is not probed on every
 * picker open. Upstream failures never throw — only fetchProviderModels'
 * own contract errors would, and the probe input is guarded below.
 */
export async function refreshDiscoveredProviderModels(
  provider: SavedProvider,
  options?: { fetchImpl?: typeof fetch; now?: number },
): Promise<ProviderModelInfo[]> {
  const now = options?.now ?? Date.now()
  const cached = cache.get(provider.id)
  if (cached && now - cached.at < DISCOVERY_TTL_MS) return cached.models
  const pending = inFlight.get(provider.id)
  if (pending) return pending

  const probe = (async () => {
    const apiKey = resolveProviderApiKey(provider, getPresetDefaultEnv(provider.presetId))
    const result = apiKey && provider.baseUrl.trim()
      ? await fetchProviderModels(
        {
          baseUrl: provider.baseUrl,
          apiKey,
          ...(provider.proxy && { proxy: provider.proxy }),
        },
        { fetchImpl: options?.fetchImpl },
      )
      : null
    const models = result?.ok ? result.models : []
    cache.set(provider.id, { models, at: now })
    return models
  })()
  inFlight.set(provider.id, probe)
  try {
    return await probe
  } finally {
    inFlight.delete(provider.id)
  }
}

/**
 * Every eligible saved provider's catalog in one refresh, keyed by provider
 * id (GET /api/providers/discovered-models). Candidates probe in parallel.
 */
export async function refreshSavedProvidersDiscoveredModels(
  providers: SavedProvider[],
  options?: { fetchImpl?: typeof fetch; now?: number },
): Promise<Record<string, ProviderModelInfo[]>> {
  const candidates = providers.filter(isDiscoveredModelsCandidate)
  const lists = await Promise.all(
    candidates.map(provider => refreshDiscoveredProviderModels(provider, options)),
  )
  return Object.fromEntries(candidates.map((provider, index) => [provider.id, lists[index]!]))
}
