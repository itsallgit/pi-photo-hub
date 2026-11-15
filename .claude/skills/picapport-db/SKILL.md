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

From the broken-page list: index files (`idx...`) are derived data and can in principle be rebuilt from the records; record files (`.pcl`, `.cpm`) hold the data itself. *(Next to build: an offline `check` on a snapshot copy with the OrientDB console.)*

## 3. Treatment playbook (mildest first; all on copies)

| Step | Command | Changes | Status |
|---|---|---|---|
| Snapshot the live database | `picapport-db.sh snapshot` (`--dry-run` first) | Stops Picapport for a few minutes, copies `db/` to a read-only snapshot in `/home/pi/picapport-db-work/`, starts Picapport and the slideshow again. The live database is only read | tested on the PC only |
| Rebuild a broken index on a copy | to be built | | untested |
| Export/import on a copy | to be built (manual steps in the README) | | untested |
| Swap a repaired, checked copy in; keep the original | to be built | | untested |
| Full re-index | **only by the owner's decision** | | |

**Agreement gate** before `snapshot` or any later step that changes the Pi: tell the owner what stops, for how long, what is copied or moved, the risk and the undo, and wait for a yes.

## Verify

After a snapshot: the script reports the stop time, whether Picapport logged a clean shutdown, the copy verified file by file, Picapport answering on port 8080 and the slideshow relaunched. Take a `pi-access` screenshot.

## Undo

A snapshot changes nothing on the live system. To delete one: `chmod -R u+w <snapshot> && rm -r <snapshot>` (ask the owner; snapshots are kept until they decide).

## Do not

- Delete or move the live database, or start a full re-index, without the owner's explicit decision.
- Run OrientDB tools against the live database while Picapport runs, or against a snapshot (work on a further copy).
- Put any work files on `/mnt/photos`.
- Restart Picapport outside an agreed step.

## Links

`scripts/picapport-db.sh`; `docs/picapport-db.md` (facts, case history); README "Picapport Database Fix"; backlog B04, Q4, Q11.

## Last verified

Draft, 2026-11-15: `status` and `snapshot` tested on the PC with stubs (dry run, real run, Java still running after stop, Picapport failing to start, HDD path guard). Not yet run on the Pi.
