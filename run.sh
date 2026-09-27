#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
exec ./node_modules/electron/dist/electron "$@" .
