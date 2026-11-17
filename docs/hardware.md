# Hardware

Verified facts only. Anything unverified is an open question in the [backlog](backlog.md).

## Current

| Item | Detail | Source |
|---|---|---|
| Computer | Raspberry Pi 4 Model B Rev 1.5, 4 GB RAM (3790 MB usable), 64-bit | read from the Pi, 2026-11-15 |
| Storage (boot/OS) | SD card, 119 GB (`/dev/mmcblk0`): `bootfs` 512 MB FAT at `/boot/firmware`, `rootfs` ext4 at `/`. 8% used. | read from the Pi |
| Photo storage | External USB HDD, 1.8 TB, **exFAT**, label `Expansion`, mounted at `/mnt/photos`. **Never modified by agents** (see [principles](principles.md)). | read from the Pi |
| Display | HP M22f FHD monitor over HDMI (`HDMI-A-1`) | read from the Pi |
| Network | Wired ethernet (`eth0`). Wi-Fi (`wlan0`) exists but is down. | read from the Pi |
| Input devices | **None. No keyboard and no mouse is connected to the Pi.** Nobody can click or type on the Pi, so an on-screen dialog (for example Picapport's "Network Error") cannot be dismissed locally. Everything is done over the network (SSH, the photo API) or by the power button. `GET /api/slideshow` relaunches Chromium on the saved slideshow, which replaces whatever is on screen. | stated by the owner, 2026-11-15 |
| Real-time clock | None. The clock is wrong until NTP syncs after boot. | Pi 4 has no RTC; observed a clock jump at boot |
| Power | Supplied through a cable with an inline on/off button. Pressing it while the Pi runs cuts power without a shutdown (the past habit; now `scripts/pi-power.sh` shuts down first, backlog B10). After a software shutdown the switch is still on: one press switches the power off, a second press starts the Pi | stated by the owner; two presses observed 2026-11-17 |
| Throttling | `vcgencmd get_throttled` = `0x0` (no under-voltage or overheating) on 2026-11-15 | read from the Pi |

## Planned

- A small board with one volume knob and three buttons to be connected to the Pi, for local control. Model, connection (GPIO or USB) and the intended functions are undecided. See the backlog.
