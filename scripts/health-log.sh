#!/bin/bash
# health-log.sh - one key=value line per minute describing the health of the photo hub,
# plus a small screenshot of the screen every 5 minutes. Run from cron (see
# scripts/install-health-log.sh); see "Health Log" in README.md.
#
#   health-log.sh            take one snapshot (what cron runs)
#   health-log.sh --status   show where the data is and the last few lines
#
# Data lives in RAM (/run/user/<uid>/pi-photo-hub-health) to avoid SD card wear.
# It is lost on reboot/power loss by design. Log is capped at 5000 lines (~3.5 days),
# screenshots at 288 (24 h, roughly 15 MB; estimate, not yet measured on the Pi).
# Screenshots are PNG: this Pi's grim is built without JPEG support.

set -u

UID_NUM="$(id -u)"
STATE_DIR="${HEALTH_DIR:-/run/user/$UID_NUM/pi-photo-hub-health}"
[ -d "$(dirname "$STATE_DIR")" ] || STATE_DIR="/tmp/pi-photo-hub-health"
LOG="$STATE_DIR/health.log"
SHOTS="$STATE_DIR/shots"
PREV="$STATE_DIR/prev"
PP_LOGDIR="/opt/picapport/.picapport/logfiles"
MAX_LINES=5000
MAX_SHOTS=288

mkdir -p "$SHOTS"

if [ "${1:-}" = "--status" ]; then
  echo "Data dir:     $STATE_DIR"
  echo "Log:          $LOG ($(wc -l < "$LOG" 2>/dev/null || echo 0) lines)"
  echo "Screenshots:  $SHOTS ($(ls "$SHOTS" 2>/dev/null | wc -l) files)"
  echo "--- last 5 lines"
  tail -n 5 "$LOG" 2>/dev/null
  exit 0
fi

# Never run two at once (e.g. if a curl hangs)
exec 9>"$STATE_DIR/lock"
flock -n 9 || exit 0

now=$(date +%s)
ts=$(date '+%Y-%m-%dT%H:%M:%S%z')

# ---- previous run's values (our own file) ----
prev_ts=0; prev_file=""; prev_broken=0; prev_pool=0; prev_json=0; prev_err=0
[ -f "$PREV" ] && . "$PREV"
if [ "$prev_ts" -gt 0 ]; then gap=$((now - prev_ts)); else gap=0; fi

# ---- Picapport + API reachability ----
out=$(curl -s -o /dev/null -m 10 -w '%{http_code} %{time_total}' http://localhost:8080/picapport 2>/dev/null || true)
pp_code=${out%% *}; pp_t=${out#* }
api_code=$(curl -s -o /dev/null -m 5 -w '%{http_code}' http://localhost:3000/api/test 2>/dev/null || true)
: "${pp_code:=000}" "${pp_t:=0}" "${api_code:=000}"

# ---- new Picapport log errors since the previous run ----
c_broken=0; c_pool=0; c_json=0; c_err=0
pl=$(ls -t "$PP_LOGDIR"/picapport.* 2>/dev/null | head -1)
if [ -n "$pl" ]; then
  c_broken=$(grep -c 'OPageIsBrokenException' "$pl")
  c_pool=$(grep -c 'OLockException' "$pl")
  c_json=$(grep -c 'PicApportJsonServlet' "$pl")
  c_err=$(grep -c '^ERROR' "$pl")
fi
delta() { # delta <current> <previous>
  if [ "$prev_ts" -eq 0 ]; then echo 0
  elif [ "$pl" != "$prev_file" ] || [ "$1" -lt "$2" ]; then echo "$1"
  else echo $(($1 - $2)); fi
}
d_broken=$(delta "$c_broken" "$prev_broken")
d_pool=$(delta "$c_pool" "$prev_pool")
d_json=$(delta "$c_json" "$prev_json")
d_err=$(delta "$c_err" "$prev_err")

# ---- Java (Picapport) ----
j_rss=0; j_thr=0; j_cpu=0
jpid=$(pgrep -f 'java .*picapport-headless.jar' | head -1 || true)
if [ -n "$jpid" ]; then
  read -r rss thr cpu < <(ps -o rss=,nlwp=,pcpu= -p "$jpid") || true
  j_rss=$(( ${rss:-0} / 1024 )); j_thr=${thr:-0}; j_cpu=${cpu:-0}
fi

# ---- system ----
mem_avail=$(free -m | awk '/^Mem:/{print $7}')
swap_used=$(free -m | awk '/^Swap:/{print $3}')
load=$(cut -d' ' -f1 /proc/loadavg)
up=$(cut -d. -f1 /proc/uptime)
temp="na"; throttled="na"
if command -v vcgencmd >/dev/null 2>&1; then
  temp=$(vcgencmd measure_temp 2>/dev/null | sed 's/temp=//; s/.C$//')
  throttled=$(vcgencmd get_throttled 2>/dev/null | sed 's/throttled=//')
fi
if mountpoint -q /mnt/photos; then hdd=1; else hdd=0; fi

# ---- Chromium + connections to Picapport ----
chr_n=$(pgrep -c -x chromium || true)
chr_rss=$(ps -C chromium -o rss= 2>/dev/null | awk '{s+=$1} END{print int(s/1024)}')
conn_est=$(ss -Htn state established '( sport = :8080 )' 2>/dev/null | wc -l)
conn_cw=$(ss -Htn state close-wait '( sport = :8080 )' 2>/dev/null | wc -l)

# ---- write the log line ----
echo "ts=$ts up=$up gap=$gap pp=$pp_code pp_t=$pp_t api=$api_code" \
     "new_broken=$d_broken new_pool=$d_pool new_json=$d_json new_err=$d_err" \
     "java_rss_mb=$j_rss java_threads=$j_thr java_cpu=$j_cpu" \
     "mem_avail_mb=${mem_avail:-0} swap_mb=${swap_used:-0} load=$load temp=$temp throttled=$throttled hdd=$hdd" \
     "chromium_procs=${chr_n:-0} chromium_rss_mb=${chr_rss:-0} conn_est=$conn_est conn_closewait=$conn_cw" >> "$LOG"

# keep the log bounded
if [ "$(wc -l < "$LOG")" -gt $((MAX_LINES + 500)) ]; then
  tail -n "$MAX_LINES" "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
fi

# ---- remember values for the next run ----
cat > "$PREV" <<EOP
prev_ts=$now
prev_file="$pl"
prev_broken=$c_broken
prev_pool=$c_pool
prev_json=$c_json
prev_err=$c_err
EOP

# ---- screenshot every 5 minutes (Wayland desktop) ----
if [ $(( $(date +%-M) % 5 )) -eq 0 ] && command -v grim >/dev/null 2>&1 \
   && [ -S "/run/user/$UID_NUM/wayland-0" ]; then
  XDG_RUNTIME_DIR="/run/user/$UID_NUM" WAYLAND_DISPLAY=wayland-0 \
    grim -t png -s 0.35 "$SHOTS/$(date +%Y%m%d-%H%M).png" 2>/dev/null || true
  ls -t "$SHOTS"/*.png 2>/dev/null | tail -n +$((MAX_SHOTS + 1)) | xargs -r rm -f
fi
exit 0
