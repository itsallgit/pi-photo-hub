---
name: picapport-db
description: Use when Picapport's database may be damaged: "broken page" or OLockException errors in Picapport's log, new photos not appearing, the slideshow white or showing "Network Error", or the owner asks to fix or check the database. Diagnoses the damage and repairs it on copies, mildest treatment first; never a full rebuild without the owner's decision. Status is read-only; snapshots and repairs change the Pi, with an agreement gate.
---

# Diagnosing and repairing Picapport's database

**DRAFT, built while doing B04.** Only the steps marked *tested* below have been run on the Pi. Facts about the database and the case history are in `docs/picapport-db.md`; read it first, and add to its case history every time.

The approach is a doctor's routine: symptoms, diagnosis, treatment from a playbook (mildest first), then a case-history entry. The owner's rule (2026-11-15): **repair, do not rebuild.** A full re-index from the photos is the last resort and only by the owner's decision.

Hard rules (`CLAUDE.md`): the photo HDD is never modified; changes reach the Pi through the repo; agree every change to the Pi first. Picapport restarts are suspected to damage the database (backlog Q11), so never restart it casually.

## Preconditions

1. `scripts/picapport-db.sh` is on the Pi (it arrives with `update.sh`, see the `apply-changes` skill).
2. Pi reachable (`pi-access` skill).

## 1. Symptoms (read-only)

`bash ~/pi-photo-hub/scripts/picapport-db.sh status`: Picapport's state, database size, newest write (a date long ago means it went read-only), the dirty flag, the broken-page reports in Picapport's log (which files and pages) and the other error types. Compare with the symptom table in `docs/picapport-db.md`.

## 2. Diagnosis

Run OrientDB's own check on a **copy** (never the live database): `CHECK DATABASE -v` names every damaged file and page (about 20 s). Index files (`idx...`) are derived data and can be rebuilt from the records; position maps (`.cpm`) and record files (`.pcl`) hold or locate the data itself. Compare `LIST CLASSES` (records) with `LIST INDEXES` (what an index can reach): the gap is the number of records a damaged map page hides. The console commands and their output are in `docs/picapport-db.md`; `repair` runs the check for you.

## 3. Treatment playbook (mildest first; all on copies)

| Step | Command | Changes | Status |
|---|---|---|---|
| Snapshot the live database | `picapport-db.sh snapshot` (`--dry-run` first) | Stops Picapport (about 1 min: it is killed after 60 s, see `docs/picapport-db.md`), copies `db/` (about 30 s for 696 MB) to a read-only snapshot in `/home/pi/picapport-db-work/`, starts Picapport (about 15 s) and the slideshow again; about 2 min in all. The live database is only read | **tested on the Pi** 2026-11-15 |
| Automatic weekly snapshot (B25) | Cron, Sundays 04:30: `picapport-db.sh scheduled` (`--dry-run` to preview). Skips while a database job or an update runs; else `snapshot --auto` then `prune` (keeps the newest 4 `snapshot-auto-*`; manual snapshots are never pruned). `picapport-db.sh prune --keep N [--dry-run]` by hand | The same as a snapshot, unattended; deletes old automatic snapshots | tested on the Pi with stubs 2026-11-17; first real run Sunday 2026-11-22 04:30 |
| Rebuild a broken index | `REBUILD INDEX <name>` in the OrientDB console, on a copy | Only the copy | **tested on a copy on the Pi** 2026-11-15 (cleared both damaged `idxfileName` pages in 25 s); not used alone, because a damaged map page also needs export/import |
| Repair: export everything reachable, import into a fresh database, check it, swap it in | `picapport-db.sh repair` (`--dry-run` first; `--no-swap` to stop after the check). **Maintenance window: Picapport and the slideshow are down for 15 to 30 min.** Records behind a damaged map page are not exported; Picapport's crawler re-adds them from the photos | Stops Picapport; the live database is moved aside and kept (`<work>/repair-<time>/live-before`); a fresh one takes its place. Rolls back by itself if the new one is not clean or Picapport will not start on it | **tested on the Pi 2026-11-15** (17 min of downtime; fixed the live database; see the case history). An earlier import alongside a running Picapport froze the Pi, hence the stop and the cache cap |
| Undo a swap | `picapport-db.sh restore <work>/repair-<time>/live-before` | Stops Picapport, puts the kept database back (the replaced one is kept too), starts it | tested on the PC with stubs only |
| Full re-index | **only by the owner's decision** | | |

**Agreement gate** before `snapshot` or any later step that changes the Pi: tell the owner what stops, for how long, what is copied or moved, the risk and the undo, and wait for a yes.

## Verify

After a snapshot: the script reports the stop time, whether Picapport logged a clean shutdown, the copy verified file by file, Picapport answering on port 8080 and the slideshow relaunched. Take a `pi-access` screenshot.

## Undo

A snapshot changes nothing on the live system. To delete one taken by hand: `chmod -R u+w <snapshot> && rm -r <snapshot>` (ask the owner; manual snapshots are kept until they decide). Automatic ones (`snapshot-auto-*`) are pruned by `scheduled`; stop the weekly run with `scripts/install-db-backup-cron.sh --remove` (a repo change to make it last, since `update.sh` reinstalls it).

## Do not

- Delete or move the live database, or start a full re-index, without the owner's explicit decision.
- Run OrientDB tools against the live database while Picapport runs, or against a snapshot (work on a further copy).
- **Run an OrientDB import (or anything heavier than `CHECK DATABASE`, `REBUILD INDEX` or `EXPORT DATABASE`) while Picapport and the slideshow are running.** On 2026-11-15 an import with `-Xmx768m` next to Picapport (about 1.4 GB) and Chromium (about 1.1 GB) on the 4 GB Pi made it stop answering SSH, the API and Picapport for over 30 minutes. Imports run only in an agreed maintenance window with Picapport stopped.
- Put any work files on `/mnt/photos`.
- Restart Picapport outside an agreed step.

## Links

`scripts/picapport-db.sh`; `docs/picapport-db.md` (facts, case history); README "Picapport Database Fix"; backlog B04, Q4, Q11.

## Last verified

2026-11-15: `status`, `snapshot` and `repair` run on the Pi (repair 21:44, successful). `restore` tested on the PC with stubs only. Not cold-tested.
