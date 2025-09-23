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

## Picapport Database Fix

*Note: this will eventually be automated with a new photo-api endpoint.*

> ERROR@ 18:24:57.863 Exception Error PhotoCrawler.DirectoryConsumer.handlePhotoUpdate:/mnt/photos/PHOTOS/2023.09.04 - 2023.09.24 - Croatia and Serbia/20230910_211633.jpg: com.orientechnologies.orient.core.exception.OPageIsBrokenException: Following files and pages are detected to be broken ['idxfileName.cbt' :2;'idxphotoId.cbt' :1;'photo.pcl' :0;'directory.pcl' :2;'photo.cpm' :0;], storage is switched to 'read only' mode. Any modification operations are prohibited. To restore database and make it fully operational you may export and import database to and from JSON. DB name="db_3_0_39"

1. Stop Picapport
   ```bash
   sudo systemctl stop picapport-wrapper
   sudo service picapport stop
   ```
1. Backup database
   ```bash
   mv /opt/picapport/.picapport/db/db_3_0_39/ /opt/picapport/.picapport/db/db_3_0_39.BROKEN
   mkdir /opt/picapport/.picapport/db/db_3_0_39
   ```
1. Run OrientDB Console
   ```bash
   cd ~/pi-photo-hub/orientdb
   #wget https://repo1.maven.org/maven2/com/orientechnologies/orientdb-community/3.0.39/orientdb-community-3.0.39.tar.gz
   tar xzf ~/pi-photo-hub/orientdb/orientdb-community-3.0.39.tar.gz
   sudo ~/pi-photo-hub/orientdb/orientdb-community-3.0.39/bin/console.sh
   ```

1. Export old database to JSON
   ```bash
   CONNECT plocal:/opt/picapport/.picapport/db/db_3_0_39.BROKEN admin admin
   EXPORT DATABASE /tmp/picapport_backup.json
   DISCONNECT
   ```
1. Create new database and import JSON
   ```bash
   CONNECT plocal:/opt/picapport/.picapport/db/db_3_0_39 admin admin
   IMPORT DATABASE /tmp/picapport_backup.json.gz
   SELECT FROM directory LIMIT 5
   SELECT FROM photo LIMIT 5
   EXIT
   ```
1. Restart Picapport
   ```bash
   sudo service picapport start
   tail -f /opt/picapport/.picapport/logfiles/picapport.*
   ```

## Development

If you want to make changes to pi-photo-hub and update an existing installed version on your pi do the following:

1. Make changes and commit them to `main`
1. Access your pi via SSH
1. Run cleanup script `sudo bash ~/pi-photo-hub/cleanup.sh`\
   * You will be asked if you want to run the bootstrap, enter `y` to pull the latest code from `main` and reinstall everything.
   * If you want to wipe your current Picapport install entirely and start with a fresh database then run:
   * `sudo bash ~/pi-photo-hub/cleanup.sh delete-picapport`
