#!/bin/bash
set -e  # Exit on first error

MOUNTPOINT="/mnt/photos"

DELETE_PICAPPORT=false
if [[ "$1" == "delete-picapport" ]]; then
    DELETE_PICAPPORT=true
fi

echo "============================================================"
echo ">>> Full cleanup before fresh bootstrap"
echo "============================================================"

# -----------------------------
# Stop & disable services
# -----------------------------
echo "[INFO] Stopping services..."
# init.d Picapport service (managed by wrapper)
sudo service picapport stop || true

# systemd services
sudo systemctl stop picapport-wrapper.service || true
sudo systemctl stop picapport-chromium.service || true
sudo systemctl stop photo-api.service || true
sudo systemctl stop mount-hdd.service || true

echo "[INFO] Disabling services..."
sudo systemctl disable picapport-wrapper.service || true
sudo systemctl disable picapport-chromium.service || true
sudo systemctl disable photo-api.service || true
sudo systemctl disable mount-hdd.service || true

# Kill stray Chromium
pkill -9 chromium-browser || true

# -----------------------------
# Remove old unit files
# -----------------------------
echo "[INFO] Removing systemd unit files..."
sudo rm -f /etc/systemd/system/picapport.service   # Just in case one exists
sudo rm -f /etc/systemd/system/picapport-wrapper.service
sudo rm -f /etc/systemd/system/picapport-chromium.service
sudo rm -f /etc/systemd/system/photo-api.service
sudo rm -f /etc/systemd/system/mount-hdd.service

# Remove init.d script if present
if [ -f "/etc/init.d/picapport" ]; then
    echo "[INFO] Removing init.d picapport service script..."
    sudo rm -f /etc/init.d/picapport
fi

# Reload systemd so removals take effect
sudo systemctl daemon-reload
sudo systemctl reset-failed || true

# -----------------------------
# Unmount any existing mount
# -----------------------------
if mountpoint -q "$MOUNTPOINT"; then
    echo "[INFO] Unmounting existing mount at $MOUNTPOINT..."
    sudo umount "$MOUNTPOINT" || {
        echo "[WARN] Normal unmount failed, attempting lazy unmount..."
        sudo umount -l "$MOUNTPOINT"
    }
else
    echo "[INFO] No existing mount found at $MOUNTPOINT"
fi

# -----------------------------
# Remove old folders
# -----------------------------
if [ -d "/home/pi/pi-photo-hub" ]; then
    echo "[INFO] Removing old pi-photo-hub directory..."
    rm -rf /home/pi/pi-photo-hub
fi

if [ -d "/home/pi/.picapport" ]; then
    echo "[INFO] Removing old Picapport home folder in /home/pi/..."
    rm -rf /home/pi/.picapport
fi

if [ "$DELETE_PICAPPORT" = true ] && [ -d "/opt/picapport/.picapport" ]; then
    echo "⚠️ WARNING: You have requested to delete /opt/picapport/.picapport"
    read -p "Are you sure you want to permanently delete this folder? [y/N] " confirm
    if [[ "$confirm" =~ ^[Yy]$ ]]; then
        echo "[INFO] Deleting /opt/picapport/.picapport..."
        sudo rm -rf /opt/picapport/.picapport
    else
        echo "[INFO] Skipping deletion of /opt/picapport/.picapport"
    fi
else
    echo "[INFO] Skipping removal of /opt/picapport/.picapport (no delete-picapport flag)."
fi

# -----------------------------
# Clone fresh repo
# -----------------------------
echo "[INFO] Cloning pi-photo-hub repository..."
git clone https://github.com/itsallgit/pi-photo-hub.git /home/pi/pi-photo-hub

echo "[INFO] Making bootstrap.sh executable..."
chmod +x /home/pi/pi-photo-hub/bootstrap.sh

# -----------------------------
# Ask whether to trigger bootstrap
# -----------------------------
read -p "Do you want to run bootstrap.sh now? [y/N] " run_bootstrap
if [[ "$run_bootstrap" =~ ^[Yy]$ ]]; then
    echo "[INFO] Running bootstrap.sh..."
    cd /home/pi/pi-photo-hub
    sudo ./bootstrap.sh
else
    echo "[INFO] Skipping bootstrap.sh (can run manually later)."
fi

echo "==================================================================="
echo ">>> Done. You may now manually run the bootstrap script if skipped."
echo ">>> sudo /home/pi/pi-photo-hub/bootstrap.sh"
echo "==================================================================="
