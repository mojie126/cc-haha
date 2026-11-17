import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { join } from 'node:path'
import { findExplicitProjectRoot, readProjectIdentity } from './projectIdentity.js'

test('Windows project roots match separators and case by components, choosing the nearest root', () => {
  const parent = 'D:/Github/obsidian'
  const child = `${parent}/projects/Tools/输入法`
  expect(findExplicitProjectRoot('d:\\github\\OBSIDIAN\\projects\\Tools\\输入法\\src', [parent, child], path.win32)).toBe(child)
  expect(findExplicitProjectRoot('D:/Github/obsidian-other/src', [parent], path.win32)).toBeNull()
  expect(findExplicitProjectRoot('E:/Github/obsidian/src', [parent], path.win32)).toBeNull()
})

test('unreadable preference files keep legacy grouping instead of failing identity reads', async () => {
  const configDir = await mkdtemp(join(tmpdir(), 'project-identity-'))
  const filePath = join(configDir, 'cc-haha', 'desktop-ui.json')
  try {
    // 用一个同名目录制造读取失败，验证身份读取退回旧分组而不是抛错
    await mkdir(filePath, { recursive: true })
    expect(readProjectIdentity(configDir)).toEqual({ roots: [], revision: '[]' })
    // 读取失败的空快照不缓存，恢复可读后立即生效
    await rm(filePath, { recursive: true, force: true })
    await writeFile(filePath, JSON.stringify({ explicitProjectRoots: [configDir] }))
    expect(readProjectIdentity(configDir).roots).toEqual([configDir])
  } finally {
    await rm(configDir, { recursive: true, force: true })
  }
})
