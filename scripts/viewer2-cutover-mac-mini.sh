#!/bin/bash
# SSH-MCP Viewer2 cutover: ONLY run from an independent, persistent Mac mini
# SSH/Tailscale SSH terminal. Never invoke 'activate' through SSH-MCP itself.
set -euo pipefail
umask 077

ROOT="/opt/homebrew/lib/node_modules"
ACTIVE="$ROOT/ssh-mcp"
NEXT="$ROOT/.ssh-mcp-next-8eb250d"
BACKUP="$HOME/.[REDACTED:entropy:52]"
PREFLIGHT="$HOME/.cache/ssh-mcp-viewer2-audit-lab/viewer2-cutover-preflight-8eb250d.mjs"
STATE="$BACKUP/viewer2-active-rollback-path"
LABEL="gui/$(id -u)/com.openai.tunnel-client.ssh-mcp"

MODE="preflight"
if [ "$#" -gt 0 ]; then MODE="$1"; fi

preflight() {
  if [ -e "$STATE" ]; then
    echo "STOP: A previous activation still has a rollback marker." >&2
    exit 2
  fi
  /opt/homebrew/bin/node "$PREFLIGHT"
}

if [ "$MODE" = "preflight" ]; then
  preflight
  exit 0
fi

if [ ! -t 0 ]; then
  echo "REFUSED: activation/rollback requires a persistent interactive independent terminal." >&2
  exit 2
fi

if [ "$MODE" = "activate" ]; then
  preflight
  echo "Use only from independent SSH/Tailscale SSH, NEVER the SSH-MCP tunnel."
  read -r -p "Type INDEPENDENT-ACTIVATE to switch the running tunnel: " CONFIRM
  if [ "$CONFIRM" != "INDEPENDENT-ACTIVATE" ]; then echo "Not activated."; exit 2; fi

  PREVIOUS="$ROOT/.ssh-mcp-prev-$(date -u +%Y%m%dT%H%M%SZ)"
  if [ -e "$PREVIOUS" ]; then echo "STOP: Previous path already exists" >&2; exit 2; fi

  SWITCH_STARTED=0
  rescue() {
    status="$?"
    if [ "$status" -ne 0 ] && [ "$SWITCH_STARTED" -eq 1 ]; then
      echo "ACTIVATION FAILED: attempting immediate filesystem rollback." >&2
      if [ -d "$PREVIOUS" ]; then
        if [ -d "$ACTIVE" ] && [ ! -e "$NEXT" ]; then mv "$ACTIVE" "$NEXT"; fi
        if [ ! -e "$ACTIVE" ]; then mv "$PREVIOUS" "$ACTIVE"; fi
      fi
      if [ -e "$STATE" ]; then mv "$STATE" "$STATE.failed"; fi
      /bin/launchctl kickstart -k "$LABEL" || true
    fi
  }
  trap rescue EXIT

  SWITCH_STARTED=1
  mv "$ACTIVE" "$PREVIOUS"
  mv "$NEXT" "$ACTIVE"
  printf '%s\n' "$PREVIOUS" > "$STATE"
  /bin/launchctl kickstart -k "$LABEL"
  SWITCH_STARTED=0
  trap - EXIT
  echo "ACTIVATED. Keep this independent terminal open until remote MCP checks pass."
  echo "If any check fails: /bin/bash $HOME/.local/share/ssh-mcp-releases/viewer2-cutover-8eb250d.sh rollback"
  exit 0
fi

if [ "$MODE" = "rollback" ]; then
  if [ ! -f "$STATE" ]; then echo "No pending rollback marker; nothing changed."; exit 2; fi
  IFS= read -r PREVIOUS < "$STATE"
  if [ ! -d "$PREVIOUS" ] || [ ! -d "$ACTIVE" ] || [ -e "$NEXT" ]; then
    echo "STOP: unexpected filesystem state; manual recovery required." >&2
    exit 2
  fi
  echo "Restore previous SSH-MCP installation from protected local directory."
  read -r -p "Type RESTORE-ORIGINAL to roll back: " CONFIRM
  if [ "$CONFIRM" != "RESTORE-ORIGINAL" ]; then echo "No rollback."; exit 2; fi

  mv "$ACTIVE" "$NEXT"
  if ! mv "$PREVIOUS" "$ACTIVE"; then
    mv "$NEXT" "$ACTIVE" || true
    echo "ROLLBACK FILE MOVE FAILED: recovery required." >&2
    exit 3
  fi
  /bin/launchctl kickstart -k "$LABEL"
  mv "$STATE" "$STATE.restored"
  echo "ORIGINAL RESTORED. Verify SSH-MCP 2.2.5 tool connection and audit."
  exit 0
fi

echo "Usage: /bin/bash $0 preflight|activate|rollback" >&2
exit 2