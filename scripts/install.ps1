# Install the Grok VS Code extension on Windows.
# Usage:  pwsh scripts\install.ps1
# Picks the first .vsix in the repo root, or builds one if none exists.
# Tries `code`, then `code-insiders`, then the well-known install path.

param(
    [string]$VsixPath
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot

function Find-CodeCli {
    foreach ($name in @("code", "code-insiders")) {
        $cmd = Get-Command $name -ErrorAction SilentlyContinue
        if ($cmd) { return $cmd.Source }
    }
    $fallback = "$env:LOCALAPPDATA\Programs\Microsoft VS Code\bin\code.cmd"
    if (Test-Path $fallback) { return $fallback }
    $fallback = "$env:LOCALAPPDATA\Programs\Microsoft VS Code Insiders\bin\code-insiders.cmd"
    if (Test-Path $fallback) { return $fallback }
    throw "Could not find VS Code CLI. Install VS Code or add 'code' to PATH."
}

if (-not $VsixPath) {
    $vsix = Get-ChildItem -Path $repoRoot -Filter "*.vsix" | Select-Object -First 1
    if (-not $vsix) {
        Write-Host "No .vsix found - building one..."
        Push-Location $repoRoot
        try {
            if (-not (Test-Path "node_modules")) { npm install }
            npm run package
            $vsix = Get-ChildItem -Path $repoRoot -Filter "*.vsix" | Select-Object -First 1
        } finally { Pop-Location }
    }
    if (-not $vsix) { throw "Build did not produce a .vsix." }
    $VsixPath = $vsix.FullName
}

$code = Find-CodeCli
Write-Host "Installing $VsixPath via $code"
& $code --install-extension $VsixPath
Write-Host ""
Write-Host "Done. Reload VS Code (Ctrl+Shift+P -> 'Developer: Reload Window') and click the Grok icon."
