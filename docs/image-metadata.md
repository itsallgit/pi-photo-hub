# Image metadata and what the index can find

Layer 1 of slideshow control (principle 12): what information the photos carry, and what Picapport (the index today, 10.4.0) can find and play from it. Long-lasting information lives **embedded in the image files**, plus the folder structure and naming; no sidecar files, and Picapport's database is never the source of truth (principle 11).

Everything here is established by testing on the Pi unless marked otherwise. "untested" means not known; do not rely on it.

## Sources

- **Tests on the Pi** (read-only), 2026-11-16. Method below.
- **Picapport's wiki**, which is offline (expired certificate, then an error page, 2026-11-16). Archived copies: [Full text search: supported metadata (2016)](http://web.archive.org/web/20160720014754/http://wiki.picapport.de:80/display/PICE/Full+text+search+of+photos+-+Supported+metadata), [Find photos with PicApport (2019)](http://web.archive.org/web/20191021080218/http://wiki.picapport.de/display/PICE/Find+photos+with+PicApport), [Web API runQuery (2019)](http://web.archive.org/web/20190825115619/http://wiki.picapport.de/display/PICE/runQuery). They describe older versions; the field list below is from the 2016 page and is confirmed here only where a test says so. The built-in help (`/nls/help.html`) only says "type words" and links to that wiki.

## How to test (read-only)

On the Pi, against Picapport on `localhost:8080` (no login needed today):

- **Count a query**, no effect on the screen: `curl -s -G http://localhost:8080/picapport_json --data-urlencode cmd=RunQuery --data-urlencode "query=<q>" --data-urlencode sort=random` gives `status` (`OK`/`NORESULT`), `numPhotos` and a `vid` (view id).
- **See exactly what Picapport indexed for a photo**: with the same cookie jar (`curl -c jar -b jar`), `cmd=GetMetaData&vid=<vid>&index=<n>` returns `fileName`, `creationDate`, `rating`, `make`, `model`, `software`, `latitude`/`longitude`, `myTags`, and **`textSearch`: the list of words the query engine matches**. This is the ground truth for "is field X indexed".
- **Read what a file carries**: `exiftool` (installed from `config/packages.txt`). Read options only; never a write option against `/mnt/photos` (hard rule 1). For the whole library: `scripts/metadata-survey.sh scan` then `summary` (README, "Photo Metadata Survey"). The last full survey (2026-11-16, 40 minutes, 64,419 image files under `PHOTOS/`) is in `~/metadata-survey/survey.tsv` on the Pi (scratch data on the SD card; re-create it with the script).
- **Find which photos have a kind of data**: `-$nokeyword`, `-$noperson`, `-$notitle`, `-$nodesc` as queries, then walk the result with `GetMetaData`.

## What gets indexed

- **Only JPEGs.** `$jpg` matches all 63,737 indexed items. The survey of `PHOTOS/` found 63,307 JPEGs, 77 HEIC and 746 PNG; Picapport crawls all of `/mnt/photos`, so the extra JPEGs are presumably in other top-level folders (`INSTA360`, `VIDEOS`, ...; not checked). HEIC, PNG and videos (about 1,500 `.mp4`/`.mov`/`.mts`) are not in the index, so they never play.
- **Words of 3 or more characters**, lower-cased; punctuation and path separators split words. So `hk` (from "HK Boat Party") and the `09` in `2024.09` are dropped.

## Capability map

| Information | Where it lives | In the library? | Indexed? | Query | Tested |
|---|---|---|---|---|---|
| Folder and file name words | Path under `/mnt/photos/PHOTOS` (every folder level, including subfolders) | Yes: 68 top-level folders, `YYYY`, `YYYY.MM[.DD] - Event`, `_Friends`/`_Parents`/`_Work`, with event subfolders (for example `2016 - Europe/2016.02 - Croatia - Dubrovnik`) | Yes | plain word | 2026-11-16 |
| Year taken | EXIF `DateTimeOriginal` (wiki: also XMP `CreateDate`; file date as last resort) | Yes | Yes | `2024` | 2026-11-16 |
| Month taken | as above | Yes | Yes | `sep`, `oct` (three letters; `january` does not work) | 2026-11-16 |
| Day taken | as above | Yes | Yes | `sep18` | 2026-11-16 |
| Camera make / model | EXIF `Make`, `Model` | Yes (Samsung, Apple, Canon, GoPro, ...) | Yes | `samsung`, `iphone`, `s23` | 2026-11-16 |
| Software | EXIF `Software`, XMP `CreatorTool` | Yes | Yes | `photoshop`, `lightroom`, `snapseed` | 2026-11-16 |
| Orientation | Image size | Yes | Yes | `$landscape`, `$portrait` | 2026-11-16 |
| GPS position | EXIF GPS | 43,139 of 64,419 image files (67%) | Stored (`latitude`/`longitude` in `GetMetaData`); used by the web UI's map filter; no query word found (`$gps` gives 0) | not by text; map rectangle untested | 2026-11-16 |
| Keywords | XMP `dc:subject` (8,379 files), usually with Windows `XPKeywords` (4,891): what Windows Explorer's "Tags" box writes. IPTC `Keywords` on 364 files, always together with the others. **`dc:subject` alone is proven indexed** (a file with only `dc:subject` "Work, <name>" is found by `work`) | 8,643 indexed photos (`$nokeyword` matches 55,094). Mostly first names of family and friends (the two most used on about 3,300 and 2,400 photos), plus topics such as Work (674), Uni (580), Cooking (297), Plants, Digitised, and `LB` (1,941). The live list comes from the survey on the Pi, not from this public page | Yes (each word of a keyword separately) | a keyword word, e.g. `cooking`; `-$nokeyword` = has any keyword. **Keywords under 3 letters are never found: `LB` (1,941 photos) gives 0** | 2026-11-16 |
| Keywords in Windows or IPTC fields only | Windows `XPKeywords`, IPTC `Keywords` | No file has either without XMP `dc:subject` | not known (the wiki's 2016 list includes `XPKeywords`, not IPTC) | | open: needs a test photo |
| People | Face regions (XMP `mwg-rs:RegionName`, Microsoft `RegionPersonDisplayName`) and `Iptc4xmpExt:PersonInImage`, 383 files, all in `PHOTOS/2025/...`; these also repeat the names as keywords (XMP, Windows, IPTC) | 672 indexed photos have a person (`$noperson` 63,065), the rest mostly one 2014 subfolder of photos from a friend's camera | Yes | a first name; `-$noperson` = has a person. A name query also matches the same word in folders and keywords | 2026-11-16 |
| Title | wiki: Windows `XPTitle`, XMP `dc:title`; the survey found none in those fields, so the 289 come from another source (mostly that same 2014 subfolder) | 289 indexed photos (`$notitle` 63,448) | Yes | `-$notitle` | partly |
| Description | XMP `dc:description` (44 files), EXIF `ImageDescription` (863, mostly camera text such as "OLYMPUS DIGITAL CAMERA") | 333 indexed photos (`$nodesc` 63,404) | Yes | `-$nodesc` | partly |
| Rating | XMP `xmp:Rating`: 58 files (57 with 5 stars) | Few | Stored (`rating` in `GetMetaData`) | no query syntax found (`rating:5`, `stars:5` give 0) | open |
| Picapport "MyTags", likes | Picapport's database only | | | Not to be used: not in the photo (principle 11) | n/a |

## Query syntax (tested 2026-11-16)

| Form | Meaning | Example |
|---|---|---|
| `a b` or `a AND b` | both | `noosa 2022` = 863 |
| `a OR b` (any case) | either | `noosa OR croatia` = 4,400 |
| `-a` or `NOT a` | exclude | `noosa -2022` = 1,053 |
| `2020-2021` | year range (equals `2020 OR 2021`) | 6,068 |
| `(a OR b) c` | OR is applied before AND; brackets are accepted and do not change this | `noosa OR croatia 2023` = 1,267 = (1,139 + 128) |
| `~word` | fuzzy | `~wedding` |
| `~~word` | sounds-like (phonetic) | `~~noosa` = 2,207 (vs 1,916) |
| `@ll` | everything | 63,737 |
| `$token` | special tokens: `$jpg`, `$landscape`, `$portrait`, `$square`, `$nokeyword`, `$noperson`, `$notitle`, `$nodesc`, `$nodate`, `$nothumb` (seen in `textSearch`; the positive forms such as `$keyword` give 0, so use `-$nokeyword`) | `$portrait` = 1,183 |
| `"a b"` | **not** a phrase; gives 0 | avoid |
| `word*` | **server error (HTTP 500)** | never send |
| `field:value` (`year:`, `rating:`) | not supported (0) | avoid |

The words a query matches can come from any source at once: `croatia` matches 2,484 photos from the 2023 trip and the 2016 Europe trip's subfolders. Results are not limited to one folder unless the query is specific.

## Tagging and naming standard

**Draft for the owner to review (2026-11-16); not yet agreed.** Based only on what is proven above.

1. **Folders carry the event.** `PHOTOS/YYYY.MM[.DD][ - YYYY.MM[.DD]] - Event Name`, with subfolders for parts of a trip (`2016 - Europe/2016.02 - Croatia - Dubrovnik`). Every word of 3+ letters in the path is searchable. Dates in folder names are not searchable as dates (`2024.09` is dropped); the photo's own date is (`2024 sep`).
2. **The date is the photo's EXIF `DateTimeOriginal`.** It gives year, month and day words. Scans and screenshots without it fall back to the file date (`$nodate` marks some of these).
3. **Tags are XMP `dc:subject`** (proven), which Windows Explorer's "Tags" box writes together with `XPKeywords`. Not IPTC alone (unproven).
4. **People are face regions plus `PersonInImage`**, as in the 2025 folders (proven); a name query also matches the same word anywhere else.
5. **Every tag and name has 3 or more letters** and is not a common word you would also use in folder names, unless you mean it to match both. `LB` must be renamed to be findable (for example `Lbee` or the full word; owner to choose).
6. **JPEG for anything that should play.** HEIC and PNG are not indexed today. Whether to convert copies, or accept that they are not shown, is the owner's decision; this project never writes to the HDD itself (hard rule 1).
7. **No sidecars, nothing only in Picapport** (principle 11): no Picapport "MyTags", likes or ratings set in its web UI.

Open before agreeing: whether Windows-only or IPTC-only keywords are indexed, how to query by rating and by GPS area (a test photo set on the SD card would settle the first; backlog B24).
