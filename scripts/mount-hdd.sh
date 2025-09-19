#!/bin/bash
# mount-hdd.sh - Mount first external HDD to /mnt/photos

set -e

MOUNTPOINT="/mnt/photos"
mkdir -p "$MOUNTPOINT"

# Find first external partition (ignore SD card)
HDD_DEV=$(lsblk -dn -o NAME,TYPE | grep 'part' | grep -v '^mmcblk0' | head -n1)
if [ -z "$HDD_DEV" ]; then
    echo "[ERROR] No external HDD found. Exiting."
    exit 1
fi

HDD_PATH="/dev/$HDD_DEV"

# Unmount if already mounted
for m in $(lsblk -ln -o NAME,MOUNTPOINT | grep "^$HDD_DEV" | awk '{print $2}'); do
    if [ -n "$m" ] && [ "$m" != "$MOUNTPOINT" ]; then
        echo "[INFO] Unmounting $m..."
        umount "$m"
    fi
done

# Mount
mount -o uid=pi,gid=pi "$HDD_PATH" "$MOUNTPOINT"
echo "[INFO] Mounted $HDD_PATH to $MOUNTPOINT successfully"
