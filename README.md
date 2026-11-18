# Pi Photo Hub Setup

> **Project context for people and AI agents:** start with [docs/overview.md](docs/overview.md) (what the solution is, its parts, releases, and which page owns which fact) and [CLAUDE.md](CLAUDE.md) (the rules), then [docs/backlog.md](docs/backlog.md) (what is in progress), [docs/principles.md](docs/principles.md), [docs/architecture.md](docs/architecture.md), [docs/network.md](docs/network.md) and [docs/hardware.md](docs/hardware.md). This README holds the runbooks.

## Quick Reference (coming back after months)

| Thing | Value |
|---|---|
| Pi address | find it in the Deco app client list, or run `scripts\find-pi.ps1` (written below as `<pi-ip>`) |
| SSH | `ssh -i $env:USERPROFILE\.ssh\id_pi_photo_hub pi@<pi-ip>` (see [SSH Access](#ssh-access-key-based)) |
| Photo API | `http://<pi-ip>:3000/api/test` |
| Picapport | `http://<pi-ip>:8080/picapport` |
| Play a search | `http://<pi-ip>:3000/api/slideshow?q=honeymoon&interval=30` (saved, replayed on boot) |
| Replay last slideshow | `http://<pi-ip>:3000/api/slideshow` |
| Photos HDD | auto-mounted at `/mnt/photos` (the disk pinned in `config/hdd.conf`; `scripts/mount-hdd.sh --check`); Picapport crawls it |
| Get a change onto the Pi | `bash ~/pi-photo-hub/scripts/update.sh --dry-run`, then without `--dry-run` (see [Updating the Pi](#updating-the-pi)) |
| Reboot / switch off | `bash ~/pi-photo-hub/scripts/pi-power.sh reboot` or `shutdown` (see [Rebooting and Shutting Down](#rebooting-and-shutting-down)). **Not the cable button while it runs.** |

**Adding new photos:** plug the HDD into the Pi, reboot cleanly (`scripts/pi-power.sh reboot`), wait for Picapport to index (`tail -f /opt/picapport/.picapport/logfiles/*`), then call `/api/slideshow?q=<search>`. The default saved query is `noimagesfound`, so a real query must be set once.

**Can't find the Pi?** Check the Deco app client list, or run `powershell -File scripts\find-pi.ps1` from this repo (the built-in PowerShell 5.1 or PowerShell 7; about 5 s). It lists hosts with SSH open; the Pi's MAC in `arp -a` starts with `b8-27-eb`, `dc-a6-32`, `d8-3a-dd`, `e4-5f-01` or `2c-cf-67`.

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
   * **Using a different photo HDD?** `config/hdd.conf` pins the current disk by its UUID. With another disk, the Pi will not mount it until you put that disk's UUID (or label) in `config/hdd.conf` and commit it. `lsblk -o NAME,LABEL,UUID,FSTYPE` shows the values.

1. Trigger Fresh Bootstrap using Cleanup Script

   **For a fresh build or a deliberate rebuild only.** It is destructive (see [Updating the Pi](#updating-the-pi)); to get a change onto a Pi that already works, use `scripts/update.sh`.

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

## Controlling the Slideshow

The photo API on port 3000 is how everything controls the slideshow (full reference: [docs/architecture.md](docs/architecture.md), "Photo API"; what can be searched: [docs/image-metadata.md](docs/image-metadata.md)). From an agent session, ask in plain words; the `slideshow-control` skill calls these for you. By hand, from any machine on the home network:

```bash
API=http://pi.local:3000
curl -s $API/api/status                                         # what is playing, screen state
curl -s -G $API/api/count --data-urlencode "q=noosa OR croatia"  # how many photos, nothing changes
curl -s -X POST $API/api/slideshow -H 'content-type: application/json' \
     -d '{"query":"noosa OR croatia","label":"Noosa and Croatia"}' # play and save (not played if 0 photos)
curl -s -X PATCH $API/api/slideshow -H 'content-type: application/json' -d '{"interval":30}'   # slower, keep the rest
curl -s -X PATCH $API/api/slideshow -H 'content-type: application/json' -d '{"sort":"randomsmart"}'
curl -s -X POST $API/api/screen -H 'content-type: application/json' -d '{"on":false,"minutes":60}'  # off for an hour
curl -s -X POST $API/api/screen -H 'content-type: application/json' -d '{"on":true}'
curl -s $API/api/vocabulary | head -c 2000                       # searchable keywords, people, folders
curl -s $API/api/words                                           # private word list (lives only on the Pi)
curl -s $API/api/slideshow                                       # show the slideshow on the screen (what the boot does; it resumes, no reshuffle)
```

**The slideshow layer (B32; on the branch `feat/slideshow-layer` until the owner says "go").** The Pi now holds the one slideshow itself (order, position, settings) and every screen is a window onto it: the shelf screen and any browser at `http://pi.local:3000/show`. The calls above keep working; the new ones (full list in `docs/architecture.md`, "Slideshow layer"):

```bash
curl -s $API/api/player                                          # now playing: photo, date, place, event, next photos, settings
curl -s -X POST $API/api/player/next                             # next photo (also: back, pause, play, toggle)
curl -s -X POST $API/api/player/back -H 'content-type: application/json' -d '{"steps":3}'
curl -s -X POST $API/api/player/preset -H 'content-type: application/json' -d '{"name":"present"}'  # ambient, present, guests, night
curl -s -X PATCH $API/api/player/settings -H 'content-type: application/json' -d '{"upright":"skip","motion":"lively"}'
curl -s -X POST $API/api/player/source -H 'content-type: application/json' \
     -d '{"source":{"places":["IT"],"label":"Italy"}}'          # also: query, years, onThisDay, notSeenDays, box
curl -s -X POST $API/api/marks -H 'content-type: application/json' -d '{"mark":"star"}'  # review list only; never written to a photo
curl -s -X PATCH $API/api/player/settings -H 'content-type: application/json' -d '{"viewer":"picapport"}'  # fallback: Picapport's own page ("layer" to come back)
```

**On the phone:** open `http://pi.local:3000/show` in Chrome (bookmark it, or "Add to home screen"), tap once for the controls and full screen, swipe for next and back; Search, Browse (years, places, people, keywords, folders, this week in past years, not seen in a while), Map, Settings; ★ and ⚑ put the photo on the review list. Mirror the phone to the TV in landscape to show a trip there.

State on the Pi: `/var/lib/photo-api/player.json` (now playing, settings) and `playlist.json` (the order), `history.json`, `marks.json`, `schedule.json`, `catalogue.json` (built nightly with the vocabulary). Disposable cache: `/var/cache/photo-api/` (resized photos, capped at 2 GB, and listed query results); deleting it is safe. Defaults and presets: `config/slideshow-presets.json`.

Manual alternative on the Pi, without the API: the screen with `XDG_RUNTIME_DIR=/run/user/1000 WAYLAND_DISPLAY=wayland-0 wlr-randr --output HDMI-A-1 --off` (or `--on`). The vocabulary and the photo catalogue are rebuilt nightly at 03:30; by hand: `bash ~/pi-photo-hub/scripts/refresh-vocabulary.sh` (about 40 minutes) or `--build-only` (seconds, from the last scan). Place names (country, city) come from GPS with an offline list from GeoNames (place data © GeoNames, https://www.geonames.org, licensed CC BY 4.0), downloaded once by `scripts/fetch-places.sh` into `~/metadata-survey/places/` (`--refresh` to download it again).

The mouse pointer is hidden on the slideshow screen: `scripts/install-hidden-cursor.sh` (run by every update and by bootstrap) installs a blank pointer theme for `pi` and sets it for the desktop (from the next reboot); the API starts Chromium with it. To show the pointer again: `bash ~/pi-photo-hub/scripts/install-hidden-cursor.sh --remove`, set `CURSOR_THEME=` (empty) for `photo-api`, and reboot.

The private word list and the other API state are only on the Pi's SD card (`/var/lib/photo-api/`); back them up with the Picapport database (backlog B25).

## Button board

A USB "3 key + knob" keypad in front of the shelf (slideshow layer R17). The Pi's `photo-buttons` service reads it and calls the photo API; nothing else on the Pi sees its keys. What each input does is in `config/buttons.json` (first map: KEY1 back, KEY2 pause/play and hold for screen off/on, KEY3 next and hold to star the photo, knob slower/faster, knob press changes the overlay style).

**Program the board (once per board; the setting is stored in it).** A new board sends the same letter from every input, so this is required. **Automated, from the Pi with the board plugged in:** the `button-board` skill, "Program the board", writes `config/button-board.yaml` with the open-source `ch57x-keyboard-tool`. **Manual, on a Windows PC:** install its settings tool (`MINI KeyBoard.exe`, from the QR code in the manual or `szxiaozi.com`), plug the board into the PC, and set KEY1 = F13, KEY2 = F14, KEY3 = F15, knob left = F16, knob press = F17, knob right = F18 (keys nothing else uses), download the setting into the board, and optionally set the LED mode to 0 (off). Then plug it into the Pi. If the tool cannot send F13 to F18, set the multimedia keys instead (previous, play/pause, next, volume down, mute, volume up for the same six inputs); those are mapped too.

**Check it (automated: the `button-board` skill):** `journalctl -u photo-buttons -n 30 --no-pager` shows "board found ... taken exclusively" and one line per press. **Find out what a board sends** (manual): `sudo systemctl stop photo-buttons; python3 ~/pi-photo-hub/scripts/photo-buttons.py --learn 60; sudo systemctl start photo-buttons`, then press each key. **Test without the board:** `sudo python3 ~/pi-photo-hub/scripts/test/buttons-virtual.py`. **Change a key:** edit `config/buttons.json`, check with `python3 scripts/photo-buttons.py --check`, commit and update the Pi.

## Logs

- Bootstrap logs: `/var/log/pi-photo-hub/bootstrap.log`
- Update log: `/var/log/pi-photo-hub/update.log` (written by `scripts/update.sh`; rotated by `/etc/logrotate.d/pi-photo-hub` installed by every update)
- HDD mount: `journalctl -u mount-hdd -b` (which disk, any wait). `/var/log/pi-photo-hub/mount-hdd.log` is a stale file from September 2025. Which disk is pinned: `bash ~/pi-photo-hub/scripts/mount-hdd.sh --check` (read-only)
- API logs: `/var/log/photo-api/`
- Picapport logs: `/opt/picapport/.picapport/logfiles/`
- Health log (one line per minute): `/var/log/pi-photo-hub/health.log`; its screenshots (RAM): `/run/user/1000/pi-photo-hub-health/shots/` (see [Health Log](#health-log-diagnostics))
- Power log (every clean reboot/shutdown by `scripts/pi-power.sh`): `/var/log/pi-photo-hub/power.log`
- Service and kernel logs: `journalctl` (persistent since 2026-11-17, capped at 200 MB by `/etc/systemd/journald.conf.d/pi-photo-hub.conf`; the previous boot is `journalctl -b -1`)
- Everything in `/var/log/pi-photo-hub/` is rotated by `/etc/logrotate.d/pi-photo-hub` (from `config/logrotate-pi-photo-hub`, installed by every update)

## Photo Metadata Survey (read-only)

Shows which metadata the photos carry (keywords, people, dates, GPS, ...), as input for slideshow queries. Facts and findings: [docs/image-metadata.md](docs/image-metadata.md). It only reads the photo HDD; its output goes to the SD card.

```bash
# On the Pi (needs exiftool, installed by update.sh from config/packages.txt)
bash ~/pi-photo-hub/scripts/metadata-survey.sh scan      # ~40 min for ~64,000 photos; writes ~/metadata-survey/survey.tsv
bash ~/pi-photo-hub/scripts/metadata-survey.sh summary   # per field: number of files and top values
```

Manual alternative for one photo: `exiftool -G1 -a -s "<photo path>"` (never with a write option).

The same scan runs every night at 03:30 to rebuild the slideshow vocabulary (interim, see [docs/architecture.md](docs/architecture.md), "Vocabulary refresh"). To see whether it, or anything else, is running right now: `bash ~/pi-photo-hub/scripts/whats-running.sh`.

Which fields Picapport indexes is tested with small JPEGs in a test folder on the SD card (`/home/pi/picapport-testset`, Picapport's second scan root), never on the HDD:

```bash
bash ~/pi-photo-hub/scripts/metadata-testset.sh create   # one test JPEG per metadata field
# Picapport indexes them at its next scan (a Picapport restart: sudo systemctl restart picapport-wrapper)
bash ~/pi-photo-hub/scripts/metadata-testset.sh check    # found / NOT found per field
bash ~/pi-photo-hub/scripts/metadata-testset.sh clean    # remove them; then restart Picapport again (or wait for its midnight scan) so they leave the index
```

## Health Log (diagnostics)

Every minute a cron job (user `pi`) runs [scripts/health-log.sh](scripts/health-log.sh) and appends one line describing the state of the hub. Every 5 minutes it also saves a small screenshot of the screen. It exists so that when something goes wrong (e.g. the slideshow shows "Network Error"), you can look back and see *when* it happened and *what the system was doing just before*.

* It is installed automatically by `bootstrap.sh` (via [scripts/install-health-log.sh](scripts/install-health-log.sh)) and removed by `cleanup.sh`.
* The text log is on the SD card, `/var/log/pi-photo-hub/health.log` (about 0.5 MB a day, rotated weekly, 4 weeks kept), so it **survives a reboot or power cut** (B09). `update.sh` creates it for user `pi`; if it is missing or not writable the script falls back to RAM (`/run/user/1000/pi-photo-hub-health/health.log`, lost on reboot). Screenshots stay in RAM (`/run/user/1000/pi-photo-hub-health/shots/`, the last 24 h, 288 PNG files, about 17 MB) to spare the SD card, and are lost on reboot.
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
ssh -i $env:USERPROFILE\.ssh\id_pi_photo_hub pi@<pi-ip> "tail -n 60 /var/log/pi-photo-hub/health.log"

# Minutes where something was wrong (Picapport not 200, or new errors in the JSON servlet / pool)
ssh -i $env:USERPROFILE\.ssh\id_pi_photo_hub pi@<pi-ip> "grep -vE 'pp=200 .* new_json=0 new_pool=0' /var/log/pi-photo-hub/health.log | tail -n 40"

# Copy the screenshots to your PC (newest are last; filenames are YYYYMMDD-HHMM.png)
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

**Diagnose and repair, do not rebuild** (owner, 2026-11-15; backlog B04). Automated: the `picapport-db` skill and `scripts/picapport-db.sh`: `status` (read-only); `snapshot [--dry-run]` (copies the database to a read-only snapshot, about 2 min downtime); `repair [--dry-run] [--no-swap]` (maintenance window of 15 to 30 min: stops Picapport, exports everything reachable from a copy, imports it into a fresh database, checks it, swaps it in and keeps the old one, rolls back by itself if needed); `restore <dir>` (puts a kept database back); `prune [--keep N]` (deletes old automatic snapshots only). **Backups:** a weekly automatic snapshot, Sundays 04:30 (`picapport-db.sh scheduled`; the 4 newest are kept; turn it off with `bash ~/pi-photo-hub/scripts/install-db-backup-cron.sh --remove`, but `update.sh` puts it back, so turning it off for good is a repo change). Work files and snapshots: `/home/pi/picapport-db-work/`. Facts and case history: `docs/picapport-db.md`. Manual: the export/import steps below are the older procedure; `repair` does the same with checks, a memory cap and a rollback.

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

## Rebooting and Shutting Down

**Do not switch the Pi off at the cable button while it is running.** A hard power cut is the strongest suspect for the past Picapport database damage (backlog Q3). Use `scripts/pi-power.sh` (backlog B10). It refuses while a project job is running (vocabulary refresh, metadata survey, database script, update) and lists them. It stops Picapport on its own first and checks that it closed its database (up to 5 minutes, usually about a minute). It records the result in `/var/log/pi-photo-hub/power.log`, then reboots or powers off. The OS unmounts the photo HDD itself.

### Automated (from an agent session: the `pi-power` skill)

Say "reboot the Pi" or "switch the Pi off". The agent shows what is running and asks before doing it (twice if it would interrupt a job), runs the script, and checks afterwards.

### Manual (by hand over SSH)

```bash
bash ~/pi-photo-hub/scripts/pi-power.sh reboot --dry-run      # what is running, what it would do; changes nothing
bash ~/pi-photo-hub/scripts/pi-power.sh reboot --reason "why"  # back in about 2-3 minutes, slideshow starts by itself
bash ~/pi-photo-hub/scripts/pi-power.sh shutdown --reason "why"
bash ~/pi-photo-hub/scripts/pi-power.sh verify                 # after it is back: clean stop? HDD clean? all running?
```

- Exit code 3 means it refused because jobs are running. Wait for them (`bash ~/pi-photo-hub/scripts/whats-running.sh`), or add `--force` if you accept interrupting them. A vocabulary refresh is safe to interrupt; a database script or an update is not.
- **After `shutdown`:** wait until the Pi stops answering (`ping pi.local`, about 30 s). Then it is safe to use the cable button. The switch is still in its on position, so **one press switches the power off, and a second press starts the Pi** (observed 2026-11-17). To start it again, press twice.
- If Picapport will not stop, the script does not power off. It starts Picapport again and exits with an error.

## Updating the Pi

To get a change in this repo onto an installed Pi, use `scripts/update.sh`. It fetches from GitHub, checks out `main` or a branch (fast-forward only: no reset, stash or rebase), re-applies the repo (missing packages from `config/packages.txt`, install only; missing kernel command-line settings from `config/kernel-cmdline.txt`, used at the next reboot; systemd units and Picapport's init script that are already installed, API dependencies, Picapport's properties file, the logrotate config and the health-log cron entry), then **restarts the app the way a boot starts it** (`photo-api`, then the boot's slideshow launcher `picapport-chromium`, so the saved slideshow comes back by itself) and verifies. It never upgrades or removes packages (`apt full-upgrade` stays with a rebuild), reboots, touches the photo HDD, restarts `mount-hdd` (it would remount the HDD) or restarts Picapport (backlog Q11); it says when one of those is needed. It logs to `/var/log/pi-photo-hub/update.log`.

> `cleanup.sh` is **not** the way to update. It stops every service, unmounts the HDD, deletes and re-clones the checkout, can delete the Picapport database, and bootstrap then runs `apt full-upgrade` and reboots. Use it only for a deliberate rebuild.

The change must be **pushed to GitHub** first: the Pi pulls from there.

**Does the Pi match the repo?** `bash ~/pi-photo-hub/scripts/verify.sh` (read-only drift report: units, config, kernel command line, packages, cron entries, services, the pinned HDD; exit 1 on drift). An update puts most drift right.

### Automated (from an agent session: the `apply-changes` skill)

The skill runs a dry run, shows the plan, waits for the owner's agreement, runs the update and verifies. See `.claude/skills/apply-changes/SKILL.md`.

### Manual (by hand over SSH)

```bash
cd ~/pi-photo-hub
bash scripts/update.sh --dry-run                 # look first: changes nothing except `git fetch`
bash scripts/update.sh                           # update to the tip of main (also: get back onto main)
bash scripts/update.sh --branch feat/my-change   # test a branch
bash scripts/update.sh --ref <sha>               # roll back to a commit (detached checkout)
```

Optional flags: `--reset-slideshow` (forget the saved slideshow; the API falls back to its default), `--discard-local-changes` (back up tracked local changes in `/var/lib/photo-api/discarded-<time>/`, then restore git's version). `--with-health-log` and `--with-logrotate` are still accepted but do nothing: both are always installed.

**First time, or after rolling back past the script** (the Pi's checkout has no `scripts/update.sh`): pipe it from the PC instead, from a Git Bash window in this repo. The script must already be pushed. `git show` sends the committed (LF) version, which a Windows checkout with CRLF line endings would not:

```bash
git show origin/main:scripts/update.sh | ssh -i ~/.ssh/id_pi_photo_hub pi@<pi-ip> 'bash -s -- --dry-run'
```

**Saved slideshow.** What is playing (the source, the order, the position, the settings) is kept in `/var/lib/photo-api/player.json` and `playlist.json` (outside the repo checkout), so an update never touches it and the slideshow resumes where it was. `slideshow.json` and `slideshow_url.txt` there are still written for a query slideshow, so a rollback to a version before release 1 replays it. (Before 2026-11-15 the saved slideshow was the tracked file `api/slideshow_url.txt`; to carry such an old one over by hand, copy it to `/var/lib/photo-api/slideshow_url.txt`.)

**If the slideshow is not back after an update or a rollback** (a rollback runs the older commit's script, which may not relaunch it): `curl -s http://localhost:3000/api/slideshow` (no query string: it shows the slideshow and resumes it).

**Undo.** The script prints the commit it came from; `bash scripts/update.sh --ref <that sha>` goes back.

### Development workflow

1. Make the change (on a branch for risky code; see the `git-workflow` skill), run `bash scripts/check.sh` (shell syntax, line endings, executable bits, secret scan, skills, API smoke test, docs-sync warning; read-only), commit, `git push -u origin <branch>`.
2. Test it on the Pi with `update.sh --branch <branch>`.
3. When it works, fast-forward `main`, push, and run `update.sh` (no arguments) on the Pi to get back onto `main`.
