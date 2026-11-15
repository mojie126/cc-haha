import { beforeEach, describe, expect, it } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { spawnSync } from 'node:child_process'
import { handlePromptsApi } from '../api/prompts.js'

let configHome: string
let workspace: string

beforeEach(async () => {
  // getClaudeConfigHomeDir 在进程内记忆结果，整个文件共用一个固定的配置目录
  if (!configHome) {
    configHome = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-prompts-home-'))
    process.env.CLAUDE_CONFIG_DIR = configHome
    process.env.HOME = configHome
    process.env.USERPROFILE = configHome
  }
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-prompts-ws-'))
  workspace = path.join(tmpDir, 'workspace', 'app')
  await fs.mkdir(workspace, { recursive: true })
  // 工作区必须是 git 仓库：findCanonicalGitRoot 会向上攀爬，
  // 不隔离的话会写进本仓库真实的 AGENTS.md
  spawnSync('git', ['init', '-q', workspace])
})

function request(method: string, pathname: string, body?: unknown): Promise<Response> {
  const url = new URL(pathname, 'http://localhost:3456')
  const init: RequestInit = { method }
  if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' }
    init.body = JSON.stringify(body)
  }
  return handlePromptsApi(
    new Request(url.toString(), init),
    url,
    url.pathname.split('/').filter(Boolean),
  )
}

function docsUrl(cwd: string): string {
  return `/api/prompts/docs?cwd=${encodeURIComponent(cwd)}`
}

describe('prompts API', () => {
  it('lists global and project candidate prompt docs with existence', async () => {
    const res = await request('GET', docsUrl(workspace))
    expect(res.status).toBe(200)
    const body = await res.json() as { docs: Array<{ id: string; scope: string; name: string; exists: boolean }> }
    expect(body.docs.map(doc => doc.id)).toEqual([
      'global',
      'project:AGENTS.md',
      'project:CLAUDE.md',
      'project:.claude/CLAUDE.md',
    ])
    expect(body.docs.every(doc => !doc.exists)).toBe(true)
    expect(body.docs[0]!.scope).toBe('global')
  })

  it('saves and reads the global prompt doc', async () => {
    const save = await request('PUT', '/api/prompts/doc', {
      id: 'global',
      cwd: workspace,
      content: '# 全局约定\n\n- 始终使用简体中文回答\n',
    })
    console.log('SAVE_RESPONSE', save.status, await save.text())
    expect(save.status).toBe(200)

    const read = await request('GET', `/api/prompts/doc?id=global&cwd=${encodeURIComponent(workspace)}`)
    expect(read.status).toBe(200)
    const readBody = await read.json() as { doc: { content: string; updatedAt: string; bytes: number } }
    expect(readBody.doc.content).toContain('始终使用简体中文回答')

    const docs = await request('GET', docsUrl(workspace))
    const docsBody = await docs.json() as { docs: Array<{ id: string; exists: boolean }> }
    expect(docsBody.docs.find(doc => doc.id === 'global')!.exists).toBe(true)
  })

  it('saves a project prompt doc into the workspace root', async () => {
    const save = await request('PUT', '/api/prompts/doc', {
      id: 'project:AGENTS.md',
      cwd: workspace,
      content: '# 项目约定',
    })
    console.log('SAVE_RESPONSE', save.status, await save.text())
    expect(save.status).toBe(200)
    const written = await fs.readFile(path.join(workspace, 'AGENTS.md'), 'utf-8')
    expect(written).toBe('# 项目约定')

    const dotClaude = await request('PUT', '/api/prompts/doc', {
      id: 'project:.claude/CLAUDE.md',
      cwd: workspace,
      content: '# .claude 约定',
    })
    expect(dotClaude.status).toBe(200)
    expect(await fs.readFile(path.join(workspace, '.claude', 'CLAUDE.md'), 'utf-8')).toBe('# .claude 约定')
  })

  it('rejects a stale revision with a conflict instead of overwriting', async () => {
    await request('PUT', '/api/prompts/doc', { id: 'project:AGENTS.md', cwd: workspace, content: 'v1' })
    const read = await request('GET', `/api/prompts/doc?id=project:AGENTS.md&cwd=${encodeURIComponent(workspace)}`)
    const doc = (await read.json() as { doc: { updatedAt: string; bytes: number } }).doc

    const stale = await request('PUT', '/api/prompts/doc', {
      id: 'project:AGENTS.md',
      cwd: workspace,
      content: 'v2',
      expectedUpdatedAt: '2000-01-01T00:00:00.000Z',
      expectedBytes: 2,
    })
    expect(stale.status).toBe(409)

    const current = await request('PUT', '/api/prompts/doc', {
      id: 'project:AGENTS.md',
      cwd: workspace,
      content: 'v2',
      expectedUpdatedAt: doc.updatedAt,
      expectedBytes: doc.bytes,
    })
    expect(current.status).toBe(200)
    const after = await request('GET', `/api/prompts/doc?id=project:AGENTS.md&cwd=${encodeURIComponent(workspace)}`)
    expect(((await after.json()) as { doc: { content: string } }).doc.content).toBe('v2')
  })

  it('only serves the allowlisted doc ids', async () => {
    const read = await request('GET', `/api/prompts/doc?id=../secret.md&cwd=${encodeURIComponent(workspace)}`)
    expect(read.status).toBe(400)
    const save = await request('PUT', '/api/prompts/doc', { id: 'notes.md', cwd: workspace, content: 'x' })
    expect(save.status).toBe(400)
  })
})
