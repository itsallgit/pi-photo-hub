---
name: pi-access
description: Use when a task needs to reach the Raspberry Pi over SSH, check whether its services are running, read its logs or git state, or see what its screen is showing. Covers connecting from the owner's Windows PC (Git Bash), SSH host-key handling, finding the Pi if its address changed, a standard read-only state check, reading logs, and taking a screenshot. Read-only by default.
---

# Reaching the Pi

This skill is **read-only**. Anything that changes the Pi (restart a service, edit a file, `git` operations in its checkout) is a change the owner agrees first; a reboot or shutdown goes through the `pi-power` skill (see `CLAUDE.md`, "Working with the owner"). The photo HDD at `/mnt/photos` is never modified (hard rule 1).

Facts used here (hostnames, ports, paths) are in `docs/network.md` and `docs/architecture.md`.

## Connect

Use Git Bash (the Bash tool). The key is `~/.ssh/id_pi_photo_hub`, user `pi`, host `pi.local`.

```
ssh -i ~/.ssh/id_pi_photo_hub -o BatchMode=yes -o ConnectTimeout=10 pi@pi.local "<read-only command>"
```

PowerShell form, if you must: `ssh -i $env:USERPROFILE\.ssh\id_pi_photo_hub -o BatchMode=yes -o ConnectTimeout=10 pi@pi.local "<command>"`.

`BatchMode=yes` makes SSH fail instead of prompting, which is what you want in a session nobody can type into.

The key is per-machine and is never in the repo. If it is missing, see the README ("SSH Access") for setup and "Password Recovery" for SD-card recovery.

## If it says "Host key verification failed"

`known_hosts` is keyed by the name you connect with. A key trusted for the IP is not trusted for `pi.local`. Never use `StrictHostKeyChecking=no`: it would also accept a different machine.

1. Is `pi.local` already known? `ssh-keygen -F pi.local`.
2. If there is **no** entry and there **is** a trusted entry for the Pi's IP (see `docs/network.md`; `ssh-keygen -lF <ip>`): compare fingerprints. `ssh-keyscan -T 10 pi.local | ssh-keygen -lf -` against `ssh-keygen -lF <ip>`. If all key types match, it is the same machine: back up `~/.ssh/known_hosts` first (`cp ~/.ssh/known_hosts ~/.ssh/known_hosts.bak-<reason>`), append the `pi.local` keys, and tell the owner exactly what you wrote. Appending to `known_hosts` is a change on the owner's PC, so say so before doing it.
3. If there is no trusted entry at all (a new PC), compare the live fingerprints (`ssh-keyscan -T 10 pi.local | ssh-keygen -lf -`) with the ones recorded in `docs/network.md`. If all match, back up `known_hosts` and add the keys as in step 2, and tell the owner. If they do not match (the SD card may have been re-flashed, or something is impersonating the Pi), stop and tell the owner.
4. If SSH says **REMOTE HOST IDENTIFICATION HAS CHANGED**, stop. The Pi may have been re-flashed or something is impersonating it. Tell the owner; do not edit `known_hosts`.

To test this procedure without touching the real file, add `-o UserKnownHostsFile=/tmp/test_known_hosts` to the command.

## If `pi.local` does not answer

The Pi gets its IP by DHCP, so the address can change. In order:
1. `ping -n 1 pi.local` (Windows ping).
2. Try the last-seen IP in `docs/network.md`.
3. `powershell -File scripts\find-pi.ps1` sweeps the subnet for SSH in about 5 s (PowerShell 5.1 or 7).
4. The owner can look in the Deco app's client list.

If the Pi is off or unreachable, say so; do not guess.

## Standard read-only state check

```
ssh -i ~/.ssh/id_pi_photo_hub -o BatchMode=yes -o ConnectTimeout=10 pi@pi.local "hostname; uptime -p; systemctl is-active mount-hdd photo-api picapport-wrapper; cd ~/pi-photo-hub && git status --short && git log --oneline -1; curl -s -o /dev/null -w 'picapport %{http_code}\n' -m 10 http://localhost:8080/picapport; curl -s -o /dev/null -w 'api %{http_code}\n' -m 5 http://localhost:3000/api/test"
```

- Healthy services print `active`. `picapport-chromium` is a one-shot service and shows `inactive` after it has run; that is normal.
- **Picapport is on port 8080, not 80.**
- Since 2026-11-15 the Pi's checkout is updated by `scripts/update.sh` (the `apply-changes` skill). Expected: clean (the lock file npm writes in `api/` is ignored since release 1; on older commits it shows as untracked, which is harmless), possibly on a test branch rather than `main` (backlog B06). Report anything else; do not change it.

## What is the Pi doing right now? (read-only)

```
ssh -i ~/.ssh/id_pi_photo_hub -o BatchMode=yes -o ConnectTimeout=10 pi@pi.local "bash ~/pi-photo-hub/scripts/whats-running.sh"
```

Shows the services, the slideshow (label, order, interval, screen), **project jobs running at this moment** (vocabulary refresh, metadata survey, database scripts, an update), the scheduled jobs (cron) and the last vocabulary refresh. Run it before anything disruptive (an update; `pi-power.sh` runs the same job check itself) and tell the owner what is running. It also shows when the Pi came up and the last clean reboot/shutdown. A running vocabulary refresh is safe to interrupt: it writes a new file and swaps it in only at the end (`docs/architecture.md`, "Vocabulary refresh"). A running `picapport-db.sh` or `update.sh` is not: wait for it.

## Does the Pi match the repo? (read-only drift report)

```
ssh -i ~/.ssh/id_pi_photo_hub -o BatchMode=yes -o ConnectTimeout=10 pi@pi.local "bash ~/pi-photo-hub/scripts/verify.sh"
```

Compares installed units, config, kernel command line, packages, cron entries, pointer theme, state and log files, services and the pinned photo HDD with the checkout. `OK`, `DRIFT` or `INFO` per line; exit 1 on drift. Most drift is put right by `scripts/update.sh` (the `apply-changes` skill, agreed first). Report drift to the owner; do not fix it by hand on the Pi (hard rule 2).

## Reading logs (read-only)

| What | Where |
|---|---|
| Picapport | `/opt/picapport/.picapport/logfiles/picapport.NNN` (newest file with `ls -t`); `grep -c` for error classes such as `OPageIsBrokenException`, `OLockException`, `PicApportJsonServlet` |
| Photo API | `journalctl -u photo-api -b --no-pager`, and `/var/log/photo-api/` |
| Services, kernel | `journalctl -u <unit> -b --no-pager` (this boot); `-b -1` the previous boot, including its shutdown. Persistent since 2026-11-17 (B09), capped at 200 MB. |
| Health log | `/var/log/pi-photo-hub/health.log` (one line a minute, kept across reboots) and the screenshots in `/run/user/1000/pi-photo-hub-health/shots/` (RAM, last 24 h); README "Health Log" |
| Power | `/var/log/pi-photo-hub/power.log`: every reboot/shutdown made by `scripts/pi-power.sh` (the `pi-power` skill) |

Picapport writes no access log that we have found (backlog Q9), so it does not record failed requests.

## See what the screen shows

The Pi runs a Wayland desktop as user `pi`. Stream a screenshot over SSH straight to a file on the PC, so nothing is written on the Pi, then look at it with the Read tool and delete it. **This Pi's `grim` cannot make JPEGs; use PNG.** In Git Bash, `/tmp` is a Windows folder (`C:\Users\Troy\AppData\Local\Temp`), and the Read tool needs the Windows path: get it with `cygpath -w /tmp/pi-screen.png`.

```
ssh -i ~/.ssh/id_pi_photo_hub -o BatchMode=yes -o ConnectTimeout=10 pi@pi.local "XDG_RUNTIME_DIR=/run/user/1000 WAYLAND_DISPLAY=wayland-0 grim -t png -s 0.5 -" > /tmp/pi-screen.png
```

Nobody can click on the Pi (no keyboard or mouse), and a dialog on screen is evidence: do not try to dismiss it. `GET http://pi.local:3000/api/slideshow` restarts the kiosk browser on the slideshow page (it resumes where it was); it is a change to the Pi, so agree it first unless the owner asked for the slideshow (`slideshow-control`).

## Do not

- Run `cleanup.sh` or `bootstrap.sh` on the Pi.
- "Fix" the Pi's dirty checkout with `git checkout`, `clean`, `stash` or `reset`. `git fetch` and `git merge` there are also changes to agree first (fetch writes to its `.git`).
- Use `sudo` for anything that writes, or touch `/mnt/photos` except to read.
- Disable SSH host-key checking.
- Ask the owner to press anything on the Pi.

## Last verified

2026-11-17: used in every session since 2026-11-15 (state check, logs, screenshots, `whats-running.sh`). Cold-tested in B02 round 2 (2026-11-15): reaching the Pi from a simulated new PC, including the host-key steps.
