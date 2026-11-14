# Pi Photo Hub — Project Instructions

A Raspberry Pi 4 that plays the owner's photo library as a slideshow on an attached monitor. Picapport (Java) indexes the photos on an attached HDD; a small Node.js API (`photo-api`) launches Chromium in kiosk mode on a Picapport slideshow URL. This repo is the **whole project**: install scripts, Pi configuration, the API, documentation and the AI agent configuration used to manage it.

The Pi has **no keyboard or mouse** attached, only a monitor (see [docs/hardware.md](docs/hardware.md)). Never ask the owner to click, type or press a button on the Pi; plan everything to work over SSH, the API or the power button.

Read this file fully at the start of every session. Then read [docs/backlog.md](docs/backlog.md) to learn where the work is up to.

## Session start

1. `git status` and `git log --oneline -5`: know what state the repo is in.
2. Read [docs/backlog.md](docs/backlog.md): what is in progress, next, and still an open question.
3. Only if the task involves the Pi: confirm it is reachable and read its state (see "Reaching the Pi"). The Pi's checkout at `/home/pi/pi-photo-hub` is known to be dirty (`api/slideshow_url.txt` holds the saved slideshow, plus file-mode changes; backlog B06). Do **not** "fix" that with `git checkout`, `git clean`, `git stash` or `git reset` on the Pi.
4. Never rely on chat history or personal memory for project facts. If a fact matters, it belongs in this repo.

## Hard rules

These are non-negotiable. The reasoning and how each is enforced is in [docs/principles.md](docs/principles.md).

1. **NEVER modify the photo HDD** (mounted at `/mnt/photos` on the Pi, device `/dev/sda`). No writes, deletes, renames, moves, `fsck`, `mkfs`, `dd`, `wipefs`, `parted`, label changes, `chmod`/`chown`, remounting read-write, or anything else that changes its contents or filesystem, by any route: a direct command, a script you write or copy to the Pi, `rsync --delete`, `find -delete`, or any file-changing action in the Picapport web UI (tagging, rotating, deleting; whether it can write to photos is unverified, see Q4 in the backlog, so do not use such actions). Read-only commands only (`ls`, `find` without delete actions, `df`, reading files). This is the owner's irreplaceable photo library. If a task seems to need a change to the HDD, stop and ask the owner; the owner does it, not an agent.
2. **Build the project, not the instance.** Make changes in this repo so they work on a fresh build on new hardware, then apply them to the Pi through the same path a fresh build uses. Do not make ad hoc changes on the Pi. The Pi is never the source of truth. There is no automated apply/update path yet (backlog B06), so until there is, agree any change to the Pi with the owner first. **Never run `cleanup.sh` or `bootstrap.sh` on the Pi as an agent.** `cleanup.sh` stops all services, unmounts the HDD, deletes and re-clones the checkout, and can delete the Picapport database; it is for the owner's deliberate rebuilds.
3. **Docs move with code.** Any change to a script, service, config or behaviour updates, in the same commit: the README runbook (where a procedure has both a manual and an automated form, keep both), the relevant `docs/` page, and `docs/backlog.md`.
4. **Do not assume.** If a fact is not verified, write it in the backlog as an open question rather than stating it as fact in docs.

## Working with the owner

This is how every session should behave. It is a working style, not a technical control, and it exists so the owner always knows what is going on and can steer.

- **Discuss before changing.** When a task would change the project (repo files, scripts, docs) or the Pi (services, config, files, reboot, cron, anything over SSH that writes), first tell the owner what you propose and get their agreement, then act. Say what you will touch, why, the risk, and how to undo it. Keep it short enough to read on a phone.
- **Investigate freely.** Read-only work (reading files and logs, `git status`, read-only SSH, screenshots) needs no discussion.
- **Stay inside what was agreed.** If the plan needs to grow, say so and agree the new scope before doing it.
- **Keep the owner informed.** Say briefly what you are doing and what you found. Report outcomes faithfully, including failures and anything you skipped.
- **Raise assumptions and surprises.** Record unknowns in the backlog (hard rule 4) and tell the owner.

## Reaching the Pi

- Address: `pi.local` (mDNS; resolved from the owner's Windows PC as of 2026-11-15). The Pi gets its IP by DHCP and it can change; the last seen address is in [docs/network.md](docs/network.md). If `pi.local` fails, run `pwsh -File scripts\find-pi.ps1` (needs PowerShell 7).
- SSH, PowerShell: `ssh -i $env:USERPROFILE\.ssh\id_pi_photo_hub pi@pi.local`
- SSH, Git Bash: `ssh -i ~/.ssh/id_pi_photo_hub pi@pi.local`
- The key is per-machine and is never in the repo. No `ssh` host alias is guaranteed to exist; the README ("SSH Access") describes an optional `pi-hub` alias. Setup and recovery are in the README.
- Read-only Pi state check: `ssh ... pi@pi.local "cd ~/pi-photo-hub && git status --short && git log --oneline -1; systemctl is-active mount-hdd photo-api picapport-wrapper"`.
- The `pi` user has passwordless `sudo`. Treat every `ssh` command as potentially destructive unless it is plainly read-only.
- Slideshow control without SSH: the API at `http://pi.local:3000` (see [docs/architecture.md](docs/architecture.md)).
- Machine-specific settings (SSH key location, host aliases) live outside the repo, in `~/.ssh/config`. Do not create gitignored repo-local config: it is not present in git worktrees.

## Shell environment

The owner's PC is Windows 11. Two shells are available: PowerShell, and Git Bash through the Bash tool. `scripts/*.sh` run on the Pi (Linux), not on the PC. `scripts/*.ps1` are PC-side helpers and some require PowerShell 7 (`pwsh`), not the built-in `powershell` 5.1.

## Git standard

Kept deliberately simple; the owner is the only maintainer. No git hooks.

- **Commits:** Conventional Commits, `<type>(<scope>): <description>`, types `feat fix chore docs refactor test ci`. No `Co-Authored-By` lines and no AI attribution.
- **`main` is what a fresh Pi builds.** It is intended to always work. (A fresh build has not been re-tested since September 2025, backlog B11, so treat this as the goal, not a guarantee.) A fresh Pi clones `main`.
- **Default:** small commits straight to `main`, for documentation and low-risk changes. One logical change per commit, including its docs and backlog updates (hard rule 3).
- **Exception:** code that could break a fresh build or the running Pi (bootstrap, systemd units, mount scripts, update scripts) goes on a short-lived `feat/<topic>` or `fix/<topic>` branch. Push the branch so other clones and worktrees can see it. Test it on the Pi (`update.sh --branch <name>` once that exists; until then by an approved plan), then merge to `main` with `git merge --ff-only`. If `main` has moved on and `--ff-only` fails, merge `main` into the branch, retest, then fast-forward `main`. No pull request is needed. This repo-level rule overrides the global "use PRs for main" rule, by the owner's explicit decision; the global rule may still make a session ask first, which is fine.
- Never force-push or rebase. Never `git reset --hard` without the owner's explicit instruction.
- The Pi pulls from GitHub, so a change reaches the Pi only after it is pushed.

## Where things are

| Need | Look at |
|---|---|
| What is in progress / next / unknown | [docs/backlog.md](docs/backlog.md) |
| The rules and how they are enforced | [docs/principles.md](docs/principles.md) |
| Components, services, paths, API | [docs/architecture.md](docs/architecture.md) |
| Network layout (router, Deco, Pi) | [docs/network.md](docs/network.md) |
| Hardware | [docs/hardware.md](docs/hardware.md) |
| Runbooks (install, SSH, DB fix, ...) | [README.md](README.md) |

## Keeping this context current

A new session must be able to pick up from the repo alone. When something about the project changes (a service, a path, the network, a decision, a discovered fact) update the matching doc in the same commit. When you learn something that is not yet verified, add it to the backlog as an open question.
