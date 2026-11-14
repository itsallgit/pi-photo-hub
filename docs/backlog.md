# Backlog

The working list for this project. Keep it current: update it in the same commit as the work (see [CLAUDE.md](../CLAUDE.md)). Order within each section is the intended order of work. Status: `todo`, `doing`, `blocked`, `done`.

Last updated: 2026-11-15.

## Where we are right now

The owner and Claude were mid-way through diagnosing why the slideshow stops with a "Network Error" dialog, and decided to first set up project foundations: this documentation (B01, done), then the agent configuration in the repo (B02), then continue the backlog from Paseo, starting with `update.sh` (B06), which is how changes get onto the Pi. The health logger (`scripts/health-log.sh`, `scripts/install-health-log.sh`, and their bootstrap/cleanup hooks) is committed to `main` but has **never been run on the Pi**; bootstrap would install it on a fresh Pi. The Pi's configuration has not been changed in this work: it was only rebooted cleanly on 2026-11-15, and SSH access was recovered from the SD card.

## Now

| ID | Item | Status | Notes |
|---|---|---|---|
| B01 | Foundation docs: `CLAUDE.md`, `AGENTS.md`, `docs/` | done | Reviewed by an independent Opus 5.5 subagent on 2026-11-15; corrections applied. |
| B02 | Agent configuration in the repo: `.claude/settings.json` (permissions, HDD guard hook), `.gitignore`, and the cold-start acceptance test in Paseo | todo | Flat skills, no named agents, no orchestrator (owner decision). Skills are added later, each when the script or procedure it describes exists (for example `picapport-db-fix` with B04, an apply skill with B06), so they never describe untested procedures. The slideshow/tagging/query skills are future work (L2), not designed yet. Confirm exact hook and permission syntax against Claude Code docs before writing. After the acceptance test passes the work continues from Paseo. |

## Next (in order)

| ID | Item | Status | Notes |
|---|---|---|---|
| B03 | Diagnose why the slideshow shows "Network Error" after a while | doing | Pi was cleanly rebooted 2026-11-15 08:06 and the slideshow came back (saved query "our wedding"). Known: the dialog appears when one JSON call from the slideshow page fails; Picapport's database is damaged (hundreds of `OPageIsBrokenException`) and the crawler logs `OLockException: No more resources available in pool (max=100)`; no Picapport access log was found (Q9), so the time of failure is unknown; no JSON errors were found in the current day's log. Suspects: database or pool errors, the midnight "new day" crawler, Java memory, clock jump at boot (no RTC), Chromium. Plan: deploy `scripts/health-log.sh` (in `main`, untested) via `update.sh` once it exists (B06), with the persistent text log (see B09), leave it over midnight, line up the 5-minute screenshots with the log. |
| B04 | Database fix script (`scripts/fix-picapport-db.sh`) with `--dry-run`, backup first, README Manual and Automated sections | todo | Manual steps exist in the README ("Picapport Database Fix") but need improving. Test step by step with the owner on the Pi. |
| B05 | Confirm the honeymoon photos display | blocked by B04 | Folder is `/mnt/photos/PHOTOS/2026.09 - 2026.10 - Honeymoon` (about 11,900 files, 18 subfolders). New photos cannot be indexed while the database is read-only/broken. Then set the slideshow query via `/api/slideshow`. |
| B06 | **First task from Paseo.** `scripts/update.sh` (fetch, check out `main` or a named branch for testing, re-apply units/cron/API dependencies, restart only what changed); move `slideshow_url.txt` out of the repo to `/var/lib/photo-api/`; add `.gitignore` (node_modules, package-lock) | todo | Default slideshow on a fresh Pi: random photos from the current year (owner's suggestion; check Picapport's query syntax for dates first). Update keeps the saved slideshow; a fresh build or `--reset-slideshow` uses the default. Add a `.gitignore` covering `api/node_modules/` and `.claude/settings.local.json` (the machine-local permission file, so "always allow" choices are never committed). `update.sh` refuses a dirty checkout and offers an explicit `--discard-local-changes`. Currently the Pi's checkout also has file-mode-only drift (`bootstrap.sh`, `scripts/mount-hdd.sh`). |
| B07 | `scripts/provision.ps1` (PC to blank Pi: install SSH key, clone, bootstrap) and `scripts/verify.sh` (drift report) | todo | Replaces the README's manual "create a helper script" step. |
| B09 | Logging standard: shared logrotate config for `/var/log/pi-photo-hub/`, persistent journald with a size cap, health text log moved to `/var/log/pi-photo-hub/health.log` (screenshots stay in RAM) | todo | Decided: the Pi gets hard power cuts, so a RAM log is lost when it is most needed. The Node API's own winston rotation is kept and documented as an exception for now. |
| B10 | Clean shutdown/reboot route (API endpoint, and a physical button) | todo | The owner switches the Pi off with the cable button, a hard power cut that probably causes the database corruption (Q3). Ties to the planned button board. |
| B11 | Fresh-build test: run the full bootstrap on a spare SD card/blank Pi | todo | The bootstrap has not been run since September 2025, so "a fresh build works" is unproven. |
| B12 | Remove the stale `~/.config/autostart/picapport-chromium.desktop` (starts Chromium at `localhost:80`) in a repo-managed way | todo | Drift on the Pi, not from the repo. |
| B13 | Check script: shell syntax, dry runs, docs-sync check (changed script without a doc change), simple secret pattern check | todo | No git hooks (owner preference); run by hand or by an agent before committing. |
| B14 | `find-pi.ps1` works only in PowerShell 7 (`pwsh`); make it work in the built-in `powershell` 5.1 or keep the documented requirement | todo | Minor. |
| B15 | Mark `cleanup.sh` in the README as destructive and for the owner's deliberate rebuilds only | todo | Today it is the only documented route to new code on the Pi: it cannot test a branch (it clones `main`), deletes the checkout, and bootstrap then runs `apt full-upgrade` and reboots. B06 (`update.sh`) replaces it for day-to-day changes. |
| B16 | `scripts/mount-hdd.sh`: pin the HDD by UUID or label (`Expansion`) instead of "first non-SD partition", and make the mount wait for the device | todo | See architecture.md "Start order". The README's `mount-hdd.log` line is stale: the file exists but was last written in September 2025; the script now logs to stdout. |
| B17 | `GET /api/slideshow`: do not overwrite the saved slideshow when only some parameters are given (for example `?interval=10`) | todo | See architecture.md. |

## Later

| ID | Item | Notes |
|---|---|---|
| L1 | Knob-and-three-buttons board connected to the Pi | Needs decisions on the board, its interface and the functions. Candidates: clean shutdown, next slideshow, screen on/off. |
| L2 | Improve image tagging and slideshow query logic, as its own skill(s) | Owner-led plan. Not designed. Do not solution until the owner asks. |
| L3 | Replace Picapport and/or the Node.js server with a custom solution | Deferred by the owner. |
| L4 | Reserve the Pi's address in the Deco app | **Manual step for the owner.** No static IP is configured on the router or the Deco today. |
| L5 | Authentication for the photo API | It is open on the LAN today. |
| L6 | Optional hardening: mount the HDD read-only (`mount -o ro` in `mount-hdd.sh`) | Owner decided (2026-11-15) that agent boundaries live in the agent setup, not on the Pi, so this is not planned. If ever done, first answer Q4 (does Picapport write to photos?) and test that Picapport still crawls and serves. The `pi` user has passwordless sudo, so a read-only mount is not a hard guarantee anyway. |

## Open questions (unverified; do not state as fact in docs)

| ID | Question |
|---|---|
| Q1 | Is the Vodafone router in bridge/modem mode, or routing? Is the Deco in router or access-point mode? (The `192.168.68.x` addressing suggests the Deco is the router, but this is an inference.) |
| Q2 | Where do the Pi's DNS servers (`8.8.8.8`, `8.8.4.4`) come from: the Deco's DHCP or a manual setting? |
| Q3 | The owner says they normally turn the Pi off and on with the button on the power cable (a hard power cut). Does that account for the repeated Picapport database corruption? (Also possible: SD card wear.) |
| Q4 | Does Picapport ever write to photo files (for example when tagging or rotating)? This decides whether the optional read-only mount (L6) is possible. |
| Q5 | What do Picapport's `users` and `roles` configuration control (login, permissions)? |
| Q6 | What interface does the knob-and-buttons board use (GPIO or USB), and what should it do? |
| Q7 | Picapport's jar manifest says `Version: 9` while its web UI reports `10.4.0`. Which version and licence terms apply? |
| Q8 | Does the owner have tags, ratings or other data in Picapport that cannot be rebuilt from the photos? This decides how risky a database reset or `cleanup.sh delete-picapport` is. |
| Q9 | `config/picapport.properties` sets `user.log.access=true`, but no access log was found in `/opt/picapport/.picapport/logfiles/`. Where does Picapport write it, or is it off? (Affects B03: Picapport does not give us request times.) |
## Done

| Item | When | Notes |
|---|---|---|
| Recover SSH access to the Pi from the SD card (`scripts/sd-recover.ps1`) | 2026-11-15 | Boot-partition one-shot script resets the password and enables SSH. |
| Key-based SSH from the owner's PC | 2026-11-15 | Key `~/.ssh/id_pi_photo_hub`; documented in the README. |
