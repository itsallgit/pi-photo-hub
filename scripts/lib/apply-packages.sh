#!/bin/bash
# apply-packages.sh - install the apt packages listed in config/packages.txt that are missing.
# Called by scripts/update.sh (and its logic mirrored in bootstrap.sh). Install only: never
# upgrades or removes anything; `apt-get update` runs only when something has to be installed.
# Env: SRC (tree to apply, required), DRY_RUN, UPDATE_CHANGED. APT_GET and DPKG_QUERY can be
# overridden for testing away from the Pi.
set -euo pipefail
SRC="${SRC:?SRC (the source tree to apply) is required}"
# shellcheck source=/dev/null
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
APT_GET="${APT_GET:-apt-get}"
DPKG_QUERY="${DPKG_QUERY:-dpkg-query}"
LIST="$SRC/config/packages.txt"

if [ ! -f "$LIST" ]; then log "packages: no config/packages.txt, nothing to install"; exit 0; fi

missing=()
while IFS= read -r line || [ -n "$line" ]; do
  pkg="${line%%#*}"; pkg="$(echo "$pkg" | tr -d '[:space:]')"
  [ -z "$pkg" ] && continue
  if "$DPKG_QUERY" -W -f='${Status}' "$pkg" 2>/dev/null | grep -q 'install ok installed'; then
    log "packages: $pkg already installed"
  else
    missing+=("$pkg")
  fi
done < "$LIST"

if [ "${#missing[@]}" -eq 0 ]; then exit 0; fi

log "packages: installing missing ${missing[*]} (apt-get install --no-upgrade; nothing is upgraded)"
run $SUDO env DEBIAN_FRONTEND=noninteractive "$APT_GET" update -qq
run $SUDO env DEBIAN_FRONTEND=noninteractive "$APT_GET" install -y -qq --no-upgrade --no-install-recommends "${missing[@]}"
note_changed "packages"
