#!/bin/bash
# mount-hdd.sh - auto-mount first external HDD

LOGFILE="/var/log/pi-photo-hub/mount-hdd.log"
mkdir -p $(dirname "$LOGFILE")
exec >> "$LOGFILE" 2>&1

echo "[INFO] Mount HDD script running at $(date)"

UUID=$(blkid -o value -s UUID | head -n 1)
MOUNTPOINT="/mnt/photos"

if [ -n "$UUID" ]; then
  echo "[INFO] Found HDD with UUID $UUID"
  sudo mkdir -p "$MOUNTPOINT"
  if ! mountpoint -q "$MOUNTPOINT"; then
    echo "[INFO] Mounting HDD to $MOUNTPOINT"
    sudo mount -U "$UUID" "$MOUNTPOINT"
  else
    echo "[INFO] HDD already mounted"
  fi
else
  echo "[ERROR] No HDD found"
fi
