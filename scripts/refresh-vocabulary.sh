#!/bin/bash
# refresh-vocabulary.sh - rebuild the slideshow vocabulary from the photos (backlog B29).
# Runs on the Pi as user pi, nightly from cron (scripts/install-vocabulary-cron.sh). READ-ONLY on
# the photo HDD: metadata-survey.sh and photo-drive-check.py only read it; output goes to the SD
# card. It holds a lock, so scripts/photo-metadata.py changes no photo while it runs.
#
#   refresh-vocabulary.sh               full scan (~40 min at lowest priority), then build
#   refresh-vocabulary.sh --build-only  build from the last scan (seconds)
#
# Output: /var/lib/photo-api/vocabulary.json, served by GET /api/vocabulary, and the photo catalogue
# /var/lib/photo-api/catalogue.json for the slideshow layer (B32; the photo API reloads it when it
# changes). Place names need the offline place list (scripts/fetch-places.sh, downloaded here once
# if missing; without it there are no places and the rest still works).
# Last run's log: ~/metadata-survey/refresh.log
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SURVEY_DIR="${SURVEY_DIR:-$HOME/metadata-survey}"
SURVEY="$SURVEY_DIR/survey.tsv"
OUT="${VOCABULARY_OUT:-/var/lib/photo-api/vocabulary.json}"
CATALOGUE="${CATALOGUE_OUT:-$(dirname "$OUT")/catalogue.json}"
mkdir -p "$SURVEY_DIR"
exec 9>"$SURVEY_DIR/.refresh.lock"
flock -n 9 || { echo "another refresh is running"; exit 0; }
{
  echo "refresh started $(date '+%F %T')"
  if [ "${1:-}" != "--build-only" ]; then
    bash "$REPO_ROOT/scripts/metadata-survey.sh" scan /mnt/photos/PHOTOS "$SURVEY.new"
    mv "$SURVEY.new" "$SURVEY"
  fi
  [ -s "$SURVEY" ] || { echo "no survey at $SURVEY"; exit 1; }
  PLACES_DIR="$SURVEY_DIR/places" bash "$REPO_ROOT/scripts/fetch-places.sh" || echo "places: not available (no internet?); building without place names"
  python3 "$REPO_ROOT/scripts/build-vocabulary.py" "$SURVEY" "$OUT" --catalogue "$CATALOGUE" --places "$SURVEY_DIR/places"
  # Saving ratings into photos needs a recent pass of this read-only drive check.
  if sudo -n nice -n 19 ionice -c3 python3 "$REPO_ROOT/scripts/photo-drive-check.py" --out "$(dirname "$OUT")/drive-check.json" >/dev/null; then
    echo "drive check: passed"
  else
    echo "drive check: DID NOT PASS (photos will not be changed; see $(dirname "$OUT")/drive-check.json)"
  fi
  echo "refresh finished $(date '+%F %T')"
} > "$SURVEY_DIR/refresh.log" 2>&1
tail -3 "$SURVEY_DIR/refresh.log"
