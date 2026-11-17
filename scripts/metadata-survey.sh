#!/bin/bash
# metadata-survey.sh - READ-ONLY survey of the metadata the photos carry (backlog B24).
# Runs on the Pi. exiftool only reads; the output goes to the SD card, never the photo HDD.
#
#   metadata-survey.sh scan [DIR] [OUT]   one line per image (tab-separated); default
#                                         DIR=/mnt/photos/PHOTOS OUT=~/metadata-survey/survey.tsv
#                                         About 40 minutes for ~64,000 photos at lowest priority.
#   metadata-survey.sh summary [OUT]      per field: how many files have it, and the top values
#
# Hard rule 1: never add a write option (-overwrite_original, -TAG=, -tagsFromFile, ...) here.
set -euo pipefail
TAGS=(-Directory -FileName -FileType -EXIF:DateTimeOriginal -GPSLatitude -Make -Model -Software
  -XPKeywords -XPTitle -XPComment -XPSubject -IPTC:Keywords -IPTC:Caption-Abstract -IPTC:ObjectName
  -XMP-dc:Subject -XMP-dc:Title -XMP-dc:Description -XMP:Rating -XMP-microsoft:LastKeywordXMP
  -XMP-iptcExt:PersonInImage -XMP-MP:RegionPersonDisplayName -XMP-mwg-rs:RegionName
  -XMP-lr:HierarchicalSubject -XMP-digiKam:TagsList -EXIF:UserComment -EXIF:ImageDescription
  -EXIF:Orientation# -File:ImageWidth -File:ImageHeight -Composite:GPSLatitude# -Composite:GPSLongitude#)
NAMES=(Directory FileName FileType DateTimeOriginal GPSLatitude Make Model Software XPKeywords XPTitle
  XPComment XPSubject IPTC:Keywords IPTC:Caption IPTC:ObjectName XMP-dc:Subject XMP-dc:Title
  XMP-dc:Description XMP:Rating MS:LastKeywordXMP PersonInImage MP:RegionPersonDisplayName
  MWG:RegionName lr:HierarchicalSubject digiKam:TagsList EXIF:UserComment EXIF:ImageDescription
  Orientation ImageWidth ImageHeight GPSLat GPSLon)
# Columns 28 to 32 (added 2026-11-18 for the slideshow layer, B32): the rotate tag as a number
# (1 normal, 6 and 8 turned a quarter, 3 upside down), the stored pixel size, and GPS as signed
# decimal degrees. Older surveys have 27 columns; build-vocabulary.py reads both.
DEFAULT_OUT="$HOME/metadata-survey/survey.tsv"

case "${1:-}" in
  scan)
    dir="${2:-/mnt/photos/PHOTOS}"; out="${3:-$DEFAULT_OUT}"
    command -v exiftool >/dev/null || { echo "exiftool missing (config/packages.txt, update.sh)" >&2; exit 1; }
    case "$(realpath -m "$out")" in /mnt/photos*) echo "refusing to write under /mnt/photos" >&2; exit 1;; esac
    mkdir -p "$(dirname "$out")"
    nice -n 19 ionice -c3 exiftool -r -fast2 -q -q -T -f -charset filename=utf8 \
      -ext jpg -ext jpeg -ext heic -ext png "${TAGS[@]}" "$dir" > "$out" && rc=0 || rc=$?
    # exiftool exits 1 when any file cannot be read but still lists every file (seen 2026-11-17:
    # the first nightly run stopped here). Only an empty result or another code is a failure.
    if [ "$rc" -gt 1 ] || [ ! -s "$out" ]; then echo "exiftool failed (exit $rc), no usable output" >&2; exit 1; fi
    if [ "$rc" = 1 ]; then echo "note: exiftool could not read some files (exit 1); they are listed with empty fields"; fi
    echo "wrote $(wc -l < "$out") lines to $out"
    ;;
  summary)
    f="${2:-$DEFAULT_OUT}"
    echo "files: $(wc -l < "$f")"
    for c in $(seq 4 ${#NAMES[@]}); do
      n=$(awk -F'\t' -v c="$c" '$c!="-" && $c!=""' "$f" | wc -l)
      [ "$n" -eq 0 ] && continue
      printf '%-28s %6s   ' "${NAMES[$((c-1))]}" "$n"
      if [ "$c" -ge 9 ] && [ "$c" -le 27 ] || [ "$c" = 28 ]; then
        awk -F'\t' -v c="$c" '$c!="-" && $c!=""{print $c}' "$f" | tr ',;' '\n\n' | sed 's/^ *//' \
          | sort | uniq -c | sort -rn | head -8 | awk '{c=$1;$1="";printf "%s(%s) ",substr($0,2),c}'
      fi
      echo
    done
    ;;
  *) sed -n '2,10p' "$0"; exit 2 ;;
esac
