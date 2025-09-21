# Pi Photo Hub Setup

This package sets up a Raspberry Pi 4 with Picapport and a Node.js API for photo automation.

## Usage

1. Fresh Pi Install

   * Download [Raspberry Pi Imager](https://www.raspberrypi.com/software/)
   * Download [SD Card Formatter](https://www.sdcard.org/downloads/formatter/)
   * Format SD card using Quick Format
   * Flash SD card with Raspberry Pi OS (64-bit) *"A port of Debian Bookworm with the Raspberry Pi Desktop (Recommended)"* with settings:
      * Hostname: `pi`
      * Enable SSH (password)
      * Set username & password (`pi` + your choice)
      * Configure Wi-Fi (SSID + password) — optional if you’re wired
      * Set locale (keyboard layout, timezone, language)

1. First Boot

   * Insert the SD card into your Pi
   * Connect:
      * Power supply (official recommended, 5V 3A)
      * HDMI monitor (optional, for debugging)
      * Ethernet (if not using Wi-Fi)
    * Boot
      * First boot will resize partitions automatically
      * After ~1–2 mins, you should be able to SSH to it
   * SSH via VSCode
      * Install Microsoft Remote Explorer extension
      * Add new SSH Remote: `ssh pi@pi.local`
      * Open folder /home/pi

1. Initial Setup

   * Disable screen blanking
      * `sudo raspi-config`
      * Display Options > Screen Blanking > Disable

1. Trigger Fresh Bootstrap

   * Access the Pi via VSCode SSH Remote Session
   * Create a helper script
      * `cd ~`
      * `nano pi-photo-hub-update-and-bootstrap.sh`
      * Paste code below
      * Ctrl + O then Enter
      * Ctrl + X then Enter
      * *Note that this helper script is used to retrigger the bootstrap when making changes to the repo*
      ```bash
      #!/bin/bash
      set -e  # Exit on first error

      MOUNTPOINT="/mnt/photos"

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

      if [ -d "/opt/picapport/.picapport" ]; then
         echo "[INFO] Removing old Picapport home folder in /opt/..."
         sudo rm -rf /opt/picapport/.picapport
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
      ```

   * Run helper script
      * `chmod +x ~/pi-photo-hub-update-and-bootstrap.sh`
      * `sudo ~/pi-photo-hub-update-and-bootstrap.sh`

      By default pinned versions of Java and Node will be installed.  
      To use the latest versions from apt instead:
      ```bash
      sudo ~/pi-photo-hub-update-and-bootstrap.sh --latest
      ```

1. Check Services are running after Pi Reboot

   * Check Service Status:
      * `sudo systemctl status mount-hdd`
      * `sudo systemctl status photo-api`
      * `sudo systemctl status picapport-chromium`
      * `sudo systemctl status picapport-wrapper`
   * Check Service Logs:
      * `journalctl -u mount-hdd.service -n 100 --no-pager`
      * `journalctl -u photo-api.service -n 100 --no-pager`
      * `journalctl -u picapport-wrapper.service -n 100 --no-pager`
      * `journalctl -u picapport-chromium.service -n 100 --no-pager`

## Logs

- Bootstrap logs: `/var/log/pi-photo-hub/bootstrap.log`
- HDD mount logs: `/var/log/pi-photo-hub/mount-hdd.log`
- API logs: `~/pi-photo-hub/api/logs/`
- Picapport logs: `/opt/picapport/.picapport/logfiles/`

## After Install

The Pi will reboot automatically and open Chromium with Picapport homepage.  
Your photo API will be available at `http://<pi-ip>:3000/api/test`.
