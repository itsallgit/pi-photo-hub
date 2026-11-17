#!/bin/bash
# fetch-places.sh - download the offline place list for place names from GPS (slideshow layer, R11).
# Runs on the Pi as user pi. Nothing about the photos is sent anywhere: it only downloads two public
# files from GeoNames (https://www.geonames.org, CC BY 4.0; credited in the README).
#
#   fetch-places.sh            download if missing (refresh-vocabulary.sh calls this every night)
#   fetch-places.sh --refresh  download again (GeoNames updates the files daily; a new copy is
#                              only swapped in after it passes the checks)
#
# Into ~/metadata-survey/places/ (PLACES_DIR): cities1000.txt (every place with 1,000 people or more,
# about 150,000 rows, about 30 MB), countryInfo.txt (country names), SOURCE.txt (when, from where,
# sha256). GeoNames regenerates these files every day, so a checksum cannot be pinned in the repo;
# instead the download is checked for its shape (column count, row count within bounds, known
# places present) before it replaces the previous copy, and its sha256 is recorded in SOURCE.txt.
set -euo pipefail
DIR="${PLACES_DIR:-$HOME/metadata-survey/places}"
BASE="${GEONAMES_BASE:-https://download.geonames.org/export/dump}"
REFRESH=0
case "${1:-}" in
  --refresh) REFRESH=1 ;;
  "") ;;
  -h|--help) sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
  *) echo "unknown option: $1" >&2; exit 2 ;;
esac
case "$(realpath -m "$DIR")" in /mnt/photos*) echo "refusing to write under /mnt/photos" >&2; exit 1 ;; esac
if [ "$REFRESH" = 0 ] && [ -s "$DIR/cities1000.txt" ] && [ -s "$DIR/countryInfo.txt" ]; then
  echo "places: present ($DIR, $(wc -l < "$DIR/cities1000.txt") places)"
  exit 0
fi
mkdir -p "$DIR"
tmp="$(mktemp -d "$DIR/.fetch-XXXXXX")"
trap 'rm -rf "$tmp"' EXIT
echo "places: downloading cities1000.zip and countryInfo.txt from $BASE"
curl -fsS --retry 3 -m 600 -o "$tmp/cities1000.zip" "$BASE/cities1000.zip"
curl -fsS --retry 3 -m 120 -o "$tmp/countryInfo.txt" "$BASE/countryInfo.txt"
python3 - "$tmp" <<'PY'
import os, sys, zipfile
d = sys.argv[1]
with zipfile.ZipFile(os.path.join(d, "cities1000.zip")) as z:
    if z.namelist() != ["cities1000.txt"]:
        sys.exit(f"unexpected zip content: {z.namelist()}")
    z.extract("cities1000.txt", d)
rows = bad = 0
names = set()
with open(os.path.join(d, "cities1000.txt"), encoding="utf-8") as fh:
    for line in fh:
        c = line.rstrip("\n").split("\t")
        rows += 1
        if len(c) != 19:
            bad += 1
        elif c[1] in ("Sydney", "Barcelona", "La Spezia"):
            names.add(c[1])
if not 100000 <= rows <= 400000 or bad > rows // 1000 or len(names) < 3:
    sys.exit(f"cities1000.txt does not look right: {rows} rows, {bad} malformed, known places {sorted(names)}")
countries = [l for l in open(os.path.join(d, "countryInfo.txt"), encoding="utf-8") if l[:1] != "#" and l.count("\t") > 10]
if not 200 <= len(countries) <= 300:
    sys.exit(f"countryInfo.txt does not look right: {len(countries)} countries")
print(f"places: checked: {rows} places, {len(countries)} countries")
PY
sum="$(sha256sum "$tmp/cities1000.zip" | cut -d' ' -f1)"
mv -f "$tmp/cities1000.txt" "$DIR/cities1000.txt"
mv -f "$tmp/countryInfo.txt" "$DIR/countryInfo.txt"
printf 'downloaded %s\nfrom %s/cities1000.zip and countryInfo.txt\ncities1000.zip sha256 %s\nlicence: GeoNames, CC BY 4.0, https://www.geonames.org\n' \
  "$(date '+%F %T')" "$BASE" "$sum" > "$DIR/SOURCE.txt"
echo "places: installed in $DIR (cities1000.zip sha256 $sum)"
