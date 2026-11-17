#!/bin/bash
# project-jobs.sh - which project jobs are running right now. Source it; do not run it.
# Used by scripts/whats-running.sh (read-only report) and scripts/pi-power.sh (refuses to reboot or
# shut down while any is running). One list, so the two never disagree.
#
#   project_jobs   prints one line per running job: "<pid> <command>  [safe to interrupt|NOT safe to interrupt]"
#
# Safe to interrupt: the vocabulary refresh and metadata survey (they swap in a new file only at
# the end; docs/architecture.md, "Vocabulary refresh"), the metadata test set. Not safe: the
# database script (picapport-db.sh) and an update (update.sh), which leave things half done.

PROJECT_JOBS_SAFE='refresh-vocabulary|metadata-survey|exiftool|metadata-testset'
PROJECT_JOBS_UNSAFE='picapport-db\.sh|update\.sh'

# The caller is not a job: neither its parents (for example the `bash -c "...update.sh...;
# pi-power.sh"` line of one SSH call) nor its own forked subshells, which carry the same command
# line. A process is skipped if it is an ancestor of the caller, or the caller is its ancestor.
project_jobs_chain() { # project_jobs_chain <pid>: the pid and all its ancestors, one per line
  local p="$1"
  while [ -n "$p" ] && [ "$p" -gt 1 ] 2>/dev/null; do
    echo "$p"
    p="$(awk '{print $4}' "/proc/$p/stat" 2>/dev/null)"
  done
}

project_jobs_related() { # true if <pid> is the caller, an ancestor of it, or a descendant of it
  local me="$$"
  project_jobs_chain "$me" | grep -qx "$1" && return 0
  project_jobs_chain "$1" | grep -qx "$me"
}

project_jobs() {
  local line pid
  ${PGREP:-pgrep} -af "$PROJECT_JOBS_SAFE|$PROJECT_JOBS_UNSAFE" 2>/dev/null \
    | while IFS= read -r line; do
        pid="${line%% *}"
        project_jobs_related "$pid" || echo "$line"
      done \
    | grep -v -e pgrep -e whats-running -e pi-power \
    | cut -c1-140 \
    | while IFS= read -r line; do
        if printf '%s\n' "$line" | grep -Eq "$PROJECT_JOBS_UNSAFE"; then
          echo "$line  [NOT safe to interrupt]"
        else
          echo "$line  [safe to interrupt]"
        fi
      done || true
}
