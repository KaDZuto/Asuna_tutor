#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"

find_asuna() {
  if [ -n "${ASUNA_DIR:-}" ] && [ -d "$ASUNA_DIR" ]; then echo "$ASUNA_DIR"; return 0; fi
  for c in \
    "$HOME/Downloads/Asuna_Electron_PC-main-node26-fixed-latest/самая новая версия" \
    "$HOME/src/hermes_paperclip_agent" \
    "$HOME/hermes_paperclip_agent" \
    "$HOME/Projects/hermes_paperclip_agent"; do
    [ -f "$c/main.js" ] && { echo "$c"; return 0; }
  done
  return 1
}

ASUNA_DIR="$(find_asuna)" || {
  echo "Не найден каталог Асунны. Укажи его явно:"
  echo "ASUNA_DIR=/path/to/asuna $0"
  exit 1
}

ELECTRON="$ROOT/node_modules/electron/dist/electron"
[ -x "$ELECTRON" ] || ELECTRON="$(command -v electron || true)"
[ -x "$ELECTRON" ] || { echo "Нет electron. Выполни: npm install"; exit 1; }

(
  cd "$ASUNA_DIR"
  [ -d node_modules/electron/dist ] || npm install
  exec ./node_modules/.bin/electron .
) &
ASUNA_PID=$!
trap 'kill $ASUNA_PID 2>/dev/null || true' EXIT

cd "$ROOT"
"$ELECTRON" .
