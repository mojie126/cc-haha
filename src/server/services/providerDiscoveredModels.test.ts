/**
 * Unit tests for the saved providers' discovered model catalogs (TTL cache).
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  clearDiscoveredModelsCache,
  getCachedDiscoveredModels,
  isDiscoveredModelsCandidate,
  refreshDiscoveredProviderModels,
  refreshSavedProvidersDiscoveredModels,
} from './providerDiscoveredModels.js'
import type { SavedProvider } from '../types/provider.js'

const provider = (overrides: Partial<SavedProvider> = {}): SavedProvider => ({
  id: 'saved-a',
  presetId: 'custom',
  name: 'Saved A',
  apiKey: 'secret-key',
  baseUrl: 'https://gateway.invalid/v1',
  apiFormat: 'anthropic',
  models: { main: 'mapped-main', opus: 'mapped-main', sonnet: 'mapped-main', haiku: 'mapped-main' },
  ...overrides,
})

beforeEach(async () => {
  const tmpDir = await mkdtemp(path.join(tmpdir(), 'provider-discovered-models-test-'))
  // fetchProviderModels reads user settings for proxy config; keep it pointed
  // at an empty sandbox so a developer's real settings cannot steer the tests.
  process.env.CLAUDE_CONFIG_DIR = tmpDir
  process.env.HOME = tmpDir
  clearDiscoveredModelsCache()
})

afterEach(async () => {
  clearDiscoveredModelsCache()
  const tmpDir = process.env.CLAUDE_CONFIG_DIR
  if (tmpDir) await rm(tmpDir, { recursive: true, force: true })
})

describe('discovered model candidates', () => {
  test('saved API providers qualify; account sign-ins and Magpie do not', () => {
    expect(isDiscoveredModelsCandidate(provider())).toBe(true)
    expect(isDiscoveredModelsCandidate(provider({ runtimeKind: 'openai_oauth' }))).toBe(false)
    expect(isDiscoveredModelsCandidate(provider({ presetId: 'magpie' }))).toBe(false)
  })
})

describe('refreshDiscoveredProviderModels', () => {
  test('probes the provider, caches the list, and reuses it inside the TTL window', async () => {
    let fetchCalls = 0
    const fetchImpl = (async () => {
      fetchCalls += 1
      return new Response(JSON.stringify({ data: [{ id: 'gateway-model-a' }, { id: 'gateway-model-b', owned_by: 'vendor' }] }), { status: 200 })
    }) as typeof fetch

    const first = await refreshDiscoveredProviderModels(provider(), { fetchImpl, now: 1_000 })
    expect(first.map(model => model.id)).toEqual(['gateway-model-a', 'gateway-model-b'])
    expect(getCachedDiscoveredModels('saved-a')).toHaveLength(2)

    const second = await refreshDiscoveredProviderModels(provider(), { fetchImpl, now: 2_000 })
    expect(second).toEqual(first)
    expect(fetchCalls).toBe(1)

    const third = await refreshDiscoveredProviderModels(provider(), { fetchImpl, now: 31_000 })
    expect(third.map(model => model.id)).toEqual(['gateway-model-a', 'gateway-model-b'])
    expect(fetchCalls).toBe(2)
  })

  test('an upstream failure caches an empty list for the same window', async () => {
    let fetchCalls = 0
    const fetchImpl = (async () => {
      fetchCalls += 1
      return new Response('nope', { status: 500 })
    }) as typeof fetch

    const first = await refreshDiscoveredProviderModels(provider(), { fetchImpl, now: 1_000 })
    expect(first).toEqual([])
    const second = await refreshDiscoveredProviderModels(provider(), { fetchImpl, now: 2_000 })
    expect(second).toEqual([])
    expect(fetchCalls).toBe(1)
  })

  test('a missing credential skips the probe and caches empty without touching the network', async () => {
    let fetchCalls = 0
    const fetchImpl = (async () => {
      fetchCalls += 1
      return new Response('[]', { status: 200 })
    }) as typeof fetch

    const models = await refreshDiscoveredProviderModels(provider({ apiKey: '' }), { fetchImpl, now: 1_000 })
    expect(models).toEqual([])
    expect(fetchCalls).toBe(0)
    expect(getCachedDiscoveredModels('saved-a')).toEqual([])
  })
})

describe('refreshSavedProvidersDiscoveredModels', () => {
  test('reports every eligible provider keyed by id and skips the others', async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ data: [{ id: 'gateway-model-a' }] }), { status: 200 })) as typeof fetch
    const models = await refreshSavedProvidersDiscoveredModels(
      [provider(), provider({ id: 'account-b', runtimeKind: 'openai_oauth' })],
      { fetchImpl, now: 1_000 },
    )
    expect(Object.keys(models)).toEqual(['saved-a'])
    expect(models['saved-a']!.map(model => model.id)).toEqual(['gateway-model-a'])
    expect(getCachedDiscoveredModels('account-b')).toEqual([])
  })
})
