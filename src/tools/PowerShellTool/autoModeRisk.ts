/**
 * Static risk gate for PowerShell in auto mode.
 *
 * Auto mode normally lets the action classifier decide, but Windows has no
 * system sandbox to contain a misjudged command. These patterns therefore run
 * before the classifier and turn the action into a non-classifier-approvable
 * safety check, so it always reaches the human approval dialog. Over-prompting
 * is intentional here: a missed destructive command modifies the real machine.
 */

export type PowerShellAutoModeRisk = {
  reason: string
}

const ELEVATION_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /\bstart-process\b[^|;&\n]*(?:^|\s)-verb:?\s*['"]?runas\b/i,
    reason: 'Command requests elevation (Start-Process -Verb RunAs)',
  },
  {
    pattern: /(?:^|[|;&\n({])\s*(?:sudo|runas)(?:\.exe)?\b/i,
    reason: 'Command requests elevation (sudo / runas)',
  },
]

const SERVICE_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern:
      /\b(?:start|stop|restart|set|new|remove|suspend|resume|register|unregister)-service\b/i,
    reason: 'Command starts, stops, or reconfigures a Windows service',
  },
  {
    pattern: /\b(?:stop|restart)-computer\b/i,
    reason: 'Command shuts down or restarts the machine',
  },
  {
    pattern:
      /\bsc(?:\.exe)?\s+(?:start|stop|pause|continue|delete|create|config|failure|sdset)\b/i,
    reason: 'Command controls a Windows service through sc.exe',
  },
  {
    pattern: /\bnet(?:\.exe)?\s+(?:start|stop)\s+/i,
    reason: 'Command starts or stops a Windows service through net.exe',
  },
]

const DESTRUCTION_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  {
    // PowerShell 允许参数前缀缩写（-Rec 即 -Recurse），cmd 的递归删除用 /s。
    pattern: /\b(?:remove-item|rm|ri|del|erase|rd|rmdir)\b[^|;&\n]*(?:\s-(?:recurse|rec|r)\b|\/s\b)/i,
    reason: 'Command recursively deletes files',
  },
  {
    pattern: /\b(?:remove-item|rm|ri|del|erase|rd|rmdir)\b[^|;&\n]*\*/i,
    reason: 'Command deletes a wildcard path',
  },
  {
    pattern:
      /\b(?:remove-item|rm|ri|del|erase|rd|rmdir)\b[^|;&\n]*\b[a-z]:[\\/](?:\s|$)/i,
    reason: 'Command deletes a drive root',
  },
  {
    pattern:
      /\b(?:remove-item|rm|ri|del|erase|rd|rmdir)\b[^|;&\n]*(?:\$(?:env:)?home\b|\$env:userprofile\b|(?:^|\s)~(?=[\\/\s]|$))/i,
    reason: 'Command deletes the user home directory',
  },
  {
    pattern:
      /\b(?:format-volume|clear-disk|initialize-disk|remove-partition|resize-partition|clear-recyclebin)\b/i,
    reason: 'Command formats or clears a disk or volume',
  },
  {
    pattern: /\bdiskpart\b/i,
    reason: 'Command runs diskpart',
  },
]

const SECURITY_WEAKENING_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /\bset-mppreference\b[^|;&\n]*-disable\w*/i,
    reason: 'Command disables a Windows Defender protection',
  },
  {
    pattern:
      /\bset-executionpolicy\b[^|;&\n]*(?:bypass|byp|unrestricted)\b/i,
    reason: 'Command weakens the PowerShell execution policy',
  },
]

const PERSISTENCE_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern:
      /\b(?:register-scheduledtask|new-scheduledtask|schtasks(?:\.exe)?\s+\/create)\b/i,
    reason: 'Command registers a scheduled task that persists after the session',
  },
  {
    pattern: /\bnew-service\b/i,
    reason: 'Command registers a Windows service that persists after the session',
  },
]

const DOWNLOAD_EXECUTE_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern:
      /\b(?:invoke-expression|iex)\b[^|;&\n]*(?:invoke-webrequest|\biwr\b|invoke-restmethod|\birm\b|downloadstring|downloadfile|net\.webclient|start-bitstransfer|\bcurl\b|\bwget\b)/i,
    reason: 'Command downloads and executes remote code',
  },
  {
    // 最常见的写法是下载结果直接通过管道交给 iex（`iwr URL | iex`）。
    pattern:
      /\b(?:invoke-webrequest|iwr|invoke-restmethod|irm|downloadstring|downloadfile|net\.webclient|start-bitstransfer|curl|wget)\b[^|;&\n]*\|\s*(?:invoke-expression|iex)\b/i,
    reason: 'Command downloads and executes remote code',
  },
]

const REGISTRY_SYSTEM_HIVE =
  /\b(?:hklm(?::|[\\/])|hkey_local_machine\b|hkcr(?::|[\\/])|hkey_classes_root\b|hku(?::|[\\/])|hkey_users\b)/i
const REGISTRY_WRITE =
  /\b(?:set|new|remove|rename|move|copy|clear|add|restore)-(?:item|itemproperty)\b|\breg(?:\.exe)?\s+(?:add|delete|import|restore|load)\b/i
const REGISTRY_RUN_KEY = /\bcurrentversion[\\/]+run(?:once)?\b/i

const ALL_PATTERN_GROUPS = [
  ELEVATION_PATTERNS,
  SERVICE_PATTERNS,
  DESTRUCTION_PATTERNS,
  SECURITY_WEAKENING_PATTERNS,
  PERSISTENCE_PATTERNS,
  DOWNLOAD_EXECUTE_PATTERNS,
]

/** 是否命中自动模式静态高危规则，命中则返回升级人工审批的理由 */
export function getPowerShellAutoModeRisk(
  command: string,
): PowerShellAutoModeRisk | null {
  // 统一各类破折号与全角减号前缀，便于 `–Verb RunAs` 之类写法命中同一规则
  const normalized = command.replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212\uff0d]/g, '-')
  for (const group of ALL_PATTERN_GROUPS) {
    for (const { pattern, reason } of group) {
      if (pattern.test(normalized)) return { reason }
    }
  }
  const writesRegistry = REGISTRY_WRITE.test(normalized)
  if (writesRegistry && REGISTRY_SYSTEM_HIVE.test(normalized)) {
    return { reason: 'Command writes the Windows registry system hive' }
  }
  if (writesRegistry && REGISTRY_RUN_KEY.test(normalized)) {
    return {
      reason: 'Command writes a registry Run key that persists after the session',
    }
  }
  return null
}
