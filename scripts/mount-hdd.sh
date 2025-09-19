#!/bin/bash
# mount-hdd.sh - Dynamically mount first external HDD to /mnt/photos

set -e

MOUNTPOINT="/mnt/photos"

# Create mount point if it doesn't exist
sudo mkdir -p "$MOUNTPOINT"

# Find the first mounted device under /media/pi/* (ignoring SD card root partitions)
HDD_DEV=$(lsblk -ln -o NAME,MOUNTPOINT,TYPE | grep "part" | grep "/media/pi" | awk '{print $1}' | head -n1)

if [ -z "$HDD_DEV" ]; then
    echo "[WARN] No external HDD found under /media/pi"
    exit 1
fi

# Device full path
HDD_PATH="/dev/$HDD_DEV"

# Unmount if already mounted elsewhere
CURRENT_MOUNT=$(lsblk -ln -o NAME,MOUNTPOINT | grep "$HDD_DEV" | awk '{print $2}')
if [ -n "$CURRENT_MOUNT" ] && [ "$CURRENT_MOUNT" != "$MOUNTPOINT" ]; then
    echo "[INFO] Unmounting $CURRENT_MOUNT..."
    sudo umount "$CURRENT_MOUNT"
fi

# Mount the HDD to /mnt/photos
echo "[INFO] Mounting $HDD_PATH to $MOUNTPOINT..."
sudo mount -o uid=pi,gid=pi "$HDD_PATH" "$MOUNTPOINT"

echo "[INFO] Mounted $HDD_PATH to $MOUNTPOINT successfully"
