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

project_jobs() {
  local line
  ${PGREP:-pgrep} -af "$PROJECT_JOBS_SAFE|$PROJECT_JOBS_UNSAFE" 2>/dev/null \
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
