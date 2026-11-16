#!/bin/bash
# refresh-vocabulary.sh - rebuild the slideshow vocabulary from the photos (backlog B29).
# Runs on the Pi as user pi, nightly from cron (scripts/install-vocabulary-cron.sh). READ-ONLY on
# the photo HDD: metadata-survey.sh only reads it; output goes to the SD card.
#
#   refresh-vocabulary.sh               full scan (~40 min at lowest priority), then build
#   refresh-vocabulary.sh --build-only  build from the last scan (seconds)
#
# Output: /var/lib/photo-api/vocabulary.json, served by GET /api/vocabulary.
# Last run's log: ~/metadata-survey/refresh.log
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SURVEY_DIR="${SURVEY_DIR:-$HOME/metadata-survey}"
SURVEY="$SURVEY_DIR/survey.tsv"
OUT="${VOCABULARY_OUT:-/var/lib/photo-api/vocabulary.json}"
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
  python3 "$REPO_ROOT/scripts/build-vocabulary.py" "$SURVEY" "$OUT"
  echo "refresh finished $(date '+%F %T')"
} > "$SURVEY_DIR/refresh.log" 2>&1
tail -2 "$SURVEY_DIR/refresh.log"
