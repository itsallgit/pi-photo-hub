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

1. Trigger Fresh Bootstrap using Cleanup Script

   * Access the Pi via VSCode SSH Remote Session
   * Create a helper script in `/home/pi/pi-photo-hub` using `cleanup.sh` in this repo
   * Run helper script
      * `chmod +x /home/pi/pi-photo-hub/cleanup.sh`
      * `sudo /home/pi/pi-photo-hub/cleanup.sh`

      If you want to delete the `/opt/picapport/.picapport` directory run the script with this flag:
      ```bash
      sudo /home/pi/pi-photo-hub/cleanup.sh delete-picapport
      ```
      
      By default pinned versions of Java and Node will be installed.  
      To use the latest versions from apt instead:
      ```bash
      sudo ~/pi-photo-hub-update-and-bootstrap.sh --latest
      ```

1. Check Services are running after Pi Reboot

   * Check Service Status:
      * `sudo systemctl status mount-hdd photo-api picapport-chromium picapport-wrapper`
   * Check Service Logs:
      * `journalctl -u mount-hdd.service -n 100 --no-pager`
      * `journalctl -u photo-api.service -n 100 --no-pager`
      * `journalctl -u picapport-wrapper.service -n 100 --no-pager`
      * `journalctl -u picapport-chromium.service -n 100 --no-pager`
   * Check Picapport Logs
      * `tail -n 1000 /opt/picapport/.picapport/logfiles/*`

## Logs

- Bootstrap logs: `/var/log/pi-photo-hub/bootstrap.log`
- HDD mount logs: `/var/log/pi-photo-hub/mount-hdd.log`
- API logs: `~/pi-photo-hub/api/logs/`
- Picapport logs: `/opt/picapport/.picapport/logfiles/`

## After Install

The Pi will reboot automatically and open Chromium with Picapport homepage.  
Your photo API will be available at `http://<pi-ip>:3000/api/test`.
