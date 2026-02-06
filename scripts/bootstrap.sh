#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Ensure Node 22.x in this shell (required by SKILL.md). Prefer fnm if available.
if command -v fnm >/dev/null 2>&1; then
  eval "$(fnm env --shell bash)"
  fnm install 22 >/dev/null 2>&1 || true
  fnm use 22 >/dev/null
fi

# Prefer Pear's stable bin dir if present (avoids PATH warnings with some setups).
# Note: fnm mutates PATH, so do this after fnm setup.
PEAR_BIN="$HOME/Library/Application Support/pear/bin"
if [[ -d "$PEAR_BIN" ]]; then
  export PATH="$PEAR_BIN:$PATH"
fi

NODE_VER="$(node -v 2>/dev/null || true)"
NODE_MAJOR="$(echo "$NODE_VER" | sed -E 's/^v([0-9]+).*/\1/' || true)"
if [[ "$NODE_MAJOR" != "22" ]]; then
  echo "ERROR: Node 22.x is required (see SKILL.md). Current: ${NODE_VER:-<missing>}" >&2
  exit 1
fi

if ! command -v pear >/dev/null 2>&1; then
  npm install -g pear
fi

pear -v
npm install
