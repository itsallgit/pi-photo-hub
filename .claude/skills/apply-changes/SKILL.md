---
name: apply-changes
description: Use when a change in this repo has to reach the Pi (new code, a systemd unit, the API, config), when testing a branch on the Pi, when rolling the Pi back to an earlier version, or when the owner says "update the Pi" or "deploy". Runs scripts/update.sh behind an agreement gate. Changes the Pi.
---

# Applying repo changes to the Pi

`scripts/update.sh` is the one way a change reaches the Pi (hard rule 2). This skill is the gate around it: what to check, what to tell the owner, how to verify and undo. The script is the source of truth for the steps; read its header (`sed -n 1,25p scripts/update.sh`) rather than trusting a copy of it here. **This changes the Pi**: agree it first (`CLAUDE.md`, "Working with the owner").

**Never** use `cleanup.sh` or `bootstrap.sh` for this, and never run `git pull`, `checkout`, `stash`, `reset` or `clean` on the Pi by hand.

## Preconditions

1. The change is **pushed to GitHub** (`git push`; for a branch `git push -u origin <branch>`). The Pi pulls from GitHub, so what is not pushed does not exist for it. The `git-workflow` skill covers branches, testing and merging.
2. Read-only state check with the `pi-access` skill: services `active`, the checkout's `git status --short` and `git log --oneline -1`, and `cd ~/pi-photo-hub && git ls-remote origin HEAD` (proves the Pi can reach GitHub).
3. The Pi has `scripts/update.sh` in its checkout. If it does not (first deploy, or after rolling back past it), **pipe it from the PC** (Git Bash): `git fetch origin && git show origin/<branch>:scripts/update.sh | ssh -i ~/.ssh/id_pi_photo_hub pi@pi.local 'bash -s -- <options>'`. Pipe only a script that is already pushed. Use `git show`, not `< scripts/update.sh`: the committed file is LF, a Windows working copy may be CRLF, and CR characters break bash on the Pi.

## Steps

1. **Dry run first, always.** On the Pi: `bash ~/pi-photo-hub/scripts/update.sh --dry-run [--branch NAME]` (or piped, as above). It changes nothing except `git fetch`, and prints the commits, the files that differ, the units/config it would sync, whether it would restart `photo-api`, and what it leaves for a separate step.
2. **Agreement gate.** Show the owner the plan in a few lines: from which commit to which, what changes on the Pi, what restarts (restarting `photo-api` probably relaunches the slideshow: the screen blinks), what is *not* done (Picapport is never restarted by this script; see backlog Q11), the risk, and the undo below. Wait for a yes.
3. **Run it** without `--dry-run`. Options: `--branch NAME` (test a branch), `--ref SHA` (roll back / pin), `--with-health-log`, `--with-logrotate` (install those; they are only refreshed if already installed), `--reset-slideshow` (forget the saved slideshow), `--discard-local-changes` (backs the changes up, then restores git's version; ask the owner first). No arguments means the tip of `main`.
4. **Verify**: the script prints service states and the HTTP codes for `/api/test` and Picapport; check them. If `photo-api` was restarted, look at the screen (`pi-access` screenshot) and confirm the slideshow came back. `tail /var/log/pi-photo-hub/update.log` shows what was done.

## Undo

The script prints the previous commit. Roll back with `update.sh --ref <that sha>` (a detached checkout; no reset or stash). To get back onto a branch afterwards run `update.sh` (that is `main`) or `update.sh --branch NAME`. Rolling back to a commit older than `scripts/update.sh` leaves no script on the Pi: pipe it from the PC (precondition 3). The saved slideshow lives in `/var/lib/photo-api/` and is not touched by a rollback, but commits before the state-directory change read the old tracked file instead.

## Do not

- Run it without a dry run and the owner's agreement, or push work in progress to `main` to get it onto the Pi (use a branch and `--branch`).
- Restart Picapport, reboot, or touch `/mnt/photos` as part of an update. If a change needs a Picapport restart (`picapport.properties`, `picapport-wrapper.service`), the script says so; that restart is a separate step to agree.
- Install the health-log cron entry or logrotate config without being asked: they have their own flags.
- Treat a "verify" failure as done. Report it; nothing is rolled back automatically.

## Links

`scripts/update.sh`, `scripts/lib/`; README "Updating the Pi"; `docs/architecture.md` ("Updating the Pi"); backlog B06, B11, B15.

## Last verified

Script logic tested on the PC against a scratch clone with a stubbed `systemctl` (2026-11-15); **not yet run on the Pi**, and the skill is not yet cold-tested. Update this line after the staged deploy and a cold test.
