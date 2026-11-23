import { describe, expect, it } from 'bun:test'
import type { Tool, ToolUseContext } from 'src/Tool.js'
import {
  outputSchema,
  permissionPromptToolResultToPermissionDecision,
} from './PermissionPromptToolResultSchema.js'

function makeContext(): ToolUseContext {
  return {
    abortController: new AbortController(),
    setAppState: () => {},
  } as unknown as ToolUseContext
}

const tool = { name: 'Write' } as Tool

describe('permissionPromptToolResultToPermissionDecision', () => {
  it('leaves the turn running when a deny omits interrupt', () => {
    const context = makeContext()

    const decision = permissionPromptToolResultToPermissionDecision(
      { behavior: 'deny', message: 'nope' },
      tool,
      { file_path: '/tmp/a.sh' },
      context,
    )

    expect(decision.behavior).toBe('deny')
    // The denial has to survive as a tool_result so the model can see it and
    // write a closing reply. Aborting here ends the turn silently instead.
    expect(context.abortController.signal.aborted).toBe(false)
  })

  it('aborts the turn when a deny explicitly asks to interrupt', () => {
    const context = makeContext()

    permissionPromptToolResultToPermissionDecision(
      { behavior: 'deny', message: 'nope', interrupt: true },
      tool,
      { file_path: '/tmp/a.sh' },
      context,
    )

    expect(context.abortController.signal.aborted).toBe(true)
  })

  it('never aborts on allow', () => {
    const context = makeContext()

    const decision = permissionPromptToolResultToPermissionDecision(
      { behavior: 'allow', updatedInput: {} },
      tool,
      { file_path: '/tmp/a.sh' },
      context,
    )

    expect(decision.behavior).toBe('allow')
    // An empty updatedInput means "use the original" (mobile push responses).
    expect((decision as { updatedInput: unknown }).updatedInput).toEqual({
      file_path: '/tmp/a.sh',
    })
    expect(context.abortController.signal.aborted).toBe(false)
  })
})

// The question card's image answers travel as `contentBlocks` on the
// permission response. This schema is what the SDK host's answer is parsed
// through, and zod drops unknown keys: without the field here the server-side
// images arrived, matched the answer text, and then never reached the model.
describe('contentBlocks on a permission response', () => {
  const imageBlock = {
    type: 'image' as const,
    source: { type: 'base64' as const, media_type: 'image/png' as const, data: 'AAAA' },
  }

  it('keeps attached image blocks on an allow decision', () => {
    const parsed = outputSchema().parse({
      behavior: 'allow',
      updatedInput: { answers: {} },
      contentBlocks: [imageBlock, { type: 'text', text: 'Attached images: shot.png' }],
    })

    expect(parsed.behavior).toBe('allow')
    expect((parsed as { contentBlocks?: unknown[] }).contentBlocks).toEqual([
      imageBlock,
      { type: 'text', text: 'Attached images: shot.png' },
    ])
  })

  it('keeps attached image blocks on a deny decision', () => {
    const parsed = outputSchema().parse({
      behavior: 'deny',
      message: 'chat about this',
      contentBlocks: [imageBlock],
    })

    expect(parsed.behavior).toBe('deny')
    expect((parsed as { contentBlocks?: unknown[] }).contentBlocks).toEqual([imageBlock])
  })

  it('passes contentBlocks through to the permission decision', () => {
    const context = makeContext()
    const parsed = outputSchema().parse({
      behavior: 'allow',
      updatedInput: { answers: { Q: 'A' } },
      contentBlocks: [imageBlock],
    })

    const decision = permissionPromptToolResultToPermissionDecision(
      parsed,
      tool,
      { answers: {} },
      context,
    )

    expect((decision as { contentBlocks?: unknown[] }).contentBlocks).toEqual([imageBlock])
  })
})
