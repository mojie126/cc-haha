import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs'
import path from 'node:path'

/** 单个日志文件的上限，超出后轮转为 `.1` 覆盖旧文件 */
const MAX_LOG_BYTES = 1024 * 1024

export type IdlePowerDebugApp = { getPath(name: 'userData'): string }
export type IdlePowerDebug = (event: string, data?: Record<string, unknown>) => void

/**
 * @brief 创建空闲电源诊断日志，逐行追加 JSON 到用户数据目录
 * @param app 只用于解析用户数据目录
 * @return 记录函数，写盘失败时静默忽略，不影响电源功能
 */
export function createIdlePowerDebugLog(app: IdlePowerDebugApp): IdlePowerDebug {
  const file = path.join(app.getPath('userData'), 'idle-power-debug.jsonl')
  const rotated = `${file}.1`
  return (event, data = {}) => {
    try {
      mkdirSync(path.dirname(file), { recursive: true })
      try {
        if (statSync(file).size > MAX_LOG_BYTES) renameSync(file, rotated)
      } catch {
        // 首次写入与轮转失败都不阻断本次记录
      }
      appendFileSync(file, `${JSON.stringify({ ...data, at: new Date().toISOString(), pid: process.pid, event })}\n`)
    } catch {
      // 诊断日志不得影响电源功能
    }
  }
}
