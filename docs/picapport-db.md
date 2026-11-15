# Picapport's database: facts and case history

Reference for the `picapport-db` skill and `scripts/picapport-db.sh`. Facts here are verified unless marked otherwise; open questions are in `docs/backlog.md` (B04, Q4, Q11).

## What it is

| Fact | Value | Source |
|---|---|---|
| Engine | OrientDB 3.0.39 (embedded in Picapport 10.4.0) | `db/dbconfig.txt` header, folder name |
| Location | `/opt/picapport/.picapport/db/db_3_0_39/` (276 files, 696 MB on 2026-11-15), plus `db/dbconfig.txt` | `ls` on the Pi |
| What it holds | An index of the photos: records for directories and photos, plus indexes over them (file names `idx<name>_<n>.cbt/.nbt/.mbt`, Lucene indexes in `luceneIndexes/`) | file names |
| Disposable? | In principle yes: everything lasting is in the photos' metadata (principle 11, Q8). In practice a full re-index of a large library is too slow to be the fix; **repair first** (owner, 2026-11-15) | |
| Not in it | Users (`.picapport/users/`), saved queries (`queries/`), `picapport.properties`. A repair replaces only `db/` | |
| Clean-close flag | `db_3_0_39/dirty.fl`, first byte 1 = not closed cleanly | file content; meaning inferred from the name, unverified |
| Tools | OrientDB 3.0.39 community tarball in the repo (`orientdb/`), unpacked into the work area; Java 17 at `/opt/java` (`JAVA_HOME=/opt/java`, `ORIENTDB_OPTS_MEMORY=-Xmx512m` is enough while Picapport runs). All OrientDB work runs on the Pi, on copies (owner, 2026-11-15) | verified 2026-11-15 |
| Console login | `admin` / `admin` opens the database with `CONNECT plocal:<path>/db_3_0_39 admin admin` | verified 2026-11-15 |
| Contents (2026-11-15 snapshot) | Photo 51,897 records, Directory 204, KeywordTreeElement 85, OUser 3, ORole 3, PicApportMeta 1, Usertags 0. 23 indexes, e.g. `idxfileName` (UNIQUE on `Photo.fileName`), `idxfingerprint`, `idxtextSearch` (FULLTEXT), `idxlocation` (SPATIAL) | `LIST CLASSES`, `LIST INDEXES` |
| Useful console commands | `CHECK DATABASE -v` (names each damaged file and page; about 20 s), `REBUILD INDEX <name>`, `EXPORT DATABASE <file>` (writes `<file>.json.gz`, skips unreachable records), `IMPORT DATABASE <file>.json.gz -preserveClusterIDs=true` into a new database made with `CREATE DATABASE plocal:<path> admin admin plocal`. The console prints a harmless `IllegalFormatConversionException` after `REBUILD INDEX` | verified 2026-11-15 |
| Shutdown flush | OrientDB setting `storage.diskCache.writeCacheShutdownTimeout = 30` (seconds), the same as systemd's `TimeoutStopSec=30` for `picapport-wrapper` | `dbconfig.txt`, unit file |
| **Picapport is killed on every stop** | Observed 2026-11-15 13:33 (snapshot): Picapport logged "shutdown initiated" at once, but had not exited after 30 s. systemd then terminated the init script's stop, and at 60 s killed the Java process with SIGKILL, including its `CcShutdownHook` thread (its shutdown code, still running). A reboot or `systemctl stop` goes the same way, so the database is very likely never closed cleanly (`dirty.fl` = 1). Strong suspect for the repeated damage (Q11); fix the stop path before swapping a repaired database in | `picapport-db.sh snapshot` output, journal |
| Work area | Snapshots and repair copies in `/home/pi/picapport-db-work/` (SD card, never the HDD) | `scripts/picapport-db.sh` |
| Memory budget | Pi 4 with 3.8 GB RAM, little swap. Running: Picapport Java about 1.4 GB, Chromium about 1.1 GB, about 1.5 GB available. `CHECK DATABASE`, `REBUILD INDEX`, `EXPORT DATABASE` with `-Xmx512m` ran fine alongside them; `IMPORT DATABASE` with `-Xmx768m` did not (Pi unresponsive, 2026-11-15 14:28) | observed |

## Symptoms seen so far

| Symptom | Where | Meaning (as far as known) |
|---|---|---|
| `OPageIsBrokenException: Following files and pages are detected to be broken [...]`, "storage is switched to 'read only' mode" | Picapport log | A page of a database file failed its check. The database goes read-only: nothing new is indexed. The list names the damaged files and pages |
| `OLockException: No more resources available in pool (max=100)`, once a minute for hours | Picapport log | Follows the broken-page errors on each crawler run; probably a consequence, unverified |
| New photos never appear | slideshow, search | Database read-only since the damage |
| Slideshow white, or "Network Error" dialog | screen | A JSON request from the slideshow page failed (B03). It plays right after a fresh Picapport start (seen 13:35 on 2026-11-15) and fails later, after the crawler has hit the broken index; the link is a strong hypothesis, not proven |

## Case history

| Date | Symptoms | Diagnosis | Treatment | Outcome |
|---|---|---|---|---|
| before 2026 (owner's memory, details not recorded) | Picapport errors, slideshow broken | `OPageIsBrokenException` naming `idxfileName.cbt`, `idxphotoId.cbt`, `photo.pcl`, `directory.pcl`, `photo.cpm` (README) | OrientDB export/import tried; owner recalls it did not work. Then: deleted the database, full re-index | Worked, but slow; not acceptable as the standard fix |
| 2026-11-15 (open, B04) | White slideshow about 65 s after each slideshow launch (Picapport running for hours); "Network Error"; honeymoon photos missing. Slideshow played normally right after a fresh Picapport start | Database data and index files last written 2025-10-22. Every broken-page report in the last four logs (1,804; 451 since the 08:07 boot) names only `idxfileName.cbt` page 121, an index, not photo records; also `OCommandExecutionException` on `select from index:idxfileName`. Picapport is SIGKILLed on stop (see above). **`CHECK DATABASE -v` on a copy: 3 damaged pages**: `idxfileName.cbt` pages 120 and 121 (index) and `photo.cpm` page 11 (the photo cluster's position map; the log never named this one) | 13:33 snapshot `/home/pi/picapport-db-work/snapshot-20261115-133259` (276 files, 696 MB; stop 61 s, killed). On `copy-1`: `REBUILD INDEX idxfileName` (25 s) cleared both index pages; the index now holds 49,766 of 51,897 photos, so **about 2,131 photo records (and 5 of 204 directories) sit behind the broken map page and cannot be reached**. `EXPORT DATABASE` (4 min, 429 MB gz): 50,060 of 52,196 records, 0 reported broken, i.e. everything reachable. Import into a fresh database (`-Xmx768m`, Picapport running) started 14:28 and made the Pi stop answering SSH, the API and Picapport (ping still worked); stopped from the PC at about 14:35; still unresponsive at 14:57; the import has its own 5,000 s time limit (about 15:51). Lesson recorded in the skill: imports only with Picapport stopped | |
