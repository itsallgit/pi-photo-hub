#!/bin/bash
# mount-hdd.sh - auto-mount first external HDD dynamically

LOGFILE="/var/log/pi-photo-hub/mount-hdd.log"
mkdir -p "$(dirname "$LOGFILE")"
exec >> "$LOGFILE" 2>&1

echo "[INFO] Mount HDD script running at $(date)"

# Find the first external HDD (ignore SD card) with a media mount
UUID=$(lsblk -o NAME,TYPE,MOUNTPOINT,UUID | grep 'part' | grep -v mmcblk0 | grep '^.* /media/pi' | awk '{print $4}' | head -n 1)
MOUNTPOINT="/mnt/photos"

if [ -n "$UUID" ]; then
  echo "[INFO] Found external HDD with UUID $UUID"
  sudo mkdir -p "$MOUNTPOINT"
  if ! mountpoint -q "$MOUNTPOINT"; then
    echo "[INFO] Mounting HDD to $MOUNTPOINT"
    sudo mount -U "$UUID" "$MOUNTPOINT"
  else
    echo "[INFO] HDD already mounted"
  fi
else
  echo "[ERROR] No external HDD found to mount"
fi
