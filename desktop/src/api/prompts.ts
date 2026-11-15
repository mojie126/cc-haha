import { api } from './client'

export type PromptDocScope = 'global' | 'project'

export type PromptDocId = 'global' | 'project:AGENTS.md' | 'project:CLAUDE.md' | 'project:.claude/CLAUDE.md'

export type PromptDocMeta = {
  id: PromptDocId
  scope: PromptDocScope
  name: string
  exists: boolean
  bytes: number
  updatedAt: string | null
}

export type PromptDocDetail = {
  id: PromptDocId
  name: string
  content: string
  bytes: number
  updatedAt: string
}

export const promptsApi = {
  listDocs: (cwd: string) => {
    return api.get<{ docs: PromptDocMeta[] }>(`/api/prompts/docs?cwd=${encodeURIComponent(cwd)}`)
  },

  readDoc: (id: PromptDocId, cwd: string) => {
    const query = new URLSearchParams({ id, cwd })
    return api.get<{ doc: PromptDocDetail }>(`/api/prompts/doc?${query.toString()}`)
  },

  saveDoc: (input: {
    id: PromptDocId
    cwd: string
    content: string
    expectedUpdatedAt?: string
    expectedBytes?: number
  }) => api.put<{ ok: true; doc: { id: PromptDocId; name: string; bytes: number; updatedAt: string } }>('/api/prompts/doc', input),
}
