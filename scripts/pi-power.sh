#!/bin/bash
# pi-power.sh - the clean way to reboot or shut down the Pi (backlog B10). Run on the Pi as pi,
# by an agent through the pi-power skill (which holds the owner's agreement gate) or by hand.
#
#   pi-power.sh reboot   [--dry-run] [--force] [--reason TEXT]
#   pi-power.sh shutdown [--dry-run] [--force] [--reason TEXT]
#   pi-power.sh verify          read-only, after the Pi is back up: did the last stop go cleanly,
#                               did the HDD unmount cleanly, is everything running again
#
# reboot / shutdown:
#   1. Refuse if a project job is running (vocabulary refresh, metadata survey, database script,
#      update; scripts/lib/project-jobs.sh), and list them. --force goes ahead anyway: use it only
#      after the owner has been told what it interrupts and has confirmed twice (pi-power skill).
#   2. Stop Picapport on its own first (it gets up to 5 minutes to close its database), time it,
#      and check its log says "shutdown completed". If its java process is still running
#      afterwards, do NOT power off: start Picapport again and exit with an error.
#   3. Record the result in /var/log/pi-photo-hub/power.log (on the SD card, kept across reboots).
#   4. systemctl reboot / poweroff. The OS stops the rest and unmounts the photo HDD itself
#      (allowed by hard rule 1; this script never mounts or unmounts it by hand).
# --dry-run does steps 1 and shows the plan; it changes nothing.
#
# After "shutdown" the Pi is halted but still powered: switch it off at the cable once it has
# stopped answering; switching the cable off and on again starts it.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PICAPPORT_HOME="${PICAPPORT_HOME:-/opt/picapport/.picapport}"
LOG_DIR="${LOG_DIR:-/var/log/pi-photo-hub}"
POWER_LOG="$LOG_DIR/power.log"
SYSTEMCTL="${SYSTEMCTL:-systemctl}"
JOURNALCTL="${JOURNALCTL:-journalctl}"
CURL="${CURL:-curl}"
PGREP="${PGREP:-pgrep}"
LOCK="${PI_POWER_LOCK:-/tmp/pi-power.lock}"
if [ -z "${SUDO+x}" ]; then
  if [ "$(id -u)" -eq 0 ]; then SUDO=""; else SUDO="sudo"; fi
fi
# shellcheck source=/dev/null
source "$REPO_ROOT/scripts/lib/project-jobs.sh"

usage() { sed -n '2,/^set -euo/p' "${BASH_SOURCE[0]}" | sed '$d; s/^# \{0,1\}//'; }
say() { echo "[$(date '+%F %T')] $*"; }
die() { say "[ERROR] $*"; exit 1; }
java_running() { $PGREP -f picapport-headless.jar >/dev/null 2>&1; }
newest_pp_log() { ls -t "$PICAPPORT_HOME"/logfiles/picapport.* 2>/dev/null | sed -n "${1:-1}p"; }
http_code() { $CURL -s -o /dev/null -w '%{http_code}' -m "${2:-5}" "$1" 2>/dev/null || true; }
record() { # one line in power.log
  $SUDO mkdir -p "$LOG_DIR" 2>/dev/null || true
  printf '%s %s\n' "$(date '+%F %T')" "$*" | $SUDO tee -a "$POWER_LOG" >/dev/null 2>&1 \
    || say "[WARN] could not write $POWER_LOG"
}

# ---------------------------------------------------------------------------------------
cmd_power() { # cmd_power reboot|shutdown
  local action="$1" jobs njobs unsafe since t0 secs killed clean pl before after j
  exec 9>"$LOCK"
  flock -n 9 || die "another pi-power.sh is already running"

  say "pi-power $action$([ "$DRY_RUN" = 1 ] && echo ' (DRY RUN: nothing will be changed)')"
  say "reason: $REASON"
  say "up since $(uptime -s 2>/dev/null || echo unknown)"

  # 1. jobs
  jobs="$(project_jobs)"
  if [ -n "$jobs" ]; then
    unsafe="$(printf '%s\n' "$jobs" | grep -c 'NOT safe' || true)"
    say "project jobs running now:"
    printf '%s\n' "$jobs" | sed 's/^/    /'
    if [ "$FORCE" != yes ]; then
      say "REFUSED: jobs are running. Wait for them to finish, or (owner's decision, after hearing"
      say "what it interrupts) run again with --force."
      [ "$unsafe" -gt 0 ] && say "  $unsafe of them NOT safe to interrupt: a database job or an update would be left half done."
      exit 3
    fi
    say "--force: going ahead although jobs are running (they will be interrupted)"
  else
    say "project jobs running now: none"
  fi

  if [ "$DRY_RUN" = 1 ]; then
    say "Would:"
    if java_running; then
      say "  1. stop Picapport (systemctl stop picapport-wrapper; up to 5 min; the slideshow stops)"
      say "     and check its log says 'shutdown completed'; if java is still running, start it again and stop here"
    else
      say "  1. Picapport is not running: nothing to stop"
    fi
    say "  2. write one line to $POWER_LOG"
    if [ "$action" = reboot ]; then
      say "  3. systemctl reboot: the Pi is back in about 1-2 minutes; the slideshow starts by itself"
    else
      say "  3. systemctl poweroff: the Pi halts; then switch it off at the cable (and off/on again to start it)"
    fi
    say "DRY RUN finished: nothing was changed."
    exit 0
  fi

  # 2. stop Picapport on its own, so we know its database was closed before the OS goes down
  secs=0; killed=no; clean=not-running
  if java_running; then
    pl="$(newest_pp_log)"
    before="$(grep -c 'shutdown completed' "$pl" 2>/dev/null || true)"
    since="$(date '+%F %T')"
    say "stopping Picapport (it may take up to 5 minutes to close its database)"
    t0=$(date +%s)
    $SUDO "$SYSTEMCTL" stop picapport-wrapper || say "[WARN] systemctl stop picapport-wrapper returned an error"
    secs=$(( $(date +%s) - t0 ))
    j="$($JOURNALCTL -u picapport-wrapper --since "$since" --no-pager 2>/dev/null || true)"
    if printf '%s\n' "$j" | grep -qi 'sigkill\|timed out'; then killed=yes; fi
    after="$(grep -c 'shutdown completed' "$pl" 2>/dev/null || true)"
    if [ "${after:-0}" -gt "${before:-0}" ]; then clean=yes; else clean=no; fi
    say "  stop took ${secs} s; 'shutdown completed' in Picapport's log: $clean; killed by systemd: $killed"
    if java_running; then
      record "$action ABORTED reason=\"$REASON\" force=$FORCE picapport_stop=${secs}s clean=$clean killed=$killed java_still_running=yes"
      say "[ERROR] Picapport's java process is still running: not powering off. Starting Picapport again."
      $SUDO "$SYSTEMCTL" start picapport-wrapper || true
      $SUDO "$SYSTEMCTL" start picapport-chromium || true
      exit 1
    fi
  else
    say "Picapport is not running: nothing to stop"
  fi

  # 3. record, 4. power
  njobs=0; [ -z "$jobs" ] || njobs="$(printf '%s\n' "$jobs" | wc -l)"
  record "$action reason=\"$REASON\" force=$FORCE jobs=$njobs picapport_stop=${secs}s clean=$clean killed=$killed"
  if [ "$action" = reboot ]; then
    say "rebooting now (back in about 1-2 minutes; the SSH connection will drop)"
    $SUDO "$SYSTEMCTL" --no-block reboot
  else
    say "shutting down now. When the Pi stops answering (about 30 s), it is safe to switch it off at the cable."
    $SUDO "$SYSTEMCTL" --no-block poweroff
  fi
}

# ---------------------------------------------------------------------------------------
cmd_verify() { # read-only
  local problems=0 boot last prev s api pic chr dirty
  boot="$(uptime -s 2>/dev/null || echo unknown)"
  echo "up since: $boot"
  echo "last entries in $POWER_LOG:"
  tail -n 3 "$POWER_LOG" 2>/dev/null | sed 's/^/    /' || echo "    none"
  last="$(tail -n 1 "$POWER_LOG" 2>/dev/null | cut -c1-19 || true)"
  if [ -n "$last" ] && [ "$boot" != unknown ]; then
    local gap=$(( $(date -d "$boot" +%s) - $(date -d "$last" +%s) ))
    if [ "$gap" -ge 0 ] && [ "$gap" -le 900 ]; then
      echo "this boot followed a pi-power reboot/shutdown ${gap} s earlier"
    else
      echo "this boot did NOT follow a pi-power reboot/shutdown (last entry $last): a power cut, or a reboot by other means"
    fi
  fi
  prev="$(newest_pp_log 2)"
  if [ -n "$prev" ]; then
    if grep -q 'shutdown completed' "$prev"; then
      echo "Picapport's previous run ($(basename "$prev")) ended with 'shutdown completed': yes"
    else
      echo "Picapport's previous run ($(basename "$prev")) ended with 'shutdown completed': NO (it was killed or the power was cut)"
      problems=1
    fi
  fi
  dirty="$($JOURNALCTL -k -b --no-pager 2>/dev/null | grep -c 'not properly unmounted' || true)"
  echo "photo HDD at this boot: 'Volume was not properly unmounted' messages: ${dirty:-0} (0 expected after a clean reboot or shutdown; backlog Q11)"
  if $JOURNALCTL -b -1 -n 1 --no-pager >/dev/null 2>&1; then
    echo "previous boot's journal: kept. Its photo-HDD unmount at shutdown:"
    $JOURNALCTL -b -1 --no-pager 2>/dev/null | grep -E 'mnt-photos|/mnt/photos|exFAT|sda1' | tail -n 5 | cut -c1-200 | sed 's/^/    /' || true
  else
    echo "previous boot's journal: not available (journal not persistent yet, backlog B09)"
  fi
  for s in mount-hdd picapport-wrapper photo-api; do
    echo "$s: $($SYSTEMCTL is-active "$s" 2>/dev/null || true)"
    [ "$($SYSTEMCTL is-active "$s" 2>/dev/null || true)" = active ] || problems=1
  done
  api="$(http_code http://localhost:3000/api/test)"; pic="$(http_code http://localhost:8080/picapport 10)"
  chr="$($PGREP -c chromium 2>/dev/null || true)"
  echo "api: $api   picapport: $pic   chromium processes: ${chr:-0}"
  [ "$api" = 200 ] && [ "$pic" = 200 ] && [ "${chr:-0}" -gt 0 ] || problems=1
  if [ "$problems" = 0 ]; then echo "VERIFY: OK"; else echo "VERIFY: PROBLEM (see above)"; exit 1; fi
}

# ---------------------------------------------------------------------------------------
cmd="${1:-}"; [ $# -gt 0 ] && shift
DRY_RUN=0; FORCE=no; REASON="not given"
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --force) FORCE=yes ;;
    --reason) REASON="${2:?--reason needs a text}"; shift ;;
    *) echo "unknown option: $1 (see --help)" >&2; exit 2 ;;
  esac
  shift
done
case "$cmd" in
  reboot|shutdown) cmd_power "$cmd" ;;
  verify) cmd_verify ;;
  -h|--help|"") usage ;;
  *) echo "unknown command: $cmd (see --help)" >&2; exit 2 ;;
esac
