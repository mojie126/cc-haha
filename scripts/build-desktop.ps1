<#
.SYNOPSIS
cc-haha 桌面端本地构建脚本。

.DESCRIPTION
按顺序构建 Windows x64 本地安装包，各步骤可按需跳过：
  1. 依赖检查       仓库根、desktop、mobile 缺少 node_modules 时自动安装
  2. sidecar        desktop/sidecars/claude-sidecar.ts → desktop/src-tauri/binaries
  3. 渲染进程       desktop/src + index.html → desktop/dist（含手机 H5 导出）
  4. Electron 主进程 desktop/electron → desktop/electron-dist
  5. 安装包         electron-builder → desktop/build-artifacts/windows-x64
                    安装包、blockmap、latest.yml 与 win-unpacked 只保留这一份

增量口径：
  · sidecar 比对 desktop/src、desktop/sidecars、desktop/scripts 与仓库 src/ 的最新
    修改时间，产物更新就跳过；
  · 渲染进程比对 desktop/src、desktop/index.html、desktop/vite.config.ts 与仓库
    src/ 的最新修改时间；
  · Electron 主进程比对 desktop/electron；
  · 安装包比对 dist/index.html、electron-dist/main.cjs、sidecar 可执行文件与
    desktop/package.json；
  · -Force 忽略以上判断并清理产物，全部重建。

Windows 打包注意：
  electron-builder 的 rcedit 依赖 winCodeSign-2.6.0.7z，该压缩包内含 macOS 符号
  链接，普通用户权限解压会失败。脚本首次打包时会把缓存预解压到
  %LOCALAPPDATA%\electron-builder\Cache\winCodeSign\winCodeSign-2.6.0，
  并排除 darwin/linux 目录；缓存已存在时直接复用。

示例：
  powershell scripts/build-desktop.ps1                 # 增量构建安装包
  powershell scripts/build-desktop.ps1 -SkipSidecars   # 复用已有 sidecar，只重打前端与安装包
  powershell scripts/build-desktop.ps1 -SkipFrontend   # 只重建 sidecar 与安装包
  powershell scripts/build-desktop.ps1 -FrontendOnly   # 只构建前端产物
  powershell scripts/build-desktop.ps1 -SkipPackage    # 构建前端与 Electron，不打安装包
  powershell scripts/build-desktop.ps1 -DirPackage     # 只产出 win-unpacked 目录
  powershell scripts/build-desktop.ps1 -Force          # 清理产物后全部重建
  powershell scripts/build-desktop.ps1 -Test           # 构建后运行桌面端测试
  powershell scripts/build-desktop.ps1 -Proxy http://127.0.0.1:7890
#>
[CmdletBinding()]
param(
  # 只构建前端产物（dist），不构建 sidecar、Electron 主进程与安装包
  [switch]$FrontendOnly,
  # 跳过前端产物（dist）
  [switch]$SkipFrontend,
  # 跳过 sidecar 编译，复用 desktop/src-tauri/binaries 下已有产物
  [switch]$SkipSidecars,
  # 跳过 Electron 主进程与 preload 打包
  [switch]$SkipElectron,
  # 跳过 electron-builder，只构建到 electron-dist/dist
  [switch]$SkipPackage,
  # 用 electron-builder --dir 只产出未压缩目录，不生成 NSIS 安装包
  [switch]$DirPackage,
  # 忽略产物时间戳，清理后全部重建
  [switch]$Force,
  # 构建完成后运行桌面端测试
  [switch]$Test,
  # 构建前强制重新安装依赖
  [switch]$Install,
  # 依赖下载代理，例如 http://127.0.0.1:7890
  [string]$Proxy = ''
)

$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repo = (Resolve-Path (Join-Path $scriptDir '..')).Path
$desktop = Join-Path $repo 'desktop'
$mobile = Join-Path $repo 'mobile'
$binaries = Join-Path $desktop 'src-tauri\binaries'
$dist = Join-Path $desktop 'dist'
$electronDist = Join-Path $desktop 'electron-dist'
$outputDir = Join-Path $desktop 'build-artifacts\windows-x64'
# 旧版脚本会先输出到 electron 再复制到 windows-x64，清理遗留副本避免双份
$legacyOutput = Join-Path $desktop 'build-artifacts\electron'
$sidecar = Join-Path $binaries 'claude-sidecar-x86_64-pc-windows-msvc.exe'
$desktopPackage = Get-Content (Join-Path $desktop 'package.json') -Raw | ConvertFrom-Json
$version = $desktopPackage.version

function Write-Step {
  param([string]$Message)
  Write-Host "[build-desktop] $Message"
}

function Assert-Command {
  param([string]$Name)
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "[build-desktop] Missing required command: $Name"
  }
}

function Get-LatestWriteTime {
  param([string[]]$Paths)
  $latest = [datetime]::MinValue
  foreach ($path in $Paths) {
    if (-not (Test-Path -LiteralPath $path)) { continue }
    $item = Get-Item -LiteralPath $path
    if ($item.PSIsContainer) {
      $newest = Get-ChildItem -LiteralPath $path -File -Recurse -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1
      if ($newest -and $newest.LastWriteTime -gt $latest) { $latest = $newest.LastWriteTime }
    } elseif ($item.LastWriteTime -gt $latest) {
      $latest = $item.LastWriteTime
    }
  }
  return $latest
}

function Test-NeedsBuild {
  param(
    [string]$Output,
    [string[]]$Inputs
  )
  if ($Force) { return $true }
  if (-not (Test-Path -LiteralPath $Output)) { return $true }
  $outputTime = (Get-Item -LiteralPath $Output).LastWriteTime
  $inputTime = Get-LatestWriteTime -Paths $Inputs
  return $inputTime -gt $outputTime
}

function Ensure-WinCodeSignCache {
  # app-builder 的 rcedit 固定使用 winCodeSign-2.6.0.7z，该压缩包含 macOS 符号
  # 链接，普通权限解压会失败。最终目录 Cache\winCodeSign\winCodeSign-2.6.0 存在
  # 时 app-builder 直接复用，所以这里预解压一份并排除 darwin/linux 目录
  $cacheDir = Join-Path $env:LOCALAPPDATA 'electron-builder\Cache\winCodeSign'
  $finalDir = Join-Path $cacheDir 'winCodeSign-2.6.0'
  if (Test-Path -LiteralPath (Join-Path $finalDir 'rcedit-x64.exe')) { return }

  New-Item -ItemType Directory -Force -Path $finalDir | Out-Null

  # 之前失败的解压已经落下了完整内容（只缺两个符号链接），直接复用
  $partial = Get-ChildItem -LiteralPath $cacheDir -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -ne 'winCodeSign-2.6.0' -and (Test-Path -LiteralPath (Join-Path $_.FullName 'rcedit-x64.exe')) } |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
  if ($partial) {
    Write-Step 'Reusing a partial winCodeSign extraction for rcedit.'
    Copy-Item -Path (Join-Path $partial.FullName '*') -Destination $finalDir -Recurse -Force
    return
  }

  Write-Step 'Downloading winCodeSign tools for rcedit...'
  $archive = Join-Path $cacheDir 'winCodeSign-2.6.0.7z.tmp'
  $url = 'https://github.com/electron-userland/electron-builder-binaries/releases/download/winCodeSign-2.6.0/winCodeSign-2.6.0.7z'
  if ($Proxy) {
    & curl.exe -s -m 180 -x $Proxy -L -o $archive $url
  } else {
    & curl.exe -s -m 180 -L -o $archive $url
  }
  if ($LASTEXITCODE -ne 0) {
    throw '[build-desktop] Failed to download winCodeSign tools.'
  }
  $sevenZip = Join-Path $desktop 'node_modules\7zip-bin\win\x64\7za.exe'
  if (-not (Test-Path -LiteralPath $sevenZip)) {
    throw '[build-desktop] 7za.exe was not found under desktop/node_modules/7zip-bin.'
  }
  & $sevenZip x -y '-x!darwin' '-x!linux' "-o$finalDir" $archive | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw '[build-desktop] Failed to extract winCodeSign tools.'
  }
  Remove-Item -LiteralPath $archive -Force -ErrorAction SilentlyContinue
}

function Invoke-Bun {
  param(
    [string]$WorkingDirectory,
    [string[]]$Arguments
  )
  Push-Location $WorkingDirectory
  try {
    & bun @Arguments
    if ($LASTEXITCODE -ne 0) {
      throw "[build-desktop] bun $($Arguments -join ' ') failed (exit $LASTEXITCODE)"
    }
  } finally {
    Pop-Location
  }
}

function Ensure-Dependencies {
  param([string]$Directory)
  $modules = Join-Path $Directory 'node_modules'
  if (-not $Install -and (Test-Path -LiteralPath $modules)) { return }
  Write-Step "Installing dependencies in $(Split-Path -Leaf $Directory)..."
  Invoke-Bun -WorkingDirectory $Directory -Arguments @('install')
}

Assert-Command 'bun'
Assert-Command 'node'
if (-not $IsWindows -and $env:OS -ne 'Windows_NT') {
  throw '[build-desktop] This script packages the Windows x64 installer and must run on Windows.'
}

if ($Proxy) {
  $env:HTTP_PROXY = $Proxy
  $env:HTTPS_PROXY = $Proxy
}
# 本地构建不签名，避免 electron-builder 查找证书失败
$env:CSC_IDENTITY_AUTO_DISCOVERY = 'false'

Write-Step "Version: $version"
Ensure-Dependencies -Directory $repo
Ensure-Dependencies -Directory $desktop

if ($Force) {
  Write-Step 'Cleaning previous outputs...'
  foreach ($path in @($dist, $electronDist, $outputDir, $legacyOutput)) {
    Remove-Item -LiteralPath $path -Recurse -Force -ErrorAction SilentlyContinue
  }
}

$buildSidecars = $false
$buildFrontend = $false
$buildElectron = $false

if ($FrontendOnly) {
  $buildFrontend = $true
} else {
  $buildFrontend = -not $SkipFrontend
  $buildElectron = -not $SkipElectron
  if (-not $SkipSidecars) {
    $sidecarInputs = @(
      (Join-Path $repo 'src'),
      (Join-Path $desktop 'sidecars'),
      (Join-Path $desktop 'scripts'),
      (Join-Path $desktop 'package.json')
    )
    $buildSidecars = Test-NeedsBuild -Output $sidecar -Inputs $sidecarInputs
    if (-not $buildSidecars) {
      Write-Step 'Sidecar is up to date; skipping.'
    }
  } elseif (-not (Test-Path -LiteralPath $sidecar)) {
    throw '[build-desktop] -SkipSidecars was set but no sidecar executable exists.'
  }
}

if ($buildFrontend) {
  $frontendInputs = @(
    (Join-Path $desktop 'src'),
    (Join-Path $desktop 'index.html'),
    (Join-Path $desktop 'vite.config.ts'),
    (Join-Path $desktop 'package.json'),
    (Join-Path $repo 'src')
  )
  $frontendOutput = Join-Path $dist 'index.html'
  if (-not (Test-NeedsBuild -Output $frontendOutput -Inputs $frontendInputs)) {
    Write-Step 'Renderer is up to date; skipping.'
    $buildFrontend = $false
  }
}

if ($buildElectron) {
  $electronInputs = @(
    (Join-Path $desktop 'electron'),
    (Join-Path $desktop 'package.json')
  )
  $electronOutputFile = Join-Path $electronDist 'main.cjs'
  if (-not (Test-NeedsBuild -Output $electronOutputFile -Inputs $electronInputs)) {
    Write-Step 'Electron main bundle is up to date; skipping.'
    $buildElectron = $false
  }
}

if ($buildSidecars -or $buildFrontend) {
  Ensure-Dependencies -Directory $mobile
}

if ($buildSidecars) {
  Write-Step 'Preparing cloudflared and building sidecars...'
  Invoke-Bun -WorkingDirectory $desktop -Arguments @('run', 'prepare:cloudflared')
  Invoke-Bun -WorkingDirectory $desktop -Arguments @('run', 'build:sidecars')
}

if ($buildFrontend) {
  Write-Step 'Building renderer, preload assets and phone H5 export...'
  Invoke-Bun -WorkingDirectory $desktop -Arguments @('run', 'build')
}

if ($buildElectron) {
  Write-Step 'Building Electron main and preload bundles...'
  Invoke-Bun -WorkingDirectory $desktop -Arguments @('run', 'build:electron')
}

$packageInputs = @(
  (Join-Path $dist 'index.html'),
  (Join-Path $electronDist 'main.cjs'),
  $sidecar,
  (Join-Path $desktop 'package.json')
)
$installerName = "Claude-Code-Haha-$version-Windows-x64-Setup.exe"
$installerPath = Join-Path $outputDir $installerName

$shouldPackage = -not $FrontendOnly -and -not $SkipPackage
if ($shouldPackage -and -not $DirPackage) {
  if (-not $Force -and (Test-Path -LiteralPath $installerPath)) {
    $installerTime = (Get-Item -LiteralPath $installerPath).LastWriteTime
    $packageInputTime = Get-LatestWriteTime -Paths $packageInputs
    if ($packageInputTime -le $installerTime) {
      Write-Step "Installer is up to date: $installerPath"
      $shouldPackage = $false
    }
  }
}

if ($shouldPackage) {
  # 旧版脚本在 build-artifacts\electron 留下的副本不再使用，打包前清掉
  if (Test-Path -LiteralPath $legacyOutput) {
    Remove-Item -LiteralPath $legacyOutput -Recurse -Force -ErrorAction SilentlyContinue
  }
  Ensure-WinCodeSignCache
  $outputOverride = '--config.directories.output=build-artifacts/windows-x64'
  $builderArgs = if ($DirPackage) {
    @('electron-builder', '--win', '--x64', '--publish', 'never', '--dir', $outputOverride)
  } else {
    # target 必须紧跟 --win，放在选项之后会被当成未知参数
    @('electron-builder', '--win', 'nsis', '--x64', '--publish', 'never', $outputOverride)
  }
  Write-Step "Packaging with electron-builder (dir=$DirPackage)..."
  Push-Location $desktop
  try {
    & bunx @builderArgs
    if ($LASTEXITCODE -ne 0) {
      throw "[build-desktop] electron-builder failed (exit $LASTEXITCODE)"
    }
  } finally {
    Pop-Location
  }

  if (-not $DirPackage) {
    Set-Content -Path (Join-Path $outputDir 'BUILD_INFO.txt') -Encoding UTF8 -Value @"
Version: $version
Built at: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz')
Output: $outputDir
"@
  }
}

if ($Test) {
  Write-Step 'Running desktop tests...'
  Push-Location $desktop
  try {
    & bun run test -- --run
    if ($LASTEXITCODE -ne 0) {
      throw "[build-desktop] desktop tests failed (exit $LASTEXITCODE)"
    }
  } finally {
    Pop-Location
  }
}

Write-Step 'Build finished.'
if (-not $DirPackage -and (Test-Path -LiteralPath $installerPath)) {
  Write-Step "Installer: $installerPath"
  Write-Step "Output: $outputDir"
} elseif ($DirPackage) {
  Write-Step "Unpacked app: $(Join-Path $outputDir 'win-unpacked')"
} else {
  Write-Step "Renderer: $dist"
  Write-Step "Electron bundle: $electronDist"
}
