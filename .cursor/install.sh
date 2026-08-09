#!/usr/bin/env bash
# Idempotent install script for Cursor Cloud Agent Builds.
# Runs from the repository root on every Build / dependency refresh.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

log() { printf '[install] %s\n' "$*"; }

ensure_railway_cli() {
  if command -v railway >/dev/null 2>&1; then
    log "Railway CLI already installed: $(railway --version 2>/dev/null || true)"
    return 0
  fi
  log "Installing Railway CLI..."
  curl --retry 3 --retry-delay 5 -fsSL https://railway.com/install.sh | sh
}

ensure_supabase_cli() {
  if command -v supabase >/dev/null 2>&1; then
    log "Supabase CLI already installed: $(supabase --version 2>/dev/null || true)"
    return 0
  fi
  log "Installing Supabase CLI..."
  arch="$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/')"
  curl --retry 3 --retry-delay 5 -fsSL \
    "https://github.com/supabase/cli/releases/latest/download/supabase_linux_${arch}.tar.gz" \
    | tar -xz -C /usr/local/bin supabase
}

ensure_railway_cli
ensure_supabase_cli

log "Installing Node dependencies..."
if [ -f package-lock.json ]; then
  npm ci
else
  npm install
fi

if command -v railway >/dev/null 2>&1; then
  log "Configuring Railway agent tooling (MCP + skills)..."
  railway setup agent -y || log "Railway agent setup skipped (auth may be required later)"
  railway mcp install --agent cursor 2>/dev/null || true
fi

log "CLI versions:"
railway --version
supabase --version

log "Done."
