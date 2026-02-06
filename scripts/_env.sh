#!/usr/bin/env bash
set -euo pipefail

# Ensure Pear + Node 22 are available in the current shell.
# Intended usage:
#   . scripts/_env.sh

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  echo "This script must be sourced: . scripts/_env.sh" >&2
  exit 1
fi

# Prefer Node 22 via fnm if it's available.
if command -v fnm >/dev/null 2>&1; then
  eval "$(fnm env --shell bash)"
  fnm use 22 >/dev/null 2>&1 || true
fi

# Prefer Pear's stable bin dir if present (avoids PATH warnings with some setups).
# Note: fnm mutates PATH, so do this after fnm setup.
PEAR_BIN="$HOME/Library/Application Support/pear/bin"
if [[ -d "$PEAR_BIN" ]]; then
  case ":$PATH:" in
    *":$PEAR_BIN:"*) ;;
    *) export PATH="$PEAR_BIN:$PATH" ;;
  esac
fi

NODE_VER="$(node -v 2>/dev/null || true)"
NODE_MAJOR="$(echo "$NODE_VER" | sed -E 's/^v([0-9]+).*/\1/' || true)"
if [[ "$NODE_MAJOR" != "22" ]]; then
  echo "Node 22.x is required. Current: ${NODE_VER:-<missing>}" >&2
  return 1
fi

if ! command -v pear >/dev/null 2>&1; then
  echo "pear is not installed. With Node 22 active, run: npm install -g pear" >&2
  return 1
fi
