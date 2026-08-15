#!/usr/bin/env bash
# Idempotent install script for Cursor Cloud Agent Builds.
# Runs from the repository root on every Build / dependency refresh.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

log() { printf '[install] %s\n' "$*"; }

# The Railway installer drops the binary in ~/.railway/bin and only wires it into
# ~/.bashrc, which a non-interactive install shell never sources. Put it on PATH
# up front so detection, `railway setup agent`, and the version check all resolve.
export PATH="$HOME/.railway/bin:$PATH"

ensure_railway_cli() {
  if command -v railway >/dev/null 2>&1; then
    log "Railway CLI already installed: $(railway --version 2>/dev/null || true)"
    return 0
  fi
  log "Installing Railway CLI..."
  curl --retry 3 --retry-delay 5 -fsSL https://railway.com/install.sh | sh
  export PATH="$HOME/.railway/bin:$PATH"
}

ensure_supabase_cli() {
  if command -v supabase >/dev/null 2>&1; then
    log "Supabase CLI already installed: $(supabase --version 2>/dev/null || true)"
    return 0
  fi
  log "Installing Supabase CLI..."
  arch="$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/')"
  # /usr/local/bin is writable directly when install runs as root (e.g. Docker
  # build); fall back to sudo when a non-root install user cannot write there.
  local tar_cmd="tar -xz -C /usr/local/bin supabase"
  if [ ! -w /usr/local/bin ] && command -v sudo >/dev/null 2>&1; then
    tar_cmd="sudo tar -xz -C /usr/local/bin supabase"
  fi
  curl --retry 3 --retry-delay 5 -fsSL \
    "https://github.com/supabase/cli/releases/latest/download/supabase_linux_${arch}.tar.gz" \
    | $tar_cmd
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
railway --version || log "Railway CLI not on PATH in this shell (available in new terminals via ~/.bashrc)"
supabase --version || log "Supabase CLI not found on PATH"

log "Done."
