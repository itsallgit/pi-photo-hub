# Pi Photo Hub — Project Instructions

A Raspberry Pi 4 that plays the owner's photo library as a slideshow on an attached monitor. Picapport (Java) indexes the photos on an attached HDD; a small Node.js API (`photo-api`) launches Chromium in kiosk mode on a Picapport slideshow URL. This repo is the **whole project**: install scripts, Pi configuration, the API, documentation and the AI agent configuration used to manage it.

The Pi has **no keyboard or mouse** attached, only a monitor (see [docs/hardware.md](docs/hardware.md)). Never ask the owner to click, type or press a button on the Pi; plan everything to work over SSH, the API or the power button.

Project principle: **long-lasting information lives in the photos' own metadata.** Picapport's database is a disposable index that is rebuilt from the images and folder structure; nothing that must last may exist only there (see [docs/principles.md](docs/principles.md), principle 11).

This file holds context and the always-on rules. **How to do things lives in skills** (see "Skills" below), not here.

## Session start

1. `git status` and `git log --oneline -5`: know what state the repo is in.
2. Read [docs/backlog.md](docs/backlog.md): what is in progress, next, and still an open question.
3. If the task involves the Pi, use the `pi-access` skill to reach it and read its state. The Pi's checkout at `/home/pi/pi-photo-hub` is changed only by `scripts/update.sh` (the `apply-changes` skill); it may be on a test branch (backlog B06). If it is dirty, report it; do **not** "fix" it with `git checkout`, `git clean`, `git stash` or `git reset` on the Pi.
4. Never rely on chat history or personal memory for project facts. If a fact matters, it belongs in this repo.

## Hard rules

These are non-negotiable. The reasoning and how each is enforced is in [docs/principles.md](docs/principles.md).

1. **NEVER modify the photo HDD** (mounted at `/mnt/photos` on the Pi, device `/dev/sda`). No writes, deletes, renames, moves, `fsck`, `mkfs`, `dd`, `wipefs`, `parted`, label changes, `chmod`/`chown`, remounting read-write, or anything else that changes its contents or filesystem, by any route: a direct command, a script you write or copy to the Pi, `rsync --delete`, `find -delete`, or any file-changing action in the Picapport web UI (tagging, rotating, deleting; whether it can write to photos is unverified, see Q4 in the backlog, so do not use such actions). Read-only commands are fine, including ones that name paths on it (`ls`, `ls -ld`, `find` without delete actions, `df`, reading files). A normal OS shutdown or reboot (`systemctl reboot` / `poweroff`), which unmounts the HDD itself, is allowed; running `mount` or `umount` on it by hand is not. This is the owner's irreplaceable photo library. If a task seems to need a change to the HDD, stop and ask the owner. You may give the owner a command to run themselves, but never run it or copy it to the Pi: the owner does HDD changes, not an agent.
2. **Build the project, not the instance.** Make changes in this repo so they work on a fresh build on new hardware, then apply them to the Pi through the same path a fresh build uses. Do not make ad hoc changes on the Pi. The Pi is never the source of truth. There is no automated apply/update path yet (backlog B06), so until there is, agree any change to the Pi with the owner first. **Never run `cleanup.sh` or `bootstrap.sh` on the Pi as an agent.** `cleanup.sh` stops all services, unmounts the HDD, deletes and re-clones the checkout, and can delete the Picapport database; it is for the owner's deliberate rebuilds.
3. **Docs move with code.** Any change to a script, service, config or behaviour updates, in the same commit: the README runbook (where a procedure has both a manual and an automated form, keep both), the relevant `docs/` page, the matching skill if there is one, and `docs/backlog.md`.
4. **Do not assume.** If a fact is not verified, write it in the backlog as an open question rather than stating it as fact in docs.

## Working with the owner

This is how every session should behave. It is a working style, not a technical control. The point is that the owner understands what is going to happen before it happens, and that you understand what they are trying to achieve before you build it.

- **The owner understands a change before it happens.** For anything that changes the Pi (a database reset, restarting or reconfiguring services, files, cron, a reboot, any SSH command that writes) or changes how the project behaves, say what you propose, why, the risk, and how to undo it, and get the owner's agreement first. Keep it short enough to read on a phone.
- **You understand the objective before extending the project.** For a new feature or a substantial extension (for example the planned knob-and-buttons board), first make sure you understand what the owner is trying to achieve, discuss the options and agree a plan. Do not go straight in.
- **Never suggest the power-cable button.** The owner switches the Pi off and on by the cable, a hard power cut that probably corrupts Picapport's database (backlog Q3). Whenever the Pi needs to be switched off or restarted, say so and offer a clean shutdown or reboot over SSH (agree it first), so the owner never has to remember to ask.
- **Bookkeeping needs no review.** Updating the backlog, docs and similar notes to reflect what is known or decided is part of the job and needs no discussion.
- **Investigate freely.** Read-only work (reading files and logs, `git status`, read-only SSH, screenshots) needs no discussion.
- **Stay inside what was agreed.** If the plan needs to grow, say so and agree the new scope first.
- **Keep the owner informed.** Say briefly what you are doing and what you found. Report outcomes faithfully, including failures and anything you skipped.
- **Raise assumptions and surprises.** Record unknowns in the backlog (hard rule 4) and tell the owner.

## Skills

Operational procedures ("how to do X") are skills in `.claude/skills/<name>/SKILL.md`. This file stays context and rules only. If you find yourself writing numbered steps or commands into this file, they belong in a skill.

| Skill | Use it to |
|---|---|
| `pi-access` | Reach the Pi over SSH, read its state and logs, see its screen |
| `git-workflow` | Commit, branch, test a branch on the Pi, merge to `main`, push |
| `apply-changes` | Get a change (or a branch, or a rollback) onto the Pi with `scripts/update.sh`, behind an agreement gate |
| `skill-authoring` | Create or change a skill: where content belongs, the template, the build-and-cold-test method |
| `picapport-db` | **Draft (B04).** Diagnose and repair Picapport's database on copies: status, snapshot, repair playbook, case history |

More skills are planned (backlog B18). Each is written together with the script or procedure it describes, so it never documents something untested.

## Shell environment

The owner's PC is Windows 11. Two shells are available: PowerShell, and Git Bash through the Bash tool. Python 3.15 is installed for the user (on the user PATH for new shells; older shells may still hit the Microsoft Store `python` alias). There is no Java on the PC apart from the one bundled with Android Studio; OrientDB and other Pi-side tools run on the Pi (owner, 2026-11-15). `scripts/*.sh` run on the Pi (Linux), not on the PC. `scripts/*.ps1` are PC-side helpers and some require PowerShell 7 (`pwsh`), not the built-in `powershell` 5.1.

## Git standard

Kept deliberately simple; the owner is the only maintainer. No git hooks.

- **Commits:** Conventional Commits, `<type>(<scope>): <description>`, types `feat fix chore docs refactor test ci`. No `Co-Authored-By` lines and no AI attribution.
- **`main` is what a fresh Pi builds.** It is intended to always work. (A fresh build has not been re-tested since September 2025, backlog B11, so treat this as the goal, not a guarantee.) A fresh Pi clones `main`.
- **Default:** small commits straight to `main`. One logical change per commit, including its docs and backlog updates (hard rule 3). Risky code goes on a short-lived branch and is tested on the Pi before a fast-forward merge to `main`; no pull request is needed (the owner's decision, overriding the global "use PRs for main" rule). The steps are in the `git-workflow` skill.
- Never force-push or rebase. Never `git reset --hard` without the owner's explicit instruction.
- The Pi pulls from GitHub, so a change reaches the Pi only after it is pushed.

## Where things are

| Need | Look at |
|---|---|
| What is in progress / next / unknown | [docs/backlog.md](docs/backlog.md) |
| The rules and how they are enforced | [docs/principles.md](docs/principles.md) |
| Components, services, paths, API | [docs/architecture.md](docs/architecture.md) |
| Network layout (router, Deco, Pi) | [docs/network.md](docs/network.md) |
| Picapport database facts and repair history | [docs/picapport-db.md](docs/picapport-db.md) |
| Hardware | [docs/hardware.md](docs/hardware.md) |
| How to do things | `.claude/skills/` |
| Runbooks for humans (install, SSH, DB fix, ...) | [README.md](README.md) |

## Keeping this context current

A new session must be able to pick up from the repo alone. When something about the project changes (a service, a path, the network, a decision, a discovered fact) update the matching doc, and the matching skill, in the same commit. When you learn something that is not yet verified, add it to the backlog as an open question.
