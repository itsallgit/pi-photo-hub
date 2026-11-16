#!/bin/bash
# mount-hdd.sh - mount the photo HDD at /mnt/photos. Run at boot by mount-hdd.service (as root).
# The disk is pinned by config/hdd.conf (UUID, or label), so another USB disk is never mounted in
# its place, and the script waits up to HDD_WAIT_SECONDS for it to appear (backlog B16).
#
#   mount-hdd.sh           mount it (what the service runs)
#   mount-hdd.sh --check   read-only: which disk is pinned, is it present, what is mounted now
#
# Mount options are unchanged: -o uid=pi,gid=pi (read-write; see backlog L6). This script never
# unmounts anything. If /mnt/photos already holds a different disk it stops with an error.
set -euo pipefail

MOUNTPOINT="${HDD_MOUNTPOINT:-/mnt/photos}"   # override only for testing
CONF="${HDD_CONF:-$(dirname "$(readlink -f "$0")")/../config/hdd.conf}"
HDD_UUID=""; HDD_LABEL=""; HDD_WAIT_SECONDS=90
# shellcheck source=/dev/null
[ -f "$CONF" ] && . "$CONF"
if [ -n "$HDD_UUID" ]; then DEV="/dev/disk/by-uuid/$HDD_UUID"; WHAT="UUID $HDD_UUID"
elif [ -n "$HDD_LABEL" ]; then DEV="/dev/disk/by-label/$HDD_LABEL"; WHAT="label $HDD_LABEL"
else echo "[ERROR] $CONF sets neither HDD_UUID nor HDD_LABEL"; exit 1; fi

disks_seen() { lsblk -nr -o NAME,LABEL,UUID,FSTYPE | awk '$1 !~ /^mmcblk/ {print "    " $0}'; }

if [ "${1:-}" = "--check" ]; then
  echo "pinned: $WHAT ($DEV), from $CONF"
  if [ -e "$DEV" ]; then echo "present: yes ($(readlink -f "$DEV"))"; else echo "present: NO"; fi
  echo "mounted at $MOUNTPOINT now: $(findmnt -n -o SOURCE "$MOUNTPOINT" 2>/dev/null || echo nothing)"
  echo "non-SD disks seen (name label uuid type):"; disks_seen
  exit 0
fi

i=0
while [ ! -e "$DEV" ] && [ "$i" -lt "$HDD_WAIT_SECONDS" ]; do sleep 1; i=$((i + 1)); done
if [ ! -e "$DEV" ]; then
  echo "[ERROR] photo HDD ($WHAT) not found after ${HDD_WAIT_SECONDS}s. Non-SD disks seen:"
  disks_seen
  echo "[ERROR] If the HDD was replaced, set its UUID or label in config/hdd.conf."
  exit 1
fi
[ "$i" -eq 0 ] || echo "[INFO] waited ${i}s for the photo HDD"

mkdir -p "$MOUNTPOINT"
if mountpoint -q "$MOUNTPOINT"; then
  cur="$(findmnt -n -o SOURCE "$MOUNTPOINT")"
  if [ "$(readlink -f "$cur")" = "$(readlink -f "$DEV")" ]; then
    echo "[INFO] $MOUNTPOINT already has the photo HDD ($cur)"; exit 0
  fi
  echo "[ERROR] $MOUNTPOINT already has $cur mounted, which is not the photo HDD ($WHAT)"; exit 1
fi
mount -o uid=pi,gid=pi "$DEV" "$MOUNTPOINT"
echo "[INFO] Mounted the photo HDD ($WHAT, $(readlink -f "$DEV")) at $MOUNTPOINT"
