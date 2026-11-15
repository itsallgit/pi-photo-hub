#!/bin/bash
# install-health-log.sh - register (or --remove) the per-minute health-log cron job for user pi.
# Safe to run repeatedly. Called by bootstrap.sh; removed by cleanup.sh.
#   bash scripts/install-health-log.sh            install / refresh
#   bash scripts/install-health-log.sh --remove   uninstall
set -euo pipefail

RUN_USER="pi"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT="$REPO_ROOT/scripts/health-log.sh"
TAG="# pi-photo-hub health-log"

run_crontab() {
  if [ "$(id -un)" = "$RUN_USER" ]; then crontab "$@"; else sudo crontab -u "$RUN_USER" "$@"; fi
}

current=$(run_crontab -l 2>/dev/null || true)
others=$(printf '%s\n' "$current" | grep -v "pi-photo-hub health-log" || true)

if [ "${1:-}" = "--remove" ]; then
  printf '%s\n' "$others" | sed '/^$/d' | run_crontab -
  echo "[INFO] Health log cron entry removed (data in /run/user/*/pi-photo-hub-health is left until reboot)."
  exit 0
fi

[ -f "$SCRIPT" ] || { echo "[ERROR] $SCRIPT not found"; exit 1; }
chmod +x "$SCRIPT"
sudo systemctl enable --now cron >/dev/null 2>&1 || true
{ printf '%s\n' "$others"; echo "* * * * * /bin/bash $SCRIPT >/dev/null 2>&1 $TAG"; } | sed '/^$/d' | run_crontab -
echo "[INFO] Health log installed: runs every minute as $RUN_USER ($SCRIPT)"
