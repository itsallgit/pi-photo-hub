#!/bin/bash
# update.sh - bring the Pi's checkout and configuration in line with a version of this repo.
# Run on the Pi (the apply-changes skill and README "Updating the Pi" describe when and how).
#
#   update.sh                      update to the tip of origin/main (also: get back onto main)
#   update.sh --branch NAME        test a branch: update to origin/NAME
#   update.sh --ref SHA            roll back / pin: detached checkout of a commit
#   update.sh --dry-run            show what would change; changes nothing except `git fetch`
#                                  and a temporary export of the target under /tmp
#   update.sh --reset-slideshow    also forget the saved slideshow (the API falls back to its default)
#   update.sh --discard-local-changes   move tracked local changes aside (backup in the state
#                                  directory) and restore them from git, instead of refusing
#
# From the owner's PC, the first time (before the Pi has this script), pipe the committed copy:
#   git show origin/feat/x:scripts/update.sh | ssh pi@pi.local 'bash -s -- --dry-run --branch feat/x'
#
# What it does: preflight, git fetch, check out the target (fast-forward only, never a reset,
# stash or rebase), then run the TARGET version's own copy of this script to apply it
# (--phase2): install missing packages from config/packages.txt (install only, never an
# upgrade), add missing kernel command-line settings from config/kernel-cmdline.txt (used at the
# next reboot; never reboots),
# sync installed systemd units, the logging standard (persistent journal, health log file),
# API dependencies, Picapport's properties file, the logrotate config, the cron entries and the
# hidden pointer; then RESTART THE APP the way a boot
# starts it (photo-api, then the boot's slideshow launcher picapport-chromium), and verify.
# It never upgrades or removes packages, reboots, restarts mount-hdd (it would remount the photo HDD) or restarts
# Picapport (suspected to damage its database, backlog Q11); it says when those are needed.
set -euo pipefail

REPO_ROOT="${PI_REPO:-/home/pi/pi-photo-hub}"
STATE_DIR="${STATE_DIR:-/var/lib/photo-api}"
LOG_DIR="${LOG_DIR:-/var/log/pi-photo-hub}"
SYSTEMCTL="${SYSTEMCTL:-systemctl}"
CURL="${CURL:-curl}"
PGREP="${PGREP:-pgrep}"
UNIT_DIR="${UNIT_DIR:-/etc/systemd/system}"
if [ -z "${SUDO+x}" ]; then
  if [ "$(id -u)" -eq 0 ]; then SUDO=""; else SUDO="sudo"; fi
fi
export STATE_DIR LOG_DIR SYSTEMCTL SUDO

MODE=main; TARGET_NAME=main
DRY_RUN=0; RESET_SLIDESHOW=0; WITH_HEALTH_LOG=0; WITH_LOGROTATE=0; DISCARD=0
PHASE2=0; SRC=""; CHANGED=""; FROM=""; TO=""; FROM_DESC=""; CLEANUP_SRC=0

usage() { sed -n '2,/^set -euo/p' "${BASH_SOURCE[0]:-$0}" 2>/dev/null | sed '$d; s/^# \{0,1\}//' || true; }

while [ $# -gt 0 ]; do
  case "$1" in
    --branch) MODE=branch; TARGET_NAME="${2:?--branch needs a name}"; shift ;;
    --ref) MODE=ref; TARGET_NAME="${2:?--ref needs a commit}"; shift ;;
    --dry-run) DRY_RUN=1 ;;
    --reset-slideshow) RESET_SLIDESHOW=1 ;;
    # Accepted for older callers; both are now always installed (part of the app).
    --with-health-log) WITH_HEALTH_LOG=1 ;;
    --with-logrotate) WITH_LOGROTATE=1 ;;
    --discard-local-changes) DISCARD=1 ;;
    --phase2) PHASE2=1 ;;
    --src) SRC="${2:?}"; shift ;;
    --changed) CHANGED="${2:?}"; shift ;;
    --from) FROM="${2:?}"; shift ;;
    --to) TO="${2:?}"; shift ;;
    --from-desc) FROM_DESC="${2:?}"; shift ;;
    --cleanup-src) CLEANUP_SRC=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "[ERROR] unknown option: $1 (see --help)" >&2; exit 2 ;;
  esac
  shift
done
export DRY_RUN
# flags forwarded to phase 2
fwd=()
if [ "$RESET_SLIDESHOW" = 1 ]; then fwd+=(--reset-slideshow); fi
if [ "$WITH_HEALTH_LOG" = 1 ]; then fwd+=(--with-health-log); fi
if [ "$WITH_LOGROTATE" = 1 ]; then fwd+=(--with-logrotate); fi

log() {
  local m
  m="[$(date '+%F %T')] $*"
  echo "$m"
  if [ "$DRY_RUN" != 1 ]; then
    $SUDO mkdir -p "$LOG_DIR" 2>/dev/null || true
    printf '%s\n' "$m" | $SUDO tee -a "$LOG_DIR/update.log" >/dev/null 2>&1 || true
  fi
}
die() { log "[ERROR] $*"; exit 1; }

# Executable-bit-only differences are ignored (-c core.fileMode=false); the bits recorded in
# the repo are applied afterwards by ensure_exec_bits.
g() { git -c core.fileMode=false -C "$REPO_ROOT" "$@"; }

# =====================================================================================
# Phase 2: apply a checked-out (or, for --dry-run, exported) source tree.
# =====================================================================================
if [ "$PHASE2" = 1 ]; then
  [ -n "$SRC" ] && [ -d "$SRC" ] || die "phase 2 needs --src"
  export SRC REPO="$REPO_ROOT" CHANGED_FILES="$CHANGED" WITH_HEALTH_LOG WITH_LOGROTATE
  UPDATE_CHANGED="$(mktemp)"; export UPDATE_CHANGED
  trap 'rm -f "$UPDATE_CHANGED" "$CHANGED"; if [ "$CLEANUP_SRC" = 1 ]; then rm -rf "$SRC"; fi' EXIT
  LIB="$SRC/scripts/lib"
  [ "$DRY_RUN" = 1 ] && log "DRY RUN (apply plan, from the target's own scripts). Nothing below is executed."

  # State directory for the saved slideshow (systemd's StateDirectory= keeps it right after
  # the first photo-api start; this makes it exist before then).
  if [ ! -d "$STATE_DIR" ]; then
    log "state directory $STATE_DIR: missing, creating it"
    if [ "$DRY_RUN" != 1 ]; then
      $SUDO mkdir -p "$STATE_DIR"
      if id pi >/dev/null 2>&1; then $SUDO chown pi:pi "$STATE_DIR"; fi
    fi
  fi

  if [ "$RESET_SLIDESHOW" = 1 ]; then
    if [ -f "$STATE_DIR/slideshow_url.txt" ]; then
      log "slideshow: --reset-slideshow, moving the saved slideshow aside (the API will use its default)"
      if [ "$DRY_RUN" != 1 ]; then
        mv "$STATE_DIR/slideshow_url.txt" "$STATE_DIR/slideshow_url.txt.reset-$(date +%Y%m%d-%H%M%S)"
      fi
    else
      log "slideshow: nothing saved, nothing to reset"
    fi
  else
    if [ -f "$STATE_DIR/slideshow_url.txt" ]; then log "slideshow: keeping the saved slideshow"; fi
  fi

  if [ -f "$LIB/apply-packages.sh" ]; then bash "$LIB/apply-packages.sh"; fi
  if [ -f "$LIB/apply-boot.sh" ]; then bash "$LIB/apply-boot.sh"; fi
  bash "$LIB/apply-units.sh"
  if [ -f "$LIB/apply-logging.sh" ]; then bash "$LIB/apply-logging.sh"; fi
  bash "$LIB/apply-extras.sh"
  if [ -f "$LIB/apply-git-tidy.sh" ]; then bash "$LIB/apply-git-tidy.sh" || log "[WARN] branch tidy failed (harmless; see above)"; fi

  # --- restart the app, the way a boot starts it ---------------------------------------
  # Every update ends with the app restarted, whether or not it changed, so an update
  # exercises the same start path as a boot (owner decision 2026-11-15, backlog B20):
  #   1. photo-api (restarting it also kills Chromium, which runs in its cgroup)
  #   2. picapport-chromium.service, the boot's own slideshow launcher (oneshot: waits for
  #      Picapport and the API, then GET /api/slideshow replays the saved slideshow)
  # Not restarted: mount-hdd (would unmount/remount the photo HDD, hard rule 1) and
  # Picapport (its stop may damage the database, backlog Q11).
  echo
  launcher_rc=skipped
  if [ "$DRY_RUN" = 1 ]; then
    log "restart the app: WOULD restart photo-api, then start picapport-chromium (the boot's slideshow launcher). The screen shows the desktop for a moment, then the saved slideshow."
  else
    log "restart the app: restarting photo-api (this also closes the slideshow)"
    $SUDO "$SYSTEMCTL" restart photo-api.service
    if [ -f "$UNIT_DIR/picapport-chromium.service" ]; then
      log "restart the app: starting picapport-chromium (the boot's slideshow launcher; waits up to 120 s for Picapport and the API)"
      if timeout 200 $SUDO "$SYSTEMCTL" start picapport-chromium.service; then launcher_rc=ok; else launcher_rc=failed; fi
    else
      log "[WARN] picapport-chromium.service is not installed: the slideshow was not relaunched"
      launcher_rc=missing
    fi
  fi
  log "not restarted by design: mount-hdd (photo HDD, hard rule 1), Picapport (backlog Q11)"

  # --- things this script deliberately does not apply ---------------------------------
  echo
  log "Needs a separate, agreed step (NOT done by update.sh):"
  need=0
  if grep -qx "boot-cmdline" "$UPDATE_CHANGED"; then
    log "  - the kernel command line changed (config/kernel-cmdline.txt): takes effect at the next reboot (sudo systemctl reboot, agreed with the owner)"; need=1; fi
  if grep -qx 'picapport-properties' "$UPDATE_CHANGED"; then
    log "  - picapport.properties changed: it takes effect when Picapport restarts (not restarted; see backlog Q11)"; need=1; fi
  for u in mount-hdd.service picapport-wrapper.service; do
    if grep -qx "unit:$u" "$UPDATE_CHANGED"; then
      log "  - $u definition changed: start settings take effect at its next start or boot, stop settings (TimeoutStopSec) at its next stop; not restarted"; need=1; fi
  done
  if grep -qx "initd:picapport" "$UPDATE_CHANGED"; then
    log "  - Picapport's init script changed: used at the next Picapport stop or start (not restarted)"; need=1; fi
  if grep -E '^(picapport/|config/versions.conf|scripts/cleanup-picapport.sh|bootstrap.sh|cleanup.sh)' "$CHANGED" >/dev/null 2>&1; then
    log "  - bootstrap-managed files changed ($(grep -E '^(picapport/|config/versions.conf|scripts/cleanup-picapport.sh|bootstrap.sh|cleanup.sh)' "$CHANGED" | tr '\n' ' ')): applied only by a rebuild (bootstrap.sh; untested since September 2025)"; need=1; fi
  if grep -Eqx 'scripts/mount-hdd.sh|config/hdd.conf' "$CHANGED" 2>/dev/null; then
    log "  - scripts/mount-hdd.sh or config/hdd.conf changed (which disk is the photo HDD): used at the next boot; check first with: bash scripts/mount-hdd.sh --check (then a reboot through the pi-power skill)"; need=1; fi
  [ "$need" = 0 ] && log "  (nothing)"

  # --- verify -------------------------------------------------------------------------
  if [ "$DRY_RUN" = 1 ]; then
    log "DRY RUN finished: no unit, file, service or cron entry was changed."
    exit 0
  fi
  echo
  log "Verify:"
  problems=0
  for u in mount-hdd photo-api picapport-wrapper; do
    s="$($SYSTEMCTL is-active "$u" 2>/dev/null || true)"; log "  $u: $s"
    [ "$s" = active ] || problems=1
  done
  api=000
  for _ in 1 2 3 4 5 6 7 8; do
    api="$($CURL -s -o /dev/null -w '%{http_code}' -m 5 http://localhost:3000/api/test 2>/dev/null || true)"
    [ "$api" = 200 ] && break
    sleep 3
  done
  pic="$($CURL -s -o /dev/null -w '%{http_code}' -m 10 http://localhost:8080/picapport 2>/dev/null || true)"
  log "  api /api/test: $api    picapport: $pic"
  [ "$api" = 200 ] && [ "$pic" = 200 ] || problems=1
  log "  slideshow launcher (picapport-chromium): $launcher_rc"
  [ "$launcher_rc" = ok ] || { problems=1; log "    see: journalctl -u picapport-chromium -n 20 --no-pager"; }
  chromium_n=0
  for _ in 1 2 3 4 5; do
    chromium_n="$($PGREP -c chromium 2>/dev/null || true)"; chromium_n="${chromium_n:-0}"
    [ "$chromium_n" -gt 0 ] && break
    sleep 2
  done
  log "  chromium processes: $chromium_n (whether the slideshow itself plays is checked on the screen)"
  [ "$chromium_n" -gt 0 ] || problems=1
  log "Update applied: now at $(git -C "$REPO_ROOT" log --oneline -1) ($FROM_DESC before: ${FROM:0:7})"
  log "Undo: update.sh --ref ${FROM:0:7}${FROM_DESC:+   (or get back onto a branch: update.sh --branch main)}"
  [ "$problems" = 0 ] || die "verification found a problem (see above). Nothing was rolled back automatically."
  exit 0
fi

# =====================================================================================
# Phase 1: preflight, fetch, check out. (Self-contained: it may be piped over SSH.)
# =====================================================================================
[ -d "$REPO_ROOT/.git" ] || die "no git checkout at $REPO_ROOT (set PI_REPO to override)"
[ "$DRY_RUN" = 1 ] && log "DRY RUN: the only writes are 'git fetch' (in .git) and a temporary export under /tmp."

cur_branch="$(g branch --show-current)"
FROM="$(g rev-parse HEAD)"
if [ -n "$cur_branch" ]; then FROM_DESC="branch $cur_branch"; else FROM_DESC="detached HEAD"; fi
log "update.sh starting: on $FROM_DESC at $(g log --oneline -1), target: $MODE $TARGET_NAME"

# --- dirty check ---------------------------------------------------------------------
SLIDE=api/slideshow_url.txt
status="$(g status --porcelain --untracked-files=no || true)"
slide_dirty=0
if printf '%s\n' "$status" | grep -q " $SLIDE\$"; then slide_dirty=1; fi
other="$(printf '%s\n' "$status" | grep -v " $SLIDE\$" | sed '/^$/d' || true)"
if [ -n "$other" ]; then
  if [ "$DISCARD" = 1 ] && ! printf '%s\n' "$other" | grep -qv '^ [MD] '; then
    log "tracked local changes (will be moved aside, then restored from git):"
    printf '%s\n' "$other" | sed 's/^/    /'
    if [ "$DRY_RUN" != 1 ]; then
      bak="$STATE_DIR/discarded-$(date +%Y%m%d-%H%M%S)"
      mkdir -p "$bak" || die "cannot create $bak (does $STATE_DIR exist and is it writable by $(id -un)?)"
      printf '%s\n' "$other" | sed 's/^...//' | while read -r f; do
        mkdir -p "$bak/$(dirname "$f")"; [ -f "$REPO_ROOT/$f" ] && cp -p "$REPO_ROOT/$f" "$bak/$f"
        g checkout -- "$f"
      done
      log "backup of the discarded changes: $bak"
    fi
  else
    log "The checkout has tracked local changes:"
    printf '%s\n' "$other" | sed 's/^/    /'
    die "refusing to update a dirty checkout. Look at 'git -C $REPO_ROOT diff'; --discard-local-changes moves them aside (backup) and restores git's version."
  fi
fi

# --- reach GitHub, fetch -------------------------------------------------------------
g ls-remote --exit-code origin HEAD >/dev/null 2>&1 || die "cannot reach 'origin' ($(g remote get-url origin 2>/dev/null)). Check the Pi's network."
log "origin reachable; fetching"
g fetch origin 2>&1 | sed 's/^/    /' || die "git fetch failed"

# --- resolve the target --------------------------------------------------------------
case "$MODE" in
  main)   TARGET_NAME=main; TO="$(g rev-parse --verify -q "origin/main^{commit}")" || die "origin/main not found" ;;
  branch) g check-ref-format --branch "$TARGET_NAME" >/dev/null 2>&1 || die "'$TARGET_NAME' is not a valid branch name"
          TO="$(g rev-parse --verify -q "origin/$TARGET_NAME^{commit}")" || die "origin/$TARGET_NAME not found. Has it been pushed to GitHub?" ;;
  ref)    TO="$(g rev-parse --verify -q "$TARGET_NAME^{commit}")" || die "commit '$TARGET_NAME' not found (after fetch)" ;;
esac
[ "$MODE" = main ] && MODE=branch

CHANGED="$(mktemp)"
# CHANGED = files whose content (or existence) differs; executable-bit-only differences are listed apart.
g diff --raw --no-abbrev "$FROM" "$TO" | awk '{ p=$0; sub(/^[^	]*	/,"",p); if ($3!=$4) print p }' > "$CHANGED"
MODE_ONLY="$(g diff --raw --no-abbrev "$FROM" "$TO" | awk '{ p=$0; sub(/^[^	]*	/,"",p); if ($3==$4) print p }')"
echo
log "Plan: $FROM_DESC ${FROM:0:7}  ->  $TARGET_NAME ${TO:0:7} ($MODE)"
if [ "$FROM" = "$TO" ] && { [ "$MODE" = ref ] || [ "$cur_branch" = "$TARGET_NAME" ]; }; then
  log "  already at the target commit (the apply step still runs; it is idempotent)"
else
  log "  commits:"; g log --oneline "$FROM..$TO" 2>/dev/null | head -20 | sed 's/^/    /' || true
  [ "$(g rev-list --count "$FROM..$TO" 2>/dev/null || echo 0)" -gt 20 ] && log "    ... (more)"
  log "  files that differ ($(wc -l < "$CHANGED" | tr -d ' ')):"
  head -40 "$CHANGED" | sed 's/^/    /'
  [ -z "$MODE_ONLY" ] || log "  executable-bit-only differences (applied from git, no content change): ${MODE_ONLY//$'\n'/ }"
fi
if [ "$slide_dirty" = 1 ]; then
  if [ -f "$STATE_DIR/slideshow_url.txt" ] && cmp -s "$REPO_ROOT/$SLIDE" "$STATE_DIR/slideshow_url.txt"; then
    log "  $SLIDE is modified locally and an identical copy is in $STATE_DIR: it will be moved aside there (kept), not discarded"
  else
    die "$SLIDE has local changes and $STATE_DIR/slideshow_url.txt is missing or different. Copy the saved slideshow there first so it survives."
  fi
fi

# --- dry run: export the target, let ITS script show the apply plan ------------------
if [ "$DRY_RUN" = 1 ]; then
  TMP="$(mktemp -d /tmp/pi-photo-hub-update.XXXXXX)"
  g archive "$TO" | tar -x -C "$TMP"
  if [ -f "$TMP/scripts/update.sh" ]; then
    exec bash "$TMP/scripts/update.sh" --phase2 --dry-run --src "$TMP" --cleanup-src --changed "$CHANGED" \
      --from "$FROM" --to "$TO" --from-desc "$FROM_DESC" \
      "${fwd[@]}"
  fi
  rm -rf "$TMP"
  log "The target has no scripts/update.sh, so the apply step cannot be previewed."
  exit 0
fi

# --- real run: move the saved slideshow aside, check out, fix exec bits ---------------
if [ "$slide_dirty" = 1 ]; then
  keep="$STATE_DIR/slideshow_url.txt.from-checkout-$(date +%Y%m%d-%H%M%S)"
  mv "$REPO_ROOT/$SLIDE" "$keep"
  log "moved the checkout's modified $SLIDE to $keep (the live copy is $STATE_DIR/slideshow_url.txt)"
fi

if [ "$MODE" = ref ]; then
  g switch --detach "$TO" 2>&1 | sed 's/^/    /'
else
  if [ "$cur_branch" = "$TARGET_NAME" ]; then
    :
  elif g show-ref --verify --quiet "refs/heads/$TARGET_NAME"; then
    g switch "$TARGET_NAME" 2>&1 | sed 's/^/    /'
  else
    g switch -c "$TARGET_NAME" --track "origin/$TARGET_NAME" 2>&1 | sed 's/^/    /'
  fi
  g merge --ff-only "origin/$TARGET_NAME" 2>&1 | sed 's/^/    /' \
    || die "cannot fast-forward $TARGET_NAME to origin/$TARGET_NAME (local commits on the Pi?). Nothing was reset."
fi
# Apply the executable bits recorded in git (mount-hdd.service runs scripts/mount-hdd.sh directly).
g ls-files --stage | while IFS=$'\t' read -r meta path; do
  [ "${meta%% *}" = 100755 ] && chmod +x "$REPO_ROOT/$path"
done || true
log "checked out $(g log --oneline -1)"

# --- hand over to the target's own script to apply it ---------------------------------
if [ -f "$REPO_ROOT/scripts/update.sh" ]; then
  exec bash "$REPO_ROOT/scripts/update.sh" --phase2 --src "$REPO_ROOT" --changed "$CHANGED" \
    --from "$FROM" --to "$TO" --from-desc "$FROM_DESC" \
    "${fwd[@]}"
fi
log "[WARN] the checked-out commit has no scripts/update.sh: only the checkout changed; units, API dependencies and services were NOT re-applied."
log "Undo: update.sh --ref ${FROM:0:7}"
