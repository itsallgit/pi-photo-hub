#!/bin/bash
# install-db-backup-cron.sh - register (or --remove) the weekly automatic snapshot of Picapport's
# database for user pi: Sunday 04:30 (after the 03:30 vocabulary refresh; nobody is watching).
# It runs `picapport-db.sh scheduled`: skipped while a database job or an update runs; otherwise
# Picapport stops for about 2 minutes, the database is copied to a verified, read-only
# snapshot-auto-<time> in /home/pi/picapport-db-work/, and all but the newest 4 automatic
# snapshots are deleted (backlog B25). Safe to run repeatedly. Called by update.sh
# (scripts/lib/apply-extras.sh) and bootstrap.sh.
#   bash scripts/install-db-backup-cron.sh            install / refresh
#   bash scripts/install-db-backup-cron.sh --remove   uninstall
set -euo pipefail
RUN_USER="pi"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT="$REPO_ROOT/scripts/picapport-db.sh"
TAG="# pi-photo-hub db-backup"

run_crontab() {
  if [ "$(id -un)" = "$RUN_USER" ]; then crontab "$@"; else sudo crontab -u "$RUN_USER" "$@"; fi
}

current=$(run_crontab -l 2>/dev/null || true)
others=$(printf '%s\n' "$current" | grep -v "pi-photo-hub db-backup" || true)

if [ "${1:-}" = "--remove" ]; then
  printf '%s\n' "$others" | sed '/^$/d' | run_crontab -
  echo "[INFO] Database backup cron entry removed (existing snapshots are kept)."
  exit 0
fi

[ -f "$SCRIPT" ] || { echo "[ERROR] $SCRIPT not found"; exit 1; }
{ printf '%s\n' "$others"; echo "30 4 * * 0 /bin/bash $SCRIPT scheduled >/dev/null 2>&1 $TAG"; } | sed '/^$/d' | run_crontab -
echo "[INFO] Database backup installed: Sundays at 04:30 as $RUN_USER ($SCRIPT scheduled)"
