---
name: pi-power
description: Use whenever the Pi has to be rebooted, shut down, switched off or restarted as a machine, for any reason ("restart the Pi", "turn it off", "we're going away", "it needs a reboot", a kernel setting that needs a reboot, after an update that asks for one). The only way an agent powers the Pi down or restarts it; it checks what is running first. Changes the Pi, with an agreement gate (a double one if jobs would be interrupted).
---

# Rebooting and shutting down the Pi

**Every reboot and shutdown goes through this skill and `scripts/pi-power.sh`.** Its job is assurance: nothing is switched off by accident, and Picapport has closed its database before the machine goes down. A hard stop (the cable button while the Pi runs, or Picapport being killed) is the strongest suspect for the past database damage (backlog Q3, Q11).

The script, run on the Pi: refuses if a project job is running; stops Picapport on its own and checks it logged "shutdown completed" (up to 5 minutes; 63 s measured); records the result in `/var/log/pi-photo-hub/power.log`; then `systemctl reboot` or `poweroff`. The OS unmounts the photo HDD as part of a normal reboot/shutdown, which hard rule 1 allows; never `umount` it yourself. Read `bash ~/pi-photo-hub/scripts/pi-power.sh --help` for the exact behaviour.

**This changes the Pi.** Reboot and shutdown are separate commands; never turn one into the other.

## Steps

Connect as in the `pi-access` skill (`ssh -i ~/.ssh/id_pi_photo_hub -o BatchMode=yes -o ConnectTimeout=10 pi@pi.local "<command>"`).

1. **Dry run (read-only):** `bash ~/pi-photo-hub/scripts/pi-power.sh reboot --dry-run --reason "<why>"` (or `shutdown`). It lists the project jobs running now and the plan. Exit 3 means it would refuse because of jobs.
2. **Agreement gate.** Tell the owner, short enough for a phone:
   - what (reboot or shutdown) and why;
   - what is running (from the dry run) and what the screen does: a reboot takes the slideshow off for about 2-3 minutes and it comes back by itself; a shutdown leaves it off until the owner switches the Pi back on;
   - the risk (low when nothing is running: Picapport is stopped cleanly first) and the undo (below).
   Wait for a yes.
3. **If jobs are running** (exit 3), do not use `--force` on the first yes. Recommend waiting (watch with `scripts/whats-running.sh`; a vocabulary refresh takes about 40 minutes). If the owner still wants to go ahead, **confirm a second time**, stating what is interrupted:
   - *safe to interrupt* (vocabulary refresh, metadata survey, test set): the job is lost and runs again next time; nothing is damaged.
   - *NOT safe* (`picapport-db.sh`, `update.sh`): a database repair or snapshot is cut off part-way (Picapport may come back on an unexpected database, or not start); an update is left half applied (re-run `update.sh` afterwards).
   Only after a second, explicit yes to those consequences, add `--force`.
4. **Run it** without `--dry-run`, with the same `--reason`. Allow up to 6 minutes for the Picapport stop (do not wrap it in a shorter timeout). Exit 1 with "java process is still running" means it did **not** power off and started Picapport again: report it, do not retry blindly.
5. **After a reboot:** wait about 90 s, then retry `ssh ... true` every 15 s for up to 5 minutes. Then wait about 2 more minutes (the slideshow launcher waits up to 120 s for Picapport) and verify (below).
6. **After a shutdown:** retry `ping -n 1 pi.local` until it stops answering, then wait 15 s more. Tell the owner: "The Pi has shut down. You can switch it off at the cable now. To start it again, switch the cable off and on." Verify after the next start.

## Verify

`bash ~/pi-photo-hub/scripts/pi-power.sh verify` (read-only) reports: whether this boot followed a `pi-power` reboot/shutdown (or a power cut), whether Picapport's previous run ended with "shutdown completed", the HDD's "not properly unmounted" message at this boot (0 expected, Q11), the previous boot's journal lines about the HDD unmount, the services, HTTP codes and Chromium; it ends `VERIFY: OK` or `VERIFY: PROBLEM`. Then take a screenshot (`pi-access`) to see the slideshow. Tell the owner the result, including anything odd.

## Undo

A reboot has nothing to undo. If the Pi does not come back within 5 minutes, say so and follow `pi-access` "If pi.local does not answer"; do not suggest the cable button while it might still be running. If `verify` reports a problem, investigate read-only (`pi-access` logs, `picapport-db.sh status`) and report.

## Do not

- Reboot or power off any other way (`sudo reboot`, `systemctl reboot`, `shutdown`, `halt`), or as a side step of another task without this gate.
- Suggest the cable button while the Pi is running. It is only for after a finished shutdown (step 6). Background: the owner used to switch the Pi off at the cable, a hard power cut (backlog Q3).
- Use `--force` without the double confirmation in step 3.
- `mount`/`umount` the HDD, or stop `mount-hdd` (hard rule 1).
- Offer a reboot as a fix for a slideshow problem without first finding out what is wrong (`pi-access`).

## Links

`scripts/pi-power.sh`, `scripts/lib/project-jobs.sh`, `scripts/whats-running.sh`; README "Rebooting and Shutting Down"; `docs/architecture.md` ("Stop order and how the parts fail together", "Power"); backlog B10, Q3, Q11.

## Last verified

2026-11-17: script logic tested on the Pi in a scratch folder with stubbed `systemctl`/`pgrep` (dry run, refusal for safe and unsafe jobs, `--force`, clean reboot, java that will not stop, shutdown, lock, verify). Real reboot on the Pi 2026-11-17 12:35: clean Picapport stop (3 s), back in about 45 s, slideshow playing by 12:38, `verify` OK (run it about 2 minutes after the boot: earlier, Picapport and Chromium are still starting). Live refusal during a vocabulary refresh (exit 3). Real shutdown: not yet done (needs the owner next to the Pi to switch it back on). Not yet cold-tested.
