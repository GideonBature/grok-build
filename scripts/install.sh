#!/usr/bin/env bash
# Install the Grok VS Code extension on macOS / Linux / WSL.
# Usage:  ./scripts/install.sh [path/to/file.vsix]
# Picks the first .vsix in the repo root, or builds one if none exists.

set -euo pipefail
repo_root="$(cd "$(dirname "$0")/.." && pwd)"

find_code_cli() {
    for name in code code-insiders; do
        if command -v "$name" >/dev/null 2>&1; then
            echo "$name"; return 0
        fi
    done
    # macOS install paths
    for path in \
        "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" \
        "/Applications/Visual Studio Code - Insiders.app/Contents/Resources/app/bin/code-insiders" \
    ; do
        [ -x "$path" ] && { echo "$path"; return 0; }
    done
    echo "Could not find VS Code CLI. Install VS Code or add 'code' to PATH." >&2
    return 1
}

vsix="${1-}"
if [ -z "$vsix" ]; then
    vsix=$(ls "$repo_root"/*.vsix 2>/dev/null | head -n1 || true)
    if [ -z "$vsix" ]; then
        echo "No .vsix found — building one..."
        cd "$repo_root"
        [ -d node_modules ] || npm install
        npm run package
        vsix=$(ls "$repo_root"/*.vsix | head -n1)
    fi
fi
[ -f "$vsix" ] || { echo "vsix not found: $vsix" >&2; exit 1; }

code=$(find_code_cli)
echo "Installing $vsix via $code"
"$code" --install-extension "$vsix"
echo
echo "Done. Reload VS Code (Ctrl+Shift+P -> 'Developer: Reload Window') and click the Grok icon."
