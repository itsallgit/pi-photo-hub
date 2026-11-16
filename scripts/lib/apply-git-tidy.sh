#!/bin/bash
# apply-git-tidy.sh - keep the Pi's checkout free of stale branches (backlog B22). Called by
# scripts/update.sh after the checkout.
#   * removes remote-tracking refs for branches deleted on GitHub (git remote prune origin)
#   * deletes LOCAL branches that no longer exist on GitHub AND are fully merged into the checked-out
#     commit, with `git branch -d` (which refuses anything unmerged), never the current branch.
# Nothing unmerged is ever deleted; a branch that still exists on GitHub is kept.
# Env: REPO (the checkout, required), DRY_RUN.
set -euo pipefail
REPO="${REPO:?REPO (the checkout) is required}"
# shellcheck source=/dev/null
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
g() { git -C "$REPO" "$@"; }

remote_heads="$(g ls-remote --heads origin 2>/dev/null | sed 's#.*refs/heads/##')" \
  || { log "branches: cannot reach origin, tidy skipped"; exit 0; }
[ -n "$remote_heads" ] || { log "branches: origin listed no branches, tidy skipped"; exit 0; }

stale_remote="$(g remote prune --dry-run origin 2>/dev/null | sed -n 's#.*\[would prune\] ##p')"
if [ -n "$stale_remote" ]; then
  log "branches: removing $(printf '%s\n' "$stale_remote" | wc -l) stale remote-tracking ref(s) (deleted on GitHub): $(printf '%s ' $stale_remote)"
  run g remote prune origin
fi

current="$(g branch --show-current)"
deleted=0
while read -r b; do
  [ -n "$b" ] && [ "$b" != "$current" ] || continue
  printf '%s\n' "$remote_heads" | grep -qxF "$b" && continue          # still on GitHub: keep
  if g merge-base --is-ancestor "refs/heads/$b" HEAD; then
    log "branches: deleting local branch $b (merged, gone from GitHub)"
    run g branch -d "$b"
    deleted=$((deleted + 1))
  else
    log "branches: keeping local branch $b (gone from GitHub but NOT merged; ask the owner)"
  fi
done < <(g for-each-ref --format='%(refname:short)' refs/heads)
[ -n "$stale_remote" ] || [ "$deleted" -gt 0 ] || log "branches: nothing stale"
