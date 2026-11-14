# Pi Photo Hub Setup

> **Project context for people and AI agents:** start with [CLAUDE.md](CLAUDE.md), then [docs/backlog.md](docs/backlog.md) (what is in progress), [docs/principles.md](docs/principles.md), [docs/architecture.md](docs/architecture.md), [docs/network.md](docs/network.md) and [docs/hardware.md](docs/hardware.md). This README holds the runbooks.

## Quick Reference (coming back after months)

| Thing | Value |
|---|---|
| Pi address | find it in the Deco app client list, or run `scripts\find-pi.ps1` (written below as `<pi-ip>`) |
| SSH | `ssh -i $env:USERPROFILE\.ssh\id_pi_photo_hub pi@<pi-ip>` (see [SSH Access](#ssh-access-key-based)) |
| Photo API | `http://<pi-ip>:3000/api/test` |
| Picapport | `http://<pi-ip>:8080/picapport` |
| Play a search | `http://<pi-ip>:3000/api/slideshow?q=honeymoon&interval=30` (saved, replayed on boot) |
| Replay last slideshow | `http://<pi-ip>:3000/api/slideshow` |
| Photos HDD | auto-mounted at `/mnt/photos`; Picapport crawls it |

**Adding new photos:** plug the HDD into the Pi, reboot (or `sudo systemctl restart mount-hdd picapport-wrapper`), wait for Picapport to index (`tail -f /opt/picapport/.picapport/logfiles/*`), then call `/api/slideshow?q=<search>`. The default saved query is `noimagesfound`, so a real query must be set once.

**Can't find the Pi?** Check the Deco app client list, or run `pwsh -File scripts\find-pi.ps1` from this repo. It needs PowerShell 7 (`pwsh`); the built-in `powershell` (5.1) fails with a `-Parallel` error. It lists hosts with SSH open; the Pi's MAC in `arp -a` starts with `b8-27-eb`, `dc-a6-32`, `d8-3a-dd`, `e4-5f-01` or `2c-cf-67`.

**Forgot the SSH password / SSH not enabled?** See [Password Recovery](#password-recovery-from-the-sd-card).

## SSH Access (key-based)

Connect with a dedicated SSH key, so no password is needed (and none has to be shared with tools or scripts).

* Private key: `%USERPROFILE%\.ssh\id_pi_photo_hub` (stays on your PC, never commit it)
* Public key: `%USERPROFILE%\.ssh\id_pi_photo_hub.pub` (installed on the Pi in `~/.ssh/authorized_keys`)
* Default user: `pi` (use the username you chose when flashing the card)

### Use it

```powershell
ssh -i $env:USERPROFILE\.ssh\id_pi_photo_hub pi@<pi-ip>
```

Optional shortcut: add this to `%USERPROFILE%\.ssh\config` so `ssh pi-hub` (and the VSCode Remote-SSH host list) just works. Update `HostName` if the Pi's IP changes:

```
Host pi-hub
    HostName <pi-ip>
    User pi
    IdentityFile ~/.ssh/id_pi_photo_hub
```

On the first connection, type `yes` to accept the host key. If the Pi is re-flashed, remove the old entry with `ssh-keygen -R <pi-ip>`.

### Set it up (once, from the PC)

Needs the Pi's password one time. Run in PowerShell:

```powershell
# 1. Create the key (Enter for no passphrase, or set one)
ssh-keygen -t ed25519 -f $env:USERPROFILE\.ssh\id_pi_photo_hub -C "pi-photo-hub"

# 2. Install the public key on the Pi (asks for the password once)
Get-Content $env:USERPROFILE\.ssh\id_pi_photo_hub.pub | ssh pi@<pi-ip> "mkdir -p ~/.ssh && chmod 700 ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"
```

Test it without a password prompt:

```powershell
ssh -i $env:USERPROFILE\.ssh\id_pi_photo_hub -o BatchMode=yes pi@<pi-ip> hostname
```

If you re-flash the SD card, repeat step 2 (the key itself can be reused). If you lose the key, use Password Recovery below, then repeat the setup.

### Password Recovery (from the SD card)

Use this if you don't know the SSH password, or SSH isn't enabled. You don't need access to the Pi.

1. Power off the Pi and put its SD card in your PC. The boot partition shows up as a drive (e.g. `G:`).
2. Run (replace `G` with the drive letter):
   ```powershell
   powershell -File scripts\sd-recover.ps1 -Drive G
   ```
   It prompts for a new password (typed, never stored in the repo) and writes a one-shot `firstrun.sh` to the boot partition plus a `systemd.run=` entry in `cmdline.txt`.
3. Eject the card (right-click > Eject), put it in the Pi and power on. It resets the user's password (the account with uid 1000), enables SSH, deletes the script, removes the `cmdline.txt` entry and reboots once (~2-3 min).
4. Find the Pi's IP (above) and SSH in with the new password, then set up the key.
5. Confirm cleanup on the Pi: `ls /boot/firmware/firstrun.sh` should say "No such file" and `cat /boot/firmware/cmdline.txt` should have no `systemd.run` entries. Until the script runs, the password sits on the card base64-encoded (not encrypted).

This works for Raspberry Pi OS Bookworm. Newer releases that use cloud-init (Trixie) may ignore it.

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
- HDD mount logs: `/var/log/pi-photo-hub/mount-hdd.log` (stale: last written September 2025; the script now logs to the journal, see `journalctl -u mount-hdd`)
- API logs: `/var/log/photo-api/`
- Picapport logs: `/opt/picapport/.picapport/logfiles/`
- Health log (per-minute snapshots + screenshots, in RAM): `/run/user/1000/pi-photo-hub-health/` (see [Health Log](#health-log-diagnostics))

## Health Log (diagnostics)

Every minute a cron job (user `pi`) runs [scripts/health-log.sh](scripts/health-log.sh) and appends one line describing the state of the hub. Every 5 minutes it also saves a small screenshot of the screen. It exists so that when something goes wrong (e.g. the slideshow shows "Network Error"), you can look back and see *when* it happened and *what the system was doing just before*.

* It is installed automatically by `bootstrap.sh` (via [scripts/install-health-log.sh](scripts/install-health-log.sh)) and removed by `cleanup.sh`.
* Data is stored in RAM (`/run/user/1000/pi-photo-hub-health/`) to avoid wearing the SD card. **It is lost on reboot or power loss.** The log holds ~3.5 days (5000 lines), screenshots the last 24 h (288 files, ~10 MB).
* Overhead: a few seconds of light CPU per minute.

### Log fields (`health.log`, key=value, one line per minute)

| Field | Meaning |
|---|---|
| `ts`, `up` | Time, and seconds since boot |
| `gap` | Seconds since the previous snapshot. ~60 is normal; large/odd values mean the Pi stalled or the clock jumped |
| `pp`, `pp_t` | HTTP status and response time (s) of `http://localhost:8080/picapport`. `000` = no answer |
| `api` | HTTP status of `http://localhost:3000/api/test` |
| `new_broken`, `new_pool`, `new_json`, `new_err` | New lines in the newest Picapport log since the last snapshot: broken-database errors (`OPageIsBrokenException`), connection pool exhausted (`OLockException`), JSON servlet errors (what the slideshow page uses), and all `ERROR` lines |
| `java_rss_mb`, `java_threads`, `java_cpu` | Picapport's Java process memory, threads and CPU % |
| `mem_avail_mb`, `swap_mb`, `load` | Free memory, swap used, 1-minute load |
| `temp`, `throttled` | CPU temperature and `vcgencmd get_throttled` (`0x0` = healthy; anything else = under-voltage/overheating happened) |
| `hdd` | `1` if the photo HDD is mounted at `/mnt/photos` |
| `chromium_procs`, `chromium_rss_mb` | Chromium process count and memory (0 = browser not running) |
| `conn_est`, `conn_closewait` | TCP connections to Picapport (port 8080). A growing `conn_closewait` suggests a connection leak |

### Use it

Manual (from your PC; replace `<pi-ip>`, see [SSH Access](#ssh-access-key-based)):

```powershell
# Summary: where the data is + last lines
ssh -i $env:USERPROFILE\.ssh\id_pi_photo_hub pi@<pi-ip> "bash ~/pi-photo-hub/scripts/health-log.sh --status"

# Last hour of snapshots
ssh -i $env:USERPROFILE\.ssh\id_pi_photo_hub pi@<pi-ip> "tail -n 60 /run/user/1000/pi-photo-hub-health/health.log"

# Minutes where something was wrong (Picapport not 200, or new errors in the JSON servlet / pool)
ssh -i $env:USERPROFILE\.ssh\id_pi_photo_hub pi@<pi-ip> "grep -vE 'pp=200 .* new_json=0 new_pool=0' /run/user/1000/pi-photo-hub-health/health.log | tail -n 40"

# Copy the screenshots to your PC (newest are last; filenames are YYYYMMDD-HHMM.jpg)
scp -i $env:USERPROFILE\.ssh\id_pi_photo_hub -r pi@<pi-ip>:/run/user/1000/pi-photo-hub-health/shots .\shots
```

To find when the slideshow stopped: open the screenshots in time order, find the first one showing the "Network Error" / "Missing Picture" screen, then read the `health.log` lines for the minutes before that timestamp.

### Install / remove by hand

```bash
bash ~/pi-photo-hub/scripts/install-health-log.sh            # install or refresh (idempotent)
bash ~/pi-photo-hub/scripts/install-health-log.sh --remove   # uninstall
crontab -l                                                   # should show one line tagged "# pi-photo-hub health-log"
```

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
