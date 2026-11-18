# Pi Photo Hub — Project Instructions

A living photo wall: a Raspberry Pi 4 plays the owner's photo library on a shelf monitor, and the phone, a button board and Paseo steer it. **What the solution is, its parts and releases, and which page owns which fact: [docs/overview.md](docs/overview.md) (read it first).** This repo is the **whole project**: install scripts, Pi configuration, the API and pages, documentation and the AI agent configuration used to manage it. This file holds only the always-on rules, the working style and the skills list.

**The owner changes the project by just saying what they want** in a new session ("add a random transition", "the settings page should use drop-downs"). Use the `make-changes` skill: it has the owner's standing mandate, the tests, the deploy and the upkeep checklist (the code map is in `docs/architecture.md`).

The Pi has **no keyboard or mouse** attached, only a monitor (see [docs/hardware.md](docs/hardware.md)). Never ask the owner to click, type or press a key on the Pi; plan everything to work over SSH, the API or the power button. (The USB button board's keys are the exception: pressing them is how it is used and tested.)

Project principle: **long-lasting information lives in the photos' own metadata.** Picapport's database is a disposable index that is rebuilt from the images and folder structure; nothing that must last may exist only there (see [docs/principles.md](docs/principles.md), principle 11).

**How to do things lives in skills** (see "Skills" below), not here.

## Session start

1. `git status` and `git log --oneline -5`: know what state the repo is in.
2. Read [docs/overview.md](docs/overview.md) (the solution and where each fact lives) and [docs/backlog.md](docs/backlog.md) (what is in progress, next, and still an open question).
3. If the task involves the Pi, use the `pi-access` skill to reach it and read its state. The Pi's checkout at `/home/pi/pi-photo-hub` is changed only by `scripts/update.sh` (the `apply-changes` skill); it may be on a test branch (backlog B06). If it is dirty, report it; do **not** "fix" it with `git checkout`, `git clean`, `git stash` or `git reset` on the Pi.
4. Never rely on chat history or personal memory for project facts. If a fact matters, it belongs in this repo.
5. A request to build or change something: the `make-changes` skill. A request to see or steer photos: the `slideshow-control` skill.

## Hard rules

These are non-negotiable. The reasoning and how each is enforced is in [docs/principles.md](docs/principles.md).

1. **NEVER modify the photo HDD** (mounted at `/mnt/photos` on the Pi, device `/dev/sda`). No writes, deletes, renames, moves, `fsck`, `mkfs`, `dd`, `wipefs`, `parted`, label changes, `chmod`/`chown`, remounting read-write, or anything else that changes its contents or filesystem, by any route: a direct command, a script you write or copy to the Pi, `rsync --delete`, `find -delete`, or any file-changing action in the Picapport web UI (tagging, rotating, deleting; whether it can write to photos is unverified, see Q4 in the backlog, so do not use such actions). Read-only commands are fine, including ones that name paths on it (`ls`, `ls -ld`, `find` without delete actions, `df`, reading files). A normal OS shutdown or reboot (`systemctl reboot` / `poweroff`), which unmounts the HDD itself, is allowed; running `mount` or `umount` on it by hand is not. This is the owner's irreplaceable photo library. If a task seems to need a change to the HDD, stop and ask the owner. You may give the owner a command to run themselves, but never run it or copy it to the Pi: the owner does HDD changes, not an agent.
2. **Build the project, not the instance.** Make changes in this repo so they work on a fresh build on new hardware, then apply them to the Pi through the same path a fresh build uses (`scripts/update.sh`, the `apply-changes` skill). Do not make ad hoc changes on the Pi. The Pi is never the source of truth. **Never run `cleanup.sh` or `bootstrap.sh` on the Pi as an agent.** `cleanup.sh` stops all services, unmounts the HDD, deletes and re-clones the checkout, and can delete the Picapport database; it is for the owner's deliberate rebuilds.
3. **Docs move with code.** Any change to a script, service, config or behaviour updates, in the same commit: the README runbook (where a procedure has both a manual and an automated form, keep both), the relevant `docs/` page, the matching skill if there is one, and `docs/backlog.md`.
4. **Do not assume.** If a fact is not verified, write it in the backlog as an open question rather than stating it as fact in docs.

## Working with the owner

This is how every session should behave. It is a working style, not a technical control. The point is that the owner understands what is going to happen before it happens, and that you understand what they are trying to achieve before you build it.

- **The owner understands a change before it happens.** For anything that changes the Pi (a database reset, restarting or reconfiguring services, files, cron, a reboot, any SSH command that writes) or changes how the project behaves, say what you propose, why, the risk, and how to undo it, and get the owner's agreement first. Keep it short enough to read on a phone.
- **You understand the objective before extending the project.** For a new feature or a substantial extension (for example the ingestion pipeline), first make sure you understand what the owner is trying to achieve, discuss the options and agree a plan. Do not go straight in.
- **Every reboot and shutdown goes through the `pi-power` skill.** It checks what is running, stops Picapport cleanly first and holds the agreement gate (a double confirmation if it would interrupt a job). Never reboot or power off the Pi any other way. Whenever the Pi needs to be switched off or restarted, say so and offer it, so the owner never has to remember to ask.
- **Never suggest the power-cable button while the Pi is running.** Background: the owner used to switch the Pi off and on by the cable, a hard power cut that probably corrupted Picapport's database (backlog Q3). The cable is only for after a finished `pi-power` shutdown, and to switch the Pi back on.
- **Development has a standing mandate (owner, 2026-11-18).** For changes to the project the owner asks for, the `make-changes` skill's mandate replaces the per-change agreement above: small changes are built, tested, committed to `main`, deployed and checked without asking; a feature gets a short agreed plan first, then is built on a branch and deployed to the Pi freely, and merged to `main` only on the owner's "go". Everything on that skill's "still needs the owner" list (the photo HDD, reboots, Picapport, `cleanup.sh`/`bootstrap.sh`, destructive git) is unchanged.
- **Slideshow requests need no confirmation.** Playing or changing the slideshow and switching the screen through the photo API, when the owner asks for it, is everyday use: act first, then report (the `slideshow-control` skill). This covers only the photo API; anything else that changes the Pi still needs agreement first.
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
| `pi-power` | Reboot or shut down the Pi cleanly with `scripts/pi-power.sh`: checks what is running, stops Picapport first, agreement gate |
| `make-changes` | Build a feature, change or fix the owner asks for: code map, tests, deploy and check on the Pi, docs; holds the standing mandate |
| `project-hygiene` | Check that docs, skills and README still match the code and the Pi, and fix drift in targeted edits (now and then, at a release, or on request) |
| `skill-authoring` | Create or change a skill: where content belongs, the template, the build-and-cold-test method |
| `picapport-db` | **Draft (B04).** Diagnose and repair Picapport's database on copies: status, snapshot, repair playbook, case history |
| `button-board` | Check the button board, learn what it sends, change what a key does, test with a virtual board |
| `slideshow-control` | Show photos from plain words ("us in Barcelona"), change the slideshow ("slower"), switch the screen ("off for an hour"), keep the private word list, through the photo API |

More skills are planned (backlog B18). Each is written together with the script or procedure it describes, so it never documents something untested.

## Shell environment

The owner's PC is Windows 11. Two shells are available: PowerShell, and Git Bash through the Bash tool. Python 3.15 is installed for the user (on the user PATH for new shells; older shells may still hit the Microsoft Store `python` alias). There is no Java on the PC apart from the one bundled with Android Studio; OrientDB and other Pi-side tools run on the Pi (owner, 2026-11-15). `scripts/*.sh` run on the Pi (Linux), not on the PC. `scripts/*.ps1` are PC-side helpers; `find-pi.ps1` works in the built-in `powershell` 5.1 and in PowerShell 7 (`pwsh`), and any that need 7 say so in their header.

## Git standard

Kept deliberately simple; the owner is the only maintainer. No git hooks.

- **Commits:** Conventional Commits, `<type>(<scope>): <description>`, types `feat fix chore docs refactor test ci`. No `Co-Authored-By` lines and no AI attribution.
- **`main` is what a fresh Pi builds.** It is intended to always work. (A fresh build has not been re-tested since September 2025 and no test is planned; the owner will revise the build when it is next done on new hardware. Treat this as the goal, not a guarantee.) A fresh Pi clones `main`.
- **Default:** small commits straight to `main`. One logical change per commit, including its docs and backlog updates (hard rule 3). Features and risky code go on a short-lived branch and are tested on the Pi before a fast-forward merge to `main` on the owner's "go"; no pull request is needed (the owner's decision, overriding the global "use PRs for main" rule). The steps are in the `git-workflow` skill; which is which is in the `make-changes` skill.
- **Releases** are annotated tags on `main` (`v1.0` = the slideshow layer, 2026-11-18), made when the owner calls something a release.
- Never force-push or rebase. Never `git reset --hard` without the owner's explicit instruction.
- The Pi pulls from GitHub, so a change reaches the Pi only after it is pushed.

## Where things are

The map of which page owns which kind of fact is in [docs/overview.md](docs/overview.md), "Where each kind of fact is kept". Most used: [docs/backlog.md](docs/backlog.md) (work and open questions), [docs/architecture.md](docs/architecture.md) (technical reference and code map), [docs/principles.md](docs/principles.md) (the rules and their enforcement), [README.md](README.md) (runbooks for people), `.claude/skills/` (how to do things).

## Keeping this context current

A new session must be able to pick up from the repo alone. When something about the project changes (a part, a service, a path, the network, a decision, a discovered fact) update its master page (docs/overview.md says which) and the matching skill, in the same commit; the checklist is in the `make-changes` skill, "Keep the project current". Copy a fact into a second place only as a link. When you learn something that is not yet verified, add it to the backlog as an open question.
