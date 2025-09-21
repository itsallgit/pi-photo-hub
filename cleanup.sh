#!/bin/bash
set -e  # Exit on first error

MOUNTPOINT="/mnt/photos"
DELETE_PICAPPORT=false

# -----------------------------
# Parse arguments
# -----------------------------
for arg in "$@"; do
  case $arg in
    delete-picapport)
      DELETE_PICAPPORT=true
      shift
      ;;
    *)
      echo "[WARN] Unknown argument: $arg"
      ;;
  esac
done

echo "============================================================"
echo ">>> Full cleanup before fresh bootstrap"
echo "============================================================"

# -----------------------------
# Stop & disable services
# -----------------------------
echo "[INFO] Stopping services..."
sudo systemctl stop picapport.service || true
sudo systemctl stop picapport-wrapper.service || true
sudo systemctl stop picapport-chromium.service || true
sudo systemctl stop mount-hdd.service || true

echo "[INFO] Disabling services..."
sudo systemctl disable picapport.service || true
sudo systemctl disable picapport-wrapper.service || true
sudo systemctl disable picapport-chromium.service || true
sudo systemctl disable mount-hdd.service || true

# -----------------------------
# Remove old unit files
# -----------------------------
echo "[INFO] Removing systemd unit files..."
sudo rm -f /etc/systemd/system/picapport.service
sudo rm -f /etc/systemd/system/picapport-wrapper.service
sudo rm -f /etc/systemd/system/picapport-chromium.service
sudo rm -f /etc/systemd/system/mount-hdd.service

# Also clean up any legacy SysV init script
if [ -f "/etc/init.d/picapport" ]; then
    echo "[INFO] Removing legacy init.d script..."
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
    echo "[INFO] Removing old Picapport home folder in /opt/..."
    sudo rm -rf /opt/picapport/.picapport
else
    echo "[INFO] Preserving /opt/picapport/.picapport"
fi

# -----------------------------
# Clone fresh repo & run bootstrap
# -----------------------------
echo "[INFO] Cloning pi-photo-hub repository..."
git clone https://github.com/itsallgit/pi-photo-hub.git /home/pi/pi-photo-hub

echo "[INFO] Making bootstrap.sh executable..."
chmod +x /home/pi/pi-photo-hub/bootstrap.sh

echo "[INFO] Running bootstrap.sh..."
cd /home/pi/pi-photo-hub
sudo ./bootstrap.sh

echo "============================================================"
echo ">>> Done. You may now reboot or start services manually."
echo "============================================================"
