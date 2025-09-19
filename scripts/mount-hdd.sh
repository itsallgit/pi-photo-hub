#!/bin/bash
# mount-hdd.sh - Dynamically mount first external HDD to /mnt/photos

set -e

MOUNTPOINT="/mnt/photos"
mkdir -p "$MOUNTPOINT"

# Find the first external partition that is mounted under /media/pi
HDD_DEV=$(lsblk -ln -o NAME,MOUNTPOINT,TYPE | grep "part" | grep "/media/pi" | awk '{print $1}' | head -n1)

if [ -z "$HDD_DEV" ]; then
    echo "[ERROR] No external HDD found under /media/pi. Waiting 10s and retrying..."
    sleep 10
    HDD_DEV=$(lsblk -ln -o NAME,MOUNTPOINT,TYPE | grep "part" | grep "/media/pi" | awk '{print $1}' | head -n1)
fi

if [ -z "$HDD_DEV" ]; then
    echo "[ERROR] Still no external HDD found. Exiting."
    exit 1
fi

HDD_PATH="/dev/$HDD_DEV"

# Unmount any existing mounts of this device
for m in $(lsblk -ln -o NAME,MOUNTPOINT | grep "^$HDD_DEV" | awk '{print $2}'); do
    if [ -n "$m" ] && [ "$m" != "$MOUNTPOINT" ]; then
        echo "[INFO] Unmounting $m..."
        umount "$m"
    fi
done

# Mount the HDD to /mnt/photos (root owns, pi UID/GID)
mount -o uid=pi,gid=pi "$HDD_PATH" "$MOUNTPOINT"

echo "[INFO] Mounted $HDD_PATH to $MOUNTPOINT successfully"
