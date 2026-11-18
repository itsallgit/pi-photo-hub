---
name: photo-metadata
description: Use when a photo's own metadata has to change or be checked ("star this", "why was that not saved?", "is the drive safe to write?", "there are leftover files", "add tags to photos"), when switching saving on, after a power cut during a save, or when extending what may be written. Covers the one writer, the drive check, recovery and how to add a field. Changes photo files only through scripts/photo-metadata.py.
---

# Changing a photo's metadata

Lasting information about a photo lives **inside the photo** (principle 11). `scripts/photo-metadata.py` is the only thing allowed to change a photo file (hard rule 1). Today it can set one field: the XMP rating, **5 favourite, 1 skipped, 0 neither**. People use it through the photo API (hold KEY1 or KEY3, the phone's ★ and ⊘, `POST /api/photo/rating`). Field facts: `docs/image-metadata.md`, "Ratings". Design: `docs/architecture.md`, "Photo metadata".

## Check (read-only)

```
python3 ~/pi-photo-hub/scripts/photo-metadata.py status
python3 ~/pi-photo-hub/scripts/photo-metadata.py read "<photo path>"
python3 ~/pi-photo-hub/scripts/photo-metadata.py strays
python3 -m json.tool /var/lib/photo-api/drive-check.json
```

`status` gives `writable` and, if not, why: `switched-off`, `drive-check` or `no-drive`. A save during the nightly scan answers `busy`; try again after it.

## The drive check

`scripts/photo-drive-check.py` opens the drive read-only and compares the file system's records: valid boot records, every cluster a file uses is marked used, no cluster belongs to two files. It runs after every nightly scan and every `update.sh`, and writes `/var/lib/photo-api/drive-check.json`. Saving needs a pass younger than 72 hours. It is not a repair tool and does not read the photos' contents or test for bad sectors. To run it now:

```
sudo python3 ~/pi-photo-hub/scripts/photo-drive-check.py --out /var/lib/photo-api/drive-check.json --lock ~/metadata-survey/.refresh.lock
```

If it fails, leave saving off and tell the owner what `failedChecks` says. Never run `fsck` or a repair on the drive: repairs are the owner's.

## Switching saving on or off

`writesEnabled` in `config/photo-metadata.json`, changed in the repo and deployed (`apply-changes`). The first real save after enabling work on the writer is one photo the owner has chosen, with `--first-write`, which bypasses only that switch; then `read` it and look at it on screen before enabling.

## Recovery after an interruption

`strays` lists `.NAME.pph-new` (the new version) and `.NAME.pph-old` (the original). Nothing removes them automatically, and a photo with a leftover refuses further changes. **Show the owner the list and agree each step; renaming or deleting these needs their yes.** Check with `exiftool` and by opening the file first.

| What is in the folder | Meaning | Fix |
|---|---|---|
| `NAME` and `.NAME.pph-new` | stopped before the swap; `NAME` is the original | delete `.NAME.pph-new` |
| `.NAME.pph-old` only, or with `.NAME.pph-new` | stopped during the swap | `mv .NAME.pph-old NAME`, then delete `.NAME.pph-new` if present |
| `NAME` and `.NAME.pph-old` | the new version was in place | if `NAME` opens and `read` shows the expected rating, delete `.NAME.pph-old`; otherwise ask the owner |

## Adding a field (tags, for example)

Agree it with the owner first. Add it to `FIELDS` with its exact XMP tag and allowed values, keep every check, add it to `scripts/test/test_photo_metadata.py` and run `scripts/test/photo-metadata-pi.py` on the Pi. Say in `docs/image-metadata.md` whether Picapport and the nightly scan read it. Never write a second tool that edits photos.

## Test

- PC: `bash scripts/check.sh` runs `scripts/test/test_photo_metadata.py`, with a stand-in for exiftool: bad results, crashes at every step, refusals.
- Pi: `python3 ~/pi-photo-hub/scripts/test/photo-metadata-pi.py`: the real exiftool and an exFAT image in memory, simulated power cuts at every step, and the drive check against a damaged copy. It only reads the photo drive.

## Do not

- Change a photo with `exiftool`, a script or anything else directly, or through Picapport's web UI.
- Keep favourites, skips or other lasting facts in a list outside the photos. An index rebuilt from the photos, such as the catalogue, is fine.
- Run the writer's test hooks (`PHOTO_METADATA_TEST_*`) against the photo drive.
- Use it on anything but JPEGs in the library. Pixels, file names and folders are never changed.

## Links

`scripts/photo-metadata.py`, `scripts/photo-drive-check.py`, `config/photo-metadata.json`, `api/lib/ratings.js`, hard rule 1 in `CLAUDE.md`, principles 1 and 11, the `button-board` and `slideshow-control` skills.

## Last verified

2026-11-18: written with the writer. Unit tests on the PC. Results on the Pi: `docs/backlog.md`, B40. Not cold-tested.
