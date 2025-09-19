#!/bin/bash
# mount-hdd.sh - Mount first external HDD to /mnt/photos using UUID

set -e

MOUNTPOINT="/mnt/photos"
mkdir -p "$MOUNTPOINT"

# Find first external partition (ignore SD card) with a filesystem
HDD_UUID=$(lsblk -nr -o NAME,UUID,FSTYPE | awk '$1 !~ /^mmcblk0/ && $2 != "" && $3 != "" {print $2; exit}')

if [ -z "$HDD_UUID" ]; then
    echo "[ERROR] No external HDD with filesystem found. Exiting."
    exit 1
fi

HDD_PATH="/dev/disk/by-uuid/$HDD_UUID"

# Unmount if already mounted
CURRENT_MOUNT=$(lsblk -ln -o NAME,MOUNTPOINT | awk -v dev="${HDD_UUID}" '$1 ~ dev {print $2}')
if [ -n "$CURRENT_MOUNT" ] && [ "$CURRENT_MOUNT" != "$MOUNTPOINT" ]; then
    echo "[INFO] Unmounting $CURRENT_MOUNT..."
    umount "$CURRENT_MOUNT"
fi

# Mount
mount -o uid=pi,gid=pi "$HDD_PATH" "$MOUNTPOINT"
echo "[INFO] Mounted $HDD_PATH to $MOUNTPOINT successfully"
