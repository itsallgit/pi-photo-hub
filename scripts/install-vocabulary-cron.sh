#!/bin/bash
# install-vocabulary-cron.sh - register (or --remove) the nightly vocabulary refresh for user pi
# (03:30, after Picapport's midnight scan). Safe to run repeatedly. Called by update.sh
# (scripts/lib/apply-extras.sh) and bootstrap.sh.
#   bash scripts/install-vocabulary-cron.sh            install / refresh
#   bash scripts/install-vocabulary-cron.sh --remove   uninstall
set -euo pipefail
RUN_USER="pi"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT="$REPO_ROOT/scripts/refresh-vocabulary.sh"
TAG="# pi-photo-hub vocabulary"

run_crontab() {
  if [ "$(id -un)" = "$RUN_USER" ]; then crontab "$@"; else sudo crontab -u "$RUN_USER" "$@"; fi
}

current=$(run_crontab -l 2>/dev/null || true)
others=$(printf '%s\n' "$current" | grep -v "pi-photo-hub vocabulary" || true)

if [ "${1:-}" = "--remove" ]; then
  printf '%s\n' "$others" | sed '/^$/d' | run_crontab -
  echo "[INFO] Vocabulary cron entry removed."
  exit 0
fi

[ -f "$SCRIPT" ] || { echo "[ERROR] $SCRIPT not found"; exit 1; }
{ printf '%s\n' "$others"; echo "30 3 * * * /bin/bash $SCRIPT >/dev/null 2>&1 $TAG"; } | sed '/^$/d' | run_crontab -
echo "[INFO] Vocabulary refresh installed: nightly at 03:30 as $RUN_USER ($SCRIPT)"
