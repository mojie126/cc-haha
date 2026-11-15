/**
 * Prompt doc REST API
 *
 * GET /api/prompts/docs?cwd=...   — 候选提示词文档：全局（~/.claude/CLAUDE.md）
 *                                   与项目（root 的 AGENTS.md、CLAUDE.md、.claude/CLAUDE.md）
 * GET /api/prompts/doc?id=...&cwd=...  — 读取一篇（未创建时 404）
 * PUT  /api/prompts/doc           — 保存 { id, cwd, content, expectedUpdatedAt?, expectedBytes? }
 *
 * CLI 把这些文档作为项目记忆加载，并在运行时解析其中的 @相对路径 导入，
 * 编辑器只需保真保留文本。
 */

import * as fs from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import * as path from 'node:path'
import { ApiError, errorResponse } from '../middleware/errorHandler.js'
import { findCanonicalGitRoot } from '../../utils/git.js'
import { getCwd } from '../../utils/cwd.js'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'

const MAX_PROMPT_DOC_BYTES = 512 * 1024
const promptDocWriteQueues = new Map<string, Promise<unknown>>()

type PromptDocCandidate = {
  id: string
  scope: 'global' | 'project'
  name: string
}

type PromptDocStat = {
  bytes: number
  updatedAt: string
}

const PROMPT_DOC_CANDIDATES: PromptDocCandidate[] = [
  { id: 'global', scope: 'global', name: 'CLAUDE.md' },
  { id: 'project:AGENTS.md', scope: 'project', name: 'AGENTS.md' },
  { id: 'project:CLAUDE.md', scope: 'project', name: 'CLAUDE.md' },
  { id: 'project:.claude/CLAUDE.md', scope: 'project', name: '.claude/CLAUDE.md' },
]

function resolvePromptDocRoot(cwd?: string): string {
  const base = cwd || getCwd()
  const root = findCanonicalGitRoot(base) ?? base
  return root.endsWith(path.sep) ? root.slice(0, -path.sep.length) : root
}

function resolvePromptDocPath(id: string, cwd?: string): { fullPath: string; candidate: PromptDocCandidate } {
  const candidate = PROMPT_DOC_CANDIDATES.find((entry) => entry.id === id)
  if (!candidate) throw ApiError.badRequest(`Unknown prompt doc id: ${id}`)

  if (candidate.scope === 'global') {
    return { fullPath: path.join(getClaudeConfigHomeDir(), candidate.name), candidate }
  }

  const root = resolvePromptDocRoot(cwd)
  const fullPath = path.resolve(root, candidate.name)
  // id 来自白名单映射，路径必然位于根内；防御式断言保留。
  if (!fullPath.startsWith(`${root}${path.sep}`)) {
    throw ApiError.badRequest('Prompt doc path escapes workspace root')
  }
  return { fullPath, candidate }
}

async function statPromptDoc(fullPath: string): Promise<PromptDocStat | null> {
  try {
    const stat = await fs.stat(fullPath)
    return { bytes: stat.size, updatedAt: stat.mtime.toISOString() }
  } catch {
    return null
  }
}

export async function handlePromptsApi(
  req: Request,
  url: URL,
  segments: string[],
): Promise<Response> {
  try {
    const sub = segments[2]
    const cwd = url.searchParams.get('cwd') || undefined

    if (sub === 'docs' && req.method === 'GET') {
      const docs = await Promise.all(PROMPT_DOC_CANDIDATES.map(async (candidate) => {
        const { fullPath } = resolvePromptDocPath(candidate.id, cwd)
        const stat = await statPromptDoc(fullPath)
        return {
          id: candidate.id,
          scope: candidate.scope,
          name: candidate.name,
          exists: stat !== null,
          bytes: stat?.bytes ?? 0,
          updatedAt: stat?.updatedAt ?? null,
        }
      }))
      return Response.json({ docs })
    }

    if (sub === 'doc') {
      if (req.method === 'GET') {
        const id = url.searchParams.get('id') ?? ''
        const { fullPath, candidate } = resolvePromptDocPath(id, cwd)
        const stat = await statPromptDoc(fullPath)
        if (!stat) throw ApiError.notFound(`Prompt doc not found: ${candidate.name}`)
        const content = await fs.readFile(fullPath, 'utf-8')
        return Response.json({ doc: { id: candidate.id, name: candidate.name, content, ...stat } })
      }

      if (req.method === 'PUT') {
        const body = await parseJsonBody(req)
        const cwd = typeof body.cwd === 'string' ? body.cwd : url.searchParams.get('cwd') || undefined
        const id = typeof body.id === 'string' ? body.id : ''
        const content = typeof body.content === 'string' ? body.content : undefined
        if (content === undefined) {
          throw ApiError.badRequest('Missing or invalid "content" in request body')
        }
        if (Buffer.byteLength(content, 'utf-8') > MAX_PROMPT_DOC_BYTES) {
          throw ApiError.badRequest('Prompt doc content exceeds 512 KB')
        }
        const expectedUpdatedAt =
          typeof body.expectedUpdatedAt === 'string' ? body.expectedUpdatedAt : undefined
        const expectedBytes =
          typeof body.expectedBytes === 'number' ? body.expectedBytes : undefined
        if ((expectedUpdatedAt === undefined) !== (expectedBytes === undefined)) {
          throw ApiError.badRequest(
            '"expectedUpdatedAt" and "expectedBytes" must be provided together as a valid file revision',
          )
        }

        const { fullPath, candidate } = resolvePromptDocPath(id, cwd)
        const stat = await enqueuePromptDocWrite(fullPath, async () => {
          if (expectedUpdatedAt !== undefined && expectedBytes !== undefined) {
            const current = await statPromptDoc(fullPath)
            if (
              !current ||
              current.updatedAt !== expectedUpdatedAt ||
              current.bytes !== expectedBytes
            ) {
              throw ApiError.conflict(`Prompt doc changed before it could be saved: ${candidate.name}`)
            }
          }
          if (candidate.scope === 'project') {
            await fs.mkdir(path.dirname(fullPath), { recursive: true })
          }
          console.log('PROMPT_SAVE_PATH', fullPath)
          await writeFileAtomically(fullPath, content)
          return statPromptDoc(fullPath)
        })
        if (!stat) throw ApiError.conflict(`Prompt doc vanished while saving: ${candidate.name}`)
        return Response.json({ ok: true, doc: { id: candidate.id, name: candidate.name, ...stat } })
      }

      throw methodNotAllowed(req.method)
    }

    throw ApiError.notFound(`Unknown prompts endpoint: ${sub ?? ''}`)
  } catch (error) {
    return errorResponse(error)
  }
}

async function enqueuePromptDocWrite<T>(fullPath: string, task: () => Promise<T>): Promise<T> {
  const previous = promptDocWriteQueues.get(fullPath) ?? Promise.resolve()
  const current = previous.then(task, task)
  promptDocWriteQueues.set(fullPath, current)
  try {
    return await current
  } finally {
    if (promptDocWriteQueues.get(fullPath) === current) {
      promptDocWriteQueues.delete(fullPath)
    }
  }
}

async function writeFileAtomically(filePath: string, content: string): Promise<void> {
  const tempPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`,
  )
  let handle: fs.FileHandle | undefined
  try {
    handle = await fs.open(tempPath, 'wx', 0o600)
    await handle.writeFile(content, { encoding: 'utf-8' })
    await handle.sync()
    await handle.close()
    handle = undefined
    await fs.rename(tempPath, filePath)
  } finally {
    await handle?.close().catch(() => undefined)
    await fs.unlink(tempPath).catch(() => undefined)
  }
}

async function parseJsonBody(req: Request): Promise<Record<string, unknown>> {
  try {
    return await req.json() as Record<string, unknown>
  } catch {
    throw ApiError.badRequest('Invalid JSON body')
  }
}

function methodNotAllowed(method: string): ApiError {
  return new ApiError(405, `Method ${method} not allowed`, 'METHOD_NOT_ALLOWED')
}
