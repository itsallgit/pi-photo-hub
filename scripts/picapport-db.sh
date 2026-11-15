#!/bin/bash
# picapport-db.sh - diagnose and repair Picapport's database (OrientDB) without rebuilding it.
# Run on the Pi as user pi. The picapport-db skill says when and how; docs/picapport-db.md holds
# the facts and the case history.
#
#   picapport-db.sh status               read-only: Picapport state, DB size, dirty flag, recent
#                                        broken-page errors in Picapport's log, work-area contents
#   picapport-db.sh snapshot [--dry-run] stop Picapport, copy the whole db/ folder to a new
#                                        read-only snapshot under the work directory, start
#                                        Picapport and the slideshow again (a few minutes)
#   picapport-db.sh repair [--dry-run] [--no-swap]
#                                        MAINTENANCE WINDOW (Picapport is down throughout):
#                                        stop Picapport, copy the live database, check it, export
#                                        everything reachable, import into a fresh database, check
#                                        that; if it is clean, swap it in (the old one is kept),
#                                        start Picapport (rolls back by itself if it will not
#                                        start) and the slideshow. --no-swap stops after the check
#                                        and starts Picapport on the old database.
#   picapport-db.sh restore <dir> [--dry-run]
#                                        put a kept database back (<dir> contains db_3_0_39, e.g.
#                                        <work>/repair-<time>/live-before); the current one is kept
#
# Work files live in $WORK_DIR (default /home/pi/picapport-db-work, on the SD card). OrientDB
# runs with its disk cache capped (ODB_CACHE_MB), because it keeps that cache outside the Java
# heap; an uncapped import once took 2 GB and froze the Pi (docs/picapport-db.md).
# It never touches the photo HDD (/mnt/photos), never restarts mount-hdd, never reboots.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PICAPPORT_HOME="${PICAPPORT_HOME:-/opt/picapport/.picapport}"
DB_PARENT="$PICAPPORT_HOME/db"
DB_NAME="${DB_NAME:-db_3_0_39}"
WORK_DIR="${WORK_DIR:-/home/pi/picapport-db-work}"
LOG_DIR="${LOG_DIR:-/var/log/pi-photo-hub}"
SYSTEMCTL="${SYSTEMCTL:-systemctl}"
JOURNALCTL="${JOURNALCTL:-journalctl}"
CURL="${CURL:-curl}"
PGREP="${PGREP:-pgrep}"
START_WAIT="${START_WAIT:-180}"
SETTLE_WAIT="${SETTLE_WAIT:-180}"          # after a swap: let the crawler run, then read its log
ODB_TARBALL="${ODB_TARBALL:-$REPO_ROOT/orientdb/orientdb-community-3.0.39.tar.gz}"
CONSOLE="${CONSOLE:-$WORK_DIR/tools/orientdb-community-3.0.39/bin/console.sh}"
ODB_JAVA_HOME="${ODB_JAVA_HOME:-/opt/java}"
ODB_HEAP="${ODB_HEAP:-512m}"
ODB_CACHE_MB="${ODB_CACHE_MB:-256}"
CHECK_TIMEOUT="${CHECK_TIMEOUT:-900}"
EXPORT_TIMEOUT="${EXPORT_TIMEOUT:-1800}"
IMPORT_TIMEOUT="${IMPORT_TIMEOUT:-3600}"
if [ -z "${SUDO+x}" ]; then
  if [ "$(id -u)" -eq 0 ]; then SUDO=""; else SUDO="sudo"; fi
fi

DRY_RUN=0; NO_SWAP=0; ARG=""
STOPPED_BY_US=0; STOP_SECS=""; STOP_KILLED=""
usage() { sed -n '2,/^set -euo/p' "$0" | sed '$d; s/^# \{0,1\}//'; }

log() {
  local m; m="[$(date '+%F %T')] $*"
  echo "$m"
  if [ "$DRY_RUN" != 1 ]; then
    $SUDO mkdir -p "$LOG_DIR" 2>/dev/null || true
    printf '%s\n' "$m" | $SUDO tee -a "$LOG_DIR/picapport-db.log" >/dev/null 2>&1 || true
  fi
}
die() { log "[ERROR] $*"; exit 1; }

java_running() { $PGREP -f picapport-headless.jar >/dev/null 2>&1; }
newest_pp_log() { ls -t "$PICAPPORT_HOME"/logfiles/picapport.* 2>/dev/null | head -1; }
http_code() { $CURL -s -o /dev/null -w '%{http_code}' -m "${2:-5}" "$1" 2>/dev/null || true; }

# Refuse anything that would point at the photo HDD (hard rule 1).
guard_paths() {
  local p
  for p in "$WORK_DIR" "$PICAPPORT_HOME" "$@"; do
    case "$(readlink -m "$p")" in /mnt/photos|/mnt/photos/*) die "path $p is on the photo HDD; refusing" ;; esac
  done
}

need_space_mb() { # need_space_mb <MB>
  local avail
  avail=$(( $(df -Pk "$( [ -d "$WORK_DIR" ] && echo "$WORK_DIR" || dirname "$WORK_DIR")" | awk 'NR==2{print $4}') / 1024 ))
  [ "$avail" -gt "$1" ] || die "not enough free space for $WORK_DIR: need about $1 MB, have $avail MB"
}

# --- Picapport stop/start --------------------------------------------------------------
# Whatever happens after we stopped Picapport, try to bring it (and the slideshow) back.
on_exit() {
  if [ "$STOPPED_BY_US" = 1 ]; then
    log "[WARN] exiting early: starting Picapport again on whatever database is in place"
    $SUDO "$SYSTEMCTL" start picapport-wrapper || true
    $SUDO "$SYSTEMCTL" start picapport-chromium || true
  fi
}
trap on_exit EXIT

stop_picapport() {
  local since t0 t1 j
  since="$(date '+%F %T')"
  log "stopping Picapport (picapport-wrapper; it may take up to 5 minutes to close its database)"
  STOPPED_BY_US=1
  t0=$(date +%s)
  $SUDO "$SYSTEMCTL" stop picapport-wrapper
  t1=$(date +%s); STOP_SECS=$((t1 - t0))
  j="$($JOURNALCTL -u picapport-wrapper --since "$since" --no-pager 2>/dev/null || true)"
  if printf '%s\n' "$j" | grep -qi 'sigkill\|timed out'; then STOP_KILLED=yes; else STOP_KILLED=no; fi
  log "  stop took ${STOP_SECS} s; systemd had to kill it: $STOP_KILLED"
  printf '%s\n' "$j" | grep -Ei 'kill|timed out|stopped|deactivated' | head -6 | sed 's/^/    journal: /' || true
  log "  Picapport log after the stop request:"
  tail -n 4 "$(newest_pp_log)" 2>/dev/null | cut -c1-200 | sed 's/^/    /' || true
  if java_running; then die "Picapport's java process is still running after the stop; not touching its database"; fi
}

start_picapport() { # returns 1 if Picapport does not answer
  local i code=000
  log "starting Picapport"
  $SUDO "$SYSTEMCTL" start picapport-wrapper || { log "[WARN] systemctl start picapport-wrapper failed"; return 1; }
  for ((i = 0; i < START_WAIT; i += 5)); do
    code="$(http_code http://localhost:8080/picapport)"
    [ "$code" = 200 ] && break
    sleep 5
  done
  log "  Picapport HTTP: $code after about ${i}s"
  [ "$code" = 200 ] || return 1
  STOPPED_BY_US=0
  log "relaunching the slideshow (picapport-chromium)"
  $SUDO "$SYSTEMCTL" start picapport-chromium || log "[WARN] slideshow launcher failed (journalctl -u picapport-chromium)"
  return 0
}

# --- OrientDB console --------------------------------------------------------------------
ensure_tools() {
  if [ ! -x "$CONSOLE" ]; then
    [ -f "$ODB_TARBALL" ] || die "OrientDB console not found ($CONSOLE) and no tarball at $ODB_TARBALL"
    log "unpacking the OrientDB tools into $WORK_DIR/tools"
    mkdir -p "$WORK_DIR/tools"
    tar xzf "$ODB_TARBALL" -C "$WORK_DIR/tools"
  fi
}

odb() { # odb <logfile> <timeout seconds> <console commands>; returns the console's exit code
  local rc=0
  JAVA_HOME="$ODB_JAVA_HOME" ORIENTDB_OPTS_MEMORY="-Xmx$ODB_HEAP" \
    JAVA_OPTS="-Dstorage.diskCache.bufferSize=$ODB_CACHE_MB" \
    timeout -k 60 "$2" "$CONSOLE" "$3" > "$1" 2>&1 || rc=$?
  [ "$rc" = 124 ] && log "  [WARN] OrientDB console hit its ${2}s time limit"
  return "$rc"
}

# check_db <db path> <logfile>: sets CHECK_ERRORS (number) and PHOTOS (Photo record count)
check_db() {
  odb "$2" "$CHECK_TIMEOUT" "CONNECT plocal:$1 admin admin; CHECK DATABASE -v; LIST CLASSES; DISCONNECT" \
    || log "  [WARN] console exit code $? (see $2)"
  CHECK_ERRORS="$(grep -o 'Check of storage completed in [0-9]*ms\. [0-9]* with errors' "$2" | grep -o '[0-9]* with errors' | grep -o '^[0-9]*' || true)"
  if [ -z "$CHECK_ERRORS" ]; then
    grep -q 'Check of storage completed' "$2" && CHECK_ERRORS=0 || CHECK_ERRORS=unknown
  fi
  PHOTOS="$(grep -E '^\|[0-9 ]+\|Photo +\|' "$2" | awk -F'|' '{gsub(/ /, "", $6); print $6}' | head -1)"
  PHOTOS="${PHOTOS:-unknown}"
  log "  check: errors=$CHECK_ERRORS, Photo records=$PHOTOS"
  grep -E '^Error:' "$2" | sort -u | head -10 | sed 's/^/    /' || true
}

# ---------------------------------------------------------------------------------------
cmd_status() {
  local db="$DB_PARENT/$DB_NAME" f
  echo "Picapport service: $($SYSTEMCTL is-active picapport-wrapper 2>/dev/null || true)   java running: $(java_running && echo yes || echo no)"
  echo "HTTP :8080/picapport: $(http_code http://localhost:8080/picapport 10)"
  if [ -d "$db" ]; then
    echo "Database: $db  size $(du -sh "$db" | cut -f1)  files $(find "$db" -type f | wc -l)"
    echo "  newest file write: $(find "$db" -type f -printf '%TY-%Tm-%Td %TH:%TM %p\n' | sort | tail -1)"
    if [ -f "$db/dirty.fl" ]; then
      echo "  dirty flag (dirty.fl first byte, 1 = not closed cleanly): $(od -An -tu1 -N1 "$db/dirty.fl" | tr -d ' ')"
    fi
  else
    echo "Database: $db NOT FOUND"
  fi
  f="$(newest_pp_log)"
  if [ -n "$f" ]; then
    echo "Picapport log: $f"
    echo "  broken-page reports in it (count, files and pages):"
    grep -o "detected to be broken \[[^]]*\]" "$f" | sort | uniq -c | sed 's/^/    /' || echo "    none"
    echo "  other error classes in it (count):"
    grep '^ERROR@' "$f" | grep -v OPageIsBrokenException \
      | sed -E 's/^ERROR@ [0-9:.]+ Exception Error ([^: ]+).* ([a-z]+\.[A-Za-z0-9_.$]*(Exception|Error))[: ].*/\2   (in \1)/' \
      | sed -E 's/^[a-z0-9_.]+\.([A-Z])/\1/' | sort | uniq -c | sort -rn | head -8 | sed 's/^/    /' || true
  fi
  echo "Work area $WORK_DIR:"
  if [ -d "$WORK_DIR" ]; then
    ls -1d "$WORK_DIR"/*/ 2>/dev/null | while read -r s; do echo "  $s  $(du -sh "$s" | cut -f1)"; done || true
  else
    echo "  none"
  fi
}

# ---------------------------------------------------------------------------------------
cmd_snapshot() {
  local db="$DB_PARENT/$DB_NAME" ts dest
  guard_paths
  [ -d "$db" ] || die "database not found: $db"
  ts="$(date +%Y%m%d-%H%M%S)"; dest="$WORK_DIR/snapshot-$ts"
  need_space_mb $(( $(du -sk "$DB_PARENT" | cut -f1) * 3 / 1024 ))
  log "snapshot: $DB_PARENT ($(du -sh "$DB_PARENT" | cut -f1)) -> $dest"
  if [ "$DRY_RUN" = 1 ]; then
    log "DRY RUN. Would:"
    log "  1. stop Picapport (picapport-wrapper; slideshow stops; time it; check java exits)"
    log "  2. cp -a $DB_PARENT $dest/db, compare every file, write SHA256SUMS, make it read-only"
    log "  3. start Picapport, wait up to ${START_WAIT}s for :8080, relaunch the slideshow"
    log "  If anything fails after step 1, Picapport is started again before exiting."
    log "  Not touched: the live database (only read), the photo HDD, mount-hdd, photo-api."
    exit 0
  fi
  mkdir -p "$WORK_DIR"
  stop_picapport
  log "copying"
  mkdir -p "$dest"
  cp -a "$DB_PARENT" "$dest/db"
  diff -rq "$DB_PARENT" "$dest/db" >/dev/null || die "the copy differs from the original"
  ( cd "$dest/db" && find . -type f -print0 | sort -z | xargs -0 sha256sum ) > "$dest/SHA256SUMS"
  {
    echo "snapshot of $DB_PARENT taken $(date '+%F %T')"
    echo "picapport stop took $STOP_SECS s (killed: $STOP_KILLED)"
    echo "files $(find "$dest/db" -type f | wc -l), size $(du -sh "$dest/db" | cut -f1)"
  } > "$dest/INFO"
  chmod -R a-w "$dest"
  log "  copied and verified: $(find "$dest/db" -type f | wc -l) files, $(du -sh "$dest/db" | cut -f1); read-only"
  start_picapport || die "Picapport did not answer within ${START_WAIT}s (see journalctl -u picapport-wrapper)"
  log "snapshot done: $dest"
  log "Undo: nothing to undo on the live system; to delete the snapshot: chmod -R u+w $dest && rm -r $dest"
}

# ---------------------------------------------------------------------------------------
cmd_repair() {
  local db="$DB_PARENT/$DB_NAME" ts R src new exported_photos broken_after
  guard_paths
  [ -d "$db" ] || die "database not found: $db"
  ts="$(date +%Y%m%d-%H%M%S)"; R="$WORK_DIR/repair-$ts"
  src="$R/source/$DB_NAME"; new="$R/new/$DB_NAME"
  # source copy + export + new database; the new one has grown far beyond its final size before
  need_space_mb $(( $(du -sk "$db" | cut -f1) * 15 / 1024 ))
  log "repair: $db -> work folder $R  (swap: $([ "$NO_SWAP" = 1 ] && echo no || echo yes))"
  if [ "$DRY_RUN" = 1 ]; then
    log "DRY RUN. Would, with Picapport and the slideshow DOWN throughout (estimate 15-30 min):"
    log "  1. stop Picapport (up to 5 min; time it; check java exits)"
    log "  2. copy $db -> $src"
    log "  3. CHECK DATABASE on the copy (report damaged pages, Photo records)"
    log "  4. EXPORT DATABASE from the copy -> $R/export.json.gz (everything reachable)"
    log "  5. CREATE + IMPORT into a fresh database $new (disk cache capped at ${ODB_CACHE_MB} MB, heap $ODB_HEAP, limit ${IMPORT_TIMEOUT}s)"
    log "  6. CHECK DATABASE on the new one: must have 0 errors and every exported photo"
    if [ "$NO_SWAP" = 1 ]; then
      log "  7. --no-swap: start Picapport on the OLD database and the slideshow; nothing else changes"
    else
      log "  7. swap: move the live database to $R/live-before/ (kept), move the new one into $DB_PARENT"
      log "  8. start Picapport; if it does not answer, put the old database back and start again"
      log "  9. relaunch the slideshow, wait ${SETTLE_WAIT}s, report broken-page errors in Picapport's new log"
      log "  Undo afterwards: picapport-db.sh restore $R/live-before"
    fi
    log "  If anything fails before the swap, the live database is untouched and Picapport is started on it."
    log "  Not touched: the photo HDD, mount-hdd, photo-api."
    exit 0
  fi

  ensure_tools
  mkdir -p "$R/source" "$R/new"
  stop_picapport

  log "1/5 copying the live database"
  cp -a "$db" "$src"
  diff -rq "$db" "$src" >/dev/null || die "the copy differs from the live database"

  log "2/5 checking the copy"
  check_db "$src" "$R/check-source.log"

  log "3/5 exporting everything reachable"
  odb "$R/export.log" "$EXPORT_TIMEOUT" "CONNECT plocal:$src admin admin; EXPORT DATABASE $R/export; DISCONNECT" \
    || die "export failed (see $R/export.log)"
  grep -q 'Database export completed' "$R/export.log" || die "export did not complete (see $R/export.log)"
  grep -E "Cluster 'photo'|Exported [0-9]+ of total" "$R/export.log" | sed 's/^/    /' || true
  exported_photos="$(grep -o "Cluster 'photo' (id=[0-9]*)\.*OK (records=[0-9]*" "$R/export.log" | grep -o '[0-9]*$' || true)"
  [ -n "$exported_photos" ] || die "could not read the number of exported photos (see $R/export.log)"

  log "4/5 importing into a fresh database"
  odb "$R/import.log" "$IMPORT_TIMEOUT" "CREATE DATABASE plocal:$new admin admin plocal; IMPORT DATABASE $R/export.json.gz -preserveClusterIDs=true; DISCONNECT" \
    || log "  [WARN] import console exit code $? (the check below decides)"
  grep -E 'Imported [0-9,]+ records|Created [0-9]+ indexes|Stale indexes|import completed' "$R/import.log" | sed 's/^/    /' || true
  log "  new database size: $(du -sh "$new" 2>/dev/null | cut -f1)"

  log "5/5 checking the new database"
  check_db "$new" "$R/check-new.log"
  {
    echo "repair started $ts; picapport stop ${STOP_SECS}s (killed: $STOP_KILLED)"
    echo "source: errors=$(grep -o '[0-9]* with errors' "$R/check-source.log" | head -1 || true); exported photos=$exported_photos"
    echo "new: errors=$CHECK_ERRORS photos=$PHOTOS"
  } > "$R/INFO"
  if [ "$CHECK_ERRORS" != 0 ] || [ "$PHOTOS" != "$exported_photos" ]; then
    log "[ERROR] the new database is not clean (errors=$CHECK_ERRORS, photos=$PHOTOS, expected $exported_photos): not swapping"
    start_picapport || log "[WARN] Picapport did not answer; check journalctl -u picapport-wrapper"
    exit 1
  fi
  log "  the new database is clean: 0 errors, $PHOTOS photos (all exported)"

  if [ "$NO_SWAP" = 1 ]; then
    start_picapport || die "Picapport did not answer within ${START_WAIT}s"
    log "repair done WITHOUT swap. Repaired database: $new (not in use)"
    exit 0
  fi

  log "swapping: live database -> $R/live-before/ (kept); new database -> $DB_PARENT"
  mkdir -p "$R/live-before"
  mv "$db" "$R/live-before/$DB_NAME"
  mv "$new" "$db"
  echo "swapped in $(date '+%F %T'); old database kept in $R/live-before" >> "$R/INFO"
  if ! start_picapport; then
    log "[ERROR] Picapport did not start on the repaired database: putting the old one back"
    $SUDO "$SYSTEMCTL" stop picapport-wrapper || true
    mkdir -p "$R/new-failed"; mv "$db" "$R/new-failed/$DB_NAME"; mv "$R/live-before/$DB_NAME" "$db"
    echo "ROLLED BACK $(date '+%F %T')" >> "$R/INFO"
    start_picapport || log "[WARN] Picapport did not answer after the rollback either"
    exit 1
  fi
  log "waiting ${SETTLE_WAIT}s for Picapport's crawler, then reading its log"
  sleep "$SETTLE_WAIT"
  broken_after="$(grep -c 'detected to be broken' "$(newest_pp_log)" 2>/dev/null || true)"
  log "  broken-page reports since the start: ${broken_after:-0}"
  grep -o "detected to be broken \[[^]]*\]" "$(newest_pp_log)" 2>/dev/null | sort | uniq -c | sed 's/^/    /' || true
  log "  all error types in Picapport's log since the start (count):"
  grep '^ERROR@' "$(newest_pp_log)" 2>/dev/null \
    | sed -E 's/^ERROR@ [0-9:.]+ Exception Error ([^: ]+).* ([a-z]+\.[A-Za-z0-9_.$]*(Exception|Error))[: ].*/\2   (in \1)/' \
    | sed -E 's/^[a-z0-9_.]+\.([A-Z])/\1/' | sort | uniq -c | sort -rn | head -8 | sed 's/^/    /' || true
  [ "$(grep -c '^ERROR@' "$(newest_pp_log)" 2>/dev/null || true)" = 0 ] && log "    none"
  echo "broken-page reports ${SETTLE_WAIT}s after start: ${broken_after:-0}; errors: $(grep -c '^ERROR@' "$(newest_pp_log)" 2>/dev/null || true)" >> "$R/INFO"
  log "  If Picapport cannot use the repaired database (errors above, no photos in the slideshow), undo with restore (below)."
  log "repair done: Picapport runs on the repaired database. Old database kept in $R/live-before"
  log "Undo: bash $REPO_ROOT/scripts/picapport-db.sh restore $R/live-before"
}

# ---------------------------------------------------------------------------------------
cmd_restore() {
  local db="$DB_PARENT/$DB_NAME" from="$ARG" ts aside
  [ -n "$from" ] || die "usage: picapport-db.sh restore <dir containing $DB_NAME>"
  guard_paths "$from"
  [ -d "$from/$DB_NAME" ] || die "no $DB_NAME in $from"
  ts="$(date +%Y%m%d-%H%M%S)"; aside="$WORK_DIR/replaced-$ts"
  log "restore: $from/$DB_NAME -> $db; the current database is kept in $aside"
  if [ "$DRY_RUN" = 1 ]; then
    log "DRY RUN. Would: stop Picapport, move $db to $aside/, move $from/$DB_NAME into $DB_PARENT, start Picapport and the slideshow"
    exit 0
  fi
  stop_picapport
  mkdir -p "$aside"
  mv "$db" "$aside/$DB_NAME"
  mv "$from/$DB_NAME" "$db"
  start_picapport || die "Picapport did not answer within ${START_WAIT}s"
  log "restore done. Undo: picapport-db.sh restore $aside"
}

# ---------------------------------------------------------------------------------------
cmd="${1:-}"; [ $# -gt 0 ] && shift
for a in "$@"; do
  case "$a" in
    --dry-run) DRY_RUN=1 ;;
    --no-swap) NO_SWAP=1 ;;
    -*) echo "unknown option: $a" >&2; exit 2 ;;
    *) ARG="$a" ;;
  esac
done
case "$cmd" in
  status) cmd_status ;;
  snapshot) cmd_snapshot ;;
  repair) cmd_repair ;;
  restore) cmd_restore ;;
  -h|--help|"") usage ;;
  *) echo "unknown command: $cmd (see --help)" >&2; exit 2 ;;
esac
