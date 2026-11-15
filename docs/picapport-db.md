# Picapport's database: facts and case history

Reference for the `picapport-db` skill and `scripts/picapport-db.sh`. Facts here are verified unless marked otherwise; open questions are in `docs/backlog.md` (B04, Q4, Q11).

## What it is

| Fact | Value | Source |
|---|---|---|
| Engine | OrientDB 3.0.39 (embedded in Picapport 10.4.0) | `db/dbconfig.txt` header, folder name |
| Location | `/opt/picapport/.picapport/db/db_3_0_39/` (about 120 files, 696 MB on 2026-11-15), plus `db/dbconfig.txt` | `ls` on the Pi |
| What it holds | An index of the photos: records for directories and photos, plus indexes over them (file names `idx<name>_<n>.cbt/.nbt/.mbt`, Lucene indexes in `luceneIndexes/`) | file names |
| Disposable? | In principle yes: everything lasting is in the photos' metadata (principle 11, Q8). In practice a full re-index of a large library is too slow to be the fix; **repair first** (owner, 2026-11-15) | |
| Not in it | Users (`.picapport/users/`), saved queries (`queries/`), `picapport.properties`. A repair replaces only `db/` | |
| Clean-close flag | `db_3_0_39/dirty.fl`, first byte 1 = not closed cleanly | file content; meaning inferred from the name, unverified |
| Tools | OrientDB 3.0.39 community tarball in the repo (`orientdb/`); Java 17 at `/opt/java` | |
| Shutdown flush | OrientDB setting `storage.diskCache.writeCacheShutdownTimeout = 30` (seconds), the same as systemd's `TimeoutStopSec=30` for `picapport-wrapper`, after which systemd kills it. Possible cause of damage on stop (Q11, unverified) | `dbconfig.txt`, unit file |
| Work area | Snapshots and repair copies in `/home/pi/picapport-db-work/` (SD card, never the HDD) | `scripts/picapport-db.sh` |

## Symptoms seen so far

| Symptom | Where | Meaning (as far as known) |
|---|---|---|
| `OPageIsBrokenException: Following files and pages are detected to be broken [...]`, "storage is switched to 'read only' mode" | Picapport log | A page of a database file failed its check. The database goes read-only: nothing new is indexed. The list names the damaged files and pages |
| `OLockException: No more resources available in pool (max=100)`, once a minute for hours | Picapport log | Follows the broken-page errors on each crawler run; probably a consequence, unverified |
| New photos never appear | slideshow, search | Database read-only since the damage |
| Slideshow white, or "Network Error" dialog | screen | A JSON request from the slideshow page failed (B03); link to the damage is a hypothesis |

## Case history

| Date | Symptoms | Diagnosis | Treatment | Outcome |
|---|---|---|---|---|
| before 2026 (owner's memory, details not recorded) | Picapport errors, slideshow broken | `OPageIsBrokenException` naming `idxfileName.cbt`, `idxphotoId.cbt`, `photo.pcl`, `directory.pcl`, `photo.cpm` (README) | OrientDB export/import tried; owner recalls it did not work. Then: deleted the database, full re-index | Worked, but slow; not acceptable as the standard fix |
| 2026-11-15 (open, B04) | White slideshow about 65 s after each launch; "Network Error"; honeymoon photos missing | Database files last written 2025-10-22. Every broken-page report in the last four logs (1,804) names only `idxfileName.cbt` page 121, an index, not photo records | In progress: snapshot, then repair attempts on copies (rebuild that index; export/import) | |
