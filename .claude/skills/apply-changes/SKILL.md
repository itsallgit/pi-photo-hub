---
name: apply-changes
description: Use when a change in this repo has to reach the Pi (new code, a systemd unit, the API, config), when testing a branch on the Pi, when rolling the Pi back to an earlier version, or when the owner says "update the Pi" or "deploy". Runs scripts/update.sh behind an agreement gate. Changes the Pi.
---

# Applying repo changes to the Pi

`scripts/update.sh` is the one way a change reaches the Pi (hard rule 2). This skill is the gate around it: what to check, what to tell the owner, how to verify and undo. The script is the source of truth for the steps; read its header (`bash scripts/update.sh --help`) rather than trusting a copy of it here. **This changes the Pi**: agree it first (`CLAUDE.md`, "Working with the owner").

**Every update ends with the app restarted the way a boot starts it** (owner decision, 2026-11-15): the script restarts `photo-api` and then starts `picapport-chromium`, the boot's own slideshow launcher, even if nothing changed. It never restarts `mount-hdd` (that would remount the photo HDD, hard rule 1) or Picapport (suspected to damage its database, backlog Q11), and it never reboots. The health-log cron entry and the logrotate config are part of the app and are always installed. Packages listed in `config/packages.txt` (for example `exiftool`) are installed if missing, install only: the script never upgrades or removes packages. To add a tool the project needs on the Pi, add it to that file (with a comment saying why) rather than running `apt` by hand. Kernel command-line settings in `config/kernel-cmdline.txt` are added the same way and need a reboot; the dry run and the script's "Needs a separate, agreed step" list say so, and the reboot goes through the `pi-power` skill (its own agreement gate).

**Never** use `cleanup.sh` or `bootstrap.sh` for this, and never run `git pull`, `checkout`, `stash`, `reset` or `clean` on the Pi by hand.

## Preconditions

1. The change is **pushed to GitHub** (`git push`; for a branch `git push -u origin <branch>`). The Pi pulls from GitHub, so what is not pushed does not exist for it. The `git-workflow` skill covers branches, testing and merging.
2. Read-only state check with the `pi-access` skill: services `active`, the checkout's `git status --short` and `git log --oneline -1`, and `cd ~/pi-photo-hub && git ls-remote origin HEAD` (proves the Pi can reach GitHub).
3. The Pi has `scripts/update.sh` in its checkout. If it does not (first deploy, or after rolling back past it), **pipe it from the PC** (Git Bash): `git fetch origin && git show origin/<branch>:scripts/update.sh | ssh -i ~/.ssh/id_pi_photo_hub pi@pi.local 'bash -s -- <options>'`. Pipe only a script that is already pushed. Use `git show`, not `< scripts/update.sh`: the committed file is LF, a Windows working copy may be CRLF, and CR characters break bash on the Pi.

## Steps

1. **Dry run first, always.** On the Pi: `bash ~/pi-photo-hub/scripts/update.sh --dry-run [--branch NAME]` (or piped, as above). It changes nothing except `git fetch`, and prints the commits, the files that differ, the units/config it would sync, the app restart, and what it leaves for a separate step.
2. **Agreement gate.** (For development the owner asked for, the standing mandate in the `make-changes` skill replaces this gate: run it, then report.) Otherwise show the owner the plan in a few lines: from which commit to which, what changes on the Pi, the app restart (the screen shows the desktop for a moment, then the saved slideshow), anything listed under "Needs a separate, agreed step" (for example a Picapport restart), the risk, and the undo below. Wait for a yes.
3. **Run it** without `--dry-run`. Options: `--branch NAME` (test a branch), `--ref SHA` (roll back / pin), `--reset-slideshow` (forget the saved slideshow), `--discard-local-changes` (backs the changes up, then restores git's version; ask the owner first). No arguments means the tip of `main`. (`--with-health-log` and `--with-logrotate` are still accepted but do nothing: both are always installed.)
4. **Verify**: the script checks the services, `/api/test`, Picapport, that the slideshow launcher succeeded and that Chromium is running, and exits non-zero if any fails. Then take a `pi-access` screenshot to see the slideshow itself. Chromium can show a white page for a while before Picapport loads. `tail /var/log/pi-photo-hub/update.log` shows what was done.

## Undo

The script prints the previous commit. Roll back with `update.sh --ref <that sha>` (a detached checkout; no reset or stash). To get back onto a branch afterwards run `update.sh` (that is `main`) or `update.sh --branch NAME`. The rollback is applied by the **older** commit's own script, which may not restart the app: if the screen is left on the desktop, relaunch with `curl -s http://localhost:3000/api/slideshow` on the Pi (agreed as part of the rollback). Rolling back to a commit older than `scripts/update.sh` leaves no script on the Pi: pipe it from the PC (precondition 3). The saved slideshow lives in `/var/lib/photo-api/` and is not touched by a rollback, but commits before the state-directory change read the old tracked file instead.

## Do not

- Run it without a dry run and the owner's agreement, or push work in progress to `main` to get it onto the Pi (use a branch and `--branch`).
- Restart Picapport or `mount-hdd`, reboot (that is the `pi-power` skill, a separate step), or touch `/mnt/photos` as part of an update. If a change needs a Picapport restart (`picapport.properties`, `picapport-wrapper.service`), the script says so; that restart is a separate step to agree.
- Treat a "verify" failure as done. Report it; nothing is rolled back automatically.

## Links

`scripts/update.sh`, `scripts/lib/`; README "Updating the Pi"; `docs/architecture.md` ("Updating the Pi"); backlog B06, B15, B20.

## Last verified

2026-11-15: run on the Pi for every stage of B06: a branch, the app-restart change (the slideshow came back by itself), `main`, a rollback with `--ref` and the return to `main`, all verified. Not yet exercised on the Pi: `--discard-local-changes`, `--reset-slideshow`, a change that needs `npm install`. The skill is not yet cold-tested.
