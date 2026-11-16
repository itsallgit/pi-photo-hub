# Image metadata and what the index can find

Layer 1 of slideshow control (principle 12): what information the photos carry, and what Picapport (the index today) can find and play from it. Long-lasting information lives **embedded in the image files**, plus the folder structure and naming; no sidecar files, and Picapport's database is never the source of truth (principle 11).

Everything here is established by testing on the Pi. A row that says "untested" is not known; do not rely on it. Public Picapport documentation is thin (checked 2026-11-16), so trial is the method.

## How to test (read-only)

- **Count what a query matches** without touching the screen: on the Pi, `curl -s -G http://localhost:8080/picapport_json --data-urlencode cmd=RunQuery --data-urlencode "query=<q>" --data-urlencode sort=random` returns `status` and `numPhotos`. Details in [architecture.md](architecture.md), "Picapport queries".
- **Read what a photo carries** with `exiftool` (read-only use only; never `-overwrite_original` or any write option against `/mnt/photos`, hard rule 1).

## Capability map

| Information | Where it lives in the file / on disk | Present in the library? | Indexed by Picapport? | How to query | Tested |
|---|---|---|---|---|---|
| Folder words | Folder path under `/mnt/photos/PHOTOS` | Yes: 68 top-level folders named by year or `YYYY.MM[.DD] - Event` | Yes | Plain words, ANDed; `OR`; `-word` | 2026-11-16 |
| Date taken | EXIF `DateTimeOriginal` | untested | untested | untested | |
| GPS position | EXIF GPS | untested | untested (the UI has a map filter) | untested | |
| Keywords | IPTC `Keywords`, XMP `dc:subject` | untested | untested (owner recalls a tag set with IrfanView worked) | untested | |
| Comments | EXIF `UserComment`, `ImageDescription`, Windows `XPComment`/`XPKeywords` | untested | untested | untested | |
| Title / caption | IPTC `ObjectName`, `Caption-Abstract`; XMP `dc:title`, `dc:description` | untested | untested | untested | |
| Rating | XMP `xmp:Rating`, Windows `Rating` | untested | untested | untested | |
| People | XMP region names (MWG, Microsoft, Apple), `PersonInImage` | untested | untested | untested | |
| Hierarchical tags | XMP `lr:hierarchicalSubject`, digiKam `TagsList` | untested | untested | untested | |
| Camera / device | EXIF `Make`, `Model` | untested | untested | untested | |
| File type | Extension (`jpg`, `heic`, `png`, `mp4`, `mov`, ...) | Yes | untested which types are indexed | untested | |

## Query syntax

What is known is in [architecture.md](architecture.md), "Picapport queries". Findings from Phase 1 are added here.

## Tagging and naming standard

Draft to come from the findings above, for the owner to review. It will say which fields to write and how to name folders so that photos are findable now and after any change of index.
