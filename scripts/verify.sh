#!/bin/bash
# verify.sh - READ-ONLY drift report: does the Pi match what this repo says it should have?
# Run on the Pi (the pi-access skill): bash ~/pi-photo-hub/scripts/verify.sh   (backlog B07)
#
# Compares the installed units, init script, Picapport properties, logrotate and journald config,
# kernel command-line settings, packages, cron entries, hidden pointer, state and log files, the
# photo HDD pin and the services with the checkout at ~/pi-photo-hub. Each line is OK, DRIFT (the
# Pi differs from the repo: `scripts/update.sh` puts most of it right) or INFO. Exit 1 if any DRIFT.
# It changes nothing (no git fetch: "behind origin" uses the last fetch).
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
drift=0
ok()    { echo "OK     $*"; }
dr()    { echo "DRIFT  $*"; drift=$((drift + 1)); }
info()  { echo "INFO   $*"; }
same()  { # same <repo file> <installed file> <label>
  if [ ! -f "$2" ]; then dr "$3: $2 missing"
  elif cmp -s "$1" "$2"; then ok "$3"
  else dr "$3: $2 differs from $1"; fi
}

# --- checkout -------------------------------------------------------------------------------------
cd "$REPO" || exit 2
br="$(git branch --show-current)"; head="$(git log --oneline -1)"
dirty="$(git status --porcelain --untracked-files=no)"
[ -z "$dirty" ] && ok "checkout clean (${br:-detached} at $head)" || dr "checkout has tracked local changes: $(echo $dirty)"
[ "$br" = main ] || info "checkout is on ${br:-a detached commit}, not main (a test branch or a rollback?)"
behind="$(git rev-list --count HEAD..origin/main 2>/dev/null || echo '?')"
[ "$behind" = 0 ] && ok "not behind origin/main (as of the last fetch)" || info "$behind commit(s) behind origin/main as of the last fetch (update.sh --dry-run shows them)"

# --- files installed from the repo ------------------------------------------------------------------
same systemd/mount-hdd.service /etc/systemd/system/mount-hdd.service "unit mount-hdd"
same systemd/picapport-wrapper.service /etc/systemd/system/picapport-wrapper.service "unit picapport-wrapper"
same systemd/photo-api.service.template /etc/systemd/system/photo-api.service "unit photo-api"
same systemd/picapport-chromium.service.template /etc/systemd/system/picapport-chromium.service "unit picapport-chromium"
same systemd/photo-buttons.service /etc/systemd/system/photo-buttons.service "unit photo-buttons"
same initd/picapport /etc/init.d/picapport "init script picapport"
same config/picapport.properties /opt/picapport/.picapport/picapport.properties "picapport.properties"
same config/logrotate-pi-photo-hub /etc/logrotate.d/pi-photo-hub "logrotate config"
same config/journald-pi-photo-hub.conf /etc/systemd/journald.conf.d/pi-photo-hub.conf "journald config"
for u in mount-hdd picapport-wrapper photo-api picapport-chromium photo-buttons; do
  e="$(systemctl is-enabled "$u" 2>/dev/null || true)"
  [ "$e" = enabled ] && ok "unit $u enabled" || dr "unit $u is '$e', not enabled"
done
for s in mount-hdd picapport-wrapper photo-api photo-buttons; do
  a="$(systemctl is-active "$s" 2>/dev/null || true)"
  [ "$a" = active ] && ok "service $s active" || dr "service $s is '$a'"
done

# --- kernel command line, packages -------------------------------------------------------------------
cmdline="$(cat /proc/cmdline)"; boot_cmdline="$(head -1 /boot/firmware/cmdline.txt 2>/dev/null)"
while read -r tok; do
  tok="${tok%%#*}"; tok="$(echo "$tok" | tr -d '[:space:]')"; [ -n "$tok" ] || continue
  if printf ' %s ' "$cmdline" | grep -qF " $tok "; then ok "kernel cmdline: $tok (running)"
  elif printf ' %s ' "$boot_cmdline" | grep -qF " $tok "; then info "kernel cmdline: $tok is set but takes effect at the next reboot"
  else dr "kernel cmdline: $tok missing"; fi
done < config/kernel-cmdline.txt
for p in $(sed -e 's/#.*//' config/packages.txt); do
  dpkg-query -W -f='${Status}' "$p" 2>/dev/null | grep -q 'install ok installed' && ok "package $p" || dr "package $p not installed"
done

# --- cron, pointer, state, logs ---------------------------------------------------------------------
cron="$(crontab -l 2>/dev/null || true)"
for tag in health-log vocabulary db-backup; do
  n="$(printf '%s\n' "$cron" | grep -c "# pi-photo-hub $tag" || true)"
  [ "$n" = 1 ] && ok "cron entry: $tag" || dr "cron entry: $tag found $n times (expected 1)"
done
other="$(printf '%s\n' "$cron" | grep -v -e '^#' -e '^$' -e 'pi-photo-hub' || true)"
[ -z "$other" ] || info "other cron entries for pi (not from the repo): $other"
[ -f "$HOME/.icons/pi-photo-hub-blank/index.theme" ] && ok "hidden pointer theme" || dr "hidden pointer theme missing (~/.icons/pi-photo-hub-blank)"
[ -d /var/lib/photo-api ] && ok "state directory /var/lib/photo-api" || dr "state directory /var/lib/photo-api missing"
[ "$(stat -c %U /var/log/pi-photo-hub/health.log 2>/dev/null)" = pi ] && ok "health log /var/log/pi-photo-hub/health.log (pi)" || dr "health log file missing or not owned by pi"
[ ! -f "$HOME/.config/autostart/picapport-chromium.desktop" ] && ok "no stale desktop autostart entry" || dr "stale ~/.config/autostart/picapport-chromium.desktop present (B12)"
[ "$(git for-each-ref refs/heads | wc -l)" -le 2 ] && ok "no stale local branches" || info "local branches: $(git for-each-ref --format='%(refname:short)' refs/heads | tr '\n' ' ')"

# --- photo HDD -----------------------------------------------------------------------------------------
pin="$(bash "$REPO/scripts/mount-hdd.sh" --check 2>/dev/null)"
dev="$(printf '%s\n' "$pin" | sed -n 's/^present: yes (\(.*\))$/\1/p')"
src="$(findmnt -n -o SOURCE /mnt/photos 2>/dev/null || true)"
if [ -n "$dev" ] && [ "$(readlink -f "$src")" = "$dev" ]; then ok "photo HDD: the pinned disk ($dev) is mounted at /mnt/photos"
else dr "photo HDD: pinned disk present as '${dev:-none}', /mnt/photos has '${src:-nothing}'"; fi

echo "----"
if [ "$drift" = 0 ]; then echo "VERIFY: no drift"; else echo "VERIFY: $drift DRIFT line(s). Most are put right by scripts/update.sh (apply-changes skill)."; exit 1; fi
