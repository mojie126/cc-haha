# Claude Code Haha Desktop

基于 Tauri 2 + React 的桌面客户端。

## 开发

```bash
bun install
bun run tauri dev
```

## 构建

```bash
# macOS (Apple Silicon)
./scripts/build-macos-arm64.sh

# Windows (x64, MSI only)
.\scripts\build-windows-x64.ps1

# Windows (x64) 本地增量构建，安装包输出到 build-artifacts/windows-x64
powershell ..\scripts\build-desktop.ps1
```

构建产物位于 `build-artifacts/` 目录，文件名会显式包含平台、架构和包类型。`../scripts/build-desktop.ps1` 会跳过未变化的 sidecar、渲染进程、Electron 主进程与安装包，需要全部重建时加 `-Force`，只构建前端时加 `-FrontendOnly`。

## 常见问题

### macOS 提示"已损坏，无法打开"

```bash
xattr -cr /Applications/Claude\ Code\ Haha.app
```
